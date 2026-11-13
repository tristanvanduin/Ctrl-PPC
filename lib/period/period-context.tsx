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
//
// PER DAG, IN DE NIEUWE WEERGAVE (stap 3 van het periodemodel)
//
// Met `dagModus` kiest de pagina ook events, vrije datums, de vorige editie en een vrije
// vergelijkingsperiode (lib/period/dag-keuze.ts). De staat blijft één keuze: de maandkeuze, met
// `dag` erbij als maanden niet volstaan. Daaruit volgen twee dingen. `range` en `compareRange` zijn
// de MAANDEN die de periode en de vergelijking raken, voor de blokken die per maand tellen (hun
// vensterlabel zegt dat). En `dag` is de keuze per dag, uitgerekend, voor de kerncijfers en de
// kanaalkaarten. Kan de keuze als maandkeuze (hele maanden, een oude vergelijking), dan zegt
// `dag.maandPad` dat, en rekent alles zoals het altijd deed. Zonder `dagModus` (de vertrouwde
// weergave, het portfolio) is `dag` null en verandert er niets.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  periodeOpEind, resolveComparison, vensterEindMaand, PERIOD_PRESETS, COMPARISON_MODES,
  DEFAULT_PRESET, DEFAULT_COMPARISON, isValidMonth,
  type ComparisonMode, type Month, type PeriodPreset, type PeriodRange,
} from "./period-range";
import { schonePeriodeKeuze } from "./periode-url";
import { periodeCookieRegel } from "./periode-cookie";
import {
  dagKeuzeUitParams, dagVan, lostDagKeuzeOp, metDag, zetDagKeuzeParams, zonderDag,
  type DagKeuze, type DagStaat, type PeriodeKeuzeMetDag,
} from "./dag-keuze";
import { omhullendeMaanden } from "./dag-periode";
import type { EventPeriode } from "../events/event-periodes";
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
  /** Alleen in de nieuwe weergave (dagModus): de keuze per dag, uitgerekend. Anders null. */
  dag: DagStaat | null;
  /** Zet een keuze per dag. Buiten de nieuwe weergave doet hij niets. */
  setDag: (k: DagKeuze) => void;
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
        dag: null,
        setDag: () => {},
      },
    };
  }
  return terugval.staat;
}

const PeriodContext = createContext<PeriodState | null>(null);

/**
 * De datastand in de vaste vorm waarmee de provider rekent: de partiële maand alleen als hij heel
 * is, en de uitgesloten bronnen alleen als er een is. Los, zodat de kerncijfers uit het zaad
 * (components/dashboard/band-uit-zaad.tsx) met exact dezelfde stand rekenen als de provider.
 */
export function vasteStand(dataStand: PeriodDataStand | null | undefined): PeriodDataStand | null {
  if (dataStand == null) return null;
  const p = dataStand.partieel;
  const partieel = p != null && p.maand != null && p.tmDag != null && p.dagenInMaand != null
    ? { maand: p.maand, tmDag: p.tmDag, dagenInMaand: p.dagenInMaand } : null;
  const uitgeslotenBronnen = dataStand.uitgeslotenBronnen ?? [];
  return {
    laatsteVolleMaand: dataStand.laatsteVolleMaand ?? null, partieel, dataTot: dataStand.dataTot ?? null,
    ...(uitgeslotenBronnen.length > 0 ? { uitgeslotenBronnen } : {}),
  };
}

/**
 * De periode die de provider uitgeeft, uit de keuze en de datastand. Zuiver: de provider en de
 * kerncijfers uit het zaad rekenen hem met dezelfde functie, en dus met hetzelfde venster.
 */
