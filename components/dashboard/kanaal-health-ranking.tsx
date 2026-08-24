"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useChannelForecast } from "@/lib/analysis/use-channel-forecast";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore } from "@/lib/health-score";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
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
// in het cijfer naast de naam, en met drie polygonen over elkaar moet de kleur zeggen WELK
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
          <div className="shrink-0 @2xl:w-[250px]">
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
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
      {/* Kop van de regel: stip, naam, cijfer. Het cijfer stond eerst in een ring van 64px met de
          naam ernaast en de vijf factoren daar weer naast -- drie kolommen van verschillende
          hoogte per kanaal, drie keer onder elkaar. Dat las als een tabel die geen tabel is. Nu
          per kanaal een blokje met een kopregel en een vaste factorrij eronder: dezelfde vijf
          kolommen op dezelfde plek bij elk kanaal, dus je kunt verticaal vergelijken. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: KANAAL_KLEUR[kanaal] }} aria-hidden />
        <span className="text-title font-semibold text-brand-gray">{KANAAL_NAAM[kanaal]}</span>
        <span className="text-lead font-bold tabular-nums" style={{ color: kleur }}>
          {health.grade === "?" ? "—" : health.total}
        </span>
        {health.grade === "?" ? (
          <span className="text-meta text-muted-foreground">
            te weinig beoordeeld ({health.assessedCount}/5)
          </span>
        ) : zwakste ? (
          <span className="text-meta text-muted-foreground">
            zwakste: <span className="font-medium text-brand-gray">{zwakste.name}</span> {zwakste.score}/{zwakste.maxScore}
          </span>
        ) : null}
        {kritiek && (
          <span className="ml-auto flex items-center gap-1 text-meta text-muted-foreground">
            <AlertTriangle className={`w-3 h-3 shrink-0 ${kritiek.severity === "critical" ? "text-red-500" : "text-amber-500"}`} />
            <span className="min-w-0 truncate">{kritiek.title}</span>
          </span>
        )}
      </div>

      {/* De vijf factoren, altijd alle vijf en altijd in dezelfde volgorde: dat is wat een
          rangschikking bruikbaar maakt. Twee kanalen met een andere score kunnen op dezelfde as
          vastlopen, en dat zie je alleen als de kolommen uitlijnen. */}
      <dl className="mt-2 grid grid-cols-5 gap-x-3">
        {health.factors.map((f) => (
          <div key={f.name} className="min-w-0">
            <div className="flex items-baseline justify-between gap-1">
              <dt className={`text-micro truncate ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/60"}`}>{f.name}</dt>
              <dd className={`text-micro shrink-0 tabular-nums ${f.assessed ? "text-brand-gray" : "text-muted-foreground/60"}`}>
                {f.assessed ? f.score : "—"}
              </dd>
            </div>
            <div className="mt-1 h-1 rounded-full bg-border/60 overflow-hidden">
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
    </div>
  );
}
