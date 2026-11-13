// Gedragstest: de kerncijfers van het Overzicht al in de HTML van de server
// (components/dashboard/band-uit-zaad.tsx).
// Draaien: tsx --tsconfig ./tsconfig.json lib/overzicht/__band_uit_zaad_test.ts
//
// Wat hier vastligt, telkens door echt te renderen (react-dom/server en react-dom/static), niet
// door de bron te lezen:
// - DE SERVER WACHT OP HET ZAAD: prerender met beloften die nog lopen geeft de tegels met getallen,
//   niet het laadvlak;
// - GEEN HYDRATIEVERSCHIL: de browser rendert met dezelfde (dan al vervulde) beloften exact dezelfde
//   HTML, ook vlak na middernacht op de laatste dag van een maand, met een bewaarde andere periode,
//   in de nieuwe en de vertrouwde vorm, en met ?kanaal=;
// - GEEN ANDER GETAL: de tegels uit het zaad zijn letterlijk de band die de browser toont zodra zijn
//   hooks klaar zijn (useChannelPeriodData, de PeriodProvider, PeriodSummary), voor elk kanaal;
// - ZONDER BRUIKBAAR ZAAD het gewone laadvlak (een fout, geen data, geen toegang);
// - de cookie met de periode: heen en terug dezelfde keuze, alleen onder het pad van de klant;
// - zaadNogVers: de eerste keer ja (het hydrateren), later alleen binnen de minuut;
// - een afgebroken stroom wordt null (het laadvlak), geen fout die het Overzicht laat vallen.

import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { BandUitZaad, bandUitZaad, zonderAfwijzing, type BandZaad } from "../../components/dashboard/band-uit-zaad";
import { PeriodSummary } from "../../components/dashboard/period-summary";
import { PeriodProvider } from "../period/period-context";
import { bandDataStand } from "../period/band-stand";
import { googleHeeftData } from "../period/apply-period";
import { kanaalkeuzeUitUrl, kanalenUitBronnen, type Kanaal } from "../kanalen/beschikbaar";
import { useChannelPeriodData } from "../use-channel-period-data";
import { googleDataUitAntwoord, type GoogleAntwoord } from "../use-client-data";
import type { BlendedAntwoord, BlendedApiResponse } from "../use-blended-client-data";
import { opDag, today } from "../reporting-date";
import { PERIODE_COOKIE, periodeCookieRegel, periodeUitCookie } from "../period/periode-cookie";
import { DEFAULT_COMPARISON, type PeriodeKeuze } from "../period/period-range";
import { zaadNogVers, ZAAD_VERS_MS, type Zaad } from "./zaadbak";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De klok: een vast moment, zoals op de server of in de browser ──────────────────────────────
const EchteDate = Date;
function zetKlok(iso: string | null): void {
  if (iso === null) { globalThis.Date = EchteDate; return; }
  const t = new EchteDate(iso).getTime();
  class VasteDate extends EchteDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(t);
      else super(...(a as [string]));
    }
    static now(): number { return t; }
  }
  globalThis.Date = VasteDate as DateConstructor;
}

