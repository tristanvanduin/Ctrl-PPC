/**
 * De systeemprompt voor de chat: wat het model van deze klant weet voordat de gebruiker iets vraagt.
 *
 * ── WAAROM DIT BEGRENSD IS EN NIET "ALLE DATA" ──────────────────────────────
 *
 * De opdracht zei: geef de ruwe data van de geselecteerde campagne plus het hypothese-logboek mee.
 * Dat werkt één bericht lang en wordt daarna het duurste onderdeel van de applicatie. Een
 * chatgesprek stuurt de hele geschiedenis élke beurt opnieuw mee, dus bij twintig berichten betaal
 * je twintig keer voor dezelfde campagnedata. Gemeten op de bestaande analyses: één run zit rond
 * de 475.000 tokens. Dat is prima voor een maandrapport dat één keer draait, en het is
 * onhoudbaar voor iets waar iemand een middag mee zit te sparren.
 *
 * Vandaar: samenvatten, begrenzen, en de begrenzing OPSCHRIJVEN in de prompt zelf. Een model dat
 * niet weet dat het een selectie ziet, praat over de selectie alsof het het geheel is -- en dan
 * krijg je een stellige uitspraak over "alle campagnes" op basis van de twintig grootste.
 *
 * ── ABSENTIE IS EEN UITKOMST ────────────────────────────────────────────────
 *
 * Ontbrekende data wordt genoemd en niet weggelaten. Een prompt waar de Meta-sectie gewoon niet in
 * staat, leest voor het model als een klant zonder Meta; een prompt die zegt "geen Meta-data in
 * deze periode" is iets anders, en dat verschil komt terug in het antwoord.
 */

/** Ruwe maandregel zoals hij uit de feitentabellen komt. */
export type Maandregel = {
  month: string;
  cost?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
};

/** Een campagne met zijn cijfers over de gekozen periode. */
export type Campagneregel = {
  campaign_name: string;
  channel?: string | null;
  cost?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
};

/** Een regel uit het hypothese-logboek. */
export type Hypotheseregel = {
  hypothesis: string;
  status?: string | null;
  expected_result?: string | null;
  measurement_metric?: string | null;
  outcome?: string | null;
  learning?: string | null;
  accepted_at?: string | null;
  evaluated_at?: string | null;
  created_at?: string | null;
};

export type Contextinvoer = {
  klantnaam: string;
  clientId: string;
  kanalen: readonly string[];
  maanden: readonly Maandregel[];
  campagnes: readonly Campagneregel[];
  hypotheses: readonly Hypotheseregel[];
};

/**
 * De grenzen. Alle drie gekozen op "genoeg om over te praten, niet genoeg om de rekening te laten
 * ontploffen"; ze staan hier bij elkaar zodat je ze op één plek kunt bijstellen als de
 * tokenmeting daar aanleiding toe geeft.
 */
export const MAX_MAANDEN = 13;      // twaalf maanden plus de lopende, zodat jaar-op-jaar kan
export const MAX_CAMPAGNES = 20;    // op spend gesorteerd; de staart verklaart zelden iets
export const MAX_HYPOTHESES = 15;   // de recentste; oudere zijn zonder uitkomst niet informatief

/**
 * Tekens per token, voor de schatting.
 *
 * GEMETEN en niet aangenomen. De eerste versie stond op 4 -- de vuistregel voor Engels proza -- en
 * die schatte er 40% naast. Nagerekend op een echte beurt tegen gemini-3-flash-preview met de
 * demo-klant erin:
 *
 *   systeemprompt          4.476 tekens
 *   geschat op 4 tekens    1.119 tokens
 *   werkelijk              ~1.860 tokens   (1.880 totaal minus de vraag zelf)
 *   werkelijke verhouding  2,41 tekens per token
 *
 * Nederlands met veel getallen, euro's en pipe-tekens tokeniseert slechter dan Engels proza: elk
 * "€1.234" en elke "|" is een eigen token. Een schatting die er structureel 40% onder zit is
 * erger dan geen schatting, want er wordt straks een budgetplafond op geijkt.
 */
