import type { Bedrijfsmodel } from "./segment";

// ============================================================================
// WANNEER EEN BENCHMARKCEL GEDEELD MAG WORDEN
// ============================================================================
//
// Een cel is een vakje waarover je één uitspraak doet: "b2b-accounts op Google hadden in juli een
// mediane CPA van X". Deze module beslist of dat vakje naar buiten mag.
//
// ── TWEE REGELS, EN ZE DOEN VERSCHILLEND WERK ───────────────────────────────
//
// 1. DE DREMPEL. Genoeg accounts ÉN genoeg bureaus. Dat tweede wordt bijna altijd vergeten: één
//    bureau met acht vergelijkbare klanten is "acht accounts" maar verraadt het boek van dat ene
//    bureau. Wie de cel leest en weet wie er in die niche zit, leest dan hun cijfers.
//
//    Volume maakt deze controle niet overbodig -- het maakt hem goedkoop. Bij 2.000 accounts
//    vallen er weinig cellen af; bij 200 vallen er veel af, en dan is de verleiding om de drempel
//    te verlagen het grootst. Precies dan moet hij vastliggen.
//
// 2. DE DIEPTE. Eerst alleen bedrijfsmodel, óf alleen niche. Nooit de combinatie, tot de dekking
//    het toelaat. Dat is een productbeslissing (Ctrl PPC, augustus 2026) en geen technische:
//    twee grove segmenten die kloppen zijn meer waard dan twintig fijne die geen van alle een
//    drempel halen.
//
//    De combinatie is niet verboden voor altijd -- hij is verboden zolang hij niet gevuld raakt.
//    `mag_verdiepen` hieronder rekent uit wanneer dat kantelt, per cel en niet per product.
//
// ── WAT HIER NIET IN ZIT ────────────────────────────────────────────────────
//
// Geen data, geen database, geen aggregatie. Alleen de beslissing. Zo is hij met vaste getallen
// te testen, en dat moet ook: dit is de regel waar het hele juridische verhaal op rust.

/** Minimaal aantal accounts in een cel voordat hij gedeeld mag worden. */
export const MIN_ACCOUNTS = 10;

/**
 * Minimaal aantal VERSCHILLENDE bureaus in een cel.
 *
 * Vier en niet twee: bij twee bureaus met vijf klanten elk kent elk bureau zijn eigen vijf, en
 * dan is het gemiddelde van de andere vijf uit te rekenen. Bij vier is dat een stuk lastiger, en
 * bij een strengere eis blijft er te weinig over om nuttig te zijn.
 */
export const MIN_BUREAUS = 4;

/**
 * Vanaf hoeveel accounts een gecombineerde cel (model én niche) is toegestaan.
 *
 * Ruimer dan MIN_ACCOUNTS: een combinatie is specifieker, dus herkenbaarder. Wie weet dat er in
 * "b2b + tandheelkunde" maar een handvol partijen actief zijn, heeft aan een klein getal genoeg.
 */
export const MIN_ACCOUNTS_COMBINATIE = 25;
export const MIN_BUREAUS_COMBINATIE = 8;

/**
 * De vier drempels als één object, zodat een aanroeper ze samen kan overschrijven i.p.v. los.
 * Optioneel op elke aanroepende functie hieronder -- zonder dit argument gelden altijd de
 * module-constanten hierboven. Bestaat uitsluitend voor een expliciet gelabelde testmodus (zie
 * app/api/platform/god-view/route.ts, masterplan 16.8): "puur voor de testfase, ik weet dat het
 * niet anoniem is" was de eigenaar zelf, met klem, en alleen bereikbaar achter dezelfde harde
 * ALL_CLIENTS-gate als de rest van God View. Nooit een default die van deze constanten afwijkt.
 */
export interface Celdrempels {
  minAccounts: number;
  minBureaus: number;
  minAccountsCombinatie: number;
  minBureausCombinatie: number;
}

const STANDAARD_DREMPELS: Celdrempels = {
  minAccounts: MIN_ACCOUNTS,
  minBureaus: MIN_BUREAUS,
  minAccountsCombinatie: MIN_ACCOUNTS_COMBINATIE,
  minBureausCombinatie: MIN_BUREAUS_COMBINATIE,
};

/** Op welk niveau een cel is afgebakend. */
export type Celdiepte = "model" | "niche" | "model_en_niche";

export interface Celtelling {
  accounts: number;
  bureaus: number;
}

export interface Celsleutel {
  channel: string;
  model: Bedrijfsmodel | null;
  niche: string | null;
}

export type Celoordeel =
  | { deelbaar: true; diepte: Celdiepte }
  | { deelbaar: false; reden: string; tekort: { accounts: number; bureaus: number } };

/** Op welk niveau deze sleutel is afgebakend, of null als er helemaal niets is afgebakend. */
export function diepteVan(sleutel: Celsleutel): Celdiepte | null {
  if (sleutel.model && sleutel.niche) return "model_en_niche";
  if (sleutel.niche) return "niche";
  if (sleutel.model) return "model";
  return null;
}

