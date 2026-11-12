"use client";

// De hoofdgrafiek van het Overzicht in de nieuwe weergave (bouwplan fase 3): de conversies per
// maand van de gekozen periode, gestapeld per kanaal, met de CPA als lijn.
//
// WAAROM HIER, DIRECT ONDER DE CIJFERS. De tegels zeggen hoeveel; deze grafiek zegt wanneer en
// door wie. Hij staat op dezelfde maandreeksen en dezelfde periode als de tegels en de
// kanaalkaarten (grafiekMaanden in lib/overzicht/bovenkant.ts): de staven van alle maanden samen
// zijn het conversiecijfer in de eerste tegel, en op een gekozen kanaal dat van dat kanaal.
//
// TWEE ASSEN IN ÉÉN PLOT, EN WAAROM DAT HIER MAG. monthly-trend-chart.tsx heeft de dubbele as
// eruit gehaald, met reden: twee willekeurige schalen in één vlak suggereren een verband dat van
// de schaalkeuze afhangt. Hier is de lijn geen tweede grootheid ernaast maar een verhouding VAN de
// staven (kosten gedeeld door precies deze conversies), en de vraag is juist of de prijs meebeweegt
// met het volume. De maatregelen tegen het misverstand: de rechteras draagt de kleur van de lijn,
// de lijn heeft punten en de staven niet, en de precieze waarden staan per maand in de tooltip en
// in de tabel voor schermlezers. De CPA-as begint niet op nul (asSchaalVenster): het is een
// verhouding, en vanaf nul werd elke beweging een rechte streep.

import { ResponsiveContainer, ComposedChart, Bar, Line } from "recharts";
import { useEffect, useRef } from "react";
import { LineChart } from "lucide-react";
import { useGrafiekBeweging } from "@/lib/beweging";
import { KANAAL_NAAM, KANAAL_KLEUR, ALLE_KANALEN, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHART_LINE_SECONDARY } from "@/lib/branding/chart-colors";
import { formatRange, formatRangeKort } from "@/lib/period/period-range";
import { usePeriod } from "@/lib/period/period-context";
import type { GrafiekMaand } from "@/lib/overzicht/bovenkant";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import {
  Raster, AsX, AsY, Tip, Legenda, GROEP_GAP, BALK_RADIUS,
  kortGetal, kortEuro, volledigEuro, volledigGetal, maandLabel, asSchaal, asSchaalVenster, balkBreedte, plotBreedte,
  type TipVoetRegel,
} from "./chart-chrome";

/** De naam van de lijn; ook de sleutel waarmee de tooltip hem uit de lijst met kanalen houdt. */
const CPA = "CPA";
/** De hoogte van de plot. Vast, ook tijdens het laden: de blokken eronder verspringen dan niet. */
const HOOGTE = "h-[180px] sm:h-[220px]";

const euroOfStreep = (v: number | null) => (v === null ? "—" : volledigEuro(v));

