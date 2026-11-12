"use client";

// De kanaalkaarten bovenaan het Overzicht in de nieuwe weergave (bouwplan fase 3).
//
// WAAROM KAARTEN EN GEEN TABS. De kanaaltabs waren zestig pixels bediening die geen vraag
// beantwoordden: je moest een tab openen om te zien hoe dat kanaal ervoor staat. Een kaart is
// dezelfde knop, maar zegt het al: wie is de motor (aandeel in de conversies), wat kost het
// (aandeel in de kosten), hoe gezond is het (de ring) en hoe vers is de data. Een klik filtert de
// hele pagina op dat kanaal, via dezelfde ?kanaal= als de tabs; nog een klik op dezelfde kaart is
// terug naar alle kanalen.
//
// De cijfers komen uit lib/overzicht/bovenkant.ts (kaartCijfers) op de maandreeksen van de
// KPI-band; de health is HET OBJECT dat de ranking en het tabblad van het kanaal tonen
// (kanaalScores in kanaal-health-ranking.tsx). Deze component rekent zelf niets.

import { AlertTriangle, Check } from "lucide-react";
import { KANAAL_NAAM, KANAAL_KLEUR, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { volgendeKanaalkeuze, type KaartCijfers } from "@/lib/overzicht/bovenkant";
import type { HealthScore } from "@/lib/health-score";
import { opbouwVertraging, useTellendeTekst } from "@/lib/beweging";
import { usePeriod } from "@/lib/period/period-context";
import { formatRangeKort } from "@/lib/period/period-range";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { kleurVanScore } from "./kanaal-health-ranking";

/** De health van een kanaal zoals de kaart hem kent: een score, nog onderweg, of niet te beoordelen. */
export type KaartHealth =
  | { soort: "score"; health: HealthScore }
  | { soort: "laden" }
  | { soort: "geen"; reden: string };

export interface Kanaalkaart {
  kanaal: Kanaal;
  /** De cijfers over de gekozen periode; null zolang de reeksen nog laden. */
  cijfers: KaartCijfers | null;
  health: KaartHealth;
  /** De koppel- en datastand in een paar woorden ("data t/m 26 aug"), en of dat aandacht vraagt. */
  stand: { tekst: string; alarm: boolean } | null;
}

const heel = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
const euro = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

// Het teken op het kleurvlakje. Geen merklogo's: een letter in de kanaalkleur is genoeg om de
// kaart terug te vinden, en de naam staat ernaast.
const GLYPH: Record<Kanaal, string> = { google: "G", meta: "M", linkedin: "in", microsoft: "Ms" };

const OMTREK = 2 * Math.PI * 12.5;

/** De hoogte van een kaart (twee regels plus opvulling en rand), voor het vlak dat de rij vrijhoudt
 *  zolang de kanalen nog niet bekend zijn. Loopt mee met de opmaak van Kaart hieronder. */
export const KAARTENRIJ_HOOGTE = "h-[78px]";

/** De health-ring: de score als boog, met het cijfer erin. Zonder score een lege ring met een streep. */
function HealthRing({ health }: { health: KaartHealth }) {
  const score = health.soort === "score" && health.health.grade !== "?" ? health.health.total : null;
  const kleur = health.soort === "score" ? kleurVanScore(health.health) : "#9ca3af";
  const label = health.soort === "laden" ? "Health wordt berekend"
    : health.soort === "geen" ? `Health ${health.reden}`
    : score === null ? `Health: te weinig beoordeeld (${health.health.assessedCount} van 5 factoren)`
    : `Health ${score} van 100`;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" role="img" aria-label={label} className="shrink-0 text-brand-gray">
      <title>{label}</title>
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--chart-grid, #eef1f6)" strokeWidth="3.5" />
      {score !== null && (
        <circle
          cx="16" cy="16" r="12.5" fill="none" stroke={kleur} strokeWidth="3.5" strokeLinecap="round"
          transform="rotate(-90 16 16)" strokeDasharray={`${((OMTREK * score) / 100).toFixed(1)} ${OMTREK.toFixed(1)}`}
        />
      )}
      <text x="16" y="19.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">
        {health.soort === "laden" ? "…" : score === null ? "—" : score}
      </text>
    </svg>
  );
}

