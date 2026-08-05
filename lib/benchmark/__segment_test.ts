// Bedrijfsmodel, niche en de normalisatie.

import {
  BEDRIJFSMODELLEN, NICHES, isBekendeNiche, nicheLabel, nichesPerGroep,
  normaliseerNiche, vrijeNichesTellen, uitOudeSector,
} from "./segment";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("de lijsten zelf");
check("twee bedrijfsmodellen, geen derde", BEDRIJFSMODELLEN.length === 2,
  BEDRIJFSMODELLEN.map((b) => b.waarde).join(","));
// "beide"/"hybride" trekt elke twijfelaar aan en levert dan drie dunne segmenten op in plaats
// van twee dikke. Wie het niet weet laat leeg; dat is een eerlijke onbekende.
check("geen 'beide' of 'hybride'",
  !BEDRIJFSMODELLEN.some((b) => /beide|hybri/i.test(b.waarde + b.label)));
check("nichewaarden zijn uniek", new Set(NICHES.map((n) => n.waarde)).size === NICHES.length);
check("elke niche heeft een label en een groep",
  NICHES.every((n) => n.label.trim() && n.groep.trim()));
check("groepen blijven bij elkaar in de keuzelijst",
  nichesPerGroep().reduce((s, g) => s + g.opties.length, 0) === NICHES.length);

check("bekende niche wordt herkend", isBekendeNiche("fysiotherapie"));
check("onbekende niche niet", !isBekendeNiche("tandarts-om-de-hoek"));
check("leeg is geen niche", !isBekendeNiche("") && !isBekendeNiche(null));
check("label van een bekende niche", nicheLabel("software") === "Software & SaaS");
// Een onbekende waarde ongewijzigd doorlaten: die komt uit het vrije veld en is beter dan niets.
check("onbekende waarde blijft zichzelf", nicheLabel("tandarts") === "tandarts");
check("null blijft null", nicheLabel(null) === null);

console.log("\nnormaliseerNiche");
// DIT is waar het vrije veld op stukloopt zonder normalisatie: vijf schrijfwijzen, vijf vakjes
// van één account, en dan haalt niets ooit een drempel.
const varianten = ["tandarts", "Tandarts", " TANDARTS ", "tand arts", "tand-arts", "tand_arts"];
const genormaliseerd = new Set(varianten.map((v) => normaliseerNiche(v)));
check("zes schrijfwijzen worden twee vakjes in plaats van zes",
  genormaliseerd.size === 2, [...genormaliseerd].join(" | "));
check("hoofdletters en randruimte verdwijnen", normaliseerNiche("  Tandarts ") === "tandarts");
check("spaties worden streepjes", normaliseerNiche("bouw en installatie") === "bouw-en-installatie");
check("accenten eraf", normaliseerNiche("café") === "cafe");
check("leestekens eruit", normaliseerNiche("b2b/saas!") === "b2b-saas");
check("dubbele scheidingstekens worden er één", normaliseerNiche("zorg  --  overig") === "zorg-overig");
check("leeg geeft null", normaliseerNiche("") === null && normaliseerNiche("   ") === null);
check("alleen leestekens geeft null", normaliseerNiche("!!!") === null);
check("null blijft null", normaliseerNiche(null) === null);

// GEEN synoniemen en GEEN stammen. "tandarts" en "tandheelkunde" samenvoegen is een gok, en een
// verkeerde samenvoeging levert een benchmark op die niemand kan controleren -- erger dan twee
// losse hokjes.
check("geen synoniemen: tandarts wordt niet tandheelkunde",
  normaliseerNiche("tandarts") !== "tandheelkunde");

console.log("\nvrijeNichesTellen");
const vrij = vrijeNichesTellen([
  "Tandarts", "tandarts", " tandarts ",
  "kappers", "Kappers",
  "fysiotherapie",              // staat al in de vaste lijst → telt niet mee
  "software",                   // idem
  null, "", "  ",
]);
check("alleen wat niet in de vaste lijst staat",
  !vrij.some((v) => v.waarde === "fysiotherapie" || v.waarde === "software"),
  JSON.stringify(vrij));
check("varianten worden opgeteld", vrij.find((v) => v.waarde === "tandarts")?.aantal === 3,
  JSON.stringify(vrij));
check("aflopend op aantal", vrij[0].waarde === "tandarts" && vrij[0].aantal === 3);
check("lege waarden tellen niet mee", !vrij.some((v) => !v.waarde));

console.log("\nuitOudeSector");
// De vijf klanten die vandaag een sector hebben, plus de gevallen waar het misging.
check("b2b_saas levert model én niche",
  JSON.stringify(uitOudeSector("b2b_saas")) === JSON.stringify({ model: "b2b", niche: "software" }));
check("fysiotherapie levert een niche en een model",
  JSON.stringify(uitOudeSector("fysiotherapie")) === JSON.stringify({ model: "b2c", niche: "fysiotherapie" }));
// Ticketgrootte is GEEN niche: die staat al in aov_segment en was daar een duplicaat van.
check("ecommerce_laag_ticket is een model zonder niche",
  JSON.stringify(uitOudeSector("ecommerce_laag_ticket")) === JSON.stringify({ model: "b2c", niche: null }));
check("automotive heeft geen vanzelfsprekend model",
  JSON.stringify(uitOudeSector("automotive")) === JSON.stringify({ model: null, niche: "automotive" }));
// "hybrid" was een accounttype dat per ongeluk in de sectorlijst stond.
check("hybrid levert niets op",
  JSON.stringify(uitOudeSector("hybrid")) === JSON.stringify({ model: null, niche: null }));
check("onbekende sector levert niets op",
  JSON.stringify(uitOudeSector("iets-anders")) === JSON.stringify({ model: null, niche: null }));
check("null levert niets op",
  JSON.stringify(uitOudeSector(null)) === JSON.stringify({ model: null, niche: null }));

// Elke niche die uit een oude sector komt, moet in de vaste lijst staan -- anders migreert er
// een waarde in die nergens in een menu voorkomt.
const OUDE = ["ecommerce_laag_ticket", "ecommerce_mid_ticket", "ecommerce_hoog_ticket",
  "ecommerce_fashion", "ecommerce_electronics", "ecommerce_huisdieren", "fysiotherapie",
  "zorg_generiek", "b2b_saas", "b2b_leadgen", "leadgen_generiek", "automotive", "legal",
  "finance", "horeca", "retail_local", "hybrid"];
const wees = OUDE.map(uitOudeSector).map((x) => x.niche).filter((n): n is string => !!n)
  .filter((n) => !isBekendeNiche(n));
check("geen enkele oude sector migreert naar een onbekende niche", wees.length === 0, wees.join(","));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
