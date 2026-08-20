// De nightly cron voor automatisch SOP-triggeren. Klaargezet, bewust NIET actief (17 augustus,
// op verzoek van de eigenaar: "de nightly cron mag klaargezet worden maar niet actief want ik wil
// handmatig kunnen triggeren voor tests en niet onnodig elke nacht betalen").
//
// ── WAT DIT BESTAND WEL EN NIET DOET ────────────────────────────────────────
//
// Dit bestand bestaat en werkt (handmatig aan te roepen, zie hieronder), maar staat NIET in
// vercel.json. Zolang dat zo is vuurt niets hem automatisch af -- de enige manier om hem te laten
// draaien is een expliciete aanroep met CRON_SECRET, precies zoals evaluate-code-rood en
// process-action-queue getest werden voordat ze aan vercel.json werden toegevoegd. Activeren is
// een aparte, bewuste stap:
//
//   { "path": "/api/cron/trigger-sops", "schedule": "0 3 * * *" }  toevoegen aan vercel.json
//
// Een TWEEDE, onafhankelijke veiligheidslaag zit in de data zelf: dit bestand triggert alleen een
// (klant, kanaal, cadans)-combinatie als hij "due" is (lib/scheduler/sop-cadence.ts) EN de klant
// sops_enabled heeft staan (lib/tenancy/sop-dekking.ts, magSopDraaien -- default true, ongewijzigd
// door dit bestand). Geen nieuwe "auto-trigger aan/uit"-vlag per klant: sops_enabled is al precies
// dat, en een tweede schakelaar ernaast zou verwarrend zijn over welke van de twee leidend is.
//
// De HANDMATIGE KNOPPEN (components/insights/sop-trigger-buttons.tsx) blijven onaangeroerd en
// blijven werken zoals ze werkten -- expliciet gevraagd, voor de testfase. Dit bestand roept
// dezelfde /api/analysis/{weekly,biweekly,monthly}-routes aan op dezelfde manier (POST met
// client_id/job_id/channel) en repliceert daarna dezelfde upload-naar-Bestanden-stap (uploadSopFile
// in dat component), alleen server-side met de service-role client in plaats van een
// browsersessie -- een cron heeft geen ingelogde gebruiker.
//
// ── WAAROM GEEN GEBRUIK VAN lib/scheduler/core.ts + pump-plan.ts, EN NIET VAN generation_jobs ──
//
// core.ts's isDueToday/AnalysisSchedule zijn monthly-specifiek (day_of_month) en nergens gewired
// (docs/MASTERPLAN.md sectie 2.2: geen kolom slaat een AnalysisSchedule op). pump-plan.ts's
// resumable-stappenplan lost een ander probleem op (één run die over meerdere invocaties moet
// lopen) dat zich hier niet voordoet: /api/analysis/{weekly,biweekly,monthly} draaien vandaag al
// synchroon binnen een aanroep (bewezen door de handmatige knoppen, dagelijks in gebruik).
// De nieuwere generation_jobs-action-queue (fase 3, app/api/cron/process-action-queue) lost een
// ANDER probleem op: werk ontkoppelen van de HTTP-request die het aanvraagt. Die queue heeft
// vandaag bewust géén job_type voor de SOP-routes (die blijven synchroon, zie process-action-
// queue's eigen kopcommentaar) -- dit bestand voegt daar niets aan toe en wacht er niet op; het
// is de WHO/WANNEER-beslissing (is deze combinatie due), niet de HOE-uitvoering (die blijft het
// bestaande synchrone pad).
//
// ── BATCHGROOTTE ─────────────────────────────────────────────────────────────
//
// `limit` (default 1) begrenst hoeveel due items deze ENE invocatie daadwerkelijk draait. Monthly
// duurt volgens de knoppen-UI 2-3 minuten; bij maxDuration 300s past dat maar net voor EEN monthly
// run, dus de default is bewust behoudend in plaats van een geschat getal -- zelfde discipline als
// PUMP_BATCH_SIZE in lib/scheduler/core.ts ("gemeten uit 756 echte stap-fases"), maar dan zonder
// dat die meting hier al bestaat. Verhoog `?limit=` pas nadat de echte duur van een self-fetch
// aanroep (inclusief het netwerkstapje, niet alleen de analyse zelf) in productie gemeten is. Items
// die wel due zijn maar buiten het budget vallen komen terug als status "due_deferred" -- niet
// stilzwijgend overgeslagen, zodat een volgende run (of een handmatige aanroep met hoger limit) ze
// oppikt.
//
// ── HANDMATIG TESTEN ─────────────────────────────────────────────────────────
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://.../api/cron/trigger-sops?dry_run=true&client_id=<clientId>"
//
// dry_run=true evalueert alles (welke combinaties due zijn) zonder ook maar één analyse te
// starten -- de veilige manier om te zien wat er zou gebeuren voordat er echt iets draait, en
// zonder kosten (geen LLM-aanroep, geen self-fetch).

