"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useChannelForecast } from "@/lib/analysis/use-channel-forecast";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore } from "@/lib/health-score";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { PacingRing } from "./pacing-monitor";
import { KanaalHealthRadar, type RadarReeks } from "./kanaal-health-radar";

/**
 * Account Health per kanaal, naast elkaar en op volgorde — de opener van "Alle kanalen".
 *
 * WAAROM DIT EN GEEN BLENDED SCORE. De voor de hand liggende invulling was één samengestelde
 * gezondheidsscore over alle kanalen. Die stuit op een datavraag zonder goed antwoord: een score
 * meet tegen een doel, en `client_targets` is voor deze klanten leeg — Meta en LinkedIn hebben
 * geen jaardoel (daarom zegt hun beurs-sectie ook "geen jaardoel ingesteld"), en Google's doel
 * langs alle spend leggen maakt de CPA en ROAS optisch slechter zonder dat er iets veranderd is.
 * Elke invulling zou een getal opleveren dat preciezer oogt dan het is.
 *
 * Een RANGSCHIKKING heeft dat probleem niet: elk kanaal wordt beoordeeld tegen zijn eigen
 * maatstaf, precies zoals op zijn eigen tabblad, en naast elkaar zetten beantwoordt de vraag die
 * je op "Alle kanalen" stelt — waar zit de zwakke plek. De eigenaar wees hier zelf op ("een
 * ranking voor google, meta, linkedin, later bing, tiktok, snapchat, ...").
 *
 * HOE HET UITBREIDT. De hooks staan bewust plat naast elkaar en niet in een lus: een hook mag niet
 * voorwaardelijk of in een lus worden aangeroepen. Een nieuw kanaal krijgt dus een eigen regel
 * hieronder, met `enabled` op de beschikbaarheid. Dat is drie regels per kanaal en het blijft
 * leesbaar; een dynamische lijst zou een component per kanaal vragen die zijn score naar boven
 * rapporteert, en dat is meer machinerie dan het probleem groot is.
 */
// De lijnkleur per kanaal in de radar. Bewust NIET de statuskleur (groen/oranje/rood): die zit al
// in de ring en het cijfer ernaast, en met drie polygonen over elkaar moet de kleur zeggen WELK
// kanaal je ziet, niet hoe het ervoor staat. Dezelfde volgorde als CHART_CATEGORICAL elders.
const KANAAL_KLEUR: Record<Kanaal, string> = {
  google: CHART_CATEGORICAL[0],
  meta: CHART_CATEGORICAL[1],
  linkedin: CHART_CATEGORICAL[2],
};

