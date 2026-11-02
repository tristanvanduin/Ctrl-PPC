// De kanaalprognose (Meta, LinkedIn, Microsoft) op dezelfde datastand als "Alle kanalen".
// Draaien: tsx lib/analysis/__kanaal_prognose_stand_test.ts
//
// buildChannelHistoricalData leidde de grens af uit de nieuwste rij alleen. Rijen zeggen niet of de
// sync daarna nog slaagde, en de syncs schrijven geen nulrijen. Twee gevolgen (review [10], [14]):
// - een gepauzeerd Meta-account (laatste levering 15 augustus, sync gezond) verloor op zijn eigen
//   tab de echte halve augustus (30) aan een volle projectie (61), terwijl "Alle kanalen" dezelfde
//   maanden als gemeten telde;
// - een Microsoft zonder levering op zaterdag 31 oktober maakte oktober partieel.
// De browser kan <kanaal>_connections niet lezen; de blended route geeft de dag daarom mee
// (dataStand.bronnen), en de provider geeft hem hier door.

import { buildChannelHistoricalData, buildChannelForecast, type ChannelForecastRow } from "./channel-forecast-data";
import { addDays } from "../reporting-date";
import * as cfd from "./channel-forecast-data";
import * as som from "../forecast-som";
import { computeForecast } from "../forecast";
import { buildClientDataFromApi } from "../api/adapter";
import { monthsIn } from "../period/period-range";
import { eersteVolleMaand } from "../period/kanaal-maanden";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = "2026-11-01";
const geenDoel = { conversions: 0, revenue: 0, adSpend: 0 };
function rijen(van: string, tot: string, conv: number, filter: (d: string) => boolean = () => true): ChannelForecastRow[] {
  const uit: ChannelForecastRow[] = [];
  for (let d = van; d <= tot; d = addDays(d, 1)) if (filter(d)) uit.push({ date: d, spend: 10, conv, revenue: 0 });
  return uit;
}
// Losjes aangeroepen: op de oude code bestaat de vijfde parameter niet, en dan moet de test falen
// op de uitkomst in plaats van op het type.
const bouw = (r: ChannelForecastRow[], dataTot?: string | null) =>
  (buildChannelHistoricalData as (...a: unknown[]) => ReturnType<typeof buildChannelHistoricalData>)("c", r, geenDoel, NU, dataTot);
const prognose = (r: ChannelForecastRow[], dataTot?: string | null) =>
  (buildChannelForecast as (...a: unknown[]) => ReturnType<typeof buildChannelForecast>)("c", r, [], "meta_ads", NU, dataTot);

console.log("Gepauzeerd sinds 15 augustus, sync gezond");
{
  const meta = rijen("2026-01-01", "2026-08-15", 2);
  const metSync = bouw(meta, "2026-10-31");
  check("augustus is gerealiseerd met de echte 30", metSync?.currentYearData[7]?.conversions === 30, JSON.stringify(metSync?.currentYearData[7]));
  check("september en oktober zijn gemeten nullen, geen projectie",
    metSync?.currentYearData[8]?.conversions === 0 && metSync?.currentYearData[9]?.conversions === 0,
    JSON.stringify(metSync?.currentYearData.slice(8, 10)));
  const f = prognose(meta, "2026-10-31");
  check("in de prognose: augustus realized 30, geen projectie meer voor augustus",
    f?.forecast.conversions.points[7]?.realized === 30, JSON.stringify(f?.forecast.conversions.points[7]));

  // Zonder de dag van de route (een klant met alleen Google, of de route faalde): de rijen, zoals voorheen.
  const zonder = bouw(meta);
  check("zonder syncdag: augustus partieel, gerealiseerd t/m juli", zonder?.currentYearData[7] === null && zonder?.currentYearData[6]?.conversions === 62,
    JSON.stringify(zonder?.currentYearData.slice(6, 8)));
}

console.log("Geen levering op de laatste dag van de maand (review [10])");
{
  const werkdag = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
  const ms = rijen("2026-01-01", "2026-10-31", 1, werkdag);
  check("voorwaarde: de laatste rij is vrijdag 30 oktober", ms[ms.length - 1].date === "2026-10-30", ms[ms.length - 1].date);
  check("met de syncdag van 1 november: oktober is gerealiseerd", bouw(ms, "2026-10-31")?.currentYearData[9] != null, JSON.stringify(bouw(ms, "2026-10-31")?.currentYearData[9]));
  check("zonder: oktober nog niet (de oude grens)", bouw(ms)?.currentYearData[9] === null);
}

