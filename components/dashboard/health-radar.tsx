"use client";

// De gezondheidsscore als vorm.
//
// ── WAT DIT VERVANGT ────────────────────────────────────────────────────────
//
// Hiervoor stonden de vijf factoren als vijf identieke micro-staafjes naast elkaar. Die droegen de
// informatie wel, maar in een ritme waarin je ze niet ziet: vijf even brede balkjes op één rij
// lezen als één element. En ze hadden een fout die de donut ernaast niet had -- een niet-beoordeelde
// factor werd getekend als een balk van 0% met "0/20" erboven. Dat leest als een falende score
// terwijl het "we konden dit niet meten" betekent. De donut deed dat al goed ("—" en "3/5"); de
// balkjes spraken hem tegen.
//
// ── DE MEETKUNDE STAAT IN lib/health-radar.ts ───────────────────────────────
//
// Inclusief de reden waarom een radar hier wél mag (zelfde eenheid, vaste asvolgorde, "in balans"
// is echt het doel) en waarom er geen vulling is zodra er een as ontbreekt. Dit bestand tekent
// alleen; het rekent niets uit.

import { useId } from "react";
import {
  radarPunten, radarRanden, radarVlak, radarSamenvatting, WEBRINGEN,
  type RadarFactor,
} from "@/lib/health-radar";

/** Tekengebied. De straal laat ruimte over voor de aslabels eromheen. */
const ZIJDE = 220;
const MIDDEN = ZIJDE / 2;
const STRAAL = 72;

export function HealthRadar({
  factoren,
  kleur,
}: {
  factoren: readonly RadarFactor[];
  /** De statuskleur van de donut ernaast. Zelfde data, dus dezelfde kleur. */
  kleur: string;
}) {
  const id = useId();
  const punten = radarPunten(factoren, STRAAL, MIDDEN, MIDDEN);
  const randen = radarRanden(punten);
  const vlak = radarVlak(punten);
  const onvolledig = punten.some((p) => !p.assessed);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${ZIJDE} ${ZIJDE}`}
        className="w-full max-w-[240px] mx-auto overflow-visible"
        role="img"
        aria-labelledby={`${id}-titel`}
      >
        {/* De tekstuele inhoud, voor wie de vorm niet ziet. Een radar is voor een schermlezer een
            polygoon en verder niets. */}
        <title id={`${id}-titel`}>{radarSamenvatting(factoren)}</title>

        {/* Het web. Recessief: hairline, geen streepjes -- streepjes maken ruis en concurreren met
            de onderbroken spaken, die hier juist iets betekenen. */}
        {WEBRINGEN.map((r) => (
          <circle
            key={r}
            cx={MIDDEN}
            cy={MIDDEN}
            r={STRAAL * r}
            fill="none"
            className="stroke-border"
            strokeWidth={r === 1 ? 1 : 0.5}
          />
        ))}

        {/* De spaken. Altijd allemaal: de as bestaat, ook als de meting ontbreekt. Ontbreekt hij,
            dan is de spaak gestreept -- dát is het gat. */}
        {punten.map((p) => (
          <line
            key={p.as}
            x1={MIDDEN}
            y1={MIDDEN}
            x2={p.spaakX}
            y2={p.spaakY}
            className="stroke-border"
            strokeWidth={0.75}
            strokeDasharray={p.assessed ? undefined : "2 3"}
          />
        ))}

        {/* De vulling. Alleen als de figuur gesloten is; zie radarVlak(). */}
        {vlak && <polygon points={vlak} fill={kleur} fillOpacity={0.14} />}

        {/* De randen, per stuk. Een rand die aan een niet-beoordeelde as raakt bestaat niet. */}
        {randen.map((r, i) => (
          <line
            key={i}
            x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
            stroke={kleur}
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}

        {/* De datapunten. Een ring in de achtergrondkleur eromheen, zodat een punt op een web-lijn
            niet met die lijn versmelt. */}
        {punten.map((p) =>
          p.x === null || p.y === null ? null : (
            <circle
              key={p.as}
              cx={p.x} cy={p.y} r={3.5}
              fill={kleur}
              className="stroke-card"
              strokeWidth={2}
            />
          )
        )}

        {/* De aslabels. Buiten de buitenring, uitgelijnd naar de kant waar ze staan. */}
        {punten.map((p) => {
          const rad = (p.hoek * Math.PI) / 180;
          const lx = MIDDEN + (STRAAL + 20) * Math.cos(rad);
          const ly = MIDDEN + (STRAAL + 20) * Math.sin(rad);
          const cos = Math.cos(rad);
          const anchor = Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end";
          return (
            <text
              key={p.as}
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className={p.assessed ? "fill-muted-foreground" : "fill-muted-foreground/50"}
              fontSize={9}
              fontWeight={500}
            >
              {p.as}
              {!p.assessed && (
                <tspan className="fill-muted-foreground/50" fontSize={8}> ?</tspan>
              )}
            </text>
          );
        })}
      </svg>

      {/* De legenda staat er alleen als er iets uit te leggen valt. Een vaste legenda die meestal
          "alles is gemeten" zegt, leert je hem over te slaan -- en dan mis je hem op de dag dat er
          wél iets ontbreekt. */}
      {onvolledig && (
        <figcaption className="mt-1 flex items-center justify-center gap-1.5 text-micro text-muted-foreground">
          <svg width="14" height="6" aria-hidden className="shrink-0">
            <line x1="0" y1="3" x2="14" y2="3" className="stroke-border" strokeWidth="1.5" strokeDasharray="2 3" />
          </svg>
          gestreepte as = niet te beoordelen, geen nul
        </figcaption>
      )}
    </figure>
  );
}
