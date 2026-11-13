// Over welke kanalen het jaardoel gaat, en wat elk scherm daaruit mag concluderen.
//
// WAAROM DIT BESTAAT. Het jaardoel staat één keer in Instellingen ("KPI-doelstellingen ... waar
// deze klant op stuurt"), zonder kanaal. Toch las elk scherm het op zijn eigen reeks. Op 13
// november, demo-greentech, doel 2.600 conversies:
//   - Overzicht, alle kanalen samen: 3.072 gerealiseerd, prognose 3.972, +52,8% gunstig;
//   - Google-tab en de kanaalkaart Google: 1.091, prognose 1.264, "Jaardoel in gevaar", en het
//     advies "Verhoog maandelijks budget met 635%";
//   - Doelen & voortgang: dezelfde Google-cijfers, "ACTIE VEREIST, 51% onder doel", zonder het
//     woord Google, met "meer budget is niet de oplossing" en "+635% budget" op één pagina;
//   - Prognose: alle kanalen +53%, Google -51%.
// Hetzelfde getal, vier oordelen, en geen scherm dat zei over welke kanalen het ging.
//
// DE REGEL. Een doel zonder kanaal geldt voor het account: alle kanalen die de klant heeft. Het
// wordt alleen gelegd op een reeks die precies die kanalen bevat. Heeft de klant alleen Google,
// dan is de Google-reeks het account en geldt het doel daar. Heeft hij er meer, dan staat een
// los kanaal tegen zijn eigen schatting (vorig jaar +10%, zoals de Meta-, LinkedIn- en
// Microsoft-tabs altijd al deden), en zegt het scherm dat erbij. Het budgetadvies volgt het doel:
// het staat alleen bij de reeks waarvoor het doel bedoeld is, uit één functie (budgetAdvies).
//
// Zuiver en zonder React, zodat de regels te toetsen zijn (lib/__jaardoel_bereik_test.ts).

import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { opsomming } from "@/lib/util/tekst";
import type { BudgetRecommendation } from "@/lib/forecast";

/** De reeks waar een scherm mee rekent: één kanaal, of alle kanalen samen. */
export type DoelReeks = Kanaal | "blended";

/** Over welke kanalen het ingevoerde jaardoel gaat. */
export interface JaardoelBereik {
  /** In de vaste volgorde van ALLE_KANALEN, nooit leeg. */
  kanalen: readonly Kanaal[];
  /**
   * Of er in Instellingen echt een doel is opgeslagen (kpiDoelenIngevoerd). Ontbreekt hij, dan is
   * het onbekend en noemt geen tekst Instellingen als herkomst: "het jaardoel uit Instellingen"
   * stond ook bij een klant die er nooit een had ingevoerd.
   */
  doelIngevoerd?: boolean;
}

/**
 * Het bereik van het jaardoel voor een klant met deze kanalen; null als de kanalen nog onbekend
 * zijn (dan beslist doelGeldtVoor zoals het altijd ging, zie daar).
 */
export function jaardoelBereik(
  kanalenVanKlant: readonly Kanaal[] | null | undefined,
  doelIngevoerd?: boolean,
): JaardoelBereik | null {
  if (!kanalenVanKlant || kanalenVanKlant.length === 0) return null;
  const kanalen = ALLE_KANALEN.filter((k) => kanalenVanKlant.includes(k));
  return doelIngevoerd === undefined ? { kanalen } : { kanalen, doelIngevoerd };
}

/**
 * Of het ingevoerde doel op deze reeks gelegd mag worden.
 *
 * Alle kanalen samen: altijd, dat ís het account. Eén kanaal: alleen als de klant niets anders
 * heeft. Zolang de kanalen onbekend zijn, geldt het voor Google zoals voorheen: de Google-reeks
 * laadt eerder dan de kanalenlijst, en een klant met alleen Google (de meeste) zou anders een
 * moment zonder zijn doel staan.
 */
