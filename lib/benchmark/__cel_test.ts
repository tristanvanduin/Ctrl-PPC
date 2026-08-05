// Wanneer een benchmarkcel gedeeld mag worden.
//
// Dit is de regel waar het hele juridische verhaal op rust: "geanonimiseerd" is een bewering, en
// deze module is wat die bewering waarmaakt. Vandaar dat elke drempel hier met vaste getallen
// vastligt en niet uit data komt.

import {
  beoordeelCel, celoverzicht, diepteVan, magVerdiepen,
  MIN_ACCOUNTS, MIN_BUREAUS, MIN_ACCOUNTS_COMBINATIE, MIN_BUREAUS_COMBINATIE,
} from "./cel";
import type { Bedrijfsmodel } from "./segment";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const G = "google";

console.log("diepteVan");
check("alleen model", diepteVan({ channel: G, model: "b2b", niche: null }) === "model");
check("alleen niche", diepteVan({ channel: G, model: null, niche: "software" }) === "niche");
check("allebei", diepteVan({ channel: G, model: "b2b", niche: "software" }) === "model_en_niche");
check("geen van beide", diepteVan({ channel: G, model: null, niche: null }) === null);

console.log("\nbeoordeelCel — de drempel");
const ruim = { accounts: MIN_ACCOUNTS, bureaus: MIN_BUREAUS };
check("precies op de drempel mag",
  beoordeelCel({ channel: G, model: "b2b", niche: null }, ruim).deelbaar === true);
check("één account te weinig mag niet",
  beoordeelCel({ channel: G, model: "b2b", niche: null },
    { ...ruim, accounts: MIN_ACCOUNTS - 1 }).deelbaar === false);

// DE REGEL DIE BIJNA ALTIJD VERGETEN WORDT. Eén bureau met tien vergelijkbare klanten is "tien
// accounts" maar verraadt het boek van dat ene bureau.
const eenBureau = beoordeelCel({ channel: G, model: "b2b", niche: null }, { accounts: 40, bureaus: 1 });
check("veertig accounts van één bureau mag NIET", eenBureau.deelbaar === false);
check("en de reden noemt de bureaus",
  !eenBureau.deelbaar && eenBureau.reden.includes("bureaus"), !eenBureau.deelbaar ? eenBureau.reden : "");
check("het tekort staat erbij",
  !eenBureau.deelbaar && eenBureau.tekort.bureaus === MIN_BUREAUS - 1 && eenBureau.tekort.accounts === 0,
  !eenBureau.deelbaar ? JSON.stringify(eenBureau.tekort) : "");

console.log("\nbeoordeelCel — een cel zonder afbakening");
// Niet omdat "alle accounts samen" gevaarlijk is -- dat is juist het veiligste vakje -- maar
// omdat een gemiddelde over e-commerce en tandartsen door elkaar geen benchmark is.
const zonder = beoordeelCel({ channel: G, model: null, niche: null }, { accounts: 5000, bureaus: 300 });
check("geen afbakening is nooit deelbaar, hoe groot ook", zonder.deelbaar === false);
check("en de reden zegt waarom", !zonder.deelbaar && /geen benchmark/.test(zonder.reden));

console.log("\nbeoordeelCel — de combinatie is strenger");
const combi = { channel: G, model: "b2b" as Bedrijfsmodel, niche: "software" };
check("wat voor één dimensie genoeg is, is voor de combinatie te weinig",
  beoordeelCel({ channel: G, model: "b2b", niche: null }, ruim).deelbaar === true &&
  beoordeelCel(combi, ruim).deelbaar === false);
check("op de combinatiedrempel mag het wel",
  beoordeelCel(combi, { accounts: MIN_ACCOUNTS_COMBINATIE, bureaus: MIN_BUREAUS_COMBINATIE }).deelbaar === true);
const teDun = beoordeelCel(combi, ruim);
check("en het advies is terugvallen op één dimensie",
  !teDun.deelbaar && /alleen model of alleen niche/.test(teDun.reden), !teDun.deelbaar ? teDun.reden : "");

