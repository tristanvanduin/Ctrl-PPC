// De evaluatieset van de analyses: wat er bij de demo-klant gevonden HOORT te worden, en wat niet.
//
// WAAROM DIT BESTAAT. demo-greentech is per detector ontworpen (de kop van
// scripts/demo/seed-demo-client.ts noemt twintig scenario's, S1 tot S20, plus een stil scenario).
// Die seed bewijst met --check dat de DETECTORS ze zien. Of de ANALYSE ze daarna ook opschrijft
// (het taalmodel kiest, ordent en laat weg) werd nergens vastgelegd: het harnas in lib/eval had
// nul fixtures en nul runs, en sinds 1 september is de keten niet meer tegen een model gedraaid
// terwijl er tientallen bestanden in veranderden. Deze set maakt van de twintig scenario's een vaste
// lat: per scenario welke bevinding er hoort te komen, en waar de analyse juist moet zwijgen.
//
// HOE ER GESCOORD WORDT. De uitvoer wordt in eenheden geknipt (regels, en bij JSON elke tekstwaarde).
// Een verwachting is een rij groepen; een eenheid "raakt" haar als elke groep er in voorkomt
// (EN tussen groepen, OF binnen een groep). Dat is grof met opzet: het meet of de analyse het
// verschijnsel bij de juiste entiteit noemt, niet of de zin mooi is. Wat dit niet ziet (een
// verkeerde oorzaak bij de juiste entiteit) is werk voor de beoordelaar in judge-contract.ts.
//   moet      gevonden als een eenheid haar raakt, anders gemist
//   mag-niet  vals als een eenheid haar raakt zonder de uitzondering ("onder de volumegrens",
//             "te vroeg"); anders terecht stil
// Per scenario: gevonden, gemist, vals. Een scenario op een kanaal dat de uitvoer niet behandelt
// telt als buiten bereik, niet als gemist: een Google-weekanalyse hoort geen Meta-creative te noemen.
//
// Zuiver en zonder imports: scripts/score-evaluatieset.mjs laadt dit bestand rechtstreeks met node.

export type ScenarioKanaal = "google" | "meta" | "linkedin" | "microsoft" | "cross";

export interface Verwachting {
  soort: "moet" | "mag-niet";
  /** Wat er gezocht wordt, in woorden, voor het rapport. */
  wat: string;
  /** EN van groepen; binnen een groep OF. */
  groepen: RegExp[];
  /** Alleen bij mag-niet: een eenheid die dit ook bevat, is de juiste nuance en geen valse melding. */
  uitzondering?: RegExp;
}

export interface Scenario {
  id: string;
  titel: string;
  kanaal: ScenarioKanaal;
  verwachtingen: Verwachting[];
}

// Woorden voor "hier moet iets gebeuren" en "hier gaat iets mis", voor de mag-niet's. Ruim in de
// formulering, maar NIET richting-loos: "stijgt" en "daalt" staan er bewust niet los in. Een eerdere
// versie telde die als probleem, en dan scoorde "GRA stijgt +10% in conversies" (letterlijk de
// ontworpen uitkomst van S11) en "de CPA van de brandcampagne daalt" als valse melding. Een lat die
// juiste uitvoer afrekent, duwt prompts de verkeerde kant op. Stijgen of dalen telt alleen als het
// de slechte kant op is: kosten omhoog, opbrengst omlaag.
const ACTIE = /verhoog(?!d)|verlaag(?!d)|pauzeer|\bstop|\bschaal|opschal|verschuif|herverdeel|vervang|ververs|uitsluit|sluit .{0,40}uit|bijstur|ingrijp|actie nodig|\bpause|scale up|reallocat|replace|refresh|exclude|(increase|decrease|raise|lower) (the )?(bid|budget)/i;
// "Kosten per conversie dalen" is goed nieuws: daarom telt een opbrengstwoord na "per" niet als opbrengst.
const KOSTEN = "CPA|CPC|CPL|CPM|kosten|cost|spend|uitgave|budgetverlies|frequen";
const OPBRENGST = "conversie|conversion|CTR|klikratio|ROAS|omzet|leads?|impressieaandeel|impression share|kwaliteit";
const SLECHTE_RICHTING = new RegExp(
  `(${KOSTEN}).{0,40}(stijg|steeg|stegen|hoger|oploop|loopt op|lopen op|omhoog)|(stijg|steeg|hoger|oplopend)\\w*.{0,20}(${KOSTEN})` +
  `|(?<!per )(${OPBRENGST}).{0,40}(daal|dalen|zakt|zakken|lager|afneem|neemt af|loopt terug|omlaag)|(daling|dalend|lager|zakkend)\\w*.{0,20}(${OPBRENGST})`,
  "i");