/**
 * Mag deze cel naar buiten?
 *
 * Een cel zonder afbakening (geen model, geen niche) is niet deelbaar. Niet omdat hij gevaarlijk
 * is -- "alle accounts samen" is juist het veiligste vakje dat er is -- maar omdat hij niets
 * zegt: een gemiddelde over e-commerce en tandartsen door elkaar is geen benchmark.
 */
export function beoordeelCel(sleutel: Celsleutel, telling: Celtelling, drempels: Celdrempels = STANDAARD_DREMPELS): Celoordeel {
  const diepte = diepteVan(sleutel);
  if (!diepte) {
    return {
      deelbaar: false,
      reden: "geen afbakening: een gemiddelde over alle sectoren door elkaar is geen benchmark",
      tekort: { accounts: 0, bureaus: 0 },
    };
  }

  const combinatie = diepte === "model_en_niche";
  const minA = combinatie ? drempels.minAccountsCombinatie : drempels.minAccounts;
  const minB = combinatie ? drempels.minBureausCombinatie : drempels.minBureaus;

  const tekortA = Math.max(0, minA - telling.accounts);
  const tekortB = Math.max(0, minB - telling.bureaus);

  if (tekortA === 0 && tekortB === 0) return { deelbaar: true, diepte };

  const delen: string[] = [];
  if (tekortA > 0) delen.push(`${telling.accounts} van ${minA} accounts`);
  if (tekortB > 0) delen.push(`${telling.bureaus} van ${minB} bureaus`);
  return {
    deelbaar: false,
    reden: combinatie
      ? `te weinig dekking voor een gecombineerde cel (${delen.join(", ")}); val terug op alleen model of alleen niche`
      : `te weinig dekking (${delen.join(", ")})`,
    tekort: { accounts: tekortA, bureaus: tekortB },
  };
}

/**
 * Mag de combinatie model + niche aan, gegeven wat een cel op dat niveau zou opleveren?
 *
 * Bewust een aparte vraag van beoordeelCel. Die eerste beantwoordt "mag dit vakje naar buiten";
 * deze beantwoordt "is het tijd om te verdiepen", en dat is een beslissing die je per cel neemt
 * en niet per product. B2B-software kan er klaar voor zijn terwijl b2c-huisdieren dat niet is.
 */
export function magVerdiepen(telling: Celtelling): boolean {
  return telling.accounts >= MIN_ACCOUNTS_COMBINATIE && telling.bureaus >= MIN_BUREAUS_COMBINATIE;
}

/**
 * De cellen die uit een verzameling accounts te maken zijn, met per cel het oordeel.
 *
 * De invoer is bewust minimaal: per account het kanaal, het bureau, en de twee labels. Geen
 * cijfers -- die komen pas als de cel deelbaar blijkt. Zo kan deze functie ook draaien om te
 * LATEN ZIEN wat er nodig is voordat een segment beschikbaar komt, zonder ergens data uit te
 * halen.
 */
export function celoverzicht(
  accounts: ReadonlyArray<{ channel: string; agencyId: string; model: Bedrijfsmodel | null; niche: string | null }>
): Array<{ sleutel: Celsleutel; telling: Celtelling; oordeel: Celoordeel }> {
  const groepen = new Map<string, { sleutel: Celsleutel; accounts: number; bureaus: Set<string> }>();

  const voegToe = (sleutel: Celsleutel, agencyId: string) => {
    const k = `${sleutel.channel}|${sleutel.model ?? ""}|${sleutel.niche ?? ""}`;
    let g = groepen.get(k);
    if (!g) { g = { sleutel, accounts: 0, bureaus: new Set() }; groepen.set(k, g); }
    g.accounts++;
    g.bureaus.add(agencyId);
  };

  for (const a of accounts) {
    // Elk account telt mee in élk niveau waarop het is afgebakend. Een account met model én niche
    // draagt dus bij aan de model-cel, de niche-cel én de combinatie -- want de vraag "hoe doen
    // b2b-accounts het" mag niet de accounts missen die toevallig óók een niche hebben ingevuld.
    if (a.model) voegToe({ channel: a.channel, model: a.model, niche: null }, a.agencyId);
    if (a.niche) voegToe({ channel: a.channel, model: null, niche: a.niche }, a.agencyId);
    if (a.model && a.niche) voegToe({ channel: a.channel, model: a.model, niche: a.niche }, a.agencyId);
  }

  return [...groepen.values()]
    .map((g) => {
      const telling = { accounts: g.accounts, bureaus: g.bureaus.size };
      return { sleutel: g.sleutel, telling, oordeel: beoordeelCel(g.sleutel, telling) };
    })
    .sort((a, b) => b.telling.accounts - a.telling.accounts);
}
