// De health van Google op de kanaalkaart is dezelfde als in de ranking eronder.
// Draaien: tsx --tsconfig ./tsconfig.json lib/__google_health_kaart_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De doorlichting van 13 november vond 57 op de kaart en 66 in de ranking, voor hetzelfde
// account. De eerste reparatie liet de kaart useClientDataState lezen, maar de bovenkant staat
// BUITEN ClientDataProvider: daar gaf die hook null, en de kaart bleef 57 terwijl de ranking direct
// eronder nu 66 zei. Een test van googleHealthScore alleen zag dat niet; deze rendert de bovenkant
// echt en kijkt welk getal er op de kaart komt.
//
// De ranking rekent googleHealthScore(prognose uit de provider, staat uit de provider); de prognose
// van de provider is computeForecast(mergeKpiTargets(data)). Dat is hieronder `ranking`.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverzichtBovenkant } from "../components/dashboard/overzicht-bovenkant";
import { PeriodProvider } from "./period/period-context";
import { alsBronReeks } from "./period/apply-period";
import { bouwHistorischeData, type MaandTotaal } from "./period/kanaal-maanden";
import { monthsIn } from "./period/period-range";
import { getClientSettings } from "./client-settings";
import { mergeKpiTargets } from "./kpi-target-merge";
import { computeForecast } from "./forecast";
import { googleHealthScore, type GoogleHealthInvoer } from "./health-score";
import type { ChannelPeriodData } from "./use-channel-period-data";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// De bovenkant rekent pas als de instellingen van de klant gelezen zijn (anders een ander doel dan
// de ranking). Op de server is er geen localStorage; een in het geheugen gezette vermelding met de
// standaardinstellingen opent die poort zonder database.
const CLIENT = "kaarttest";
const instellingen = JSON.stringify(getClientSettings(CLIENT));
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
g.window = globalThis;
g.localStorage = { getItem: (k: string) => (k.endsWith(CLIENT) ? instellingen : null), setItem: () => {}, removeItem: () => {} };

const reeks = (van: string, tot: string, maak: (i: number) => Omit<MaandTotaal, "year" | "month">): MaandTotaal[] =>
  monthsIn({ start: van, end: tot }).map((k, i) => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), ...maak(i) }));
const google = bouwHistorischeData(CLIENT, reeks("2024-09", "2026-10", (i) => ({ conversions: 100 + i * 3, revenue: 9000 + i * 110, adSpend: 4000 + i * 37 })), 2026);
const meta = bouwHistorischeData(CLIENT, reeks("2026-03", "2026-10", (i) => ({ conversions: 40 + i, revenue: 2000, adSpend: 1500 })), 2026);

// 20% van de besteding van de laatste 30 dagen naar zoektermen zonder conversies: Hygiëne 4 van 20.
const staat = {
  impressionShare: undefined,
  wastefulSearchTerms: [{ searchTerm: "gratis", campaignName: "Search", adGroupName: "A", clicks: 80, cost: 1000 }],
  adGroupBleeders: [],
  accountStructure: { campaigns: [{ name: "Search", cost30d: 5000 }], detectedStrategy: [] },
} as unknown as GoogleHealthInvoer;

const ranking = googleHealthScore(computeForecast(mergeKpiTargets(CLIENT, google)), staat).total;
const zonderHygiene = googleHealthScore(computeForecast(mergeKpiTargets(CLIENT, google)), null).total;

const band: ChannelPeriodData = {
  data: google,
  bronnen: [alsBronReeks("totaal", google)],
  perKanaal: { google: alsBronReeks("google", google), meta: alsBronReeks("meta", meta) },
  laatsteDag: { meta: "2026-10-31" },
  geladenVanaf: { meta: "2000-01" },
  klaar: { meta: true },
} as unknown as ChannelPeriodData;

const waarschuw = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };
const kaartScore = (googleStaat: GoogleHealthInvoer | null): number | null => {
  const html = renderToStaticMarkup(createElement(PeriodProvider, {
    scope: "google-health-kaart",
    children: createElement(OverzichtBovenkant, {
      clientId: CLIENT, channel: "blended", kanalen: ["google", "meta"], onKies: () => {}, onBeoordeel: () => {},
      googleData: google, googleStaat, route: { perKanaalTab: null, dataStand: null, loading: false, error: null },
      band, bandKlaar: true, demo: true,
    } as never),
  }));
  // De kaarten staan in de volgorde van ALLE_KANALEN, Google eerst.
  const m = /Health (\d+) van 100\./.exec(html.replace(/<!-- -->/g, ""));
  return m ? Number(m[1]) : null;
};

console.log("De Google-kaart en de ranking: hetzelfde getal");
check("de verspillingsdata maakt hier verschil (anders toetst dit niets)", ranking !== zonderHygiene, `${ranking} / ${zonderHygiene}`);
const metStaat = kaartScore(staat);
check("de kaart toont het getal van de ranking", metStaat === ranking, `kaart ${metStaat}, ranking ${ranking}`);
check("zonder de Google-staat zou de kaart afwijken (zo zag de fout eruit)", kaartScore(null) === zonderHygiene, `${kaartScore(null)} / ${zonderHygiene}`);
console.warn = waarschuw;

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