const PROBLEEM = /achterloop|loopt achter|blijft achter|achterstand|\d+\s?% achter|verslechter|probleem|\blek(t|ken)?\b|zwak|te hoog|te laag|onder de verwachting|verspil|bleeder|fatigue|vermoeid|verzadig|risico|zorgwekkend|reden tot zorg/i;
const ACTIE_OF_PROBLEEM = new RegExp(`${ACTIE.source}|${PROBLEEM.source}|${SLECHTE_RICHTING.source}`, "i");

// Bij S1 telt een CTR alleen als hij de slechte kant op gaat: "Hero Video A heeft de hoogste CTR"
// is het tegendeel van de bevinding en mag niet als gevonden tellen.
const S1_VERSCHIJNSEL = /fatigue|vermoeid|moeheid|slijt|(CTR|klikratio).{0,40}(daal|dalen|zakt|lager|afneem|neemt af|loopt terug|-\s?\d)|(daling|dalend|lager|zakkend)\w*.{0,20}(CTR|klikratio)|(hoge|oplopende|stijgende) frequen|frequen\w*.{0,30}(hoog|oploop|loopt op|stijg)/i;

export const DEMO_SCENARIOS: readonly Scenario[] = [
  { id: "S1", titel: "Meta creative fatigue (Hero Video A)", kanaal: "meta", verwachtingen: [
    { soort: "moet", wat: "Hero Video A met vermoeidheid of dalende CTR bij hoge frequentie", groepen: [/Hero Video A/i, S1_VERSCHIJNSEL] },
  ] },
  { id: "S2", titel: "Meta frequency-saturatie (Awareness)", kanaal: "meta", verwachtingen: [
    { soort: "moet", wat: "de Awareness-campagne met te hoge frequentie of verzadiging", groepen: [/Awareness/i, /frequen|verzadig|saturat/i] },
  ] },
  { id: "S3", titel: "Meta ranking-zwakte (Static Banner C)", kanaal: "meta", verwachtingen: [
    { soort: "moet", wat: "Static Banner C met een lage kwaliteitsranking", groepen: [/Static Banner C/i, /ranking|below.?average|onder.?gemiddeld|kwaliteit|quality/i] },
  ] },
  { id: "S4", titel: "Meta hook-zwakte (Product Carousel D)", kanaal: "meta", verwachtingen: [
    { soort: "moet", wat: "Product Carousel D met een zwakke hook", groepen: [/Product Carousel D/i, /hook|eerste seconde|thumb.?stop|aandacht/i] },
  ] },
  { id: "S5", titel: "LinkedIn form drop-off (GRT ABM)", kanaal: "linkedin", verwachtingen: [
    { soort: "moet", wat: "GRT ABM met een formulier dat weinig wordt afgerond", groepen: [/GRT ABM/i, /formulier|\bform|completion|voltooi|afgerond|drop.?off|afhak/i] },
  ] },
  { id: "S6", titel: "LinkedIn CPL-druk (GRT ABM)", kanaal: "linkedin", verwachtingen: [
    { soort: "moet", wat: "een oplopende kosten per lead op LinkedIn", groepen: [/GRT ABM|LinkedIn/i, /CPL|kosten per lead|cost per lead/i, /stijg|hoger|oploop|loopt op|druk|verslechter|\+\s?\d/i] },
  ] },
  { id: "S7", titel: "Zaai-oogst (social naar brand)", kanaal: "cross", verwachtingen: [
    { soort: "moet", wat: "het verband tussen meer social-vertoningen en meer brand-klikken", groepen: [/zaai|oogst|halo|social|Meta|LinkedIn/i, /brand|merk/i, /klik|zoek|vraag|verkeer/i] },
  ] },
  { id: "S8", titel: "Mix-shift / Simpson (LinkedIn-spend x3)", kanaal: "cross", verwachtingen: [
    { soort: "moet", wat: "een blended CPA die stijgt door een verschuiving in de mix, niet door een slechter kanaal", groepen: [/mix|simpson|samenstelling|verschuiving|aandeel/i, /LinkedIn/i, /CPA/i] },
  ] },
  { id: "S9", titel: "Doelgroep-tegenspraak (Education buiten het ICP)", kanaal: "cross", verwachtingen: [
    { soort: "moet", wat: "LinkedIn-leads uit Education, buiten het profiel", groepen: [/Education|onderwijs/i, /ICP|doelgroep|profiel|buiten/i] },
  ] },
  { id: "S10", titel: "Beursanalyse GRT (aanloop ~35% achter)", kanaal: "google", verwachtingen: [
    { soort: "moet", wat: "de GRT-aanloop die achterloopt op vorig jaar", groepen: [/GRT|GreenTech Amsterdam/i, /achter|minder|daling|lager|-\s?3\d/i] },
  ] },
  { id: "S11", titel: "Beursanalyse GRA (op koers, geen actie)", kanaal: "google", verwachtingen: [
    { soort: "mag-niet", wat: "een actie of probleem bij GRA, dat op koers ligt", groepen: [/\bGRA\b|GreenTech Americas/i, ACTIE_OF_PROBLEEM],
      uitzondering: /op koers|geen actie|op schema|gezond|niet nodig|vasthouden|loopt voor|ligt voor/i },
  ] },
  { id: "S12", titel: "GRN eerste editie", kanaal: "google", verwachtingen: [
    { soort: "moet", wat: "GRN als eerste editie zonder vorige om tegen af te zetten", groepen: [/\bGRN\b|North America/i, /eerste editie|geen vorige|first edition|geen vergelijk|nieuw/i] },
  ] },
  { id: "S13", titel: "Impressieaandeel Google (GRT budget, GRA rang)", kanaal: "google", verwachtingen: [
    { soort: "moet", wat: "impressieaandeel dat bij GRT op budget en bij GRA op rang verloren gaat", groepen: [/\bGRT\b|\bGRA\b/i, /impressieaandeel|impression share|lost IS|budget.?gelimiteerd|beperkt door budget|rang/i] },
  ] },
  { id: "S14", titel: "Microsoft import-drift", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "een oplopende CPA op de geimporteerde campagne tegenover de native", groepen: [/import/i, /CPA/i, /drift|loopt op|stijg|hoger|native/i] },
  ] },
  { id: "S15", titel: "Microsoft Audience Network-lek", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "het Audience Network met veel spend en weinig conversies", groepen: [/audience network|doelgroepnetwerk/i, /lek|spend|kosten|CPA|uitsluit|conversie/i] },
  ] },
  { id: "S16", titel: "Microsoft profiel-volumerem (Tuinbouw & Agri, niet Inkoop)", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "Tuinbouw & Agri als bodkans", groepen: [/Tuinbouw/i, /bod|bid|modifier|verhoog|kans|opschal/i] },
    { soort: "mag-niet", wat: "Inkoop als kans, terwijl het onder de volumegrens zit", groepen: [/Inkoop/i, /bod|bid|modifier|verhoog|kans|opschal/i],
      uitzondering: /onder de (volume)?(grens|drempel)|te weinig|te klein|te dun|niet genoeg|nog geen|geen bod/i },
  ] },
  { id: "S17", titel: "Microsoft desktop tegen mobiel", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "desktop dat in volume en CPA ver voor mobiel ligt", groepen: [/desktop/i, /mobiel|mobile/i] },
  ] },
  { id: "S18", titel: "Microsoft impressieaandeel (import budget, native rang)", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "oplopend budgetverlies op de importcampagne", groepen: [/import/i, /impressieaandeel|impression share|budgetverlies|lost IS|budget lost/i] },
  ] },
  { id: "S19", titel: "Microsoft keyword-bleeder (greenhouse solutions, niet kas kopen tweedehands)", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "greenhouse solutions als bleeder", groepen: [/greenhouse solutions/i, /bleeder|zonder conversie|geen conversie|pauzeer|verspil|uitsluit/i] },
    { soort: "mag-niet", wat: "kas kopen tweedehands als bleeder, terwijl het onder de EUR 25-rem zit", groepen: [/kas kopen tweedehands/i, /bleeder|pauzeer|\bstop|verspil|uitsluit/i],
      uitzondering: /te vroeg|te weinig|onder de|nog geen|afwachten/i },
  ] },
  { id: "S20", titel: "Microsoft zoektermvervuiling (import)", kanaal: "microsoft", verwachtingen: [
    { soort: "moet", wat: "irrelevante zoektermen (jobs, tickets, gratis) die uitgesloten moeten worden", groepen: [/zoekterm|search term|negatie|negative|uitsluit/i, /jobs|vacature|tickets|gratis|irrelevant|vervuil/i] },
  ] },
  { id: "stil", titel: "Stil scenario: GreenTech | Brand is gezond", kanaal: "google", verwachtingen: [
    { soort: "mag-niet", wat: "een probleem of actie bij de gezonde brandcampagne", groepen: [/GreenTech \| Brand(?! \| Bing)|brandcampagne|brand-campagne/i, ACTIE_OF_PROBLEEM],
      uitzondering: /gezond|stabiel|geen actie|niet het probleem|niet de bron|blijft|oogst|zaai/i },
  ] },
];

