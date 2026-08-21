"use client";

import { useMemo, useState } from "react";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
// world-atlas levert de landgeometrie als topojson (~110m resolutie).
import worldTopo from "world-atlas/countries-110m.json";
import { NUMERIC_TO_ALPHA2 } from "@/lib/geo/iso-numeric";
import { countryLabel } from "@/lib/countries";

// Interactieve choropleth-wereldkaart: kleurt elk land naar de gekozen metric en licht op met een
// tooltip bij hover. Puur SVG (d3-geo voor de projectie + paden), geen zware kaart-library — dus
// geen React-versieconflict.

const WIDTH = 760;
const HEIGHT = 380;
// Marge rond de landen-met-data bij het inzoomen, zodat een geselecteerd land niet tegen de
// kaartrand aan plakt en zijn buren nog net zichtbaar blijven voor context.
const ZOOM_PADDING = 32;

// Eénmalig: topojson → geojson. Dit deel verandert nooit, dus wél op module-niveau.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const topo = worldTopo as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collection = feature(topo, topo.objects.countries) as any;
const features = (collection.features ?? []) as Array<{ id?: string | number; properties?: { name?: string } }>;
interface Shape { key: string; alpha2: string | null; d: string }

// De projectie zelf verplaatste naar de component: ze moet inzoomen op de landen die data
// hebben (`values`) in plaats van altijd de hele wereld te tonen. Zonder data valt hij terug op
// de volledige wereld -- exact het oude gedrag.
function buildShapes(values: Map<string, number>): Shape[] {
  const actieveCodes = new Set([...values.keys()].filter((c) => Number.isFinite(values.get(c))));
  const actieveFeatures = actieveCodes.size > 0
    ? features.filter((f) => {
        const numeric = f.id != null ? String(Number(f.id)) : "";
        const alpha2 = NUMERIC_TO_ALPHA2[numeric];
        return alpha2 != null && actieveCodes.has(alpha2);
      })
    : [];
  const fitTarget: GeoPermissibleObjects = actieveFeatures.length > 0
    ? ({ type: "FeatureCollection", features: actieveFeatures } as unknown as GeoPermissibleObjects)
    : (collection as GeoPermissibleObjects);
  const projection = geoNaturalEarth1().fitExtent(
    [[ZOOM_PADDING, ZOOM_PADDING], [WIDTH - ZOOM_PADDING, HEIGHT - ZOOM_PADDING]],
    fitTarget,
  );
  const pathGen = geoPath(projection);
  return features.map((f, i) => {
    const numeric = f.id != null ? String(Number(f.id)) : "";
    return { key: `${numeric}-${i}`, alpha2: NUMERIC_TO_ALPHA2[numeric] ?? null, d: pathGen(f as GeoPermissibleObjects) ?? "" };
  });
}

// Sequentiële ramp op waarde-intensiteit; merk-onafhankelijk en leesbaar.
//
// De twee uiteinden staan als CSS-variabele en niet als vaste rgb, want een kaart die van
// bijna-wit naar donkerblauw loopt is op een donker canvas een lichtbak: in de eerste donkere
// schermafdruk was de wereldkaart een wit blok midden op de pagina. In het donker loopt de ramp
// juist andersom — van iets boven het vlak naar een heldere tint — en `color-mix` doet de
// interpolatie in de browser, zodat het omschakelen geen JavaScript kost.
function ramp(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  return `color-mix(in srgb, var(--kaart-hoog, #4f46e5) ${Math.round(f * 100)}%, var(--kaart-laag, #e6eef8))`;
}

export interface WorldMapProps {
  /** alpha-2 landcode → waarde van de gekozen metric. */
  values: Map<string, number>;
  /** formatter voor de tooltip-waarde. */
  format: (v: number) => string;
  /** label van de gekozen metric (voor de tooltip). */
  metricLabel: string;
  /** optioneel: klik op een land (bv. VS) om in te zoomen op de drilldown. */
  onCountryClick?: (alpha2: string) => void;
}

export default function WorldMap({ values, format, metricLabel, onCountryClick }: WorldMapProps) {
  const [hover, setHover] = useState<{ alpha2: string; x: number; y: number } | null>(null);

  const max = useMemo(() => Math.max(1, ...[...values.values()].map((v) => Math.abs(v))), [values]);
  const hoveredValue = hover ? values.get(hover.alpha2) : undefined;
  // Herberekend zodra de dataset verandert (niet bij elke render): zoomt in op de landen met
  // data. Nederland-alleen betekent dus niet langer een stipje op een wereldkaart, maar een
  // Nederland dat het beeld vult.
  const shapes = useMemo(() => buildShapes(values), [values]);

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label={`Wereldkaart: ${metricLabel} per land`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" onMouseMove={() => setHover(null)} />
        {shapes.map((s) => {
          const v = s.alpha2 ? values.get(s.alpha2) : undefined;
          const has = v != null && Number.isFinite(v);
          const isHover = !!hover && hover.alpha2 === s.alpha2;
          const clickable = has && !!s.alpha2 && !!onCountryClick;
          return (
            <path
              key={s.key}
              d={s.d}
              fill={has ? ramp(Math.abs(v as number) / max) : "var(--kaart-leeg, #eef1f6)"}
              stroke={isHover ? "var(--kaart-hover, #4f46e5)" : "var(--kaart-rand, #ffffff)"}
              strokeWidth={isHover ? 1.4 : 0.4}
              style={{ cursor: clickable ? "pointer" : "default", opacity: hover && !isHover ? 0.9 : 1, transition: "opacity 120ms" }}
              onClick={() => { if (clickable && s.alpha2) onCountryClick!(s.alpha2); }}
              onMouseMove={(e) => {
                // Ook zonder data een tooltip. Hoverde je een land waar niets voor gemeten is, dan
                // gebeurde er niets — en stilte is niet te onderscheiden van een kapotte kaart.
                // Nu zegt hij "geen data", wat een antwoord is in plaats van een raadsel.
                if (!s.alpha2) { setHover(null); return; }
                const box = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                if (!box) return;
                setHover({ alpha2: s.alpha2, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {/* De schaallegenda. Zonder deze codeert de kaart grootte met alleen kleur: je ziet dat het
          ene land donkerder is dan het andere, maar niet wat donker betekent — 100 conversies of
          10.000. De tabel eronder zou dat kunnen dragen, maar die staat dicht, en dan is kleur de
          enige drager van een continue schaal. Dat is precies wat een choropleth niet mag doen.

          Vandaar de ramp zelf als balk, met de twee uiteinden benoemd: nul links, het gemeten
          maximum rechts, in dezelfde eenheid als de kaart. */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <span className="text-micro text-muted-foreground tabular-nums">0</span>
        <span
          className="h-2 w-40 rounded-full"
          style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(0.5)}, ${ramp(1)})` }}
          aria-hidden
        />
        <span className="text-micro text-muted-foreground tabular-nums">{format(max)}</span>
        <span className="text-micro text-muted-foreground ml-1">{metricLabel.toLowerCase()} per land</span>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2.5 py-1.5 shadow-md text-meta"
          style={{ left: Math.min(hover.x + 12, WIDTH - 120), top: hover.y + 12 }}
        >
          <div className="font-semibold text-brand-gray">{countryLabel(hover.alpha2)}</div>
          <div className="text-muted-foreground">
            {metricLabel}:{" "}
            {hoveredValue != null && Number.isFinite(hoveredValue)
              ? <span className="font-medium text-brand-blue-ink tabular-nums">{format(hoveredValue)}</span>
              : <span className="italic">geen data voor dit land</span>}
          </div>
        </div>
      )}
    </div>
  );
}