export function periodeWaarde(
  keuze: PeriodeKeuzeMetDag, stand: PeriodDataStand | null, set: PeriodState["set"],
  dagOpties?: { events: readonly EventPeriode[] | null; setDag: PeriodState["setDag"] },
): PeriodState {
  const eindMaand = vensterEindMaand(stand?.laatsteVolleMaand);
  if (dagOpties) {
    // De nieuwe weergave. Een periode per dag: de maanden die hij raakt, NIET geklemd op de
    // datastand. Een actie in de lopende maand hoort de blokken per maand die maand te laten tonen
    // (deels gevuld, en zo gelabeld), niet stil de maand ervoor.
    const dk = dagVan(keuze);
    const range = dk.periode.soort === "dagen" ? omhullendeMaanden(dk.periode) : periodeOpEind(keuze.preset, keuze.custom, eindMaand);
    const dag = lostDagKeuzeOp(dk, range, dagOpties.events);
    return {
      preset: keuze.preset, custom: keuze.custom, comparison: keuze.comparison,
      range,
      compareRange: dag.maandPad ? resolveComparison(range, keuze.comparison)
        : dag.vergelijking.periode ? omhullendeMaanden(dag.vergelijking.periode) : null,
      eindMaand,
      dataStand: stand,
      set,
      dag,
      setDag: dagOpties.setDag,
    };
  }
  // Een eigen periode wordt op eindMaand geklemd, net als de presets (periodeOpEind). Ongeklemd
  // telden de maanden na het eind van de data als nullen (de demo: -26,5% conversies waar -1,5%
  // hoort), en zo'n periode ontstaat vanzelf: opgeslagen onder de kalender als grens, gekozen op
  // een tab met een latere eindmaand (er is één bewaarde keuze per klant), of terwijl de stand nog
  // laadde (review [2], [42]). Alleen bij het uitrekenen: de bewaarde keuze blijft staan, en loopt
  // de data later verder, dan krijg je hem weer heel.
  const range = periodeOpEind(keuze.preset, keuze.custom, eindMaand);
  return {
    preset: keuze.preset, custom: keuze.custom, comparison: keuze.comparison,
    range,
    compareRange: resolveComparison(range, keuze.comparison),
    eindMaand,
    dataStand: stand,
    set,
    dag: null,
    setDag: () => {},
  };
}

/**
 * Een vaste periode voor wat eronder staat, zonder keuze en zonder opslag. Alleen voor de
 * kerncijfers uit het zaad: die tonen het venster dat bij HUN data hoort, en de provider erboven
 * kent die data nog niet (zijn hooks laden nog).
 */
export function VastePeriode({ waarde, children }: { waarde: PeriodState; children: React.ReactNode }) {
  return <PeriodContext.Provider value={waarde}>{children}</PeriodContext.Provider>;
}

interface Opgeslagen {
  preset?: string;
  custom?: { start?: string; end?: string } | null;
  comparison?: string;
  /** De keuze per dag in de vorm van de adresbalk, alleen als maanden niet volstaan. */
  dag?: string;
}

function sleutel(scope: string): string {
  return `rm-periode-${scope}`;
}

// Zonder koppeling: de adresbalk zegt nooit iets en er wordt niets geschreven. Eén vast object,
// zodat de hook hieronder altijd aangeroepen kan worden.
const GEEN_ADRES: UrlKoppeling<PeriodeKeuzeMetDag> = { waarde: null, leesNu: () => null, schrijf: () => {} };

/** De keuze in de vaste vorm van de weergave: met dagModus de keuze per dag waar nodig, anders zonder. */
function inVorm(k: PeriodeKeuzeMetDag, dagModus: boolean): PeriodeKeuzeMetDag {
  return dagModus ? metDag(dagVan(k)) : zonderDag(k);
}

function bewaar(scope: string, keuze: PeriodeKeuzeMetDag, inCookie: boolean): void {
  if (typeof window === "undefined") return;
  try {
    // De maandkeuze altijd (die leest de vertrouwde weergave), de keuze per dag erbij als hij er is.
    const p = new URLSearchParams();
    if (keuze.dag) zetDagKeuzeParams(p, keuze.dag);
    localStorage.setItem(sleutel(scope), JSON.stringify({
      preset: keuze.preset, custom: keuze.custom, comparison: keuze.comparison, ...(keuze.dag ? { dag: p.toString() } : {}),
    }));
  } catch {
    // Vol of geblokkeerd geheugen mag de keuze niet tegenhouden; hij geldt dan alleen
    // voor deze sessie.
  }
  if (inCookie) bewaarCookie(keuze);
}

