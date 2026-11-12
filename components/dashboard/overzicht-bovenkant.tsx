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

import { memo, useEffect, useMemo, useState, type AnimationEvent } from "react";
import type { ClientHistoricalData } from "@/lib/types";
import type { BlendedClientDataState } from "@/lib/use-blended-client-data";
import type { ChannelPeriodData } from "@/lib/use-channel-period-data";
import { ALLE_KANALEN, zichtbareTabs, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { usePeriod } from "@/lib/period/period-context";
import { bandDataStand } from "@/lib/period/band-stand";
import { grafiekMaanden, kaartCijfers, kaartStand } from "@/lib/overzicht/bovenkant";
import { opbouwVertraging, useEersteOpbouw } from "@/lib/beweging";
import { heeftGecachteInstellingen, loadClientSettings } from "@/lib/client-settings";
import { INSTELLINGEN_WACHT_MS } from "@/lib/client-data-provider";
import { mergeKpiTargets } from "@/lib/kpi-target-merge";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore } from "@/lib/health-score";
import { today } from "@/lib/reporting-date";
import { kanaalScores } from "./kanaal-health-ranking";
import { Kanaalkaarten, KAARTENRIJ_HOOGTE, type KaartHealth, type Kanaalkaart } from "./kanaalkaarten";
import { PeriodSummary } from "./period-summary";
import { OverzichtHoofdgrafiek } from "./overzicht-hoofdgrafiek";
import { OverzichtLogboek } from "./overzicht-logboek";

/**
 * De health van Google voor de kaart: dezelfde score als in de ranking "Account Health per kanaal".
 *
 * De ranking leest de prognose uit ClientDataProvider; dit blok staat daarbuiten. Daarom dezelfde
 * stappen op dezelfde invoer: de Google-data met de KPI-doelen van de klant erin (mergeKpiTargets),
 * de prognose, en de score zonder de Google-specifieke hygiëne (die de vergelijking tussen kanalen
 * scheef trekt). En pas NA het lezen van de instellingen: met de standaarddoelen kwam er eerst een
 * ander cijfer te staan dan de ranking eronder toont, dat daarna versprong.
 *
 * `herlees` is een waarde die verandert als de instellingen opnieuw gelezen horen te worden (een
 * nieuwe ophaalronde van de blended route, na het opslaan van een doel).
 */
function useGoogleHealth(clientId: string, googleData: ClientHistoricalData | null, aan: boolean, herlees: unknown): { health: HealthScore | null; laadt: boolean } {
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
  const health = useMemo(() => {
    if (!aan || !googleData || !klaar) return null;
    return zonderKanaalSpecifiekeHygiene(computeHealthScore(computeForecast(mergeKpiTargets(clientId, googleData))));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- herlees: mergeKpiTargets leest de instellingen zelf
  }, [aan, googleData, klaar, clientId, herlees]);
  return { health, laadt: aan && (!googleData || !klaar) };
}

function OverzichtBovenkantRuw({ clientId, channel, kanalen, onKies, onBeoordeel, googleData, route, band, bandKlaar, demo, reserveerKaarten = false }: {
  clientId: string;
  /** Wat er getoond wordt: een kanaal, of "blended" voor alle kanalen. */
  channel: Kanaalkeuze;
  /** De kanalen van de klant; null zolang ze nog niet bekend zijn. */
  kanalen: readonly Kanaal[] | null;
  /** Zet het kanaal (in de adresbalk, via het klantdashboard). */
  onKies: (keuze: Kanaalkeuze) => void;
  /** Naar het tabblad Bevindingen: daar wordt beslist, het logboek wijst er alleen naar. */
  onBeoordeel: () => void;
  googleData: ClientHistoricalData | null;
  /** De blended route: de health per dagkanaal, en de stand van de bronnen. */
  route: Pick<BlendedClientDataState, "perKanaalTab" | "dataStand" | "loading" | "error">;
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
}) {
  const periode = usePeriod();
  const lijst = useMemo(() => ALLE_KANALEN.filter((k) => (kanalen ?? []).includes(k)), [kanalen]);
  const toonKaarten = zichtbareTabs(lijst).length > 0;
  const google = useGoogleHealth(clientId, googleData, lijst.includes("google"), route.perKanaalTab);

  // De opbouw van het eerste bezoek begint pas als de cijfers er staan; een laadvlak bouwt niet op.
  const inhoudKlaar = bandKlaar && band.data !== null;
  const { speel, klaar } = useEersteOpbouw(inhoudKlaar);

  const cijfers = useMemo(
    () => (bandKlaar ? kaartCijfers(band.perKanaal, lijst, periode.range) : null),
    [bandKlaar, band.perKanaal, lijst, periode.range],
  );
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
    return {
      kanaal,
      cijfers: cijfers?.find((c) => c.kanaal === kanaal) ?? null,
      health,
      stand: kaartStand({
        dataTot: stand?.dataTot, vandaag, demo,
        achterMaarSyncDraait: bron?.syncDraait === true,
        bekend: kanaal === "google" ? googleData !== null : band.klaar[kanaal],
      }),
    };
  }), [lijst, scores, google.laadt, route.error, route.dataStand, googleStand, googleData, band.laatsteDag, band.klaar, cijfers, vandaag, demo]);

  // De grafiek toont wat de tegels tellen: alle kanalen, of het ene gekozen kanaal.
  const gekozen = channel === "blended" ? null : channel;
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
      <div className={speel ? "opbouw" : undefined} style={stap(voor)}>
        <PeriodSummary data={bandKlaar ? band.data : null} bronnen={band.bronnen} laden={!bandKlaar} vorm="tegels" />
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
