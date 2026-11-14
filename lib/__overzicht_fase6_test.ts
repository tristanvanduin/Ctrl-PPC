// De nieuwe weergave van het Overzicht na de nalezing van fase 4 en 5, en het oordeel van fase 6.
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_fase6_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Fase 4 en 5 zijn door drie lezers nagelopen en in de browser gemeten. Wat daaruit kwam is hier
// vastgelegd als gedrag, niet als brontekst: een functie krijgt invoer en geeft iets terug, of een
// component wordt gerenderd en de uitvoer wordt gelezen.
//
// - HET LOGBOEK ZEGT WAT HET NIET KON LEZEN. Eén runtabel van de vier die faalt is geen "geen sync
//   gedraaid" voor dat kanaal; de melding van de database gaat niet naar de browser; een stapel
//   pdf-jobs duwt geen analyse uit de lijst; en het aantal wachtende voorstellen is een telling,
//   geen lengte van een afgekapte lijst.
// - DE KAART IS LEESBAAR IN EEN SMALLE KOLOM en op een telefoon: de titel staat voluit in het
//   uitgeklapte paneel, de klok loopt niet mee in een live-gebied, en de knoppen zijn te raken.
// - TWEE LEZINGEN VAN DEZELFDE MAAND worden naast elkaar gelegd: de hoofdgrafiek en de kanaaltabel
//   lezen Google uit een andere bron, en dat staat er als ze uiteenlopen.
// - PACING & JAAROVERZICHT spreekt zichzelf niet tegen (geen "er is geen jaardoel" onder een kolom
//   jaardoel), opent de grafiek op een metriek die de klant heeft, en het oordeel is niet alleen
//   kleur.
// - DE VERTROUWDE WEERGAVE IS WAT HIJ WAS: de ringcel van de pacing, de voetregel, de ranglijst,
//   en de kop van een sectie (letterlijk dezelfde HTML als voor deze ronde). De kop die icoon en
//   titel bij elkaar houdt staat achter een context die alleen de nieuwe weergave aanzet.
// - DE KANAALRIJ HOUDT ZIJN HOOGTE VRIJ waar bekend is dat hij komt, en gokt niet waar dat niet
//   bekend is; de weg terug naar alle kanalen staat in de gekozen kaart en kost geen hoogte.
// - DE BOVENBALK VERSPRINGT NIET: het script in de <head> volgt dezelfde regel als de pagina, en
//   de standaard staat op één plek.
// - HET OORDEEL KAN AFKEUREN: per norm gehaald op de grens en niet gehaald één stap erover, uit de
//   juiste run, en een wissel die fout ging is geen schoon oordeel.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "./decision/__fake_supabase";
import { JOB_TYPEN, bronnenMetLeesfout, legeStaat, type Logboek, type LogboekBron, type LogboekItem } from "./overzicht/logboek";
import { leesLogboek } from "./overzicht/logboek-lezer";
import { kostenBronVerschil, bronVerschilZin } from "./overzicht/bron-verschil";
import { grafiekMaanden } from "./overzicht/bovenkant";
import { kanaalMaandRijen, rijenInPeriode } from "./cross-channel/kanaal-maandrijen";
import type { BlendedKanaalReeks } from "./api/blended-historical";
import type { BronReeks } from "./period/apply-period";
import { zichtbareMetriek } from "./overzicht/pacing-jaar";
import { actieveMetrics, computeForecast } from "./forecast";
import type { ClientHistoricalData, MonthlyRecord } from "./types";
import { kanaalbalkCookieRegel, kanaalbalkPad, kanaalbalkUitCookie, reserveerKaartenrij } from "./overzicht/kaartenrij";
import { isDemoClientId } from "./demo/demo-mode";
import { CHROME_ATTRIBUUT, STANDAARD_WEERGAVE, WEERGAVE_SLEUTEL, chromeIsNieuw, kiesWeergave } from "./weergave";
import { WEERGAVE_INIT_SCRIPT } from "./weergave-init";
import { PeriodProvider } from "./period/period-context";
import { SNELKOPPELINGEN } from "./period/period-range";
import { METRICS, type GeoBreakdownState } from "./geo/use-geo-breakdown";
import type { HealthScore } from "./health-score";
import { GEHAALD, MISLUKT, NIET_GEHAALD, NIET_GEMETEN, NORMEN, beoordeel, goedeMeting, slechteMeting, zelftest } from "../scripts/overzicht-normen.mjs";
import { LogboekKaart, nieuwAankondiging, nieuwTekst } from "../components/dashboard/overzicht-logboek";
import { CollapsiblePanel, Lade, MeerKnop } from "../components/ui/disclosure";
import { Sectie, Deelkop, SectieKopBijeen } from "../components/ui/sectie";
import { Vensterlabel, STAND_VAN_NU } from "../components/ui/vensterlabel";
import { PeriodeSnelkoppelingen, snelkoppelingNaam } from "../components/dashboard/period-selector";
import { WeergaveSchakelaar } from "../components/dashboard/weergave-schakelaar";
import { Kanaalkaarten, type Kanaalkaart } from "../components/dashboard/kanaalkaarten";
import { volgendeKanaalkeuze } from "./overzicht/bovenkant";
import { GeoMapCard } from "../components/dashboard/geo-map-card";
import { GEO_NAAST_ZICHTBAAR, GEO_NAAST_ZICHTBAAR_SMAL, GeoRanglijstInKaart } from "../components/dashboard/geo-ranglijst-card";
import { PacingJaaroverzicht } from "../components/dashboard/pacing-jaaroverzicht";
import { blendedPacingCijfers, blendedPacingVoetregel } from "../components/dashboard/blended-pacing";
import { RINGCEL } from "../components/dashboard/channel-pacing";
import { koppelStatusMeta } from "../components/dashboard/meta-view";
import { MICROSOFT_UITLEG } from "../components/dashboard/cross-channel-view";
import { OverzichtHoofdgrafiek } from "../components/dashboard/overzicht-hoofdgrafiek";
import { GeoEnkelLandKaart } from "../components/dashboard/geo-empty-state";

