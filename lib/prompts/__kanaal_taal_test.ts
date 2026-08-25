// Spreekt elke prompt de taal van zijn eigen kanaal?
// Draaien: npx tsx lib/prompts/__kanaal_taal_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// Alle vier de preambules begonnen met "Je bent een senior SEA specialist" -- ook bij een
// LinkedIn- of Meta-analyse. SEA is search advertising. De rol stuurt welk vakjargon en welke
// standaardoplossingen het model aandraagt, dus dat is geen cosmetische regel: een
// "SEA-specialist" die naar LinkedIn kijkt, grijpt naar zoekwoorden en biedstrategieen die daar
// niet bestaan.
//
// Hetzelfde gold voor de "denk breed"-catalogus in de hypothese-instructies. Die somde Performance
// Max, Shopping-feeds, Merchant Center en DSA op -- als aanmoediging om breed te denken, aan een
// model dat een LinkedIn-account analyseert. Breed denken in de verkeerde richting is erger dan
// niet breed denken.
//
// Bij prompttekst is "beter" niet te meten zonder een echte run. Wat WEL te toetsen is, is of er
// onzin in staat: termen van een ander platform. Deze test bewaakt precies dat, en niets meer.

import { buildWeeklyStep1Prompt, buildWeeklyStep3Prompt, buildBiWeeklyStep4Prompt, buildMonthlyStepPrompt, rolVoorKanaal } from "./sop-prompts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const DOELEN = "## Doelen\nCPL onder 80 euro.";

// Termen die uitsluitend in het Google-ecosysteem bestaan. Komt een van deze in een Meta- of
// LinkedIn-prompt voor, dan krijgt het model een zet aangeraden die op dat platform niet bestaat.
// Let op de precisie: de kale term "Shopping" deugt hier NIET als verbod. "Advantage+ Shopping" is
// een Meta-product, dus dat zou een terecht advies afkeuren. Alleen termen die eenduidig Google zijn.
const GOOGLE_ONLY = ["Merchant Center", "Performance Max", "PMax", "Google Shopping", "Shopping-feed",
  "tROAS", "Dynamic Search Ads", "zoekwoord", "Demand Gen"];

function promptsVoor(kanaal: "google_ads" | "meta_ads" | "linkedin_ads" | "microsoft_ads"): Record<string, string> {
  return {
    "weekly stap 1": buildWeeklyStep1Prompt(DOELEN, "leadgen_cpa", kanaal),
    "weekly stap 3": buildWeeklyStep3Prompt(DOELEN, "leadgen_cpa", kanaal),
    "bi-weekly stap 4": buildBiWeeklyStep4Prompt(DOELEN, "leadgen_cpa", "geen eerdere analyse", kanaal),
  };
}

console.log("De rol past bij het kanaal");
{
  check("google is SEA", rolVoorKanaal("google_ads").includes("SEA"));
  check("meta is Meta", rolVoorKanaal("meta_ads").includes("Meta"));
  check("linkedin is LinkedIn", rolVoorKanaal("linkedin_ads").includes("LinkedIn"));
  check("linkedin noemt B2B", rolVoorKanaal("linkedin_ads").includes("B2B"));
  check("microsoft is Microsoft (Bing)", rolVoorKanaal("microsoft_ads").includes("Microsoft") && rolVoorKanaal("microsoft_ads").includes("Bing"));
  // Een onbekend of ontbrekend kanaal mag het gedrag niet veranderen: dat blijft Google, zoals het
  // was voordat deze parameter bestond.
  check("onbekend valt terug op Google", rolVoorKanaal("iets") === rolVoorKanaal("google_ads"));
  check("leeg valt terug op Google", rolVoorKanaal(undefined) === rolVoorKanaal("google_ads"));
}

console.log("\nGeen enkele prompt noemt zichzelf SEA op een ander kanaal");
for (const kanaal of ["meta_ads", "linkedin_ads", "microsoft_ads"] as const) {
  for (const [naam, prompt] of Object.entries(promptsVoor(kanaal))) {
    check(`${kanaal} / ${naam}: geen 'SEA specialist'`, !/senior SEA/i.test(prompt),
      (prompt.match(/.{0,40}senior SEA.{0,40}/i) ?? [""])[0]);
  }
}
{
  const maandMeta = buildMonthlyStepPrompt(DOELEN, "leadgen_cpa", "## Stap 1\nAnalyseer.", "", {
    channel: "meta_ads", benchmarks: { ecommerce_roas: "", ecommerce_cpa: "", leadgen_cpa: "", leadgen_volume: "", hybrid: "" }, issueClusters: [], entityTypes: [],
  });
  check("monthly meta: geen 'SEA strateeg'", !/SEA strateeg/i.test(maandMeta));
  check("monthly meta: wel Meta-rol", maandMeta.includes("Meta Ads-specialist"));
}

