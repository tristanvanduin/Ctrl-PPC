// Fase 6: T-minus trendlijnen voor de Forecaster-UI. Bouwt bewust op de bestaande, ongewijzigde
// lib/fair-kern (cumulativeCurve, isWithinWindow) in plaats van er iets aan toe te voegen: die map
// is heilig voor deze fase, dus alles wat nieuw is staat hier, in lib/analysis, en raakt lib/fair
// en lib/events alleen als lezer (import), nooit als schrijver.
//
// Waarom een aparte curve-berekening naast lib/events/account-event-analysis.ts: die module
// rekent de pacing-samenvatting uit (een enkel punt op de as: "waar staan we nu"), niet de hele
// lijn die een grafiek nodig heeft. cumulativeCurve() bestaat al in lib/fair/event-time-axis.ts en
// wordt hier gewoon nogmaals aangeroepen, met dezelfde editie-objecten - geen nieuwe wiskunde,
// alleen een andere vorm van dezelfde, al geteste optelling.

import { cumulativeCurve, type Edition, type DailyPoint, type CurvePoint } from "@/lib/fair/event-time-axis";

export interface EditionCurves {
  current: CurvePoint[];
  previous: CurvePoint[];
}

/** De cumulatieve curve voor de huidige en de vorige editie, uit dezelfde puntenreeks. */
export function buildEditionCurves(points: DailyPoint[], current: Edition | null, previous: Edition | null): EditionCurves {
  return {
    current: current ? cumulativeCurve(points, current) : [],
    previous: previous ? cumulativeCurve(points, previous) : [],
  };
}

export interface CpaCurvePoint {
  daysToFair: number;
  cpa: number | null;
}

/**
 * CPA op elk punt van de as: cumulatieve spend gedeeld door cumulatieve conversies op datzelfde
 * dagen-tot-event-punt. Geen nieuwe optelling, alleen een deling van twee curves die uit dezelfde
 * editie komen. Null zodra er nog geen conversies zijn (delen door nul zegt niets over CPA, het
 * zegt "nog geen basis").
 */
export function deriveCpaCurve(convCurve: CurvePoint[], costCurve: CurvePoint[]): CpaCurvePoint[] {
  const costPerDag = new Map(costCurve.map((p) => [p.daysToFair, p.cumulative]));
  return convCurve.map((p) => {
    const cost = costPerDag.get(p.daysToFair);
    const cpa = cost != null && p.cumulative > 0 ? Math.round((cost / p.cumulative) * 100) / 100 : null;
    return { daysToFair: p.daysToFair, cpa };
  });
}
