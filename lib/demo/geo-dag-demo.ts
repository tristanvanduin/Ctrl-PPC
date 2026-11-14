// Google per land en per VS-staat per dag in de demo (ads_country_daily en ads_region_daily,
// migratie 111). ÉÉN generator voor twee consumenten: de seed (scripts/demo/seed-demo-client.ts)
// schrijft ze naar de echte database, waar de kaart ze leest via dezelfde weg als voor echte klanten
// (lib/geo/geo-periode.ts), en demoRows() (lib/demo/demo-rows.ts) serveert ze aan de mock. Twee
// losse kopieën zouden uit elkaar lopen (zie lib/demo/microsoft-demo.ts).
//
// VOORBEELDEN, geen echte cijfers. Afgeleid uit Google per dag voor het account
// (lib/demo/google-dag-demo.ts) en niet los verzonnen: elke accountdag wordt over de landen verdeeld
// met de vaste aandelen van de demo (demoGeoCountries in lib/demo/geo-demo.ts), en het deel van de
// VS over de staten (demoGeoStates). De landen van een dag tellen dus EXACT op tot het account op die
// dag, en de staten tot de VS op die dag. De afrondingsrest gaat mee naar de volgende dag
// (verdeelReeks), zodat ook kleine aantallen over een periode bij hun aandeel uitkomen.

import { demoGeoCountries, demoGeoStates, type GeoAgg } from "./geo-demo";
import { splitAlong, splitInt } from "./split";
import { uspsToEnglishName } from "../geo/us-fips";

type Row = Record<string, unknown>;
type Metriek = "impressions" | "clicks" | "cost" | "conversions" | "conversionsValue";
const METRIEKEN: readonly Metriek[] = ["impressions", "clicks", "cost", "conversions", "conversionsValue"];
export type GeoTotaal = Omit<GeoAgg, "code">;

/**
 * Verdeelt een totaal over gewichten; de som van de delen is exact het totaal. Een geheel getal
 * met de grootste rest (splitInt, zoals de rest van de demo); een bedrag naar verhouding, met het
 * afrondingsverschil bij het grootste deel. Zonder gewichten (alles nul) de reservegewichten.
 */
function verdeel(totaal: number, gewichten: readonly number[], reserve: readonly number[]): number[] {
  const g = gewichten.some((w) => w > 0) ? gewichten : reserve;
  if (!g.length || !g.some((w) => w > 0)) return g.map(() => 0);
  if (Number.isInteger(totaal)) return splitInt(totaal, [...g]);
  const som = g.reduce((s, w) => s + w, 0);
  const delen = g.map((w) => (totaal * w) / som);
  const grootste = g.indexOf(Math.max(...g));
  delen[grootste] += totaal - delen.reduce((s, x) => s + x, 0);
  return delen;
}

/** Een totaal over de codes van een profiel, per metriek met de aandelen van dat profiel. */
export function verdeelOverProfiel(totaal: GeoTotaal, profiel: readonly GeoAgg[]): GeoAgg[] {
  const reserve = profiel.map((p) => p.cost);
  const perMetriek = Object.fromEntries(METRIEKEN.map((m) => [m, verdeel(totaal[m], profiel.map((p) => p[m]), reserve)])) as Record<Metriek, number[]>;
  return profiel.map((p, i) => ({
    code: p.code,
    impressions: perMetriek.impressions[i], clicks: perMetriek.clicks[i], cost: perMetriek.cost[i],
    conversions: perMetriek.conversions[i], conversionsValue: perMetriek.conversionsValue[i],
  }));
}

/**
 * Een reeks dagtotalen over vaste aandelen, MET OVERDRACHT van de afrondingsrest tussen de dagen.
 * Per code wordt het cumulatieve exacte aandeel bijgehouden; elke dag krijgt een code het verschil
 * tussen dat aandeel en wat hij al kreeg (naar beneden afgerond, nooit onder 0), en de rest van de
 * dag gaat naar wie het meest tekortkomt. Per dag telt het exact op tot het dagtotaal, en over elke
 * periode wijkt een code minder dan een paar eenheden af van zijn aandeel.
 *
 * Waarom niet elke dag los met splitInt: bij ongeveer 3,5 conversies per dag over 30 staten gingen
 * de kleine aantallen elke dag naar dezelfde staten. Over een jaar kregen 23 staten 0 conversies
 * (Pennsylvania verwacht 46) en Californië 316 tegen 66 verwacht.
 *
 * Een bedrag dat geen geheel getal is, wordt per dag naar verhouding verdeeld (zonder rest).
 */
