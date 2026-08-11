/**
 * Code Rood/Amber per AD ACCOUNT -- niet te verwarren met stoplicht.ts, dat gaat over of een
 * BUREAU zelf nog inlogt bij Ctrl PPC. Dit gaat over of de KLANT van een bureau er zelf mee
 * dreigt te stoppen: is dit account op weg om over 1 tot 3 maanden weg te zijn als er niets
 * gebeurt.
 *
 * ── DE COMBINATIE-REGEL ───────────────────────────────────────────────────────
 *
 * Twee signalen, en op zichzelf is geen van beide genoeg voor rood:
 *
 *   forecastAfwijking   het account presteert structureel (2+ maanden op rij) fors onder de
 *                       eigen forecast, niet een losse slechte maand.
 *   nieuweGebruiker     iemand die nog nooit in de change history van dit account voorkwam,
 *                       maakt ineens een wijziging. Vaak het eerste teken dat er een ander
 *                       persoon (concurrerend bureau, nieuwe interne medewerker) meekijkt of
 *                       meestuurt.
 *
 * Elk apart is amber: "wees alert", geen actie-eis. Pas de COMBINATIE is rood: "alle hands on
 * deck". Dat is een expliciete productbeslissing (11 augustus 2026, op verzoek van de eigenaar),
 * niet een technische -- rood moet zeldzaam en betrouwbaar blijven, of niemand handelt er meer
 * naar zodra het een paar keer verkeerd heeft gepiept. Zie ook stoplicht.ts: "de drempels zijn
 * een oordeel, geen meting" geldt hier evengoed. Er is nog geen churn-geschiedenis om de
 * getallen hieronder tegen te ijken.
 *
 * ── WAT HIER BEWUST NIET IN ZIT ───────────────────────────────────────────────
 *
 * Toegangsontzegging (de klant trekt de koppeling expliciet in) is een eigen, zwaarder signaal
 * dat op zichzelf al rood zou moeten zijn -- geen combinatie nodig, er is geen onschuldige
 * verklaring voor. Dat hoort thuis waar de sync-laag onderscheid kan maken tussen "token
 * ingetrokken" en een gewone sync-fout, en staat daarom nog niet hier.
 */

export type Licht = "groen" | "amber" | "rood" | "onbekend";

/** Vanaf welke afwijking t.o.v. de forecast het meetelt. Ruim boven de routine-drempels van de
 *  wekelijkse (>20% WoW) en maandelijkse (>30% MoM breuklijn) anomaliedetectie: die zijn bedoeld
 *  om een blik waard te zijn, dit is bedoeld om zeldzaam te zijn. */
export const FORECAST_AFWIJKING_PCT = 40;

/** Hoeveel opeenvolgende maanden de afwijking moet aanhouden voordat het telt als structureel
 *  en niet als een losse slechte maand. */
export const FORECAST_AANHOUDEND_MAANDEN = 2;

/** Hoeveel dagen terug een wijziging nog "recent" is voor de nieuwe-gebruiker-check. Zonder dit
 *  venster zou de allereerste wijziging die ooit op een account is gemaakt altijd als "nieuwe
 *  gebruiker" tellen -- iedereen was op een gegeven moment voor het eerst aanwezig. */
export const NIEUWE_GEBRUIKER_VENSTER_DAGEN = 30;

export interface ForecastAfwijkingSignaal {
  /** De laatste FORECAST_AANHOUDEND_MAANDEN afwijkingspercentages, meest recente maand laatst.
   *  Positief = boven forecast, negatief = eronder; deze module oordeelt op de absolute waarde. */
  afwijkingenPct: readonly number[];
}

export interface NieuweGebruikerSignaal {
  email: string;
  eersteWijziging: string; // ISO datetime van de eerste wijziging door dit e-mailadres binnen het venster
  wijzigingType: string | null; // resource_type/change_type uit ads_change_history, voor context in de reden
}

export interface AccountSignalen {
  forecast: ForecastAfwijkingSignaal | null;
  nieuweGebruiker: NieuweGebruikerSignaal | null;
}

export interface AccountOordeel {
  licht: Licht;
  redenen: string[];
}