/** De zwakste beoordeelde factor en het zwaarste signaal, voor de beschrijving van de kaart. */
function healthToelichting(health: KaartHealth): string | null {
  if (health.soort !== "score") return null;
  const beoordeeld = health.health.factors.filter((f) => f.assessed);
  const zwakste = beoordeeld.length > 0 ? beoordeeld.reduce((l, f) => (f.score < l.score ? f : l)) : null;
  const signaal = health.health.anomalies.find((a) => a.severity === "critical") ?? health.health.anomalies[0];
  const delen = [zwakste ? `zwakste factor: ${zwakste.name} ${zwakste.score}/${zwakste.maxScore}` : null, signaal?.title ?? null].filter(Boolean);
  return delen.length > 0 ? delen.join(" · ") : null;
}

function Kaart({ kaart, actief, onKlik, vertraging, opbouw, periode }: {
  kaart: Kanaalkaart;
  actief: boolean;
  onKlik: () => void;
  vertraging: number;
  opbouw: boolean;
  /** De gekozen periode in een paar woorden, voor de uitleg bij de kaart. */
  periode: string;
}) {
  const { kanaal, cijfers, health, stand } = kaart;
  const kleur = KANAAL_KLEUR[kanaal];
  const naam = KANAAL_NAAM[kanaal];
  // Bij een periodewissel telt het conversiecijfer naar zijn nieuwe waarde, zoals de tegels eronder.
  const conversies = useTellendeTekst(cijfers ? heel(cijfers.conversions) : "—");
  const kritiek = health.soort === "score" ? health.health.anomalies.find((a) => a.severity === "critical") : undefined;
  const toelichting = healthToelichting(health);
  const beschrijving = `kanaalkaart-${kanaal}`;
  const healthTekst = health.soort === "laden" ? "Health wordt berekend."
    : health.soort === "geen" ? `Health ${health.reden}.`
    : health.health.grade === "?" ? "Health: te weinig beoordeeld." : `Health ${health.health.total} van 100.`;

  return (
    <button
      type="button"
      // De naam van de knop is de kanaalnaam, kort, zoals op de tab die hij vervangt; de cijfers
      // staan in de beschrijving. Zo hoort een schermlezer "Meta, ingedrukt" en daarna de rest,
      // in plaats van één lange zin als naam.
      aria-label={naam}
      aria-describedby={beschrijving}
      aria-pressed={actief}
      title={`${actief ? `${naam} is gekozen. Klik nog eens voor alle kanalen.` : `Filter de pagina op ${naam}.`} Cijfers over ${periode}.`}
      onClick={onKlik}
      style={{ ...(actief ? { borderColor: kleur } : {}), ...(opbouw ? { animationDelay: `${vertraging}ms` } : {}) }}
      className={`group flex w-60 shrink-0 snap-start flex-col gap-1 rounded-xl border bg-card px-3 py-2 text-left shadow-sm transition-[border-color,box-shadow,translate] hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink sm:w-auto sm:shrink ${
        actief ? "ring-2 ring-brand-blue/15" : "border-border"
      } ${opbouw ? "opbouw" : ""}`}
    >
      <span className="flex min-h-8 w-full items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-body font-bold"
          style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}
        >
          {GLYPH[kanaal]}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1 text-title font-semibold text-brand-gray">
            <span className="truncate">{naam}</span>
            {actief && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: kleur }} aria-hidden />}
          </span>
          {/* De koppel- en datastand: tot welke dag dit kanaal data heeft, en rood als de sync stilstaat. */}
          <span data-kaartstand className={`text-meta ${stand?.alarm ? "font-medium text-red-700" : "text-muted-foreground"}`}>
            {stand ? stand.tekst : "\u00A0"}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {kritiek && (
            <span title={kritiek.title} className="flex">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-hidden />
              <span className="sr-only">Signaal: {kritiek.title}.</span>
            </span>
          )}
          <span title={toelichting ?? undefined} className="flex"><HealthRing health={health} /></span>
        </span>
      </span>
      {/* Eén regel cijfers: de conversies van dit kanaal in de gekozen periode met hun aandeel, en
          de kosten met hun aandeel. De aandelen gaan over alle kanalen en tellen op tot 100. */}
      <span className="flex min-h-6 w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {cijfers ? (
          <>
            <span className="text-lg font-semibold leading-none tracking-tight text-brand-gray">{conversies}</span>
            <span className="text-meta text-muted-foreground">
              conv{cijfers.aandeelConversies !== null ? ` · ${cijfers.aandeelConversies}%` : ""}
            </span>
            <span className="ml-auto whitespace-nowrap text-meta text-muted-foreground">
              <span className="text-brand-gray">{euro(cijfers.adSpend)}</span>
              {cijfers.aandeelKosten !== null ? ` · ${cijfers.aandeelKosten}% van de kosten` : " kosten"}
            </span>
          </>
        ) : (
          <span className="h-4 w-4/5 self-center rounded bg-muted/70" aria-hidden />
        )}
      </span>
      {/* De beschrijving voor een schermlezer, in één zin: de knop heet naar zijn kanaal
          (aria-label), dus wat erin staat wordt niet voorgelezen en moet hier voluit staan. */}
      <span id={beschrijving} className="sr-only">
        {stand ? `${stand.tekst}. ` : ""}{healthTekst}
        {cijfers
          ? ` Over ${periode}. Conversies: ${heel(cijfers.conversions)}${cijfers.aandeelConversies !== null ? `, dat is ${cijfers.aandeelConversies} procent van alle kanalen` : ""}. Kosten: ${euro(cijfers.adSpend)}${cijfers.aandeelKosten !== null ? `, ${cijfers.aandeelKosten} procent van alle kanalen` : ""}. CPA: ${cijfers.cpa === null ? "niet te berekenen" : euro(cijfers.cpa)}.`
          : " Cijfers worden geladen."}
        {toelichting ? ` ${toelichting}.` : ""}
        {actief ? " Gekozen; nog een klik toont alle kanalen." : ""}
      </span>
    </button>
  );
}