console.log("\nGeen Google-only zetten in een Meta- of LinkedIn-prompt");
// Microsoft staat hier BEWUST niet tussen: dit IS search. Zoekwoorden, tROAS, Dynamic Search Ads,
// een eigen Merchant Center en een eigen Performance Max bestaan er allemaal echt -- de
// GOOGLE_ONLY-lijst verbieden zou daar terecht vakjargon afkeuren. Wat op Microsoft NIET thuishoort
// staat in MICROSOFT_VREEMD hieronder.
for (const kanaal of ["meta_ads", "linkedin_ads"] as const) {
  const prompt = promptsVoor(kanaal)["bi-weekly stap 4"]; // draagt de hele hypothese-catalogus
  for (const term of GOOGLE_ONLY) {
    check(`${kanaal}: noemt geen "${term}"`, !new RegExp(term, "i").test(prompt),
      (prompt.match(new RegExp(`.{0,50}${term}.{0,50}`, "i")) ?? [""])[0]);
  }
}

console.log("\nGeen platformvreemde zetten in een Microsoft-prompt");
// Wat op Microsoft niet bestaat: Meta-structuur (ad sets, Advantage+, Conversions API),
// LinkedIn-producten (Matched Audiences, thought leader ads) en Google-oppervlakken die Microsoft
// niet heeft (YouTube, Demand Gen). "Google" zelf is hier juist WEL toegestaan: de import uit
// Google Ads is het kern-onderwerp van pijler 2 niveau B.
const MICROSOFT_VREEMD = ["ad set", "Advantage\\+", "Conversions API", "Matched Audiences", "thought leader", "YouTube", "Demand Gen"];
{
  const prompt = promptsVoor("microsoft_ads")["bi-weekly stap 4"];
  for (const term of MICROSOFT_VREEMD) {
    check(`microsoft_ads: noemt geen "${term.replace("\\\\", "")}"`, !new RegExp(term, "i").test(prompt),
      (prompt.match(new RegExp(`.{0,50}${term}.{0,50}`, "i")) ?? [""])[0]);
  }
}

console.log("\nElk kanaal krijgt wél zijn eigen zetten aangereikt");
{
  const meta = promptsVoor("meta_ads")["bi-weekly stap 4"];
  check("meta noemt CBO/ABO", /CBO|ABO/.test(meta));
  check("meta noemt Advantage+", meta.includes("Advantage+"));
  check("meta noemt Conversions API", meta.includes("Conversions API"));

  const li = promptsVoor("linkedin_ads")["bi-weekly stap 4"];
  check("linkedin noemt matched audiences", /matched audiences/i.test(li));
  check("linkedin noemt document ads", /document ads/i.test(li));
  check("linkedin noemt de lange B2B-doorlooptijd", /doorlooptijd/i.test(li));

  const ms = promptsVoor("microsoft_ads")["bi-weekly stap 4"];
  check("microsoft noemt de Google-import", /import/i.test(ms));
  check("microsoft noemt het Audience Network", /Audience/i.test(ms));
  check("microsoft noemt bid-modifiers op profieldimensies", /bid-modifier/i.test(ms) && /industry/i.test(ms));
}

console.log("\nGoogle is niet veranderd, en het gedeelde vakmanschap blijft gedeeld");
{
  const google = promptsVoor("google_ads");
  check("google houdt zijn SEA-rol", /SEA/.test(google["weekly stap 1"]));
  check("google houdt Performance Max in zijn catalogus", google["bi-weekly stap 4"].includes("Performance Max"));

  // Het hypotheseformaat, de ICE-score en de verantwoordelijkheidsregel zijn vakmanschap dat niet
  // per platform verschilt. Die horen woordelijk gelijk te blijven -- anders zou "kanaalspecifiek"
  // een excuus worden om drie verschillende kwaliteitslatten te hanteren.
  for (const kanaal of ["google_ads", "meta_ads", "linkedin_ads", "microsoft_ads"] as const) {
    const p = promptsVoor(kanaal)["bi-weekly stap 4"];
    check(`${kanaal}: hypotheseformaat gedeeld`, p.includes("Schrijf elke hypothese exact in dit formaat"));
    check(`${kanaal}: ICE gedeeld`, p.includes("ICE totaal = (Impact + Confidence + Ease) / 3"));
    check(`${kanaal}: bureau/klant-verdeling gedeeld`, p.includes("Wijs per taak een verantwoordelijke toe"));
  }
}

console.log("\nDe weekly vraagt Google om budgetkrapte uit de data, niet uit een afleiding");
{
  const g = promptsVoor("google_ads")["weekly stap 3"];
  check("noemt search_budget_lost_is", g.includes("search_budget_lost_is"));
  // Zonder dit onderscheid leest "impressieaandeel verloren" als één ding, terwijl budget en
  // positie tegengestelde ingrepen vragen.
  check("onderscheidt het van rank_lost_is", g.includes("search_rank_lost_is"));
  check("noemt een drempel", /10%/.test(g));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