console.log("\nmagVerdiepen");
check("onder de combinatiedrempel: nog niet verdiepen",
  !magVerdiepen({ accounts: MIN_ACCOUNTS_COMBINATIE - 1, bureaus: MIN_BUREAUS_COMBINATIE }));
check("genoeg accounts maar te weinig bureaus: nog niet",
  !magVerdiepen({ accounts: 500, bureaus: MIN_BUREAUS_COMBINATIE - 1 }));
check("allebei genoeg: verdiepen mag",
  magVerdiepen({ accounts: MIN_ACCOUNTS_COMBINATIE, bureaus: MIN_BUREAUS_COMBINATIE }));

console.log("\nceloverzicht");
// Twaalf b2b-accounts verdeeld over vier bureaus, waarvan vijf ook een niche hebben.
const accounts = [
  ...Array.from({ length: 12 }, (_, i) => ({
    channel: G, agencyId: `bureau-${i % 4}`, model: "b2b" as Bedrijfsmodel,
    niche: i < 5 ? "software" : null,
  })),
  // Drie b2c-accounts van één bureau: te weinig, en van één bureau.
  ...Array.from({ length: 3 }, () => ({
    channel: G, agencyId: "bureau-x", model: "b2c" as Bedrijfsmodel, niche: null,
  })),
];
const cellen = celoverzicht(accounts);

const modelB2b = cellen.find((c) => c.sleutel.model === "b2b" && !c.sleutel.niche);
check("de b2b-cel telt ALLE twaalf, ook die met een niche",
  modelB2b?.telling.accounts === 12, JSON.stringify(modelB2b?.telling));
check("en vier bureaus", modelB2b?.telling.bureaus === 4);
check("de b2b-cel is deelbaar", modelB2b?.oordeel.deelbaar === true);

const nicheSw = cellen.find((c) => c.sleutel.niche === "software" && !c.sleutel.model);
check("de niche-cel bestaat apart", nicheSw?.telling.accounts === 5, JSON.stringify(nicheSw?.telling));
check("maar haalt de drempel niet", nicheSw?.oordeel.deelbaar === false);

const kruising = cellen.find((c) => c.sleutel.model === "b2b" && c.sleutel.niche === "software");
check("de combinatie bestaat wel als cel", !!kruising);
check("maar is zeker niet deelbaar", kruising?.oordeel.deelbaar === false);

const b2c = cellen.find((c) => c.sleutel.model === "b2c");
check("drie accounts van één bureau: niet deelbaar", b2c?.oordeel.deelbaar === false);
check("aflopend op omvang", cellen[0].telling.accounts >= cellen[cellen.length - 1].telling.accounts);

// Een account zonder labels hoort in geen enkele cel te belanden.
const naamloos = celoverzicht([{ channel: G, agencyId: "b", model: null, niche: null }]);
check("een account zonder labels levert geen cel op", naamloos.length === 0, JSON.stringify(naamloos));

// Kanalen blijven gescheiden: "Google versus Google van andere bureaus" is de vraag, niet
// Google versus Meta op één hoop.
const gemengd = celoverzicht([
  ...Array.from({ length: 10 }, (_, i) => ({ channel: "google", agencyId: `b${i % 4}`, model: "b2b" as Bedrijfsmodel, niche: null })),
  ...Array.from({ length: 10 }, (_, i) => ({ channel: "meta", agencyId: `b${i % 4}`, model: "b2b" as Bedrijfsmodel, niche: null })),
]);
check("twee kanalen geven twee cellen, geen samengevoegde",
  gemengd.filter((c) => c.sleutel.model === "b2b").length === 2,
  gemengd.map((c) => `${c.sleutel.channel}:${c.telling.accounts}`).join(","));
check("en elk met zijn eigen telling",
  gemengd.every((c) => c.telling.accounts === 10));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
