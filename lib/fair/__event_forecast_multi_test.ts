// De event-prognose over MEERDERE eerdere edities.
// Draaien: npx tsx lib/fair/__event_forecast_multi_test.ts
//
// De prognose leunde op de meest recente editie alleen. Dat was op twee manieren fragiel:
//
//   1. Eén afwijkende editie werd in zijn eentje de norm. Een verschoven datum, een jaar dat
//      om externe redenen niet representatief was, en de hele projectie stond scheef.
//   2. Als juist die ene editie een materieel ander campagnevenster had, viel het complete
//      sjabloon-pad weg en bleef er lineaire extrapolatie over — terwijl de editie daarvoor
//      prima vergelijkbaar was. De code zegt zelf dat lineair de eindpiek onderschat, dus dat
//      is niet "iets minder precies" maar systematisch te laag.
//
// Jaar op jaar landt een beurs zelden op exact dezelfde weken. Dat is precies waarom de tijdas
// dagen-tot-beurs is en niet de kalender — en waarom één onvergelijkbare editie de rest niet
// mag meeslepen.

import { forecastStream } from "./event-forecast";
import { priorEditionsFor, type FairEdition } from "./event-comparison";
import type { DailyPoint, Edition } from "./event-time-axis";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Een editie met een venster van `venster` dagen dat eindigt op de beursdag. */
function editie(id: string, beursdag: string, venster: number): Edition {
  const d = new Date(`${beursdag}T00:00:00Z`);
  const start = new Date(d.getTime() - venster * 86_400_000).toISOString().slice(0, 10);
  return { editionId: id, campaignStartDate: start, fairStartDate: beursdag, fairEndDate: beursdag };
}

/**
 * Dagpunten met een vaste eindstand, waarvan `frac` op D-x al is opgebouwd.
 * Zo is de tempo-ratio (eindstand / stand op D-x) exact te sturen.
 */
function punten(ed: Edition, x: number, opDx: number, eind: number): DailyPoint[] {
  const beurs = new Date(`${ed.fairStartDate}T00:00:00Z`).getTime();
  const dagVoor = (n: number) => new Date(beurs - n * 86_400_000).toISOString().slice(0, 10);
  // Eén punt ruim voor D-x, één punt tussen D-x en de beurs.
  return [
    { date: dagVoor(x + 1), value: opDx },
    { date: dagVoor(Math.max(x - 1, 0)), value: eind - opDx },
  ];
}

const HUIDIG = editie("2026", "2026-06-01", 60);
const ASOF = "2026-05-02"; // D-30

// ── Eén afwijkende editie mag de norm niet zetten ─────────────────────────

console.log("De mediaan over meerdere edities");
{
  // Drie eerdere edities. Twee zijn het eens (ratio 2,0), één is een uitschieter (ratio 5).
  // De uitschieter moet WEL door de ramp-drempel komen (minstens 15% van de curve op D-x),
  // anders wordt hij al door de bestaande guard geweerd en test dit niets over de mediaan.
  const eerdere = [
    { edition: editie("2025", "2025-06-01", 60), points: punten(editie("2025", "2025-06-01", 60), 30, 1000, 5000) }, // ratio 5, frac 0,20
    { edition: editie("2024", "2024-06-01", 60), points: punten(editie("2024", "2024-06-01", 60), 30, 2500, 5000) }, // ratio 2, frac 0,50
    { edition: editie("2023", "2023-06-01", 60), points: punten(editie("2023", "2023-06-01", 60), 30, 2500, 5000) }, // ratio 2, frac 0,50
  ];
  const huidigePunten = punten(HUIDIG, 30, 1000, 1000); // stand nu: 1000

  const meervoud = forecastStream({ current: { edition: HUIDIG, points: huidigePunten }, previousEditions: eerdere, target: null, asOfDate: ASOF });
  const enkelvoud = forecastStream({ current: { edition: HUIDIG, points: huidigePunten }, previous: eerdere[0], target: null, asOfDate: ASOF });

  check("op drie edities gebaseerd", meervoud.basedOnEditions === 3, String(meervoud.basedOnEditions));
  check("de uitschieter zet de norm niet", meervoud.projectedFinal === 2000,
    `${meervoud.projectedFinal} (mediaan ratio 2,0 maal stand 1000)`);
  check("terwijl de meest recente editie alleen 5000 gaf", enkelvoud.projectedFinal === 5000,
    String(enkelvoud.projectedFinal));
  check("de spreiding wordt gemeld", meervoud.editionSpread !== null && meervoud.editionSpread > 1,
    String(meervoud.editionSpread));
  check("en de tekst waarschuwt dat de edities het oneens zijn",
    /niet eens|spreiding/i.test(meervoud.note), meervoud.note.slice(0, 140));
}

// ── Een onvergelijkbare recente editie mag de rest niet meeslepen ─────────

