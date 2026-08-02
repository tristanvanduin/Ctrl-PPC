// Test voor de sparkline-rekenregels. Deterministisch, geen IO en geen DOM: de wiskunde staat in
// deze functies, de SVG eromheen is opmaak.
//
// De reden dat deze test bestaat: er stonden twee sparklines in de codebase die op de basislijn
// verschilden, en dat verschil was in geen van beide vastgelegd. Hier staat hij nu vast.

import { sparkPunten, sparkSchaal } from "./sparkline";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const dichtbij = (a: number, b: number, marge = 1e-6) => Math.abs(a - b) < marge;

// ── De basislijn ──
// Hetzelfde verloop, twee lezingen. Vanaf nul is 1000 → 1050 vrijwel vlak; op het eigen bereik
// vult diezelfde reeks de volle hoogte. Allebei goed, voor een andere grootheid — en dat is
// precies waarom de aanroeper het moet zeggen.
{
  const reeks = [1000, 1050];
  const nul = sparkSchaal(reeks, "nul");
  const bereik = sparkSchaal(reeks, "bereik");
  assert(nul.min === 0, "vanaf nul begint de schaal op nul");
  assert(bereik.min === 1000, "op het eigen bereik begint de schaal op het laagste punt");
  assert(nul.bereik > bereik.bereik, "vanaf nul is het bereik ruimer, dus de vorm vlakker");
}

// Een negatieve waarde mag niet buiten het vlak vallen; dan is nul niet meer de bodem.
{
  const { min } = sparkSchaal([-20, 40], "nul");
  assert(min === -20, "een negatieve waarde verlaagt de bodem onder nul");
}

// Een vlakke reeks heeft geen bereik. Delen door nul geeft NaN en dan verdwijnt de lijn.
{
  const { bereik } = sparkSchaal([7, 7, 7], "bereik");
  assert(Number.isFinite(bereik) && bereik > 0, "een vlakke reeks houdt een bruikbaar bereik");
  const punten = sparkPunten([7, 7, 7], "bereik", 60, 20);
  assert(punten.stukken.length === 1 && punten.stukken[0].length === 3, "en levert gewoon drie punten op");
  assert(punten.stukken[0].every((p) => Number.isFinite(p.y)), "zonder NaN in de hoogte");
}

// ── Gaten ──
// Een ontbrekende maand is geen nul. De lijn hoort te breken, niet dwars over het gat te lopen:
// doorverbinden tekent een meting die er niet is.
{
  const { stukken } = sparkPunten([10, null, 30, 40], "nul", 60, 20);
  assert(stukken.length === 2, "een gat splitst de lijn in twee stukken");
  assert(stukken[0].length === 1 && stukken[1].length === 2, "de punten verdelen zich over de stukken");
}

// De x-positie volgt de índex en niet de plek in de overgebleven punten — anders schuift de reeks
// na een gat naar links en klopt de tijdas niet meer.
{
  const { stukken } = sparkPunten([10, null, 30], "nul", 100, 20);
  assert(dichtbij(stukken[0][0].x, 0), "het eerste punt staat links");
  assert(dichtbij(stukken[1][0].x, 100), "het punt ná het gat staat op zijn eigen index, niet opgeschoven");
}

// ── Randgevallen ──
{
  assert(sparkPunten([], "nul", 60, 20).stukken.length === 0, "een lege reeks levert niets");
  assert(sparkPunten([5], "nul", 60, 20).stukken.length === 1, "één punt is één stuk");
  const kapot = sparkPunten([10, NaN, Infinity, 30], "nul", 60, 20);
  assert(kapot.stukken.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), "NaN en Infinity vallen eruit in plaats van de vorm te slopen");
}

// Het laatste échte punt is waar de accent-stip staat; eindigt de reeks met een gat, dan hoort de
// stip op het laatste gemeten punt en niet op de rand.
{
  const { laatste } = sparkPunten([10, 20, null], "nul", 100, 20);
  assert(laatste != null && dichtbij(laatste.x, 50), "de eindstip staat op het laatste gemeten punt");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
