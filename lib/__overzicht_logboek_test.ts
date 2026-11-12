// Het logboek "Wat er gebeurde" en het ijkpunt "sinds je vorige bezoek" (bouwplan fase 4).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_logboek_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Een logboek is het soort blok dat ongemerkt gaat liegen. Het kan "zojuist" zeggen over iets van
// vijftig minuten oud, "hersteld" over een storing die het nooit gezien heeft, "niets gebeurd"
// terwijl de tabel niet te lezen was, of elke nachtelijke sync als nieuws brengen tot niemand het
// meer leest. En het ijkpunt kan zichzelf wissen bij een herlaad. Deze test houdt vast:
//
// - DE TIJD: "zojuist" alleen binnen vijf minuten; daarna een maat, in Amsterdamse tijd.
// - DE SYNCS: per kanaal de laatste run plus elke wissel tussen slagen en mislukken, niet elke run.
// - DE BRONNEN: alleen wat er staat (meldingen, runs, jobs, voorstellen, hypothesen, notities), met
//   een open Code Rood die blijft staan en een maximum aan voorstellen.
// - DE LEZER: één aanroep leest alles, schrijft niets, en een bron die niet te lezen is houdt de
//   rest niet tegen maar wordt bij naam genoemd.
// - HET FILTER: een kanaalwissel is filteren op dezelfde lijst; er komt geen verzoek aan te pas.
// - HET IJKPUNT: een herlaad binnen het bezoek wist de markering niet; pas na een pauze schuift het
//   op, naar het einde van het vorige bezoek.
// - DE DEMO: voorbeelden die met de klok meelopen, per stuk gemarkeerd, nooit in de toekomst.
// - DE TOEGANG: de route leest precies het klant-id dat getoetst is. Twee id's in één verzoek
//   (?client_id=eigen&clientId=ander) is een weigering, geen logboek van de ander.
// - DE KLOK: "zojuist" loopt mee op een scherm dat open blijft staan, en staat stil op een verborgen
//   tabblad.
// - DE SCHAKELAAR: het logboek zit in de nieuwe bovenkant en nergens anders; de migratie voor
//   klant_bezoeken is klaargezet en op niets aangesloten.
//
// Alles met een vaste klok (een `nu` als argument); nergens wordt op een tijdsduur gewacht.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "./decision/__fake_supabase";
import {
  LOGBOEK_DAGEN, LOGBOEK_MAX, VOORSTELLEN_MAX, ZOJUIST_BINNEN_MS,
  codeRoodItems, demoVoorbeelden, geledenLabel, hypotheseItems, jobItems, legeStaat, notitieItems, sorteerLogboek,
  syncItems, syncUitkomst, tijdLabel, voorKanaal, voorstelItems,
  type Logboek, type LogboekItem, type SyncRun,
} from "./overzicht/logboek";
import { leesLogboek } from "./overzicht/logboek-lezer";
import { laadLogboek } from "./overzicht/use-logboek";
import { MINUUT_MS, startMinuutklok } from "./overzicht/use-minuutklok";
import { canAccessClient, clientIdFromPath, clientIdsUitVerzoek } from "./auth/roles";
import { BEZOEK_VOORBIJ_NA_MS, bezoekSleutel, isNieuwSinds, leesBezoek, openBezoek, sluitBezoek } from "./overzicht/bezoek";
import { PeriodProvider } from "./period/period-context";
import { LogboekKaart, LOGBOEK_ZICHTBAAR, nieuwTekst } from "../components/dashboard/overzicht-logboek";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const wortel = join(import.meta.dirname, "..");
const lees = (pad: string) => readFileSync(join(wortel, pad), "utf8");
const zonderCommentaar = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const platteTekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// De vaste klok van deze test: donderdag 12 november 2026, 11:00 in Amsterdam (wintertijd).
const NU = new Date("2026-11-12T10:00:00Z");
const VANAF = new Date(NU.getTime() - LOGBOEK_DAGEN * 86_400_000).toISOString();
const terug = (min: number) => new Date(NU.getTime() - min * 60_000).toISOString();
const dagenTerug = (d: number, uurUtc = 5) => new Date(Date.UTC(2026, 10, 12 - d, uurUtc, 44)).toISOString();

