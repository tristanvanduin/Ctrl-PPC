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
//
// WAAR DE PERIODE OPHOUDT
//
// De presets eindigden op de kalender: "laatste 12 maanden" liep op 1 november t/m oktober, ook
// als de data op 26 augustus stopte. September en oktober telden dan mee als maanden zonder
// kosten en conversies, en de vergelijking zakte in zonder dat er iets gebeurd was. De pagina
// geeft daarom de datastand mee; de presets eindigen op de laatste volle maand MET data
// (vensterEindMaand). Zonder datastand -- het portfolio -- blijft het de kalender.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  periodeOpEind, resolveComparison, vensterEindMaand, PERIOD_PRESETS, COMPARISON_MODES,
  isValidMonth, type ComparisonMode, type Month, type PeriodPreset, type PeriodRange,
} from "./period-range";

/** Tot waar de data van deze pagina loopt, zoals de pagina die heeft vastgesteld. */
export interface PeriodDataStand {
  /** De laatste maand die volledig in de data zit, of null als er geen is. */
  laatsteVolleMaand: string | null;
  /** De maand waarvan de data maar een deel dekt (bv. t/m de 26e), of null. */
  partieel: { maand: string; tmDag: number; dagenInMaand: number } | null;
  /** De laatste dag met data, "YYYY-MM-DD", of null. */
  dataTot: string | null;
  /**
   * Bronnen die eerder ophouden dan dataTot en het venster toch niet tegenhielden (niet gekoppeld,
   * al maanden achter, of gepauzeerd met een gezonde sync), met hun eigen laatste dag. Na die dag
   * tellen ze als nul; de band zegt dat (gezamenlijkeDataTot in lib/sync/datastand.ts).
   */
  uitgeslotenBronnen?: readonly { bron: string; dataTot: string | null }[];
}

export interface PeriodState {
  preset: PeriodPreset;
  custom: PeriodRange | null;
  comparison: ComparisonMode;
  /** De uitgerekende periode. */
  range: PeriodRange;
  /** De vergelijkingsperiode, of null. */
  compareRange: PeriodRange | null;
  /** De maand waarop de presets eindigen: de laatste volle maand met data, nooit voorbij de kalender. */
  eindMaand: Month;
  /** De meegegeven datastand, voor de melding bij de cijfers; null zonder. */
  dataStand: PeriodDataStand | null;
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
  eindMaand: "1970-01",
  dataStand: null,
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

export function PeriodProvider({ scope, dataStand, children }: {
  scope: string;
  /** Tot waar de data loopt. Weglaten of null: de presets volgen de kalender. */
  dataStand?: PeriodDataStand | null;
  children: React.ReactNode;
}) {
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

  // Op de losse velden en niet op het object: een pagina die elke render een nieuw object
  // meegeeft, zou anders elke render de hele boom onder de provider opnieuw laten rekenen.
  const volle = dataStand?.laatsteVolleMaand ?? null;
  const dataTot = dataStand?.dataTot ?? null;
  const pMaand = dataStand?.partieel?.maand ?? null;
  const pTmDag = dataStand?.partieel?.tmDag ?? null;
  const pDagen = dataStand?.partieel?.dagenInMaand ?? null;
  // Als tekst, om dezelfde reden: de lijst is elke render een nieuw object.
  const uitSleutel = JSON.stringify(dataStand?.uitgeslotenBronnen ?? []);
  const heeftStand = dataStand != null;
  const stand = useMemo<PeriodDataStand | null>(() => {
    if (!heeftStand) return null;
    const partieel = pMaand !== null && pTmDag !== null && pDagen !== null
      ? { maand: pMaand, tmDag: pTmDag, dagenInMaand: pDagen } : null;
    const uitgeslotenBronnen = JSON.parse(uitSleutel) as { bron: string; dataTot: string | null }[];
    return { laatsteVolleMaand: volle, partieel, dataTot, ...(uitgeslotenBronnen.length > 0 ? { uitgeslotenBronnen } : {}) };
  }, [heeftStand, volle, dataTot, pMaand, pTmDag, pDagen, uitSleutel]);

  const waarde = useMemo<PeriodState>(() => {
    const eindMaand = vensterEindMaand(stand?.laatsteVolleMaand);
    // Een eigen periode wordt op eindMaand geklemd, net als de presets (periodeOpEind). Ongeklemd
    // telden de maanden na het eind van de data als nullen (de demo: -26,5% conversies waar -1,5%
    // hoort), en zo'n periode ontstaat vanzelf: opgeslagen onder de kalender als grens, gekozen op
    // een tab met een latere eindmaand (er is één bewaarde keuze per klant), of terwijl de stand nog
    // laadde (review [2], [42]). Alleen bij het uitrekenen: de bewaarde keuze blijft staan, en loopt
    // de data later verder, dan krijg je hem weer heel.
    const range = periodeOpEind(staat.preset, staat.custom, eindMaand);
    return {
      ...staat,
      range,
      compareRange: resolveComparison(range, staat.comparison),
      eindMaand,
      dataStand: stand,
      set,
    };
  }, [staat, set, stand]);

  return <PeriodContext.Provider value={waarde}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodState {
  return useContext(PeriodContext) ?? FALLBACK;
}
