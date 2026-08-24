"use client";

import { useId } from "react";
import { radarPunten, radarRanden, radarVlak, WEBRINGEN, type RadarFactor } from "@/lib/health-radar";

// De radar met MEER DAN EEN kanaal erin: dezelfde vijf assen, een polygoon per kanaal.
//
// Waarom niet drie losse radars naast elkaar. De vraag op "Alle kanalen" is een vergelijking, en
// drie aparte vijfhoeken vergelijk je niet -- dan moet je per as heen en weer kijken tussen drie
// figuren en de hoeken tegen elkaar wegen. Over elkaar heen op dezelfde assen is de vergelijking
// zelf de vorm: waar de polygonen uit elkaar lopen zit het verschil.
//
// Waarom niet één radar met een gemiddelde. Dat zou een blended score zijn met precies het
// probleem dat kanaal-health-ranking.tsx beschrijft: middelen over kanalen die tegen verschillende
// maatstaven gemeten zijn.
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
          {reeksen.map((r) => `${r.label}: ${r.factoren.filter((f) => f.assessed).map((f) => `${f.name} ${f.score} van ${f.maxScore}`).join(", ")}`).join(". ")}
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
              {/* Zacht gevuld en niet dicht: met drie kanalen over elkaar zou een volle vulling de
                  onderste polygoon onzichtbaar maken. De lijn draagt de vorm, de vulling geeft
                  hem alleen gewicht. */}
              {vlak && <polygon points={vlak} fill={reeks.kleur} opacity={0.1} />}
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
