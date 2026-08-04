// De gezondheidsradar. Deterministisch, geen IO.
// Draaien: npx tsx lib/__health_radar_test.ts
//
// De helft van deze controles gaat over het GAT. Dat is het enige wat deze radar onderscheidt van
// elke andere radar: een niet-beoordeelde as wordt niet naar nul getrokken maar weggelaten. Zonder
// die regel leest "we konden de hygiëne niet meten" als "de hygiëne is nul", en dat is precies de
// fout die health-score.ts zelf al benoemt ("ontbrekende kennis is geen slechte score").

import {
  radarPunten, radarRanden, radarVlak, magRadarTonen, radarSamenvatting,
  MIN_BEOORDEELDE_ASSEN, WEBRINGEN, type RadarFactor,
} from "./health-radar";
import { computeHealthScore } from "./health-score";
import { computeForecast } from "./forecast";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function factor(name: string, score: number, assessed = true): RadarFactor {
  return { name, score, maxScore: 20, assessed };
}

const vijfVol: RadarFactor[] = [
  factor("Doelstelling", 20), factor("Efficiency", 10), factor("Trend", 15),
  factor("Budget", 5), factor("Hygiëne", 0),
];

// ── De meetkunde ──────────────────────────────────────────────────────────

{
  const p = radarPunten(vijfVol, 100, 0, 0);
  check("vijf assen geven vijf punten", p.length === 5, String(p.length));
  // Bovenaan beginnen en met de klok mee: dat is wat iemand verwacht en het houdt de eerste as
  // (Doelstelling) op de plek waar het oog begint.
  check("de eerste as staat bovenaan", p[0].hoek === -90, String(p[0].hoek));
  check("de assen staan gelijk verdeeld", p[1].hoek - p[0].hoek === 72, String(p[1].hoek - p[0].hoek));
  // Volle score = op de buitenring. Halve score = halverwege.
  check("een volle score raakt de buitenrand",
    Math.abs((p[0].y ?? 0) - -100) < 0.01, String(p[0].y));
  check("een halve score staat halverwege",
    Math.abs((p[1].waarde ?? 0) - 0.5) < 1e-9, String(p[1].waarde));
  // Een score van 0 is WEL een punt: gemeten nul is een uitkomst en hoort in het midden te staan.
  check("een gemeten nul levert wel een punt op", p[4].x !== null && p[4].waarde === 0,
    JSON.stringify({ x: p[4].x, waarde: p[4].waarde }));
}

// ── HET GAT ───────────────────────────────────────────────────────────────
//
// Het onderscheid waar alles om draait: score 0 en beoordeeld hoort in het midden te staan, score
// 0 en NIET beoordeeld hoort er niet te staan. Zonder dat verschil ziet een Meta-klant, waar
// hygiëne niet te meten is, eruit als een account met verwaarloosde hygiëne.

{
  const metGat = [...vijfVol.slice(0, 4), factor("Hygiëne", 0, false)];
  const p = radarPunten(metGat, 100, 0, 0);
  check("de niet-beoordeelde as heeft geen punt", p[4].x === null && p[4].y === null,
    JSON.stringify({ x: p[4].x, y: p[4].y }));
  check("de niet-beoordeelde as heeft geen waarde", p[4].waarde === null, String(p[4].waarde));
  // De SPAAK blijft wel bestaan: de as is er, alleen de meting niet. Zonder spaak zou de radar
  // vier assen lijken te hebben en zie je niet dat er iets ontbreekt.
  check("de spaak blijft wel bestaan", Number.isFinite(p[4].spaakX) && Number.isFinite(p[4].spaakY),
    JSON.stringify({ x: p[4].spaakX, y: p[4].spaakY }));

  // De twee randen die aan het gat raken vervallen: 5 assen geven normaal 5 randen, hier 3.
  const randen = radarRanden(p);
  check("de randen naast het gat vervallen", randen.length === 3, String(randen.length));

  // EN GEEN VULLING. Een gevuld vlak beweert een gesloten figuur en dus een waarde op elke as.
  check("er is geen vulling zodra er een gat is", radarVlak(p) === null, String(radarVlak(p)));
}

{
  const p = radarPunten(vijfVol, 100, 0, 0);
  check("zonder gat zijn er vijf randen", radarRanden(p).length === 5, String(radarRanden(p).length));
  const vlak = radarVlak(p);
  check("zonder gat is er wel een vulling", vlak !== null);
  check("de vulling heeft vijf punten", (vlak ?? "").split(" ").length === 5, String(vlak));
}

// De ring loopt rond: as 5 grenst aan as 1. Valt de eerste weg, dan vervallen de rand ervoor én
// erna -- niet alleen die erna.
{
  const eersteWeg = [factor("Doelstelling", 20, false), ...vijfVol.slice(1)];
  const randen = radarRanden(radarPunten(eersteWeg, 100, 0, 0));
  check("een gat op as 1 laat ook de rand van as 5 naar as 1 vervallen",
    randen.length === 3, String(randen.length));
}

// ── De ondergrens ─────────────────────────────────────────────────────────
// Twee punten en drie gaten is geen vorm. Dan is de donut ernaast ("2 van 5 beoordeeld") het
// eerlijke antwoord en hoort de radar er niet te staan.

