"use client";

import { useMemo, useState } from "react";

// Donut voor een part-to-whole-verdeling. Handgeschreven SVG in plaats van een chart-library:
// de segmentscheiding moet een écht gat in de achtergrondkleur zijn (geen rand om het segment),
// en dat is met een eigen pad exact te sturen.
//
// Bewust een donut en geen taart: het gat draagt het totaal, en de ring leest bij kleine
// segmenten beter dan een punt die in het middelpunt samenknijpt. Een donut is alleen geschikt
// voor de verhouding-op-het-oog met een handvol segmenten — precieze vergelijking hoort in de
// cijfers ernaast, en die staan er daarom altijd bij.

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

const SIZE = 180;
const R_OUTER = 84;
const R_INNER = 52;
const CENTER = SIZE / 2;
// Scheiding tussen segmenten: een gat in de achtergrond, geen lijn om het segment heen.
const GAP_PX = 2;

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** Ringsegment tussen twee hoeken (radialen, 0 = 3 uur; we starten bovenaan). */
function arcPath(startAngle: number, endAngle: number): string {
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const o0 = polar(CENTER, CENTER, R_OUTER, a0);
  const o1 = polar(CENTER, CENTER, R_OUTER, a1);
  const i1 = polar(CENTER, CENTER, R_INNER, a1);
  const i0 = polar(CENTER, CENTER, R_INNER, a0);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${i0.x} ${i0.y}`,
    "Z",
  ].join(" ");
}

export interface DonutChartProps {
  slices: DonutSlice[];
  /** Groot cijfer in het gat. */
  centerValue: string;
  /** Klein bijschrift onder het centrale cijfer. */
  centerLabel: string;
  /** Formatter voor de tooltip-waarde. */
  format: (v: number) => string;
  /** Toegankelijke omschrijving van wat de ring toont. */
  ariaLabel: string;
}

export function DonutChart({ slices, centerValue, centerLabel, format, ariaLabel }: DonutChartProps) {
  const [hover, setHover] = useState<string | null>(null);

  const total = useMemo(() => slices.reduce((s, x) => s + Math.max(0, x.value), 0), [slices]);

  const arcs = useMemo(() => {
    if (total <= 0) return [];
    // Het gat wordt in hoek uitgedrukt zodat het op elke straal 2px breed oogt.
    const gapAngle = GAP_PX / R_OUTER;
    const positive = slices.filter((s) => s.value > 0);
    let angle = 0;
    return positive.map((s) => {
      const span = (s.value / total) * Math.PI * 2;
      // Bij één segment zou een gat een zichtbare knip in een volle ring maken.
      const useGap = positive.length > 1;
      const start = angle + (useGap ? gapAngle / 2 : 0);
      const end = angle + span - (useGap ? gapAngle / 2 : 0);
      angle += span;
      return { ...s, d: arcPath(start, Math.max(start, end)), share: s.value / total };
    });
  }, [slices, total]);

  if (total <= 0) return null;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
        {arcs.map((a) => {
          const dim = hover !== null && hover !== a.key;
          return (
            <path
              key={a.key}
              d={a.d}
              fill={a.color}
              style={{ opacity: dim ? 0.35 : 1, transition: "opacity 120ms", cursor: "default" }}
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {/* Het gat draagt het totaal, of de waarde van het segment waar de muis op staat. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
        {hover ? (
          (() => {
            const a = arcs.find((x) => x.key === hover);
            if (!a) return null;
            return (
              <>
                <div className="text-lead font-bold text-brand-gray leading-tight">{format(a.value)}</div>
                <div className="text-micro text-muted-foreground leading-tight">{a.label}</div>
                <div className="text-micro font-medium text-brand-gray leading-tight">
                  {new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(a.share)}
                </div>
              </>
            );
          })()
        ) : (
          <>
            <div className="text-lead font-bold text-brand-gray leading-tight">{centerValue}</div>
            <div className="text-micro text-muted-foreground leading-tight">{centerLabel}</div>
          </>
        )}
      </div>
    </div>
  );
}