export function doelGeldtVoor(bereik: JaardoelBereik | null, reeks: DoelReeks): boolean {
  if (reeks === "blended") return true;
  if (bereik === null) return reeks === "google";
  return bereik.kanalen.length === 1 && bereik.kanalen[0] === reeks;
}

/** De reeks waar het jaardoel tegen beoordeeld hoort te worden. */
export function reeksVanDoel(bereik: JaardoelBereik | null): DoelReeks {
  if (bereik === null) return "google";
  return bereik.kanalen.length === 1 ? bereik.kanalen[0] : "blended";
}

/** "alle kanalen samen (Google Ads, Meta en LinkedIn)" of "Google Ads". */
export function bereikTekst(bereik: JaardoelBereik | null): string {
  if (bereik === null) return "dit account";
  const namen = opsomming(bereik.kanalen.map((k) => KANAAL_NAAM[k]));
  return bereik.kanalen.length === 1 ? namen : `alle kanalen samen (${namen})`;
}

/**
 * De zin die een scherm bij zijn oordeel over het jaardoel zet: over welke kanalen het gaat.
 * Op een los kanaal van een klant met meer kanalen zegt hij ook dat het doel uit Instellingen hier
 * niet geldt, zodat "jaardoel in gevaar" op de Google-tab niet als oordeel over het account leest.
 */
export function oordeelOverTekst(bereik: JaardoelBereik | null, reeks: DoelReeks): string {
  if (doelGeldtVoor(bereik, reeks)) {
    return reeks === "blended" || bereik === null || bereik.kanalen.length > 1
      ? `Het jaardoel gaat over ${bereikTekst(bereik)}.`
      : `Het jaardoel gaat over ${bereikTekst(bereik)}, het enige kanaal van deze klant.`;
  }
  const kanaal = KANAAL_NAAM[reeks as Kanaal];
  // Alleen "uit Instellingen" als daar echt een doel staat. Zonder ingevoerd doel is er ook
  // niets om tegen te oordelen; dan zegt de zin alleen waar een doel voor zou gelden.
  const over = bereikTekst(bereik);
  const doelZin = bereik?.doelIngevoerd === true
    ? `Het jaardoel uit Instellingen geldt voor ${over}; ${kanaal} staat hier tegen een eigen schatting (vorig jaar +10%). Het oordeel over het jaardoel staat op Alle kanalen en op Doelen & voortgang.`
    : bereik?.doelIngevoerd === false
      ? `Er is geen jaardoel ingevoerd; een jaardoel zou gelden voor ${over}. ${kanaal} staat hier tegen een eigen schatting (vorig jaar +10%).`
      : `Een jaardoel geldt voor ${over}; ${kanaal} staat hier tegen een eigen schatting (vorig jaar +10%). Het oordeel over het jaardoel staat op Alle kanalen en op Doelen & voortgang.`;
  return `Dit gaat alleen over ${kanaal}. ${doelZin}`;
}

// ── Het budgetadvies ─────────────────────────────────────────────────────────

/**
 * Wat er over budget te zeggen valt, uit één regel voor elk scherm. Op de Google-tab stond
 * "Verhoog maandelijks budget met 635% naar € 71.671/maand" en op Doelen & voortgang, uit
 * dezelfde prognose, "Meer budget is niet de oplossing: de CPA (€ 108) ligt boven het doel (€ 45)",
 * en twee blokken lager weer "Bij een budgetverhoging van 635% is het jaardoel haalbaar". De
 * banner en het scenariovak kenden de efficiëntie-tak niet.
 */
export type BudgetAdviesUitkomst =
  /** Niets te adviseren: op of voor op het doel, of het doel geldt niet voor deze reeks. */
  | { soort: "geen" }
  /** Kosten zonder één conversie: eerst de meting, er is geen CPA om mee te rekenen. */
  | { soort: "meting"; maanden: readonly string[] }
  /** Achter op doel en de CPA ligt boven het CPA-doel: meer budget koopt dure conversies. */
  | { soort: "efficientie"; huidigeCpa: number; cpaDoel: number | null }
  /** Achter op doel en budget is de knop. */
  | { soort: "budget"; verhogingPct: number; nodigPerMaand: number };

