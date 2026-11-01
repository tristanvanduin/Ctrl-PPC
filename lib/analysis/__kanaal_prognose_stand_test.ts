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
  // De route-uitkomst staat vijf minuten in de cache; een rij die intussen binnenkwam telt gewoon.
  const meta = rijen("2026-01-01", "2026-10-31", 1);
  check("rij t/m 31 okt, route zegt 15 okt: oktober gerealiseerd", bouw(meta, "2026-10-15")?.currentYearData[9]?.conversions === 31);
  check("een ongeldige dag wordt genegeerd", bouw(meta, "2026-13-01")?.currentYearData[9]?.conversions === 31);
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);