console.log("Een oudere dag van de route wint niet van een nieuwere rij");
{
  // De route-uitkomst staat vijf minuten in de cache; een rij die intussen binnenkwam telt, maar
  // zonder zijn eigen dag: die rij komt van een sync na het antwoord van de route, en de nachtcron
  // haalt t/m zijn eigen dag op, dus de nieuwste rij is een deel van die dag (dagkanaalDataTot in
  // lib/sync/datastand.ts). Hier telde oktober als gerealiseerd met een 31e van zes uur erin.
  const meta = rijen("2026-01-01", "2026-10-31", 1);
  const nieuwer = bouw(meta, "2026-10-15");
  check("rij t/m 31 okt, route zegt 15 okt: september gerealiseerd (niet 15 okt), oktober t/m de 30e dus partieel",
    nieuwer?.currentYearData[8]?.conversions === 30 && nieuwer?.currentYearData[9] === null, JSON.stringify(nieuwer?.currentYearData.slice(8, 10)));
  // Zegt de route zelf t/m 31 oktober (de sync slaagde op 1 november), dan is oktober vol.
  check("rij t/m 31 okt, route zegt 31 okt: oktober gerealiseerd", bouw(meta, "2026-10-31")?.currentYearData[9]?.conversions === 31);
  check("een ongeldige dag wordt genegeerd (dan de rijen, zoals zonder route)", bouw(meta, "2026-13-01")?.currentYearData[9]?.conversions === 31);
}