let geslaagd = 0, gefaald = 0;
function check(label: string, voorwaarde: boolean, detail = ""): void {
  if (voorwaarde) { geslaagd += 1; return; }
  gefaald += 1;
  console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ""}`);
}

const NU = new Date("2026-11-12T10:00:00Z");
const terug = (min: number) => new Date(NU.getTime() - min * 60_000).toISOString();
const dagenTerug = (d: number, uurUtc = 5) => new Date(Date.UTC(2026, 10, 12 - d, uurUtc, 44)).toISOString();
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const metPeriode = (kind: ReactNode) =>
  renderToStaticMarkup(createElement(PeriodProvider, { scope: "fase6", dataStand: null, children: kind })).replace(/<!-- -->/g, "");
// Zonder DOM heeft de container van een grafiek geen maat; recharts meldt dat. Hier waar, geen fout.
const waarschuw = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };

/** Alle knoppen in een boom van React-elementen (zonder te renderen), voor het aanroepen van onClick. */
function knoppenIn(node: ReactNode, uit: ReactElement<{ onClick?: () => void; children?: ReactNode }>[] = []) {
  if (Array.isArray(node)) { for (const n of node) knoppenIn(n, uit); return uit; }
  if (!isValidElement(node)) return uit;
  const el = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>;
  if (el.type === "button") uit.push(el);
  knoppenIn(el.props.children, uit);
  return uit;
}

async function main() {
  // ── Het logboek: wat er niet gelezen kon worden ───────────────────────────────────────────────
  console.log("De lezer: een halve bron wordt genoemd, de databasemelding blijft op de server");
  {
    const K = "klant-1";
    const sb = new FakeSupabase();
    sb.seed("sync_runs", [{ id: "g0", client_id: K, status: "success", started_at: dagenTerug(0), finished_at: dagenTerug(0), total_rows_written: 950 }]);
    sb.seed("meta_sync_runs", [{ id: "m0", client_id: K, status: "completed", started_at: dagenTerug(0), finished_at: dagenTerug(0), rows_upserted: { a: 5 } }]);
    sb.faalOp("microsoft_sync_runs", 'relation "public.microsoft_sync_runs" does not exist');
    const gemeld: string[] = [];
    const log = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU, meld: (r) => gemeld.push(r) });
    const sync = log.bronnen.find((b) => b.bron === "sync")!;
    check("één runtabel die faalt: de syncs blijven te lezen, maar met een gat", sync.ok === true && sync.deels === true, JSON.stringify(sync));
    check("... en de bron zegt van welk kanaal", (sync.kanalenStuk ?? []).join() === "microsoft", JSON.stringify(sync.kanalenStuk));
    check("de reden voor de browser is vast en kort", sync.fout === "microsoft_sync_runs niet te lezen", String(sync.fout));
    check("... de melding van de database staat nergens in het antwoord", !JSON.stringify(log).includes("does not exist") && !JSON.stringify(log).includes("public."));
    check("... maar wel in het serverlog, met de tabel erbij", gemeld.length === 1 && gemeld[0].includes("microsoft_sync_runs") && gemeld[0].includes("does not exist"), gemeld.join(" | "));
    check("de bronnen die wel antwoordden dragen geen gat", log.bronnen.filter((b) => b.bron !== "sync").every((b) => b.ok && !b.deels && !b.fout), JSON.stringify(log.bronnen));

    const opMicrosoft = legeStaat({ ...log, items: [] }, "microsoft");
    check("met dat kanaal gekozen: 'niet te lezen', geen 'geen sync gedraaid'",
      opMicrosoft.includes("Niet te lezen: de syncs") && !opMicrosoft.includes("geen sync gedraaid"), opMicrosoft);
    const opMeta = legeStaat({ ...log, items: [] }, "meta");
    check("met een ander kanaal gekozen: daar is de sync gewoon gelezen", opMeta.includes("geen sync gedraaid") && !opMeta.includes("Niet te lezen") && !opMeta.includes("Niet volledig"), opMeta);
    const opAlles = legeStaat({ ...log, items: [] }, "blended");
    check("op Alle kanalen: 'niet volledig te lezen', met het kanaal bij naam", opAlles.includes("Niet volledig te lezen: de syncs (Microsoft Ads)"), opAlles);

    check("de regel onder het logboek noemt de bron, ook als hij 'ok' is", bronnenMetLeesfout(log.bronnen).map((b) => b.naam).join() === "de syncs");
    check("... op het kanaal dat het raakt wel, op een ander kanaal niet",
      bronnenMetLeesfout(log.bronnen, "microsoft").length === 1 && bronnenMetLeesfout(log.bronnen, "meta").length === 0);

    // Eén van de twee lezingen van de meldingen: geen kanaal, wel een gat.
    const half: LogboekBron[] = [{ bron: "code-rood", ok: true, aantal: 0, deels: true, fout: "code_rood_meldingen niet te lezen" }, { bron: "sync", ok: true, aantal: 0 }];
    const zin = legeStaat({ items: [], dagen: 30, wachtOpOordeel: 0, bronnen: half }, "meta");
    check("een bron zonder kanalen met een gat telt op elk kanaal", zin.includes("Niet volledig te lezen: de meldingen"), zin);

    // De kaart: de regel staat er als er wel regels zijn (anders zegt de lege staat het).
    const kaart = (bronnen: LogboekBron[], channel: "blended" | "meta" | "microsoft" = "blended") => metPeriode(createElement(LogboekKaart, {
      logboek: { ...log, bronnen }, laadt: false, fout: null, channel, kanalen: ["google", "meta", "microsoft"],
      ijkpunt: terug(600), bezoekBekend: true, eersteBezoek: false, onKies: () => {}, onBeoordeel: () => {}, nu: NU,
    }));
    check("de kaart zegt het bij een halve bron, met de naam", /niet elke bron was te lezen \(de syncs\)/.test(tekst(kaart(log.bronnen))), tekst(kaart(log.bronnen)).slice(-260));
    check("... en zwijgt als alles gelezen is", !/niet elke bron/.test(tekst(kaart(log.bronnen.map((b) => ({ bron: b.bron, ok: true, aantal: b.aantal }))))));
    check("... en de uitleg bevat geen databasemelding", !kaart(log.bronnen).includes("does not exist"));
  }

  console.log("\nDe lezer: pdf-jobs duwen geen analyse uit de lijst, en het wachtende aantal is een telling");
  {
    const K = "klant-2";
    const sb = new FakeSupabase();
    // Vijfenveertig pdf-jobs van vandaag, en één maandanalyse van vier dagen terug: ouder dan alle pdf's.
    sb.seed("generation_jobs", [
      ...Array.from({ length: 45 }, (_, i) => ({ job_id: `pdf-${i}`, client_id: K, job_type: "pdf_generation", status: "completed", completed_at: terug(i + 1), updated_at: terug(i + 1) })),
      { job_id: "analyse-oud", client_id: K, job_type: "monthly_sop", status: "completed", channel: "google", completed_at: dagenTerug(4), updated_at: dagenTerug(4) },
      { job_id: "rook", client_id: K, job_type: "queue_smoke_test", status: "completed", completed_at: terug(3), updated_at: terug(3) },
    ]);
    // 230 voorstellen wachten; 3 daarvan zijn van deze maand.
    sb.seed("sprint_hypotheses", [
      ...Array.from({ length: 227 }, (_, i) => ({ id: `oud-${i}`, client_id: K, hypothesis: `Oud voorstel ${i}`, status: "pending", created_at: "2026-06-01T08:00:00Z" })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `nieuw-${i}`, client_id: K, hypothesis: `Nieuw voorstel ${i}`, status: "pending", created_at: dagenTerug(i + 1) })),
      { id: "andere-klant", client_id: "klant-9", hypothesis: "Van een ander", status: "pending", created_at: dagenTerug(1) },
      { id: "klaar", client_id: K, hypothesis: "Al beoordeeld", status: "completed", created_at: dagenTerug(1) },
      // Twee wachtende rijen zonder hypothese: het logboek maakt er geen regel van, dus tellen ze niet.
      { id: "leeg", client_id: K, hypothesis: "", status: "pending", created_at: dagenTerug(1) },
      { id: "ontbreekt", client_id: K, hypothesis: null, status: "pending", created_at: dagenTerug(2) },
    ]);
    const log = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU, meld: () => {} });
    const ids = log.items.map((i) => i.id);
    check("de analyse van vier dagen terug staat er, achter vijfenveertig nieuwere pdf-jobs", ids.includes("analyse:analyse-oud"), ids.filter((i) => i.startsWith("analyse")).join());
    check("... en geen enkele pdf-job of rookproef is een regel", !ids.some((i) => i.includes("pdf-") || i.includes("rook")));
    check("de jobtypen van het filter zijn de typen die een regel worden", JOB_TYPEN.includes("monthly_sop") && JOB_TYPEN.includes("report_generation") && !JOB_TYPEN.includes("pdf_generation") && !JOB_TYPEN.includes("queue_smoke_test"), JOB_TYPEN.join());
    check("230 wachtende voorstellen zijn 230, niet 200", log.wachtOpOordeel === 230, String(log.wachtOpOordeel));
    check("... en een wachtende rij zonder hypothese telt niet mee: het logboek toont hem ook niet",
      !ids.includes("voorstel:leeg") && !ids.includes("voorstel:ontbreekt") && log.wachtOpOordeel === 230, String(log.wachtOpOordeel));
    check("... en de drie van deze maand zijn regels", ["voorstel:nieuw-0", "voorstel:nieuw-1", "voorstel:nieuw-2"].every((id) => ids.includes(id)));

    sb.faalOp("sprint_hypotheses", "permission denied for table sprint_hypotheses");
    const stuk = await leesLogboek(sb as unknown as SupabaseClient, K, { nu: NU, meld: () => {} });
    check("de voorstellen niet te lezen: geen '0 wachten', maar onbekend", stuk.wachtOpOordeel === null, String(stuk.wachtOpOordeel));
    check("... de bron zegt het", stuk.bronnen.find((b) => b.bron === "voorstellen")?.ok === false);
    const zin = legeStaat({ ...stuk, items: [] });
    check("... en de lege staat beweert niets over wachtende voorstellen", !/wacht(en)? (er )?(nog )?\d/.test(zin) && zin.includes("de voorstellen"), zin);
    const html = metPeriode(createElement(LogboekKaart, {
      logboek: stuk, laadt: false, fout: null, channel: "blended", kanalen: ["google"],
      ijkpunt: null, bezoekBekend: true, eersteBezoek: true, onKies: () => {}, onBeoordeel: () => {}, nu: NU,
    }));
    check("... en de kaart ook niet", !/voorstel(len)? wacht/.test(tekst(html)), tekst(html).slice(-200));
    check("zonder database is het aantal ook onbekend", (await leesLogboek(null, "demo-greentech", { nu: NU, demo: true })).wachtOpOordeel === null);
  }

  // ── De kaart: leesbaar in een smalle kolom, op een telefoon en met een schermlezer ─────────────
  console.log("\nDe kaart: de titel voluit, de klok buiten het live-gebied, knoppen die te raken zijn");
  {
    const lang = "Verouderde negatives op de importcampagne vervangen verlaagt de verspilling op zoektermen die niets met de beurs te maken hebben";
    const item = (id: string, min: number, extra: Partial<LogboekItem> = {}): LogboekItem => ({
      id, soort: "voorstel", kanaal: "meta", tijd: terug(min), titel: lang, chip: "geaccepteerd", toon: "voorstel", detail: ["De onderbouwing."], beoordeelbaar: true, ...extra,
    });
    const logboek: Logboek = {
      items: [item("voorstel:1", 30), item("voorstel:2", 90, { kanaal: "google", titel: "Tweede" }), item("n:3", 200, { titel: "Derde" }), item("n:4", 300, { titel: "Vierde" }), item("n:5", 400, { titel: "Vijfde" }), item("n:6", 500, { titel: "Zesde" })],
      bronnen: [{ bron: "voorstellen", ok: true, aantal: 6 }], wachtOpOordeel: 6, opgehaaldOp: NU.toISOString(), dagen: 30,
    };
    const render = (extra: Record<string, unknown> = {}) => metPeriode(createElement(LogboekKaart, {
      logboek, laadt: false, fout: null, channel: "blended", kanalen: ["google", "meta"],
      ijkpunt: terug(31), bezoekBekend: true, eersteBezoek: false, onKies: () => {}, onBeoordeel: () => {}, nu: NU, ...extra,
    }));
    const html = render();
    const titelInPaneel = [...html.matchAll(/<p[^>]*data-logboek-titel[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
    check("de volledige titel staat als alinea in het uitgeklapte paneel van elke regel", titelInPaneel.length === 4 && titelInPaneel[0] === lang, titelInPaneel.join(" | ").slice(0, 200));
    check("de titel in de regel breekt in een smalle kaart over twee regels, in een brede over één", /class="line-clamp-2[^"]*@md:line-clamp-1"/.test(html) && !/sm:line-clamp-1/.test(html));
    check("de chip kan inkorten en staat in een smalle kaart onder de titel", /class="col-start-2 row-start-2 max-w-full justify-self-start truncate[^"]*@md:col-start-3 @md:row-start-1/.test(html));
    check("de kaart meet zijn eigen breedte", /<section[^>]*class="@container /.test(html));
    check("de minimumhoogte geldt alleen naast de grafiek", /lg:min-h-\[19rem\]/.test(html) && !/class="[^"]*(?<![:\w-])min-h-\[19rem\]/.test(html));

    const live = [...html.matchAll(/<([a-z]+)[^>]*(?:aria-live="[^"]*"|role="status")[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => tekst(m[2]));
    check("er is een aankondiging voor een schermlezer", live.length === 1 && live[0].includes("nieuw sinds je vorige bezoek"), live.join(" | "));
    check("... zonder het tijdstip dat met de klok meeloopt", live.every((t) => !/geleden|vandaag|gisteren|zojuist/.test(t)), live.join(" | "));
    const eenMinuutLater = render({ nu: new Date(NU.getTime() + 60_000) });
    const liveLater = [...eenMinuutLater.matchAll(/<span[^>]*role="status"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => tekst(m[1]));
    check("... dus een minuut later is de aankondiging dezelfde, en de zichtbare regel niet", liveLater[0] === live[0]
      && nieuwTekst({ bekend: true, eerste: false, ijkpunt: terug(31), nieuw: 1, nieuwElders: 0, nu: NU }) !== nieuwTekst({ bekend: true, eerste: false, ijkpunt: terug(31), nieuw: 1, nieuwElders: 0, nu: new Date(NU.getTime() + 60_000) }));
    check("de aankondiging zegt hetzelfde aantal als de zichtbare regel",
      nieuwAankondiging({ bekend: true, eerste: false, ijkpunt: terug(31), nieuw: 3, nieuwElders: 2 }) === "3 nieuw sinds je vorige bezoek, en 2 bij andere kanalen"
      && nieuwAankondiging({ bekend: true, eerste: false, ijkpunt: terug(31), nieuw: 0, nieuwElders: 0 }) === "niets nieuws sinds je vorige bezoek"
      && nieuwAankondiging({ bekend: false, eerste: false, ijkpunt: null, nieuw: 0, nieuwElders: 0 }) === null);

    const knop = (naam: RegExp) => [...html.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*>((?:(?!<\/button>)[\s\S])*)<\/button>/g)].filter((m) => naam.test(tekst(m[2]))).map((m) => m[1]);
    check("Beoordeel: 44 px op een telefoon, compact vanaf sm", knop(/^Beoordeel/).length > 0 && knop(/^Beoordeel/).every((c) => /\bmin-h-11\b/.test(c) && /sm:min-h-7/.test(c)), knop(/^Beoordeel/)[0]);
    check("Bekijk <kanaal>: idem", knop(/^Bekijk /).length > 0 && knop(/^Bekijk /).every((c) => /\bmin-h-11\b/.test(c) && /sm:min-h-7/.test(c)));
    check("Naar Bevindingen: idem", knop(/^Naar Bevindingen/).length === 1 && /\bmin-h-11\b/.test(knop(/^Naar Bevindingen/)[0]));
    // Op een telefoon staan er drie regels (LOGBOEK_ZICHTBAAR_SMAL), daarboven vier: één knop met
    // het aantal voor beide breedtes, elk zichtbaar op zijn eigen breedte.
    check("Toon meer: idem", knop(/^Toon 3 regels meer/).length === 1 && /\bmin-h-11\b/.test(knop(/^Toon 3 regels meer/)[0]) && /Toon 2 regels meer/.test(JSON.stringify(html)), JSON.stringify(knop(/Toon/)));
    const gewoon = renderToStaticMarkup(createElement(MeerKnop, { verborgen: 3, uitgeklapt: false, onToggle: () => {} }));
    check("de gewone 'toon meer' elders op de pagina is wat hij was", !/min-h-11/.test(gewoon) && /Toon 3 regels meer/.test(gewoon));
  }

  // ── Uitklappen ────────────────────────────────────────────────────────────────────────────────
  console.log("\nUitklapblokken: geen dode verwijzing, en de meting ziet of ze dicht zijn");
  {
    const dicht = renderToStaticMarkup(createElement(CollapsiblePanel, { id: "proef", title: "Proef", defaultOpen: false, children: "INHOUD" }));
    const open = renderToStaticMarkup(createElement(CollapsiblePanel, { id: "proef", title: "Proef", defaultOpen: true, children: "INHOUD" }));
    check("dicht: geen aria-controls naar een paneel dat er niet staat", !/aria-controls/.test(dicht) && !/INHOUD/.test(dicht) && /aria-expanded="false"/.test(dicht));
    check("open: de knop wijst naar het paneel dat er staat", /aria-controls="paneel-proef"/.test(open) && /id="paneel-proef"/.test(open));
    check("het blok zegt of het dicht is", /data-paneel="dicht"/.test(dicht) && /data-paneel="open"/.test(open));
    check("zonder de prop draagt een paneel geen 'stand van nu'", !/data-venster/.test(dicht));
    check("met de prop wel", /data-venster="stand"/.test(renderToStaticMarkup(createElement(CollapsiblePanel, { id: "p2", title: "Over dit tabblad", defaultOpen: false, standVanNu: true, children: "x" }))));
    check("het kenmerk voor een los blok is hetzelfde", STAND_VAN_NU["data-venster"] === "stand");
    const lade = (heelBlok: boolean, defaultOpen = false) => renderToStaticMarkup(createElement(Lade, { id: "l", label: "Toon als tabel", heelBlok, defaultOpen, children: "TABEL" }));
    check("een lade die de hele kaart is, zegt dat en zegt of hij dicht is", /data-heel-blok="dicht"/.test(lade(true)) && /data-heel-blok="open"/.test(lade(true, true)));
    check("een lade onder een kaart met cijfers zegt het niet", !/data-heel-blok/.test(lade(false)));
  }

  // ── Twee lezingen van dezelfde maand ──────────────────────────────────────────────────────────
  console.log("\nGrafiek en kanaaltabel naast elkaar: een klant met beide bronnen");
  {
    const periode = { start: "2026-03", end: "2026-08" };
    const reeks = (naam: string, maanden: Record<string, number>): BronReeks => ({
      naam, vanaf: null, geladenVanaf: null,
      maanden: new Map(Object.entries(maanden).map(([m, adSpend]) => [m, { adSpend, conversions: adSpend / 100, revenue: 0 }])),
    });
    const routeReeks = (kanaal: string, maanden: Record<string, number>) => ({
      kanaal, vanaf: null, maanden: Object.entries(maanden).map(([month, adSpend]) => ({ month, adSpend, conversions: adSpend / 100, revenue: 0, clicks: 0, impressions: 0 })),
    }) as unknown as BlendedKanaalReeks;
    // Google live: zes maanden. Google in de database: de sync stopte na april.
    const live = { "2026-03": 10_000, "2026-04": 11_000, "2026-05": 12_000, "2026-06": 13_000, "2026-07": 14_000, "2026-08": 15_000 };
    const database = { "2026-03": 10_000, "2026-04": 11_000 };
    const meta = { "2026-05": 3_000, "2026-06": 3_100, "2026-07": 3_200, "2026-08": 3_300 };
    const grafiek = grafiekMaanden({ google: reeks("google", live), meta: reeks("meta", meta) }, ["google", "meta"], periode);
    const tabel = rijenInPeriode(kanaalMaandRijen([routeReeks("google", database), routeReeks("meta", meta)]), periode);

    // De maandkosten per kanaal, uit beide blokken naast elkaar.
    const perMaand = grafiek.map((m) => ({
      maand: m.maand,
      grafiek: m.perKanaal.google?.adSpend ?? 0,
      tabel: tabel.filter((r) => r.channel === "google_ads" && r.month.startsWith(m.maand)).reduce((s, r) => s + r.spend, 0),
    }));
    check("de fixture: maart en april gelijk, mei t/m augustus alleen in de grafiek",
      perMaand.map((m) => (m.grafiek === m.tabel ? "=" : "x")).join("") === "==xxxx", JSON.stringify(perMaand));

    const verschil = kostenBronVerschil(grafiek, tabel);
    check("alleen Google loopt uiteen; Meta leest aan beide kanten dezelfde reeks", verschil.map((v) => v.kanaal).join() === "google", JSON.stringify(verschil.map((v) => v.kanaal)));
    const g = verschil[0];
    check("de vier maanden waarin de database stilstond", g.afwijkend.map((a) => a.maand).join() === "2026-05,2026-06,2026-07,2026-08" && g.maanden === 6, JSON.stringify(g.afwijkend));
    check("met beide bedragen per maand", g.afwijkend[0].grafiek === 12_000 && g.afwijkend[0].tabel === 0);
    check("en beide totalen over de periode", g.grafiekTotaal === 75_000 && g.tabelTotaal === 21_000, `${g.grafiekTotaal} ${g.tabelTotaal}`);
    const zin = bronVerschilZin(g);
    check("de zin noemt welke blokken welke bron lezen", zin.includes("live bij Google") && zin.includes("gesynchroniseerde database") && zin.includes("de ring en deze tabel"), zin);
    check("... in hoeveel maanden, en beide bedragen", zin.includes("in 4 van de 6 maanden") && /€\s?75\.000/.test(zin) && /€\s?21\.000/.test(zin), zin);

    const gelijk = kostenBronVerschil(grafiek, rijenInPeriode(kanaalMaandRijen([routeReeks("google", live), routeReeks("meta", meta)]), periode));
    check("lopen de twee bronnen gelijk (de demo), dan staat er niets", gelijk.length === 0, JSON.stringify(gelijk));
    const afronding = kostenBronVerschil(grafiek, rijenInPeriode(kanaalMaandRijen([routeReeks("google", Object.fromEntries(Object.entries(live).map(([m, v]) => [m, v + 0.4]))), routeReeks("meta", meta)]), periode));
    check("een afrondingsverschil is geen andere bron", afronding.length === 0, JSON.stringify(afronding));
    // Meta begint in mei: maart en april zijn aan geen van beide kanten gemeten, en tellen dus niet als verschil.
    check("een maand voor de start van een kanaal is geen verschil", !verschil.some((v) => v.kanaal === "meta"));
    const eenMaand = kostenBronVerschil(grafiek, rijenInPeriode(kanaalMaandRijen([routeReeks("google", { ...live, "2026-08": 9_000 }), routeReeks("meta", meta)]), periode));
    check("één afwijkende maand wordt bij naam genoemd", eenMaand.length === 1 && bronVerschilZin(eenMaand[0]).includes("in augustus 2026"), eenMaand[0] ? bronVerschilZin(eenMaand[0]) : "geen");
  }

  // ── Pacing & jaaroverzicht ────────────────────────────────────────────────────────────────────
  console.log("\nPacing & jaaroverzicht: geen tegenspraak, de juiste metriek, een oordeel dat niet alleen kleur is");
  {
    type Rij = [number, number, number];
    const naarMaanden = (rijen: Rij[]): MonthlyRecord[] => rijen.map(([conversions, adSpend, revenue], i) => ({ month: i + 1, conversions, adSpend, revenue, weeks: [] }));
    const J2025: Rij[] = [[88, 11100, 17010], [92, 11050, 17440], [103, 11150, 19300], [113, 11100, 21010], [127, 11050, 23640], [143, 11150, 26670],
      [138, 11100, 26060], [134, 11050, 25630], [117, 11150, 23130], [105, 11100, 20830], [93, 11050, 18490], [87, 11150, 17210]];
    const J2026: Rij[] = [[90, 12000, 17190], [243, 16700, 17110], [244, 16800, 36030], [337, 19500, 47530], [355, 19700, 50430], [361, 19550, 52170], [418, 25950, 62930], [370, 23650, 56930]];
    const maakData = (doel: ClientHistoricalData["targetCurrentYear"]): ClientHistoricalData => ({
      clientId: "demo-greentech", currentYear: 2026, targetCurrentYear: doel,
      historicalYears: { 2025: naarMaanden(J2025) }, currentYearData: [...naarMaanden(J2026), null, null, null, null],
    });
    const data = maakData({ conversions: 2600, revenue: 282062, adSpend: 117000 });
    const forecast = computeForecast(data);
    const maandReeks = (rijen: Rij[], jaar: number) => rijen.map(([conversions, adSpend, revenue], i) => ({
      month: `${jaar}-${String(i + 1).padStart(2, "0")}`, conversions, adSpend, revenue, clicks: 0, impressions: 0,
    }));
    const perKanaal = [{ kanaal: "google", vanaf: null, maanden: [...maandReeks(J2025, 2025), ...maandReeks(J2026, 2026)] }] as unknown as BlendedKanaalReeks[];

    // Alle kanalen gepaard: de tak waarin de oude zin stond.
    const c = blendedPacingCijfers(perKanaal, "2026-08")!;
    const oud = blendedPacingVoetregel(c, null);
    const naastDoel = blendedPacingVoetregel(c, null, [], { naastJaardoel: true });
    check("de vertrouwde pacingkaart houdt zijn zin", oud.startsWith("Tegen vorig jaar en niet tegen een doel: er staat voor deze kanalen geen jaardoel in het systeem"), oud);
    check("naast een jaardoel valt die zin weg", !naastDoel.includes("geen jaardoel") && !naastDoel.includes("verzonnen doel"), naastDoel);
    check("... en blijft staan waartegen vergeleken is, en over welk venster", naastDoel.includes("gelijk-voor-gelijk: Google Ads.") && naastDoel.includes("Het venster loopt t/m de laatste maand"), naastDoel);
    // De andere takken (een kanaal buiten de vergelijking) zeiden het al zonder die zin: ongewijzigd.
    const metMeta = blendedPacingCijfers([...perKanaal, { kanaal: "meta", vanaf: null, maanden: maandReeks(J2026, 2026).slice(1) } as unknown as BlendedKanaalReeks], "2026-08")!;
    check("met een kanaal buiten de vergelijking zijn beide standen dezelfde zin", blendedPacingVoetregel(metMeta, null) === blendedPacingVoetregel(metMeta, null, [], { naastJaardoel: true }));

    // De klem op de metriek: een kanaal met alleen een omzetdoel.
    // Zoals een kanaal met alleen een omzetdoel: het conversiedoel staat op nul.
    const alleenOmzet = { ...forecast, conversions: { ...forecast.conversions, kpi: { ...forecast.conversions.kpi, annualTarget: 0 } } };
    const actief = actieveMetrics(alleenOmzet);
    check("de fixture: conversies is voor deze klant geen actieve metriek", !actief.includes("conversions") && actief.length > 0, actief.join());
    check("de grafiek opent dan op de eerste actieve metriek", zichtbareMetriek(alleenOmzet, "conversions") === actief[0], zichtbareMetriek(alleenOmzet, "conversions"));
    check("een actieve keuze blijft de keuze", zichtbareMetriek(forecast, "revenue") === "revenue" && zichtbareMetriek(forecast, "conversions") === "conversions");

    const html = metPeriode(createElement(PacingJaaroverzicht, { data, forecast, perKanaal, dataStand: { laatsteVolleMaand: "2026-08", partieel: null }, metric: "conversions", onMetricChange: () => {} }));
    const oordelen = [...html.matchAll(/<span[^>]*data-oordeel="((?:on)?gunstig)"[^>]*>([\s\S]*?)<\/span><\/td>/g)];
    check("elk oordeel draagt een icoon naast het percentage", oordelen.length >= 2 && oordelen.every((m) => /<svg/.test(m[2])), String(oordelen.length));
    check("... en beide oordelen komen in deze fixture voor, met een ander icoon", new Set(oordelen.map((m) => m[1])).size === 2
      && new Set(oordelen.map((m) => `${m[1]}:${/lucide-check/.test(m[2]) ? "vink" : "waarschuwing"}`)).size === 2, oordelen.map((m) => m[1]).join());
    check("... het woord voor een schermlezer blijft erbij", oordelen.every((m) => /sr-only"> ?(on)?gunstig/.test(m[2])));
    check("het schuifvak van de tabel is met het toetsenbord te bereiken, met een naam", /<div class="overflow-x-auto[^"]*focus-visible:outline-2[^"]*" tabindex="0" role="region" aria-label="Tabel pacing en jaaroverzicht 2026[^"]*">/.test(html));
    check("de voortgangsbalk houdt een eigen ondergrens", /class="relative h-1\.5 min-w-16 flex-1/.test(html));
    check("de zin 'geen jaardoel in het systeem' staat nergens in de kaart", !/geen jaardoel in het systeem/.test(html));
  }

  // ── De vertrouwde weergave ────────────────────────────────────────────────────────────────────
  console.log("\nDe vertrouwde weergave is wat hij was");
  {
    check("de ringcel van de pacing: ring en tekst naast elkaar, en eronder als het niet past", RINGCEL.vertrouwd === "flex flex-wrap items-center justify-center gap-3");
    check("... de nieuwe opmaak is een andere, alleen op verzoek", (RINGCEL.stapelSmal as string) !== RINGCEL.vertrouwd && RINGCEL.stapelSmal.includes("@lg:flex-row"));

    const land = (code: string, conversions: number) => ({ code, impressions: 1000, clicks: 100, cost: 500, conversions });
    const landen = Array.from({ length: 10 }, (_, i) => land(`L${i}`, 100 - i * 5));
    const staat = {
      metricKey: "conversions", setMetricKey: () => {}, metric: METRICS.find((m) => m.key === "conversions")!, focus: null, setFocus: () => {},
      countries: landen, states: [], laden: false, canDrillUs: false, labelOf: (c: string) => `Land ${c}`, geoWord: "land",
      ranked: landen.map((c) => ({ c, v: c.conversions })), values: new Map(), totaal: { impressions: 0, clicks: 0, cost: 0, conversions: 0 }, eenLandOfMinder: false,
    } as unknown as GeoBreakdownState;
    const rijen = (h: string) => [...h.matchAll(/Land L\d/g)].length;
    const oud = renderToStaticMarkup(createElement(GeoRanglijstInKaart, { state: staat }));
    const nieuw = renderToStaticMarkup(createElement(GeoRanglijstInKaart, { state: staat, naast: true }));
    check("de ranglijst onder de kaart toont alle landen, zonder knop", rijen(oud) === 10 && !/meer/.test(tekst(oud)), String(rijen(oud)));
    check("naast de kaart begint hij kort, met de rest achter een knop die het aantal noemt", rijen(nieuw) === GEO_NAAST_ZICHTBAAR && tekst(nieuw).includes(`Toon ${10 - GEO_NAAST_ZICHTBAAR} landen meer`), tekst(nieuw).slice(-80));
    // Op een telefoon begint hij met GEO_NAAST_ZICHTBAAR_SMAL: de vierde tot en met de zesde staan
    // in de boom, verborgen onder lg, achter een knop die alleen daar staat.
    check("... op een telefoon korter: de regels na de derde zijn verborgen onder lg", [...nieuw.matchAll(/<li class="[^"]*max-lg:hidden/g)].length === GEO_NAAST_ZICHTBAAR - GEO_NAAST_ZICHTBAAR_SMAL
      && tekst(nieuw).includes(`Toon ${10 - GEO_NAAST_ZICHTBAAR_SMAL} landen meer`));
    const kort = { ...staat, ranked: (staat.ranked as unknown[]).slice(0, 4) } as unknown as GeoBreakdownState;
    const kortHtml = renderToStaticMarkup(createElement(GeoRanglijstInKaart, { state: kort, naast: true }));
    check("... met vier landen alleen op een telefoon een knop (vanaf lg staan ze er alle vier)", /<button[^>]*class="lg:hidden /.test(kortHtml) && !/lg:inline/.test(kortHtml));
    const drie = { ...staat, ranked: (staat.ranked as unknown[]).slice(0, 3) } as unknown as GeoBreakdownState;
    check("... en met drie landen staat er geen knop", !/meer/.test(tekst(renderToStaticMarkup(createElement(GeoRanglijstInKaart, { state: drie, naast: true })))));

    // De kop van een sectie, zonder de context van de nieuwe weergave: letterlijk de HTML van vóór
    // deze ronde. Sectie en Deelkop staan op tien schermen; daar hoort niets te verschuiven.
    const icoon = createElement("i", { "data-proef": "icoon" });
    const sectieProps = { titel: "Gezondheid", bijschrift: "Een bijschrift.", icoon, actie: createElement("b", null, "ACTIE"), children: "x" };
    const sectieOud = renderToStaticMarkup(createElement(Sectie, sectieProps));
    check("een sectiekop is wat hij was: icoon, titel en actie als drie losse items in de omloop",
      sectieOud === '<section class="mt-10"><div class="mb-4 flex flex-wrap items-center gap-3 gap-y-2">'
        + '<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10"><i data-proef="icoon"></i></div>'
        + '<div class="min-w-0"><h2 class="text-base font-bold text-brand-blue-ink">Gezondheid</h2><p class="text-xs text-muted-foreground">Een bijschrift.</p></div>'
        + '<div class="ml-auto shrink-0"><b>ACTIE</b></div></div><div class="space-y-4 sectie-kaarten">x</div></section>', sectieOud);
    const deelOud = renderToStaticMarkup(createElement(Deelkop, { titel: "Jaaroverzicht", icoon }));
    check("een deelkop ook",
      deelOud === '<div class="flex flex-wrap items-center gap-3 gap-y-2 pt-4">'
        + '<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10"><i data-proef="icoon"></i></div>'
        + '<div class="min-w-0"><h3 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-title font-bold text-brand-blue-ink">Jaaroverzicht</h3></div></div>', deelOud);
    check("... en een context die uit staat is hetzelfde als geen context",
      renderToStaticMarkup(createElement(SectieKopBijeen.Provider, { value: false }, createElement(Sectie, sectieProps))) === sectieOud);
  }

  // ── De sectiekop in de nieuwe weergave ────────────────────────────────────────────────────────
  // Dit toetst de STRUCTUUR (welke elementen in één blok zitten). Of de kop op een telefoon ook
  // goed staat, is opmaak en alleen in een browser te zien; dat staat als open punt in het
  // uitroldocument.
  console.log("\nDe sectiekop in de nieuwe weergave: icoon en titel in één blok, alleen de actie breekt af");
  {
    const bijeen = (kind: ReactElement) => renderToStaticMarkup(createElement(SectieKopBijeen.Provider, { value: true }, kind));
    const sectie = bijeen(createElement(Sectie, { titel: "Gezondheid, pacing en markten", bijschrift: "Een bijschrift dat op een telefoon over twee regels loopt.", icoon: createElement("i", { "data-proef": "icoon" }), actie: createElement("b", null, "ACTIE"), children: "x" }));
    const kop = /<div class="flex min-w-0 flex-\[1_1_12rem\] items-center gap-3">([\s\S]*?)<\/div><div class="ml-auto shrink-0">/.exec(sectie)?.[1] ?? "";
    check("het icoon, de titel en het bijschrift zitten samen in één blok dat zelf niet omloopt", kop.includes('data-proef="icoon"') && kop.includes("<h2") && kop.includes("Een bijschrift") && !/flex-wrap/.test(kop), kop.slice(0, 160));
    check("de actie staat erbuiten: alleen die breekt naar een eigen regel", !kop.includes("ACTIE") && sectie.includes("ACTIE"));
    const deel = bijeen(createElement(Deelkop, { titel: "Jaaroverzicht", icoon: createElement("i", { "data-proef": "icoon" }) }));
    check("een deelkop net zo", /<div class="flex min-w-0 flex-\[1_1_12rem\] items-center gap-3"><div[^>]*><i data-proef="icoon"><\/i><\/div><div class="min-w-0"><h3/.test(deel), deel.slice(0, 200));
    check("dezelfde tekst als in de vertrouwde kop: er verdwijnt niets, alleen de omloop verandert",
      tekst(sectie) === tekst(renderToStaticMarkup(createElement(Sectie, { titel: "Gezondheid, pacing en markten", bijschrift: "Een bijschrift dat op een telefoon over twee regels loopt.", actie: createElement("b", null, "ACTIE"), children: "x" }))));
  }

  // ── Koppeling, Microsoft, vensters  }

  // ── Koppeling, Microsoft, vensters ────────────────────────────────────────────────────────────
  console.log("\nWat verhuisde blijft zichtbaar: de koppelstatus, de regel over Microsoft, de vensters");
  {
    check("een statusaanroep die mislukt is een waarschuwing, geen 'gekoppeld'", JSON.stringify(koppelStatusMeta("fout", null)) === JSON.stringify({ kind: "warning", label: "Status onbekend" }));
    check("een benoemd probleem draagt zijn label", JSON.stringify(koppelStatusMeta({ status: "expired" }, "Toegang verlopen")) === JSON.stringify({ kind: "warning", label: "Toegang verlopen" }));
    check("zonder probleem: gekoppeld; nog onderweg: laden", koppelStatusMeta({ status: "active" }, null).kind === "connected" && koppelStatusMeta(null, null).kind === "loading");

    check("de regel over Microsoft zegt waar het wel meetelt, waar niet, en waar de eigen cijfers staan",
      MICROSOFT_UITLEG.includes("telt mee in de kerncijfers") && MICROSOFT_UITLEG.includes("In de markten nog niet") && MICROSOFT_UITLEG.includes("tabblad Microsoft"));
    const label = metPeriode(createElement(Vensterlabel, { soort: "vast", venster: "laatste 180 dagen", toevoeging: "zonder Microsoft", toevoegingUitleg: MICROSOFT_UITLEG }));
    check("het label toont het korte voorbehoud en draagt de hele zin in zijn uitleg", tekst(label) === "vast venster · laatste 180 dagen · zonder Microsoft" && label.includes("tabblad Microsoft"), label);
    // Een klant met één land heeft geen lade waar de zin in kan staan: daar staat hij open.
    const land = { code: "NL", impressions: 1000, clicks: 100, cost: 500, conversions: 12, conversionsValue: 0 };
    const enkel = metPeriode(createElement(GeoEnkelLandKaart, { channel: "blended", land, voorbehoud: "zonder Microsoft", voorbehoudUitleg: MICROSOFT_UITLEG }));
    check("één land: de hele zin staat open in de kaart, niet alleen in een tooltip", tekst(enkel).includes("In de markten nog niet; de eigen Microsoft-cijfers staan op het tabblad Microsoft."), tekst(enkel).slice(0, 300));
    check("één land in de vertrouwde weergave: geen regel erbij", !/data-venster-uitleg/.test(metPeriode(createElement(GeoEnkelLandKaart, { channel: "blended", land }))));
    // De nieuwe weergave volgt de kiezer per dag, ook als er geen of één land is (een kanaal dat in
    // de periode nog niet liep): dan geen "laatste 180 dagen" in het label.
    const perDag = tekst(metPeriode(createElement(GeoEnkelLandKaart, { channel: "meta", land: null, voorbehoud: "zonder Meta", voorbehoudUitleg: "Meta liep in deze periode nog niet.", perDag: true })));
    check("geen of één land in de nieuwe weergave: het label volgt de periode", perDag.includes("volgt periode") && !perDag.includes("laatste 180 dagen"), perDag.slice(0, 200));
    // Meerdere landen, maar geen rijen voor de gekozen metriek: dan is er geen lade onder de kaart.
    const leeg = {
      metricKey: "cpa", setMetricKey: () => {}, metric: METRICS.find((m) => m.key === "conversions")!, focus: null, setFocus: () => {},
      countries: [{ ...land, code: "NL" }, { ...land, code: "DE" }], states: [], laden: false, canDrillUs: false, labelOf: (c: string) => c, geoWord: "land",
      ranked: [], values: new Map(), totaal: { impressions: 0, clicks: 0, cost: 0, conversions: 0 }, eenLandOfMinder: false,
    } as unknown as GeoBreakdownState;
    const legeKaart = metPeriode(createElement(GeoMapCard, { state: leeg, channel: "blended", naast: null, vensterToevoeging: "zonder Microsoft", vensterUitleg: MICROSOFT_UITLEG }));
    check("geen rijen voor de metriek: de hele zin staat open onder 'geen data', niet alleen in een tooltip",
      tekst(legeKaart).includes("Geen land-data voor deze metric.") && /<p[^>]*data-venster-uitleg[^>]*>[^<]*tabblad Microsoft\.<\/p>/.test(legeKaart), tekst(legeKaart).slice(0, 300));
    check("... en in de vertrouwde weergave (zonder de uitleg) staat er alleen 'geen data'",
      !/data-venster-uitleg/.test(metPeriode(createElement(GeoMapCard, { state: leeg, channel: "blended" }))));
    const kortLabel = metPeriode(createElement(Vensterlabel, { soort: "vast", venster: "laatste 180 dagen", toevoeging: "zonder Microsoft" }));
    check("zonder de uitleg is het label wat het was", /title="[^"]*volgt de gekozen periode niet\. zonder Microsoft\."/.test(kortLabel), kortLabel);
  }

  // ── Bediening ─────────────────────────────────────────────────────────────────────────────────
  console.log("\nBediening: de snelkoppelingen, de schakelaar en de weg terug naar alle kanalen");
  {
    for (const k of SNELKOPPELINGEN) check(`${k.kort}: de naam begint met wat er op de knop staat`, snelkoppelingNaam(k).startsWith(`${k.kort}, `) && snelkoppelingNaam(k).length > k.kort.length + 4, snelkoppelingNaam(k));
    const snel = renderToStaticMarkup(createElement(PeriodeSnelkoppelingen, { preset: SNELKOPPELINGEN[0].preset, onKies: () => {} }));
    const paren = [...snel.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
    check("gerenderd: elke knop heet naar zijn zichtbare tekst", paren.length === SNELKOPPELINGEN.length && paren.every((m) => m[1].includes(m[2])), paren.map((m) => `${m[2]}=${m[1]}`).join("; "));

    const compact = renderToStaticMarkup(createElement(WeergaveSchakelaar, { weergave: "nieuw", onKies: () => {}, compactOpTelefoon: true }));
    const gewoon = renderToStaticMarkup(createElement(WeergaveSchakelaar, { weergave: "oud", onKies: () => {} }));
    check("de schakelaar zonder label (telefoon, nieuwe weergave): een tikvlak van 44 bij 44 px", /\bmin-h-11\b/.test(compact) && /\bmin-w-11\b/.test(compact) && /sm:min-h-7/.test(compact));
    check("... met een spoor in de donkere merkkleur", /bg-brand-blue-ink/.test(compact));
    check("in de vertrouwde weergave is de schakelaar wat hij was", /class="inline-flex shrink-0[^"]*min-h-7"/.test(gewoon) && !/min-h-11/.test(gewoon) && /bg-muted-foreground\/40/.test(gewoon), gewoon.slice(0, 300));
    check("in beide een schakelaar met dezelfde naam", [compact, gewoon].every((h) => /role="switch"/.test(h) && /Nieuwe weergave/.test(h)));

    // De weg terug staat IN de gekozen kaart: zichtbaar zonder muis, en zonder hoogte toe te voegen.
    check("een klik op de gekozen kaart is terug naar alle kanalen; op een andere kaart is dat kanaal",
      volgendeKanaalkeuze("meta", "meta") === "blended" && volgendeKanaalkeuze("meta", "google") === "google" && volgendeKanaalkeuze("blended", "meta") === "meta");
    const health: HealthScore = { total: 80, grade: "B", color: "", assessedCount: 4, anomalies: [], factors: [] };
    const kaarten: Kanaalkaart[] = (["google", "meta"] as const).map((kanaal) => ({ kanaal, cijfers: null, health: { soort: "score", health }, stand: null }));
    const rij = (keuze: "blended" | "meta") => metPeriode(createElement(Kanaalkaarten, { kaarten, gekozen: keuze, onKies: () => {} }));
    const knoppenVan = (html: string) => [...html.matchAll(/<button\b[^>]*aria-label="([^"]*)"[^>]*aria-pressed="(true|false)"[^>]*>((?:(?!<\/button>)[\s\S])*)<\/button>/g)].map((m) => ({ naam: m[1], gekozen: m[2] === "true", html: m[3] }));
    const opMeta = knoppenVan(rij("meta"));
    check("de fixture: twee kaarten, Meta gekozen", opMeta.length === 2 && opMeta.find((k) => k.naam === "Meta")?.gekozen === true && opMeta.find((k) => k.naam === "Google Ads")?.gekozen === false, opMeta.map((k) => `${k.naam}:${k.gekozen}`).join());
    const zichtbaar = (h: string) => tekst(h.replace(/<span[^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/g, " "));
    check("de gekozen kaart zegt zichtbaar 'alle kanalen', met een kruisje", /data-kanaalfilter="meta"[^>]*>\s*<svg[\s\S]*?<\/svg>alle kanalen<\/span>/.test(opMeta.find((k) => k.naam === "Meta")!.html) && zichtbaar(opMeta.find((k) => k.naam === "Meta")!.html).includes("alle kanalen"));
    check("... een kaart die niet gekozen is niet", !/alle kanalen/.test(zichtbaar(opMeta.find((k) => k.naam === "Google Ads")!.html)) && !/data-kanaalfilter/.test(opMeta.find((k) => k.naam === "Google Ads")!.html));
    check("... en op Alle kanalen geen enkele", !/data-kanaalfilter/.test(rij("blended")));
    check("gefilterd of niet: de rij is één blok en niets eronder (geen regel die hoogte toevoegt)",
      [rij("meta"), rij("blended")].every((h) => h.startsWith("<section") && h.endsWith("</section>") && h.indexOf("</section>") === h.length - "</section>".length));
    check("het aanwijsje is lager dan de regel van de naam: de kaart wordt er niet hoger van", /data-kanaalfilter="meta"[^>]*class="[^"]*\bpy-px\b[^"]*\btext-micro\b[^"]*\bleading-none\b/.test(rij("meta")));

    // De hoofdgrafiek in de stand Kosten: de kanaalnaam kan afgekapt zijn, dus staat hij ook voluit.
    const reeks = (naam: string): BronReeks => ({ naam, vanaf: null, geladenVanaf: null, maanden: new Map([["2026-07", { adSpend: 1_250_000, conversions: 300, revenue: 0 }], ["2026-08", { adSpend: 1_300_000, conversions: 320, revenue: 0 }]]) });
    const maanden = grafiekMaanden({ google: reeks("google"), microsoft: reeks("microsoft"), linkedin: reeks("linkedin") }, ["google", "microsoft", "linkedin"], { start: "2026-07", end: "2026-08" });
    const grafiek = (beginMaat: "adSpend" | "conversions") => metPeriode(createElement(OverzichtHoofdgrafiek, { maanden, kanalen: ["google", "microsoft", "linkedin"], gekozen: null, beginMaat }));
    check("Kosten: elke kanaalnaam in de zijlijst draagt zijn volledige naam", ["Google Ads", "Microsoft Ads", "LinkedIn"].every((n) => new RegExp(`<span class="truncate" title="${n}">${n}</span>`).test(grafiek("adSpend"))));
    check("Kosten: de zijlijst is breder dan in de stand Conversies", /lg:block w-72/.test(grafiek("adSpend")) && /lg:block w-64/.test(grafiek("conversions")));
  }

  // ── De kanaalrij houdt zijn hoogte vrij ───────────────────────────────────────────────────────
  console.log("\nDe kanaalrij: vrijhouden waar bekend is dat hij komt, en de server weet het ook");
  {
    const r = (kanalenBekend: boolean, geheugen: "1" | "0" | null, nieuw: boolean, meerdereVerwacht = false) => reserveerKaartenrij({ kanalenBekend, geheugen, nieuw, meerdereVerwacht });
    check("een onbekende klant: niet vrijhouden, ook niet in de nieuwe weergave (62 van de 71 hebben één kanaal)", !r(false, null, true) && !r(false, null, false));
    check("een onbekende klant waarvan vaststaat dat hij meer kanalen heeft (de demo): vrijhouden", r(false, null, true, true));
    check("... maar niet in de vertrouwde weergave: die is wat hij was", !r(false, null, false, true));
    check("er was een balk: vrijhouden, in beide weergaven", r(false, "1", true) && r(false, "1", false));
    check("er was geen balk: niet vrijhouden, ook niet bij de demo", !r(false, "0", true) && !r(false, "0", false) && !r(false, "0", true, true));
    check("zodra de kanalen bekend zijn: nooit, de rij staat er of staat er niet", !r(true, null, true, true) && !r(true, "1", true) && !r(true, "0", false));
    check("de demo is aan zijn id te herkennen, op de server en in de browser hetzelfde", isDemoClientId("demo-greentech") && isDemoClientId("gads-demo-greentech") && !isDemoClientId("gads-1234567890"));

    // De cookie: één per klant, onder het pad van die klantpagina.
    check("de cookie zegt '1', '0' of niets", kanaalbalkUitCookie("1") === "1" && kanaalbalkUitCookie("0") === "0"
      && [null, undefined, "", "2", "ja", "demo-greentech:1"].every((v) => kanaalbalkUitCookie(v) === null));
    check("het pad is dat van de klantpagina, ook vanaf een dieper adres", kanaalbalkPad("/client/demo-greentech") === "/client/demo-greentech" && kanaalbalkPad("/client/gads-123/iets/dieper") === "/client/gads-123");
    check("... letterlijk zoals het in de adresbalk staat, niet opnieuw gecodeerd", kanaalbalkPad("/client/klant%20een") === "/client/klant%20een");
    check("buiten een klantpagina is er geen pad, en dus geen cookie", [null, "", "/", "/portfolio", "/clients/x", "/client/", "/client"].every((v) => kanaalbalkPad(v) === null && kanaalbalkCookieRegel(true, v) === null));
    check("een pad met een teken dat de cookie-regel zou breken geeft geen cookie", kanaalbalkCookieRegel(true, "/client/a;domain=x") === null && kanaalbalkCookieRegel(true, "/client/a b") === null);
    check("de regel: de stand, het pad van deze klant, een jaar", kanaalbalkCookieRegel(true, "/client/demo-greentech") === "kanaalbalk=1; path=/client/demo-greentech; max-age=31536000; samesite=lax"
      && kanaalbalkCookieRegel(false, "/client/gads-123/x") === "kanaalbalk=0; path=/client/gads-123; max-age=31536000; samesite=lax");
    // Wat de browser bewaart, leest de server terug: de waarde van de regel is wat de cookie zegt.
    const waarde = (regel: string | null) => regel!.slice(regel!.indexOf("=") + 1, regel!.indexOf(";"));
    check("heen en terug", kanaalbalkUitCookie(waarde(kanaalbalkCookieRegel(true, "/client/x"))) === "1" && kanaalbalkUitCookie(waarde(kanaalbalkCookieRegel(false, "/client/x"))) === "0");
    check("de cookie groeit niet mee met het aantal klanten: geen id in de waarde", [...Array(200).keys()].every((i) => waarde(kanaalbalkCookieRegel(i % 2 === 0, `/client/klant-${i}`)).length === 1));
  }

  // ── De bovenbalk  }

  // ── De bovenbalk ──────────────────────────────────────────────────────────────────────────────
  console.log("\nDe bovenbalk: het script in de <head> volgt dezelfde regel als de pagina");
  {
    const draai = (inp: { pad: string; zoek: string; opslag: string | null | "gooit"; cookie: string }): boolean => {
      const gezet: Record<string, string> = {};
      const location = { pathname: inp.pad, search: inp.zoek };
      const localStorage = { getItem: (k: string) => { if (inp.opslag === "gooit") throw new Error("geblokkeerd"); return k === WEERGAVE_SLEUTEL ? inp.opslag : null; } };
      const document = { cookie: inp.cookie, documentElement: { setAttribute: (k: string, v: string) => { gezet[k] = v; } } };
      new Function("location", "localStorage", "document", WEERGAVE_INIT_SCRIPT)(location, localStorage, document);
      return gezet[CHROME_ATTRIBUUT] === "nieuw";
    };
    const paden = ["/client/demo-greentech", "/client/gads-1/iets", "/portfolio", "/", "/clients"];
    const urls = [null, "nieuw", "oud", "iets"];
    const opslagen: (string | null)[] = [null, "nieuw", "oud", "kapot"];
    const cookies: (string | null)[] = [null, "nieuw", "oud"];
    let gelijk = 0, totaal = 0;
    const afwijkend: string[] = [];
    for (const pad of paden) for (const url of urls) for (const opslag of opslagen) for (const cookie of cookies) {
      totaal += 1;
      const script = draai({ pad, zoek: url ? `?demo=1&weergave=${url}` : "?demo=1", opslag, cookie: cookie ? `thema=donker; ${WEERGAVE_SLEUTEL}=${cookie}; x=1` : "thema=donker" });
      // De pagina: de adresbalk, dan een geldige opslag, dan de cookie (useNieuweChrome).
      const pagina = chromeIsNieuw({ pad, url, bewaard: (opslag === "nieuw" || opslag === "oud" ? opslag : null) ?? cookie });
      if (script === pagina) gelijk += 1; else afwijkend.push(`${pad} url=${url} opslag=${opslag} cookie=${cookie}: script ${script}, pagina ${pagina}`);
    }
    check(`het script en de pagina zijn het eens in alle ${totaal} gevallen`, gelijk === totaal, afwijkend.slice(0, 4).join(" | "));
    check("buiten een klantpagina zet het script niets, wat de keuze ook is", !draai({ pad: "/portfolio", zoek: "?weergave=nieuw", opslag: "nieuw", cookie: `${WEERGAVE_SLEUTEL}=nieuw` }));
    check("op een klantpagina met de keuze 'nieuw' wel", draai({ pad: "/client/x", zoek: "", opslag: "nieuw", cookie: "" }));
    check("een geblokkeerde opslag is geen fout: dan telt de cookie", draai({ pad: "/client/x", zoek: "", opslag: "gooit", cookie: `${WEERGAVE_SLEUTEL}=nieuw` }) && !draai({ pad: "/client/x", zoek: "", opslag: "gooit", cookie: "" }));
    check("standaard uit: zonder keuze zet het script niets", STANDAARD_WEERGAVE === "oud" && !draai({ pad: "/client/x", zoek: "", opslag: null, cookie: "" }));
    // De standaard staat op één plek. Het script is tekst: hier wordt nagegaan dat het de waarde
    // van de constante DRAAGT (dezelfde uitkomst als kiesWeergave zonder keuze), en dat er geen
    // tweede, uitgeschreven terugval in staat.
    check("... en volgt daarin dezelfde constante als de pagina", draai({ pad: "/client/x", zoek: "", opslag: null, cookie: "" }) === (kiesWeergave({ url: null, bewaard: null }) === "nieuw")
      && kiesWeergave({ url: null, bewaard: null }) === STANDAARD_WEERGAVE && kiesWeergave({ url: "iets", bewaard: "kapot" }) === STANDAARD_WEERGAVE);
    const metAndereStandaard = WEERGAVE_INIT_SCRIPT.split(JSON.stringify(STANDAARD_WEERGAVE)).join(JSON.stringify(STANDAARD_WEERGAVE === "oud" ? "nieuw" : "oud"));
    const gezet: Record<string, string> = {};
    new Function("location", "localStorage", "document", metAndereStandaard)({ pathname: "/client/x", search: "" }, { getItem: () => null }, { cookie: "", documentElement: { setAttribute: (k: string, v: string) => { gezet[k] = v; } } });
    check("... de terugval in het script is die ene waarde: een andere waarde op die plek keert de uitkomst om", (gezet[CHROME_ATTRIBUUT] === "nieuw") === (STANDAARD_WEERGAVE === "oud"), JSON.stringify(gezet));
  }

  // ── Het oordeel ───────────────────────────────────────────────────────────────────────────────
  console.log("\nHet oordeel: de normen van het bouwplan naast een meting");
  {
    const proef = zelftest();
    check("de zelftest slaagt", proef.ok && proef.normen === NORMEN.length, proef.fouten.join(" | "));
    const goed = beoordeel(goedeMeting()), slecht = beoordeel(slechteMeting());
    check("de goede meting haalt elke meetbare norm", goed.nietGehaald === 0 && goed.mislukt === 0 && goed.gehaald === NORMEN.length, `${goed.gehaald}/${NORMEN.length}`);
    check("de slechte meting haalt er geen", slecht.gehaald === 0 && slecht.nietGehaald === NORMEN.length, `${slecht.nietGehaald}/${NORMEN.length}`);
    check("wat niet uit een meting te lezen is, heet 'niet gemeten' en nooit 'gehaald'", goed.nietGemeten > 0 && goed.regels.filter((r) => !NORMEN.some((n) => n.id === r.id)).every((r) => r.uitkomst === NIET_GEMETEN));
    const leeg = beoordeel({ runs: [] });
    check("een lege meting haalt niets en schendt niets", leeg.gehaald === 0 && leeg.nietGehaald === 0 && leeg.mislukt === 0 && leeg.regels.every((r) => r.uitkomst === NIET_GEMETEN));

    // De meting is JSON uit een script: hier los getypeerd, zodat de test er elk veld in kan zetten.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Meting = { runs: any[] };
    const uitkomst = (pas: (m: Meting) => void, welke: string) => { const m = goedeMeting() as unknown as Meting; pas(m); return beoordeel(m).regels.filter((r) => r.uitkomst === welke).map((r) => r.id).join(); };
    const metEen = (pas: (m: Meting) => void) => uitkomst(pas, NIET_GEHAALD);

    // Elke norm apart, met de getallen van het bouwplan uitgeschreven: op de grens gehaald, één
    // stap erover niet, en alleen die norm slaat om. De plek in de meting staat hier los van het
    // script getypt, zodat een norm die uit de verkeerde run leest hier ook door de mand valt.
    const desktop = 0, traag = 1, mobiel = 2;
    const GRENZEN: [string, (m: Meting, v: number) => void, number, number][] = [
      ["A1", (m, v) => { m.runs[desktop].wissels[3].volgtPeriode = { blokken: 100, veranderd: v, stil: [], dicht: [] }; }, 90, 89],
      ["A1b", (m, v) => { m.runs[desktop].dichteVolgers["Alle kanalen"] = { blokken: 100, geopend: 100, veranderd: v, stil: [], nietGeopend: [] }; }, 90, 89],
      ["A2", (m, v) => { m.runs[desktop].wissels[2].api.verzoeken = v; }, 0, 1],
      ["A3", (m, v) => { m.runs[desktop].wissels[0].api.verzoeken = v; }, 0, 1],
      ["A4", (m, v) => { m.runs[desktop].wissels[0].eersteVeranderingMs = v; }, 99, 100],
      ["C1", (m, v) => { m.runs[desktop].laden.eersteKerncijfer.y = v; }, 350, 351],
      ["C2", (m, v) => { m.runs[mobiel].laden.eersteKerncijfer.y = v; }, 250, 251],
      ["D1", (m, v) => { m.runs[desktop].laden.eersteKerncijferMs = v; }, 1000, 1001],
      ["D2", (m, v) => { m.runs[traag].laden.eersteKerncijferMs = v; }, 1500, 1501],
      ["D3", (m, v) => { m.runs[desktop].laden.api.verzoeken = v; }, 12, 13],
      ["D4", (m, v) => { m.runs[desktop].laden.api.kb = v; }, 120, 121],
      ["D5", (m, v) => { m.runs[desktop].laden.cls = v; }, 0.099, 0.1],
      ["D6", (m, v) => { m.runs[mobiel].laden.cls = v; }, 0.099, 0.1],
      ["D7", (m, v) => { m.runs[traag].wissels[2].beeldjesBoven25ms = v; }, 0, 1],
      ["D8", (m, v) => { m.runs[desktop].laden.paginaHoogte = v; }, 3000, 3001],
      ["D9", (m, v) => { m.runs[mobiel].laden.paginaHoogte = v; }, 4500, 4501],
      ["E1", (m, v) => { m.runs[desktop].venstersPerKanaal["Alle kanalen"].conversietotalenZonderVenster = Array(v).fill({ totaal: "350", blok: "x" }); }, 0, 1],
      ["E2", (m, v) => { m.runs[desktop].venstersPerKanaal.Meta.zonderVenster = Array(v).fill("Maandprestaties #1"); }, 0, 1],
      ["E3", (m, v) => { m.runs[desktop].eerlijk.permanenteAnimaties = Array(v).fill("span.animate-pulse"); }, 0, 1],
    ];
    check("elke meetbare norm heeft hier zijn grens, op de herlaad na", GRENZEN.map((g) => g[0]).concat("A5").sort().join() === NORMEN.map((n) => n.id).sort().join());
    for (const [id, zet, grens, over] of GRENZEN) {
      check(`${id}: ${grens} is gehaald`, metEen((m) => zet(m, grens)) === "", metEen((m) => zet(m, grens)));
      check(`${id}: ${over} is niet gehaald, en alleen ${id}`, metEen((m) => zet(m, over)) === id, metEen((m) => zet(m, over)));
    }
    check("A5: een andere toestand na de herlaad is niet gehaald", metEen((m) => { m.runs[desktop].herlaad.zelfdeToestand = false; }) === "A5");

    // De verkeerde run mag slecht zijn zonder dat de norm van een andere run omslaat.
    check("een trage eerste reactie in de trage run raakt A4 niet (die gaat over de snelle)", metEen((m) => { m.runs[traag].wissels[0].eersteVeranderingMs = 900; }) === "");
    check("een hoge mobiele pagina raakt de desktopnorm niet, en andersom", metEen((m) => { m.runs[mobiel].laden.paginaHoogte = 4400; }) === "" && metEen((m) => { m.runs[desktop].laden.paginaHoogte = 3001; m.runs[mobiel].laden.paginaHoogte = 3001; }) === "D8");
    check("gemiste beeldjes in de snelle run raken D7 niet (die gaat over de trage)", metEen((m) => { m.runs[desktop].wissels[0].beeldjesBoven25ms = 9; }) === "");
    check("een blok zonder venster op een kanaaltabblad telt mee", metEen((m) => { m.runs[desktop].venstersPerKanaal.Meta = { ...m.runs[desktop].vensters, zonderVenster: ["Maandprestaties #1"] }; }) === "E2");

    // Een wissel die fout ging is geen schoon oordeel.
    const mislukt = (pas: (m: Meting) => void) => uitkomst(pas, MISLUKT);
    check("een periodewissel die fout ging: A1, A2 en A4 zijn mislukt, niet 'niet gemeten'", mislukt((m) => { m.runs[desktop].wissels[2].fout = "knop niet gevonden"; }) === "A1,A2,A4");
    check("... ook als er daarnaast een wissel wel lukte en ook als ze allemaal fout gingen",
      mislukt((m) => { for (const w of m.runs[desktop].wissels) if (w.label.startsWith("periode")) w.fout = "time-out"; }) === "A1,A2,A4");
    check("een kanaalwissel die fout ging: A3 en A4", mislukt((m) => { m.runs[desktop].wissels[0].fout = "time-out"; }) === "A3,A4");
    check("een wissel die in de trage run fout ging: D7", mislukt((m) => { m.runs[traag].wissels[3].fout = "time-out"; }) === "D7");
    check("een herlaad die fout ging: A5", mislukt((m) => { m.runs[desktop].herlaad = { fout: "time-out" }; }) === "A5");
    check("mislukt is geen 'niet gehaald' en geen 'gehaald', en wordt apart geteld", (() => {
      const m = goedeMeting() as unknown as Meting; m.runs[desktop].wissels[2].fout = "x";
      const o = beoordeel(m);
      return o.mislukt === 3 && o.nietGehaald === 0 && o.gehaald === NORMEN.length - 3 && o.regels.find((r) => r.id === "A2")!.getoond.includes("periode: -> Laatste 3 maanden");
    })());
    check("een kanaal dat de klant niet heeft is geen mislukte meting", mislukt((m) => { m.runs[desktop].kanalenOvergeslagen = ["LinkedIn", "Microsoft"]; m.runs[desktop].dichteVolgers.Microsoft = { fout: "tabblad niet beschikbaar" }; }) === "");

    // De dichte blokken: de afwijking van het bouwplan, gemeten.
    check("een dicht blok dat niet openging telt als stil", metEen((m) => { m.runs[desktop].dichteVolgers.Meta = { blokken: 2, geopend: 1, veranderd: 1, stil: [], nietGeopend: ["Maandprestaties #1"] }; }) === "A1b");
    check("een tabblad dat niet te meten was: mislukt", mislukt((m) => { m.runs[desktop].dichteVolgers.Meta = { fout: "time-out" }; }) === "A1b");
    check("zonder dichte blokken valt er niets te schenden", metEen((m) => { m.runs[desktop].dichteVolgers = { "Alle kanalen": { blokken: 0, geopend: 0, veranderd: 0, stil: [], nietGeopend: [] } }; }) === "");
    check("een meting van voor die stap is op A1b niet gemeten, niet gehaald", (() => {
      const m = goedeMeting() as unknown as Meting; delete m.runs[desktop].dichteVolgers;
      return beoordeel(m).regels.find((r) => r.id === "A1b")!.uitkomst === NIET_GEMETEN;
    })());
    check("de norm zegt zelf dat hij van het bouwplan afwijkt", NORMEN.find((n) => n.id === "A1")!.norm.includes("open blokken") && NORMEN.find((n) => n.id === "A1")!.norm.includes("A1b"));

    // De meting van 12 november, zoals hij in de repo staat: het oordeel dat de eigenaar las.
    const echt = JSON.parse(readFileSync(join(import.meta.dirname, "..", "scripts", "metingen", "2026-11-12-4-5-nieuw.json"), "utf8"));
    const o = new Map(beoordeel(echt).regels.map((r) => [r.id, r]));
    check("de meting van 12 november: CLS op desktop niet gehaald (0,215), op mobiel wel", o.get("D5")?.uitkomst === NIET_GEHAALD && o.get("D5")?.waarde === 0.215 && o.get("D6")?.uitkomst === GEHAALD);
    check("... de hoogte niet gehaald op beide (3184 en 5814 px)", o.get("D8")?.waarde === 3184 && o.get("D9")?.waarde === 5814 && o.get("D8")?.uitkomst === NIET_GEHAALD && o.get("D9")?.uitkomst === NIET_GEHAALD);
    check("... een periodewissel kost geen verzoek, en de toestand overleeft een herlaad", o.get("A2")?.uitkomst === GEHAALD && o.get("A5")?.uitkomst === GEHAALD);
    check("... 'volgt periode' rond de helft, zoals gemeten", o.get("A1")?.uitkomst === NIET_GEHAALD && Math.round((o.get("A1")?.waarde ?? 0) * 100) === 50, String(o.get("A1")?.waarde));
    check("... en de dichte blokken zijn in die meting niet geopend: niet gemeten", o.get("A1b")?.uitkomst === NIET_GEMETEN);
  }

  console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
  if (gefaald > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