export function verdeelReeks(totalen: readonly number[], gewichten: readonly number[]): number[][] {
  const som = gewichten.reduce((s, w) => s + w, 0);
  if (som <= 0) return totalen.map(() => gewichten.map(() => 0));
  const aandeel = gewichten.map((w) => w / som);
  if (!totalen.every(Number.isInteger)) return totalen.map((t) => verdeel(t, gewichten, gewichten));
  const gekregen = gewichten.map(() => 0);
  let cumulatief = 0;
  return totalen.map((t) => {
    cumulatief += t;
    const tekort = aandeel.map((a, i) => a * cumulatief - gekregen[i]);
    const dag = tekort.map((x) => Math.max(0, Math.floor(x)));
    let rest = t - dag.reduce((s, x) => s + x, 0);
    while (rest > 0) {
      let i = 0;
      for (let j = 1; j < dag.length; j++) if (tekort[j] - dag[j] > tekort[i] - dag[i]) i = j;
      dag[i]++; rest--;
    }
    while (rest < 0) {
      let i = -1;
      for (let j = 0; j < dag.length; j++) if (dag[j] > 0 && (i < 0 || tekort[j] - dag[j] < tekort[i] - dag[i])) i = j;
      dag[i]--; rest++;
    }
    dag.forEach((d, i) => { gekregen[i] += d; });
    return dag;
  });
}

/** De conversiewaarde van een dag langs de conversies van die dag (splitAlong), zoals de rest van de demo. */
function waardeLangs(totaal: number, conversies: readonly number[], reserve: readonly number[]): number[] {
  if (Number.isInteger(totaal)) return splitAlong(totaal, [...conversies], [...reserve]);
  return verdeel(totaal, conversies, reserve);
}

/**
 * Dagtotalen over de codes van een profiel: de gehele metrieken met overdracht (verdeelReeks), de
 * conversiewaarde per dag langs de conversies. Zo heeft geen code op een dag omzet zonder conversies.
 * Per dag één lijst in de volgorde van het profiel.
 */
function verdeelDagen(dagen: readonly GeoTotaal[], profiel: readonly GeoAgg[]): GeoAgg[][] {
  const reserve = profiel.map((p) => p.cost);
  const reeks = (m: Exclude<Metriek, "conversionsValue">) => {
    const g = profiel.map((p) => p[m]);
    return verdeelReeks(dagen.map((d) => d[m]), g.some((w) => w > 0) ? g : reserve);
  };
  const imp = reeks("impressions"), klik = reeks("clicks"), kost = reeks("cost"), conv = reeks("conversions");
  const waardeReserve = profiel.map((p) => p.conversionsValue);
  return dagen.map((d, t) => {
    const waarde = waardeLangs(d.conversionsValue, conv[t], waardeReserve.some((w) => w > 0) ? waardeReserve : reserve);
    return profiel.map((p, i) => ({
      code: p.code, impressions: imp[t][i], clicks: klik[t][i], cost: kost[t][i], conversions: conv[t][i], conversionsValue: waarde[i],
    }));
  });
}

/**
 * De land- en staatrijen per dag, uit de accountrijen per dag (ads_account_daily, op datum). Kolommen
 * exact als ads_country_daily en ads_region_daily (scripts/migrations/111-google-dagtabellen.sql),
 * zonder synced_at (die vult de database).
 */
export function googleGeoDagRijen(clientId: string, accountDagen: readonly Row[]): { landen: Row[]; staten: Row[] } {
  const landProfiel = demoGeoCountries("google");
  const statenProfiel = demoGeoStates("google");
  const rijen = [...accountDagen].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const datums = rijen.map((r) => String(r.date ?? "").slice(0, 10));
  const totalen: GeoTotaal[] = rijen.map((r) => ({
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0), conversionsValue: Number(r.conversions_value ?? 0),
  }));
  const kolommen = (a: GeoAgg) => ({
    impressions: a.impressions, clicks: a.clicks, cost: a.cost, conversions: a.conversions, conversions_value: a.conversionsValue,
  });
  const perLand = verdeelDagen(totalen, landProfiel);
  const landen = perLand.flatMap((dag, t) => dag.map((l) => ({ client_id: clientId, date: datums[t], country_code: l.code, ...kolommen(l) })));
  const vs = perLand.map((dag) => dag.find((l) => l.code === "US"));
  if (vs.some((x) => !x)) return { landen, staten: [] };
  const perStaat = verdeelDagen(vs as GeoAgg[], statenProfiel);
  const staten = perStaat.flatMap((dag, t) => dag.map((s) => ({
    client_id: clientId, date: datums[t], country_code: "US", region_code: s.code, region_name: uspsToEnglishName(s.code), ...kolommen(s),
  })));
  return { landen, staten };
}