// ── De antwoorden zoals de routes ze geven ──────────────────────────────────────────────────────
const ID = "gads-1234";
const maand = (m: number, f: number) => ({
  month: m, conversions: 100 + m * 3 + f, revenue: 9000 + m * 110 + f * 7, adSpend: 4000 + m * 37 + f,
  impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0,
});
/** Google t/m `tot` (een maand van 2026), met de stand van de route. */
function google(tot: number): GoogleAntwoord {
  return {
    currentYear: 2026,
    realizedThroughMonth: tot,
    targetCurrentYear: { conversions: 1650, revenue: 0, adSpend: 50000 },
    historicalYears: [2024, 2025].map((year) => ({ year, monthly: Array.from({ length: 12 }, (_, i) => maand(i + 1, year - 2020)), weekly: [] })),
    currentYearMonthly: Array.from({ length: tot }, (_, i) => maand(i + 1, 9)),
    currentYearWeekly: [],
    dataStand: { laatsteVolleMaand: `2026-${String(tot).padStart(2, "0")}`, partieel: null, dataTot: `2026-${String(tot).padStart(2, "0")}-${tot === 11 ? 30 : 31}`, uitgesloten: [] },
  };
}
/** De blended route: Meta sinds maart 2025 (halverwege begonnen), LinkedIn het hele jaar, geen Microsoft. */
function blended(tot: number): BlendedApiResponse {
  const maanden = (van: string, f: number) => {
    const uit: { month: string; conversions: number; revenue: number; adSpend: number }[] = [];
    for (let j = 2024; j <= 2026; j++) for (let m = 1; m <= 12; m++) {
      const k = `${j}-${String(m).padStart(2, "0")}`;
      if (k < van || (j === 2026 && m > tot)) continue;
      uit.push({ month: k, conversions: 20.5 + m * f, revenue: 1100 + m * 13 * f, adSpend: 700 + m * 9 * f });
    }
    return uit;
  };
  const dag = `2026-${String(tot).padStart(2, "0")}-${tot === 11 ? 30 : 31}`;
  return {
    currentYear: 2026, realizedThroughMonth: tot, targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears: [], currentYearMonthly: [],
    dataStand: {
      laatsteVolleMaand: `2026-${String(tot).padStart(2, "0")}`, partieel: null, dataTot: dag, uitgesloten: [],
      bronnen: [
        { bron: "google", dataTot: dag, syncDraait: true },
        { bron: "meta", dataTot: dag, syncDraait: true, laatsteRij: dag },
        { bron: "linkedin", dataTot: dag, syncDraait: true, laatsteRij: dag },
      ],
    },
    perKanaal: [
      { kanaal: "google", vanaf: null, maanden: [] },
      { kanaal: "meta", vanaf: "2025-04", eersteDag: "2025-03-17", laatsteDag: dag, maanden: maanden("2025-03", 3) },
      { kanaal: "linkedin", vanaf: "2024-01", eersteDag: "2024-01-01", laatsteDag: dag, maanden: maanden("2024-01", 1) },
    ],
  } as unknown as BlendedApiResponse;
}

/** Een belofte zoals React hem in de browser uit de serverstroom krijgt: al vervuld. */
function vervuld<T>(waarde: T): Promise<T> {
  const p = Promise.resolve(waarde) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled";
  p.value = waarde;
  return p;
}
const lopend = <T>(waarde: T): Promise<T> => new Promise((r) => setTimeout(() => r(waarde), 5));

async function serverHtml(el: ReactElement): Promise<string> {
  const { prelude } = await prerender(el);
  const delen: string[] = [];
  const lezer = prelude.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await lezer.read();
    if (done) break;
    delen.push(dec.decode(value, { stream: true }));
  }
  return delen.join("") + dec.decode();
}

const LAST_12M: PeriodeKeuze = { preset: "last_12m", custom: null, comparison: DEFAULT_COMPARISON };
const LAST_3M_VJ: PeriodeKeuze = { preset: "last_3m", custom: null, comparison: "same_period_last_year" };

/** De klantpagina rond de cijfers uit het zaad: de provider met de keuze die server en browser kennen. */
function zaadBoom(z: BandZaad, keuze: PeriodeKeuze, vorm: "band" | "tegels"): ReactElement {
  return createElement(PeriodProvider, { scope: `client-${z.clientId}`, beginKeuze: keuze, bewaarInCookie: true,
    children: createElement(BandUitZaad, { zaad: z, vorm }) });
}

/**
 * De browser NA het laden: dezelfde stappen als het klantdashboard op dezelfde antwoorden, met de
 * echte hook useChannelPeriodData, de PeriodProvider met de stand die het dashboard hem meegeeft,
 * en PeriodSummary met de data.
 */
