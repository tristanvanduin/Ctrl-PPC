"use client";

import { ResponsiveContainer, ComposedChart, Line } from "recharts";
import { Raster, AsX, AsY, Tip, PLOT_MARGE, kortGetal, volledigGetal, asSchaalLijn } from "./chart-chrome";
import { CHART_AXIS } from "@/lib/branding/chart-colors";

// Fase 6, Task 1: de T-minus trendlijn. De x-as is GEEN kalenderdatum maar het aantal dagen tot
// het event (uit de curves die de route levert, zelf gebouwd op cumulativeCurve() in
// lib/fair/event-time-axis.ts, ongewijzigd). Twee edities op dezelfde as lopen daardoor synchroon:
// dag T-14 van deze editie staat recht onder dag T-14 van de vorige, ongeacht welke kalenderjaren
// het zijn.

export interface TminusPoint {
  daysToFair: number;
  value: number;
}

/** "T-14" voor edities voor het event, "T0" op de dag zelf, "T+3" erna. */
export function tminusLabel(v: number): string {
  if (v > 0) return `T-${v}`;
  if (v === 0) return "T0";
  return `T+${-v}`;
}

interface Row { daysToFair: number; label: string; huidig: number | null; vorig: number | null }

/** Voegt de twee curves samen tot één rijenreeks, op de unie van hun dagen-tot-event-punten,
 *  aflopend gesorteerd (ver voor het event eerst, het event zelf laatst). Los getest. */
export function mergeTminusRows(current: TminusPoint[], previous: TminusPoint[]): Row[] {
  const huidigPerDag = new Map(current.map((p) => [p.daysToFair, p.value]));
  const vorigPerDag = new Map(previous.map((p) => [p.daysToFair, p.value]));
  const dagen = [...new Set([...huidigPerDag.keys(), ...vorigPerDag.keys()])].sort((a, b) => b - a);
  return dagen.map((d) => ({
    daysToFair: d,
    label: tminusLabel(d),
    huidig: huidigPerDag.get(d) ?? null,
    vorig: vorigPerDag.get(d) ?? null,
  }));
}

export function EventTminusChart({
  title, subtitle, current, previous, previousLabel, valueFormatter = kortGetal, height = 200,
}: {
  title: string;
  subtitle?: string;
  current: TminusPoint[];
  previous: TminusPoint[];
  previousLabel: string;
  valueFormatter?: (v: number) => string;
  height?: number;
}) {
  const rows = mergeTminusRows(current, previous);
  if (rows.length < 2) {
    return (
      <div className="terminal rounded-lg border border-border bg-card p-4">
        <p className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-2 text-meta text-muted-foreground">Nog te weinig punten voor een trendlijn.</p>
      </div>
    );
  }

  const hoogsteWaarde = Math.max(0, ...rows.map((r) => r.huidig ?? 0), ...rows.map((r) => r.vorig ?? 0));
  const schaal = asSchaalLijn(hoogsteWaarde);

  return (
    <div className="terminal rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {subtitle && <span className="text-micro text-muted-foreground">{subtitle}</span>}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={PLOT_MARGE}>
            <Raster />
            <AsX dataKey="label" />
            <AsY formatter={valueFormatter} {...schaal} />
            <Tip formatter={volledigGetal} />
            {/* Vorige editie: gestippeld en gedempt, want dit is het referentiepunt, niet het
                verhaal. Huidige editie draagt het neon-indigo accent uit het Executive Terminal-
                thema: dat is de lijn die er nu toe doet. */}
            <Line
              dataKey="vorig"
              name={previousLabel}
              stroke={CHART_AXIS}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
            />
            <Line
              dataKey="huidig"
              name="Deze editie"
              stroke="var(--terminal-accent, var(--color-brand-blue-ink))"
              strokeWidth={2.5}
              strokeLinecap="round"
              dot={rows.length <= 16 ? { r: 3, strokeWidth: 0, fill: "var(--terminal-accent, var(--color-brand-blue-ink))" } : false}
              activeDot={{ r: 4.5 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
