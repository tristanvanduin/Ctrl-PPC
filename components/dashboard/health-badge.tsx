"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info, Activity } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, type HealthScore } from "@/lib/health-score";
import { magRadarTonen } from "@/lib/health-radar";
import { HealthRadar } from "./health-radar";

export function HealthBadge({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);

  const health = useMemo(() => computeHealthScore(
    forecast,
    dataState?.impressionShare,
    dataState?.wastefulSearchTerms,
    dataState?.adGroupBleeders,
  ), [forecast, dataState]);

  return <HealthBadgeView health={health} />;
}

/**
 * Het presentationele deel van HealthBadge, los van waar de score vandaan komt.
 *
 * Google's HealthBadge hierboven leunt op ClientDataProvider/ForecastContext -- Google-specifiek
 * opgebouwd (customerId, live API-call via /api/google-ads/client-data). Meta en LinkedIn hebben
 * dat pad nooit gehad; hun tegenhanger (components/dashboard/channel-health-badge.tsx) haalt de
 * score via /api/analysis/channel-forecast en rendert hem hiermee, zonder de weergave een tweede
 * keer te bouwen.
 */
export function HealthBadgeView({
  health,
  titel = "Account Health",
  Icoon = Activity,
}: {
  health: HealthScore;
  /** Sectie 5.4 (Campaign Type Intelligence) hergebruikt deze view voor de Search-scorecard --
   *  zelfde opbouw, andere titel/icoon, geen tweede kopie van vier lagen presentatielogica. */
  titel?: string;
  Icoon?: typeof Activity;
}) {
  // Eén plek voor de statuskleur. De boog en de radar tonen dezelfde score, dus een tweede
  // ternary ernaast zou vroeg of laat iets anders zeggen dan de eerste.
  const radarKleur = health.grade === "?" ? "#9ca3af"
    : health.total >= 70 ? "#22c55e"
    : health.total >= 50 ? "#f59e0b"
    : "#ef4444";

  return (
    <div className="@container flex h-full flex-col bg-card rounded-xl border border-border p-5 shadow-sm">
      {/* CONTAINER QUERY, GEEN VIEWPORT-BREEKPUNT -- en dat is de kern van de fix.
          Hier stond `xl:flex-row`. Dat is een VENSTER-breekpunt, terwijl deze kaart in de hero in
          een halfbrede kolom staat. Bij een venster van 1500px is `xl` (1280px) waar, dus zette de
          kaart cirkel + factoren + anomalieën naast elkaar -- in een kolom van ~598px. Resultaat:
          "Doelstelling" en "Efficiency 16/20" over elkaar heen, en tekst die om de twee woorden
          afbrak. De kaart wist niet dat hij smal stond; hij keek naar het scherm.

          `@2xl` (672px) meet de KAART zelf: pas als er echt ruimte is voor de cirkel (80px) plus
          twee tekstkolommen gaan de stukken naast elkaar. In de halfbrede hero blijft het dus
          netjes onder elkaar, en op een volle-breedte plaatsing (waar deze kaart ook voorkomt)
          krijgt hij zijn rij-indeling terug.

          Zie ook pacing-monitor.tsx, dat @container al gebruikt -- Tailwind v4 heeft het ingebouwd. */}
      <div className="flex flex-1 flex-col justify-between gap-5 @6xl:flex-row @6xl:flex-wrap @6xl:items-start">
        {/* Score circle */}
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
            <circle cx="40" cy="40" r="34" fill="none" className="stroke-border" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke={radarKleur}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={health.grade === "?" ? "0 213.6" : `${health.total * 2.136} 213.6`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Een getal tonen naast een "?" suggereert precisie die er niet is: bij te
                weinig beoordeelde factoren is de score geen lage score maar een onbekende.
                De lettergrade (A-F) stond hier ook, naast het cijfer -- twee schalen voor
                dezelfde score. Weg: het cijfer staat nu alleen, gecentreerd. Bij "?" blijft de
                assessedCount-aanduiding staan (geen grade, een eerlijk "hoeveel is er wél
                gemeten" -- dat signaal verdwijnt niet, regel 3 van de vertrouwensdoctrine). */}
            <span className={`text-2xl font-bold ${health.color}`}>
              {health.grade === "?" ? "—" : health.total}
            </span>
            {health.grade === "?" && (
              <span className="text-micro font-semibold text-muted-foreground">
                {health.assessedCount}/5
              </span>
            )}
          </div>
        </div>

        {/* Factors.

            De boog links zegt HOE VER (één begrensd getal), de radar zegt WAARUIT dat getal
            bestaat. Dezelfde data op twee hoogtes, naast elkaar -- een account met 68 dat overal
            middelmatig is en een account met 68 dat uitblinkt op budget en faalt op hygiëne zagen
            er hiervoor identiek uit.

            Onder de drie beoordeelde assen valt de radar terug op de staafjes: twee punten en drie
            gaten is geen vorm maar ruis die eruitziet als een meting. */}
        <div className="shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Icoon className="w-4 h-4 text-brand-blue-ink" />
            <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">{titel}</h3>
          </div>
          {magRadarTonen(health.factors) ? (
            <HealthRadar factoren={health.factors} kleur={radarKleur} />
          ) : (
            // grid-cols-3 op smal, grid-cols-5 vanaf sm: vijf kolommen met labels als "Conversion
            // Efficiency" pasten niet naast elkaar op een telefoonbreed scherm en duwden de hele
            // pagina breder in plaats van zelf om te breken.
            <div className="grid grid-cols-3 gap-2 @md:grid-cols-5">
              {health.factors.map((f) => (
                <div key={f.name} className="text-center">
                  {/* Niet-beoordeeld toont een streepje en geen 0/20: een nul-balk leest als een
                      falende score terwijl het "niet te meten" betekent. De donut ernaast zei dat
                      al goed ("—" en "3/5"); deze balkjes spraken hem tegen. */}
                  <div className="text-xs font-semibold text-brand-gray">
                    {f.assessed ? `${f.score}/${f.maxScore}` : "—"}
                  </div>
                  <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    {f.assessed && (
                      <div
                        className={`h-full rounded-full ${f.score >= 16 ? "bg-green-400" : f.score >= 10 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{ width: `${(f.score / f.maxScore) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className={`text-micro mt-1 ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                    {f.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── DE RECHTERKOLOM ────────────────────────────────────────────────────
            Hier stonden alleen de anomalieën. Dat zijn er in een gezond account twee, dus twee
            regels tekst naast een radar van driehonderd pixels hoog: nagemeten op het tabblad
            Google Ads bleef er rechtsonder een leeg vlak van ruwweg 450 bij 240 pixels over, op
            de eerste kaart van het belangrijkste scherm.

            Wat eronder is gekomen is geen opvulling maar het ontbrekende derde niveau. De boog
            zegt HOE VER (één getal), de radar zegt WAARUIT (de vorm), en deze lijst zegt WAAROM:
            per as de score en de reden, en die reden werd al berekend (`factor.description` in
            lib/health-score.ts) maar nergens getoond. Een radar zonder legenda laat je raden wat
            "Hygiëne" op 12 van de 20 betekent.

            Niet-beoordeelde assen staan er gedempt bij en met een streepje in plaats van een nul,
            om dezelfde reden als bij de staafjes hierboven. */}
        {/* `max-w-2xl` en niet kaal `flex-1`: bij weinig anomalieën en korte omschrijvingen (bv.
            PMax, dat vaak minder te melden heeft dan Search) rekte deze kolom tot de volle
            kaartbreedte en bleef rechts een leeg vlak over. De kolom groeit nog steeds mee met
            een brede kaart, maar niet verder dan waar de inhoud (twee kolommen `dl`) al op
            uitkomt. */}
        <div className="flex min-w-0 flex-1 max-w-2xl flex-col gap-4">
          {/* De rest van de kaart is inhoudsgestuurd; DEZE kolom is de plek waar de kaart zijn
              hoogte vandaan haalt als de rasterrij hoger uitvalt dan de inhoud. Zonder een
              expliciete verdeler zakt dat verschil naar de onderkant en leest het als een gat --
              precies wat de eigenaar op een 1920px-scherm zag. De factorenlijst hieronder krijgt
              daarom `flex-1` met `content-between`: de vijf regels verdelen de extra hoogte over
              hun onderlinge ruimte in plaats van hem onderaan te laten staan. */}
          {health.anomalies.length > 0 && (
            <div className="min-w-0">
              <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Anomalieën ({health.anomalies.length})
              </p>
              <div className="space-y-1.5">
                {health.anomalies.slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    {a.severity === "critical" ? (
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                    ) : a.severity === "warning" ? (
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                    )}
                    <span className="text-meta leading-tight">
                      <span className="text-brand-gray font-medium">{a.title}</span>
                      <span className="text-muted-foreground"> — {a.description}</span>
                    </span>
                  </div>
                ))}
                {health.anomalies.length > 6 && (
                  <span className="text-micro text-muted-foreground">+{health.anomalies.length - 6} meer</span>
                )}
              </div>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Waaruit de score bestaat
            </p>
            {/* Naam + uitleg op één regel, met de naam op een vaste breedte om de kolommen te
                laten uitlijnen, brak op de spreiding in factornamen ("Trend" naast
                "Cannibalisatie met Search/Shopping" bij PMax) -- elke vaste breedte was te smal
                voor de een of te breed voor de ander, en de uitleg werd hoe dan ook afgekapt
                (title-only, niet klikbaar/hooverbaar, en "oogt druk/vol"). Nu twee regels per
                factor: naam+score blijven kort en lijnen zelf al uit (justify-between binnen hun
                eigen regel), de uitleg krijgt een eigen regel eronder en wordt niet meer
                afgekapt -- geen kolom om uit te lijnen, dus niets meer om uit te lijnen. */}
            <dl className="grid flex-1 content-between gap-x-5 gap-y-3 @lg:grid-cols-2">
              {health.factors.map((f) => (
                <div key={f.name} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className={`text-meta font-medium ${f.assessed ? "text-brand-gray" : "text-muted-foreground/60"}`}>
                      {f.name}
                    </dt>
                    <span className={`shrink-0 text-meta tabular-nums ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                      {f.assessed ? `${f.score}/${f.maxScore}` : "—"}
                    </span>
                  </div>
                  <dd className={`text-micro leading-snug ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                    {f.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
