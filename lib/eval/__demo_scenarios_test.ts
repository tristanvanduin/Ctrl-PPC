// Test: de evaluatieset van de demo-scenario's (lib/eval/demo-scenarios.ts).
// Draaien: tsx lib/eval/__demo_scenarios_test.ts
//
// Drie dingen moeten kloppen, anders zegt een score niets: een analyse die alles noemt scoort alles
// gevonden en niets vals; een lege analyse scoort alles gemist en de mag-niet's terecht stil; en een
// analyse die precies de valkuilen inloopt (GRA bijsturen, Inkoop opschalen, de brandcampagne als
// probleem) wordt daarop afgerekend, ook als hij verder alles vindt.

import { DEMO_SCENARIOS, scoorTegenScenarios, eenheden, kanalenVanSopType } from "./demo-scenarios";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// 1. De set dekt S1 tot S20 en het stille scenario, elk met minstens een verwachting.
const ids = DEMO_SCENARIOS.map((s) => s.id);
check("21 scenario's", ids.length === 21, String(ids.length));
for (let i = 1; i <= 20; i++) check(`S${i} staat in de set`, ids.includes(`S${i}`));
check("het stille scenario staat in de set", ids.includes("stil"));
check("elk scenario heeft een verwachting", DEMO_SCENARIOS.every((s) => s.verwachtingen.length > 0));
check("vier mag-niet's (S11, S16 Inkoop, S19 tweedehands, stil)",
  DEMO_SCENARIOS.flatMap((s) => s.verwachtingen).filter((v) => v.soort === "mag-niet").length === 4);

// 2. Een analyse die alles goed noemt.
const goed = [
  "- Meta: Hero Video A vertoont creative fatigue, CTR -42% bij frequency 4,2.",
  "- De Awareness-campagne zit op frequentie 4,6: verzadiging.",
  "- Static Banner C heeft een BELOW_AVERAGE quality ranking.",
  "- Product Carousel D: de hook-rate ligt ver onder de mediaan.",
  "- GRT ABM Benelux: het lead-formulier wordt maar 10% afgerond (drop-off).",
  "- LinkedIn CPL stijgt +25% in GRT ABM tegenover het vorige venster.",
  "- Zaai-oogst: meer social-vertoningen in juni, en de brand-klikken stegen 18%.",
  "- De blended CPA stijgt door een mix-verschuiving naar LinkedIn (Simpson); de LinkedIn-CPA zelf is stabiel.",
  "- 75% van de LinkedIn-leads komt uit Education, buiten het ICP.",
  "- GRT (GreenTech Amsterdam): de aanloop ligt 35% achter op vorig jaar bij gelijke spend.",
  "- GRA ligt op koers (+10%), geen actie nodig.",
  "- GRN is een eerste editie: er is geen vorige om tegen af te zetten.",
  "- Impressieaandeel: GRT verliest op budget, GRA op rang.",
  "- Microsoft: de CPA van de import-campagne loopt 12 weken op tegenover native.",
  "- Het Audience Network neemt 18% van de spend en 1% van de conversies: uitsluiten.",
  "- Tuinbouw & Agri: verhoog de bid-modifier, onder de account-CPA en boven de volumegrens.",
  "- Inkoop oogt goed maar zit onder de volumegrens: nog geen bodaanpassing.",
  "- Desktop domineert in volume en CPA tegenover mobiel.",
  "- Het budgetverlies (impression share) op de import-campagne loopt op.",
  "- greenhouse solutions is een bleeder: ruim twee keer de account-CPA zonder conversies.",
  "- kas kopen tweedehands: te vroeg om te oordelen, onder de rem.",
  "- Zoektermen: verouderde negatives op de import laten jobs, tickets en gratis door; uitsluiten.",
  "- GreenTech | Brand blijft gezond en stabiel.",
].join("\n");
const g = scoorTegenScenarios(goed);
check("goed: niets gemist", g.gemist === 0, JSON.stringify(g.scenarios.filter((s) => s.gemist.length).map((s) => s.id)));
check("goed: niets vals", g.vals === 0, JSON.stringify(g.scenarios.filter((s) => s.vals.length).map((s) => [s.id, s.vals])));
check("goed: 19 moet's gevonden (alle scenario's behalve S11 en stil)", g.gevonden === 19, String(g.gevonden));
check("goed: S11 terecht stil", g.scenarios.find((s) => s.id === "S11")?.status === "terecht stil");
check("goed: S16 gevonden (Tuinbouw wel, Inkoop terecht met nuance)", g.scenarios.find((s) => s.id === "S16")?.status === "gevonden");

// 3. Een lege analyse.
const leeg = scoorTegenScenarios("Geen bijzonderheden deze maand.");
check("leeg: alle 19 moet's gemist", leeg.gemist === 19 && leeg.gevonden === 0, `${leeg.gemist}/${leeg.gevonden}`);
check("leeg: niets vals", leeg.vals === 0);
check("leeg: het stille scenario is terecht stil", leeg.scenarios.find((s) => s.id === "stil")?.status === "terecht stil");

