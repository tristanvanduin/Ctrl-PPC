"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useChannelForecast } from "@/lib/analysis/use-channel-forecast";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore, type HealthFactor } from "@/lib/health-score";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { CHANNEL_CHART_COLOR } from "@/lib/branding/chart-colors";
import { KanaalHealthRadar, type RadarReeks } from "./kanaal-health-radar";
import type { RadarFactor } from "@/lib/health-radar";

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
// De kleur per kanaal, voor de stip voor de kanaalnaam. Die stond er oorspronkelijk om een regel
// aan zijn eigen polygoon in de radar te koppelen; nu er één gemiddelde lijn staat, is het puur
// kanaal-identiteit -- dezelfde kleur die het kanaal in de spend-grafiek eronder heeft, zodat een
// kanaal over de hele pagina dezelfde kleur houdt.
//
// Uit CHANNEL_CHART_COLOR en niet uit de POSITIE in CHART_CATEGORICAL: dat laatste stond hier wel
// (0/1/2) en gaf Meta oranje, terwijl Meta in elke andere grafiek violet is. Precies de fout die
// chart-colors.ts beschrijft -- kleur volgt de identiteit van het kanaal, nooit zijn rangnummer.
// Dat is ook wat dit component nodig heeft om te schalen: een vierde kanaal krijgt een kleur
// omdat het dat kanaal is, niet omdat het vierde in de lijst staat, en die kleur blijft gelijk
// als de rangschikking van volgorde wisselt.
const KANAAL_KLEUR: Record<Kanaal, string> = {
  google: CHANNEL_CHART_COLOR.Google,
  meta: CHANNEL_CHART_COLOR.Meta,
  linkedin: CHANNEL_CHART_COLOR.LinkedIn,
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

  // EEN lijn, niet drie. De radar toont het gemiddelde per as over de kanalen die die as
  // daadwerkelijk METEN.
  //
  // Waarom dat wél mag terwijl een blended totaalcijfer dat niet mag: de factorscores zijn al
  // genormaliseerd. Elke as loopt van 0 tot 20 en is per kanaal tegen de eigen maatstaf bepaald --
  // middelen betekent hier "hoe staat het account er gemiddeld voor op deze as", niet "meet alle
  // spend tegen één doel". Dat laatste was het bezwaar tegen een samengestelde score, en dat geldt
  // hier niet.
  //
  // Een as telt alleen mee voor de kanalen die hem beoordeeld hebben. Budget en Hygiëne staan voor
  // Meta en LinkedIn op "niet beoordeeld"; die als nul meenemen zou het gemiddelde omlaag trekken
  // om een reden die niets met de prestatie te maken heeft. Meet geen enkel kanaal een as, dan is
  // de as ook voor het gemiddelde niet beoordeeld en tekent de radar er geen punt.
  const blended: RadarFactor[] = (rijen[0]?.health.factors ?? []).map((sjabloon, i) => {
    const gemeten = rijen
      .map((r) => r.health.factors[i])
      .filter((f): f is HealthFactor => Boolean(f) && f.assessed);
    return {
      // De dekking in het label zodra niet elk kanaal deze as meet. Zonder dat staat "Budget" hier
      // op de volle 20 terwijl alleen Google hem beoordeelt -- de vorm zegt dan "het budget van dit
      // account is perfect", en dat is een uitspraak over één van de drie kanalen. De as helemaal
      // weglaten zou Google's budgetcijfer weggooien om een misverstand te vermijden; het erbij
      // zetten laat het cijfer staan en vertelt waar het vandaan komt.
      name: gemeten.length > 0 && gemeten.length < rijen.length
        ? `${sjabloon.name} ${gemeten.length}/${rijen.length}`
        : sjabloon.name,
      maxScore: sjabloon.maxScore,
      assessed: gemeten.length > 0,
      score: gemeten.length > 0 ? gemeten.reduce((t, f) => t + f.score, 0) / gemeten.length : 0,
    };
  });

  // De kleur van de lijn volgt het gemiddelde zelf, met dezelfde drempels als een losse
  // health-kaart: geschaald over de assen die beoordeeld zijn, precies zoals computeHealthScore
  // dat doet.
  const beoordeeldeAssen = blended.filter((f) => f.assessed);
  const blendedTotaal = beoordeeldeAssen.length > 0
    ? Math.round((beoordeeldeAssen.reduce((t, f) => t + f.score, 0) / (beoordeeldeAssen.length * 20)) * 100)
    : null;
  const blendedKleur = blendedTotaal == null ? "#9ca3af"
    : blendedTotaal >= 70 ? "#22c55e"
    : blendedTotaal >= 50 ? "#f59e0b"
    : "#ef4444";

  const reeksen: RadarReeks[] = beoordeeldeAssen.length > 0
    ? [{ label: "Gemiddeld over de kanalen", kleur: blendedKleur, factoren: blended }]
    : [];

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
        {/* Eén lijn: het gemiddelde over de kanalen. Er hebben hier drie lijnen over elkaar
            gestaan, één per kanaal -- leesbaar zolang ze uit elkaar liggen, maar bij vijf of tien
            kanalen wordt dat een kluwen, en de per-kanaal cijfers staan er rechts toch al
            uitgesplitst naast. De radar zegt hier "hoe staat het account ervoor", de regels ernaast
            "en waar zit het verschil". */}
        {reeksen.length > 0 && (
          <div className="shrink-0 @2xl:w-[250px]">
            <KanaalHealthRadar reeksen={reeksen} />
            <p className="mt-1 text-center text-micro text-muted-foreground">
              Gemiddeld{blendedTotaal != null && <> — <span className="font-semibold" style={{ color: blendedKleur }}>{blendedTotaal}</span></>}
            </p>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {rijen.map(({ kanaal, health }) => (
            <KanaalRegel key={kanaal} kanaal={kanaal} health={health} />
          ))}
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        De radar is het gemiddelde per as over de kanalen die die as meten — Budget en Hygiëne
        worden voor Meta en LinkedIn niet beoordeeld en tellen daar dus niet mee. Dat kan omdat de
        assen al genormaliseerd zijn: elk kanaal is tegen zijn eigen maatstaf beoordeeld, zoals op
        zijn eigen tabblad. Wat er bewust níét staat is één samengesteld cijfer over de spend van
        alle kanalen samen: dat zou tegen één doel moeten meten, en een doel dat voor het ene
        kanaal gezet is zegt niets over het andere.
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