/**
 * Is de forecast-afwijking structureel genoeg om mee te tellen? Puur op de laatste N maanden;
 * de aanroeper bepaalt welke metric (conversies, omzet, adSpend -- afhankelijk van het
 * geconfigureerde primaire doel van het account, zie determineAccountType/buildGoalsSection in
 * lib/prompts/sop-prompts.ts) tot een percentage is herleid. Deze module gaat daar niet opnieuw
 * over beslissen.
 */
export function heeftStructureleForecastAfwijking(signaal: ForecastAfwijkingSignaal | null): boolean {
  if (!signaal) return false;
  const { afwijkingenPct } = signaal;
  if (afwijkingenPct.length < FORECAST_AANHOUDEND_MAANDEN) return false;
  const laatsten = afwijkingenPct.slice(-FORECAST_AANHOUDEND_MAANDEN);
  return laatsten.every((pct) => Math.abs(pct) >= FORECAST_AFWIJKING_PCT);
}

interface WijzigingRij {
  changeDatetime: string;
  userEmail: string | null;
  resourceType: string | null;
  changeType: string | null;
}

/**
 * Vindt de vroegste wijziging binnen NIEUWE_GEBRUIKER_VENSTER_DAGEN die van een e-mailadres komt
 * dat DAARVOOR nog nooit in de geschiedenis van dit account voorkwam. Rijen mogen in willekeurige
 * volgorde binnenkomen; deze functie sorteert zelf.
 */
export function detecteerNieuweGebruiker(
  wijzigingen: readonly WijzigingRij[],
  nu: Date = new Date()
): NieuweGebruikerSignaal | null {
  const grens = nu.getTime() - NIEUWE_GEBRUIKER_VENSTER_DAGEN * 86_400_000;
  const gesorteerd = [...wijzigingen]
    .filter((w) => w.userEmail)
    .sort((a, b) => new Date(a.changeDatetime).getTime() - new Date(b.changeDatetime).getTime());

  const historisch = new Set<string>();
  for (const w of gesorteerd) {
    const t = new Date(w.changeDatetime).getTime();
    const email = (w.userEmail as string).toLowerCase();
    if (t < grens) {
      historisch.add(email);
      continue;
    }
    if (!historisch.has(email)) {
      return {
        email: w.userEmail as string,
        eersteWijziging: w.changeDatetime,
        wijzigingType: w.resourceType ?? w.changeType ?? null,
      };
    }
    // Een e-mailadres dat al binnen het venster is gezien telt niet nogmaals als "nieuw" -- wel
    // wordt het vanaf hier ook als bekend beschouwd, anders zou een tweede recente wijziging van
    // dezelfde nieuwe gebruiker een tweede keer als signaal binnenkomen.
    historisch.add(email);
  }
  return null;
}

/**
 * Het oordeel over één account. Rood alleen bij de combinatie; elk signaal apart is amber.
 */
export function beoordeelAccount(signalen: AccountSignalen): AccountOordeel {
  const forecastAfwijking = heeftStructureleForecastAfwijking(signalen.forecast);
  const nieuweGebruiker = signalen.nieuweGebruiker !== null;

  if (forecastAfwijking && nieuweGebruiker) {
    const laatste = signalen.forecast!.afwijkingenPct.at(-1)!;
    return {
      licht: "rood",
      redenen: [
        `${FORECAST_AANHOUDEND_MAANDEN}+ maanden op rij ${Math.abs(laatste).toFixed(0)}% afwijking t.o.v. forecast`,
        `nieuw e-mailadres (${signalen.nieuweGebruiker!.email}) actief sinds ${signalen.nieuweGebruiker!.eersteWijziging}`,
      ],
    };
  }
  if (forecastAfwijking) {
    const laatste = signalen.forecast!.afwijkingenPct.at(-1)!;
    return {
      licht: "amber",
      redenen: [`${FORECAST_AANHOUDEND_MAANDEN}+ maanden op rij ${Math.abs(laatste).toFixed(0)}% afwijking t.o.v. forecast`],
    };
  }
  if (nieuweGebruiker) {
    return {
      licht: "amber",
      redenen: [`nieuw e-mailadres (${signalen.nieuweGebruiker!.email}) actief sinds ${signalen.nieuweGebruiker!.eersteWijziging}`],
    };
  }
  return { licht: "groen", redenen: [] };
}