export const TEKENS_PER_TOKEN = 2.4;

function euro(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "onbekend";
  return `€${Math.round(Number(v)).toLocaleString("nl-NL")}`;
}

function getal(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "onbekend";
  return Math.round(Number(v)).toLocaleString("nl-NL");
}

/**
 * Deelt twee getallen en geeft null als dat niet eerlijk kan.
 *
 * Null en niet 0: een CPA van nul zou als een schitterende uitkomst lezen terwijl het betekent dat
 * er niets te delen viel. Dat onderscheid is eerder in deze codebase misgegaan bij safeDiv.
 */
function deel(teller: number | null | undefined, noemer: number | null | undefined): number | null {
  const t = Number(teller);
  const n = Number(noemer);
  if (!Number.isFinite(t) || !Number.isFinite(n) || n === 0) return null;
  const uitkomst = t / n;
  return Number.isFinite(uitkomst) ? uitkomst : null;
}

function maandenBlok(maanden: readonly Maandregel[]): string {
  if (maanden.length === 0) {
    return "MAANDCIJFERS\nGeen maandrijen gevonden voor deze klant. Dat betekent dat er nog niets gesynchroniseerd is, niet dat de prestaties nul waren.";
  }
  const gebruikt = [...maanden]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .slice(-MAX_MAANDEN);

  const regels = gebruikt.map((m) => {
    const cpa = deel(m.cost, m.conversions);
    const roas = deel(m.conversions_value, m.cost);
    const delen = [
      `${m.month}`,
      `spend ${euro(m.cost)}`,
      `conversies ${getal(m.conversions)}`,
      cpa === null ? "CPA n.v.t." : `CPA ${euro(cpa)}`,
      roas === null ? "ROAS n.v.t." : `ROAS ${roas.toFixed(2)}`,
    ];
    return `  ${delen.join(" | ")}`;
  });

  const weggelaten = maanden.length - gebruikt.length;
  const staart = weggelaten > 0
    ? `\n  (${weggelaten} oudere maand${weggelaten === 1 ? "" : "en"} niet meegestuurd)`
    : "";
  return `MAANDCIJFERS (laatste ${gebruikt.length})\n${regels.join("\n")}${staart}`;
}

function campagneBlok(campagnes: readonly Campagneregel[]): string {
  if (campagnes.length === 0) {
    return "CAMPAGNES\nGeen campagnerijen in de gekozen periode.";
  }
  const gesorteerd = [...campagnes].sort((a, b) => Number(b.cost ?? 0) - Number(a.cost ?? 0));
  const gebruikt = gesorteerd.slice(0, MAX_CAMPAGNES);
  const restSpend = gesorteerd.slice(MAX_CAMPAGNES).reduce((s, c) => s + Number(c.cost ?? 0), 0);

  const regels = gebruikt.map((c) => {
    const cpa = deel(c.cost, c.conversions);
    const kanaal = c.channel ? `[${c.channel}] ` : "";
    return `  ${kanaal}${c.campaign_name} | spend ${euro(c.cost)} | klikken ${getal(c.clicks)} | conversies ${getal(c.conversions)} | ${cpa === null ? "CPA n.v.t." : `CPA ${euro(cpa)}`}`;
  });

  // De staart wordt niet weggelaten maar OPGETELD. Anders lijkt de som van de campagnes niet te
  // kloppen met de maandcijfers, en dan gaat het gesprek over dat verschil in plaats van over de
  // campagnes.
  const staart = gesorteerd.length > MAX_CAMPAGNES
    ? `\n  + ${gesorteerd.length - MAX_CAMPAGNES} kleinere campagnes, samen ${euro(restSpend)} spend (namen niet meegestuurd)`
    : "";
  return `CAMPAGNES (top ${gebruikt.length} op spend van ${gesorteerd.length})\n${regels.join("\n")}${staart}`;
}