console.log("De tab en \"Alle kanalen\" geven een kanaal hetzelfde jaar, ook als de route het uitsluit");
{
  // De som (blendedForecastUitKanalen) en de tab (buildChannelForecast via tabStandUitRoute, zoals
  // channel-data-provider.tsx hem aanroept) op dezelfde routestand. Losjes aangeroepen: op de oude
  // code bestaan de helpers en de extra parameters niet, en dan moet de test op de uitkomst falen.
  const { tabStandUitRoute } = cfd as Partial<typeof cfd>;
  const { eigenGrenzen } = som as Partial<typeof som>;
  type Stand = { dataTot: string; uitgesloten: string[]; bronnen: { bron: string; dataTot: string; syncDraait: boolean }[] };
  const maanden = (r: ChannelForecastRow[]) => {
    const per = new Map<string, { month: string; conversions: number; revenue: number; adSpend: number }>();
    for (const x of r) {
      const m = per.get(x.date.slice(0, 7)) ?? { month: x.date.slice(0, 7), conversions: 0, revenue: 0, adSpend: 0 };
      m.conversions += x.conv; m.revenue += x.revenue; m.adSpend += x.spend;
      per.set(m.month, m);
    }
    return [...per.values()];
  };
  const google = (tot: string) => ({ kanaal: "google" as const, vanaf: null, maanden: monthsIn({ start: "2025-01", end: tot }).map((month) => ({ month, conversions: 100, revenue: 0, adSpend: 1000 })) });
  const deelInSom = (kanaal: "meta" | "linkedin", r: ChannelForecastRow[], stand: Stand, rtm: number, grens: boolean) => {
    const k = { kanaal, vanaf: eersteVolleMaand(r[0].date), eersteDag: r[0].date, maanden: maanden(r) };
    const g = google(rtm >= 10 ? "2026-10" : "2026-09");
    const samen = buildClientDataFromApi("c", [], [], [], geenDoel, 2026, rtm);
    const grenzen = grens && eigenGrenzen ? eigenGrenzen(stand.bronnen, 2026, NU) : {};
    const totaal = (som.blendedForecastUitKanalen as (...a: unknown[]) => ReturnType<typeof som.blendedForecastUitKanalen>)("c", [g, k], samen, rtm, stand.uitgesloten, grenzen);
    const alleenGoogle = computeForecast(som.kanaalHistorieUitMaanden("c", g, 2026, rtm));
    return Math.round(totaal.conversions.kpi.adjustedAnnual - alleenGoogle.conversions.kpi.adjustedAnnual);
  };
  const opTab = (r: ChannelForecastRow[], stand: Stand, kanaal: string) => {
    // Op de oude code: wat de provider toen deed, de eigen dag van het kanaal en geen stop.
    const t = typeof tabStandUitRoute === "function" ? tabStandUitRoute(stand, kanaal)
      : { dataTot: stand.bronnen.find((b) => b.bron === kanaal)?.dataTot ?? null, gestopt: false };
    return (buildChannelForecast as (...a: unknown[]) => ReturnType<typeof buildChannelForecast>)("c", r, [], `${kanaal}_ads`, NU, t.dataTot, { gestopt: t.gestopt });
  };
  const jaar = (f: ReturnType<typeof buildChannelForecast> | null) => (f ? Math.round(f.forecast.conversions.kpi.adjustedAnnual) : null);

  // A. Een verlopen token: LinkedIn hield op 15 juni op, Google loopt t/m 31 oktober. De tab kreeg
  // zijn eigen dag (14 juni), bleef gerealiseerd t/m mei en projecteerde juni t/m december: 730
  // tegen 332 in de som, met de echte halve juni (30) achter een "prognose 60".
  const dood = rijen("2025-01-01", "2026-06-15", 2);
  const standDood: Stand = { dataTot: "2026-10-31", uitgesloten: ["linkedin"], bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-06-14", syncDraait: false }] };
  const tabDood = opTab(dood, standDood, "linkedin");
  check("verlopen token: de tab is januari t/m 15 juni, 332", jaar(tabDood) === 332, String(jaar(tabDood)));
  check("verlopen token: de tab is gelijk aan het deel in de som", jaar(tabDood) === deelInSom("linkedin", dood, standDood, 10, true), `${jaar(tabDood)} / ${deelInSom("linkedin", dood, standDood, 10, true)}`);
  check("verlopen token: juni is de echte 30, juli-oktober gemeten nul, geen prognose",
    tabDood?.forecast.conversions.points[5].realized === 30 && tabDood.forecast.conversions.points.slice(6, 10).every((p) => p.realized === 0 && p.forecast === null),
    JSON.stringify(tabDood?.forecast.conversions.points.slice(5, 10).map((p) => [p.realized, p.forecast])));

  // B. Ontkoppeld in Instellingen op 10 september (minder dan 60 dagen achter, dus alleen
  // uitgesloten omdat hij niet meer synct).
  const los = rijen("2025-01-01", "2026-09-10", 2);
  const standLos: Stand = { dataTot: "2026-10-31", uitgesloten: ["linkedin"], bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-09-09", syncDraait: true }] };
  check("ontkoppeld: tab gelijk aan de som (506)", jaar(opTab(los, standLos, "linkedin")) === 506 && deelInSom("linkedin", los, standLos, 10, true) === 506,
    `${jaar(opTab(los, standLos, "linkedin"))} / ${deelInSom("linkedin", los, standLos, 10, true)}`);

  // Een dood kanaal waarvan de maanden op een seizoenspauze lijken (januari-maart en november-
  // december 2025, januari-maart 2026): kanaalGestopt zegt "pauze", maar de som vraagt het hem
  // niet, want het staat in uitgesloten. Met alleen de gezamenlijke dag gaf de tab 302.
  const seizoenDood = [...rijen("2025-01-01", "2025-03-31", 2), ...rijen("2025-11-01", "2025-12-31", 2), ...rijen("2026-01-01", "2026-03-31", 2)];
  const standSeizoen: Stand = { dataTot: "2026-10-31", uitgesloten: ["linkedin"], bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-03-30", syncDraait: false }] };
  check("dood met seizoensvorm: tab gelijk aan de som (180)", jaar(opTab(seizoenDood, standSeizoen, "linkedin")) === 180 && deelInSom("linkedin", seizoenDood, standSeizoen, 10, true) === 180,
    `${jaar(opTab(seizoenDood, standSeizoen, "linkedin"))} / ${deelInSom("linkedin", seizoenDood, standSeizoen, 10, true)}`);

  // C. Gepauzeerd sinds 20 september met een gezonde sync, maar Meta's run van 1 november mislukte
  // terwijl Google slaagde: Meta t/m 30 oktober, de rest t/m 31 oktober. De route zet Meta in
  // uitgesloten en de som noemt hem gestopt (526); de tab besliste op zijn eigen grens (september)
  // en projecteerde oktober-december (701).
  const meta = rijen("2025-01-01", "2026-09-20", 2);
  const standC: Stand = { dataTot: "2026-10-31", uitgesloten: ["meta"], bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "meta", dataTot: "2026-10-30", syncDraait: true }] };
  check("Meta een dag achter: tab gelijk aan de som (526)", jaar(opTab(meta, standC, "meta")) === 526 && deelInSom("meta", meta, standC, 10, true) === 526,
    `${jaar(opTab(meta, standC, "meta"))} / ${deelInSom("meta", meta, standC, 10, true)}`);

  // G. Het spiegelgeval: Meta op 1 november om 01:30 handmatig gesynct, Google nog niet. De grens
  // van de route is september (Google remt), die van Meta oktober. De tab zag een gemeten lege
  // oktober en zei "gestopt" (526); de som besliste op september en projecteerde (701).
  const standG: Stand = { dataTot: "2026-10-30", uitgesloten: [], bronnen: [{ bron: "google", dataTot: "2026-10-30", syncDraait: false }, { bron: "meta", dataTot: "2026-10-31", syncDraait: true }] };
  check("eigen grenzen uit de stand: Google september, Meta oktober",
    JSON.stringify(eigenGrenzen?.(standG.bronnen, 2026, NU)) === JSON.stringify({ google: 9, meta: 10 }), JSON.stringify(eigenGrenzen?.(standG.bronnen, 2026, NU)));
  check("Meta een dag vóór: tab gelijk aan de som (526)", jaar(opTab(meta, standG, "meta")) === 526 && deelInSom("meta", meta, standG, 9, true) === 526,
    `${jaar(opTab(meta, standG, "meta"))} / ${deelInSom("meta", meta, standG, 9, true)}`);
  // Zonder eigen grenzen (een route zonder bronnen) beslist de som op de gezamenlijke grens.
  check("zonder eigen grenzen: zoals voorheen (701)", deelInSom("meta", meta, standG, 9, false) === 701, String(deelInSom("meta", meta, standG, 9, false)));
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);
