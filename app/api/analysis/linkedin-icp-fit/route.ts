// =====================================================================
// Losse LinkedIn ICP-fit-analyse. Bedraadt de bestaande, geteste kern (lib/linkedin/icp-fit):
// welk deel van de spend en de leads valt binnen het ideale klantprofiel, wat is de waste op
// niet-ICP-segmenten, en wat kost een ICP-lead versus een niet-ICP-lead. Deterministisch,
// geen LLM. Een leeg ICP degradeert expliciet met een verwijzing naar de instelling
// (client_settings.linkedin_icp). Materiele waste landt in de goedkeuringswachtrij.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { computeIcpFit, isIcpEmpty, type LinkedInIcp } from "@/lib/linkedin/icp-fit";
import { mapLinkedinDemographicToComputeRow } from "@/lib/linkedin/analysis-data";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, alleRijen, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

const SECTION = "linkedin_icp_v1";
const SOP_TYPE = "linkedin_icp";
const FETCH_DAYS = 90;
const ICP_SPEND_WEAK = 0.6;   // onder 60% spend-in-ICP is de targeting-vraag materieel
const WASTE_MATERIAL_EUR = 250;

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest. Zonder dit gaf deze route in
  // demo-modus een 500 en bleef het bijbehorende tabblad leeg.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

const pct = (v: number | null): string => (v == null ? "n.v.t." : `${Math.round(v * 1000) / 10}%`);
const eur = (v: number | null): string => (v == null ? "n.v.t." : `€${Math.round(v)}`);

