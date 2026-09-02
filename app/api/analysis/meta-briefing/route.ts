// =====================================================================
// M4: creative-briefing route. Patronen (M3) plus fatigue plus merkgids in, een door een
// designer uitvoerbare briefing uit. De LLM FORMULEERT uitsluitend (temperatuur 0,2 conform
// de spec, bewust hoger dan de analyse-nul want dit is formuleerwerk); elk bewijs-getal
// wordt na afloop gegate't tegen de prompt-input (hergebruik van de F5-gespiegelde
// number-gate). Structuurgetallen die het model zelf kiest (meetvenster, varianten,
// dekking) zijn richtlijnen en geen claims; de gate draait daarom over de claim-velden.
// Bij onvoldoende deterministic bewijs is er GEEN LLM-call: de insufficient-pagina is
// volledig deterministisch. LIVE-ONGETEST: vergt Meta-data plus de 013- en 019-migraties.
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { extractGroundedNumbers, gateUngroundedNumbers } from "@/lib/analysis/weekly-number-gate";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { alleRijen, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import { addDays } from "@/lib/reporting-date";
import { isActionable } from "@/lib/learning/hypothesis-status";
import { selectBriefingPatterns } from "@/lib/meta/briefing/selection";
import { BriefingSchema, buildBriefingPrompt, type CreativeBriefing } from "@/lib/meta/briefing/schema";
import { renderBriefingMarkdown, renderInsufficientMarkdown } from "@/lib/meta/briefing/render";
import { aggregateAdWindow, buildFatigueInputs, type AdDailyRow } from "@/lib/meta/briefing/fatigue";
import { flagFatiguedWinners, type PatternAggregate } from "@/lib/meta/vision/patterns";
import { emptyBrandGuide, brandContextForBriefing, type BrandGuide } from "@/lib/branding/brand-guide";
import { FEATURES_VERSION } from "@/app/api/analysis/meta-creatives/route";
import { today as vandaag } from "@/lib/reporting-date";
import { resolveTargets, type TargetRow } from "@/lib/analysis/o2-targets-cost";

const SECTION = "meta_briefing_v1";
const SOP_TYPE = "meta_briefing";
void FEATURES_VERSION; // gedeelde versie-constante; de patronen zijn er al op gefilterd bij de aggregatie

function stripFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// De toegestane-getallen-set voor de number-gate. De gate herkent alleen "N%" en "€N",
// maar de prompt draagt de patroonwaarden als kale JSON-getallen (liftPct 0.345): de
// toegestane set was daardoor vrijwel leeg — "34,5%" werd een valse 422 en "34,5" zonder
// teken ontsnapte juist (sloop-audit 1 sep 2026). Daarom: elk getal uit de prompt-input,
// in beide gedaanten (afgerond, en als fractie×100), bovenop de letterlijke %/€-vondsten.
// Zo blijft elk geciteerd getal herleidbaar tot de input en blokkeert de gate nog steeds
// verzonnen cijfers.
function toegestaneGetallenUitInput(promptUser: string): number[] {
  const uit = extractGroundedNumbers(promptUser);
  for (const m of promptUser.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const v = Math.abs(parseFloat(m[0].replace(",", ".")));
    if (!Number.isFinite(v)) continue;
    uit.push(Math.round(v), Math.round(v * 100));
  }
  return uit;
}

export async function POST(request: NextRequest) {
  let body: { client_id?: string; funnelfocus?: string; hypothesis_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON-body" }, { status: 400 });
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust: mock-writes horen no-ops te zijn.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  try {
  // ── SI5: de gate tussen analyse en briefing. ──
  // Een briefing zet designers en editors aan het werk, dus hij hoort een GENOMEN
  // beslissing uit te voeren en niet zelf een voorstel te zijn. De aanroeper wijst daarom
  // de aangenomen hypothese aan die deze briefing implementeert. Zonder die koppeling is
  // een briefing productiewerk zonder mandaat, en is achteraf niet te zeggen welke
  // beslissing hij uitvoerde.
  const hypothesisId = typeof body.hypothesis_id === "string" ? body.hypothesis_id : "";
  if (!hypothesisId) {
    // Blokkeren zonder richting is een dood spoor; geef mee waaruit te kiezen valt.
    const { data: options } = await supabase
      .from("sprint_hypotheses")
      .select("id, hypothesis, accepted_at")
      .eq("client_id", clientId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(10);
    return Response.json(
      {
        error: "hypothesis_id is verplicht: een briefing voert een aangenomen hypothese uit",
        hint: (options ?? []).length > 0
          ? "kies een van de aangenomen hypotheses hieronder"
          : "er is nog geen aangenomen hypothese voor deze klant; keur er eerst een goed in het klantdashboard",
        aangenomen_hypotheses: options ?? [],
      },
      { status: 409 }
    );
  }

  const { data: gateRow, error: gateError } = await supabase
    .from("sprint_hypotheses")
    .select("id, client_id, hypothesis, status")
    .eq("id", hypothesisId)
    .maybeSingle();
  if (gateError) return Response.json({ error: gateError.message }, { status: 500 });
  if (!gateRow) return Response.json({ error: "de opgegeven hypothese bestaat niet" }, { status: 404 });
  if (gateRow.client_id !== clientId) {
    return Response.json({ error: "de hypothese hoort bij een andere klant" }, { status: 400 });
  }
  if (!isActionable(gateRow.status as string | null)) {
    return Response.json(
      { error: `de hypothese staat op ${gateRow.status ?? "onbekend"} en is niet goedgekeurd; alleen een aangenomen hypothese mag productiewerk starten` },
      { status: 409 }
    );
  }

  // ── 1. De patronen van de nieuwste periode. ──
  const { data: patternRows, error: patternError } = await supabase
    .from("meta_creative_patterns")
    .select("period_start, period_end, attribute, value, metric, n_ads, impressions, conversions, pattern_value, account_avg, lift_pct, evidence_level")
    .eq("client_id", clientId)
    .order("period_start", { ascending: false });
  if (patternError) return Response.json({ error: `Patronen laden faalde: ${patternError.message}` }, { status: 500 });
  if (!patternRows || patternRows.length === 0) {
    return Response.json({ error: "Geen creative-patronen voor deze klant; draai eerst de meta-creatives analyse (analyze plus aggregate)" }, { status: 404 });
  }
  const newestPeriod = patternRows[0].period_start as string;
  const periodEnd = patternRows[0].period_end as string;
  const patterns: PatternAggregate[] = patternRows
    .filter((r) => r.period_start === newestPeriod)
    .map((r) => ({
      attribute: r.attribute as string,
      value: r.value as string,
      metric: r.metric as PatternAggregate["metric"],
      nAds: Number(r.n_ads),
      impressions: Number(r.impressions),
      conversions: Number(r.conversions ?? 0),
      patternValue: Number(r.pattern_value),
      accountAvg: Number(r.account_avg),
      liftPct: Number(r.lift_pct),
      evidenceLevel: r.evidence_level as PatternAggregate["evidenceLevel"],
    }));

  // ── 2. Vervangingsurgentie: recent (14 dagen) tegen prior (30 dagen ervoor), geankerd op
  // de laatste DATAdatum. Op de wandklok besloegen de vensters bij sync-lag deels lege
  // dagen, waardoor de impressie-drempel zelden werd gehaald en de urgentie systematisch
  // leeg bleef (sloop-audit 1 sep 2026).
  const ankerRes = await supabase
    .from("meta_ad_daily")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ankerRes.error) return Response.json({ error: `meta_ad_daily: ${ankerRes.error.message}` }, { status: 500 });
  const anker = ankerRes.data?.date ? String(ankerRes.data.date) : vandaag();
  const loadWindow = async (vanTerug: number, totTerug: number): Promise<AdDailyRow[]> => {
    const { rijen } = await alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("meta_ad_daily")
        .select("entity_id, date, impressions, link_clicks, conversions, frequency")
        .eq("client_id", clientId)
        .gte("date", addDays(anker, -vanTerug))
        .lte("date", addDays(anker, -totTerug))
        .order("date", { ascending: false })
        .order("entity_id", { ascending: true })
        .range(van, tot),
      "meta_ad_daily"
    );
    return rijen.map((r) => ({
      adId: r.entity_id as string,
      impressions: Number(r.impressions ?? 0),
      linkClicks: Number(r.link_clicks ?? 0),
      conversions: Number(r.conversions ?? 0),
      frequency: r.frequency == null ? null : Number(r.frequency),
    }));
  };
  const [recentRows, priorRows] = await Promise.all([loadWindow(13, 0), loadWindow(43, 14)]);
  const replacements = flagFatiguedWinners(buildFatigueInputs(aggregateAdWindow(recentRows), aggregateAdWindow(priorRows)));

  // ── 3. De selectie beslist het pad. ──
  const selection = selectBriefingPatterns({ patterns, replacements });
  const kop = { klant: clientId, periodeBasis: `${newestPeriod} tot ${periodEnd}`, doelstelling: `uitvoering van de aangenomen hypothese: ${String(gateRow.hypothesis).slice(0, 120)}`, funnelfocus: typeof body.funnelfocus === "string" && body.funnelfocus ? body.funnelfocus : "prospecting en retargeting" };
  const analysisDate = vandaag();

  if (selection.status === "onvoldoende_bewijs") {
    const markdown = renderInsufficientMarkdown(selection, kop);
    await saveAnalysisOutputSection({
      supabase,
      row: { client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate, period_start: newestPeriod, period_end: periodEnd, section: SECTION, output: markdown, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "Creative briefing" },
    });
    return Response.json({ status: "onvoldoende_bewijs", deterministic_count: selection.deterministicCount, markdown, hypothesis_id: hypothesisId });
  }

  // ── 4. De merkgids, met degradatie naar leeg (migratie 019 kan nog ontbreken). ──
  let guide: BrandGuide = emptyBrandGuide(clientId);
  try {
    const { data: settings } = await supabase.from("client_settings").select("brand_guide").eq("client_id", clientId).maybeSingle();
    if (settings?.brand_guide) guide = { ...emptyBrandGuide(clientId), ...(settings.brand_guide as Partial<BrandGuide>) };
    // client_targets in plaats van kpi_targets (fase 2, docs/MASTERPLAN.md), channel=meta_ads:
    // kpi_targets had nooit een kanaal-dimensie en droeg in de praktijk altijd het Google-target
    // -- dat als Meta-doelstelling tonen was onjuist. client_targets heeft voor meta_ads bewust
    // geen rijen, dus deze regel blijft voortaan leeg totdat er een echt Meta-target is ingevoerd.
    const { data: targetRows } = await supabase
      .from("client_targets").select("channel, metric, target_value, valid_from, valid_to")
      .eq("client_id", clientId).eq("channel", "meta_ads");
    const kpi = resolveTargets(
      (targetRows ?? []).map((row): TargetRow => ({
        channel: String(row.channel),
        metric: String(row.metric),
        targetValue: Number(row.target_value),
        validFrom: String(row.valid_from),
        validTo: row.valid_to == null ? null : String(row.valid_to),
      })),
      "meta_ads",
      periodEnd
    );
    // Het target komt NAAST het mandaat, niet in de plaats ervan: de briefing voert een
    // aangenomen hypothese uit, en dat hoort de kop te blijven zeggen.
    if (kpi.cpa) kop.doelstelling = `${kop.doelstelling} (CPA-target €${kpi.cpa})`;
    else if (kpi.roas) kop.doelstelling = `${kop.doelstelling} (ROAS-target ${kpi.roas})`;
  } catch {
    // geen settings of kolom: de lege gids volstaat, de briefing benoemt dan geen merkregels
  }
  const brand = brandContextForBriefing(guide);

  // ── 5. De builder formuleert; schema-validatie met een repair. ──
  const prompt = buildBriefingPrompt({ selection, brand, kop });
  let briefing: CreativeBriefing | null = null;
  let lastIssues = "";
  for (let attempt = 0; attempt < 2 && !briefing; attempt += 1) {
    const suffix = attempt === 0 ? "" : `\n\nJe vorige antwoord voldeed niet aan het schema: ${lastIssues}. Antwoord UITSLUITEND met het gecorrigeerde JSON-object.`;
    const response = await callRouted({
      apiKey,
      systemPrompt: prompt.system,
      userMessage: prompt.user + suffix,
      maxTokens: 8192,
      jsonMode: true,
      temperature: 0.2,
      label: "meta-briefing",
    });
    try {
      const parsed = BriefingSchema.safeParse(JSON.parse(stripFences(response.output)));
      if (parsed.success) briefing = parsed.data;
      else lastIssues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      lastIssues = "geen geldige JSON";
    }
  }
  if (!briefing) {
    return Response.json({ error: "De builder leverde geen geldige briefing (ook na een repair)", issues: lastIssues }, { status: 422 });
  }

  // ── 6. De number-gate over de bewijs-claims, met de prompt-input als bron. ──
  const claimsText = [
    ...briefing.watWerkt.map((w) => w.richtlijn),
    ...briefing.donts.map((d) => d.richtlijn),
    ...briefing.vervangingsurgentie.map((v) => v.instructie),
    ...briefing.concepten.map((c) => c.experimentRedenatie ?? ""),
  ].join("\n");
  const allowed = toegestaneGetallenUitInput(prompt.user);
  const gate = gateUngroundedNumbers(claimsText, allowed);
  if (gate.hadUngrounded) {
    return Response.json({ error: "De briefing bevat bewijs-claims met getallen die niet in de input staan; niets opgeslagen", ongegrond: gate.ungrounded }, { status: 422 });
  }

  // ── 7. Render, opslag, response. ──
  const markdown = renderBriefingMarkdown(briefing, brand);
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: { client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate, period_start: newestPeriod, period_end: periodEnd, section: SECTION, output: markdown, model_used: "router", tokens_used: 0, step_number: 1, step_name: "Creative briefing" },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  return Response.json({ status: "briefing", markdown, concepten: briefing.concepten.length, replacements: replacements.length, hypothesis_id: hypothesisId });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