export function OverzichtHoofdgrafiek({ maanden, kanalen, gekozen, laden = false }: {
  /** De maanden van de gekozen periode (grafiekMaanden); null zolang de reeksen laden. */
  maanden: GrafiekMaand[] | null;
  /** De kanalen die getoond worden: alle kanalen van de klant, of het ene gekozen kanaal. */
  kanalen: readonly Kanaal[];
  /** Het gekozen kanaal, voor de kop; null op "Alle kanalen". */
  gekozen: Kanaal | null;
  laden?: boolean;
}) {
  const periode = usePeriod();
  const basisBeweging = useGrafiekBeweging();
  // Pas bewegen als de grafiek er al een keer stond. Dit component rendert eerst zijn laadvlak,
  // dus zonder deze rem groeiden de staven in zodra de reeksen binnenkwamen: beweging bij een
  // koude laad, zonder handeling.
  const stond = useRef(false);
  useEffect(() => { if (maanden) stond.current = true; });
  const beweging = { ...basisBeweging, isAnimationActive: basisBeweging.isAnimationActive && stond.current };
  const lijst = ALLE_KANALEN.filter((k) => kanalen.includes(k));

  const kop = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <LineChart className="h-4 w-4 text-brand-blue-ink" aria-hidden />
      <h3 className="text-title font-semibold text-brand-gray">
        Conversies per maand{gekozen ? ` · ${KANAAL_NAAM[gekozen]}` : ""}
      </h3>
      <Vensterlabel soort="periode" />
      <Legenda
        className="ml-auto"
        items={[...lijst.map((k) => ({ label: KANAAL_NAAM[k], kleur: KANAAL_KLEUR[k] })), { label: "CPA (rechteras)", kleur: CHART_LINE_SECONDARY }]}
      />
    </div>
  );
  const kaart = "rounded-xl border border-border bg-card px-4 pb-3 pt-3 shadow-sm";

  if (!maanden) {
    // Hetzelfde vlak op dezelfde hoogte, zodat de blokken eronder niet verspringen als de reeksen
    // binnenkomen. Zonder laden (een fout elders op de pagina) staat er niets.
    if (!laden) return null;
    return (
      <section aria-label="Conversies per maand" aria-busy="true" className={kaart}>
        <div className="h-5 w-56 max-w-full rounded bg-muted/70" aria-hidden />
        <div className={`mt-2 ${HOOGTE} rounded-lg bg-muted/40`} aria-hidden />
        <span className="sr-only">de grafiek wordt geladen</span>
      </section>
    );
  }

  const rijen = maanden.map((m) => ({
    maand: m.maand,
    ...Object.fromEntries(lijst.map((k) => [k, m.perKanaal[k]?.conversions ?? 0])),
    [CPA]: m.cpa,
  }));
  const perMaand = new Map(maanden.map((m) => [m.maand, m]));
  const hoogste = Math.max(0, ...maanden.map((m) => m.conversions));
  const cpas = maanden.map((m) => m.cpa).filter((v): v is number => v !== null);
  const schaal = asSchaal(hoogste);
  const schaalCpa = cpas.length > 0 ? asSchaalVenster(Math.min(...cpas), Math.max(...cpas)) : null;
  const leeg = maanden.every((m) => m.leeg);
  // Het bovenste kanaal dat in de stapel staat krijgt de ronde kop; de rest sluit recht aan.
  const bovenste = lijst[lijst.length - 1];

  // De regels onder de kanalen in de tooltip: het totaal van de maand (alleen als er meer dan één
  // kanaal gestapeld is, anders staat hetzelfde getal er twee keer) en de CPA.
  const voet = (maand: string): TipVoetRegel[] => {
    const m = perMaand.get(maand);
    if (!m) return [];
    return [
      ...(lijst.length > 1 ? [{ naam: "Totaal", waarde: volledigGetal(m.conversions), sterk: true }] : []),
      { naam: "Kosten", waarde: volledigEuro(m.adSpend) },
      { naam: CPA, waarde: euroOfStreep(m.cpa), kleur: CHART_LINE_SECONDARY },
    ];
  };

  // De som over de periode per kanaal, naast de plot: wat de staven samen zijn, en wat een
  // conversie per kanaal kostte. Uit dezelfde rijen als de plot, dus het telt op tot de eerste tegel.
  const totaal = maanden.reduce((t, m) => ({ conversions: t.conversions + m.conversions, adSpend: t.adSpend + m.adSpend }), { conversions: 0, adSpend: 0 });
  const perKanaal = lijst.map((k) => {
    const t = maanden.reduce((s, m) => ({ conversions: s.conversions + (m.perKanaal[k]?.conversions ?? 0), adSpend: s.adSpend + (m.perKanaal[k]?.adSpend ?? 0) }), { conversions: 0, adSpend: 0 });
    return { kanaal: k, ...t, cpa: t.conversions > 0 ? t.adSpend / t.conversions : null };
  });
  const totaalCpa = totaal.conversions > 0 ? totaal.adSpend / totaal.conversions : null;

  return (
    <section aria-label={`Conversies per maand, ${formatRange(periode.range)}`} className={kaart}>
      {kop}
      {leeg ? (
        <p className={`mt-2 flex ${HOOGTE} items-center justify-center rounded-lg bg-muted/30 text-meta text-muted-foreground`}>
          Geen data in {formatRange(periode.range)}.
        </p>
      ) : (
        <div className="mt-2 flex items-stretch gap-4">
          {/* De plot is zo breed als de data vraagt (plotBreedte) en niet breder: drie staven van
              vierentwintig pixels over elfhonderd pixels lezen als leegte. De pijltjestoetsen lopen
              de maanden langs (de toegankelijkheidslaag van recharts): focus op de grafiek, dan
              links en rechts, en de tooltip volgt. */}
          <div className={`min-w-0 flex-1 ${HOOGTE}`} style={{ maxWidth: plotBreedte(rijen.length) + 56 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rijen} margin={{ top: 10, right: 0, left: 0, bottom: 4 }} barCategoryGap={GROEP_GAP}>
                <Raster />
                <AsX dataKey="maand" formatter={maandLabel} />
                {/* De linkeras zonder eigen naam: het raster hangt aan de standaard-as van recharts. */}
                <AsY formatter={kortGetal} width={44} {...schaal} />
                {schaalCpa && <AsY id="cpa" rechts kleur={CHART_LINE_SECONDARY} formatter={kortEuro} width={52} domain={schaalCpa.domain} ticks={schaalCpa.ticks} />}
                <Tip
                  formatter={(v) => volledigGetal(v)}
                  verberg={[CPA]}
                  voet={voet}
                />
                {lijst.map((k) => (
                  <Bar
                    key={k}
                    {...beweging}
                    stackId="kanalen"
                    dataKey={k}
                    name={KANAAL_NAAM[k]}
                    fill={KANAAL_KLEUR[k]}
                    radius={k === bovenste ? BALK_RADIUS : undefined}
                    barSize={balkBreedte(rijen.length)}
                  />
                ))}
                {schaalCpa && (
                  <Line
                    {...beweging}
                    yAxisId="cpa"
                    dataKey={CPA}
                    name={CPA}
                    stroke={CHART_LINE_SECONDARY}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    dot={{ r: 3, strokeWidth: 0, fill: CHART_LINE_SECONDARY }}
                    activeDot={{ r: 4.5 }}
                    // Een maand zonder conversies heeft geen CPA: een gat, geen lijn eroverheen.
                    connectNulls={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {/* Wat de staven samen zijn, per kanaal, met de prijs per conversie. Alleen op een breed
              scherm: op een telefoon staan dezelfde totalen op de kanaalkaarten erboven. */}
          <div className="hidden w-64 shrink-0 self-center text-meta lg:block">
          {/* De kolomkoppen boven de cijfers, niet een zin eronder: zo staat bij elk getal wat het is. */}
          <div className="mb-1 grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-x-2 text-micro uppercase tracking-wider text-muted-foreground" aria-hidden>
            <span>{formatRangeKort(periode.range)}</span>
            <span className="text-right">conv.</span>
            <span className="text-right">CPA</span>
          </div>
          <dl className="grid gap-y-1.5">
            {perKanaal.map((r) => (
              <div key={r.kanaal} className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] items-baseline gap-x-2">
                <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: KANAAL_KLEUR[r.kanaal] }} aria-hidden />
                  <span className="truncate">{KANAAL_NAAM[r.kanaal]}</span>
                </dt>
                <dd className="text-right font-semibold tabular-nums text-brand-gray"><span className="sr-only">conversies: </span>{volledigGetal(Math.round(r.conversions))}</dd>
                <dd className="text-right tabular-nums text-muted-foreground" title="Kosten per conversie"><span className="sr-only">CPA: </span>{euroOfStreep(r.cpa === null ? null : Math.round(r.cpa))}</dd>
              </div>
            ))}
            {perKanaal.length > 1 && (
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] items-baseline gap-x-2 border-t border-border pt-1.5">
                <dt className="text-brand-gray">Totaal</dt>
                <dd className="text-right font-semibold tabular-nums text-brand-gray">{volledigGetal(Math.round(totaal.conversions))}</dd>
                <dd className="text-right tabular-nums text-muted-foreground" title="Kosten per conversie">{euroOfStreep(totaalCpa === null ? null : Math.round(totaalCpa))}</dd>
              </div>
            )}
          </dl>
          </div>
        </div>
      )}
      {/* Dezelfde cijfers als tabel, voor wie de grafiek niet ziet: per maand de kanalen, het
          totaal en de CPA. */}
      {/* In een div: sr-only op de tabel zelf houdt hem niet op 1 px (een tabel negeert width),
          en dan maakte hij de pagina op een telefoon 320 px te breed. */}
      <div className="sr-only"><table>
        <caption>Conversies per maand per kanaal, met het totaal en de CPA, over {formatRange(periode.range)}</caption>
        <thead>
          <tr>
            <th scope="col">Maand</th>
            {lijst.map((k) => <th key={k} scope="col">{KANAAL_NAAM[k]}</th>)}
            <th scope="col">Totaal</th>
            <th scope="col">CPA</th>
          </tr>
        </thead>
        <tbody>
          {maanden.map((m) => (
            <tr key={m.maand}>
              <th scope="row">{maandLabel(m.maand)}</th>
              {lijst.map((k) => <td key={k}>{volledigGetal(m.perKanaal[k]?.conversions ?? 0)}</td>)}
              <td>{volledigGetal(m.conversions)}</td>
              <td>{m.cpa === null ? "geen conversies" : volledigEuro(m.cpa)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
