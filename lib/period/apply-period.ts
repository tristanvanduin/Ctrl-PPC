// De brug tussen de periodekeuze en de datalaag.
//
// WAAROM DIT NODIG IS
//
// De datalaag denkt in kalenderjaren: historicalYears is gesleuteld op jaartal en
// currentYearData is een rij van twaalf vakjes. Een periode als "november 2025 tot en met
// februari 2026" loopt daar dwars doorheen. Deze module maakt van beide een doorlopende reeks
// op maandsleutel, zodat een periode gewoon een snede is.
//
// Alles hier werkt op data die de app AL heeft opgehaald. Er gaat geen query overheen: het
// dashboard laadt dertien maanden plus historie, en een periodefilter binnen dat venster is
// dus puur rekenwerk. Kiest iemand een periode die verder terug ligt dan wat er geladen is,
// dan levert dit de maanden die er wel zijn en meldt missing welke ontbreken — stilzwijgend
// een kortere reeks teruggeven zou een trend opleveren over minder maanden dan gevraagd, en
// niets zou dat verraden.

import type { ClientHistoricalData, MonthlyRecord } from "../types";
import { monthsIn, type Month, type PeriodRange } from "./period-range";

/** Een maandrij met zijn absolute maandsleutel erbij. */
export interface DatedMonth extends MonthlyRecord {
  /** "YYYY-MM" */
  key: Month;
  year: number;
}

export interface PeriodSlice {
  months: DatedMonth[];
  /** Gevraagde maanden waarvoor geen data bestaat. */
  missing: Month[];
  totals: { conversions: number; revenue: number; adSpend: number };
}

const key = (year: number, month: number): Month => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Alle beschikbare maanden als een doorlopende reeks, oplopend op datum.
 *
 * currentYearData bevat null voor maanden die nog niet gerealiseerd zijn; die vallen weg.
 * Dat is geen verlies: een lege toekomstige maand als nul meetellen zou elk gemiddelde en
 * elke trend naar beneden trekken.
 */
export function flattenMonths(data: ClientHistoricalData): DatedMonth[] {
  const out: DatedMonth[] = [];

  for (const [jaarStr, maanden] of Object.entries(data.historicalYears ?? {})) {
    const jaar = Number(jaarStr);
    if (!Number.isFinite(jaar)) continue;
    for (const m of maanden ?? []) {
      if (m) out.push({ ...m, key: key(jaar, m.month), year: jaar });
    }
  }

  for (const m of data.currentYearData ?? []) {
    if (m) out.push({ ...m, key: key(data.currentYear, m.month), year: data.currentYear });
  }

  // Een maand kan in beide bronnen staan als het huidige jaar ook in historicalYears zit.
  // Dan wint currentYearData, want dat is de verse kant.
  const perKey = new Map<Month, DatedMonth>();
  for (const m of out) perKey.set(m.key, m);

  return [...perKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** De maanden binnen een periode, plus welke gevraagde maanden ontbreken. */
export function slicePeriod(data: ClientHistoricalData, period: PeriodRange): PeriodSlice {
  const alle = new Map(flattenMonths(data).map((m) => [m.key, m]));
  const gevraagd = monthsIn(period);

  const months: DatedMonth[] = [];
  const missing: Month[] = [];
  for (const k of gevraagd) {
    const m = alle.get(k);
    if (m) months.push(m);
    else missing.push(k);
  }

  return {
    months,
    missing,
    totals: {
      conversions: months.reduce((s, m) => s + (m.conversions || 0), 0),
      revenue: months.reduce((s, m) => s + (m.revenue || 0), 0),
      adSpend: months.reduce((s, m) => s + (m.adSpend || 0), 0),
    },
  };
}

export interface PeriodDelta {
  huidig: number;
  vorig: number;
  /** Procentuele verandering, of null als er geen basis is om tegen af te zetten. */
  pct: number | null;
}

/**
 * De verandering tussen twee perioden.
 *
 * pct is null en niet 0 wanneer de vergelijkingsperiode nul was. Van niets naar iets is geen
 * "0 procent groei" en ook geen oneindige: het is geen percentage. Dat onderscheid is precies
 * wat er eerder in deze codebase misging, waar een deling terugviel op een getal dat plausibel
 * oogde.
 */
export function delta(huidig: number, vorig: number): PeriodDelta {
  return { huidig, vorig, pct: vorig > 0 ? ((huidig - vorig) / vorig) * 100 : null };
}

/** De drie kerncijfers vergeleken tussen twee perioden. */
export function comparePeriods(
  data: ClientHistoricalData,
  period: PeriodRange,
  comparison: PeriodRange | null,
): {
  current: PeriodSlice;
  previous: PeriodSlice | null;
  deltas: { conversions: PeriodDelta; revenue: PeriodDelta; adSpend: PeriodDelta } | null;
} {
  const current = slicePeriod(data, period);
  if (!comparison) return { current, previous: null, deltas: null };

  const previous = slicePeriod(data, comparison);
  return {
    current,
    previous,
    deltas: {
      conversions: delta(current.totals.conversions, previous.totals.conversions),
      revenue: delta(current.totals.revenue, previous.totals.revenue),
      adSpend: delta(current.totals.adSpend, previous.totals.adSpend),
    },
  };
}
