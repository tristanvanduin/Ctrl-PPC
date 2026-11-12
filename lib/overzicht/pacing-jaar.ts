// De rijen van het blok "Pacing & jaaroverzicht" in de nieuwe weergave (bouwplan fase 5).
//
// WAAROM ÉÉN BLOK. Het Overzicht had twee blokken over hetzelfde kalenderjaar: "Pacing" (dit jaar
// tegen vorig jaar, het tempo per maand, en dat tempo maal twaalf) en het "Jaaroverzicht" (vier
// kaarten met gerealiseerd, jaardoel en prognose), honderden pixels uit elkaar. Samen gaven ze twee
// eindstanden voor één jaar: de prognose van het jaaroverzicht en "op dit tempo" van de pacing,
// naast elkaar zonder dat een van beide zei waarom ze verschilden. Hier staat per metriek één rij
// met alles wat de twee blokken wisten: gerealiseerd, tegen vorig jaar, jaardoel, prognose en het
// verschil met het doel. Eén eindstand per jaar: de prognose. Het rechte tempo maal twaalf staat
// nog in de lade, bij naam genoemd als wat het is.
//
// GEEN TWEEDE BEREKENING. De cijfers komen uit jaarKaartCijfers (dezelfde functie als de kaarten
// die dit blok vervangt) en uit de vergelijking van de pacing (gelijk-voor-gelijk per kanaal). Dit
// bestand zet ze alleen naast elkaar, en beslist wat er NIET mag staan: een oordeel zonder doel,
// een vergelijking voor een verhouding waar de pacing geen paren voor heeft.
//
// Zuiver en zonder React, zodat de regels te toetsen zijn (lib/__overzicht_onderin_test.ts).

import { actieveMetrics, jaarKaartCijfers, type ClientForecast, type ForecastMetric } from "@/lib/forecast";
import { isLowerBetter, METRIC_LABELS } from "@/lib/forecast-format";
import { safeDiv } from "@/lib/util/math";
import { jaardoelTekst } from "@/lib/analysis/standaard-jaardoel";

/** De vergelijking met vorig jaar zoals de pacing hem kent: per kanaal gepaard, of null zonder paar. */
export interface VorigJaar {
  convRatio: number | null;
  spendRatio: number | null;
}

export type PacingJaarSleutel = ForecastMetric | "adSpend";

export interface PacingJaarRij {
  sleutel: PacingJaarSleutel;
  label: string;
  /** Gerealiseerd t/m de laatste gerealiseerde maand; null voor een verhouding zonder noemer. */
  ytd: number | null;
  /**
   * Dit jaar gedeeld door vorig jaar, gelijk-voor-gelijk. null = geen vergelijking: de pacing heeft
   * er alleen een voor conversies en kosten, en ook die alleen als een kanaal vorig jaar al liep.
   */
  tegenVorigJaar: number | null;
  /** Het jaardoel; null als er geen doel is (nul telt niet als doel). */
  doel: number | null;
  /** De jaarprognose; null voor een verhouding zonder noemer. */
  prognose: number | null;
  /** De prognose tegen het doel, in procenten; null zonder doel of zonder prognose. */
  vsDoelPct: number | null;
  /** Of dat verschil gunstig is; null als er geen oordeel te vellen valt. */
  gunstig: boolean | null;
  /** Gerealiseerd als percentage van het doel, en waar het seizoen je nu verwacht; null voor
   *  verhoudingen en zonder doel. */
  voortgangPct: number | null;
  verwachtPct: number | null;
  /** De index (0 tot 11) van de laatste gerealiseerde maand, of -1. */
  laatsteMaand: number;
}

/**
 * De rijen, in de volgorde van de kaarten die ze vervangen, met Kosten erbij.
 *
 * Kosten krijgt geen doel en dus geen oordeel: de prognose kent een jaarbedrag aan kosten, maar dat
 * is afgeleid van het conversiedoel en geen budget dat iemand heeft ingesteld. "Meer uitgegeven
 * dan het doel" in rood zou een oordeel zijn over een getal dat niemand gekozen heeft. De kosten
 * staan er om de CPA en de ROAS te kunnen plaatsen, in grijs.
 */
/**
 * De metriek die de grafiek in de lade toont: de gekozen metriek, of de eerste actieve als de
 * gekozen metriek voor deze klant niet actief is. Dezelfde klem als het jaaroverzicht van een
 * kanaal altijd had (ChannelForecastOverview): een kanaal met alleen een omzet- of ROAS-doel heeft
 * geen knop "Conversies", en opende toch op de conversiereeks.
 */
