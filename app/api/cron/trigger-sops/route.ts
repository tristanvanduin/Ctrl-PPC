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
// een aparte, bewuste stap; de regel en het tijdstip staan onder AANZETTEN hieronder.
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
// ── TIJD ────────────────────────────────────────────────────────────────────
//
// Deze route WACHT op /api/analysis/{weekly,biweekly,monthly} (de uitvoer is nodig voor de upload),
// en die routes hebben maxDuration 600. Gemeten in generation_jobs, afgeronde runs vanaf 1 augustus
// 2026 (completed_at - started_at):
//
//   biweekly_sop    14 runs, 4 boven 300 s, p90 410 s, max 508 s
//   monthly_sop     21 runs, 2 boven 300 s, p90 295 s, max 390 s
//   weekly_sop      16 runs, 1 boven 300 s, p90 148 s, max 303 s
//   pdf_generation  80 runs, max 9 s
//
// Dat zijn knop- en testruns: deze cron is nooit gepland geweest (triggered_by was op alle rijen
// leeg). Dat de cron bij 7 van die 51 runs zou afbreken is dus een VERWACHTING, geen waarneming.
// Er waren twee grenzen die hem zouden laten afbreken, niet een:
//
//   1. De maxDuration van deze route (300). Een wachtende aanroeper moet minstens zo lang mogen
//      leven als wat hij aanroept (600 + upload).
//   2. De headers-timeout van fetch. De globale fetch van Node (undici) geeft het na 300 s zonder
//      headers op, en de analyse-routes sturen pas aan het eind headers. Daar helpt geen maxDuration
//      en geen AbortSignal.timeout tegen: met alleen een hogere maxDuration faalde de aanroep nog
//      steeds na 300 s, als "failed", zonder upload, cross-channel of PDF-check.
//
// Gekozen, als het eenvoudigste dat werkt:
//
//   (a) maxDuration 800, het maximum van Vercel Pro met Fluid Compute. Het plan staat niet in de repo
//       zelf; wat er wel staat: de analyse-routes zeggen "sinds de upgrade naar Vercel Pro", en
//       /api/sync/cron draait al elke nacht met maxDuration 600 uit vercel.json -- op Hobby (max 300)
//       wordt zo'n deploy geweigerd. Klopt dat toch niet, dan faalt de deploy hardop op deze 800,
//       niet stil in de nacht.
//   (b) wachten zonder fetch: alle aanroepen hieruit gaan via interneAanroep
//       (lib/scheduler/interne-aanroep.ts, node:http zonder headers- of bodytimeout, met een eigen
//       harde deadline). Waarom niet undici als dependency, streamende analyse-routes of een cron
//       die niet wacht: zie de kop van dat bestand.
//   (c) een tijdbudget (lib/scheduler/sop-tijdbudget.ts): een analyse start alleen als zijn volle
//       maxDuration plus de upload in het restant van deze invocatie past; een vervolgstap krijgt
//       het restant als timeout en wordt anders uitgesteld. Zo komt er altijd een JSON-overzicht.
//   (d) meer tijdstippen in plaats van meer per invocatie: vier per nacht, elk met `limit` 1,
//       ongeacht de cadans. Per cadans een eigen tijdstip geeft elke cadans maar een slot per nacht,
//       ook als er van die cadans vier kanalen due zijn en van de andere niets.
//
// after() is hier geen oplossing: volgens node_modules/next/dist/docs/01-app/03-api-reference/
// 04-functions/after.md loopt after() binnen de maxDuration van dezelfde route; het maakt alleen het
// antwoord eerder, en Vercel Cron leest dat antwoord niet. De dure vervolgstap, de synthese, start
// de maandroute zelf al in zijn after().
//
// `limit` (default 1) begrenst hoeveel due items een invocatie draait; het tijdbudget begrenst
// daarnaast. Met 800 s past na een analyse alleen een tweede als de eerste binnen ~155 s klaar was.
// Items die due zijn maar niet pasten komen terug als "due_deferred" met een `uitstelreden`
// ("limiet" of "tijd") -- niet stilzwijgend overgeslagen -- en de volgende invocatie pakt ze op.
// Een cross-channel die door tijdgebrek niet startte (`vervolg_uitgesteld`) wordt NIET vanzelf
// ingehaald: hij hangt aan de maandrun van deze invocatie. Met 800 s blijft er na de traagste
// analyse (600 + upload) ruim 150 s over voor een deterministische stap, dus dat is theorie. De
// beslissing per item staat in verwerkDueItem (lib/scheduler/sop-cron-stappen.ts), getoetst met
// een nepklok in lib/scheduler/__sop_cron_stappen_test.ts.
//
// ── AANZETTEN ───────────────────────────────────────────────────────────────
//
// Nog NIET gepland (besluit eigenaar). Aanzetten is deze regel in "crons" van vercel.json:
//
//   { "path": "/api/cron/trigger-sops", "schedule": "20 5-8 * * *" }
//
// Dat is 05:20, 06:20, 07:20 en 08:20 UTC (06:20-09:20 in de winter in Nederland): na de dagsync
// van 05:00 (/api/sync/cron, maxDuration 600, dus om 05:10 klaar), zodat een analyse de cijfers
// van gisteren ziet; vier invocaties van hooguit 800 s die elkaar niet overlappen. Meer dan een
// cron per dag kan alleen op Pro.
//
// Volume, in de stand van 14 november 2026: 8 klanten hebben sops_enabled, samen 11 kanalen met
// een eerdere run (demo-greentech 4, de rest 1). Gemiddeld is dat per week 11 weeklies, 5,5
// biweeklies en ruim 2,5 maandanalyses: ~19 runs, ~2,7 per nacht, tegen een capaciteit van 4. Maar
// het gemiddelde verbergt twee pieken, nagerekend met isSopDue en de volgorde van deze lus (klant,
// kanaal, weekly-biweekly-monthly), voor die 11 kanalen:
//
//   - Bij het aanzetten is alles due: de laatste runs zijn van augustus en september, dus 11
//     kanalen keer 3 cadansen is 33 items. Met 4 per nacht is die achterstand na 9 nachten weg; de
//     laatste maandanalyse komt in de 9e nacht.
//   - Op de 1e van elke maand worden alle 11 maandanalyses tegelijk due (isMonthlyDue kijkt naar de
//     kalendermaand), met de weeklies en biweeklies ertussendoor. De laatste maandanalyse komt dan
//     op de 7e tot 9e van de maand, en de maand-PDF van een klant met meer kanalen pas daarna.
//
// Wie de maandronde eerder wil: verbreed het venster (bijvoorbeeld "20 5-10 * * *", zes per nacht)
// in plaats van `limit` te verhogen; het tijdbudget laat een tweede analyse in dezelfde invocatie
// toch zelden toe. Hetzelfde geldt als er klanten of kanalen bijkomen en due_deferred met
// uitstelreden "limiet" blijft groeien.
//
// Kosten per nacht, geschat uit llm_usage.cost_eur sinds 1 augustus 2026 (per run_key opgeteld):
// een maandanalyse gemiddeld 0,14 euro voor Google (33 runs, hoogste 0,22) en 0,05-0,10 voor de
// andere kanalen; een weekly 0,08-0,16 en een biweekly 0,08-0,21. Die laatste twee rusten op een
// kleine en onvolledige steekproef: 2 tot 4 runs per kanaal, en 9 weekly-run_keys tegenover 16
// afgeronde weekly-jobs -- niet elke run logt in llm_usage. Met vier runs per nacht is het plafond
// ongeveer 0,90 euro per nacht (zo in de eerste 9 nachten en in de eerste week van elke maand);
// gemiddeld ~0,12 euro per run maakt ~0,33 euro per nacht, ~2,30 per week. Niet in die schatting:
// de kanaaloverstijgende synthese (staat niet in llm_usage) en herhaalpogingen -- een item dat
// mislukt, blijft due en wordt de volgende invocatie opnieuw geprobeerd, tot vier keer per nacht.
// Het uitgavenplafond (LLM_MAAND_PLAFOND_EUR, lib/analysis/uitgavenplafond.ts) geldt ook voor deze
// runs.
//
// Wie wat startte staat in generation_jobs.triggered_by: "cron" voor runs uit deze route (herkend
// aan het CRON_SECRET samen met de vlag automatisch, lib/progress/gestart-door.ts), anders
// "handmatig". scripts/check-analyse-slagingen.mjs toont per cadans hoeveel van elk.
//
// ── HANDMATIG TESTEN ─────────────────────────────────────────────────────────
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://.../api/cron/trigger-sops?dry_run=true&client_id=<clientId>"
//
// dry_run=true evalueert alles (welke combinaties due zijn) zonder ook maar één analyse te
// starten -- de veilige manier om te zien wat er zou gebeuren voordat er echt iets draait, en
// zonder kosten (geen LLM-aanroep, geen self-fetch).
//
// Zonder dry_run start zo'n curl een echte run, en die telt in generation_jobs.triggered_by als
// "cron": hij draait precies het geplande pad, met het geheim en de vlag automatisch. Wie het
// onderscheid tussen nacht en testen zoekt, kijkt dan naar het tijdstip.