async function main() {
  console.log("De tijd op een regel: 'zojuist' alleen als het net gebeurde");
  {
    check("twee minuten geleden: zojuist", tijdLabel(terug(2), NU) === "zojuist", tijdLabel(terug(2), NU));
    check("net binnen de grens: zojuist", tijdLabel(new Date(NU.getTime() - ZOJUIST_BINNEN_MS + 1000).toISOString(), NU) === "zojuist");
    check("op de grens: niet meer zojuist", tijdLabel(new Date(NU.getTime() - ZOJUIST_BINNEN_MS).toISOString(), NU) === "5 min geleden", tijdLabel(new Date(NU.getTime() - ZOJUIST_BINNEN_MS).toISOString(), NU));
    check("veertig minuten geleden: een maat, geen zojuist", tijdLabel(terug(40), NU) === "40 min geleden", tijdLabel(terug(40), NU));
    check("vanochtend: vandaag met de Amsterdamse tijd", tijdLabel("2026-11-12T05:44:00Z", NU) === "vandaag 06:44", tijdLabel("2026-11-12T05:44:00Z", NU));
    check("gisteren: met de tijd", tijdLabel("2026-11-11T15:20:00Z", NU) === "gisteren 16:20", tijdLabel("2026-11-11T15:20:00Z", NU));
    check("eerder dit jaar: de datum zonder jaar", tijdLabel("2026-11-10T08:15:00Z", NU) === "10 nov 09:15", tijdLabel("2026-11-10T08:15:00Z", NU));
    check("een ander jaar: met het jaar", tijdLabel("2025-12-30T10:00:00Z", NU) === "30 dec 2025 11:00", tijdLabel("2025-12-30T10:00:00Z", NU));
    // 00:30 in Amsterdam is in UTC nog de vorige dag: "gisteren" volgt de Amsterdamse kalender.
    const naMiddernacht = new Date("2026-11-11T23:30:00Z");
    check("na middernacht in Amsterdam is 23:00 gisteren", tijdLabel("2026-11-11T22:00:00Z", naMiddernacht) === "gisteren 23:00", tijdLabel("2026-11-11T22:00:00Z", naMiddernacht));
    check("een tijdstip in de toekomst is nooit zojuist", !tijdLabel(new Date(NU.getTime() + 60_000).toISOString(), NU).includes("zojuist"));
    check("zonder tijdstip: een streepje", tijdLabel(null, NU) === "—" && tijdLabel("geen datum", NU) === "—");

    check("de badge: vijftig minuten is geen zojuist", geledenLabel(terug(50), NU) === "50 min geleden", String(geledenLabel(terug(50), NU)));
    check("de badge: drie minuten is zojuist", geledenLabel(terug(3), NU) === "zojuist");
    check("de badge: uren en dagen", geledenLabel(terug(3 * 60 + 10), NU) === "3u geleden" && geledenLabel(terug(50 * 60), NU) === "2d geleden");
    check("de badge: zonder tijdstip geen tekst", geledenLabel(null, NU) === null);
  }

  console.log("\nSyncs: de laatste run en elke wissel, niet elke nacht een regel");
  {
    const run = (dag: number, uitkomst: SyncRun["uitkomst"], extra: Partial<SyncRun> = {}): SyncRun =>
      ({ id: `r${dag}`, tijd: dagenTerug(dag), uitkomst, rijen: 1200, fout: null, ...extra });

    const elkeNacht = Array.from({ length: 20 }, (_, i) => run(i, "geslaagd", { gevraagdTot: "2026-11-11" }));
    const rustig = syncItems("google", elkeNacht);
    check("twintig geslaagde nachten: één regel", rustig.length === 1, String(rustig.length));
    check("... over de laatste run", rustig[0]?.id === "sync:google:r0" && rustig[0].soort === "sync", rustig[0]?.id);
    // date_range_end is het venster dat de run opvroeg, niet de dag tot waar er data staat: een
    // geslaagde run zonder nieuwe rijen heeft hetzelfde venster. De titel beweert dus geen datastand.
    check("... die zegt dat de sync slaagde, zonder een datastand te beweren", rustig[0]?.titel === "Google Ads-sync geslaagd" && !/t\/m|bijgewerkt/.test(rustig[0].titel), rustig[0]?.titel);
    check("... het opgevraagde venster staat in de onderbouwing, als wat het is", rustig[0]?.detail.some((d) => d.includes("vroeg data op t/m 11 nov") && d.includes("bronrij")) === true, rustig[0]?.detail.join(" | "));
    check("... en zonder venster (de dagkanalen) staat er geen dag", syncItems("meta", [run(0, "geslaagd")])[0]?.detail.every((d) => !d.includes("t/m")) === true);
    check("... en hoe vaak op rij", rustig[0]?.detail.some((d) => d.includes("20 keer op rij")) === true);

    const stil = syncItems("google", Array.from({ length: 23 }, (_, i) => run(i, "mislukt", { fout: "geen credentials", rijen: 0 })));
    check("drieëntwintig mislukte nachten: één regel", stil.length === 1, String(stil.length));
    check("... met het aantal en de reden", stil[0]?.chip === "23 keer" && stil[0].detail[0].includes("geen credentials"), `${stil[0]?.chip} ${stil[0]?.detail[0]}`);
    check("... als alarm, en eerlijk over het venster", stil[0]?.toon === "alarm" && stil[0].detail.some((d) => d.includes("geen geslaagde sync")));

    // Vijf nachten goed, drie mislukt, twee weer goed (dag 9 is het oudst).
    const wissel = syncItems("meta", [
      ...[9, 8, 7, 6, 5].map((d) => run(d, "geslaagd")),
      ...[4, 3, 2].map((d) => run(d, "mislukt", { fout: "token verlopen" })),
      ...[1, 0].map((d) => run(d, "geslaagd")),
    ]);
    const mislukt = wissel.find((i) => i.id === "datastand:meta:r4"), hersteld = wissel.find((i) => i.id === "datastand:meta:r1");
    check("de overgang naar mislukt is een regel", mislukt?.titel === "Meta-sync mislukt" && mislukt.chip === "3 keer", `${mislukt?.titel} ${mislukt?.chip}`);
    check("... met de reden en wat eraan voorafging", !!mislukt && mislukt.detail[0].includes("token verlopen") && mislukt.detail.some((d) => d.includes("5 keer op rij")));
    check("de overgang terug is een regel", hersteld?.titel === "Meta-sync slaagt weer" && hersteld.toon === "goed", hersteld?.titel);
    check("... die zegt na hoeveel pogingen", hersteld?.detail[0].includes("3 mislukte pogingen") === true, hersteld?.detail[0]);
    check("de laatste run staat er ook bij", wissel.some((i) => i.id === "sync:meta:r0"));
    check("drie regels, niet tien", wissel.length === 3, String(wissel.length));

    const nogStuk = syncItems("linkedin", [run(3, "geslaagd"), run(2, "mislukt"), run(1, "mislukt"), run(0, "mislukt")]);
    check("een storing die nog loopt: één regel, niet twee", nogStuk.length === 1 && nogStuk[0].id === "datastand:linkedin:r2", nogStuk.map((i) => i.id).join(","));

    check("één geslaagde run is geen 'hersteld'", syncItems("microsoft", [run(0, "geslaagd")]).every((i) => i.soort === "sync"));
    check("een run die nog loopt is geen gebeurtenis", syncItems("google", [run(0, "loopt")]).length === 0);
    check("geen runs: geen regels", syncItems("google", []).length === 0);
    check("een deels geslaagde run zegt dat", syncItems("google", [run(0, "deels", { fout: "2 van de 14 datasets mislukt" })])[0]?.chip === "deels"
      && syncItems("google", [run(0, "deels")])[0]?.titel === "Google Ads-sync deels geslaagd");

    check("de statuskolommen van de vier tabellen", syncUitkomst("success") === "geslaagd" && syncUitkomst("completed") === "geslaagd"
      && syncUitkomst("partial") === "deels" && syncUitkomst("running") === "loopt" && syncUitkomst("failed") === "mislukt" && syncUitkomst(null) === "mislukt");
  }

  console.log("\nDe andere bronnen: alleen wat er werkelijk staat");
  {
    const code = codeRoodItems([
      { id: "a", licht: "rood", redenen: ["CPA 80% boven doel", "geen contact in 30 dagen"], gedetecteerd_op: "2026-08-01T08:00:00Z", status: "open" },
      { id: "b", licht: "amber", redenen: [], gedetecteerd_op: "2026-08-01T08:00:00Z", status: "afgewezen" },
      { id: "c", licht: "amber", redenen: ["budget loopt 20% achter"], gedetecteerd_op: dagenTerug(3), status: "opgelost" },
    ], VANAF);
    check("een open Code Rood blijft staan, ook buiten het venster", code.some((i) => i.id === "code-rood:a" && i.toon === "alarm"));
    check("... met zijn redenen als onderbouwing", code.find((i) => i.id === "code-rood:a")?.detail.join("|") === "CPA 80% boven doel|geen contact in 30 dagen");
    check("een afgehandelde melding van maanden terug niet", !code.some((i) => i.id === "code-rood:b"));
    check("een opgeloste melding binnen het venster wel, zonder alarm", code.find((i) => i.id === "code-rood:c")?.toon === "neutraal");

    const jobs = jobItems([
      { job_id: "j1", job_type: "monthly_sop", status: "completed", channel: "meta", completed_at: dagenTerug(1), period_start: "2026-10-01", period_end: "2026-10-31" },
      { job_id: "j2", job_type: "biweekly_sop", status: "failed", updated_at: dagenTerug(2), error_message: "OpenRouter-tegoed op" },
      { job_id: "j3", job_type: "pdf_generation", status: "completed", completed_at: dagenTerug(1) },
      { job_id: "j4", job_type: "queue_smoke_test", status: "completed", completed_at: dagenTerug(1) },
      { job_id: "j5", job_type: "weekly_sop", status: "running", updated_at: dagenTerug(0) },
      { job_id: "j6", job_type: "monthly_sop", status: "completed", completed_at: "2026-08-01T08:00:00Z" },
    ], VANAF);
    check("een afgeronde analyse is een regel, met kanaal", jobs.find((i) => i.id === "analyse:j1")?.titel === "Maandanalyse Meta afgerond", jobs.find((i) => i.id === "analyse:j1")?.titel);
    check("... waar je naar Bevindingen kunt", jobs.find((i) => i.id === "analyse:j1")?.beoordeelbaar === true);
    check("een mislukte analyse zegt waarom", jobs.find((i) => i.id === "analyse:j2")?.detail.some((d) => d.includes("OpenRouter-tegoed op")) === true);
    check("... en heeft niets te beoordelen", jobs.find((i) => i.id === "analyse:j2")?.beoordeelbaar === false);
    check("pdf's, rookproeven, lopende en oude jobs zijn geen regel", jobs.length === 2, jobs.map((i) => i.id).join(","));

    const veel = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, hypothesis: `Voorstel ${i}`, ice_total: 5 + i / 10, source: i % 2 ? "meta_biweekly" : "cross_channel", created_at: terug(60 + i), rationale: "omdat", expected_result: "lagere CPA" }));
    const voorstellen = voorstelItems([...veel, { id: "oud", hypothesis: "Oud voorstel", created_at: "2026-08-01T08:00:00Z" }, { id: "leeg", hypothesis: "  ", created_at: terug(5) }], VANAF);
    check("hooguit het maximum aan voorstellen", voorstellen.length === VOORSTELLEN_MAX, String(voorstellen.length));
    check("de nieuwste eerst", voorstellen[0]?.id === "voorstel:v0", voorstellen[0]?.id);
    check("de ICE-score als chip", voorstellen[0]?.chip === "ICE 5", String(voorstellen[0]?.chip));
    check("het kanaal uit de bron; cross-channel raakt de hele klant", voorstellen[0]?.kanaal === null && voorstellen[1]?.kanaal === "meta", `${voorstellen[0]?.kanaal} ${voorstellen[1]?.kanaal}`);
    check("elk voorstel is te beoordelen", voorstellen.every((i) => i.beoordeelbaar));
    check("een oud voorstel of een leeg voorstel is geen regel", !voorstellen.some((i) => i.id === "voorstel:oud" || i.id === "voorstel:leeg"));

    const hyp = hypotheseItems([
      { id: "h1", hypothesis: "Negatives vervangen", result_met: true, learning: "Verspilling daalde 31%", evaluated_at: dagenTerug(2), source: "microsoft_biweekly" },
      { id: "h2", hypothesis: "Frequency cap", result_met: false, learning: "CTR bleef gelijk", evaluated_at: dagenTerug(3), source: "meta_monthly" },
      { id: "h3", hypothesis: "Geen data", result_met: null, evaluated_at: dagenTerug(4) },
      { id: "h4", hypothesis: "Nog niet beoordeeld", evaluated_at: null },
    ], VANAF);
    check("geslaagd, niet geslaagd en geen uitspraak", hyp.map((i) => i.chip).join("|") === "geslaagd|niet geslaagd|geen uitspraak", hyp.map((i) => i.chip).join("|"));
    check("de toelichting van de beoordeling is de onderbouwing", hyp[0]?.detail[0] === "Verspilling daalde 31%" && hyp[0].kanaal === "microsoft");
    check("een hypothese zonder beoordeling is geen regel", hyp.length === 3);

    const notities = notitieItems([
      { id: "n1", title: "Belafspraak", content: "Klant wil in Q1 meer budget naar LinkedIn.", created_at: dagenTerug(1), is_todo: false },
      { id: "n2", title: "", content: "Feed nalopen", created_at: dagenTerug(2), is_todo: true, done: false },
      { id: "n3", title: "Klaar", content: "", created_at: dagenTerug(2), is_todo: true, done: true },
      { id: "n4", title: "Oud", created_at: "2026-08-01T08:00:00Z" },
    ], VANAF);
    check("een notitie met haar tekst als onderbouwing", notities[0]?.soort === "notitie" && notities[0].detail[0].includes("meer budget naar LinkedIn"));
    check("een open to-do vraagt aandacht, een afgevinkte niet", notities[1]?.chip === "open" && notities[1].toon === "let-op" && notities[2]?.chip === "afgevinkt" && notities[2].toon === "neutraal");
    check("zonder titel de tekst als titel", notities[1]?.titel === "Feed nalopen");
    check("een notitie van maanden terug niet", notities.length === 3);
  }

  console.log("\nSorteren, filteren op kanaal, en de lege staat");
  const item = (id: string, tijd: string, kanaal: LogboekItem["kanaal"] = null, extra: Partial<LogboekItem> = {}): LogboekItem =>
    ({ id, soort: "notitie", kanaal, tijd, titel: `Regel ${id}`, chip: null, toon: "neutraal", detail: [`Onderbouwing ${id}`], beoordeelbaar: false, ...extra });
  {
    const gesorteerd = sorteerLogboek([item("b", terug(10)), item("a", terug(10)), item("c", terug(1)), item("stuk", "geen tijd")]);
    check("de nieuwste eerst, gelijke tijd op een vaste volgorde, zonder tijd valt af", gesorteerd.map((i) => i.id).join("") === "cab", gesorteerd.map((i) => i.id).join(""));
    check("nooit meer dan het maximum", sorteerLogboek(Array.from({ length: LOGBOEK_MAX + 15 }, (_, i) => item(`x${i}`, terug(i)))).length === LOGBOEK_MAX);

    const lijst = [item("g", terug(1), "google"), item("m", terug(2), "meta"), item("k", terug(3), null)];
    check("alle kanalen: alles", voorKanaal(lijst, "blended").length === 3);
    check("Meta: Meta plus wat de hele klant raakt", voorKanaal(lijst, "meta").map((i) => i.id).join("") === "mk");
    check("een kanaal zonder regels: alleen wat de hele klant raakt", voorKanaal(lijst, "linkedin").map((i) => i.id).join("") === "k");

    const leeg = legeStaat({ items: [], dagen: 30, wachtOpOordeel: 0, bronnen: [
      { bron: "sync", ok: true, aantal: 0 }, { bron: "analyses", ok: true, aantal: 0 }, { bron: "notities", ok: true, aantal: 0 },
    ] });
    check("leeg zegt per bron wat er niet gebeurde", leeg.includes("geen sync gedraaid") && leeg.includes("geen analyse of rapport afgerond") && leeg.includes("geen notitie of to-do geschreven"), leeg);
    check("... en over welk venster", leeg.includes("laatste 30 dagen"));
    const stuk = legeStaat({ items: [], dagen: 30, wachtOpOordeel: 2, bronnen: [{ bron: "sync", ok: true, aantal: 0 }, { bron: "code-rood", ok: false, aantal: 0, fout: "relation does not exist" }] });
    check("een bron die niet te lezen was heet zo, en is geen 'niets gebeurd'", stuk.includes("Niet te lezen: de meldingen") && !stuk.includes("geen Code Rood"), stuk);
    check("... en oudere voorstellen die wachten worden genoemd", stuk.includes("2 oudere voorstellen"), stuk);
    check("op een kanaal zegt de lege staat welk kanaal", legeStaat({ items: [], dagen: 30, wachtOpOordeel: 0, bronnen: [{ bron: "sync", ok: true, aantal: 0 }] }, "meta").includes("voor Meta"));

    // Meta gekozen, en alleen Google heeft iets: een sync en een voorstel van gisteren. De telling
    // op de bron (aantal: 1) gaat over alle kanalen; de zin hoort over Meta te gaan.
    const alleenGoogle = {
      items: [item("sync:google:g0", terug(60), "google", { soort: "sync" }), item("voorstel:v1", terug(90), "google", { soort: "voorstel" })],
      dagen: 30, wachtOpOordeel: 1,
      bronnen: [{ bron: "sync" as const, ok: true, aantal: 1 }, { bron: "voorstellen" as const, ok: true, aantal: 1 }, { bron: "notities" as const, ok: true, aantal: 0 }],
    };
    const opMeta = legeStaat(alleenGoogle, "meta");
    check("een sync van een ander kanaal telt niet: voor Meta draaide er geen", opMeta.includes("voor Meta") && opMeta.includes("geen sync gedraaid") && opMeta.includes("geen nieuw voorstel"), opMeta);
    check("... en een voorstel dat door het filter verborgen is heet niet 'ouder'", !/ouder/.test(opMeta) && opMeta.includes("Over alle kanalen wacht er 1 voorstel"), opMeta);
    const opAlles = legeStaat({ ...alleenGoogle, items: [] }, "blended");
    check("op Alle kanalen is een voorstel dat wacht en niet in de lijst staat wel ouder", opAlles.includes("1 ouder voorstel"), opAlles);
    const metNotitie = legeStaat({ ...alleenGoogle, items: [...alleenGoogle.items, item("notitie:n", terug(5), null)] }, "meta");
    check("een bron die bij deze keuze wel een regel heeft, wordt niet als leeg genoemd", !metNotitie.includes("geen notitie") && metNotitie.includes("geen sync gedraaid"), metNotitie);
  }

  console.log("\nDe lezer: één aanroep, alleen lezen, en een kapotte bron houdt de rest niet tegen");
  {
    const sb = new FakeSupabase();
    const K = "klant-1";
    sb.seed("code_rood_meldingen", [{ id: "cr1", client_id: K, licht: "rood", redenen: ["churnrisico"], gedetecteerd_op: dagenTerug(1), status: "open" }]);
    sb.seed("sync_runs", [
      { id: "g1", client_id: K, status: "success", started_at: dagenTerug(1), finished_at: dagenTerug(1), total_rows_written: 900, date_range_end: "2026-11-10" },
      { id: "g0", client_id: K, status: "success", started_at: dagenTerug(0), finished_at: dagenTerug(0), total_rows_written: 950, date_range_end: "2026-11-11" },
      { id: "ander", client_id: "klant-2", status: "failed", started_at: dagenTerug(0), finished_at: dagenTerug(0), error_summary: "van een andere klant" },
    ]);
    sb.seed("meta_sync_runs", [{ id: "m0", client_id: K, status: "failed", started_at: dagenTerug(0), finished_at: dagenTerug(0), error: "token verlopen", rows_upserted: {} }]);
    // rows_upserted is bij de dagkanalen jsonb: een telling per tabel, geen getal (migratie 008, 107).
    sb.seed("linkedin_sync_runs", [{ id: "l0", client_id: K, status: "completed", started_at: dagenTerug(0), finished_at: dagenTerug(0), rows_upserted: { linkedin_campaign_daily: 412, linkedin_creative_daily: 1380 } }]);
    // Een open Code Rood van maanden terug, met twaalf nieuwere afgehandelde meldingen erna.
    sb.seed("code_rood_meldingen", [
      { id: "cr-oud-open", client_id: K, licht: "rood", redenen: ["al maanden open"], gedetecteerd_op: "2026-06-01T08:00:00Z", status: "open" },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `cr-af-${i}`, client_id: K, licht: "amber", redenen: ["afgehandeld"], gedetecteerd_op: dagenTerug(i + 2), status: "opgelost" })),
    ]);
    sb.seed("generation_jobs", [{ job_id: "j1", client_id: K, job_type: "monthly_sop", status: "completed", channel: "google", completed_at: dagenTerug(2), updated_at: dagenTerug(2) }]);
    sb.seed("sprint_hypotheses", [
      { id: "v1", client_id: K, hypothesis: "Budget naar brand", status: "pending", ice_total: 7.7, source: "analysis", created_at: dagenTerug(2) },
      { id: "v-oud", client_id: K, hypothesis: "Al maanden open", status: "pending", created_at: "2026-07-01T08:00:00Z" },
      { id: "h1", client_id: K, hypothesis: "RSA-test", status: "completed", result_met: true, learning: "CTR +12%", evaluated_at: dagenTerug(3), created_at: "2026-09-01T08:00:00Z" },
    ]);
    sb.seed("client_notes", [{ id: "n1", client_id: K, title: "Bellen", content: "Over de beurs", is_todo: true, done: false, created_at: dagenTerug(4) }]);
    const voor = JSON.stringify(sb.tables);

    const log = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU });
    const ids = log.items.map((i) => i.id);
    check("alle soorten uit één aanroep", ["code-rood:cr1", "sync:google:g0", "datastand:meta:m0", "analyse:j1", "voorstel:v1", "hypothese:h1", "todo:n1"].every((id) => ids.includes(id)), ids.join(","));
    check("de nieuwste eerst", log.items.every((i, n) => n === 0 || Date.parse(log.items[n - 1].tijd) >= Date.parse(i.tijd)));
    check("een oude open Code Rood blijft staan, ook met twaalf nieuwere afgehandelde erna", ids.includes("code-rood:cr-oud-open"), ids.filter((i) => i.startsWith("code-rood")).join(","));
    check("... en een lopende melding binnen het venster staat er één keer", ids.filter((i) => i === "code-rood:cr1").length === 1);
    const li = log.items.find((i) => i.id === "sync:linkedin:l0");
    check("het aantal rijen van een dagkanaal is de som van de telling per tabel", li?.chip === "1.792 rijen", String(li?.chip));
    check("... en een lege telling is geen '0 rijen'", !JSON.stringify(log.items.filter((i) => i.kanaal === "meta")).includes("0 rijen"));
    check("de sync van Google beweert geen datastand", log.items.find((i) => i.id === "sync:google:g0")?.titel === "Google Ads-sync geslaagd");
    check("niets van een andere klant", !JSON.stringify(log).includes("van een andere klant"));
    check("het oude voorstel is geen regel, maar wacht wel", !ids.includes("voorstel:v-oud") && log.wachtOpOordeel === 2, String(log.wachtOpOordeel));
    check("elke bron meldt zich, en ze zijn te lezen", log.bronnen.length === 6 && log.bronnen.every((b) => b.ok), JSON.stringify(log.bronnen));
    check("er is niets geschreven", JSON.stringify(sb.tables) === voor);
    check("geen voorbeelden buiten de demo", log.items.every((i) => !i.voorbeeld));

    sb.faalOp("code_rood_meldingen", "Could not find the table 'public.code_rood_meldingen'");
    sb.faalOp("linkedin_sync_runs", "permission denied");
    const half = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU });
    const codeBron = half.bronnen.find((b) => b.bron === "code-rood"), syncBron = half.bronnen.find((b) => b.bron === "sync");
    check("een ontbrekende tabel maakt de bron 'niet te lezen', met de reden", codeBron?.ok === false && (codeBron.fout ?? "").includes("code_rood_meldingen"), JSON.stringify(codeBron));
    check("... en de rest van het logboek staat er nog", half.items.some((i) => i.id === "analyse:j1") && half.items.some((i) => i.id === "sync:google:g0"));
    check("één runtabel die faalt maakt de syncs niet onleesbaar, maar de reden staat erbij", syncBron?.ok === true && (syncBron.fout ?? "").includes("permission denied"), JSON.stringify(syncBron));

    const leeg = await leesLogboek(new FakeSupabase() as unknown as SupabaseClient, "niemand", { nu: NU });
    check("een klant zonder gebeurtenissen: leeg, en elke bron zegt nul", leeg.items.length === 0 && leeg.bronnen.every((b) => b.ok && b.aantal === 0));

    const demo = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU, demo: true });
    check("de demo krijgt voorbeelden erbij, de echte regels blijven", demo.items.some((i) => i.voorbeeld) && demo.items.some((i) => i.id === "analyse:j1"));
    const zonderDb = await leesLogboek(null, "demo-greentech", { nu: NU, demo: true });
    check("zonder database: alleen voorbeelden, en de bronnen zeggen waarom", zonderDb.items.length > 0 && zonderDb.items.every((i) => i.voorbeeld) && zonderDb.bronnen.every((b) => !b.ok));

  }

  console.log("\nDe toegang: de route leest het klant-id dat getoetst is, en geen ander");
  {
    const { NextRequest } = await import("next/server");
    const route = await import("../app/api/overzicht/logboek/route");
    // Zonder database en zonder sessie-omgeving: de route kan dan alleen de demovoorbeelden geven
    // (of weigeren), en deze test raakt geen netwerk.
    const bewaard = { ...process.env };
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "O1_AUTH_ENFORCED", "CRON_SECRET"]) delete process.env[k];
    const vraag = async (query: string, kop: Record<string, string> = {}) => {
      const url = new URL(`http://x/api/overzicht/logboek${query}`);
      const res = await route.GET(new NextRequest(url, { headers: kop }));
      return { status: res.status, body: await res.json() as { items?: LogboekItem[]; error?: string }, ids: clientIdsUitVerzoek(url.pathname, url.searchParams), url };
    };
    // De scope van iemand met toegang tot alleen de demoklant, zoals de poortwachter hem toetst.
    const alleenDemo = ["demo-greentech"] as const;
    const poortLaatDoor = (ids: string[]) => ids.every((id) => canAccessClient(alleenDemo, id));
    try {
      const eigen = await vraag("?clientId=demo-greentech");
      check("één klant: de poortwachter en de route zien dezelfde", eigen.status === 200 && eigen.ids.join() === "demo-greentech" && (eigen.body.items ?? []).length > 0, JSON.stringify(eigen.body).slice(0, 120));
      const onderstreept = await vraag("?client_id=demo-greentech");
      check("ook met client_id: dezelfde klant, hetzelfde antwoord", onderstreept.status === 200 && onderstreept.ids.join() === "demo-greentech" && JSON.stringify(onderstreept.body.items?.map((i) => i.id)) === JSON.stringify(eigen.body.items?.map((i) => i.id)));

      // HET LEK. De poortwachter toetste client_id (de eigen klant) en de route las clientId (de ander).
      const lek = await vraag("?client_id=demo-greentech&clientId=klant-van-een-ander");
      check("het oude gat bestond: de oude lezing van de poortwachter zag alleen de eigen klant", clientIdFromPath(lek.url.pathname, lek.url.searchParams) === "demo-greentech");
      check("twee verschillende klanten in één verzoek: de route weigert", lek.status === 400 && !("items" in lek.body), `${lek.status} ${JSON.stringify(lek.body).slice(0, 80)}`);
      check("... en de poortwachter toetst ze allebei, dus weigert ook", lek.ids.join() === "demo-greentech,klant-van-een-ander" && !poortLaatDoor(lek.ids));
      const omgekeerd = await vraag("?clientId=demo-greentech&client_id=klant-van-een-ander");
      check("omgekeerd net zo", omgekeerd.status === 400 && !poortLaatDoor(omgekeerd.ids));
      const dubbel = await vraag("?clientId=demo-greentech&clientId=klant-van-een-ander");
      check("twee keer dezelfde parameter met een ander id: geweigerd, door beide", dubbel.status === 400 && !poortLaatDoor(dubbel.ids));
      const zelfde = await vraag("?client_id=demo-greentech&clientId=demo-greentech");
      check("twee keer dezelfde klant is één klant", zelfde.status === 200 && zelfde.ids.length === 1 && poortLaatDoor(zelfde.ids));
      check("zonder klant: geweigerd", (await vraag("")).status === 400);
      check("het paginapad telt voor de poortwachter mee naast de querystring", clientIdsUitVerzoek("/client/aquatech", new URLSearchParams("client_id=greentech")).join() === "greentech,aquatech");

      // De route toetst zelf, op het id dat hij gebruikt, zodra de toegangscontrole aan staat.
      process.env.O1_AUTH_ENFORCED = "true";
      const zonderSessie = await vraag("?clientId=demo-greentech");
      check("met de toegangscontrole aan en zonder sessie: 401 van de route zelf, geen logboek", zonderSessie.status === 401 && !("items" in zonderSessie.body), String(zonderSessie.status));
      const lekAan = await vraag("?client_id=demo-greentech&clientId=klant-van-een-ander");
      check("... en twee klanten blijft een weigering", lekAan.status === 400);
      process.env.CRON_SECRET = "geheim-van-de-test";
      check("een verkeerd geheim opent niets", (await vraag("?clientId=demo-greentech", { authorization: "Bearer iets-anders" })).status === 401);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in bewaard)) delete process.env[k];
      Object.assign(process.env, bewaard);
    }
  }

  console.log("\nDe demo: voorbeelden die meelopen met de klok");
  {
    for (const klok of ["2026-11-12T10:00:00Z", "2027-03-29T04:00:00Z", "2027-07-01T21:59:00Z"]) {
      const nu = new Date(klok);
      const vb = demoVoorbeelden(nu);
      check(`${klok}: er zijn voorbeelden, allemaal gemarkeerd`, vb.length >= 4 && vb.every((i) => i.voorbeeld === true), String(vb.length));
      check(`${klok}: geen in de toekomst`, vb.every((i) => Date.parse(i.tijd) <= nu.getTime()));
      check(`${klok}: allemaal binnen het venster van het logboek`, vb.every((i) => nu.getTime() - Date.parse(i.tijd) < LOGBOEK_DAGEN * 86_400_000));
      check(`${klok}: minstens één van de laatste 36 uur`, vb.some((i) => nu.getTime() - Date.parse(i.tijd) < 36 * 3_600_000));
    }
    // Vanochtend 06:44 bestaat om 05:00 nog niet, en om 11:00 wel. En na een nacht is er iets nieuws.
    const vroeg = demoVoorbeelden(new Date("2026-11-12T04:00:00Z")), later = demoVoorbeelden(NU);
    check("de regel van vanochtend bestaat pas als het zover is", !vroeg.some((i) => i.id === "voorbeeld:sync-vanochtend") && later.some((i) => i.id === "voorbeeld:sync-vanochtend"));
    check("... en staat dan op 06:44 Amsterdamse tijd", tijdLabel(later.find((i) => i.id === "voorbeeld:sync-vanochtend")!.tijd, NU) === "vandaag 06:44", tijdLabel(later.find((i) => i.id === "voorbeeld:sync-vanochtend")!.tijd, NU));
    // Zomertijd: dezelfde kloktijd, een ander verschil met UTC.
    const zomer = new Date("2027-07-01T10:00:00Z");
    check("ook in de zomertijd 06:44", tijdLabel(demoVoorbeelden(zomer).find((i) => i.id === "voorbeeld:sync-vanochtend")!.tijd, zomer) === "vandaag 06:44");
    check("een voorbeeld is nooit te beoordelen: de knop zou naar iets leiden dat niet bestaat", later.every((i) => i.beoordeelbaar === false));
    check("... en zegt wat er bij een echte klant zou staan", later.filter((i) => ["voorstel", "analyse", "hypothese"].includes(i.soort)).every((i) => i.detail.some((d) => d.includes("Bij een echte klant"))));
    const gisterenBezocht = "2026-11-11T16:00:00Z";
    check("wie gisteren om 17:00 keek, ziet vandaag iets nieuws", later.some((i) => isNieuwSinds(i.tijd, gisterenBezocht)));
    check("dezelfde klok geeft dezelfde regels (een herlaad verschuift niets)", JSON.stringify(demoVoorbeelden(NU)) === JSON.stringify(demoVoorbeelden(new Date(NU.getTime() + 20 * 60_000)).map((i) => i)));
  }

  console.log("\nHet ijkpunt: een herlaad wist de markering niet");
  {
    const T0 = "2026-11-11T16:00:00Z";
    const eerste = openBezoek(null, T0);
    check("eerste bezoek: geen ijkpunt, en dus niets nieuw", eerste.eerste && eerste.stand.ijkpunt === null && !isNieuwSinds(T0, eerste.stand.ijkpunt));
    const herlaad = openBezoek(eerste.stand, "2026-11-11T16:05:00Z");
    check("herlaad binnen het eerste bezoek: nog steeds het eerste bezoek", herlaad.eerste && herlaad.stand.ijkpunt === null && !herlaad.nieuwBezoek);
    const weg = sluitBezoek(herlaad.stand, "2026-11-11T16:20:00Z");
    check("weggaan zet alleen 'gezien'", weg.ijkpunt === null && weg.gezien === "2026-11-11T16:20:00Z");

    const volgendeDag = openBezoek(weg, "2026-11-12T08:00:00Z");
    check("de volgende ochtend: een nieuw bezoek, met het einde van het vorige als ijkpunt", volgendeDag.nieuwBezoek && !volgendeDag.eerste && volgendeDag.stand.ijkpunt === "2026-11-11T16:20:00Z", String(volgendeDag.stand.ijkpunt));
    check("wat vannacht gebeurde is nieuw", isNieuwSinds("2026-11-12T05:44:00Z", volgendeDag.stand.ijkpunt));
    check("wat gisteren voor het vertrek gebeurde niet", !isNieuwSinds("2026-11-11T14:00:00Z", volgendeDag.stand.ijkpunt));

    const f5 = openBezoek(volgendeDag.stand, "2026-11-12T08:02:00Z");
    check("F5 na twee minuten: hetzelfde ijkpunt", f5.stand.ijkpunt === "2026-11-11T16:20:00Z" && !f5.nieuwBezoek);
    check("... dus de regel van vannacht is nog steeds nieuw", isNieuwSinds("2026-11-12T05:44:00Z", f5.stand.ijkpunt));
    const nogEens = openBezoek(sluitBezoek(f5.stand, "2026-11-12T08:10:00Z"), "2026-11-12T08:25:00Z");
    check("even weg en binnen een kwartier terug: hetzelfde bezoek", nogEens.stand.ijkpunt === "2026-11-11T16:20:00Z");

    const lang = sluitBezoek(nogEens.stand, "2026-11-12T10:00:00Z");
    check("een bezoek van uren is bij het weggaan nog steeds één bezoek", lang.ijkpunt === "2026-11-11T16:20:00Z");
    const naPauze = openBezoek(lang, new Date(Date.parse("2026-11-12T10:00:00Z") + BEZOEK_VOORBIJ_NA_MS + 1000).toISOString());
    check("pas na de pauze schuift het ijkpunt op, naar het einde van dat bezoek", naPauze.nieuwBezoek && naPauze.stand.ijkpunt === "2026-11-12T10:00:00Z", String(naPauze.stand.ijkpunt));
    const opDeGrens = openBezoek(lang, new Date(Date.parse("2026-11-12T10:00:00Z") + BEZOEK_VOORBIJ_NA_MS).toISOString());
    check("precies op de grens is het nog hetzelfde bezoek", !opDeGrens.nieuwBezoek);
    check("een klok die terugliep telt als hetzelfde bezoek", !openBezoek(lang, "2026-11-12T09:00:00Z").nieuwBezoek);

    check("de opslag heen en terug", JSON.stringify(leesBezoek(JSON.stringify(naPauze.stand))) === JSON.stringify(naPauze.stand));
    check("onleesbare opslag is geen bezoek", leesBezoek("{kapot") === null && leesBezoek('{"gezien":"geen datum"}') === null && leesBezoek(null) === null);
    check("per klant een eigen sleutel", bezoekSleutel("a") !== bezoekSleutel("b"));

    const haak = zonderCommentaar(lees("lib/overzicht/use-vorig-bezoek.ts"));
    check("de hook leest de opslag in een effect, niet in de eerste render", /useEffect\(\(\) => \{[\s\S]*openBezoek\(/.test(haak) && !/useState\([^)]*localStorage/.test(haak));
    check("... en legt het einde van het kijken vast bij verbergen en verlaten", /visibilitychange/.test(haak) && /pagehide/.test(haak) && /sluitBezoek\(/.test(haak));
  }

  console.log("\nDe browserlezer: één verzoek per klant, en geen bij een wissel");
  {
    const antwoord: Logboek = { items: [item("a", terug(10), "meta")], bronnen: [], wachtOpOordeel: 0, opgehaaldOp: NU.toISOString(), dagen: LOGBOEK_DAGEN };
    const verzoeken: string[] = [];
    const echteFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      verzoeken.push(String(url));
      if (String(url).includes("stuk")) return new Response(JSON.stringify({ error: "Supabase niet geconfigureerd" }), { status: 500 });
      return new Response(JSON.stringify(antwoord), { status: 200 });
    }) as typeof fetch;
    try {
      const [een, twee] = await Promise.all([laadLogboek("klant-1"), laadLogboek("klant-1")]);
      check("twee lezers tegelijk: één verzoek", verzoeken.length === 1 && een === twee, String(verzoeken.length));
      check("... naar de leesroute, met de klant in de querystring", verzoeken[0] === "/api/overzicht/logboek?clientId=klant-1", verzoeken[0]);
      await laadLogboek("klant-1");
      check("opnieuw vragen (een tabwissel, een kanaalwissel): uit de cache, geen verzoek", verzoeken.length === 1);
      await laadLogboek("klant-2");
      check("een andere klant: een eigen verzoek", verzoeken.length === 2);
      const fout = await laadLogboek("stuk").then(() => null, (e: Error) => e.message);
      check("een fout van de route komt door als fout, niet als een leeg logboek", fout === "Supabase niet geconfigureerd", String(fout));
      await laadLogboek("stuk").catch(() => null);
      check("... en blijft niet in de cache hangen", verzoeken.filter((v) => v.includes("stuk")).length === 2);
    } finally {
      globalThis.fetch = echteFetch;
    }

    const haak = zonderCommentaar(lees("lib/overzicht/use-logboek.ts"));
    check("de hook leest opnieuw op klant, aan/uit en herlees; niet op kanaal of periode", /\}, \[clientId, aan, herlees\]\);/.test(haak) && !/channel|periode|usePeriod/.test(haak));
    check("de cache is het gedeelde hulpje, met de klant voorop in de sleutel", /maakBronCache</.test(haak) && /`\$\{clientId\}\|logboek`/.test(haak));
  }

  console.log("\nDe minuutklok: 'zojuist' loopt mee, en staat stil op een verborgen tabblad");
  {
    // Een omgeving zonder echte tijd: de test zet de klok zelf een minuut verder.
    let zichtbaar = true, tikken = 0;
    const intervallen = new Set<() => void>(), luisteraars = new Set<() => void>();
    const stop = startMinuutklok(() => { tikken += 1; }, {
      zichtbaar: () => zichtbaar,
      opZichtbaarheid: (bij) => { luisteraars.add(bij); return () => luisteraars.delete(bij); },
      interval: (bij, ms) => { check("de klok tikt per minuut", ms === MINUUT_MS); intervallen.add(bij); return () => intervallen.delete(bij); },
    });
    const minuutVoorbij = () => intervallen.forEach((f) => f());
    const wissel = (naar: boolean) => { zichtbaar = naar; luisteraars.forEach((f) => f()); };
    check("zichtbaar: één interval, nog geen tik", intervallen.size === 1 && tikken === 0);
    minuutVoorbij(); minuutVoorbij();
    check("twee minuten later: twee tikken", tikken === 2);
    // Wat een tik oplevert: het label van dezelfde gebeurtenis verandert met de klok.
    const gebeurd = terug(1);
    check("... en daarmee wordt 'zojuist' na vijf minuten een maat", tijdLabel(gebeurd, NU) === "zojuist" && tijdLabel(gebeurd, new Date(NU.getTime() + 5 * MINUUT_MS)) === "6 min geleden");
    wissel(false);
    check("verborgen: geen interval meer", intervallen.size === 0);
    minuutVoorbij();
    check("... en dus geen tik", tikken === 2);
    wissel(true);
    check("weer zichtbaar: meteen een tik (er kan een uur voorbij zijn), en de klok loopt weer", tikken === 3 && intervallen.size === 1);
    wissel(true);
    check("twee keer 'zichtbaar' start geen tweede interval", intervallen.size === 1);
    stop();
    check("gestopt: geen interval en geen luisteraar meer", intervallen.size === 0 && luisteraars.size === 0);
    const verborgenStart = startMinuutklok(() => {}, { zichtbaar: () => false, opZichtbaarheid: () => () => {}, interval: (bij) => { intervallen.add(bij); return () => intervallen.delete(bij); } });
    check("op een verborgen tabblad begint hij niet te lopen", intervallen.size === 0);
    verborgenStart();
  }

  console.log("\nDe kaart: regels, wat nieuw is, de onderbouwing en de weg naar Bevindingen");
  {
    const ijkpunt = terug(60 * 20);
    const logboek: Logboek = {
      items: [
        item("voorstel:1", terug(30), "meta", { soort: "voorstel", titel: "Blog Traffic pauzeren", chip: "ICE 7,7", toon: "voorstel", beoordeelbaar: true, detail: ["De CTR halveerde.", "Verwacht: lagere CPA"] }),
        item("datastand:1", terug(60 * 5), "google", { soort: "datastand", titel: "Google Ads-sync mislukt", chip: "3 keer", toon: "alarm" }),
        item("notitie:1", terug(60 * 30), null, { titel: "Belafspraak" }),
        item("voorbeeld:1", terug(60 * 40), "linkedin", { soort: "hypothese", titel: "Een voorbeeldhypothese", voorbeeld: true }),
        item("vijfde", terug(60 * 50), "microsoft", { titel: "De vijfde regel" }),
      ],
      bronnen: [{ bron: "sync", ok: true, aantal: 1 }], wachtOpOordeel: 7, opgehaaldOp: NU.toISOString(), dagen: 30,
    };
    const render = (props: Partial<Parameters<typeof LogboekKaart>[0]> = {}) => renderToStaticMarkup(createElement(PeriodProvider, {
      scope: "test-logboek", dataStand: null,
      children: createElement(LogboekKaart, {
        logboek, laadt: false, fout: null, channel: "blended", kanalen: ["google", "meta", "linkedin", "microsoft"],
        ijkpunt, bezoekBekend: true, eersteBezoek: false, onKies: () => {}, onBeoordeel: () => {}, nu: NU, ...props,
      }),
    }));
    const html = render(), txt = platteTekst(html);
    check("de kop, met zijn eigen venster", txt.includes("Wat er gebeurde") && /data-venster="vast"/.test(html) && txt.includes("laatste 30 dagen"));
    check(`de eerste ${LOGBOEK_ZICHTBAAR} regels, de rest achter 'toon meer'`, (html.match(/<li /g) ?? []).length === LOGBOEK_ZICHTBAAR && txt.includes("Toon 1 regels meer"), String((html.match(/<li /g) ?? []).length));
    check("twee regels zijn nieuw sinds het vorige bezoek, met het woord erbij", (html.match(/data-nieuw="ja"/g) ?? []).length === 2 && (txt.match(/\bnieuw Voorstel|\bnieuw Datastand/g) ?? []).length === 2, txt.slice(0, 400));
    check("bovenaan staat hoeveel er nieuw is, en sinds wanneer", txt.includes("2 nieuw sinds je vorige bezoek (gisteren 15:00)"), txt.slice(0, 200));
    check("elke regel is een knop die zijn onderbouwing opent", (html.match(/aria-expanded="false"/g) ?? []).length === LOGBOEK_ZICHTBAAR && /aria-controls="logboek-voorstel-1"/.test(html) && /id="logboek-voorstel-1"/.test(html));
    check("de onderbouwing staat in het paneel", txt.includes("De CTR halveerde.") && txt.includes("Verwacht: lagere CPA"));
    check("alleen wat te beoordelen is krijgt 'Beoordeel'", (html.match(/>Beoordeel </g) ?? []).length === 1, String((html.match(/>Beoordeel </g) ?? []).length));
    check("een regel met een kanaal biedt dat kanaal als filter", txt.includes("Bekijk Meta") && txt.includes("Bekijk Google Ads"));
    check("een voorbeeldregel draagt het woord voorbeeld, en de voet legt het uit", /voorbeeld<\/span>/.test(html) && txt.includes("verzonnen voor de demo"));
    check("onderaan: naar Bevindingen, en hoeveel er wacht", txt.includes("Naar Bevindingen") && txt.includes("7 voorstellen wachten op je oordeel"));
    check("de tijd op de regel", txt.includes("30 min geleden") && txt.includes("vandaag 06:00"), txt.slice(0, 500));

    check("'toon meer' staat buiten het schuifvak, waar hij zonder schuiven te zien is", /<\/ul><\/div><button[^>]*>(?:(?!<\/button>)[\s\S])*Toon 1 regels meer/.test(html), html.slice(html.indexOf("</ul>"), html.indexOf("</ul>") + 120));

    // Een kanaalwissel is filteren op dezelfde lijst: elke keuze rendert zonder één verzoek.
    const echteFetch = globalThis.fetch;
    let verzoeken = 0;
    globalThis.fetch = (async () => { verzoeken += 1; return new Response("{}"); }) as typeof fetch;
    try {
      const perKeuze = (["blended", "google", "meta", "linkedin", "microsoft"] as const).map((c) => (render({ channel: c }).match(/<li /g) ?? []).length);
      check("elke kanaalkeuze toont zijn eigen deel van dezelfde lijst", perKeuze.join() === "4,2,2,2,2", perKeuze.join());
      check("... zonder één verzoek", verzoeken === 0, String(verzoeken));
    } finally {
      globalThis.fetch = echteFetch;
    }

    const demoKaart = render({ logboek: { ...logboek, items: demoVoorbeelden(NU) } });
    check("in een lijst met alleen voorbeelden staat geen knop 'Beoordeel'", !/>Beoordeel </.test(demoKaart) && platteTekst(demoKaart).includes("Bij een echte klant"));

    const meta = platteTekst(render({ channel: "meta" }));
    check("op Meta: de Meta-regel en wat de hele klant raakt, niet Google", meta.includes("Blog Traffic pauzeren") && meta.includes("Belafspraak") && !meta.includes("Google Ads-sync mislukt"));
    check("... zonder knop naar het kanaal waar je al staat", !meta.includes("Bekijk Meta"));
    check("... en de teller zegt wat er elders nieuw is", meta.includes("1 nieuw sinds je vorige bezoek") && meta.includes("en 1 bij andere kanalen"), meta.slice(0, 200));

    check("eerste bezoek: niets gemarkeerd, en dat staat erbij", !/data-nieuw="ja"/.test(render({ ijkpunt: null, eersteBezoek: true })) && platteTekst(render({ ijkpunt: null, eersteBezoek: true })).includes("eerste bezoek"));
    check("zolang het ijkpunt onbekend is: geen bewering over nieuw", nieuwTekst({ bekend: false, eerste: false, ijkpunt: null, nieuw: 0, nieuwElders: 0, nu: NU }) === null);
    check("niets nieuws is ook een antwoord", nieuwTekst({ bekend: true, eerste: false, ijkpunt: terug(5), nieuw: 0, nieuwElders: 0, nu: NU }) === "niets nieuws sinds je vorige bezoek (5 min geleden)");

    const leeg = render({ logboek: { ...logboek, items: [], wachtOpOordeel: 0, bronnen: [{ bron: "sync", ok: true, aantal: 0 }, { bron: "analyses", ok: false, aantal: 0, fout: "x" }] } });
    check("leeg: de reden, niet een lege kaart", /data-logboek-leeg/.test(leeg) && platteTekst(leeg).includes("geen sync gedraaid") && platteTekst(leeg).includes("Niet te lezen: de analyses"));
    const laden = render({ logboek: null, laadt: true });
    check("laden: de rijen zijn gereserveerd, en het staat er voor een schermlezer", /aria-busy="true"/.test(laden) && (laden.match(/min-h-\[52px\]/g) ?? []).length === LOGBOEK_ZICHTBAAR && platteTekst(laden).includes("het logboek wordt geladen"));
    const fout = platteTekst(render({ logboek: null, laadt: false, fout: "HTTP 500" }));
    check("een fout zegt dat het logboek niet geladen is, niet dat er niets gebeurde", fout.includes("kon niet geladen worden: HTTP 500") && !fout.includes("geen sync gedraaid"));
    check("de kaart heeft in elke staat dezelfde minimale hoogte", [html, leeg, laden].every((h) => h.includes("min-h-[19rem]")));
    check("het schuifvak is de plaatsbepaling voor de sr-only tekst erin", /class="relative min-h-0 lg:overflow-y-auto lg:max-h-\[13\.5rem\]"/.test(html));
  }

  console.log("\nAchter de schakelaar, en wat klaarstaat zonder aangesloten te zijn");
  {
    const dashboard = zonderCommentaar(lees("components/dashboard/client-dashboard.tsx"));
    const bovenkant = zonderCommentaar(lees("components/dashboard/overzicht-bovenkant.tsx"));
    check("het logboek zit in de nieuwe bovenkant", /<OverzichtLogboek[\s\S]*?herlees=\{route\.perKanaalTab\}/.test(bovenkant));
    check("... en het klantdashboard kent het niet rechtstreeks", !/OverzichtLogboek|LogboekKaart|useLogboek/.test(dashboard));
    const [nieuw, oud] = (() => {
      const begin = dashboard.indexOf("{nieuweWeergave ? (");
      const midden = dashboard.indexOf(") : (", begin);
      return [dashboard.slice(begin, midden), dashboard.slice(midden, dashboard.indexOf("{clientData.loading && <PaginaLaadvlak", midden))];
    })();
    check("de nieuwe bovenkant staat alleen in de tak van de nieuwe weergave", nieuw.includes("<OverzichtBovenkant") && !oud.includes("<OverzichtBovenkant"));
    check("'Beoordeel' opent het tabblad Bevindingen", /onBeoordeel=\{\(\) => setActiveTab\("outcomes"\)\}/.test(nieuw));
    check("de datastand in de bronrij alleen in de nieuwe weergave", /\{nieuweWeergave && standTekst && \(/.test(dashboard) && /data-datastand=/.test(dashboard));
    check("de eerlijke tijd op de badge alleen in de nieuwe weergave", /eerlijkeTijd=\{nieuweWeergave\}/.test(dashboard));
    const badge = zonderCommentaar(lees("components/dashboard/sync-status-badge.tsx"));
    check("... en zonder die vlag de tekst zoals hij was", /eerlijkeTijd = false/.test(badge) && /\(eerlijkeTijd \? geledenLabel\(status\.lastSyncAt\) : null\) \?\? formatTimeAgo\(status\.hoursSinceSync\)/.test(badge));

    const migratie = lees("scripts/migrations/109_klant_bezoeken.sql");
    check("de migratie zet RLS aan, met de verzamelingsvorm uit 065", /enable row level security/.test(migratie) && /client_id in \(select app_zichtbare_klanten\(\)\)/.test(migratie) && /user_id = auth\.uid\(\)/.test(migratie));
    check("... voor lezen, toevoegen en bijwerken", ["for select", "for insert", "for update"].every((s) => migratie.includes(s)));
    const code = ["lib/overzicht/bezoek.ts", "lib/overzicht/use-vorig-bezoek.ts", "lib/overzicht/logboek-lezer.ts", "app/api/overzicht/logboek/route.ts", "components/dashboard/overzicht-logboek.tsx"].map((f) => zonderCommentaar(lees(f))).join("\n");
    check("... en geen code leest of schrijft de tabel", !code.includes("klant_bezoeken"));

    const seed = lees("scripts/demo/seed-demo-client.ts");
    check("de seed ankert op de Amsterdamse dag, of op een vaste klok", /const TODAY = VASTE_DAG \?\? today\(\);/.test(seed) && /process\.env\.DEMO_VANDAAG/.test(seed));
    const herseed = lees("scripts/demo/herseed-demo.mjs");
    check("het herseed-script schrijft alleen met --uitvoeren, en zonder npx", /if \(!uitvoeren\) \{[\s\S]*?process\.exit\(0\)/.test(herseed) && !/spawnSync\(\s*["']npx/.test(herseed));
    check("... en wist de analyse-uitvoer niet (geen teardown)", !/teardown-demo-client\.ts["'`]/.test(zonderCommentaar(herseed)));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