console.log("\nEen afwijkend venster bij de meest recente editie");
{
  // 2025 heeft een venster van 20 dagen tegen 60 nu: meer dan 20% verschil, dus onvergelijkbaar.
  // 2024 en 2023 zijn wel vergelijkbaar.
  const ed2025 = editie("2025", "2025-06-01", 20);
  const eerdere = [
    { edition: ed2025, points: punten(ed2025, 30, 2500, 5000) },
    // Ratio 2,5: hoger dan de lineaire extrapolatie (die op 2,0 uitkomt), zodat het verschil
    // tussen de twee paden zichtbaar is.
    { edition: editie("2024", "2024-06-01", 60), points: punten(editie("2024", "2024-06-01", 60), 30, 2000, 5000) },
    { edition: editie("2023", "2023-06-01", 58), points: punten(editie("2023", "2023-06-01", 58), 30, 2000, 5000) },
  ];
  const huidigePunten = punten(HUIDIG, 30, 1000, 1000);

  const meervoud = forecastStream({ current: { edition: HUIDIG, points: huidigePunten }, previousEditions: eerdere, target: null, asOfDate: ASOF });
  const alleenRecent = forecastStream({ current: { edition: HUIDIG, points: huidigePunten }, previous: eerdere[0], target: null, asOfDate: ASOF });

  // Dit is de kern: met alleen de recente editie viel de sjabloon weg en bleef lineair over.
  check("met alleen de recente editie valt hij terug op lineair",
    alleenRecent.method === "tempo_extrapolatie", alleenRecent.method);
  check("met alle edities blijft de sjabloon staan",
    meervoud.method === "vorige_editie_sjabloon", meervoud.method);
  check("en die rust op de twee vergelijkbare edities", meervoud.basedOnEditions === 2, String(meervoud.basedOnEditions));
  // Lineair onderschat de eindpiek; dat is precies wat we niet wilden.
  check("de sjabloon-projectie ligt hoger dan de lineaire",
    (meervoud.projectedFinal ?? 0) > (alleenRecent.projectedFinal ?? 0),
    `${meervoud.projectedFinal} tegen ${alleenRecent.projectedFinal}`);
}

// ── Eén eerdere editie blijft gewoon werken ───────────────────────────────

console.log("\nMet één eerdere editie");
{
  const eerdere = [{ edition: editie("2025", "2025-06-01", 60), points: punten(editie("2025", "2025-06-01", 60), 30, 2500, 5000) }];
  const f = forecastStream({ current: { edition: HUIDIG, points: punten(HUIDIG, 30, 1000, 1000) }, previousEditions: eerdere, target: null, asOfDate: ASOF });
  check("de sjabloon wordt gebruikt", f.method === "vorige_editie_sjabloon", f.method);
  check("op één editie", f.basedOnEditions === 1, String(f.basedOnEditions));
  check("geen spreiding bij één editie", f.editionSpread === null);
  // Eén vergelijking is geen bevestiging: dat hoort in het vertrouwen te staan.
  check("het vertrouwen is niet hoog", f.confidence !== "hoog", f.confidence);
}

console.log("\nZonder eerdere editie");
{
  const f = forecastStream({ current: { edition: HUIDIG, points: punten(HUIDIG, 30, 1000, 1000) }, previousEditions: [], target: null, asOfDate: ASOF });
  check("valt terug op tempo-extrapolatie", f.method === "tempo_extrapolatie", f.method);
  check("met laag vertrouwen", f.confidence === "laag");
  check("en nul edities", f.basedOnEditions === 0);
  // Dat is het geval dat gewoon mag: de eerste editie heeft niets om mee te vergelijken.
  check("er komt wel een getal uit", f.projectedFinal !== null);
}

// ── priorEditionsFor levert alles, meest recente eerst ───────────────────

console.log("\nDe selectie van eerdere edities");
{
  const mk = (id: string, datum: string): FairEdition => ({
    ...editie(id, datum, 60), fairId: "beurs", geoClone: "beurs", cadence: "annual",
  });
  const alle = [mk("2023", "2023-06-01"), mk("2026", "2026-06-01"), mk("2024", "2024-06-01"), mk("2025", "2025-06-01")];
  const eerder = priorEditionsFor(alle, "2026");
  check("alle drie de eerdere edities", eerder.length === 3, String(eerder.length));
  check("meest recente eerst", eerder.map((e) => e.editionId).join(",") === "2025,2024,2023",
    eerder.map((e) => e.editionId).join(","));
  check("de huidige editie zit er niet bij", !eerder.some((e) => e.editionId === "2026"));

  // Een editie van een andere beurs of kloon telt niet mee.
  const ander = [...alle, { ...mk("2025-ander", "2025-07-01"), fairId: "andere-beurs", geoClone: "andere-beurs" }];
  check("een andere beurs telt niet mee", priorEditionsFor(ander, "2026").length === 3);
  check("een onbekende editie geeft een lege lijst", priorEditionsFor(alle, "bestaat-niet").length === 0);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
