"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useChannelForecast } from "@/lib/analysis/use-channel-forecast";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore, type HealthFactor } from "@/lib/health-score";
import { KANAAL_NAAM, KANAAL_KLEUR, type Kanaal } from "@/lib/kanalen/beschikbaar";
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
 * ── HOE DIT SCHAALT ─────────────────────────────────────────────────────────
 *
 * Twee dingen klapten uit hun voegen bij een vierde kanaal, en beide zijn hier opgelost.
 *
 * 1. DE HOOKS. Er stond één `useChannelForecast`-regel per kanaal, plat naast elkaar, omdat een
 *    hook niet in een lus mag. Een nieuw kanaal kostte dus een bewerking in dit bestand, en bij
 *    zes kanalen was dat een muur van regels die ook afvuurt voor kanalen die de klant niet heeft.
 *    Nu haalt een KIND per kanaal zijn eigen score op en meldt die naar boven (`KanaalScoreBron`,
 *    onderaan). Elk kind roept precies één keer elke hook aan, dus de LIJST mag dynamisch zijn:
 *    `kanalen.map(...)`. Een nieuw kanaal kost hier niets meer — het komt uit `kanalen` binnen.
 *
 * 2. DE HOOGTE. Een kanaalblok is ~70px hoog. Drie passen naast de radar (220px); zes zouden de
 *    kaart naar ~430px aan regels duwen, en deze kaart staat in de linkerkolom naast de
 *    wereldkaart — alles wat hij extra groeit, wordt wit aan de andere kant. Vanaf vier kanalen
 *    schakelt de lijst daarom naar een compacte vorm: de vijf factornamen staan één keer als
 *    kopregel boven de lijst in plaats van bij elk kanaal opnieuw, en een regel is ~34px. Zes
 *    kanalen passen dan in dezelfde hoogte als drie nu.
 *
 * Wat er BUITEN dit bestand nog nodig is voor een echt vierde kanaal: een `Kanaal`-waarde met zijn
 * bron, naam en kleur in lib/kanalen/beschikbaar.ts, en herkenning in computeAnalysisTargets
 * (AnalysisChannel). Daarna verschijnt het kanaal hier vanzelf.
 */

/** Vanaf hoeveel kanalen de compacte lijst aangaat. Zie punt 2 hierboven. */
const COMPACT_VANAF = 4;

/**
 * Eén rasterdefinitie voor de kopregel én de compacte regels, want ze moeten uitlijnen.
 * Twee losse definities lopen bij de eerste wijziging uit elkaar en dan staat een kolomnaam
 * boven de verkeerde balk — een fout die eruitziet als data.
 */
const COMPACT_RASTER =
  "grid grid-cols-[minmax(5rem,9rem)_2rem_repeat(5,minmax(3rem,1fr))_1rem] items-center gap-x-3";

