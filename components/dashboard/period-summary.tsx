"use client";

// De cijfers van de gekozen periode, met de vergelijking ernaast.
//
// Dit is de plek waar de periodekeuze zichtbaar effect heeft: verander de periode en deze
// getallen veranderen mee. Alles komt uit data die de pagina al geladen heeft — er gaat geen
// query overheen — dus het werkt in demo-modus precies zoals met echte data.

import type { ReactNode } from "react";
import { TrendingDown, TrendingUp, Minus, TriangleAlert } from "lucide-react";
import type { ClientHistoricalData } from "@/lib/types";
import { usePeriod } from "@/lib/period/period-context";
import { comparePeriods, type PeriodDelta } from "@/lib/period/apply-period";
import { formatRange, formatMonth } from "@/lib/period/period-range";
import { formatDeltaPercent, formatRoas } from "@/lib/forecast-format";

function euro(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function aantal(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
}

// Voor kosten is een stijging niet automatisch goed; daarom bepaalt de aanroeper de richting.
function Delta({ d, hogerIsBeter = true }: { d: PeriodDelta; hogerIsBeter?: boolean }) {
  if (d.pct === null) {
    // Van niets naar iets is geen percentage. Een "+100%" of "+∞" tonen zou een precisie
    // suggereren die er niet is.
    return (
      <span className="text-micro text-muted-foreground">
        {d.vorig === 0 && d.huidig > 0 ? "nieuw in deze periode" : "geen vergelijking mogelijk"}
      </span>
    );
  }
  const vlak = Math.abs(d.pct) < 0.5;
  const goed = hogerIsBeter ? d.pct > 0 : d.pct < 0;
  const kleur = vlak ? "text-muted-foreground" : goed ? "text-green-600" : "text-red-600";
  const Icoon = vlak ? Minus : d.pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`flex items-center gap-1 text-micro ${kleur}`}>
      <Icoon className="h-3 w-3" />
      {formatDeltaPercent(d.pct)}
    </span>
  );
}

/**
 * Eén cijfer uit de band: label, getal, en eronder de verandering.
 *
 * `tabular-nums` en een strakke letterafstand horen bij deze maat. Cijfers op 30 pixels vallen
 * zonder die twee uit elkaar — de spatie tussen een 1 en een 4 wordt dan een gat — en juist bij
 * een getal dat de kop van de pagina draagt valt dat op.
 */
function Cijfer({ label, waarde, children }: { label: string; waarde: string; children?: ReactNode }) {
  return (
    <div>
      <p className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-figure font-semibold leading-none tracking-tight text-rm-gray tabular-nums">{waarde}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

interface Props {
  data: ClientHistoricalData | null;
  /** Toon een compactere variant zonder kop, voor binnen een bestaand kaartje. */
  compact?: boolean;
}

export function PeriodSummary({ data, compact }: Props) {
  const periode = usePeriod();
  if (!data) return null;

  const { current, previous, deltas } = comparePeriods(data, periode.range, periode.compareRange);

  const kaarten = [
    { label: "Conversies", waarde: aantal(current.totals.conversions), d: deltas?.conversions, hogerIsBeter: true },
    { label: "Omzet", waarde: euro(current.totals.revenue), d: deltas?.revenue, hogerIsBeter: true },
    { label: "Advertentiekosten", waarde: euro(current.totals.adSpend), d: deltas?.adSpend, hogerIsBeter: false },
  ];

  const roas = current.totals.adSpend > 0 ? current.totals.revenue / current.totals.adSpend : null;
  const cpa = current.totals.conversions > 0 ? current.totals.adSpend / current.totals.conversions : null;

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5 shadow-sm">
      {!compact && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-rm-blue-ink">
            {formatRange(periode.range)}
          </h3>
          {periode.compareRange && (
            <p className="text-micro text-muted-foreground">
              vergeleken met {formatRange(periode.compareRange)}
            </p>
          )}
        </div>
      )}

      {/* De cijferband. Dit is de kop van elke pagina, en hij stond in dezelfde maat als de rest:
          18 pixels tussen honderden regels van 10 tot 13. Dan is er geen kop — dan is er alleen
          tekst, en moet de lezer zelf uitzoeken waar hij moet kijken.

          De verhoudingen die het doen: het cijfer groot en met strakke letterafstand (grote cijfers
          vallen anders uit elkaar), het label klein en in kapitalen erbóven zodat je het leest
          vóór het getal, en de verandering eronder als aparte regel in plaats van ernaast — een
          percentage naast een bedrag concurreert met dat bedrag. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {kaarten.map((k) => (
          <Cijfer key={k.label} label={k.label} waarde={k.waarde}>
            {k.d && <Delta d={k.d} hogerIsBeter={k.hogerIsBeter} />}
          </Cijfer>
        ))}
        <Cijfer label="ROAS" waarde={roas === null ? "—" : formatRoas(roas)} />
        {/* Geen conversies betekent geen CPA; een bedrag tonen zou een prijs per conversie
            suggereren die niet bestaat. */}
        <Cijfer label="CPA" waarde={cpa === null ? "—" : euro(cpa)} />
      </div>

      {current.missing.length > 0 && (
        // Ontbrekende maanden melden in plaats van een kortere reeks stilzwijgend doorgeven:
        // anders lees je een totaal over vier maanden als een totaal over zes.
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-micro text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {current.missing.length === 1
            ? `Voor ${formatMonth(current.missing[0])} is geen data geladen; dat totaal ontbreekt hierboven.`
            : `Voor ${current.missing.length} maanden is geen data geladen (${formatMonth(current.missing[0], true)} t/m ${formatMonth(current.missing[current.missing.length - 1], true)}); die tellen hierboven niet mee.`}
        </p>
      )}
    </div>
  );
}