export function KanaalHealthRanking({ clientId, kanalen }: { clientId: string; kanalen: Kanaal[] }) {
  const heeft = (k: Kanaal) => kanalen.includes(k);

  // Google komt uit de provider die de hele pagina al voedt (ClientDataProvider), niet uit een
  // eigen call. Meta en LinkedIn via /api/analysis/channel-forecast, hun bestaande pad.
  const googleData = useClientHistoricalData(clientId);
  const googleForecastGedeeld = useForecast();
  const meta = useChannelForecast(clientId, "meta", heeft("meta"));
  const linkedin = useChannelForecast(clientId, "linkedin", heeft("linkedin"));

  const rijen = useMemo(() => {
    const uit: { kanaal: Kanaal; health: HealthScore }[] = [];
    if (heeft("google") && googleData) {
      // Zonder de Google-specifieke hygiëne-argumenten (impressionShare, zoektermen, ad groups):
      // die zijn hier niet beschikbaar en computeHealthScore zou die factor dan stilzwijgend vol
      // punten geven. Dezelfde correctie die channel-health-badge.tsx voor Meta/LinkedIn doet --
      // en juist hier moet hij, want anders scoort Google hoger dan de rest om een reden die
      // niets met het account te maken heeft.
      const f = googleForecastGedeeld ?? computeForecast(googleData);
      uit.push({ kanaal: "google", health: zonderKanaalSpecifiekeHygiene(computeHealthScore(f)) });
    }
    if (heeft("meta") && meta.forecast) {
      uit.push({ kanaal: "meta", health: zonderKanaalSpecifiekeHygiene(computeHealthScore(meta.forecast)) });
    }
    if (heeft("linkedin") && linkedin.forecast) {
      uit.push({ kanaal: "linkedin", health: zonderKanaalSpecifiekeHygiene(computeHealthScore(linkedin.forecast)) });
    }
    // Kanalen zonder cijfer ("?") onderaan, niet bovenaan: een onbekende score is geen nul, maar
    // hij hoort ook niet tussen de beoordeelde kanalen in te dringen.
    return uit.sort((a, b) => {
      if (a.health.grade === "?" && b.health.grade !== "?") return 1;
      if (b.health.grade === "?" && a.health.grade !== "?") return -1;
      return b.health.total - a.health.total;
    });
  }, [kanalen, googleData, googleForecastGedeeld, meta.forecast, linkedin.forecast]);

  if (rijen.length === 0) return null;

  const reeksen: RadarReeks[] = rijen
    .filter((r) => r.health.grade !== "?")
    .map((r) => ({ label: KANAAL_NAAM[r.kanaal], kleur: KANAAL_KLEUR[r.kanaal], factoren: r.health.factors }));

  return (
    <div className="@container bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Account Health per kanaal</h3>
        <span className="text-micro text-muted-foreground ml-auto">elk kanaal tegen zijn eigen maatstaf</span>
      </div>

      {/* Geen `flex-1` en geen `h-full` op deze kaart: hij houdt zijn eigen hoogte. Drie
          kanaalregels over 830px uitspreiden gaf gaten van 200px tussen de kanalen. De
          landencijfers eronder vangen het hoogteverschil met de wereldkaart op -- zie
          cross-channel-view.tsx. */}
      <div className="flex flex-col gap-5 @2xl:flex-row @2xl:items-start">
        {/* De radar met alle kanalen erin. Op het kanaaltabblad staat dezelfde vijfhoek met één
            kanaal; hier liggen ze over elkaar, want de vraag op "Alle kanalen" is een
            vergelijking. */}
        {reeksen.length > 0 && (
          <div className="shrink-0 @2xl:w-[300px]">
            <KanaalHealthRadar reeksen={reeksen} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {rijen.map(({ kanaal, health }) => (
            <KanaalRegel key={kanaal} kanaal={kanaal} health={health} />
          ))}
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        Geen samengesteld cijfer over alle kanalen samen: dat zou tegen één doel moeten meten, en
        een doel dat voor het ene kanaal gezet is zegt niets over het andere. Elk kanaal wordt hier
        beoordeeld zoals op zijn eigen tabblad.
      </p>
    </div>
  );
}

function KanaalRegel({ kanaal, health }: { kanaal: Kanaal; health: HealthScore }) {
  const kleur = health.grade === "?" ? "#9ca3af"
    : health.total >= 70 ? "#22c55e"
    : health.total >= 50 ? "#f59e0b"
    : "#ef4444";

  // De zwakste BEOORDEELDE factor. Een niet-beoordeelde factor heeft score 0 en zou anders altijd
  // als "de zwakste" bovendrijven -- terwijl "niet gemeten" iets anders is dan "slecht".
  const beoordeeld = health.factors.filter((f) => f.assessed);
  const zwakste = beoordeeld.length > 0
    ? beoordeeld.reduce((laagste, f) => (f.score < laagste.score ? f : laagste))
    : null;
  const kritiek = health.anomalies.find((a) => a.severity === "critical") ?? health.anomalies[0];

  return (
    <div className="flex items-start gap-3">
      <div className="relative shrink-0">
        <PacingRing pct={health.grade === "?" ? 0 : health.total} color={kleur} size={64} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lead font-bold leading-none tabular-nums" style={{ color: kleur }}>
            {health.grade === "?" ? "—" : health.total}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-title font-semibold text-brand-gray flex items-center gap-1.5">
            {/* De stip koppelt deze regel aan zijn polygoon in de radar; zonder koppeling is een
                radar met drie lijnen drie anonieme vormen. */}
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: KANAAL_KLEUR[kanaal] }} aria-hidden />
            {KANAAL_NAAM[kanaal]}
          </p>
          {health.grade === "?" ? (
            <span className="text-meta text-muted-foreground">
              te weinig beoordeeld voor een cijfer ({health.assessedCount}/5 factoren)
            </span>
          ) : zwakste ? (
            <span className="text-meta text-muted-foreground">
              zwakste: <span className="font-medium text-brand-gray">{zwakste.name}</span> {zwakste.score}/{zwakste.maxScore}
            </span>
          ) : null}
        </div>

        {/* De vijf factoren als staafjes, en dat is wat een rangschikking pas bruikbaar maakt:
            twee kanalen met dezelfde score kunnen op heel verschillende assen zwak zijn. Op het
            kanaaltabblad zelf staat dezelfde uitsplitsing als radar; die vorm laat zich niet
            vergelijken tussen drie kanalen onder elkaar, staafjes op een gedeelde schaal wel. */}
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 @lg:grid-cols-3 @3xl:grid-cols-5">
          {health.factors.map((f) => (
            <div key={f.name} className="min-w-0">
              <div className="flex items-baseline justify-between gap-1">
                <dt className={`text-micro truncate ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/60"}`}>{f.name}</dt>
                <dd className={`text-micro shrink-0 tabular-nums ${f.assessed ? "text-brand-gray" : "text-muted-foreground/60"}`}>
                  {f.assessed ? f.score : "—"}
                </dd>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                {/* Geen balk als de factor niet beoordeeld is: een balk op nul leest als "score
                    nul", terwijl er niet gemeten is. */}
                {f.assessed && (
                  <div
                    className={`h-full rounded-full ${f.score >= 16 ? "bg-green-400" : f.score >= 10 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${(f.score / f.maxScore) * 100}%` }}
                  />
                )}
              </div>
            </div>
          ))}
        </dl>

        {kritiek && (
          <p className="mt-2 text-meta text-muted-foreground flex items-start gap-1">
            <AlertTriangle className={`w-3 h-3 shrink-0 mt-0.5 ${kritiek.severity === "critical" ? "text-red-500" : "text-amber-500"}`} />
            <span className="min-w-0">{kritiek.title}</span>
          </p>
        )}
      </div>
    </div>
  );
}
