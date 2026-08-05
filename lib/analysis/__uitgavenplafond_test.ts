// Het uitgavenplafond, puur getest.
//
// De vijf keuzes uit de kop van uitgavenplafond.ts staan hier één voor één vastgelegd, want het
// zijn precies de plekken waar een plafond stilzwijgend niet doet wat je denkt: hij laat er nog
// eentje door, of hij telt een onbekende prijs als nul en meldt dat je ruim zit.

import {
  beoordeelPlafond, leesPlafond, maandStart, resetDatum, schatCallKosten,
  WAARSCHUWINGSGRENS, PLAFOND_ENV, leesMaandverbruik,
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

// De query wordt hier nagebootst, want het punt is nét welke filters erop komen te staan: met
// twee bureaus in dezelfde tabel betaalt het ene het plafond van het andere op als agency_id
// ontbreekt, en dat is de eerste dag dat er een tweede klant is -- geen randgeval.
function nepClient(rijen: Array<{ cost_eur: number | null; agency_id: string | null }>) {
  const gebruikt: string[] = [];
  const bouw = (filter: (r: (typeof rijen)[number]) => boolean) => ({
    gte(_kolom: string, _waarde: string) { gebruikt.push("gte:created_at"); return this; },
    eq(kolom: string, waarde: string) {
      gebruikt.push(`eq:${kolom}`);
      return bouw((r) => filter(r) && (r as Record<string, unknown>)[kolom] === waarde);
    },
    then(res: (v: { data: unknown; error: null }) => void) {
      res({ data: rijen.filter(filter).map((r) => ({ cost_eur: r.cost_eur })), error: null });
    },
  });
  return { from: () => ({ select: () => bouw(() => true) }), gebruikt };
}

const rijen = [
  { cost_eur: 10, agency_id: "bureau-a" },
  { cost_eur: 5, agency_id: "bureau-a" },
  { cost_eur: 40, agency_id: "bureau-b" },
  { cost_eur: null, agency_id: "bureau-a" },
];

console.log("\nschatCallKosten");
check("een bekend model levert een bedrag", schatCallKosten("gemini-3-flash-preview", 30000, 1000) > 0);
check("een onbekend model schat niet en geeft nul", schatCallKosten("iets-anders", 30000, 1000) === 0);

async function main() {
  console.log("\nleesMaandverbruik per bureau");
  const alles = await leesMaandverbruik(nepClient(rijen) as never);
  check("zonder bureau telt hij platformbreed", alles.besteed === 55, JSON.stringify(alles));
  check("en telt de prijsloze call als onbekend", alles.onbekend === 1, String(alles.onbekend));

  const client = nepClient(rijen);
  const perBureau = await leesMaandverbruik(client as never, new Date(), "bureau-a");
  check("met bureau telt hij alleen dat bureau", perBureau.besteed === 15, JSON.stringify(perBureau));
  check("het bureaufilter staat echt op de query", client.gebruikt.includes("eq:agency_id"), client.gebruikt.join(","));
  check(
    "bureau-b betaalt niet mee aan het plafond van bureau-a",
    (await leesMaandverbruik(nepClient(rijen) as never, new Date(), "bureau-b")).besteed === 40
  );

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
