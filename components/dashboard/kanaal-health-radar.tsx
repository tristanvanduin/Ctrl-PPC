"use client";

import { useId } from "react";
import { radarPunten, radarRanden, radarVlak, WEBRINGEN, type RadarFactor } from "@/lib/health-radar";

// Een radar die MEER DAN EEN reeks aankan: dezelfde vijf assen, een polygoon per reeks.
//
// In de praktijk staat er één lijn in -- het gemiddelde over de kanalen (zie
// kanaal-health-ranking.tsx). Er hebben drie lijnen in gestaan, één per kanaal, en dat was
// leesbaar zolang ze uit elkaar lagen; bij vijf of tien kanalen wordt het een kluwen, en de
// cijfers per kanaal staan er toch al uitgesplitst naast. Het component blijft meervoudig omdat
// dat niets extra kost en de vergelijkingsvorm daarmee beschikbaar blijft.
//
// De geometrie komt uit lib/health-radar.ts, dezelfde die health-radar.tsx gebruikt -- niet omdat
// het toevallig past, maar omdat twee radars op hetzelfde scherm anders vroeg of laat een andere
// nulhoek of een andere schaal krijgen.

const ZIJDE = 220;
const MIDDEN = ZIJDE / 2;
const STRAAL = 72;
const LABEL_MARGE = 55;
const BREEDTE = ZIJDE + LABEL_MARGE * 2;

export interface RadarReeks {
  label: string;
  kleur: string;
  factoren: readonly RadarFactor[];
}

export function KanaalHealthRadar({ reeksen }: { reeksen: readonly RadarReeks[] }) {
  const id = useId();
  if (reeksen.length === 0) return null;

  // De aslabels komen van de eerste reeks. Alle kanalen worden door dezelfde computeHealthScore
  // beoordeeld, dus de assen zijn per definitie gelijk; zouden ze ooit verschillen, dan is dat een
  // fout in de score en niet iets om hier stilzwijgend op te vangen.
  const assen = radarPunten(reeksen[0].factoren, STRAAL, MIDDEN, MIDDEN);

  return (
    <figure className="m-0">
      <svg
        viewBox={`-${LABEL_MARGE} 0 ${BREEDTE} ${ZIJDE}`}
        className="w-full mx-auto overflow-visible max-w-[330px]"
        role="img"
        aria-labelledby={`${id}-titel`}
      >
        <title id={`${id}-titel`}>
          {reeksen.map((r) => `${r.label}: ${r.factoren.filter((f) => f.assessed).map((f) => `${f.name} ${Math.round(f.score * 10) / 10} van ${f.maxScore}`).join(", ")}`).join(". ")}
        </title>

        {WEBRINGEN.map((ring) => (
          <circle
            key={ring}
            cx={MIDDEN} cy={MIDDEN} r={STRAAL * ring}
            fill="none" className="stroke-border" strokeWidth={0.5} opacity={0.6}
          />
        ))}
        {assen.map((p) => (
          <line
            key={p.as}
            x1={MIDDEN} y1={MIDDEN} x2={p.spaakX} y2={p.spaakY}
            className="stroke-border" strokeWidth={0.5} opacity={0.6}
          />
        ))}

        {reeksen.map((reeks) => {
          const punten = radarPunten(reeks.factoren, STRAAL, MIDDEN, MIDDEN);
          const vlak = radarVlak(punten);
          const randen = radarRanden(punten);
          return (
            <g key={reeks.label}>
              {/* Bij meerdere reeksen zachter gevuld: een volle vulling zou de onderste polygoon
                  onzichtbaar maken. Bij één reeks is er niets om achter te verdwijnen en mag de
                  vorm gewicht krijgen. */}
              {vlak && <polygon points={vlak} fill={reeks.kleur} opacity={reeksen.length > 1 ? 0.1 : 0.18} />}
              {randen.map((r, i) => (
                <line
                  key={i}
                  x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
                  stroke={reeks.kleur} strokeWidth={2} strokeLinecap="round"
                />
              ))}
              {punten.filter((p) => p.x !== null).map((p) => (
                <circle key={p.as} cx={p.x!} cy={p.y!} r={2.5} fill={reeks.kleur} />
              ))}
            </g>
          );
        })}

        {assen.map((p) => {
          // Labels buiten de spaak, weg van het midden. De viewBox reserveert links en rechts
          // ruimte (LABEL_MARGE) zodat ze niet buiten de layout vallen -- de val uit 17.114.
          const rad = (p.hoek * Math.PI) / 180;
          const lx = MIDDEN + (STRAAL + 16) * Math.cos(rad);
          const ly = MIDDEN + (STRAAL + 16) * Math.sin(rad);
          const anchor = Math.abs(Math.cos(rad)) < 0.3 ? "middle" : Math.cos(rad) > 0 ? "start" : "end";
          return (
            <text
              key={p.as}
              x={lx} y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {p.as}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
