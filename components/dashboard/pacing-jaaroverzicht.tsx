"use client";

// "Pacing & jaaroverzicht" in de nieuwe weergave (bouwplan fase 5): één kaart voor de vraag "hoe
// gaat het jaar", met de lade "Verloop en prognose" in de voet.
//
// WAT HIER SAMENKOMT. Vier blokken van het Overzicht gingen over hetzelfde kalenderjaar: Pacing
// (dit jaar tegen vorig jaar, het tempo), de vier kaarten van het Jaaroverzicht, de grafiek
// "Performance" en het budgetadvies in die grafiek. Samen ruim duizend pixels, met twee
// eindstanden voor één jaar. Nu één tabel met per metriek een rij (de regels staan in
// lib/overzicht/pacing-jaar.ts), het budgetadvies erboven als het doel achterloopt, en de grafiek
// met de onderbouwing van de vergelijking in de lade.
//
// NIETS IS WEG, en dat is na te lopen:
//   gerealiseerd, jaardoel, prognose, verschil met het doel    de kolommen van de tabel
//   de voortgangsbalk met "verwacht t/m <maand>"                de kolom Voortgang
//   dit jaar tegen vorig jaar, in procenten                     de kolom "tegen vorig jaar"
//   de twee absolute bedragen achter dat percentage             de lade, onder de grafiek
//   het tempo per maand                                         de voetregel ("gemiddeld per maand")
//   "op dit tempo" maal twaalf                                  de lade, bij naam genoemd
//   de voetregel van de pacing (wat viel buiten de vergelijking) de lade
//   de grafiek met week, maand, vorig jaar en de metriekkeuze   de lade
//   het budgetadvies                                            boven de tabel, niet achter een klik
//   het voorbehoud "som over de kanalen: een bovengrens"        de voetregel
//
// De oude voetnoot "er staat voor deze kanalen geen jaardoel in het systeem" staat er niet meer
// los: hij werd op dezelfde pagina tegengesproken door het jaaroverzicht, dat wel een (geschat)
// jaardoel toonde. In de plaats staat waar het jaardoel vandaan komt.

import { useState } from "react";
import { Zap } from "lucide-react";
import type { ClientHistoricalData } from "@/lib/types";
import { MONTH_LABELS, computeForecast, type ClientForecast, type ForecastMetric } from "@/lib/forecast";
import { formatCurrency, formatDeltaPercent, formatNumber, formatterFor } from "@/lib/forecast-format";
import { formatMonth, formatRange } from "@/lib/period/period-range";
import { doelHerkomstZin, gemiddeldPerMaand, pacingJaarRijen, verschilTekst, type PacingJaarRij } from "@/lib/overzicht/pacing-jaar";
import type { BlendedKanaalReeks } from "@/lib/api/blended-historical";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { Lade } from "@/components/ui/disclosure";
import { useBlendedPacing, type PacingDataStand } from "./blended-pacing";
import { BudgetAdvies, PerformanceChartView } from "./performance-chart";
import { useKanaalData } from "./channel-data-provider";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { Laadvlak } from "@/components/ui/laadvlak";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";

const formaat = (rij: PacingJaarRij): ((v: number) => string) =>
  rij.sleutel === "adSpend" ? formatCurrency : formatterFor(rij.sleutel);
const ofStreep = (v: number | null, f: (v: number) => string) => (v === null ? "—" : f(v));