import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { laadBeschikbareKanalen, ALLE_KANALEN, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHANNEL_CONFIG, ALLE_SOP_TYPES, type SopChannel, type SopType } from "@/lib/analysis/sop-channel-config";
import { isSopDue, AFRONDINGS_SECTIE, type SopCadence } from "@/lib/scheduler/sop-cadence";
import { ruimVastgelopenRunsOp } from "@/lib/scheduler/vastgelopen-runs";
import { maakTijdbudget, vervolgTimeoutMs, type Tijdbudget } from "@/lib/scheduler/sop-tijdbudget";
import {
  interneHeaders, triggerCrossChannel, triggerCrossChannelSynthesis, verwerkDueItem, voerSopUit, type Vervolgstap,
} from "@/lib/scheduler/sop-cron-stappen";
import { interneAanroep } from "@/lib/scheduler/interne-aanroep";
import type { SupabaseClient } from "@supabase/supabase-js";

// 800 s: het maximum van Vercel Pro met Fluid Compute. Moet een letterlijk getal zijn (Next leest de
// route-config statisch uit). Waarom 800 en niet 300: zie "TIJD" in de kop hierboven en
// lib/scheduler/sop-tijdbudget.ts -- deze route wacht op een analyse-route met maxDuration 600.
export const maxDuration = 800;

