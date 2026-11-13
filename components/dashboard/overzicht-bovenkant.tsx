"use client";

// De bovenkant van het Overzicht in de NIEUWE weergave (bouwplan fase 3): kanaalkaarten als filter,
// de kerncijfers als tegels, en de hoofdgrafiek er direct onder. Staat achter de schakelaar "Nieuwe
// weergave" (lib/weergave.ts); met de schakelaar uit rendert client-dashboard.tsx de kanaaltabs en
// de band zoals altijd, en bestaat dit bestand voor de pagina niet.
//
// WAT HIER WEL EN NIET GEBEURT. Dit component haalt niets op en telt niets op. Het krijgt wat het
// klantdashboard al heeft (de Google-data, de blended route, de maandreeksen van de band) en geeft
// het door aan drie blokken die allemaal op dezelfde reeksen en dezelfde periode staan. Een
// kanaal- of periodewissel is dus puur rekenwerk in de browser: geen verzoek, zoals fase 1 heeft
// vastgelegd. Net als de band staat het BUITEN de datapoort van ClientDataProvider: het eerste
// cijfer wacht op de routes, niet op de instellingen.
//
// Fase 4 zet het logboek "Wat er gebeurde" naast de grafiek (overzicht-logboek.tsx). Dat is het
// enige blok hier dat zelf iets ophaalt: één verzoek bij het laden, niets bij een wissel.
//
// EEN PERIODE PER DAG (stap 3 van het periodemodel). Kiest de gebruiker een event, vrije datums of
// een vergelijking die maanden niet kunnen, dan rekenen de tegels en de kaarten via
// telDagVergelijking (lib/period/use-dag-telling.ts). Die haalt één keer per klant de dagrijen en de
// Google-weekrijen op, bij de eerste zo'n keuze; daarna is elke wissel weer rekenwerk. Hele maanden
// met een maandvergelijking lopen over het bestaande pad, en tonen dus exact dezelfde cijfers. De
// grafiek telt altijd per maand, en zijn vensterlabel zegt dan welke maanden.

