// De systeemprompt van de chat. Deterministisch, geen IO.
// Draaien: npx tsx lib/chat/__context_test.ts
//
// Waar deze controles over gaan: bijna alles wat hier fout kan gaan, gaat stil fout. Een prompt
// die een blok weglaat levert geen foutmelding op -- het model antwoordt gewoon, alleen op minder
// dan je dacht. Dat is niet te zien aan de uitvoer en wél aan de rekening.

import {
  bouwSysteemPrompt, begrensHistorie, bouwGebruikersbericht, GEDRAGSREGELS,
  MAX_MAANDEN, MAX_CAMPAGNES, MAX_HYPOTHESES, MAX_HISTORIE, TEKENS_PER_TOKEN,
  type Contextinvoer,
} from "./context";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const leeg: Contextinvoer = {
  klantnaam: "Testklant", clientId: "gads-1", kanalen: [], maanden: [], campagnes: [], hypotheses: [],
};

// ── Absentie wordt benoemd, niet weggelaten ───────────────────────────────
//
// HET GEVAL DAT ERTOE DOET. Een prompt zonder Meta-blok leest voor het model als een klant zonder
// Meta. Een prompt die zegt "geen data" is iets anders, en dat verschil komt terug in het antwoord.

{
  const { prompt } = bouwSysteemPrompt(leeg);
  check("lege klant: maandcijfers worden benoemd", /Geen maandrijen gevonden/.test(prompt));
  check("lege klant: campagnes worden benoemd", /Geen campagnerijen/.test(prompt));
  check("lege klant: hypotheses worden benoemd", /Nog geen hypotheses/.test(prompt));
  check("lege klant: kanalen worden benoemd", /geen enkel kanaal met data/.test(prompt),
    prompt.slice(0, 200));
  check("de gedragsregels staan er altijd in", prompt.includes(GEDRAGSREGELS));
}

// ── De begrenzing wordt opgeschreven ──────────────────────────────────────
//
// Een model dat niet weet dat het een selectie ziet, praat over die selectie alsof het het geheel
// is. Dan krijg je een stellige uitspraak over "alle campagnes" op basis van de twintig grootste.

