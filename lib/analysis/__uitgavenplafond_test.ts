// Het uitgavenplafond, puur getest.
//
// De vijf keuzes uit de kop van uitgavenplafond.ts staan hier één voor één vastgelegd, want het
// zijn precies de plekken waar een plafond stilzwijgend niet doet wat je denkt: hij laat er nog
// eentje door, of hij telt een onbekende prijs als nul en meldt dat je ruim zit.

import {
  beoordeelPlafond, leesPlafond, maandStart, resetDatum, schatCallKosten,
  WAARSCHUWINGSGRENS, PLAFOND_ENV,
} from "./uitgavenplafond";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("leesPlafond");
check("afwezig is geen plafond", leesPlafond({}) === null);
check("leeg is geen plafond", leesPlafond({ [PLAFOND_ENV]: "  " }) === null);
check("onleesbaar is geen plafond, geen nul", leesPlafond({ [PLAFOND_ENV]: "vijftig" }) === null);
check("nul is geen plafond", leesPlafond({ [PLAFOND_ENV]: "0" }) === null);
check("negatief is geen plafond", leesPlafond({ [PLAFOND_ENV]: "-10" }) === null);
check("een bedrag komt door", leesPlafond({ [PLAFOND_ENV]: "50" }) === 50);
check("een komma leest als decimaalteken", leesPlafond({ [PLAFOND_ENV]: "12,50" }) === 12.5);

console.log("\nbeoordeelPlafond");
const basis = { besteed: 0, onbekend: 0, schatting: 0 };

check(
  "zonder plafond blokkeert niets",
  beoordeelPlafond({ ...basis, plafond: null, besteed: 999 }).toestand === "geen_plafond"
);

// KEUZE 1: de schatting telt mee. Zonder dat zou dit "ruim" heten en er daarna overheen gaan.
const netOnder = beoordeelPlafond({ plafond: 10, besteed: 9.5, onbekend: 0, schatting: 1 });
check("besteed + schatting bepaalt het oordeel", netOnder.toestand === "over", netOnder.toestand);
check("het tekort is het bedrag boven de grens", netOnder.toestand === "over" && netOnder.tekort === 0.5,
  netOnder.toestand === "over" ? String(netOnder.tekort) : "");
check(
  "zonder de schatting was ditzelfde geval nog ruim -- dat is precies het gat",
  beoordeelPlafond({ plafond: 10, besteed: 9.5, onbekend: 0, schatting: 0 }).toestand === "bijna"
);

// KEUZE 4: waarschuwen is niet blokkeren.
const bijna = beoordeelPlafond({ plafond: 100, besteed: 85, onbekend: 0, schatting: 0 });
check("op 85% waarschuwt hij", bijna.toestand === "bijna", bijna.toestand);
check("waarschuwen blokkeert niet", bijna.blokkeert === false);
check("de resterende ruimte staat erbij", bijna.toestand === "bijna" && bijna.resterend === 15);
check(
  "precies op de grens waarschuwt hij al",
  beoordeelPlafond({ plafond: 100, besteed: WAARSCHUWINGSGRENS * 100, onbekend: 0, schatting: 0 }).toestand === "bijna"
);
check(
  "net eronder is ruim",
  beoordeelPlafond({ plafond: 100, besteed: WAARSCHUWINGSGRENS * 100 - 0.01, onbekend: 0, schatting: 0 }).toestand === "ruim"
);

// Precies op het plafond is nog niet erover: een grens van € 50 laat € 50 toe.
check(
  "precies op het plafond blokkeert niet",
  beoordeelPlafond({ plafond: 50, besteed: 50, onbekend: 0, schatting: 0 }).blokkeert === false
);
check(
  "één cent erboven blokkeert wel",
  beoordeelPlafond({ plafond: 50, besteed: 50.01, onbekend: 0, schatting: 0 }).blokkeert === true
);

// KEUZE 2: onbekende prijzen maken het totaal een ondergrens, en dat moet in de tekst staan.
const metOnbekend = beoordeelPlafond({ plafond: 100, besteed: 85, onbekend: 3, schatting: 0 });
check(
  "het voorbehoud staat in de waarschuwing",
  metOnbekend.toestand === "bijna" && /geen bekende modelprijs/.test(metOnbekend.tekst),
  metOnbekend.toestand === "bijna" ? metOnbekend.tekst : ""
);
check(
  "het voorbehoud noemt het aantal",
  metOnbekend.toestand === "bijna" && metOnbekend.tekst.includes("3 calls"),
  metOnbekend.toestand === "bijna" ? metOnbekend.tekst : ""
);
check(
  "één call is enkelvoud",
  /1 call heeft/.test((beoordeelPlafond({ plafond: 100, besteed: 85, onbekend: 1, schatting: 0 }) as { tekst: string }).tekst)
);
check(
  "zonder onbekende calls geen voorbehoud",
  bijna.toestand === "bijna" && !/modelprijs/.test(bijna.tekst)
);
const overMetOnbekend = beoordeelPlafond({ plafond: 10, besteed: 20, onbekend: 2, schatting: 0 });
check(
  "ook de blokkade draagt het voorbehoud",
  overMetOnbekend.toestand === "over" && /modelprijs/.test(overMetOnbekend.tekst)
);

// De blokkadetekst moet zeggen wanneer het weer mag en hoe je het kunt verhogen; zonder dat is
// een blokkade een muur zonder deur.
const over = beoordeelPlafond({ plafond: 10, besteed: 20, onbekend: 0, schatting: 0 });
check("de blokkade noemt de resetdatum", over.toestand === "over" && over.tekst.includes(resetDatum()));
check("de blokkade noemt de instelling", over.toestand === "over" && over.tekst.includes(PLAFOND_ENV));
check("de blokkade noemt het plafondbedrag", over.toestand === "over" && over.tekst.includes("10,00"));

// Negatieve invoer mag het oordeel niet omdraaien.
check(
  "een negatief bestede bedrag telt als nul",
  beoordeelPlafond({ plafond: 10, besteed: -100, onbekend: 0, schatting: 0 }).toestand === "ruim"
);

console.log("\nmaandStart en resetDatum");
check("maandStart is de eerste van de maand in UTC",
  maandStart(new Date("2026-08-05T13:45:00Z")) === "2026-08-01T00:00:00.000Z",
  maandStart(new Date("2026-08-05T13:45:00Z")));
check("resetDatum is de eerste van de volgende maand",
  resetDatum(new Date("2026-08-05T13:45:00Z")) === "2026-09-01",
  resetDatum(new Date("2026-08-05T13:45:00Z")));
check("over de jaargrens heen klopt hij ook",
  resetDatum(new Date("2026-12-20T00:00:00Z")) === "2027-01-01",
  resetDatum(new Date("2026-12-20T00:00:00Z")));

console.log("\nschatCallKosten");
check("een bekend model levert een bedrag", schatCallKosten("gemini-3-flash-preview", 30000, 1000) > 0);
check("een onbekend model schat niet en geeft nul", schatCallKosten("iets-anders", 30000, 1000) === 0);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