function hypotheseBlok(hypotheses: readonly Hypotheseregel[]): string {
  if (hypotheses.length === 0) {
    return "HYPOTHESE-LOGBOEK\nNog geen hypotheses vastgelegd voor deze klant.";
  }
  const tijd = (h: Hypotheseregel): string => h.evaluated_at ?? h.accepted_at ?? h.created_at ?? "";
  const gebruikt = [...hypotheses]
    .sort((a, b) => String(tijd(b)).localeCompare(String(tijd(a))))
    .slice(0, MAX_HYPOTHESES);

  const regels = gebruikt.map((h) => {
    const status = h.status ?? "onbekend";
    // Een hypothese zonder uitkomst is niet hetzelfde als een mislukte hypothese. Het model moet
    // dat verschil kunnen zien, anders gaat het conclusies trekken uit werk dat nog loopt.
    const uitkomst = h.evaluated_at
      ? `uitkomst: ${h.outcome ?? "vastgelegd zonder tekst"}${h.learning ? ` — ${h.learning}` : ""}`
      : "nog niet geëvalueerd";
    const meting = h.measurement_metric ? ` | meet op ${h.measurement_metric}` : "";
    return `  [${status}] ${h.hypothesis}${meting}\n    ${uitkomst}`;
  });

  const weggelaten = hypotheses.length - gebruikt.length;
  const staart = weggelaten > 0 ? `\n  (${weggelaten} oudere niet meegestuurd)` : "";
  return `HYPOTHESE-LOGBOEK (recentste ${gebruikt.length} van ${hypotheses.length})\n${regels.join("\n")}${staart}`;
}

/** De vaste instructie. Staat los zodat de test hem kan controleren zonder data op te bouwen. */
export const GEDRAGSREGELS = [
  "Je bent de spar-assistent binnen het Ctrl PPC-dashboard. Je praat met een SEA-specialist over zijn eigen advertentiedata.",
  "",
  "Hoe je antwoordt:",
  "- Reken alleen met de cijfers hieronder. Staat een getal er niet, zeg dan dat je het niet hebt — vul het niet aan uit algemene kennis over de branche.",
  "- Noem het onderscheid tussen 'geen data' en 'een gemeten nul'. Dat zijn verschillende situaties en ze vragen om verschillende acties.",
  "- Je ziet een selectie, geen volledige export. Waar hieronder staat dat er iets is weggelaten, weeg dat mee voordat je iets over 'alles' zegt.",
  "- Wees concreet en kort. De gebruiker is vakinhoudelijk; sla de uitleg van standaardbegrippen over.",
  "- Bij een voorstel: benoem waaraan je zou zien dat het werkt, en op welke termijn.",
].join("\n");

export type Contextresultaat = {
  prompt: string;
  /** Ruwe schatting van de omvang, voor de tokenbewaking en om in de UI te tonen. */
  geschatteTokens: number;
};

/**
 * Bouwt de systeemprompt. Zuivere functie: alles wat hij nodig heeft komt binnen als argument,
 * zodat de vorm te toetsen is zonder database en zonder LLM.
 */
export function bouwSysteemPrompt(invoer: Contextinvoer): Contextresultaat {
  const kanalen = invoer.kanalen.length > 0
    ? invoer.kanalen.join(", ")
    : "geen enkel kanaal met data";

  const prompt = [
    GEDRAGSREGELS,
    "",
    `KLANT: ${invoer.klantnaam} (${invoer.clientId})`,
    `ACTIEVE KANALEN: ${kanalen}`,
    "",
    maandenBlok(invoer.maanden),
    "",
    campagneBlok(invoer.campagnes),
    "",
    hypotheseBlok(invoer.hypotheses),
  ].join("\n");

  return {
    prompt,
    geschatteTokens: Math.ceil(prompt.length / TEKENS_PER_TOKEN),
  };
}

