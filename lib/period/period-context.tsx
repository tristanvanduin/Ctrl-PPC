"use client";

// De gekozen periode, gedeeld binnen een pagina.
//
// Waarom een context en geen props: de periode raakt tientallen componenten diep in de
// tabbladen. Die allemaal een prop laten doorgeven levert een keten waarin één vergeten schakel
// stilzwijgend de oude periode blijft tonen — en niets in beeld zou dat verraden.
//
// De keuze wordt per klant bewaard in localStorage. Wie tussen beurzen wisselt houdt zijn
// periode, en wie terugkomt vindt hem terug.
//
// EN IN DE ADRESBALK, als de pagina die koppeling meegeeft (`adres`, bouwplan fase 2). Hier stond
// "bewust niet de URL: de periode is een werkvoorkeur, geen deelbare toestand". Dat klopte zolang
// de periode alleen de band stuurde. Nu volgt de hele pagina hem, en dan is "Meta over de laatste
// drie maanden" precies wat je wilt kunnen doorsturen en wat een herlaad moet terugvinden. Het is
// dezelfde keuze op een tweede plek, geen tweede model (lib/period/periode-url.ts): staat er een
// periode in de adresbalk, dan gaat die voor en wordt hij ook bewaard; staat er niets, dan geldt de
// bewaarde keuze zoals altijd. Een pagina zonder `adres` (het portfolio) merkt hier niets van.
//
// WAAR DE PERIODE OPHOUDT
//
// De presets eindigden op de kalender: "laatste 12 maanden" liep op 1 november t/m oktober, ook
// als de data op 26 augustus stopte. September en oktober telden dan mee als maanden zonder
// kosten en conversies, en de vergelijking zakte in zonder dat er iets gebeurd was. De pagina
// geeft daarom de datastand mee; de presets eindigen op de laatste volle maand MET data
// (vensterEindMaand). Zonder datastand -- het portfolio -- blijft het de kalender.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  periodeOpEind, resolveComparison, vensterEindMaand, PERIOD_PRESETS, COMPARISON_MODES,
  DEFAULT_PRESET, DEFAULT_COMPARISON, isValidMonth,
  type ComparisonMode, type Month, type PeriodPreset, type PeriodRange, type PeriodeKeuze,
} from "./period-range";
import { schonePeriodeKeuze } from "./periode-url";
import { useUrlKeuze, type UrlKoppeling } from "../adresbalk";
import { today } from "../reporting-date";

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

// Buiten een provider werkt alles gewoon door op de standaardperiode in plaats van te crashen.
// Een component die per ongeluk buiten de boom hangt hoort geen wit scherm te geven.
//
// En het is ook echt de standaardperiode: de laatste twaalf maanden op de kalender, wat een
// provider zonder datastand en zonder bewaarde keuze geeft. Hier stond een vast bereik
// "1970-01", wat niemand merkte zolang alleen de band de periode las (die hangt altijd in een
// provider). Sinds de grafieken en tabellen hem volgen (bouwplan fase 2) zou een blok buiten de
// boom dan zijn cijfers filteren op januari 1970 en leeg zijn, zonder iets dat zegt waarom.
// Per maand bewaard: de uitkomst verandert alleen als de kalendermaand omslaat, en dezelfde
// waarde teruggeven houdt de memo's van de lezers stil.
let terugval: { maand: string; staat: PeriodState } | null = null;
function standaardPeriode(): PeriodState {
  const maand = today().slice(0, 7);
  if (terugval?.maand !== maand) {
    const eindMaand = vensterEindMaand(null);
    const range = periodeOpEind(DEFAULT_PRESET, null, eindMaand);
    terugval = {
      maand,
      staat: {
        preset: DEFAULT_PRESET,
        custom: null,
        comparison: DEFAULT_COMPARISON,
        range,
        compareRange: resolveComparison(range, DEFAULT_COMPARISON),
        eindMaand,
        dataStand: null,
        set: () => {},
      },
    };
  }
  return terugval.staat;
}

const PeriodContext = createContext<PeriodState | null>(null);

interface Opgeslagen {
  preset?: string;
  custom?: { start?: string; end?: string } | null;
  comparison?: string;
}

function sleutel(scope: string): string {
  return `rm-periode-${scope}`;
}

