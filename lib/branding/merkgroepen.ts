/**
 * Welke advertentie-accounts horen bij hetzelfde merk?
 *
 * Een klant met meerdere regio's heeft per regio een eigen Ads-account met een eigen id, en dus
 * in dit systeem een eigen `client_id`. MPC - BE, MPC - DE, MPC - FR: zes losse klanten in de
 * database, terwijl het één merk is. Zonder een niveau daarboven kan het dashboard ze niet naast
 * elkaar leggen, en juist die vergelijking is waar de gebruiker naar kijkt.
 *
 * Dit bestand doet één ding: uit accountNAMEN afleiden welke bij elkaar horen. Het resultaat is
 * een VOORSTEL, nooit een feit — zie de opzet hieronder.
 *
 * ── WAAROM EEN VOORSTEL EN GEEN AFLEIDING ────────────────────────────────────
 *
 * De eerste versie hiervan groepeerde op het eerste woord van de naam. Op de echte 71 accounts
 * gaf dat vier groepen, waarvan er één fout was: "Easy Living (€2.000 p/m)" belandde bij
 * "Easy-Ergonomics BE/DE/NL" omdat ze allebei met "Easy" beginnen. Dat zijn twee verschillende
 * klanten, en als die stilzwijgend samen in één rapport komen, telt het budget van de één bij de
 * omzet van de ander.
 *
 * Een naam is een aanwijzing, geen bewijs. Daarom draagt elk voorstel de REGEL die hem opleverde,
 * zodat op het bevestigingsscherm te zien is waaróm iets wordt voorgesteld. Een voorstel zonder
 * reden is over drie maanden niet van een besluit te onderscheiden — dezelfde afspraak als bij de
 * uitzonderingslijsten in de poorten.
 *
 * ── DE TWEE REGELS ───────────────────────────────────────────────────────────
 *
 * `regiosuffix`      de naam eindigt op een land of landcode, en zonder dat achtervoegsel is hij
 *                    gelijk aan die van een ander account. "Easy-Ergonomics BE/DE/NL" → stam
 *                    "Easy-Ergonomics". Dit is de sterkste aanwijzing die er is, want het
 *                    achtervoegsel zegt letterlijk dat het om dezelfde zaak in een ander land gaat.
 *
 * `scheidingsteken`  de naam heeft een expliciete " - " of " | " en het deel ervóór komt bij meer
 *                    accounts voor. "GoedeInnovaties - Wobblez" → stam "GoedeInnovaties". Een
 *                    scheidingsteken is een naamconventie die iemand bewust heeft aangebracht, en
 *                    dat weegt zwaarder dan een toevallig gedeeld beginwoord.
 *
 * Wat GEEN regel is: een gedeeld voorvoegsel zonder een van deze twee signalen. Dat is precies de
 * fout hierboven.
 */

/** Landcodes en landnamen die als achtervoegsel een regio aanduiden. */
const REGIOS = new Set([
  "nl", "be", "de", "fr", "uk", "gb", "es", "it", "at", "ch", "pl", "dk", "se", "no", "fi",
  "ie", "pt", "hu", "cz", "sk", "ro", "gr", "tr", "us", "ca", "mx", "br", "au", "nz", "za",
  "nederland", "belgie", "belgië", "duitsland", "frankrijk", "engeland", "spanje", "italie",
  "italië", "oostenrijk", "zwitserland", "polen", "denemarken", "zweden", "noorwegen",
  "germany", "france", "spain", "italy", "austria", "switzerland", "poland", "denmark",
  "sweden", "norway", "belgium", "netherlands", "holland", "europe", "europa",
  "general", "generic", "global", "int", "intl",
]);

/** Rechtsvormen en losse toevoegingen die niets over het merk zeggen. */
const RUIS = new Set(["bv", "b.v.", "bvba", "nv", "n.v.", "vof", "ltd", "gmbh", "sa", "sarl", "inc", "new", "oud", "live"]);

export type Merkregel = "regiosuffix" | "scheidingsteken";