export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET (sloop-audit 1 sep 2026).
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
  const since = addDays(today(), -FETCH_DAYS);
  const [demoFetch, settingsRes, labelRes] = await Promise.all([
    // Gepagineerd: 90 dagen × pivots × segmenten × campagnes overschrijdt de 1000-rijen-cap
    // bij elk echt account, en een stille afkap vertekent alle aandelen.
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("linkedin_demographic_daily")
        .select("date, level, entity_urn, pivot_type, pivot_value_urn, impressions, clicks, spend, leads, conversions, coverage_pct")
        .eq("client_id", clientId)
        // De sync schrijft demografie uitsluitend op CAMPAIGN-level (lib/linkedin/sync.ts); de som
        // over campagnes IS de accountweergave. Zonder deze pin zou een toekomstige ACCOUNT-level
        // rij alles dubbel laten tellen.
        .eq("level", "CAMPAIGN")
        .gte("date", since)
        .order("date", { ascending: false })
        .order("pivot_type", { ascending: true })
        .order("pivot_value_urn", { ascending: true })
        .range(van, tot),
      "linkedin_demographic_daily"
    ),
    supabase.from("client_settings").select("linkedin_icp").eq("client_id", clientId).maybeSingle(),
    supabase.from("linkedin_urn_labels").select("urn, label").limit(5000),
  ]);

  const raw = demoFetch.rijen;
  if (raw.length === 0) {
    return Response.json({ error: "Geen LinkedIn-demografiedata voor deze klant; draai eerst de LinkedIn-sync. Bron: linkedin_demographic_daily." }, { status: 404 });
  }

  const segments = raw.map((r) => mapLinkedinDemographicToComputeRow(r as Parameters<typeof mapLinkedinDemographicToComputeRow>[0]));
  const icp = (settingsRes.data?.linkedin_icp as LinkedInIcp | null) ?? null;
  const labels = new Map(eis(labelRes, "linkedin_urn_labels").map((l) => [String(l.urn), String(l.label)]));
  const fits = computeIcpFit(segments, icp);

  const lines: string[] = ["# LinkedIn ICP-fit", "", `Venster: laatste ${FETCH_DAYS} dagen demografiedata.`, ""];
  if (isIcpEmpty(icp)) {
    lines.push(
      "## ICP niet ingesteld",
      "Er is geen ideaal klantprofiel geconfigureerd (client_settings.linkedin_icp); de analyse is daarom alleen beschrijvend. Stel het ICP in om de fit-score en de waste-berekening te activeren."
    );
  }
  // Eén bedrag voor de wachtrij: de GROOTSTE pivot-waste, niet de som. De vier pivots zijn
  // vier doorsnedes van dezelfde euro's; ze optellen telde dezelfde spend tot vier keer
  // dubbel (sloop-audit 1 sep 2026). Het maximum is de meest conservatieve zekere ondergrens.
  let grootsteWaste = 0;
  const weakPivots: string[] = [];
  const leadsTekst = (v: number): string => String(Math.round(v * 10) / 10);
  for (const f of fits) {
    lines.push(`## ${f.pivotType}`);
    if (f.degraded) {
      lines.push("- geen ICP-definitie voor deze dimensie: alleen beschrijvend", `- totaal: ${eur(f.totalSpend)} spend, ${leadsTekst(f.totalLeads)} leads${f.coveragePct != null ? `, demografie-dekking ${pct(f.coveragePct)}` : ""}`, "");
      continue;
    }
    lines.push(
      `- spend binnen ICP: **${pct(f.spendInIcpPct)}**; leads binnen ICP: **${pct(f.leadsInIcpPct)}**`,
      `- waste op niet-ICP-segmenten: **${eur(f.wasteSpend)}**${f.largestWasteSegment ? ` (grootste: ${labels.get(f.largestWasteSegment.urn) ?? f.largestWasteSegment.urn} met ${eur(f.largestWasteSegment.spend)} en ${leadsTekst(f.largestWasteSegment.leads)} leads)` : ""}`,
      `- CPL binnen ICP: **${eur(f.icpCpl)}** vs buiten ICP: **${eur(f.nonIcpCpl)}**${f.coveragePct != null ? `; demografie-dekking ${pct(f.coveragePct)}` : ""}`,
      ""
    );
    if (f.spendInIcpPct != null && f.spendInIcpPct < ICP_SPEND_WEAK && f.wasteSpend >= WASTE_MATERIAL_EUR) {
      grootsteWaste = Math.max(grootsteWaste, f.wasteSpend);
      weakPivots.push(`${f.pivotType} (${pct(f.spendInIcpPct)} in ICP, ${eur(f.wasteSpend)} waste)`);
    }
  }
  const actionNeeded = weakPivots.length > 0;
  if (actionNeeded) {
    lines.push("## Duiding", `Op ${weakPivots.length} dimensie(s) valt minder dan ${ICP_SPEND_WEAK * 100}% van de spend binnen het ICP met materiele waste: ${weakPivots.join("; ")}. De dimensies zijn doorsnedes van dezelfde euro's; tel ze niet op. Scherp de targeting aan of herzie het ICP als deze segmenten bewust zijn.`);
  }
  const output = lines.join("\n");

  const analysisDate = today();
  // De echte dagspan van de gebruikte demografierijen.
  const datums = raw.map((r) => String(r.date)).sort();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
      period_start: datums[0], period_end: datums[datums.length - 1], section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "LinkedIn ICP-fit",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  const proposals: SprintHypothesisRow[] = actionNeeded
    ? [{
        client_id: clientId, analysis_id: null,
        hypothesis: `Scherp de LinkedIn-targeting aan: minstens ${eur(grootsteWaste)} spend valt buiten het ICP (grootste dimensie)`,
        expected_result: "Een groter aandeel spend en leads binnen het ICP bij gelijkblijvend budget, en een lagere effectieve CPL op de doelgroep die telt.",
        measurement_metric: "Spend-in-ICP-percentage en waste per dimensie in de volgende ICP-fit-analyse.",
        timeframe: "2 weken",
        rationale: `${weakPivots.join("; ")}. De dimensies overlappen (zelfde euro's, andere doorsnede); het bedrag is de grootste enkele dimensie.`,
        ice_impact: grootsteWaste >= 1000 ? 8 : 5, ice_confidence: 7, ice_ease: 6,
        ice_total: Math.round((((grootsteWaste >= 1000 ? 8 : 5) + 7 + 6) / 3) * 10) / 10,
        status: "pending", source: "linkedin_icp",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "linkedin_icp", proposals);

  return Response.json({
    analysis: output, actionNeeded, pivots: fits.length, icpConfigured: !isIcpEmpty(icp),
    dekking: { rijenAfgekapt: demoFetch.afgekapt, dagen: { van: datums[0], tot: datums[datums.length - 1] } },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
