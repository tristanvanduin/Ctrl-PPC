// De inpakker. Deterministisch, geen IO.
// Draaien: npx tsx lib/layout/__bento_test.ts
//
// Waar dit over gaat: een blok dat wegvalt mag geen gat achterlaten. Dat gat is precies wat een
// pagina er kapot laat uitzien in plaats van leeg, en het is het geval dat bij 62 van de 71
// klanten optreedt -- die hebben alleen Google, dus alle kanaal-afhankelijke blokken vallen weg.

import { pakIn, pakInPlat, spanKlasse, KOLOMMEN, type Blok } from "./bento";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Elke rij hoort exact vol te zijn, of de blokken erin hebben hun maximum bereikt. */
function rijenVol(rijen: ReturnType<typeof pakIn>): boolean {
  return rijen.every((r) => r.reduce((s, b) => s + b.span, 0) <= KOLOMMEN);
}

// ── De gewone gevallen ────────────────────────────────────────────────────

{
  const rijen = pakIn([{ id: "grafiek", span: 8 }, { id: "tabel", span: 4 }]);
  check("acht plus vier is één rij", rijen.length === 1, JSON.stringify(rijen));
  check("en die is precies vol", rijen[0].reduce((s, b) => s + b.span, 0) === 12,
    JSON.stringify(rijen[0]));
  check("de gevraagde breedtes blijven staan",
    rijen[0].map((b) => b.span).join(",") === "8,4", JSON.stringify(rijen[0]));
}

{
  const rijen = pakIn([{ id: "a", span: 4 }, { id: "b", span: 4 }, { id: "c", span: 4 }]);
  check("drie keer vier is één rij", rijen.length === 1 && rijen[0].length === 3);
}

{
  const rijen = pakIn([{ id: "a", span: 8 }, { id: "b", span: 8 }]);
  check("twee keer acht wordt twee rijen", rijen.length === 2, JSON.stringify(rijen));
  // Elk blok staat alleen in zijn rij en groeit dus naar de volle breedte.
  check("allebei groeien naar twaalf",
    rijen.every((r) => r[0].span === 12), JSON.stringify(rijen));
}

// ── HET GAT ───────────────────────────────────────────────────────────────
//
// Het geval waarvoor dit bestaat. Een grafiek van 8 met een tabel van 4 ernaast is een nette rij.
// Heeft deze klant geen data voor die tabel, dan zou er zonder groeiregel een grafiek van 8 staan
// met vier lege kolommen ernaast -- en dat leest als een fout, niet als een keuze.

{
  const blokken: Blok[] = [
    { id: "grafiek", span: 8 },
    { id: "tabel", span: 4, heeftInhoud: false },
  ];
  const rijen = pakIn(blokken);
  check("het lege blok verdwijnt helemaal", rijen[0].length === 1, JSON.stringify(rijen));
  check("en de grafiek groeit naar de volle breedte", rijen[0][0].span === 12,
    JSON.stringify(rijen[0]));
}

// Twee blokken die allebei 4 vroegen worden 6 en 6, niet 4 en 8. Ze vroegen hetzelfde, dus ze
// krijgen hetzelfde -- alles aan de laatste geven maakt een willekeurig ogende asymmetrie.
{
  const rijen = pakIn([
    { id: "a", span: 4 }, { id: "b", span: 4 }, { id: "c", span: 4, heeftInhoud: false },
  ]);
  check("de rest wordt gelijk verdeeld", rijen[0].map((b) => b.span).join(",") === "6,6",
    JSON.stringify(rijen[0]));
}

// Bij een oneven rest gaat de extra kolom naar voren: links vangt het oog het eerst, daar valt
// één kolom verschil het minst op.
{
  const rijen = pakIn([{ id: "a", span: 3 }, { id: "b", span: 3 }, { id: "c", span: 3 }]);
  check("een oneven rest gaat naar de blokken vooraan",
    rijen[0].map((b) => b.span).join(",") === "4,4,4", JSON.stringify(rijen[0]));
}
{
  const rijen = pakIn([{ id: "a", span: 5 }, { id: "b", span: 5 }]);
  check("rest van twee over twee blokken", rijen[0].map((b) => b.span).join(",") === "6,6",
    JSON.stringify(rijen[0]));
}
{
  const rijen = pakIn([{ id: "a", span: 4 }, { id: "b", span: 3 }, { id: "c", span: 4 }]);
  check("rest van één gaat naar het eerste blok",
    rijen[0].map((b) => b.span).join(",") === "5,3,4", JSON.stringify(rijen[0]));
}