export function zichtbareMetriek(forecast: ClientForecast, gekozen: ForecastMetric): ForecastMetric {
  const actief = actieveMetrics(forecast);
  return actief.includes(gekozen) ? gekozen : actief[0] ?? gekozen;
}

export function pacingJaarRijen(forecast: ClientForecast, vorigJaar: VorigJaar | null): PacingJaarRij[] {
  const rijen: PacingJaarRij[] = actieveMetrics(forecast).map((metric) => {
    const c = jaarKaartCijfers(forecast, metric);
    const heeftDoel = c.annualTarget > 0;
    const vsDoelPct = heeftDoel && c.adjusted !== null ? c.diffPct : null;
    return {
      sleutel: metric,
      label: METRIC_LABELS[metric],
      ytd: c.realized,
      tegenVorigJaar: metric === "conversions" ? vorigJaar?.convRatio ?? null : null,
      doel: heeftDoel ? c.annualTarget : null,
      prognose: c.adjusted,
      vsDoelPct,
      gunstig: vsDoelPct === null ? null : isLowerBetter(metric) ? vsDoelPct <= 0 : vsDoelPct >= 0,
      voortgangPct: heeftDoel ? c.realizedPct : null,
      verwachtPct: heeftDoel ? c.verwachtPct : null,
      laatsteMaand: c.laatsteMaand,
    };
  });
  const kosten = forecast.adSpend.kpi;
  rijen.push({
    sleutel: "adSpend",
    label: "Kosten",
    ytd: kosten.ytdRealized,
    tegenVorigJaar: vorigJaar?.spendRatio ?? null,
    doel: null,
    prognose: kosten.adjustedAnnual,
    vsDoelPct: null,
    gunstig: null,
    voortgangPct: null,
    verwachtPct: null,
    laatsteMaand: Math.max(-1, kosten.realizedThroughMonth - 1),
  });
  return rijen;
}

/** "+73%" of "−12%": een verhouding als verschil in hele procenten. null blijft null. */
export function verschilTekst(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = Math.round((ratio - 1) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

/**
 * Het gemiddelde per maand over de gemeten maanden, voor de voetregel. null zonder maanden: een
 * gemiddelde over nul maanden is geen nul.
 */
export function gemiddeldPerMaand(totaal: number, maanden: number): number | null {
  return safeDiv(totaal, maanden);
}

/**
 * Waar de doelen in de kolom "jaardoel" vandaan komen, als één zin voor de voetregel.
 *
 * De kolom draagt het doel van elke rij: conversies en CPA hangen aan het conversiedoel, omzet en
 * ROAS aan het omzetdoel. Die twee hebben elk een eigen herkomst. Hier stond één zin op basis van
 * het conversiedoel alleen, en dan stond er "Het jaardoel komt uit Instellingen" boven een geschat
 * omzetdoel (of "een schatting" boven een ingevoerd doel). Zijn ze gelijk, dan één zin; verschillen
 * ze, dan per doel benoemd. Het omzetdoel telt alleen mee als er een rij is die erop leunt.
 */
export function doelHerkomstZin(forecast: ClientForecast, sleutels: readonly PacingJaarSleutel[]): string {
  const metOmzet = sleutels.includes("revenue") || sleutels.includes("roas");
  const metConversies = sleutels.includes("conversions") || sleutels.includes("cpa");
  const conv = jaardoelTekst(forecast.doelHerkomst?.conversions);
  const omzet = jaardoelTekst(forecast.doelHerkomst?.revenue, { metric: "revenue" });
  const tussenHaakjes = (t: { toelichting: string | null }) => (t.toelichting ? ` (${t.toelichting})` : "");
  const los = (naam: string, t: typeof conv) =>
    t.ingevoerd ? `het ${naam} komt uit Instellingen${tussenHaakjes(t)}` : `het ${naam} is een schatting${tussenHaakjes(t)}`;
  const hoofdletter = (z: string) => z.charAt(0).toUpperCase() + z.slice(1);
  if (metOmzet && metConversies && (conv.ingevoerd !== omzet.ingevoerd || conv.toelichting !== omzet.toelichting)) {
    return `${hoofdletter(los("conversiedoel", conv))}; ${los("omzetdoel", omzet)}.`;
  }
  const enige = metConversies || !metOmzet ? conv : omzet;
  return enige.ingevoerd
    ? `Het jaardoel komt uit Instellingen${tussenHaakjes(enige)}.`
    : `Geen jaardoel ingevoerd: de kolom toont een schatting${tussenHaakjes(enige)}.`;
}