function BrowserBand({ g, b, kanaal, keuze, vorm }: { g: GoogleAntwoord; b: BlendedApiResponse; kanaal: Kanaal | null; keuze: PeriodeKeuze; vorm: "band" | "tegels" }) {
  const googleData = googleDataUitAntwoord(ID, g);
  const route = { perKanaal: b.perKanaal ?? [], dataStand: b.dataStand ?? null, loading: false, error: null };
  const kanalen = kanalenUitBronnen({ googleLaadt: false, google: googleHeeftData(googleData), route: route.perKanaal.map((r) => r.kanaal), proefje: null });
  const channel = kanaalkeuzeUitUrl(kanaal, kanalen);
  const band = useChannelPeriodData({ clientId: ID, channel, googleData, route });
  const dataStand = bandDataStand({ channel, kanalen: kanalen ?? [], google: googleData.dataStand, laatsteDag: band.laatsteDag, route: route.dataStand });
  return createElement(PeriodProvider, { scope: `client-${ID}`, dataStand, beginKeuze: keuze,
    children: createElement(PeriodSummary, { data: band.data, bronnen: band.bronnen, vorm, laden: band.data === null }) });
}
function browserBoom(g: GoogleAntwoord, b: BlendedApiResponse, kanaal: Kanaal | null, keuze: PeriodeKeuze, vorm: "band" | "tegels"): ReactElement {
  return createElement(BrowserBand, { g, b, kanaal, keuze, vorm });
}