// 4. De valkuilen.
const valkuilen = goed
  .replace("- GRA ligt op koers (+10%), geen actie nodig.", "- GRA: verhoog het budget met 20% om de beurs te halen.")
  .replace("- Inkoop oogt goed maar zit onder de volumegrens: nog geen bodaanpassing.", "- Inkoop is de beste kans: verhoog het bod.")
  .replace("- GreenTech | Brand blijft gezond en stabiel.", "- GreenTech | Brand: de CPA is te hoog, verlaag het budget.");
const v = scoorTegenScenarios(valkuilen);
check("valkuilen: drie valse meldingen", v.vals === 3, String(v.vals));
check("valkuilen: S11 vals", v.scenarios.find((s) => s.id === "S11")?.status === "vals");
check("valkuilen: S16 vals, ook al is Tuinbouw gevonden",
  v.scenarios.find((s) => s.id === "S16")?.status === "vals" && v.scenarios.find((s) => s.id === "S16")!.gevonden.length === 1);
check("valkuilen: stil vals", v.scenarios.find((s) => s.id === "stil")?.status === "vals");
check("valkuilen: de valse eenheid staat in de uitslag", /verhoog het budget/.test(v.scenarios.find((s) => s.id === "S11")!.vals[0].eenheid));

// 5. Bereik per kanaal: een Microsoft-analyse wordt niet afgerekend op Meta-creatives.
const ms = scoorTegenScenarios(goed, { kanalen: ["microsoft"] });
check("microsoft: zeven scenario's in bereik (S14 tot S20)", ms.inBereik === 7, String(ms.inBereik));
check("microsoft: S1 buiten bereik", ms.scenarios.find((s) => s.id === "S1")?.status === "buiten bereik");
check("sop_type microsoft_biweekly -> microsoft", JSON.stringify(kanalenVanSopType("microsoft_biweekly")) === '["microsoft"]');
check("sop_type monthly -> google", JSON.stringify(kanalenVanSopType("monthly")) === '["google"]');
check("sop_type cross_channel -> alle kanalen", kanalenVanSopType("cross_channel_monthly") === undefined);

// 6. JSON-uitvoer: elke tekstwaarde is een eenheid, ook genest.
const json = JSON.stringify({ findings: [{ title: "Hero Video A", text: "Hero Video A: fatigue, CTR daalt" }], meta: { n: 3 } });
check("json: tekstwaarden worden eenheden", eenheden(json).includes("Hero Video A: fatigue, CTR daalt"));
check("json: S1 gevonden in JSON-uitvoer", scoorTegenScenarios(json, { kanalen: ["meta"] }).scenarios.find((s) => s.id === "S1")?.status === "gevonden");
// Twee halve regels maken geen bevinding: de entiteit en het verschijnsel moeten samen staan.
const verspreid = scoorTegenScenarios("Hero Video A draait goed.\nElders is er fatigue.", { kanalen: ["meta"] });
check("verspreid over twee regels: gemist", verspreid.scenarios.find((s) => s.id === "S1")?.status === "gemist");

// 7. Juiste uitvoer mag niet vals scoren. Dit zijn de tegenvoorbeelden van de controle: een eerdere
// versie telde elk "stijgt" en "daalt" als probleem, ongeacht de richting, en rekende zo precies de
// ontworpen uitkomst af. Elk van deze zinnen is correct en moet terecht stil zijn.
const juist: [string, string][] = [
  ["S11", "GRA (GreenTech Americas) stijgt +10% in conversies tegenover de vorige editie."],
  ["stil", "GreenTech | Brand: de CPA daalt naar € 9, de efficientste campagne."],
  ["stil", "GreenTech | Brand: klikken stijgen 12% door meer merkzoekopdrachten."],
  ["S16", "Inkoop: 12 klikken, onder de drempel van 30; geen bodaanpassing."],
  ["stil", "GreenTech | Brand: de kosten per conversie dalen naar € 9."],
];
for (const [id, zin] of juist) {
  const s = scoorTegenScenarios(zin).scenarios.find((x) => x.id === id);
  check(`juist en dus niet vals (${id}): ${zin}`, s?.status !== "vals", JSON.stringify(s?.vals));
}
// Maar de slechte kant op blijft een valse melding bij een gezonde campagne.
for (const [id, zin] of [
  ["stil", "GreenTech | Brand: de CPA stijgt 30% tegenover vorige maand."],
  ["stil", "GreenTech | Brand: de conversies dalen 20%."],
  ["S11", "GRA loopt 15% achter op de vorige editie."],
] as [string, string][]) {
  check(`slechte richting is vals (${id}): ${zin}`, scoorTegenScenarios(zin).scenarios.find((x) => x.id === id)?.status === "vals");
}
// S1: alleen "CTR" noemen is geen bevinding; de hoogste CTR is het tegendeel ervan.
const s1 = (zin: string) => scoorTegenScenarios(zin, { kanalen: ["meta"] }).scenarios.find((x) => x.id === "S1")?.status;
check("S1: 'hoogste CTR' telt niet als gevonden", s1("Hero Video A heeft de hoogste CTR van het account.") === "gemist");
check("S1: dalende CTR telt wel", s1("Hero Video A: de CTR daalt 40% bij hoge frequentie.") === "gevonden");
check("S1: oplopende frequentie telt wel", s1("Hero Video A: de frequentie loopt op naar 4,2.") === "gevonden");

console.log(`demo-scenarios: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