const DEFAULT_LIMIT = 1;

// lib/kanalen/beschikbaar.ts's Kanaal ("google"|"meta"|"linkedin", client-facing/data-gedreven)
// naar de SopChannel-vorm die de analyse-routes verwachten ("google_ads"|"meta_ads"|"linkedin_ads").
const KANAAL_NAAR_SOPCHANNEL: Record<Kanaal, SopChannel> = {
  google: "google_ads",
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

interface Uitkomst {
  clientId: string;
  /** Ontbreekt alleen bij status "sops_disabled": die beslissing geldt per klant, niet per
   *  kanaal/cadans, dus is er nog geen kanaal-combinatie geevalueerd om te noemen. */
  channel?: SopChannel;
  cadence?: SopType;
  status: "triggered" | "failed" | "not_due" | "due_deferred" | "due_dry_run" | "sops_disabled" | "tijd_op";
  /** Bij due_deferred: de batch was vol (limit) of de tijd dekte geen volledige analyse meer. */
  uitstelreden?: "limiet" | "tijd";
  lastRunDate?: string | null;
  analysisDate?: string;
  error?: string;
}

interface AccountRij {
  client_id: string;
  agency_id: string | null;
}

export async function GET(request: NextRequest) {
  // Als eerste: de klok loopt vanaf het begin van de invocatie, niet vanaf de eerste analyse.
  const budget = maakTijdbudget(maxDuration, Date.now());
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

  // Eerst wat vastgelopen is afsluiten (zie lib/scheduler/vastgelopen-runs.ts). Niet bij een
  // proefrun: dry_run schrijft niets.
  const vastgelopen = dryRun ? 0 : await ruimVastgelopenRunsOp(supabase, clientFilter ? { clientId: clientFilter } : {});

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
  // Vervolgstappen die niet meer in deze invocatie pasten. Geen fout: zie lib/scheduler/sop-tijdbudget.ts.
  const vervolgUitgesteld: string[] = [];

  for (const clientId of klanten) {
    // Ook het beoordelen kost tijd (een handvol queries per kanaal en cadans). Is de tijd op, dan
    // zegt het overzicht dat per klant, in plaats van dat het platform de functie halverwege afbreekt
    // en er helemaal geen overzicht komt.
    if (vervolgTimeoutMs(budget, Date.now()) === null) {
      resultaten.push({ clientId, status: "tijd_op" });
      continue;
    }
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
        // Alleen het afrondingsteken telt (section "full"): runStep schrijft elke stap direct weg,
        // dus de nieuwste analysis_date van een willekeurige sectie maakte een run die na stap 1
        // crashte tot "gedraaid", en de herkansing schoof 7 of 14 dagen of een maand op. "full"
        // komt bij weekly en biweekly pas na opgeslagen bevindingen (lib/analysis/run-afronding.ts)
        // en bij de monthly pas na een geslaagde kwaliteitspoort.
        const { data: laatsteRij } = await supabase
          .from("sop_analysis_output")
          .select("analysis_date")
          .eq("client_id", clientId)
          .eq("sop_type", sopTypeKey)
          .eq("section", AFRONDINGS_SECTIE)
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
        // Cross-channel hoort bij elke maandanalyse (masterplan 16.4: "cross channel moet de
        // basis zijn in de maandanalyse"), niet alleen bij een handmatige klik op de losse knop
        // (components/dashboard/cross-channel-analyses.tsx). Alleen zinvol vanaf 2 kanalen
        // (masterplan 16.6) -- met 1 kanaal is er niets om te kruisen; de route zelf gate't dit ook
        // (defense-in-depth), maar hier voorkomt het al een nutteloze aanroep + de bijbehorende
        // foutlog. verwerkDueItem vraagt dit pas op na een gelukte analyse.
        const vervolgstappen = (): Vervolgstap[] => {
          if (cadence !== "monthly" || kanalen.length <= 1 || crossChannelGedaan.has(clientId)) return [];
          crossChannelGedaan.add(clientId);
          return [
            { naam: `cross-channel ${clientId}`, stap: (ms) => triggerCrossChannel(origin, clientId, ms) },
            // Uitgesteld is hier geen verlies: de maandroute start de synthese zelf in zijn after().
            { naam: `cross-channel-synthese ${clientId}`, stap: (ms) => triggerCrossChannelSynthesis(origin, clientId, ms) },
          ];
        };
        const { uitkomst, vervolgUitgesteld: uitgesteld } = await verwerkDueItem({
          item: { clientId, channel, cadence, lastRunDate },
          getriggerd, limit, budget,
          nu: Date.now,
          voerUit: (timeoutMs) => voerSopUit(supabase, origin, clientId, channel, cadence, timeoutMs),
          vervolgstappen,
        });
        resultaten.push(uitkomst);
        if (uitkomst.status === "triggered") getriggerd += 1;
        vervolgUitgesteld.push(...uitgesteld);
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
      // Uitgesteld is hier geen verlies: de check leest de stand in de database, dus de volgende
      // invocatie pakt hem op.
      if (vervolgTimeoutMs(budget, Date.now()) === null) vervolgUitgesteld.push(`pdf ${clientId}`);
      else {
        await triggerMonthlyPdfIfComplete(supabase, origin, clientId, kanalen, budget).catch((err) => {
          console.error(`[trigger-sops] PDF-gereedheidscheck voor ${clientId} mislukt:`, err);
        });
      }
    }
  }

  return Response.json({
    dry_run: dryRun,
    limit,
    aantal_klanten: klanten.length,
    getriggerd,
    vastgelopen_afgesloten: vastgelopen,
    vervolg_uitgesteld: vervolgUitgesteld,
    seconden: Math.round((Date.now() - budget.startMs) / 1000),
    resultaten,
  });
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
  budget: Tijdbudget,
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
      .eq("section", AFRONDINGS_SECTIE) // een halve maandrun is niet "klaar deze cyclus"
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

  // De timeout pas hier: de queries hierboven kosten ook tijd.
  const timeoutMs = vervolgTimeoutMs(budget, Date.now());
  if (timeoutMs === null) throw new Error("geen tijd meer in deze invocatie; de volgende pakt de PDF op");
  // automatisch=1: samen met het CRON_SECRET telt de PDF-job dan als gepland
  // (generation_jobs.triggered_by, lib/progress/gestart-door.ts).
  const res = await interneAanroep(
    `${origin}/api/analysis/pdf?${new URLSearchParams({ client_id: clientId, sop_type: "monthly", automatisch: "1" })}`,
    { headers: interneHeaders(), timeoutMs }
  );
  if (!res.ok) {
    throw new Error(typeof res.data.error === "string" && res.data.error ? res.data.error : `pdf-generatie gaf ${res.status}`);
  }
  console.log(`[trigger-sops] maand-PDF gegenereerd voor ${clientId} (${analysisDate})`);
}