import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { laadBeschikbareKanalen, ALLE_KANALEN, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHANNEL_CONFIG, ALLE_SOP_TYPES, type SopChannel, type SopType } from "@/lib/analysis/sop-channel-config";
import { isSopDue, type SopCadence } from "@/lib/scheduler/sop-cadence";
import { today } from "@/lib/reporting-date";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const DEFAULT_LIMIT = 1;

// lib/kanalen/beschikbaar.ts's Kanaal ("google"|"meta"|"linkedin", client-facing/data-gedreven)
// naar de SopChannel-vorm die de analyse-routes verwachten ("google_ads"|"meta_ads"|"linkedin_ads").
const KANAAL_NAAR_SOPCHANNEL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
};

interface Uitkomst {
  clientId: string;
  /** Ontbreekt alleen bij status "sops_disabled": die beslissing geldt per klant, niet per
   *  kanaal/cadans, dus is er nog geen kanaal-combinatie geevalueerd om te noemen. */
  channel?: SopChannel;
  cadence?: SopType;
  status: "triggered" | "failed" | "not_due" | "due_deferred" | "due_dry_run" | "sops_disabled";
  lastRunDate?: string | null;
  analysisDate?: string;
  error?: string;
}

interface AccountRij {
  client_id: string;
  agency_id: string | null;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET niet geconfigureerd; de cron weigert bewust te draaien" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "niet geautoriseerd" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const url = request.nextUrl;
  const dryRun = url.searchParams.get("dry_run") === "true";
  const clientFilter = url.searchParams.get("client_id");
  const agencyFilter = url.searchParams.get("agency_id");
  const channelFilter = url.searchParams.get("channel") as SopChannel | null;
  const cadenceFilter = url.searchParams.get("cadence") as SopType | null;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_LIMIT;

  let vraag = supabase.from("accounts").select("client_id, agency_id");
  if (clientFilter) vraag = vraag.eq("client_id", clientFilter);
  if (agencyFilter) vraag = vraag.eq("agency_id", agencyFilter);
  const { data: accounts, error: accountsError } = await vraag;
  if (accountsError) return Response.json({ error: accountsError.message }, { status: 500 });

  const klanten = ((accounts ?? []) as AccountRij[])
    .map((r) => r.client_id)
    .filter((id, i, arr) => arr.indexOf(id) === i) // dedupliceren, mocht een klant meerdere rijen hebben
    .sort(); // vaste volgorde: een run die elke nacht anders sorteert is bij een afgebroken run niet te vergelijken

  const origin = new URL(request.url).origin;
  const now = new Date();
  const resultaten: Uitkomst[] = [];
  let getriggerd = 0;
  // Eén keer per klant per cron-invocatie, ook als meerdere kanalen op dezelfde dag due zijn voor
  // monthly -- geen reden om drie keer dezelfde deterministische, gratis analyse te draaien.
  const crossChannelGedaan = new Set<string>();
  // Zelfde soort dedup, voor de PDF-gereedheidscheck hieronder -- die query't zelf de database
  // opnieuw (dus goedkoop om vaker te draaien), maar hoeft niet meermaals per klant per invocatie.
  const pdfGecheckt = new Set<string>();