// Zonder koppeling: de adresbalk zegt nooit iets en er wordt niets geschreven. Eén vast object,
// zodat de hook hieronder altijd aangeroepen kan worden.
const GEEN_ADRES: UrlKoppeling<PeriodeKeuze> = { waarde: null, leesNu: () => null, schrijf: () => {} };

function bewaar(scope: string, keuze: PeriodeKeuze): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(sleutel(scope), JSON.stringify({ preset: keuze.preset, custom: keuze.custom, comparison: keuze.comparison }));
  } catch {
    // Vol of geblokkeerd geheugen mag de keuze niet tegenhouden; hij geldt dan alleen
    // voor deze sessie.
  }
}

function lees(scope: string): PeriodeKeuze {
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

export function PeriodProvider({ scope, dataStand, adres, children }: {
  scope: string;
  /** Tot waar de data loopt. Weglaten of null: de presets volgen de kalender. */
  dataStand?: PeriodDataStand | null;
  /** De koppeling met de adresbalk (?periode=, ?vergelijk=). Weglaten: alleen localStorage. */
  adres?: UrlKoppeling<PeriodeKeuze>;
  children: React.ReactNode;
}) {
  // De keuze uit de adresbalk, met de directe echo van de eigen klik (zie lib/adresbalk.ts).
  const [uitAdres, kiesAdres] = useUrlKeuze(adres ?? GEEN_ADRES);
  // Server en eerste client-render moeten hetzelfde opleveren, anders klaagt React over een
  // hydration mismatch. Daarom start alles op de standaard en komt localStorage er in een
  // effect achteraan. De adresbalk kennen server en client allebei; die mag er meteen in.
  const [staat, setStaat] = useState<PeriodeKeuze>(() => uitAdres ?? {
    preset: DEFAULT_PRESET, custom: null, comparison: DEFAULT_COMPARISON,
  });

  // Als tekst: de keuze is elke render een nieuw object, en het effect hoort alleen te lopen als
  // de adresbalk echt iets anders zegt.
  const adresSleutel = uitAdres ? JSON.stringify(uitAdres) : null;
  // De nieuwste koppeling, zonder hem als afhankelijkheid van het effect te nemen: de pagina bouwt
  // hem opnieuw bij elke verandering van de adresbalk (ook een kanaalwissel), en dan zou het effect
  // bij elke wissel de bewaarde keuze opnieuw inlezen en de hele boom laten renderen.
  const adresNu = useRef(adres);
  useEffect(() => { adresNu.current = adres; });
  useEffect(() => {
    if (adresSleutel === null) { setStaat(lees(scope)); return; }
    // Staat dit ook echt (nog) in de adresbalk? De echo van useUrlKeuze loopt één render achter:
    // bij een wissel naar een andere klant (een link zonder periode) is `scope` al van de nieuwe
    // klant terwijl de keuze nog die van de vorige is. Zonder deze controle werd de periode uit
    // het adres van klant A de bewaarde keuze van klant B.
    if (JSON.stringify(adresNu.current?.leesNu() ?? null) !== adresSleutel) return;
    // De adresbalk gaat voor, en wordt meteen de bewaarde keuze van deze klant: wie daarna naar
    // een beurs klikt (een link zonder periode) houdt zo de periode waar hij naar keek, in plaats
    // van terug te vallen op een keuze van weken geleden.
    const keuze = JSON.parse(adresSleutel) as PeriodeKeuze;
    setStaat((huidig) => (JSON.stringify(huidig) === adresSleutel ? huidig : keuze));
    bewaar(scope, keuze);
  }, [scope, adresSleutel]);

  const heeftAdres = adres != null;
  const set = useCallback(
    (preset: PeriodPreset, custom: PeriodRange | null, comparison: ComparisonMode) => {
      // Met een adresbalk in de vaste vorm van de adresbalk (schonePeriodeKeuze): dan is de eigen
      // keuze letterlijk wat er straks uit terugkomt, en hoeft niets een tweede keer te renderen.
      const keuze = heeftAdres ? schonePeriodeKeuze({ preset, custom, comparison }) : { preset, custom, comparison };
      setStaat(keuze);
      bewaar(scope, keuze);
      if (heeftAdres) kiesAdres(keuze);
    },
    [scope, heeftAdres, kiesAdres],
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
  return useContext(PeriodContext) ?? standaardPeriode();
}