// ── maxSpan: groeien is niet altijd beter ─────────────────────────────────
//
// Een compacte cijfertegel die naar de volle breedte wordt uitgerekt is een lege kaart met een
// getal in de hoek. Wie dat niet wil, zegt hoe breed hij maximaal mag worden.

{
  const rijen = pakIn([{ id: "tegel", span: 3, maxSpan: 4 }]);
  check("een blok groeit niet voorbij zijn maximum", rijen[0][0].span === 4,
    JSON.stringify(rijen[0]));
  check("de rest van de rij blijft dan gewoon leeg",
    rijen[0].reduce((s, b) => s + b.span, 0) === 4, JSON.stringify(rijen[0]));
}

{
  // Eén blok raakt zijn maximum, het andere vangt de rest op.
  const rijen = pakIn([{ id: "tegel", span: 3, maxSpan: 4 }, { id: "grafiek", span: 4 }]);
  check("een blok dat zijn maximum raakt geeft de ruimte door",
    rijen[0].map((b) => b.span).join(",") === "4,8", JSON.stringify(rijen[0]));
}

// ── De volgorde ligt vast ─────────────────────────────────────────────────
//
// Er wordt niet geschoven om gaten te vermijden. De leesvolgorde van een pagina is een
// redactionele keuze; blokken die van plek wisselen omdat er toevallig ruimte was, maken dat een
// gebruiker de pagina bij elke klant opnieuw moet leren.

{
  const rijen = pakIn([{ id: "a", span: 8 }, { id: "b", span: 6 }, { id: "c", span: 4 }]);
  check("de invoervolgorde blijft staan",
    pakInPlat([{ id: "a", span: 8 }, { id: "b", span: 6 }, { id: "c", span: 4 }])
      .map((b) => b.id).join(",") === "a,b,c");
  check("er wordt niet herschikt om te passen", rijen.length === 2, JSON.stringify(rijen));
  check("geen enkele rij loopt over", rijenVol(rijen), JSON.stringify(rijen));
}

// ── Onzin-invoer ──────────────────────────────────────────────────────────

{
  check("geen blokken geeft geen rijen", pakIn([]).length === 0);
  check("alles leeg geeft geen rijen",
    pakIn([{ id: "a", span: 4, heeftInhoud: false }, { id: "b", span: 8, heeftInhoud: false }]).length === 0);
  check("een span groter dan de rij klemt op twaalf",
    pakIn([{ id: "a", span: 40 }])[0][0].span === 12);
  check("een span van nul klemt op één en groeit dan",
    pakIn([{ id: "a", span: 0 }])[0][0].span === 12, JSON.stringify(pakIn([{ id: "a", span: 0 }])));
  check("een negatieve span breekt niets",
    pakIn([{ id: "a", span: -5, maxSpan: 3 }])[0][0].span === 3);
}

// Veel blokken achter elkaar: geen enkele rij mag overlopen, en alles moet er nog zijn.
{
  const veel: Blok[] = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, span: (i % 4) + 2 }));
  const rijen = pakIn(veel);
  check("veel blokken: geen rij loopt over", rijenVol(rijen), String(rijen.length));
  check("veel blokken: er raakt niets kwijt",
    pakInPlat(veel).length === 25, String(pakInPlat(veel).length));
}

// ── De klassenamen ────────────────────────────────────────────────────────
//
// Tailwind scant de bron op LETTERLIJKE klassenamen. Een samengestelde `col-span-${n}` bestaat
// dus niet in de uitvoer-CSS, en dat faalt stil: het blok krijgt geen breedte en valt terug op de
// volle rij -- precies de indeling die we probeerden weg te halen. Vandaar een opzoektabel, en
// deze controle die vastlegt dat er voor elke breedte een naam is.

{
  for (let n = 1; n <= KOLOMMEN; n++) {
    check(`span ${n} heeft een klasse`, spanKlasse(n) === `lg:col-span-${n}`, spanKlasse(n));
  }
  check("een onmogelijke breedte valt terug op de volle rij",
    spanKlasse(99) === "lg:col-span-12" && spanKlasse(0) === "lg:col-span-1",
    `${spanKlasse(99)} / ${spanKlasse(0)}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