export function budgetAdvies(
  rec: Pick<BudgetRecommendation, "behindTarget" | "efficiencyBottleneck" | "currentCpa" | "cpaTarget" | "spendIncreasePct" | "requiredMonthlySpend">,
  zonderConversies: readonly string[],
  doelGeldt: boolean,
): BudgetAdviesUitkomst {
  if (!doelGeldt || !rec.behindTarget) return { soort: "geen" };
  if (zonderConversies.length > 0) return { soort: "meting", maanden: zonderConversies };
  if (rec.efficiencyBottleneck) return { soort: "efficientie", huidigeCpa: rec.currentCpa, cpaDoel: rec.cpaTarget };
  // Onder vijf procent is geen advies: dat valt binnen de ruis van de prognose zelf.
  if (!(rec.spendIncreasePct > 5)) return { soort: "geen" };
  return { soort: "budget", verhogingPct: rec.spendIncreasePct, nodigPerMaand: rec.requiredMonthlySpend };
}

/**
 * Wat het scenariovak op Doelen & voortgang toont. Het stond bij elke achterstand, met "Zonder
 * aanpassing is de verwachting X (pct vs doel)". Met budgetAdvies verdween het vak bij een
 * achterstand waar onder vijf procent extra budget bij hoort, en die zin ermee. Nu blijft dan de
 * verwachting staan, zonder advies; zonder achterstand, of als het doel niet voor deze reeks geldt,
 * is er geen vak.
 */
export function scenarioVak(
  advies: BudgetAdviesUitkomst,
  behindTarget: boolean,
  doelGeldt: boolean,
): "advies" | "alleen-verwachting" | null {
  if (advies.soort !== "geen") return "advies";
  return doelGeldt && behindTarget ? "alleen-verwachting" : null;
}

/**
 * De reeks waar Doelen & voortgang werkelijk mee rekent: die van het doel, of Google als alle
 * kanalen samen niet laden. In dat laatste geval geldt het doel niet (de provider legt het
 * accountdoel niet op Google bij een klant met meer kanalen), en dus ook geen budgetadvies:
 * dat zou tegen de eigen schatting van Google rekenen.
 */
export function gebruikteDoelReeks(bereik: JaardoelBereik | null, blendedGeladen: boolean): { reeks: DoelReeks; doelGeldt: boolean } {
  const gewenst = reeksVanDoel(bereik);
  const reeks: DoelReeks = gewenst === "blended" && !blendedGeladen ? "google" : gewenst;
  return { reeks, doelGeldt: doelGeldtVoor(bereik, reeks) };
}

// ── Het oordeel naast een doel ───────────────────────────────────────────────

/**
 * Waar een metriek goed is: hoger (conversies, omzet, ROAS), lager (CPA), of rond het doel
 * (budget: eronder is niet ingezet, erboven is overbesteed).
 */
export type DoelRichting = "hoger" | "lager" | "rond";

export type DoelOordeel = "goed" | "let-op" | "slecht";

/**
 * Het oordeel over een prognose tegen zijn doel; `diffPct` is (prognose − doel) / doel × 100.
 *
 * Budget kreeg hier dezelfde richting als conversies: elke prognose op of boven het doel werd
 * groen. Op Doelen & voortgang stond "Advertentiebudget: gerealiseerd € 117.300, doel € 117.000,
 * prognose € 140.897 (+20%)" in groen: een budget dat in oktober op is, las als op schema.
 */
export function doelOordeel(diffPct: number, richting: DoelRichting): DoelOordeel {
  if (!Number.isFinite(diffPct)) return "let-op";
  if (richting === "rond") {
    const af = Math.abs(diffPct);
    if (af <= 5) return "goed";
    // Overbesteding is erger dan onderbesteding: het geld is weg.
    if (diffPct > 0) return diffPct > 15 ? "slecht" : "let-op";
    return "let-op";
  }
  const score = richting === "lager" ? -diffPct : diffPct;
  if (score >= -3) return "goed";
  return score >= -15 ? "let-op" : "slecht";
}
