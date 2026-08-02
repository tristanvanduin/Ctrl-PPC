"use client";

// De cijfers van de gekozen periode, met de vergelijking ernaast.
//
// Dit is de plek waar de periodekeuze zichtbaar effect heeft: verander de periode en deze
// getallen veranderen mee. Alles komt uit data die de pagina al geladen heeft — er gaat geen
// query overheen — dus het werkt in demo-modus precies zoals met echte data.

import { TriangleAlert } from "lucide-react";
import type { ClientHistoricalData } from "@/lib/types";
import { usePeriod } from "@/lib/period/period-context";
import { comparePeriods } from "@/lib/period/apply-period";
import { formatRange, formatMonth } from "@/lib/period/period-range";
import { formatRoas } from "@/lib/forecast-format";
import { Kerncijfer } from "@/components/ui/kerncijfer";

function euro(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function aantal(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
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

  // De maanden van deze periode, oud naar nieuw. `current.months` bevat alleen de maanden die er
  // werkelijk zijn (ontbrekende staan in `current.missing`), dus de lijn loopt niet dwars over een
  // gat heen alsof daar gemeten is.
  const reeks = (kies: (m: (typeof current.months)[number]) => number): (number | null)[] =>
    current.months.map((m) => {
      const v = kies(m);
      return Number.isFinite(v) ? v : null;
    });
  /** Idem, maar de keuze mag `null` teruggeven als de verhouding voor die maand niet bestaat. */
  const reeksVerhouding = (kies: (m: (typeof current.months)[number]) => number | null): (number | null)[] =>
    current.months.map((m) => {
      const v = kies(m);
      return v != null && Number.isFinite(v) ? v : null;
    });

  const kaarten = [
    { label: "Conversies", waarde: aantal(current.totals.conversions), d: deltas?.conversions, hogerIsBeter: true,
      reeks: reeks((m) => m.conversions || 0) },
    { label: "Omzet", waarde: euro(current.totals.revenue), d: deltas?.revenue, hogerIsBeter: true,
      reeks: reeks((m) => m.revenue || 0) },
    { label: "Advertentiekosten", waarde: euro(current.totals.adSpend), d: deltas?.adSpend, hogerIsBeter: false,
      reeks: reeks((m) => m.adSpend || 0) },
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
          <Kerncijfer
            key={k.label}
            label={k.label}
            waarde={k.waarde}
            reeks={k.reeks}
            reeksLabel={`${k.label} per maand binnen ${formatRange(periode.range)}`}
            delta={k.d ? {
              pct: k.d.pct,
              hogerIsBeter: k.hogerIsBeter,
              // Van niets naar iets is geen percentage; "+100%" zou een precisie suggereren die
              // er niet is.
              leegTekst: k.d.vorig === 0 && k.d.huidig > 0 ? "nieuw in deze periode" : undefined,
            } : undefined}
          />
        ))}
        {/* ROAS en CPA zijn verhoudingen en geen volumes, dus hun lijn loopt op het eigen bereik:
            vanaf nul zou een ROAS die tussen 1,4 en 1,7 beweegt een kaarsrechte streep worden en
            precies de beweging verbergen waarvoor je naar een ROAS kijkt. Een maand zonder spend of
            zonder conversies levert geen verhouding op — dat wordt een gat in de lijn en geen nul,
            want nul zou "verdiende niets" betekenen in plaats van "niet te berekenen". */}
        <Kerncijfer
          label="ROAS"
          waarde={roas === null ? "—" : formatRoas(roas)}
          reeks={reeksVerhouding((m) => (m.adSpend > 0 ? m.revenue / m.adSpend : null))}
          reeksLabel={`ROAS per maand binnen ${formatRange(periode.range)}`}
          reeksBasis="bereik"
        />
        {/* Geen conversies betekent geen CPA; een bedrag tonen zou een prijs per conversie
            suggereren die niet bestaat. */}
        <Kerncijfer
          label="CPA"
          waarde={cpa === null ? "—" : euro(cpa)}
          reeks={reeksVerhouding((m) => (m.conversions > 0 ? m.adSpend / m.conversions : null))}
          reeksLabel={`CPA per maand binnen ${formatRange(periode.range)}`}
          reeksBasis="bereik"
        />
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