/** Dezelfde keuze in de cookie van deze klantpagina (lib/period/periode-cookie.ts), voor de server. */
function bewaarCookie(keuze: PeriodeKeuzeMetDag): void {
  try {
    const regel = periodeCookieRegel(keuze, window.location.pathname);
    if (regel) document.cookie = regel;
  } catch {
    // Geen cookies: dan weet alleen de browser het, en rendert de server de cijfers niet vooraf.
  }
}

function lees(scope: string, dagModus: boolean): PeriodeKeuzeMetDag {
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
    // De keuze per dag alleen in de nieuwe weergave, en gecontroleerd zoals een adres.
    const dag = dagModus && typeof o.dag === "string" ? dagKeuzeUitParams(new URLSearchParams(o.dag)) : null;
    return dag ? metDag(dag) : { preset, custom, comparison };
  } catch {
    return leeg;
  }
}

export function PeriodProvider({ scope, dataStand, adres, beginKeuze = null, bewaarInCookie = false, dagModus = false, events = null, children }: {
  scope: string;
  /** Tot waar de data loopt. Weglaten of null: de presets volgen de kalender. */
  dataStand?: PeriodDataStand | null;
  /** De koppeling met de adresbalk (?periode=, ?vergelijk=). Weglaten: alleen localStorage. */
  adres?: UrlKoppeling<PeriodeKeuzeMetDag>;
  /**
   * De bewaarde keuze zoals de SERVER hem uit de cookie las (lib/period/periode-cookie.ts). Server
   * en eerste client-render krijgen dezelfde prop, dus mag hij er meteen in, net als de adresbalk.
   * Null: geen cookie, dan de standaard tot localStorage gelezen is, zoals altijd.
   */
  beginKeuze?: PeriodeKeuzeMetDag | null;
  /**
   * Schrijf de keuze ook in de cookie van deze klantpagina, zodat de server hem bij de volgende
   * paginalaad kent. Alleen op een klantpagina; het portfolio laat hem uit.
   */
  bewaarInCookie?: boolean;
  /** De nieuwe weergave: kies ook per dag (zie de kop). Uit: precies zoals het was. */
  dagModus?: boolean;
  /** De events van de klant (lib/events/event-periodes.ts), voor de dagmodus; null zolang ze laden. */
  events?: readonly EventPeriode[] | null;
  children: React.ReactNode;
}) {
  // De keuze uit de adresbalk, met de directe echo van de eigen klik (zie lib/adresbalk.ts).
  const [uitAdres, kiesAdres] = useUrlKeuze(adres ?? GEEN_ADRES);
  // Server en eerste client-render moeten hetzelfde opleveren, anders klaagt React over een
  // hydration mismatch. Daarom start alles op wat beide kennen -- de adresbalk, dan de cookie die
  // de server meegaf -- en anders op de standaard; localStorage komt er in een effect achteraan.
  // Zonder de cookie startte ook wie een andere periode bewaard had op de standaard: de server
  // kan de kerncijfers dan niet vooraf renderen, want ze zouden na het laden verspringen.
  const [staat, setStaat] = useState<PeriodeKeuzeMetDag>(() => inVorm(uitAdres ?? beginKeuze ?? {
    preset: DEFAULT_PRESET, custom: null, comparison: DEFAULT_COMPARISON,
  }, dagModus));
  // Schakelt de weergave om, dan dezelfde keuze in de vorm van de andere weergave (uitgerekend, niet
  // bewaard: pas een eigen keuze overschrijft wat er bewaard is).
  const keuzeInVorm = useMemo(() => inVorm(staat, dagModus), [staat, dagModus]);

  // Als tekst: de keuze is elke render een nieuw object, en het effect hoort alleen te lopen als
  // de adresbalk echt iets anders zegt.
  const adresSleutel = uitAdres ? JSON.stringify(uitAdres) : null;
  // De nieuwste koppeling, zonder hem als afhankelijkheid van het effect te nemen: de pagina bouwt
  // hem opnieuw bij elke verandering van de adresbalk (ook een kanaalwissel), en dan zou het effect
  // bij elke wissel de bewaarde keuze opnieuw inlezen en de hele boom laten renderen.
  const adresNu = useRef(adres);
  useEffect(() => { adresNu.current = adres; });
  // Via een ref, zoals het adres: het effect hoort alleen op de scope en de adresbalk te lopen.
  const inCookie = useRef(bewaarInCookie);
  useEffect(() => { inCookie.current = bewaarInCookie; });
  const dagNu = useRef(dagModus);
  useEffect(() => { dagNu.current = dagModus; });
  useEffect(() => {
    if (adresSleutel === null) {
      // Zelfde inhoud: dezelfde staat, zodat er niets opnieuw rekent.
      const bewaard = inVorm(lees(scope, dagNu.current), dagNu.current);
      setStaat((huidig) => (JSON.stringify(huidig) === JSON.stringify(bewaard) ? huidig : bewaard));
      // De cookie gelijk met localStorage: wie al een keuze had van vóór de cookie, of een cookie
      // die verliep, krijgt bij de volgende paginalaad de cijfers vooraf. Ook als er niets bewaard
      // is: dan weet de server dat het de standaard is, en niet dat hij het niet weet.
      if (inCookie.current) bewaarCookie(bewaard);
      return;
    }
    // Staat dit ook echt (nog) in de adresbalk? De echo van useUrlKeuze loopt één render achter:
    // bij een wissel naar een andere klant (een link zonder periode) is `scope` al van de nieuwe
    // klant terwijl de keuze nog die van de vorige is. Zonder deze controle werd de periode uit
    // het adres van klant A de bewaarde keuze van klant B.
    if (JSON.stringify(adresNu.current?.leesNu() ?? null) !== adresSleutel) return;
    // De adresbalk gaat voor, en wordt meteen de bewaarde keuze van deze klant: wie daarna naar
    // een beurs klikt (een link zonder periode) houdt zo de periode waar hij naar keek, in plaats
    // van terug te vallen op een keuze van weken geleden.
    const keuze = JSON.parse(adresSleutel) as PeriodeKeuzeMetDag;
    setStaat((huidig) => (JSON.stringify(huidig) === adresSleutel ? huidig : keuze));
    bewaar(scope, keuze, inCookie.current);
  }, [scope, adresSleutel]);

  const heeftAdres = adres != null;
  const set = useCallback(
    (preset: PeriodPreset, custom: PeriodRange | null, comparison: ComparisonMode) => {
      // Met een adresbalk in de vaste vorm van de adresbalk (schonePeriodeKeuze): dan is de eigen
      // keuze letterlijk wat er straks uit terugkomt, en hoeft niets een tweede keer te renderen.
      const maand = heeftAdres ? schonePeriodeKeuze({ preset, custom, comparison }) : { preset, custom, comparison };
      // In de dagmodus in de vorm van die modus, zodat een oude bediening dezelfde staat geeft.
      const keuze = inVorm(maand, dagModus);
      setStaat(keuze);
      bewaar(scope, keuze, bewaarInCookie);
      if (heeftAdres) kiesAdres(keuze);
    },
    [scope, heeftAdres, kiesAdres, bewaarInCookie, dagModus],
  );
  const setDag = useCallback(
    (k: DagKeuze) => {
      if (!dagModus) return;
      const keuze = metDag(k);
      setStaat(keuze);
      bewaar(scope, keuze, bewaarInCookie);
      if (heeftAdres) kiesAdres(keuze);
    },
    [scope, heeftAdres, kiesAdres, bewaarInCookie, dagModus],
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
    return vasteStand({ laatsteVolleMaand: volle, partieel, dataTot, uitgeslotenBronnen });
  }, [heeftStand, volle, dataTot, pMaand, pTmDag, pDagen, uitSleutel]);

  const waarde = useMemo<PeriodState>(
    () => periodeWaarde(keuzeInVorm, stand, set, dagModus ? { events, setDag } : undefined),
    [keuzeInVorm, set, stand, dagModus, events, setDag],
  );

  return <PeriodContext.Provider value={waarde}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodState {
  return useContext(PeriodContext) ?? standaardPeriode();
}
