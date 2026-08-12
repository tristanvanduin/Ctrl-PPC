/**
 * Code Rood/Amber -- het uiteindelijke oordeel dat de UI toont. Combineert twee onafhankelijke
 * motoren, "best of both worlds" (besluit eigenaar, 11 augustus 2026):
 *
 *   account-stoplicht.ts   het nieuwe combinatiesignaal: structurele forecast-afwijking EN een
 *                           nieuwe gebruiker in de change history. Rood alleen bij de combinatie.
 *   health-score.ts        het bestaande, per factor beoordeelde account-cijfer. Had al een eigen
 *                           severity: "critical" op de anomalies-array, zonder dat er ooit een
 *                           losstaande drempel voor is gedefinieerd.
 *
 * ── WAAROM ALLEEN "critical" MEETELT, EN "warning" NIET ─────────────────────────────────────
 *
 * health-score.ts's "warning"-anomalies (CPC/CPA-stijging, budget-gelimiteerde campagnes,
 * zoekterm- en ad-group-verspilling) zijn precies het soort frictie waar Code Oranje voor bedoeld
 * is -- een apart, nog niet gebouwd systeem, expliciet losgekoppeld van churn (eigenaar, 11
 * augustus 2026: "dit gaat te ver" / Code Oranje is geen churnsignaal). Ze hier laten meetellen
 * voor Code Rood/Amber zou de twee systemen alsnog door elkaar heen bouwen voordat Code Oranje
 * er is. Alleen "critical" telt mee: dat zijn op dit moment precies twee gevallen, allebei
 * inhoudelijk churn-relevant --
 *   - "Geschat jaardoel in gevaar" (prognose < 50% van het jaardoel)
 *   - "Sterke neerwaartse trend" (prestatiefactor EN laatste maand allebei < 80% van verwachting)
 * -- en dus horen bij dezelfde orde van grootte als "alle hands on deck", niet bij "wees alert".
 *
 * ── DE COMBINATIE ────────────────────────────────────────────────────────────────────────────
 *
 * Rood:  account-stoplicht zegt rood, OF health-score heeft een critical anomaly.
 * Amber: account-stoplicht zegt amber (ongewijzigd -- health-score's warnings doen hier bewust
 *        niet aan mee, zie hierboven).
 * Groen: geen van beide.
 */

import type { AccountOordeel, Licht } from "./account-stoplicht";
import type { HealthScore } from "../health-score";

export interface CodeRoodOordeel {
  licht: Licht;
  redenen: string[];
}

export function beoordeelCodeRood(account: AccountOordeel, health: HealthScore): CodeRoodOordeel {
  const kritiekeAnomalieen = health.anomalies.filter((a) => a.severity === "critical");

  if (account.licht === "rood" || kritiekeAnomalieen.length > 0) {
    return {
      licht: "rood",
      redenen: [...account.redenen, ...kritiekeAnomalieen.map((a) => a.title)],
    };
  }

  if (account.licht === "amber") {
    return { licht: "amber", redenen: account.redenen };
  }

  return { licht: "groen", redenen: [] };
}