  for (const clientId of klanten) {
    if (!(await magSopDraaien(supabase, clientId))) {
      resultaten.push({ clientId, status: "sops_disabled" });
      continue;
    }

    // "as never": zelfde workaround als components/dashboard/client-dashboard.tsx al gebruikt --
    // laadBeschikbareKanalen's structurele parametertype laat TS bij een volle SupabaseClient
    // "Type instantiation is excessively deep and possibly infinite" geven, ondanks dat de vorm
    // wel klopt.
    const kanalen = await laadBeschikbareKanalen(supabase as never, clientId);
    const sopKanalen = ALLE_KANALEN
      .filter((k) => kanalen.includes(k))
      .map((k) => KANAAL_NAAR_SOPCHANNEL[k])
      .filter((c) => !channelFilter || c === channelFilter);

    for (const channel of sopKanalen) {
      const cadences = ALLE_SOP_TYPES.filter((c) => !cadenceFilter || c === cadenceFilter);
      for (const cadence of cadences) {
        const sopTypeKey = CHANNEL_CONFIG[channel].sopTypeKey[cadence];
        const { data: laatsteRij } = await supabase
          .from("sop_analysis_output")
          .select("analysis_date")
          .eq("client_id", clientId)
          .eq("sop_type", sopTypeKey)
          .order("analysis_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastRunDate = (laatsteRij as { analysis_date?: string } | null)?.analysis_date ?? null;

        if (!isSopDue(cadence as SopCadence, lastRunDate, now)) {
          resultaten.push({ clientId, channel, cadence, status: "not_due", lastRunDate });
          continue;
        }
        if (dryRun) {
          resultaten.push({ clientId, channel, cadence, status: "due_dry_run", lastRunDate });
          continue;
        }
        if (getriggerd >= limit) {
          resultaten.push({ clientId, channel, cadence, status: "due_deferred", lastRunDate });
          continue;
        }

        try {
          const analysisDate = await voerSopUit(supabase, origin, clientId, channel, cadence);
          resultaten.push({ clientId, channel, cadence, status: "triggered", lastRunDate, analysisDate });
          getriggerd += 1;
          // Cross-channel hoort bij elke maandanalyse (masterplan 16.4: "cross channel moet de
          // basis zijn in de maandanalyse"), niet alleen bij een handmatige klik op de losse knop
          // (components/dashboard/cross-channel-analyses.tsx). Faalt dit, dan blijft de
          // kanaalanalyse zelf een succes -- cross-channel is een aanvulling, geen voorwaarde.
          // Alleen zinvol vanaf 2 kanalen (masterplan 16.6) -- met 1 kanaal is er niets om te
          // kruisen; de route zelf gate't dit ook (defense-in-depth), maar hier voorkomt het al
          // een nutteloze aanroep + de bijbehorende foutlog.
          if (cadence === "monthly" && kanalen.length > 1 && !crossChannelGedaan.has(clientId)) {
            crossChannelGedaan.add(clientId);
            await triggerCrossChannel(origin, clientId).catch((err) => {
              console.error(`[trigger-sops] cross-channel voor ${clientId} mislukt:`, err);
            });
            await triggerCrossChannelSynthesis(origin, clientId).catch((err) => {
              console.error(`[trigger-sops] cross-channel-synthese voor ${clientId} mislukt:`, err);
            });
          }
        } catch (err) {
          resultaten.push({
            clientId, channel, cadence, status: "failed", lastRunDate,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Losstaand van welk kanaal hierboven (als er uberhaupt iets) getriggerd is: de PDF-
    // gereedheid hangt af van de STAND VAN ZAKEN in de database, niet van "is er deze invocatie
    // iets nieuws gedraaid". Een klant wiens laatste kanaal al gisteren klaar kwam -- zonder dat
    // deze invocatie daar iets aan hoefde te triggeren -- moet zijn PDF alsnog krijgen; die zou
    // hem anders nooit krijgen als hij toevallig geen nieuwe combo meer due heeft. Query't zelf
    // opnieuw of alles klaar is (geen aanname op basis van wat hierboven gebeurde), dus altijd
    // veilig om te draaien, ook als er niets getriggerd is.
    if (!dryRun && (!cadenceFilter || cadenceFilter === "monthly") && !pdfGecheckt.has(clientId)) {
      pdfGecheckt.add(clientId);
      await triggerMonthlyPdfIfComplete(supabase, origin, clientId, kanalen).catch((err) => {
        console.error(`[trigger-sops] PDF-gereedheidscheck voor ${clientId} mislukt:`, err);
      });
    }
  }

  return Response.json({
    dry_run: dryRun,
    limit,
    aantal_klanten: klanten.length,
    getriggerd,
    resultaten,
  });
}

// Volledig deterministisch, geen LLM-aanroep (model_used: "deterministisch", tokens_used: 0 in
// app/api/analysis/cross-channel/route.ts) -- dus geen budgetimpact, alleen een handvol extra
// Supabase-reads. Gooit door bij een fout; de aanroeper vangt en logt, zonder de kanaalanalyse
// als mislukt te markeren.
async function triggerCrossChannel(origin: string, clientId: string): Promise<void> {
  const res = await fetch(`${origin}/api/analysis/cross-channel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `cross-channel gaf ${res.status}`);
  }
}

// Kanaaloverstijgende SYNTHESE (masterplan 17.12) -- ná de deterministische signalen hierboven,
// zodat de synthese de vers berekende cross-channel-context kan lezen. 409 (skipped) is hier geen
// fout: de route zelf beslist of alle beschikbare kanalen deze cyclus al klaar zijn, en met deze
// cron-loop (limit vaak 1) is dat lang niet elke invocatie zo -- pas het laatste kanaal dat deze
// nacht afrondt triggert daadwerkelijk een LLM-call.
async function triggerCrossChannelSynthesis(origin: string, clientId: string): Promise<void> {
  const res = await fetch(`${origin}/api/analysis/cross-channel-synthesis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok && res.status !== 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `cross-channel-synthesis gaf ${res.status}`);
  }
}

// De agency-facing maand-PDF als losse, zelf-gatende stap (masterplan 17.x) -- zelfde vorm als
// triggerCrossChannelSynthesis hierboven, nu toegepast op het renderen in plaats van op de
// synthese. Waarom een aparte functie en niet "render de PDF zodra het kanaal dat 'm nodig heeft
// klaar is": de PDF-route (app/api/analysis/pdf) rendert de rijke cross-channel/cross-account/
// God View-laag alleen voor sop_type "monthly" (Google), en die laag is precies waar de PDF
// eerder onvolledig-maar-niet-zichtbaar-onvolledig werd als hij te vroeg gegenereerd werd: vlak
// na Google's eigen run, voordat een ander kanaal of de cross-channel-synthese uberhaupt had
// kunnen draaien. Een op Storage opgeslagen PDF wordt niet later herrenderd -- dus "te vroeg" is
// hier niet "een paar minuten trager", maar "voorgoed het verkeerde antwoord".
//
// Blokkeert daarom alleen op wat deterministisch EINDIG is voor DEZE klant: haar eigen actieve
// kanalen, en (bij >1 kanaal) de cross-channel-synthese. Cross-account (bureau-breed, hangt af
// van ALLE klanten van dat bureau) en God View (een live lookup, geen taak die "klaar" wordt)
// blijven wat de renderer daar toch al mee doet: best-effort met een grijs badge, nooit
// blokkerend -- anders houdt een kapotte sync bij een andere klant van hetzelfde bureau deze PDF
// voor altijd tegen.
//
// Freshness i.p.v. exacte datum-gelijkheid: isSopDue (dezelfde functie als de rest van dit
// bestand) vraagt "is dit kanaal deze cyclus al gedraaid", niet "is de analysis_date letterlijk
// gelijk aan die van de andere kanalen". Met de standaard limit=1-batching van deze cron landen
// verschillende kanalen van dezelfde klant vaak op verschillende dagen -- een exacte match zou
// deze stap dan nooit laten vuren.
async function triggerMonthlyPdfIfComplete(
  supabase: SupabaseClient,
  origin: string,
  clientId: string,
  kanalen: readonly Kanaal[],
): Promise<void> {
  // Geen Google, geen rijke maand-PDF-vorm om te renderen -- bestaande beperking van de PDF-
  // route zelf (zie het kopcommentaar van app/api/analysis/pdf/route.ts), niet iets wat deze
  // functie oplost of moet omzeilen.
  if (!kanalen.includes("google")) return;

  const now = new Date();
  for (const kanaal of kanalen) {
    const channel = KANAAL_NAAR_SOPCHANNEL[kanaal];
    const sopTypeKey = CHANNEL_CONFIG[channel].sopTypeKey.monthly;
    const { data } = await supabase
      .from("sop_analysis_output")
      .select("analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", sopTypeKey)
      .order("analysis_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastRunDate = (data as { analysis_date?: string } | null)?.analysis_date ?? null;
    if (isSopDue("monthly", lastRunDate, now)) return; // dit kanaal is nog niet klaar deze cyclus
  }

  if (kanalen.length > 1) {
    const { data } = await supabase
      .from("sop_analysis_output")
      .select("analysis_date")
      .eq("client_id", clientId)
      .eq("sop_type", "cross_channel")
      .eq("section", "cross_channel_synthesis_v1")
      .order("analysis_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSynthDate = (data as { analysis_date?: string } | null)?.analysis_date ?? null;
    if (isSopDue("monthly", lastSynthDate, now)) return; // synthese nog niet klaar deze cyclus
  }

  // Alles binnen. De bestandsnaam die de PDF-route zelf kiest (SOP-Maandelijks-<analysis_date>)
  // is de dedupsleutel -- al gegenereerd deze cyclus? Dan niets doen, geen tweede upload.
  const { data: googleRow } = await supabase
    .from("sop_analysis_output")
    .select("analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", "monthly")
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const analysisDate = (googleRow as { analysis_date?: string } | null)?.analysis_date;
  if (!analysisDate) return;

  // .limit(1) i.p.v. .maybeSingle(): een handmatige herdownload (dezelfde knop, dezelfde dag)
  // maakt vandaag al een tweede rij met exact dezelfde bestandsnaam aan (upsert:true geldt alleen
  // voor de storage-upload, niet voor deze insert) -- .maybeSingle() faalt dan stil op "meerdere
  // rijen" en levert data:null, waardoor deze check "geen bestaand bestand" concludeert en gewoon
  // een derde uploadt. Ontdekt tijdens het testen van deze functie zelf (20 augustus 2026).
  const { data: bestaandeFiles } = await supabase
    .from("client_files")
    .select("id")
    .eq("client_id", clientId)
    .eq("folder", "SOP's")
    .eq("file_name", `SOP-Maandelijks-${analysisDate}.pdf`)
    .limit(1);
  if (bestaandeFiles && bestaandeFiles.length > 0) return;

  const res = await fetch(
    `${origin}/api/analysis/pdf?${new URLSearchParams({ client_id: clientId, sop_type: "monthly" })}`
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `pdf-generatie gaf ${res.status}`);
  }
  console.log(`[trigger-sops] maand-PDF gegenereerd voor ${clientId} (${analysisDate})`);
}

// Draait exact wat de handmatige knop doet (runSop in sop-trigger-buttons.tsx): het endpoint
// aanroepen, de executive-summary/output tot markdown maken, en die naar Bestanden > SOP's
// schrijven. Geeft de analysisDate terug voor het resultaatoverzicht.
async function voerSopUit(
  supabase: SupabaseClient,
  origin: string,
  clientId: string,
  channel: SopChannel,
  cadence: SopType,
): Promise<string> {
  const endpoint = `${origin}/api/analysis/${cadence}`;
  const jobId = crypto.randomUUID();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, job_id: jobId, channel }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${endpoint} gaf ${res.status}`);

  const analysisDate: string = data.analysisDate || today();
  const period = cadence === "monthly" ? data.period : { start: data.periodStart, end: data.periodEnd };
  const cadenceLabel = cadence === "monthly" ? "Maandelijkse" : cadence === "weekly" ? "Wekelijkse" : "Tweewekelijkse";
  const typeLabel = `${cadenceLabel} ${CHANNEL_CONFIG[channel].headerLabel}`;
  const header = `# ${typeLabel} Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${period?.start} t/m ${period?.end}\n**Model:** ${data.model}\n\n---\n\n`;
  const markdown = header + (data.fullOutput || data.output || "Geen output");

  const sopTypeKey = CHANNEL_CONFIG[channel].sopTypeKey[cadence];
  const fileName = `${analysisDate}-${sopTypeKey}-analyse.md`;
  const storagePath = `${clientId}/SOP's/${Date.now()}-${fileName}`;

  const { error: storageErr } = await supabase.storage
    .from("client-files")
    .upload(storagePath, markdown, { contentType: "text/markdown" });
  if (storageErr) throw new Error(`upload mislukt: ${storageErr.message}`);

  const { error: insertErr } = await supabase.from("client_files").insert({
    client_id: clientId,
    folder: "SOP's",
    file_name: fileName,
    file_size: Buffer.byteLength(markdown, "utf8"),
    content_type: "text/markdown",
    storage_path: storagePath,
  });
  if (insertErr) throw new Error(`client_files-rij mislukt: ${insertErr.message}`);

  return analysisDate;
}