/**
 * Hoeveel eerdere berichten er meegaan.
 *
 * De systeemprompt gaat élke beurt volledig mee -- die kun je niet halveren zonder dat het model
 * de klant kwijtraakt. Wat je wél kunt begrenzen is de gespreksgeschiedenis, en daar zit bij een
 * lang gesprek het meeste groeigedrag: die wordt bij elke beurt één bericht langer.
 *
 * Twintig berichten is ongeveer tien vraag-en-antwoordbeurten. Ver genoeg terug om "en dat vorige
 * punt dan?" te kunnen beantwoorden, kort genoeg om niet ongemerkt te verdubbelen.
 */
export const MAX_HISTORIE = 20;

export function begrensHistorie<T>(berichten: readonly T[]): T[] {
  return berichten.slice(-MAX_HISTORIE);
}

/** Eén beurt uit het gesprek, zoals hij in chat_messages staat. */
export type Beurt = { rol: "user" | "assistant"; inhoud: string };

/**
 * Vouwt de gespreksgeschiedenis en de nieuwe vraag in één gebruikersbericht.
 *
 * ── WAAROM DE HISTORIE HIER STAAT EN NIET IN DE SYSTEEMPROMPT ───────────────
 *
 * De provider-client neemt één systeemprompt en één gebruikersbericht, geen berichtenreeks. Dat
 * dwingt een keuze af, en de goedkoopste kant is deze.
 *
 * Gemini cachet impliciet op een gedeeld promptBEGIN. Zolang de systeemprompt tussen twee beurten
 * byte-identiek blijft, kan hij bij de tweede beurt tegen een kwart van het tarief tellen (zie
 * CACHED_INPUT_FACTOR in o2-targets-cost.ts). Zou de historie in de systeemprompt staan, dan
 * verandert het begin elke beurt en vervalt die mogelijkheid bij élk bericht.
 *
 * ── WAT ER GEMETEN IS ───────────────────────────────────────────────────────
 *
 * Twee opeenvolgende beurten in hetzelfde gesprek, systeemprompt byte-identiek:
 *
 *   beurt 1   prompt 1.880 tokens   gecacht 0
 *   beurt 2   prompt 2.248 tokens   gecacht 0
 *
 * De cache sloeg dus NIET aan. Vermoedelijk zit deze prompt onder de ondergrens die de provider
 * voor impliciete caching aanhoudt -- die ligt bij Gemini in de orde van duizenden tokens en deze
 * systeemprompt haalt er ~1.860. Bij een klant met meer campagnes kan dat kantelen.
 *
 * De indeling blijft desondanks zo, om twee redenen: hij is de voorwaarde om de korting te kúnnen
 * krijgen zodra de prompt groot genoeg is, en hij houdt het deel dat elke beurt groeit (het
 * gesprek) gescheiden van het deel dat dat niet doet (de data). Maar reken er niet op in een
 * kostenraming: het verschil van 368 tokens tussen beurt 1 en 2 is de hele historie, en de 1.860
 * tokens context worden elke beurt vol betaald.
 */
export function bouwGebruikersbericht(historie: readonly Beurt[], nieuweVraag: string): string {
  const kort = begrensHistorie(historie);
  if (kort.length === 0) return nieuweVraag;

  const afgekapt = historie.length > kort.length
    ? `(De eerste ${historie.length - kort.length} berichten van dit gesprek zijn niet meegestuurd.)\n\n`
    : "";

  const transcript = kort
    .map((b) => `${b.rol === "user" ? "SPECIALIST" : "JIJ"}: ${b.inhoud}`)
    .join("\n\n");

  return `${afgekapt}Eerder in dit gesprek:\n\n${transcript}\n\n---\n\nSPECIALIST: ${nieuweVraag}`;
}