{
  const veelMaanden = Array.from({ length: MAX_MAANDEN + 5 }, (_, i) => ({
    month: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`, cost: 100, conversions: 10,
  }));
  const { prompt } = bouwSysteemPrompt({ ...leeg, maanden: veelMaanden });
  check("te veel maanden: de weglating wordt gemeld", /5 oudere maanden niet meegestuurd/.test(prompt),
    prompt.split("\n").filter((r) => /niet meegestuurd/.test(r)).join(" | "));
}

{
  const veelCampagnes = Array.from({ length: MAX_CAMPAGNES + 8 }, (_, i) => ({
    campaign_name: `Campagne ${i}`, cost: 1000 - i * 10, conversions: 5,
  }));
  const { prompt } = bouwSysteemPrompt({ ...leeg, campagnes: veelCampagnes });
  check("te veel campagnes: het aantal wordt gemeld", /top 20 op spend van 28/.test(prompt),
    prompt.split("\n").find((r) => /CAMPAGNES/.test(r)) ?? "");
  // De staart wordt OPGETELD en niet weggelaten: anders klopt de som van de campagnes niet met de
  // maandcijfers, en gaat het gesprek over dat verschil in plaats van over de campagnes.
  check("de weggelaten campagnes worden als bedrag opgeteld",
    /\+ 8 kleinere campagnes, samen €/.test(prompt),
    prompt.split("\n").find((r) => /kleinere campagnes/.test(r)) ?? "");
  check("de duurste campagne staat er wel in", /Campagne 0\b/.test(prompt));
  check("de goedkoopste niet", !/Campagne 27\b/.test(prompt));
}

// ── Een hypothese zonder uitkomst is geen mislukte hypothese ──────────────

{
  const { prompt } = bouwSysteemPrompt({
    ...leeg,
    hypotheses: [
      { hypothesis: "Bod omhoog op merk", status: "accepted", accepted_at: "2026-07-01" },
      { hypothesis: "Zoekwoord uitsluiten", status: "accepted", evaluated_at: "2026-06-01",
        outcome: "CPA daalde 12%", learning: "werkte" },
    ],
  });
  check("lopende hypothese wordt als lopend gemeld", /nog niet geëvalueerd/.test(prompt),
    prompt.split("\n").filter((r) => /geëvalueerd|uitkomst/.test(r)).join(" | "));
  check("afgeronde hypothese toont zijn uitkomst", /CPA daalde 12%/.test(prompt));
  check("en de les erbij", /werkte/.test(prompt));
  // De recentste eerst: bij een lange lijst is de kop het informatiefst.
  check("de recentste staat bovenaan",
    prompt.indexOf("Bod omhoog op merk") < prompt.indexOf("Zoekwoord uitsluiten"));
}

// ── Delen door nul geeft "n.v.t." en niet nul ─────────────────────────────
//
// Een CPA van €0 leest als een schitterende uitkomst terwijl het betekent dat er niets te delen
// viel. Datzelfde onderscheid ging in deze codebase eerder mis bij safeDiv, waar vier van de vijf
// varianten 0 teruggaven bij een oneindige noemer.

{
  const { prompt } = bouwSysteemPrompt({
    ...leeg,
    maanden: [{ month: "2026-07-01", cost: 500, conversions: 0, conversions_value: 0 }],
  });
  check("geen conversies: CPA is n.v.t. en niet €0", /CPA n\.v\.t\./.test(prompt),
    prompt.split("\n").find((r) => /2026-07/.test(r)) ?? "");
  // En hier juist WEL een getal: €500 uitgegeven en €0 opgehaald is een ROAS van 0. Dat is een
  // gemeten uitkomst en geen ontbrekende waarde, en het zou fout zijn om daar "n.v.t." van te
  // maken -- dan verdwijnt een slecht resultaat uit beeld. De eerste versie van deze test had het
  // andersom en die had ongelijk.
  check("wel spend, geen waarde: ROAS is een gemeten 0", /ROAS 0\.00/.test(prompt),
    prompt.split("\n").find((r) => /2026-07/.test(r)) ?? "");
  check("de spend zelf staat er gewoon", /€500/.test(prompt));
}

// Zonder spend is de ROAS niet te berekenen. Dán pas n.v.t.
{
  const { prompt } = bouwSysteemPrompt({
    ...leeg,
    maanden: [{ month: "2026-07-01", cost: 0, conversions: 0, conversions_value: 0 }],
  });
  check("zonder spend is de ROAS n.v.t.", /ROAS n\.v\.t\./.test(prompt),
    prompt.split("\n").find((r) => /2026-07/.test(r)) ?? "");
}

{
  const { prompt } = bouwSysteemPrompt({
    ...leeg,
    maanden: [{ month: "2026-07-01", cost: 500, conversions: 10, conversions_value: 2000 }],
  });
  check("met conversies wordt de CPA wel berekend", /CPA €50/.test(prompt),
    prompt.split("\n").find((r) => /2026-07/.test(r)) ?? "");
  check("en de ROAS ook", /ROAS 4\.00/.test(prompt));
}

// ── De omvang wordt geschat ───────────────────────────────────────────────
// Niet om op af te rekenen -- dat doet de provider -- maar om te kunnen zien of een prompt
// ongemerkt groeit.

{
  const { prompt, geschatteTokens } = bouwSysteemPrompt(leeg);
  check("de schatting is evenredig met de lengte",
    geschatteTokens === Math.ceil(prompt.length / TEKENS_PER_TOKEN), String(geschatteTokens));
  check("een lege klant levert een kleine prompt", geschatteTokens < 900, String(geschatteTokens));
  // De verhouding is gemeten en geen vuistregel: 4 tekens per token (Engels proza) zat er 40%
  // naast op deze prompt, die vol staat met Nederlandse tekst, euro's en pipe-tekens.
  check("de verhouding staat op de gemeten waarde", TEKENS_PER_TOKEN === 2.4,
    String(TEKENS_PER_TOKEN));
}

// ── De historie wordt begrensd ────────────────────────────────────────────
//
// De systeemprompt gaat elke beurt volledig mee en is niet in te korten zonder de klant kwijt te
// raken. De gespreksgeschiedenis wél, en dáár zit het groeigedrag: die wordt elke beurt langer.

{
  const berichten = Array.from({ length: MAX_HISTORIE + 12 }, (_, i) => i);
  const kort = begrensHistorie(berichten);
  check("de historie wordt afgekapt", kort.length === MAX_HISTORIE, String(kort.length));
  // De LAATSTE en niet de eerste: een gesprek gaat over waar het nu staat.
  check("de recentste berichten blijven", kort[kort.length - 1] === berichten.length - 1,
    String(kort[kort.length - 1]));
  check("een kort gesprek blijft heel", begrensHistorie([1, 2, 3]).length === 3);
}

// ── Het gebruikersbericht ─────────────────────────────────────────────────
//
// De historie hoort HIER en niet in de systeemprompt. Gemini cachet op een gedeeld promptbegin;
// blijft de systeemprompt tussen twee beurten byte-identiek, dan telt hij de tweede keer tegen een
// kwart. Dat is precies waar de campagnedata in zit, dus dat is de hele korting. Zou de historie
// in de systeemprompt staan, dan verandert het begin elke beurt en vervalt hij bij élk bericht.

{
  const eerste = bouwGebruikersbericht([], "Waarom daalt mijn CTR?");
  check("zonder historie gaat de vraag kaal mee", eerste === "Waarom daalt mijn CTR?", eerste);
}

{
  const bericht = bouwGebruikersbericht(
    [{ rol: "user", inhoud: "Hoe staat merk ervoor?" }, { rol: "assistant", inhoud: "CPA €42." }],
    "En generiek?"
  );
  check("de historie staat erin", /Hoe staat merk ervoor\?/.test(bericht), bericht);
  check("het antwoord ook", /CPA €42\./.test(bericht));
  check("de nieuwe vraag staat achteraan",
    bericht.trimEnd().endsWith("SPECIALIST: En generiek?"), bericht.slice(-60));
}

{
  const lang = Array.from({ length: MAX_HISTORIE + 6 }, (_, i) => ({
    rol: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    inhoud: `bericht ${i}`,
  }));
  const bericht = bouwGebruikersbericht(lang, "en nu?");
  // Weglaten mag, stilzwijgend weglaten niet: anders verwijst iemand naar iets van tien beurten
  // terug en krijgt hij een antwoord dat doet alsof dat nooit gezegd is.
  check("het afkappen wordt gemeld", /De eerste 6 berichten van dit gesprek zijn niet meegestuurd/.test(bericht),
    bericht.split("\n")[0]);
  check("het oudste bericht is weg", !/bericht 0\b/.test(bericht));
  check("het nieuwste staat er wel in", /bericht 25\b/.test(bericht));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