const zonderMarkering = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const tekst = (html: string) => zonderMarkering(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  // ── 1. De server wacht op het zaad, en de browser rendert byte voor byte hetzelfde ───────────
  for (const vorm of ["tegels", "band"] as const) {
    for (const [naam, keuze] of [["standaardperiode", LAST_12M], ["bewaarde andere periode (3 mnd, vorig jaar)", LAST_3M_VJ]] as const) {
      for (const kanaal of [null, "meta", "google", "microsoft"] as (Kanaal | null)[]) {
        const label = `${vorm}, ${naam}, kanaal ${kanaal ?? "alle"}`;
        zetKlok("2026-11-13T09:00:00Z");
        const vandaag = today();
        const server = await serverHtml(zaadBoom({ clientId: ID, google: lopend({ waarde: google(10) }), blended: lopend({ waarde: blended(10) as BlendedAntwoord }), kanaal, vandaag }, keuze, vorm));
        check(`${label}: de server rendert getallen en geen laadvlak`, /€\s?\d/.test(tekst(server)) && !/aria-busy|animate-pulse/.test(server), tekst(server).slice(0, 160));
        // De browser, een kwartier later, met de waarden die React uit de stroom meekreeg.
        zetKlok("2026-11-13T09:15:00Z");
        const browser = renderToString(zaadBoom({ clientId: ID, google: vervuld({ waarde: google(10) }), blended: vervuld({ waarde: blended(10) as BlendedAntwoord }), kanaal, vandaag }, keuze, vorm));
        check(`${label}: de browser rendert exact dezelfde HTML (geen hydratieverschil)`, browser === server, `\n server:  ${server.slice(0, 300)}\n browser: ${browser.slice(0, 300)}`);
        // En dat is letterlijk de band die de browser na het laden toont.
        const na = renderToString(browserBoom(google(10), blended(10), kanaal, keuze, vorm));
        check(`${label}: dezelfde tekst als de band na het laden (geen verspringend getal)`, tekst(na) === tekst(server), `\n na:   ${tekst(na).slice(0, 300)}\n zaad: ${tekst(server).slice(0, 300)}`);
        check(`${label}: dezelfde opmaak als de band na het laden`, zonderMarkering(na) === zonderMarkering(server));
      }
    }
  }
  zetKlok(null);

  // ── 2. Rond middernacht: de server op 30 november 23:59:59, de browser op 1 december 00:00:00 ─
  {
    // Data t/m november: op 30 november is oktober de laatste volle kalendermaand, op 1 december
    // november. Zonder de dag van de server kiest de browser dus een ander venster.
    zetKlok("2026-11-30T22:59:59.900Z");
    const vandaag = today();
    check("voorwaarde: de server zit nog op 30 november", vandaag === "2026-11-30", vandaag);
    const server = await serverHtml(zaadBoom({ clientId: ID, google: lopend({ waarde: google(11) }), blended: lopend({ waarde: blended(11) as BlendedAntwoord }), kanaal: null, vandaag }, LAST_12M, "tegels"));
    const naServer = renderToString(browserBoom(google(11), blended(11), null, LAST_12M, "tegels"));
    zetKlok("2026-12-01T00:00:00.300Z"); // 01:00 in Amsterdam
    check("voorwaarde: de browser zit al op 1 december", today() === "2026-12-01", today());
    const browser = renderToString(zaadBoom({ clientId: ID, google: vervuld({ waarde: google(11) }), blended: vervuld({ waarde: blended(11) as BlendedAntwoord }), kanaal: null, vandaag }, LAST_12M, "tegels"));
    check("middernacht: de browser hydrateert exact de HTML van de server", browser === server);
    const zonderVasteDag = renderToString(browserBoom(google(11), blended(11), null, LAST_12M, "tegels"));
    check("middernacht: zonder de dag van de server had de browser een ander venster gerenderd (de toets bijt)", tekst(zonderVasteDag) !== tekst(server) && tekst(naServer) === tekst(server), tekst(zonderVasteDag).slice(0, 120));
    check("opDag zet de klok terug, ook na afloop", today() === "2026-12-01" && opDag("2026-11-30", () => today()) === "2026-11-30" && today() === "2026-12-01");
    let gooide = false;
    try { opDag("2020-01-01", () => { throw new Error("x"); }); } catch { gooide = true; }
    check("opDag zet de klok terug als de berekening gooit", gooide && today() === "2026-12-01");
    zetKlok(null);
  }

  // ── 3. Zonder bruikbaar zaad: het gewone laadvlak, op server en browser hetzelfde ─────────────
  {
    zetKlok("2026-11-13T09:00:00Z");
    const vandaag = today();
    const laadvlak = renderToString(createElement(PeriodProvider, { scope: "x", children: createElement(PeriodSummary, { data: null, laden: true, vorm: "tegels" }) }));
    const gevallen: [string, Promise<Zaad<GoogleAntwoord> | null>, Promise<Zaad<BlendedAntwoord> | null>][] = [
      ["geen toegang (beide null)", lopend(null), lopend(null)],
      ["Google gaf een fout", lopend({ waarde: { error: "Google Ads API not configured" } }), lopend({ waarde: blended(10) as BlendedAntwoord })],
      ["geen blended data (de 404 van de route)", lopend({ waarde: google(10) }), lopend({ waarde: { error: 'Geen blended data voor "x"' } })],
      ["alleen Google ontbreekt", lopend(null), lopend({ waarde: blended(10) as BlendedAntwoord })],
    ];
    for (const [naam, g, b] of gevallen) {
      const html = await serverHtml(zaadBoom({ clientId: ID, google: g, blended: b, kanaal: null, vandaag }, LAST_12M, "tegels"));
      check(`${naam}: het laadvlak, zoals zonder zaad`, zonderMarkering(html) === zonderMarkering(laadvlak), zonderMarkering(html).slice(0, 200));
    }
    zetKlok(null);
  }

  // ── 3b. Een stroom die afbreekt: null, geen afwijzing die `use` naar de foutgrens gooit ───────
  {
    const afgebroken = new Promise<null>((_, nee) => setTimeout(() => nee(new Error("Connection closed.")), 5));
    const v = zonderAfwijzing(afgebroken);
    check("per belofte één veilige belofte (anders wacht use eindeloos)", zonderAfwijzing(afgebroken) === v);
    check("een afgebroken stroom wordt null, geen afwijzing", (await v.then((w) => w, () => "afgewezen")) === null);
    const al = vervuld({ waarde: 1 });
    check("een belofte die React al vervuld kent, gaat ongewijzigd door (meteen hydrateren)", zonderAfwijzing(al) === al);
  }

  // ── 4. De rekenweg zelf: het kanaal uit de adresbalk volgt geldigeKeuze ────────────────────────
  {
    const r = opDag("2026-11-13", () => bandUitZaad({ clientId: ID, google: google(10), blended: blended(10) as BlendedAntwoord, kanaal: "microsoft", keuze: LAST_12M }));
    check("een kanaal dat de klant niet heeft: Alle kanalen, zoals na het laden", r?.channel === "blended", String(r?.channel));
    const m = opDag("2026-11-13", () => bandUitZaad({ clientId: ID, google: google(10), blended: blended(10) as BlendedAntwoord, kanaal: "meta", keuze: LAST_3M_VJ }));
    check("?kanaal=meta: de cijfers van Meta, over de bewaarde periode", m?.channel === "meta" && m.periode.range.start === "2026-08" && m.periode.range.end === "2026-10" && m.periode.compareRange?.start === "2025-08", JSON.stringify(m?.periode.range));
  }

  // ── 5. De cookie met de periode ────────────────────────────────────────────────────────────────
  {
    const eigen: PeriodeKeuze = { preset: "custom", custom: { start: "2026-03", end: "2026-08" }, comparison: "previous_period" };
    for (const k of [LAST_12M, LAST_3M_VJ, eigen]) {
      const regel = periodeCookieRegel(k, `/client/${ID}`);
      const waarde = regel?.split(";")[0].slice(PERIODE_COOKIE.length + 1);
      check(`cookie heen en terug: ${JSON.stringify(k)}`, JSON.stringify(periodeUitCookie(waarde)) === JSON.stringify(k), String(regel));
    }
    check("de cookie geldt alleen onder het pad van deze klant", periodeCookieRegel(LAST_12M, `/client/${ID}/x`)?.includes(`path=/client/${ID};`) === true);
    check("buiten een klantpagina: geen cookie", periodeCookieRegel(LAST_12M, "/portfolio") === null);
    check("een kapotte of lege cookie: geen keuze", periodeUitCookie("periode=gisteren") === null && periodeUitCookie("") === null && periodeUitCookie(undefined) === null);
    // De provider begint op de keuze van de server (dezelfde prop in de browser): de periode in de
    // HTML is die van de cookie, niet de standaard.
    const html = renderToString(createElement(PeriodProvider, { scope: "c", beginKeuze: LAST_3M_VJ, children: createElement(PeriodSummary, { data: googleDataUitAntwoord(ID, google(10)), vorm: "tegels" }) }));
    check("de provider begint op de bewaarde keuze uit de cookie", /aug 2026|augustus 2026/i.test(tekst(html)) && /vergeleken met/.test(tekst(html)), tekst(html).slice(-200));
  }

  // ── 6. zaadNogVers ────────────────────────────────────────────────────────────────────────────
  {
    check("op de server altijd vers (een nieuw verzoek)", typeof window === "undefined" && zaadNogVers({}) === true);
    const g = globalThis as { window?: unknown };
    g.window = {};
    let t = 1_000;
    const klok = () => t;
    const belofte = {};
    check("de eerste keer in de browser (het hydrateren): vers", zaadNogVers(belofte, klok) === true);
    t += ZAAD_VERS_MS - 1;
    check("binnen de minuut terug: vers", zaadNogVers(belofte, klok) === true);
    t += 2;
    check("daarna terug (de router zet een oude pagina terug): niet meer", zaadNogVers(belofte, klok) === false);
    check("een andere belofte begint opnieuw", zaadNogVers({}, klok) === true);
    delete g.window;
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