export interface Merkvoorstel {
  /** De gemeenschappelijke naam, zoals hij in de bron gespeld staat. */
  stam: string;
  /** Welke regels dit voorstel hebben opgeleverd. Meerdere kan: ze versterken elkaar. */
  regels: Merkregel[];
  /** De accountnamen, in de volgorde waarin ze binnenkwamen. */
  accounts: string[];
}

/**
 * Haalt haakjes-toevoegingen en rechtsvormen weg.
 *
 * "MPC - BE (new)" → "MPC - BE", "9altitudes Nederland bv" → "9altitudes Nederland".
 * Zonder deze stap eindigt de eerste op "(new)" en de tweede op "bv", en vindt de regiosuffix-regel
 * het land niet dat er vlak vóór staat.
 */
function ontdoeVanRuis(naam: string): string {
  let uit = naam.replace(/\s*[([][^)\]]*[)\]]\s*/g, " ").trim();
  // Herhaald, want er kunnen er twee achter elkaar staan ("... bv (new)").
  for (let i = 0; i < 3; i++) {
    const woorden = uit.split(/\s+/);
    const laatste = (woorden[woorden.length - 1] ?? "").toLowerCase().replace(/[.,]+$/, "");
    if (woorden.length > 1 && RUIS.has(laatste)) uit = woorden.slice(0, -1).join(" ");
    else break;
  }
  return uit.trim();
}

/** Sluitende leestekens en scheidingstekens aan het eind weg: "MPC -" → "MPC". */
function trimStaart(s: string): string {
  return s.replace(/[\s\-|/,:;_]+$/, "").trim();
}

/** De stam volgens de regiosuffix-regel, of null als de naam niet op een regio eindigt. */
export function stamViaRegio(naam: string): string | null {
  const schoon = ontdoeVanRuis(naam);
  const woorden = schoon.split(/\s+/);
  if (woorden.length < 2) return null;   // "Germany" alléén is geen merk met een regio erachter
  const laatste = woorden[woorden.length - 1].toLowerCase().replace(/[.,]+$/, "");
  if (!REGIOS.has(laatste)) return null;
  const stam = trimStaart(woorden.slice(0, -1).join(" "));
  return stam.length >= 2 ? stam : null;
}

/** De stam volgens de scheidingsteken-regel, of null als er geen scheidingsteken in staat. */
export function stamViaScheiding(naam: string): string | null {
  const m = ontdoeVanRuis(naam).match(/^(.+?)\s+[-|]\s+/);
  if (!m) return null;
  const stam = trimStaart(m[1]);
  return stam.length >= 2 ? stam : null;
}

/**
 * Stelt merkgroepen voor op basis van accountnamen.
 *
 * Alleen groepen van twee of meer. Een stam die maar bij één account hoort is geen groep maar een
 * naam — "GC - General" levert de stam "GC" op en blijft alleen, en dat hoort zo.
 */
export function stelMerkgroepenVoor(namen: readonly string[]): Merkvoorstel[] {
  const perStam = new Map<string, { stam: string; regels: Set<Merkregel>; accounts: string[] }>();

  const voegToe = (stam: string, regel: Merkregel, naam: string) => {
    const sleutel = stam.toLowerCase();
    const bestaand = perStam.get(sleutel) ?? { stam, regels: new Set<Merkregel>(), accounts: [] };
    bestaand.regels.add(regel);
    if (!bestaand.accounts.includes(naam)) bestaand.accounts.push(naam);
    perStam.set(sleutel, bestaand);
  };

  for (const naam of namen) {
    const viaRegio = stamViaRegio(naam);
    if (viaRegio) voegToe(viaRegio, "regiosuffix", naam);
    const viaScheiding = stamViaScheiding(naam);
    if (viaScheiding) voegToe(viaScheiding, "scheidingsteken", naam);
  }

  return [...perStam.values()]
    .filter((g) => g.accounts.length >= 2)
    .map((g) => ({ stam: g.stam, regels: [...g.regels].sort(), accounts: g.accounts }))
    .sort((a, b) => b.accounts.length - a.accounts.length || a.stam.localeCompare(b.stam));
}