export function KanaalHealthRanking({ clientId, kanalen }: { clientId: string; kanalen: Kanaal[] }) {
  const [scores, setScores] = useState<Partial<Record<Kanaal, HealthScore>>>({});

  // Stabiel: de kinderen hebben hem als effect-dependency, dus een nieuwe functie per render zou
  // elk kind bij elke render opnieuw laten melden.
  const meld = useCallback((kanaal: Kanaal, health: HealthScore | null) => {
    setScores((vorig) => {
      if (health === null) {
        if (!(kanaal in vorig)) return vorig;
        const uit = { ...vorig };
        delete uit[kanaal];
        return uit;
      }
      if (vorig[kanaal] === health) return vorig;
      return { ...vorig, [kanaal]: health };
    });
  }, []);

  const rijen = useMemo(() => {
    const uit = kanalen.flatMap((k) => {
      const health = scores[k];
      return health ? [{ kanaal: k, health }] : [];
    });
    // Kanalen zonder cijfer ("?") onderaan, niet bovenaan: een onbekende score is geen nul, maar
    // hij hoort ook niet tussen de beoordeelde kanalen in te dringen.
    return uit.sort((a, b) => {
      if (a.health.grade === "?" && b.health.grade !== "?") return 1;
      if (b.health.grade === "?" && a.health.grade !== "?") return -1;
      return b.health.total - a.health.total;
    });
  }, [kanalen, scores]);

  // De bronnen renderen niets, maar ze moeten wél in de boom staan — ook als er nog geen enkele
  // score binnen is. Zaten ze in de kaart die pas verschijnt zodra `rijen` gevuld is, dan werd de
  // score nooit opgehaald en bleef de kaart voor altijd weg.
  const bronnen = (
    <>
      {kanalen.map((k) => (
        <KanaalScoreBron key={k} clientId={clientId} kanaal={k} meld={meld} />
      ))}
    </>
  );

  if (rijen.length === 0) return bronnen;

  // EEN lijn, niet drie. De radar toont het gemiddelde per as over de kanalen die die as
  // daadwerkelijk METEN.
  //
  // Waarom dat wél mag terwijl een blended totaalcijfer dat niet mag: de factorscores zijn al
  // genormaliseerd. Elke as loopt van 0 tot 20 en is per kanaal tegen de eigen maatstaf bepaald --
  // middelen betekent hier "hoe staat het account er gemiddeld voor op deze as", niet "meet alle
  // spend tegen één doel". Dat laatste was het bezwaar tegen een samengestelde score, en dat geldt
  // hier niet. Deze vorm is ook de enige die niet meegroeit met het aantal kanalen: één lijn blijft
  // één lijn, of het er nu drie of tien zijn.
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
      // zetten laat het cijfer staan en vertelt waar het vandaan komt. Schaalt mee: 1/3 wordt 1/6.
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

  const compact = rijen.length >= COMPACT_VANAF;
  const factornamen = rijen[0].health.factors.map((f) => f.name);

  return (
    <div className="@container bg-card rounded-xl border border-border p-5 shadow-sm">
      {bronnen}
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
        <div className={`flex min-w-0 flex-1 flex-col ${compact ? "gap-1.5" : "gap-4"}`}>
          {/* De factornamen één keer, niet bij elk kanaal opnieuw. Dat is de hele winst van de
              compacte vorm: de namen zijn voor elk kanaal identiek, dus vanaf vier kanalen is het
              herhaalde label puur hoogte. */}
          {compact && (
            <div className={`${COMPACT_RASTER} px-3 text-micro text-muted-foreground`}>
              <span />
              <span />
              {factornamen.map((n) => (
                <span key={n} className="truncate" title={n}>{n}</span>
              ))}
              <span />
            </div>
          )}
          {rijen.map(({ kanaal, health }) => (
            <KanaalRegel key={kanaal} kanaal={kanaal} health={health} compact={compact} />
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

/** De kleur van een cijfer: dezelfde drempels als op een losse health-kaart. */
function kleurVanScore(health: HealthScore): string {
  if (health.grade === "?") return "#9ca3af";
  return health.total >= 70 ? "#22c55e" : health.total >= 50 ? "#f59e0b" : "#ef4444";
}

function balkKleur(score: number): string {
  return score >= 16 ? "bg-green-400" : score >= 10 ? "bg-amber-400" : "bg-red-400";
}

function KanaalRegel({ kanaal, health, compact }: { kanaal: Kanaal; health: HealthScore; compact: boolean }) {
  const kleur = kleurVanScore(health);

  // De zwakste BEOORDEELDE factor. Een niet-beoordeelde factor heeft score 0 en zou anders altijd
  // als "de zwakste" bovendrijven -- terwijl "niet gemeten" iets anders is dan "slecht".
  const beoordeeld = health.factors.filter((f) => f.assessed);
  const zwakste = beoordeeld.length > 0
    ? beoordeeld.reduce((laagste, f) => (f.score < laagste.score ? f : laagste))
    : null;
  const kritiek = health.anomalies.find((a) => a.severity === "critical") ?? health.anomalies[0];

  if (compact) {
    // Dezelfde vijf kolommen, dezelfde volgorde, alleen zonder de herhaalde labels en zonder de
    // uitgeschreven duiding: de zwakste factor is de kortste balk en het signaal zit in het
    // icoon (met de tekst in de title, zodat hij niet verdwijnt maar ook geen regel kost).
    return (
      <div className={`${COMPACT_RASTER} rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: KANAAL_KLEUR[kanaal] }} aria-hidden />
          <span className="truncate text-body font-semibold text-brand-gray" title={KANAAL_NAAM[kanaal]}>
            {KANAAL_NAAM[kanaal]}
          </span>
        </span>
        <span className="text-title font-bold tabular-nums text-right" style={{ color: kleur }}>
          {health.grade === "?" ? "—" : health.total}
        </span>
        {health.factors.map((f) => (
          <span
            key={f.name}
            className="flex min-w-0 items-center gap-1.5"
            title={`${f.name}: ${f.assessed ? `${f.score}/${f.maxScore}` : "niet beoordeeld"}`}
          >
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border/60">
              {/* Geen balk als de factor niet beoordeeld is: een balk op nul leest als "score
                  nul", terwijl er niet gemeten is. */}
              {f.assessed && (
                <span className={`block h-full rounded-full ${balkKleur(f.score)}`} style={{ width: `${(f.score / f.maxScore) * 100}%` }} />
              )}
            </span>
            <span className={`w-4 shrink-0 text-right text-micro tabular-nums ${f.assessed ? "text-brand-gray" : "text-muted-foreground/60"}`}>
              {f.assessed ? f.score : "—"}
            </span>
          </span>
        ))}
        <span className="flex justify-end" title={kritiek?.title}>
          {kritiek && (
            <AlertTriangle
              className={`w-3.5 h-3.5 shrink-0 ${kritiek.severity === "critical" ? "text-red-500" : "text-amber-500"}`}
              aria-label={kritiek.title}
            />
          )}
        </span>
      </div>
    );
  }

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
              {f.assessed && (
                <div
                  className={`h-full rounded-full ${balkKleur(f.score)}`}
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

/**
 * Eén kanaal, één score, geen eigen beeld.
 *
 * Dit is wat de lijst dynamisch maakt (zie "HOE DIT SCHAALT" bovenaan): de hookregels staan hier,
 * in een component dat PER KANAAL bestaat, en niet in de ouder waar ze per kanaal herhaald zouden
 * moeten worden. React's regel is dat een component bij elke render dezelfde hooks in dezelfde
 * volgorde aanroept -- dat mag hier, want dit component gaat maar over één kanaal.
 *
 * Google leest uit de provider die de pagina toch al vult (ClientDataProvider), niet uit een eigen
 * call: die heeft de live Google-API al bevraagd. De andere kanalen gaan via
 * /api/analysis/channel-forecast. `enabled` staat daarom uit voor Google -- anders zou hij zijn
 * eigen data twee keer ophalen.
 */
function KanaalScoreBron({ clientId, kanaal, meld }: {
  clientId: string;
  kanaal: Kanaal;
  meld: (kanaal: Kanaal, health: HealthScore | null) => void;
}) {
  const isGoogle = kanaal === "google";
  const googleData = useClientHistoricalData(clientId);
  const googleForecast = useForecast();
  const { forecast: kanaalForecast } = useChannelForecast(clientId, kanaal, !isGoogle);

  const health = useMemo(() => {
    // Zonder de Google-specifieke hygiëne-argumenten (impressionShare, zoektermen, ad groups):
    // die zijn hier niet beschikbaar en computeHealthScore zou die factor dan stilzwijgend vol
    // punten geven. Dezelfde correctie die channel-health-badge.tsx voor Meta/LinkedIn doet --
    // en juist hier moet hij, want anders scoort Google hoger dan de rest om een reden die
    // niets met het account te maken heeft.
    const forecast = isGoogle
      ? (googleForecast ?? (googleData ? computeForecast(googleData) : null))
      : kanaalForecast;
    if (!forecast) return null;
    return zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast));
  }, [isGoogle, googleForecast, googleData, kanaalForecast]);

  useEffect(() => { meld(kanaal, health); }, [meld, kanaal, health]);
  // Verdwijnt het kanaal (andere klant, andere kanalenlijst), dan moet zijn score mee weg --
  // anders blijft er een rij staan voor een kanaal dat niet meer wordt opgehaald.
  useEffect(() => () => meld(kanaal, null), [meld, kanaal]);

  return null;
}
