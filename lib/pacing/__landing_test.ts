// Waar land je op dit tempo. Deterministisch, geen IO.
// Draaien: npx tsx lib/pacing/__landing_test.ts

import { berekenLanding, seizoensduiding, SEIZOEN_DREMPEL } from "./landing";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De rechte lijn ────────────────────────────────────────────────────────

{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: 100, doel: 1200 });
  check("landing is gerealiseerd plus tempo maal dagen", l.opTempo === 900, String(l.opTempo));
  check("het deel van het doel klopt", l.deelVanDoel === 0.75, String(l.deelVanDoel));
}

// Wat binnen is, is binnen. Negatieve resterende dagen zouden de landing ONDER het gerealiseerde
// brengen, en dat kan niet -- dat zou lezen als "je raakt conversies kwijt".
{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: -20 });
  check("na de laatste dag is de landing wat er staat", l.opTempo === 600, String(l.opTempo));
}
{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: -5, dagenResterend: 10 });
  check("een negatief tempo telt als stilstand", l.opTempo === 600, String(l.opTempo));
}

// ── Geen doel is geen percentage ──────────────────────────────────────────
//
// Null en geen 0. Nul procent leest als "je haalt er niets van", terwijl er simpelweg geen doel
// is om iets van te halen. Datzelfde onderscheid staat al in health-score.ts: ontbrekende kennis
// is geen slechte score.

{
  check("zonder doel geen percentage",
    berekenLanding({ gerealiseerd: 100, tempoPerDag: 1, dagenResterend: 10 }).deelVanDoel === null);
  check("een doel van nul telt niet als doel",
    berekenLanding({ gerealiseerd: 100, tempoPerDag: 1, dagenResterend: 10, doel: 0 }).deelVanDoel === null);
  check("een negatief doel telt niet als doel",
    berekenLanding({ gerealiseerd: 100, tempoPerDag: 1, dagenResterend: 10, doel: -5 }).deelVanDoel === null);
}

// ── Het seizoensverschil ──────────────────────────────────────────────────
//
// DE HELE REDEN DAT ER TWEE GETALLEN STAAN. Een rechte lijn weet niet dat november niet op juli
// lijkt; de prognose wel. Het verschil tussen die twee ís de seizoensinformatie, en die is
// stuurbaar: piek nog voor je, of gehad.

{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: 100, prognose: 1080 });
  check("de prognose komt ongewijzigd terug", l.volgensPrognose === 1080);
  check("het verschil is een fractie van de rechte lijn",
    Math.abs((l.seizoensverschil ?? 0) - 0.2) < 1e-9, String(l.seizoensverschil));
  check("en wordt als 'komt nog' geduid",
    /sterke seizoen moet nog komen/.test(seizoensduiding(l) ?? ""), String(seizoensduiding(l)));
}
{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: 100, prognose: 720 });
  check("een lagere prognose wordt als 'geweest' geduid",
    /sterke seizoen is geweest/.test(seizoensduiding(l) ?? ""), String(seizoensduiding(l)));
  check("het percentage staat erbij", /20%/.test(seizoensduiding(l) ?? ""), String(seizoensduiding(l)));
}

// Onder de drempel geen zin. Twee modellen op dezelfde data lopen altijd een beetje uiteen; een
// zin over elk verschil leert de lezer hem over te slaan, en dan mist hij hem als het ertoe doet.
{
  const klein = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: 100, prognose: 920 });
  check("een klein verschil krijgt geen zin", seizoensduiding(klein) === null,
    `${klein.seizoensverschil} → ${seizoensduiding(klein)}`);
  check("de drempel staat op vijf procent", SEIZOEN_DREMPEL === 0.05);
}

// Zonder prognose valt er niets te vergelijken.
{
  const l = berekenLanding({ gerealiseerd: 600, tempoPerDag: 3, dagenResterend: 100 });
  check("zonder prognose geen verschil", l.seizoensverschil === null);
  check("zonder prognose geen zin", seizoensduiding(l) === null);
}

// Een landing van nul: er is niets om een afwijking op te betrekken.
{
  const l = berekenLanding({ gerealiseerd: 0, tempoPerDag: 0, dagenResterend: 100, prognose: 50 });
  check("een landing van nul geeft geen verschil", l.seizoensverschil === null, String(l.seizoensverschil));
  check("maar de prognose blijft leesbaar", l.volgensPrognose === 50);
}

// ── Onzin-invoer ──────────────────────────────────────────────────────────

{
  const l = berekenLanding({ gerealiseerd: NaN, tempoPerDag: NaN, dagenResterend: NaN });
  check("NaN levert nul en geen NaN", l.opTempo === 0, String(l.opTempo));
  const o = berekenLanding({ gerealiseerd: 10, tempoPerDag: Infinity, dagenResterend: 5 });
  check("oneindig tempo telt als geen tempo", o.opTempo === 10, String(o.opTempo));
  const p = berekenLanding({ gerealiseerd: 10, tempoPerDag: 1, dagenResterend: 5, prognose: NaN });
  check("een onbruikbare prognose telt als geen prognose", p.volgensPrognose === null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