import { memo, useEffect, useMemo, useState, type AnimationEvent } from "react";
import type { ClientHistoricalData } from "@/lib/types";
import type { BlendedClientDataState } from "@/lib/use-blended-client-data";
import type { ChannelPeriodData } from "@/lib/use-channel-period-data";
import { ALLE_KANALEN, zichtbareTabs, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { usePeriod } from "@/lib/period/period-context";
import { bandDataStand } from "@/lib/period/band-stand";
import { grafiekMaanden, kaartCijfers, kaartCijfersUitDagen, kaartDagRegel, kaartStand, kanaalTotalen } from "@/lib/overzicht/bovenkant";
import {
  bijdragePerKanaal, kanaalParenUitDagen, kanaalParenUitMaanden, statusRegel, tellersOver, tellersPerMaand, trechter,
  type KanaalStand, type Tellers,
} from "@/lib/overzicht/trechter";
import { comparePeriods } from "@/lib/period/apply-period";
import { formatRange, monthsIn, type Month } from "@/lib/period/period-range";
import { alsMaandPeriode, formatDagPeriode, uitMaandPeriode, type DagPeriode } from "@/lib/period/dag-periode";
import { ketenNaDeKlik, naDeKlikPerStap, telKanaalStappen } from "@/lib/overzicht/conversiestappen";
import { useConversiestappen } from "@/lib/overzicht/use-conversiestappen";
import { useDagTelling } from "@/lib/period/use-dag-telling";
import { opbouwVertraging, useEersteOpbouw } from "@/lib/beweging";
import { heeftGecachteInstellingen, loadClientSettings } from "@/lib/client-settings";
import { INSTELLINGEN_WACHT_MS } from "@/lib/client-data-provider";
import { mergeKpiTargetsVoorReeks } from "@/lib/kpi-target-merge";
import { jaardoelBereik } from "@/lib/doel/jaardoel";
import { computeForecast } from "@/lib/forecast";
import { googleHealthScore, type GoogleHealthInvoer, type HealthScore } from "@/lib/health-score";
import { today } from "@/lib/reporting-date";
import { kanaalScores } from "./kanaal-health-ranking";
import { Kanaalkaarten, KAARTENRIJ_HOOGTE, type KaartHealth, type Kanaalkaart } from "./kanaalkaarten";
import { PeriodSummary } from "./period-summary";
import { DagKerncijfers } from "./dag-kerncijfers";
import { BandUitZaad, type BandZaad } from "./band-uit-zaad";
import { OverzichtHoofdgrafiek } from "./overzicht-hoofdgrafiek";
import { OverzichtLogboek } from "./overzicht-logboek";
import { BijdragePerKanaal, KanaalTrechter, StatusRegel, type TrechterVenster } from "./overzicht-trechter";
import { KanaalNaDeKlik, NaDeKlikPerKanaal } from "./overzicht-na-de-klik";

/**
 * De health van Google voor de kaart: dezelfde score als in de ranking "Account Health per kanaal".
 *
 * De ranking leest de prognose uit ClientDataProvider; dit blok staat daarbuiten. Daarom dezelfde
 * stappen op dezelfde invoer: de Google-data met de KPI-doelen van de klant erin (mergeKpiTargets),
 * de prognose, en googleHealthScore met de verspillingsdata van dezelfde Google-route. En pas NA het lezen van de instellingen: met de standaarddoelen kwam er eerst een
 * ander cijfer te staan dan de ranking eronder toont, dat daarna versprong.
 *
 * `herlees` is een waarde die verandert als de instellingen opnieuw gelezen horen te worden (een
 * nieuwe ophaalronde van de blended route, na het opslaan van een doel).
 */
function useGoogleHealth(clientId: string, googleData: ClientHistoricalData | null, googleStaat: GoogleHealthInvoer | null | undefined, aan: boolean, herlees: unknown, kanalen: readonly Kanaal[] | null): { health: HealthScore | null; laadt: boolean } {
  const [instellingenVoor, setInstellingenVoor] = useState<string | null>(null);
  useEffect(() => {
    if (!aan) return;
    let weg = false;
    // Dezelfde grens als de provider: een verzoek dat blijft hangen houdt de ring niet eeuwig op "…".
    const opgegeven = setTimeout(() => { if (!weg) setInstellingenVoor(clientId); }, INSTELLINGEN_WACHT_MS);
    loadClientSettings(clientId).catch(() => null).finally(() => {
      clearTimeout(opgegeven);
      if (!weg) setInstellingenVoor(clientId);
    });
    return () => { weg = true; clearTimeout(opgegeven); };
  }, [clientId, aan]);
  const klaar = instellingenVoor === clientId || heeftGecachteInstellingen(clientId);
  // Dezelfde invoer als de ranking en het tabblad (googleHealthScore): met de verspillingsdata.
  // Die komt als prop van het klantdashboard en niet uit useClientDataState: dit blok staat buiten
  // ClientDataProvider, daar geeft die hook null, en dan stond Hygiëne hier op "niet beoordeeld"
  // terwijl de ranking direct eronder hem wel meetelde (57 tegen 66 op dezelfde pagina).
  const health = useMemo(() => {
    if (!aan || !googleData || !klaar) return null;
    // Met dezelfde regel voor het jaardoel als de provider (lib/doel/jaardoel.ts), anders zou de
    // kaart Google tegen het accountdoel zetten en het tabblad eronder niet. En met dezelfde
    // verspillingsdata als de ranking (googleStaat), anders gaf de kaart een ander getal.
    return googleHealthScore(computeForecast(
      mergeKpiTargetsVoorReeks(clientId, googleData, "google", jaardoelBereik(kanalen))), googleStaat);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- herlees: mergeKpiTargets leest de instellingen zelf
  }, [aan, googleData, googleStaat, klaar, clientId, herlees, kanalen]);
  return { health, laadt: aan && (!googleData || !klaar) };
}

function OverzichtBovenkantRuw({ clientId, channel, kanalen, onKies, onBeoordeel, onNaarInstellingen, googleData, googleStaat, route, band, bandKlaar, demo, reserveerKaarten = false, bandZaad = null }: {
  clientId: string;
  /** Wat er getoond wordt: een kanaal, of "blended" voor alle kanalen. */
  channel: Kanaalkeuze;
  /** De kanalen van de klant; null zolang ze nog niet bekend zijn. */
  kanalen: readonly Kanaal[] | null;
  /** Zet het kanaal (in de adresbalk, via het klantdashboard). */
  onKies: (keuze: Kanaalkeuze) => void;
  /** Naar het tabblad Bevindingen: daar wordt beslist, het logboek wijst er alleen naar. */
  onBeoordeel: () => void;
  /** Naar de instellingen, waar de conversietrechter staat: voor een blok zonder stappen na de klik. */
  onNaarInstellingen?: () => void;
  googleData: ClientHistoricalData | null;
  /**
   * De verspillingsdata en de accountstructuur van de Google-route (useClientData), voor Hygiëne in
   * de health van Google. Hetzelfde object dat de ranking uit de provider leest.
   */
  googleStaat?: GoogleHealthInvoer | null;
  /** De blended route: de health per dagkanaal, en de stand van de bronnen. */
  route: Pick<BlendedClientDataState, "perKanaal" | "perKanaalTab" | "dataStand" | "loading" | "error">;
  /** De maandreeksen van de band (useChannelPeriodData), voor het gekozen kanaal en per kanaal. */
  band: ChannelPeriodData;
  /** De stand van het gekozen kanaal is bekend: pas dan cijfers en een periode (zie bandKlaar). */
  bandKlaar: boolean;
  /** Demodata: de kaarten noemen de stand dan "demodata" en kleuren hem nooit rood. */
  demo: boolean;
  /**
   * De kanalen zijn nog onbekend en deze klant had de vorige keer meer dan één kanaal: houd de
   * hoogte van de kaartenrij vrij. Zonder dat verschijnt de rij ná de tegels en duwt hij die omlaag
   * (dezelfde reden als de gereserveerde kanaalbalk in de vertrouwde weergave).
   */
  reserveerKaarten?: boolean;
  /**
   * De kerncijfers die de server al uit het zaad rekende (band-uit-zaad.tsx): die staan in de
   * tegels zolang de band laadt. Null: het laadvlak, zoals altijd.
   */
  bandZaad?: BandZaad | null;
}) {
  const periode = usePeriod();
  const lijst = useMemo(() => ALLE_KANALEN.filter((k) => (kanalen ?? []).includes(k)), [kanalen]);
  const toonKaarten = zichtbareTabs(lijst).length > 0;
  const google = useGoogleHealth(clientId, googleData, googleStaat, lijst.includes("google"), route.perKanaalTab, kanalen);

  // De opbouw van het eerste bezoek begint pas als de cijfers er staan; een laadvlak bouwt niet op.
  // En niet als het dashboard bij de eerste render zaad aanbood (bandZaad): dan stonden de
  // cijfers al in de HTML, vóór het script, en een opbouw zou ze laten verdwijnen en opnieuw
  // binnenkomen. Dat wordt HIER bepaald, bij de eerste render, en niet in een effect binnen de
  // Suspense-grens van het zaad: duurt de stroom van de server langer dan het script (een live
  // klant wacht op de Google Ads API), dan kan de hook eerder klaar zijn dan de grens hydrateert, en
  // vervangt de echte band de grens zonder dat zijn effect ooit loopt. Dan speelde de opbouw over
  // cijfers die er al stonden. De prijs: bood het dashboard zaad aan dat niets bruikbaars droeg (een
  // fout van een route), dan komen de cijfers na het laadvlak binnen zonder opbouw. Een gemiste
  // versiering, geen ander getal. Per klant, zoals het zaad zelf.
  const [zaadVoorKlant] = useState(() => (bandZaad ? clientId : null));
  const zaadAangeboden = zaadVoorKlant === clientId;
  const inhoudKlaar = bandKlaar && band.data !== null;
  const { speel, klaar } = useEersteOpbouw(inhoudKlaar && !zaadAangeboden);

  // De grafiek en de tegels tonen alle kanalen of het ene gekozen kanaal.
  const gekozen = channel === "blended" ? null : channel;
  // Een periode per dag die maanden niet kunnen: de tegels en de kaarten uit de telling per dag.
  const dagPad = !!periode.dag && !periode.dag.maandPad;
  // De vertoningen en klikken per kanaal per maand, uit de blended route: de eerste twee stappen van
  // de trechter. De band kent ze niet (lib/overzicht/trechter.ts).
  const tellersPerKanaal = useMemo(() => {
    const uit: Partial<Record<Kanaal, Map<Month, Tellers> | null>> = {};
    for (const r of route.perKanaal ?? []) uit[r.kanaal] = tellersPerMaand(r.maanden);
    return uit;
  }, [route.perKanaal]);
  const dagTelling = useDagTelling({
    clientId, staat: dagPad ? periode.dag : null, kanalen: lijst, gekozen, googleData,
    googleTellers: tellersPerKanaal.google ?? null,
  });
  const cijfers = useMemo(() => {
    if (!bandKlaar) return null;
    if (!dagPad) return kaartCijfers(band.perKanaal, lijst, periode.range);
    const alle = dagTelling.alle;
    const t = alle ? (alle.vergelijking?.huidig ?? alle.alleen) : null;
    return t ? kaartCijfersUitDagen(t.perKanaal, lijst) : null;
  }, [bandKlaar, band.perKanaal, lijst, periode.range, dagPad, dagTelling.alle]);
  // Dezelfde toewijzing als de ranking eronder: de health van een dagkanaal is het object uit
  // perKanaalTab, die van Google de score hierboven.
  const scores = useMemo(
    () => kanaalScores(lijst, google.health, { perKanaalTab: route.perKanaalTab, loading: route.loading }),
    [lijst, google.health, route.perKanaalTab, route.loading],
  );
  const vandaag = today();
  const googleStand = googleData?.dataStand;
  const kaarten = useMemo((): Kanaalkaart[] => lijst.map((kanaal) => {
    const rij = scores.rijen.find((r) => r.kanaal === kanaal);
    const laadt = kanaal === "google" ? google.laadt : scores.laden.includes(kanaal);
    const health: KaartHealth = rij ? { soort: "score", health: rij.health }
      : laadt ? { soort: "laden" }
      : { soort: "geen", reden: kanaal === "google" ? "niet beoordeeld: geen Google-cijfers geladen"
        : route.error ? "niet beoordeeld: de kanaalcijfers konden niet geladen worden"
        : "niet beoordeeld: geen dagcijfers om een prognose op te bouwen" };
    // De stand van dit kanaal zoals zijn eigen tabblad hem zou tonen (bandDataStand per kanaal).
    const stand = bandDataStand({ channel: kanaal, kanalen: lijst, google: googleStand, laatsteDag: band.laatsteDag, route: route.dataStand });
    const bron = route.dataStand?.bronnen?.find((b) => b.bron === kanaal);
    const alle = dagPad ? dagTelling.alle : null;
    return {
      kanaal,
      cijfers: cijfers?.find((c) => c.kanaal === kanaal) ?? null,
      dag: alle ? kaartDagRegel(
        (alle.vergelijking?.huidig ?? alle.alleen)?.perKanaal.find((t) => t.kanaal === kanaal) ?? null,
        alle.vergelijking?.perKanaal.find((v) => v.kanaal === kanaal) ?? null,
        alle.vergelijking !== null,
      ) : null,
      health,
      stand: kaartStand({
        dataTot: stand?.dataTot, vandaag, demo,
        achterMaarSyncDraait: bron?.syncDraait === true,
        bekend: kanaal === "google" ? googleData !== null : band.klaar[kanaal],
      }),
    };
  }), [lijst, scores, google.laadt, route.error, route.dataStand, googleStand, googleData, band.laatsteDag, band.klaar, cijfers, vandaag, demo, dagPad, dagTelling.alle]);

  // ── De trechter: hoe gaat het, en waar zit het (lib/overzicht/trechter.ts) ──
  // Het venster zoals de tegels het noemen: per dag de dagen, anders de maanden.
  const vergelijkDag = dagPad && periode.dag && periode.dag.keuze.vergelijk !== "none" ? periode.dag.vergelijking.periode : null;
  const overDag = dagPad && periode.dag ? formatDagPeriode(periode.dag.periode) : null;
  const tegenDag = vergelijkDag ? formatDagPeriode(vergelijkDag) : null;
  const venster = useMemo((): TrechterVenster => overDag !== null
    ? { over: overDag, tegen: tegenDag }
    : { over: formatRange(periode.range), tegen: periode.compareRange ? formatRange(periode.compareRange) : null },
  [overDag, tegenDag, periode.range, periode.compareRange]);
  // De statusregel uit DEZELFDE cijfers als de tegels eronder: comparePeriods op de band, of de
  // telling per dag van wat getoond wordt.
  const status = useMemo((): string | null => {
    if (!bandKlaar) return null;
    if (dagPad) {
      const g = dagTelling.getoond;
      const t = g ? (g.vergelijking?.huidig ?? g.alleen) : null;
      if (!g || !t) return null;
      return statusRegel({ totalen: t.totaal, deltas: g.vergelijking?.deltas ?? null, tegen: g.vergelijking ? formatDagPeriode(g.vergelijking.vergelijking) : null });
    }
    if (!band.data) return null;
    const { current, deltas } = comparePeriods(band.data, periode.range, periode.compareRange, band.bronnen ?? undefined);
    return statusRegel({ totalen: current.totals, deltas: deltas ?? null, tegen: periode.compareRange ? formatRange(periode.compareRange) : null });
  }, [bandKlaar, dagPad, dagTelling.getoond, band.data, band.bronnen, periode.range, periode.compareRange]);
  // Per kanaal wat in de vergelijking zit: per maand gepaardeTotalen op de bronnen van de band, per
  // dag de telling. Null zolang er niets te paren valt of de cijfers laden.
  const paren = useMemo(() => {
    if (!bandKlaar) return null;
    if (dagPad) {
      const v = dagTelling.alle?.vergelijking ?? null;
      return v ? kanaalParenUitDagen(v, lijst) : null;
    }
    if (lijst.some((k) => !band.perKanaal[k])) return null;
    return kanaalParenUitMaanden({ perKanaal: band.perKanaal, tellers: tellersPerKanaal, kanalen: lijst, periode: periode.range, vergelijking: periode.compareRange });
  }, [bandKlaar, dagPad, dagTelling.alle, lijst, band.perKanaal, tellersPerKanaal, periode.range, periode.compareRange]);
  // Op Alle kanalen met meer dan één kanaal: de bijdrage per kanaal. Op een gekozen kanaal, of bij een
  // klant met één kanaal, de trechter van dat kanaal: een bijdrage van één kanaal is altijd 100%.
  const trechterKanaal: Kanaal | null = gekozen ?? (lijst.length === 1 ? lijst[0] : null);
  const bijdrage = useMemo(
    () => (trechterKanaal || !cijfers ? null : bijdragePerKanaal(cijfers, paren)),
    [trechterKanaal, cijfers, paren],
  );
  const trechterStand = useMemo((): KanaalStand | null => {
    if (!trechterKanaal || !bandKlaar) return null;
    if (dagPad) {
      const alle = dagTelling.alle;
      const t = alle ? (alle.vergelijking?.huidig ?? alle.alleen)?.perKanaal.find((x) => x.kanaal === trechterKanaal) : null;
      return t ? { totalen: t.totalen, tellers: t.tellers } : null;
    }
    const bron = band.perKanaal[trechterKanaal];
    // Wacht op de route zolang die nog laadt: anders stond er eerst "niet bekend" bij de klikken.
    if (!bron || (route.perKanaal === null && route.loading)) return null;
    return { totalen: kanaalTotalen(bron, periode.range), tellers: tellersOver(tellersPerKanaal[trechterKanaal], monthsIn(periode.range)) };
  }, [trechterKanaal, bandKlaar, dagPad, dagTelling.alle, band.perKanaal, route.perKanaal, route.loading, tellersPerKanaal, periode.range]);
  const trechterVergelijk = trechterKanaal ? paren?.find((p) => p.kanaal === trechterKanaal) ?? null : null;
  // Het venster van de trechter op een dagperiode: wat het kanaal WERKELIJK telde. Google telt een
  // dagperiode per hele week of maand, en een kanaal dat later begon of nog niet bij is telt korter;
  // dan noemt de regel de getelde dagen en de gevraagde erbij (KanaalTelling.wijktAf en geteld).
  const trechterVenster = useMemo((): TrechterVenster => {
    const alle = dagTelling.alle;
    if (!dagPad || !trechterKanaal || !alle) return venster;
    const nu = (alle.vergelijking?.huidig ?? alle.alleen)?.perKanaal.find((x) => x.kanaal === trechterKanaal) ?? null;
    const toen = alle.vergelijking?.vorig.perKanaal.find((x) => x.kanaal === trechterKanaal) ?? null;
    const getelde = (t: typeof nu, standaard: string): string => {
      if (!t || !t.wijktAf) return standaard;
      return t.geteld
        ? `${formatDagPeriode(t.geteld)} (gevraagd: ${formatDagPeriode(t.gevraagd)})`
        : `${formatDagPeriode(t.gevraagd)}, waarin niets te tellen viel`;
    };
    return { over: getelde(nu, venster.over), tegen: venster.tegen === null ? null : getelde(toen, venster.tegen) };
  }, [dagPad, trechterKanaal, dagTelling.alle, venster]);
  // Op Alle kanalen op een dagperiode: telde niet elk kanaal precies deze dagen, dan zegt de regel dat.
  const bijdrageVenster = useMemo((): TrechterVenster => {
    const alle = dagTelling.alle;
    const t = alle ? (alle.vergelijking?.huidig ?? alle.alleen) : null;
    const gemengd = !!t?.gemengd || !!alle?.vergelijking?.vorig.gemengd;
    return dagPad && gemengd
      ? { ...venster, noot: "niet elk kanaal telde precies deze dagen; de uitleg onder de kerncijfers zegt per kanaal welke" }
      : venster;
  }, [dagPad, dagTelling.alle, venster]);
  // ── Na de klik: de stappen die de klant meet, per DAG over de gekozen periode
  // (lib/overzicht/conversiestappen.ts). Eén lezing per klant, daarna rekenwerk.
  const stapBron = useConversiestappen({ clientId, kanalen: lijst, aan: lijst.length > 0 });
  const stapVensters = useMemo((): { p: DagPeriode; v: DagPeriode | null } => periode.dag
    ? { p: periode.dag.periode, v: periode.dag.keuze.vergelijk !== "none" ? periode.dag.vergelijking.periode : null }
    : { p: uitMaandPeriode(periode.range), v: periode.compareRange ? uitMaandPeriode(periode.compareRange) : null },
  [periode.dag, periode.range, periode.compareRange]);
  const ketens = useMemo(() => {
    if (!stapBron) return null;
    // Google heeft geen klikken per dag in deze rijen: alleen over hele maanden zijn ze bekend.
    const googleKlikken = (p: DagPeriode) => {
      const m = alsMaandPeriode(p);
      return m ? tellersOver(tellersPerKanaal.google, monthsIn(m))?.clicks ?? null : null;
    };
    const { p, v } = stapVensters;
    return lijst.map((k) => ketenNaDeKlik(
      telKanaalStappen(k, p, stapBron.trechter, stapBron.rijen, googleKlikken(p)),
      v ? telKanaalStappen(k, v, stapBron.trechter, stapBron.rijen, googleKlikken(v)) : null,
    ));
  }, [stapBron, stapVensters, lijst, tellersPerKanaal]);
  const naDeKlik = useMemo(() => (ketens ? naDeKlikPerStap(ketens) : null), [ketens]);

  const trechterUitkomst = useMemo(
    () => (trechterStand ? trechter(trechterStand, trechterVergelijk?.paar ?? null) : null),
    [trechterStand, trechterVergelijk],
  );

  // Eén lijst per (gekozen, lijst): `gekozen ? [gekozen] : lijst` maakte bij een gekozen kanaal elke
  // render een nieuwe, en dan krijgt de grafiek elke render een andere prop.
  const grafiekKanalen = useMemo(() => (gekozen ? [gekozen] : lijst), [gekozen, lijst]);
  const maanden = useMemo(() => {
    const getoond = gekozen ? [gekozen] : lijst;
    if (!bandKlaar || getoond.length === 0 || getoond.some((k) => !band.perKanaal[k])) return null;
    return grafiekMaanden(band.perKanaal, getoond, periode.range);
  }, [bandKlaar, gekozen, lijst, band.perKanaal, periode.range]);

  // Geen reeksen en nog iets onderweg: het laadvlak op de hoogte van de grafiek. Een klant zonder
  // kanalen heeft niets om te tekenen en krijgt geen leeg vlak.
  const grafiekLaadt = maanden === null && (gekozen !== null || lijst.length > 0 || kanalen === null)
    && (!bandKlaar || (gekozen ? [gekozen] : lijst).some((k) => !band.perKanaal[k]));

  // De volgorde van de opbouw: de kaarten van links naar rechts, dan de tegels, dan de grafiek.
  const voor = toonKaarten ? kaarten.length : 0;
  const aantal = voor + 2;
  const stap = (i: number) => (speel ? { animationDelay: `${opbouwVertraging(i, aantal)}ms` } : undefined);
  // Het laatste blok staat stil: de opbouw is gespeeld. Alleen het einde van het blok zelf telt,
  // niet dat van iets erbinnen.
  const opEinde = (e: AnimationEvent<HTMLDivElement>) => { if (speel && e.target === e.currentTarget) klaar(); };

  return (
    <div className="flex flex-col gap-2">
      {toonKaarten ? (
        <Kanaalkaarten kaarten={kaarten} gekozen={channel} onKies={onKies} opbouw={speel} opbouwAantal={aantal} />
      ) : reserveerKaarten ? (
        <div className={`${KAARTENRIJ_HOOGTE} rounded-xl bg-muted/40`} aria-hidden />
      ) : null}
      {/* 1 HOE GAAT HET: de statusregel, dan de kerncijfers. 2 WAAR ZIT HET: de bijdrage per kanaal of
          de trechter van het kanaal. Daarna 3 WAAROM: de grafiek en het logboek, en onder deze bovenkant
          gezondheid en pacing. 4 WAT NU staat onderaan de pagina (overzicht-wat-nu.tsx). */}
      <div className={`space-y-2 ${speel ? "opbouw" : ""}`} style={stap(voor)}>
        {lijst.length > 0 && <StatusRegel tekst={status} />}
        {dagPad ? (
          <DagKerncijfers cijfers={bandKlaar ? dagTelling.getoond : null} laden={!bandKlaar || dagTelling.laden} />
        ) : (
          <PeriodSummary data={bandKlaar ? band.data : null} bronnen={band.bronnen} laden={!bandKlaar} vorm="tegels"
            zolangLaden={bandZaad && <BandUitZaad zaad={bandZaad} vorm="tegels" />} />
        )}
        {trechterKanaal ? (
          <KanaalTrechter kanaal={trechterKanaal} trechter={trechterUitkomst} uitleg={trechterVergelijk?.uitleg ?? null} venster={trechterVenster}>
            <KanaalNaDeKlik keten={ketens?.find((k) => k.kanaal === trechterKanaal) ?? null} venster={venster} onNaarInstellingen={onNaarInstellingen} />
          </KanaalTrechter>
        ) : lijst.length > 1 ? (
          <>
            <BijdragePerKanaal rijen={bijdrage} venster={bijdrageVenster} />
            <NaDeKlikPerKanaal uitkomst={naDeKlik} venster={venster} onNaarInstellingen={onNaarInstellingen} />
          </>
        ) : null}
      </div>
      {/* De grafiek en het logboek naast elkaar (8 en 4 van de 12 kolommen); op een telefoon onder
          elkaar met het logboek EERST: wat er gebeurde lees je voor je het verloop bekijkt.
          `items-start`: de twee kaarten rekken elkaar niet op, en het logboek heeft een eigen
          schuifvak, dus een regel die openklapt verschuift niets onder dit blok. Het logboek doet
          één verzoek bij het laden en geen bij een wissel van kanaal of periode; `herlees` is de
          ronde van de blended route (na een sync). */}
      <div className={`grid items-start gap-2 lg:grid-cols-12 ${speel ? "opbouw" : ""}`} style={stap(voor + 1)} onAnimationEnd={opEinde}>
        <div className="order-2 min-w-0 lg:order-1 lg:col-span-8">
          <OverzichtHoofdgrafiek maanden={maanden} kanalen={grafiekKanalen} gekozen={gekozen} laden={grafiekLaadt} />
        </div>
        <div className="order-1 min-w-0 lg:order-2 lg:col-span-4">
          <OverzichtLogboek clientId={clientId} channel={channel} kanalen={lijst} onKies={onKies} onBeoordeel={onBeoordeel} herlees={route.perKanaalTab} />
        </div>
      </div>
    </div>
  );
}

// In memo: een wissel van kanaal of periode rendert ClientDashboard twee keer (de dringende render
// van de klik, daarna die van Next op het gewijzigde adres). De tweede keer zijn de props dezelfde:
// de band is één object zolang zijn delen dat zijn (useChannelPeriodData), en onKies en onBeoordeel
// zijn vaste functies. Zonder memo rekende de hoofdgrafiek elke wissel twee keer.
export const OverzichtBovenkant = memo(OverzichtBovenkantRuw);