{
  const drie = [...vijfVol.slice(0, 3), factor("Budget", 0, false), factor("Hygiëne", 0, false)];
  const twee = [...vijfVol.slice(0, 2), factor("Trend", 0, false), factor("Budget", 0, false), factor("Hygiëne", 0, false)];
  check("vijf beoordeeld: tonen", magRadarTonen(vijfVol));
  check(`${MIN_BEOORDEELDE_ASSEN} beoordeeld: tonen`, magRadarTonen(drie));
  check("twee beoordeeld: niet tonen", !magRadarTonen(twee));
  check("niets beoordeeld: niet tonen", !magRadarTonen(vijfVol.map((f) => ({ ...f, assessed: false }))));
}

// ── Onzin-invoer ──────────────────────────────────────────────────────────

{
  check("geen factoren geeft geen punten", radarPunten([], 100, 0, 0).length === 0);
  check("geen punten geeft geen randen", radarRanden([]).length === 0);
  check("te weinig punten geeft geen vlak", radarVlak(radarPunten(vijfVol.slice(0, 2), 100, 0, 0)) === null);
  // maxScore 0 zou delen door nul geven. Dan is de as niet te schalen en dus niet beoordeeld,
  // wat de vlag ook zegt.
  const kapot = radarPunten([{ name: "X", score: 5, maxScore: 0, assessed: true }, ...vijfVol.slice(1)], 100, 0, 0);
  check("maxScore 0 telt als niet beoordeeld", kapot[0].waarde === null && !kapot[0].assessed,
    JSON.stringify(kapot[0]));
  // Een score boven het maximum klemt op de buitenring in plaats van erbuiten te steken.
  const boven = radarPunten([{ name: "X", score: 30, maxScore: 20, assessed: true }], 100, 0, 0);
  check("een score boven het maximum klemt op 1", boven[0].waarde === 1, String(boven[0].waarde));
}

// ── De volgorde ligt vast ─────────────────────────────────────────────────
//
// HET HELE FUNDAMENT. Deze radar mag bestaan omdat de asvolgorde vastligt. Sorteert iemand ooit
// op score, dan verandert de vorm van het account zonder dat er één cijfer verandert -- en dan is
// de vorm een illusie. Deze controle legt vast dat de invoervolgorde letterlijk wordt gevolgd.

{
  const omgekeerd = [...vijfVol].reverse();
  const a = radarPunten(vijfVol, 100, 0, 0).map((p) => p.as).join(",");
  const b = radarPunten(omgekeerd, 100, 0, 0).map((p) => p.as).join(",");
  check("de invoervolgorde wordt letterlijk gevolgd",
    a === "Doelstelling,Efficiency,Trend,Budget,Hygiëne", a);
  check("een andere invoervolgorde geeft een andere vorm (dus wordt er niet gesorteerd)",
    a !== b, `${a} / ${b}`);
}

// ── De samenvatting in woorden ────────────────────────────────────────────
// Een radar is voor een schermlezer een polygoon en verder niets.

{
  const metGat = [...vijfVol.slice(0, 4), factor("Hygiëne", 0, false)];
  const zin = radarSamenvatting(metGat);
  check("noemt hoeveel er beoordeeld zijn", /4 van 5 factoren beoordeeld/.test(zin), zin);
  check("noemt de sterkste", /sterkst Doelstelling/.test(zin), zin);
  check("noemt de zwakste", /zwakst Budget/.test(zin), zin);
  check("noemt wat er ontbreekt", /niet beoordeeld: Hygiëne/.test(zin), zin);
  check("zonder oordeel een nette zin",
    radarSamenvatting(vijfVol.map((f) => ({ ...f, assessed: false }))) === "Geen enkele factor kon beoordeeld worden.");
}

// ── De ringen ─────────────────────────────────────────────────────────────

check("vier webringen, oplopend tot de rand",
  WEBRINGEN.length === 4 && WEBRINGEN[WEBRINGEN.length - 1] === 1, WEBRINGEN.join(","));

// ── Aansluiting op de echte bron ──────────────────────────────────────────
//
// De schaal komt uit f.maxScore en niet uit een eigen constante hier. Deze controle legt vast dat
// health-score.ts inderdaad vijf factoren levert en dat geen enkele score buiten zijn maximum
// valt -- anders zou een punt buiten de buitenring steken.

{
  // Door de echte computeForecast heen en niet met een nagemaakt forecast-object: een handgemaakt
  // object mist stilzwijgend een veld zodra de echte vorm verandert, en dan toetst deze controle
  // niets meer. (Deze test faalde eerst precies daarop: forecast.cpa ontbrak.)
  const leegJaar = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
  }));
  const forecast = computeForecast({
    clientId: "toets",
    targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears: { 2025: leegJaar },
    currentYearData: Array.from({ length: 12 }, () => null),
    currentYear: 2026,
  } as never);
  const leeg = computeHealthScore(forecast);
  check("de bron levert vijf factoren", leeg.factors.length === 5, String(leeg.factors.length));
  check("elke factor heeft een positief maximum", leeg.factors.every((f) => f.maxScore > 0),
    JSON.stringify(leeg.factors.map((f) => f.maxScore)));
  check("geen score boven zijn maximum", leeg.factors.every((f) => f.score <= f.maxScore),
    JSON.stringify(leeg.factors.map((f) => [f.name, f.score, f.maxScore])));
  // Zonder data is er niets te beoordelen, en dan hoort de radar weg te blijven.
  check("een leeg account toont geen radar", !magRadarTonen(leeg.factors),
    JSON.stringify(leeg.factors.map((f) => f.assessed)));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