/**
 * De rij kanaalkaarten. Op een telefoon een horizontale strook waar je doorheen veegt (de pagina
 * zelf schuift niet opzij); vanaf een tablet een raster met een kolom per kanaal.
 *
 * Bij minder dan twee kanalen staat er niets, zoals bij de tabs (zichtbareTabs): een filter met
 * één knop is geen keuze, en 62 van de 71 klanten hebben alleen Google.
 */
export function Kanaalkaarten({ kaarten, gekozen, onKies, opbouw = false, opbouwVanaf = 0, opbouwAantal }: {
  kaarten: readonly Kanaalkaart[];
  gekozen: Kanaalkeuze;
  onKies: (keuze: Kanaalkeuze) => void;
  /** Speel de opbouw van het eerste bezoek (lib/beweging.ts). */
  opbouw?: boolean;
  /** De plek van de eerste kaart in de opbouw van de hele bovenkant, en hoeveel blokken die telt. */
  opbouwVanaf?: number;
  opbouwAantal?: number;
}) {
  const periode = usePeriod();
  if (kaarten.length < 2) return null;
  return (
    <section
      aria-label="Kanalen, klik om de pagina te filteren"
      // De marge en de opvulling heffen elkaar op: de strook mag schuiven (overflow), en zonder die
      // lucht sneed hij de focusring en de schaduw van de kaarten af.
      className="-m-1 flex snap-x gap-2 overflow-x-auto p-1 sm:grid sm:overflow-visible"
      // Zoveel kolommen als er passen, met een ondergrens: een kolom per kanaal maakte een kaart op
      // een tablet 174 px breed, en dan viel het kostenaandeel achter puntjes weg. Past de regel
      // cijfers ook dan niet, dan breekt hij naar een tweede regel in plaats van af te kappen.
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))" }}
    >
      {/* Het venster van deze cijfers: de gekozen periode, zoals bij elk ander blok dat de periode
          volgt. Niet als zichtbaar label: de periode staat in de kiezer direct erboven en in de
          voetregel van de tegels direct eronder, en een eigen regel kostte hier twintig pixels
          boven het eerste kerncijfer. Wel voor een schermlezer, en in de uitleg van elke kaart. */}
      <span className="sr-only"><Vensterlabel soort="periode" /></span>
      {kaarten.map((kaart, i) => (
        <Kaart
          key={kaart.kanaal}
          kaart={kaart}
          actief={gekozen === kaart.kanaal}
          onKlik={() => onKies(volgendeKanaalkeuze(gekozen, kaart.kanaal))}
          opbouw={opbouw}
          periode={formatRangeKort(periode.range)}
          vertraging={opbouwVertraging(opbouwVanaf + i, opbouwAantal ?? kaarten.length)}
        />
      ))}
    </section>
  );
}