/** Knipt een analyse-uitvoer in eenheden: regels, en bij JSON elke tekstwaarde (ook genest). */
export function eenheden(uitvoer: string): string[] {
  const teksten: string[] = [];
  const verzamel = (v: unknown): void => {
    if (typeof v === "string") teksten.push(v);
    else if (Array.isArray(v)) v.forEach(verzamel);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(verzamel);
  };
  const t = uitvoer.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { verzamel(JSON.parse(t)); } catch { teksten.push(uitvoer); }
  } else teksten.push(uitvoer);
  return teksten
    .flatMap((s) => s.split(/\n+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const raakt = (eenheid: string, v: Verwachting): boolean => v.groepen.every((g) => g.test(eenheid));

export type ScenarioStatus = "gevonden" | "gemist" | "vals" | "terecht stil" | "buiten bereik";

export interface ScenarioUitslag {
  id: string;
  titel: string;
  kanaal: ScenarioKanaal;
  status: ScenarioStatus;
  gevonden: string[];
  gemist: string[];
  vals: { wat: string; eenheid: string }[];
}

export interface EvaluatieUitslag {
  scenarios: ScenarioUitslag[];
  gevonden: number;
  gemist: number;
  vals: number;
  /** Scenario's die meetelden (niet buiten bereik). */
  inBereik: number;
}

/**
 * Scoort een analyse-uitvoer tegen de set. `kanalen`: welke kanalen deze uitvoer behandelt; een
 * scenario op een ander kanaal is buiten bereik. Weglaten betekent alle kanalen (een volledige
 * maand- of cross-channel-analyse).
 */
export function scoorTegenScenarios(
  uitvoer: string,
  opties: { kanalen?: readonly ScenarioKanaal[]; scenarios?: readonly Scenario[] } = {}
): EvaluatieUitslag {
  const delen = eenheden(uitvoer);
  const set = opties.scenarios ?? DEMO_SCENARIOS;
  const scenarios: ScenarioUitslag[] = set.map((s) => {
    const basis = { id: s.id, titel: s.titel, kanaal: s.kanaal, gevonden: [] as string[], gemist: [] as string[], vals: [] as { wat: string; eenheid: string }[] };
    if (opties.kanalen && !opties.kanalen.includes(s.kanaal)) return { ...basis, status: "buiten bereik" as const };
    for (const v of s.verwachtingen) {
      if (v.soort === "moet") {
        if (delen.some((e) => raakt(e, v))) basis.gevonden.push(v.wat);
        else basis.gemist.push(v.wat);
      } else {
        const fout = delen.find((e) => raakt(e, v) && !(v.uitzondering?.test(e) ?? false));
        if (fout) basis.vals.push({ wat: v.wat, eenheid: fout.slice(0, 200) });
      }
    }
    const status: ScenarioStatus = basis.vals.length > 0 ? "vals"
      : basis.gemist.length > 0 ? "gemist"
        : basis.gevonden.length > 0 ? "gevonden"
          : "terecht stil";
    return { ...basis, status };
  });
  const inBereik = scenarios.filter((s) => s.status !== "buiten bereik");
  return {
    scenarios,
    gevonden: inBereik.reduce((n, s) => n + s.gevonden.length, 0),
    gemist: inBereik.reduce((n, s) => n + s.gemist.length, 0),
    vals: inBereik.reduce((n, s) => n + s.vals.length, 0),
    inBereik: inBereik.length,
  };
}

/** Welke kanalen een sop_type behandelt, voor uitvoer die uit de database komt. */
export function kanalenVanSopType(sopType: string): ScenarioKanaal[] | undefined {
  const t = sopType.toLowerCase();
  if (/cross|portfolio|master/.test(t)) return undefined;
  const uit: ScenarioKanaal[] = [];
  if (/meta/.test(t)) uit.push("meta");
  if (/linkedin/.test(t)) uit.push("linkedin");
  if (/microsoft|bing/.test(t)) uit.push("microsoft");
  // Zonder kanaalvoorvoegsel is een sop_type van Google (weekly, biweekly, monthly).
  if (uit.length === 0) uit.push("google");
  return uit;
}
