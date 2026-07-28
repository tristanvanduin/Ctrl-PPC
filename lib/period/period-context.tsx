"use client";

// De gekozen periode, gedeeld binnen een pagina.
//
// Waarom een context en geen props: de periode raakt tientallen componenten diep in de
// tabbladen. Die allemaal een prop laten doorgeven levert een keten waarin één vergeten schakel
// stilzwijgend de oude periode blijft tonen — en niets in beeld zou dat verraden.
//
// De keuze wordt per klant bewaard in localStorage. Wie tussen beurzen wisselt houdt zijn
// periode, en wie terugkomt vindt hem terug. Bewust localStorage en niet de URL: de periode is
// een werkvoorkeur, geen deelbare toestand, en in de URL zou hij bij elke gedeelde link
// meeliften.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  resolvePeriod, resolveComparison, PERIOD_PRESETS, COMPARISON_MODES, isValidMonth,
  type ComparisonMode, type PeriodPreset, type PeriodRange,
} from "./period-range";

export interface PeriodState {
  preset: PeriodPreset;
  custom: PeriodRange | null;
  comparison: ComparisonMode;
  /** De uitgerekende periode. */
  range: PeriodRange;
  /** De vergelijkingsperiode, of null. */
  compareRange: PeriodRange | null;
  set: (preset: PeriodPreset, custom: PeriodRange | null, comparison: ComparisonMode) => void;
}

const DEFAULT_PRESET: PeriodPreset = "last_12m";
const DEFAULT_COMPARISON: ComparisonMode = "same_period_last_year";

// Buiten een provider werkt alles gewoon door op de standaardperiode in plaats van te crashen.
// Een component die per ongeluk buiten de boom hangt hoort geen wit scherm te geven.
const FALLBACK: PeriodState = {
  preset: DEFAULT_PRESET,
  custom: null,
  comparison: DEFAULT_COMPARISON,
  range: { start: "1970-01", end: "1970-01" },
  compareRange: null,
  set: () => {},
};

const PeriodContext = createContext<PeriodState | null>(null);

interface Opgeslagen {
  preset?: string;
  custom?: { start?: string; end?: string } | null;
  comparison?: string;
}

function sleutel(scope: string): string {
  return `rm-periode-${scope}`;
}

function lees(scope: string): Pick<PeriodState, "preset" | "custom" | "comparison"> {
  const leeg = { preset: DEFAULT_PRESET, custom: null, comparison: DEFAULT_COMPARISON };
  if (typeof window === "undefined") return leeg;
  try {
    const raw = localStorage.getItem(sleutel(scope));
    if (!raw) return leeg;
    const o = JSON.parse(raw) as Opgeslagen;
    // Opgeslagen waarden worden gevalideerd en niet vertrouwd: een oude of met de hand
    // aangepaste sleutel mag geen onbestaande preset de app in dragen.
    const preset = (PERIOD_PRESETS as readonly string[]).includes(o.preset ?? "")
      ? (o.preset as PeriodPreset) : DEFAULT_PRESET;
    const comparison = (COMPARISON_MODES as readonly string[]).includes(o.comparison ?? "")
      ? (o.comparison as ComparisonMode) : DEFAULT_COMPARISON;
    const custom = o.custom && isValidMonth(o.custom.start) && isValidMonth(o.custom.end)
      ? { start: o.custom.start, end: o.custom.end } : null;
    return { preset, custom, comparison };
  } catch {
    return leeg;
  }
}

export function PeriodProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  // Server en eerste client-render moeten hetzelfde opleveren, anders klaagt React over een
  // hydration mismatch. Daarom start alles op de standaard en komt localStorage er in een
  // effect achteraan.
  const [staat, setStaat] = useState(() => ({
    preset: DEFAULT_PRESET, custom: null as PeriodRange | null, comparison: DEFAULT_COMPARISON,
  }));

  useEffect(() => {
    setStaat(lees(scope));
  }, [scope]);

  const set = useCallback(
    (preset: PeriodPreset, custom: PeriodRange | null, comparison: ComparisonMode) => {
      setStaat({ preset, custom, comparison });
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(sleutel(scope), JSON.stringify({ preset, custom, comparison }));
        } catch {
          // Vol of geblokkeerd geheugen mag de keuze niet tegenhouden; hij geldt dan alleen
          // voor deze sessie.
        }
      }
    },
    [scope],
  );

  const waarde = useMemo<PeriodState>(() => {
    const range = resolvePeriod(staat.preset, staat.custom);
    return {
      ...staat,
      range,
      compareRange: resolveComparison(range, staat.comparison),
      set,
    };
  }, [staat, set]);

  return <PeriodContext.Provider value={waarde}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodState {
  return useContext(PeriodContext) ?? FALLBACK;
}