export function PacingJaaroverzicht({ data, forecast, perKanaal = null, dataStand = null, metric, onMetricChange, uitgesloten = null, kanaalNaam, titelToevoeging }: {
  /** De blended historie en de prognose erop: dezelfde twee als het jaaroverzicht altijd las. */
  data: ClientHistoricalData;
  forecast: ClientForecast;
  /** De maandreeksen per kanaal en de stand van de route, voor de vergelijking met vorig jaar. */
  perKanaal?: readonly BlendedKanaalReeks[] | null;
  dataStand?: PacingDataStand;
  /** De metriek van de grafiek in de lade. */
  metric: ForecastMetric;
  onMetricChange: (m: ForecastMetric) => void;
  /** De zin over een kanaal dat na zijn laatste dag als nul meetelt, of null. */
  uitgesloten?: string | null;
  /**
   * De naam van het ene kanaal waar dit blok over gaat ("Meta Ads"), op een kanaaltabblad. Dan
   * zonder de kolom "tegen vorig jaar" (de gepaarde vergelijking bestaat alleen over alle kanalen
   * samen; een kolom vol streepjes zegt niets) en zonder het voorbehoud van de optelling: één
   * kanaal is geen som. Weglaten = alle kanalen samen.
   */
  kanaalNaam?: string;
  /** Achter het jaar in de kop, voor het landfilter van Google: "Duitsland". */
  titelToevoeging?: string;
}) {
  const pacing = useBlendedPacing(kanaalNaam === undefined ? perKanaal : null, dataStand);
  const c = pacing?.cijfers ?? null;
  const rijen = pacingJaarRijen(forecast, c ? { convRatio: c.convRatio, spendRatio: c.spendRatio } : null);
  const laatste = rijen[0]?.laatsteMaand ?? -1;
  const tm = laatste >= 0 ? `t/m ${MONTH_LABELS[laatste].toLowerCase()}` : "gerealiseerd";
  const metVorigJaar = kanaalNaam === undefined;
  // Eén geheugen voor de lade op alle tabbladen: wie "Verloop en prognose" op Alle kanalen opent,
  // wil hem op Google ook open zien. Het is dezelfde vraag over een ander kanaal.
  const ladeId = "pacing-verloop";
  const convPerMaand = c ? gemiddeldPerMaand(c.conv, c.maanden) : null;
  const spendPerMaand = c ? gemiddeldPerMaand(c.spend, c.maanden) : null;
  const geenPaar = !c || c.vergeleken.length === 0;

  return (
    <section aria-label={`Pacing en jaaroverzicht ${data.currentYear}${kanaalNaam ? `, ${kanaalNaam}` : ""}`} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 pb-4 pt-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Zap className="h-4 w-4 text-brand-blue-ink" aria-hidden />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-blue-ink">Pacing &amp; jaaroverzicht {data.currentYear}{titelToevoeging ? ` — ${titelToevoeging}` : ""}</h3>
          <Vensterlabel soort="jaar" jaar={data.currentYear} />
          <span className="ml-auto text-micro text-muted-foreground">{kanaalNaam ?? "alle kanalen samen"} · {tm}</span>
        </div>

        {/* Een signaal dat om actie vraagt staat in de kaart, niet in de lade. */}
        <BudgetAdvies forecast={forecast} className="mb-3" />

        {/* Zes kolommen passen niet op een telefoon: de tabel schuift dan binnen zijn eigen vak in
            plaats van de pagina breder te maken. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-body">
            <thead>
              <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Metriek</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">{tm}</th>
                {metVorigJaar && <th scope="col" className="px-3 py-1.5 text-right font-semibold" title={c ? `${formatRange(c.periode)} tegen ${formatRange(c.vergelijking)}, per kanaal gepaard` : undefined}>tegen vorig jaar</th>}
                {/* Neutraal: de kolom draagt het conversiedoel én het omzetdoel, en die kunnen een
                    verschillende herkomst hebben. Welke ingevoerd is en welke geschat, zegt de voetregel. */}
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">jaardoel</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">prognose</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">vs doel</th>
                <th scope="col" className="py-1.5 pl-3 font-semibold">voortgang</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((rij) => {
                const f = formaat(rij);
                const vj = verschilTekst(rij.tegenVorigJaar);
                const kleur = rij.gunstig === null ? "text-muted-foreground" : rij.gunstig ? "text-green-700" : "text-red-700";
                return (
                  <tr key={rij.sleutel} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold text-brand-gray">{rij.label}</th>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-gray">{ofStreep(rij.ytd, f)}</td>
                    {/* Grijs en zonder oordeel: meer of minder dan vorig jaar is een feit, geen doel.
                        Voor een verhouding (ROAS, CPA) heeft de pacing geen paren: dan een streepje. */}
                    {metVorigJaar && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{vj ?? "—"}</td>}
                    <td className="px-3 py-2 text-right tabular-nums text-brand-gray">{ofStreep(rij.doel, f)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-blue-ink">{ofStreep(rij.prognose, f)}</td>
                    {/* relative: het sr-only woord blijft dan in zijn cel als de tabel opzij schuift. */}
                    <td className={`relative px-3 py-2 text-right font-semibold tabular-nums ${kleur}`}>
                      {rij.vsDoelPct === null ? "—" : (
                        <>
                          {formatDeltaPercent(rij.vsDoelPct)}
                          <span className="sr-only"> {rij.gunstig ? "gunstig" : "ongunstig"}</span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pl-3">
                      {rij.voortgangPct === null ? <span className="text-muted-foreground">—</span> : <Voortgang rij={rij} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-meta leading-snug text-muted-foreground">
          {convPerMaand !== null && spendPerMaand !== null && c && (
            <>Gemiddeld per maand: {formatNumber(convPerMaand)} conversies en {formatCurrency(spendPerMaand)} kosten over {c.maanden} {c.maanden === 1 ? "maand" : "maanden"}. </>
          )}
          {/* Waar het doel vandaan komt, in plaats van een voetnoot die zegt dat er geen is. */}
          {doelHerkomstZin(forecast, rijen.map((r) => r.sleutel))}
          {" "}Kosten hebben geen doel en dus geen oordeel.
          {metVorigJaar && " De conversies zijn de som over de kanalen, elk met zijn eigen attributievenster: een bovengrens, geen exacte telling."}
          {uitgesloten && ` ${uitgesloten}`}
        </p>
      </div>

      <Lade id={ladeId} label="Verloop en prognose" labelOpen="Verberg verloop en prognose">
        <PerformanceChartView clientData={data} forecast={forecast} metric={metric} onMetricChange={onMetricChange} inLade />
        {c && pacing && (
          <div className="border-t border-border px-5 py-4">
            <h4 className="text-meta font-semibold uppercase tracking-wider text-muted-foreground">
              De vergelijking met vorig jaar · jaar tot en met {formatMonth(c.totMaand)}
            </h4>
            {/* De twee bedragen achter het percentage in de tabel: dezelfde kanalen aan beide
                kanten, dus niet het jaartotaal uit de kolom hierboven als een kanaal later begon. */}
            <dl className="mt-2 grid gap-x-6 gap-y-2 text-body sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Kosten, gelijk-voor-gelijk</dt>
                <dd className="tabular-nums text-brand-gray">
                  {geenPaar ? "geen vergelijking" : <><span className="font-semibold">{formatCurrency(c.gepaard.huidig.adSpend)}</span> tegen {formatCurrency(c.gepaard.vorig.adSpend)} ({verschilTekst(c.spendRatio) ?? "—"})</>}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Conversies, gelijk-voor-gelijk</dt>
                <dd className="tabular-nums text-brand-gray">
                  {geenPaar ? "geen vergelijking" : <><span className="font-semibold">{formatNumber(c.gepaard.huidig.conversions)}</span> tegen {formatNumber(c.gepaard.vorig.conversions)} ({verschilTekst(c.convRatio) ?? "—"})</>}
                </dd>
              </div>
              {convPerMaand !== null && spendPerMaand !== null && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Recht doorgetrokken (het gemiddelde per maand maal twaalf, zonder seizoen)</dt>
                  <dd className="tabular-nums text-brand-gray">
                    {formatNumber(convPerMaand * 12)} conversies en {formatCurrency(spendPerMaand * 12)} kosten. De prognose in de tabel rekent met het seizoen en de weektrend en is de eindstand om op te sturen.
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-meta leading-snug text-muted-foreground">{pacing.voetregel}</p>
          </div>
        )}
      </Lade>
    </section>
  );
}

/** Gerealiseerd als deel van het jaardoel, met de streep waar het seizoen je nu verwacht. */
function Voortgang({ rij }: { rij: PacingJaarRij }) {
  const pct = rij.voortgangPct ?? 0;
  const verwacht = rij.verwachtPct === null ? null : Math.min(Math.max(rij.verwachtPct, 0), 100);
  const tekst = `${Math.round(pct)}% van het doel${rij.verwachtPct !== null ? `, verwacht ${Math.round(rij.verwachtPct)}%` : ""}`;
  return (
    <div className="flex min-w-[9rem] items-center gap-2" title={tekst}>
      <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div className={`h-full rounded-full ${rij.gunstig === false ? "bg-red-400" : "bg-green-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        {verwacht !== null && <div className="absolute bottom-0 top-0 w-px bg-brand-blue/50" style={{ left: `${verwacht}%` }} />}
      </div>
      <span className="shrink-0 whitespace-nowrap text-micro tabular-nums text-muted-foreground">
        {Math.round(pct)}%{rij.verwachtPct !== null && <> · verwacht {Math.round(rij.verwachtPct)}%</>}
      </span>
    </div>
  );
}

/**
 * De Google-ingang, voor het Google-tabblad in de nieuwe weergave: dezelfde historie (met het
 * landfilter) en dezelfde prognose uit de provider als MetricCards en PerformanceChart, die dit
 * blok daar vervangt. Geen eigen verzoek.
 */
export function PacingJaaroverzichtGoogle({ clientId, countryFilter, titelToevoeging }: {
  clientId: string;
  countryFilter?: string | null;
  titelToevoeging?: string;
}) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const [metric, setMetric] = useState<ForecastMetric>("conversions");
  return (
    <PacingJaaroverzicht
      data={data}
      forecast={gedeeld ?? computeForecast(data)}
      metric={metric}
      onMetricChange={setMetric}
      kanaalNaam={KANAAL_NAAM.google}
      titelToevoeging={titelToevoeging}
    />
  );
}

/**
 * De ingang voor Meta, LinkedIn en Microsoft in de nieuwe weergave: de historie en de prognose van
 * het kanaal uit ChannelDataProvider, dezelfde twee als ChannelForecastOverview (de vier kaarten en
 * "Prognose per maand") die dit blok daar vervangt.
 */
export function PacingJaaroverzichtKanaal({ kanaal }: { kanaal: Kanaal }) {
  const { forecast: gebouwd } = useKanaalData();
  const [metric, setMetric] = useState<ForecastMetric>("conversions");
  if (gebouwd === null) return <Laadvlak vorm="grafiek" hoogte={220} titel="Pacing en jaaroverzicht" />;
  if (gebouwd === "leeg") return null; // geen dagcijfers gesynced: niets te tonen, zoals het jaaroverzicht van het kanaal
  return (
    <PacingJaaroverzicht
      data={gebouwd.data}
      forecast={gebouwd.forecast}
      metric={metric}
      onMetricChange={setMetric}
      kanaalNaam={KANAAL_NAAM[kanaal]}
    />
  );
}
