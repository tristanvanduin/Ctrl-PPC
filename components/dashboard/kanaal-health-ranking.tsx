"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useClientDataState, useForecast } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene, type HealthScore, type HealthFactor } from "@/lib/health-score";
import { useBlendedClientData, type PerKanaalTab } from "@/lib/use-blended-client-data";
import { KANAAL_NAAM, KANAAL_KLEUR, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { Laadvlak } from "@/components/ui/laadvlak";
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
 * 1. DE BRON. Er stond één ophaalregel per kanaal, eerst plat naast elkaar en daarna als een
 *    onzichtbaar kind per kanaal dat een eigen prognoseroute vroeg en zijn score naar boven
 *    meldde: drie verzoeken van samen 57,6 kB bij het laden en bij elke terugkeer naar dit
 *    tabblad, voor drie scores van een paar honderd bytes. En het was een ANDERE prognose dan die
 *    op het tabblad van het kanaal zelf (fact_core met de standaardselectie, gerealiseerd t/m de
 *    vorige kalendermaand, het Google-doel als jaardoel). Sinds fase 1, stap 5 leest deze kaart
 *    het tab-object per kanaal uit useBlendedClientData (perKanaalTab): hetzelfde object dat de
 *    kanaaltab en zijn health-badge lezen, één keer per ophaalronde berekend en vijf minuten
 *    bewaard. Nul verzoeken, en de score hier is per constructie de score op de tab
 *    (lib/__kanaaltab_gelijk_alle_kanalen_test.ts). Een nieuw kanaal kost hier niets: het komt
 *    uit `kanalen` binnen en zijn score uit de route.
 *
 * 2. DE HOOGTE. Een kanaalblok is ~70px hoog. Drie passen naast de radar (220px); zes zouden de
 *    kaart naar ~430px aan regels duwen, en deze kaart staat in de linkerkolom naast de
 *    wereldkaart — alles wat hij extra groeit, wordt wit aan de andere kant. Vanaf vier kanalen
 *    schakelt de lijst daarom naar een compacte vorm: de vijf factornamen staan één keer als
 *    kopregel boven de lijst in plaats van bij elk kanaal opnieuw, en een regel is ~34px. Zes
 *    kanalen passen dan in dezelfde hoogte als drie nu.
 *
 * Wat er BUITEN dit bestand nog nodig is voor een echt volgend kanaal: een `Kanaal`-waarde met zijn
 * bron, naam en kleur in lib/kanalen/beschikbaar.ts, en zijn dagtabel in de blended route
 * (DAGKANALEN in lib/api/blended-historical.ts, NIET_GOOGLE in lib/period/kanaal-maanden.ts).
 * Daarna verschijnt het kanaal hier vanzelf. Microsoft staat er daardoor nu ook: de oude route las
 * de gezamenlijke feitentabel, waar Microsoft bewust geen projectie heeft (migratie 106), en gaf
 * voor dat kanaal altijd niets terug; de dagtabellen dragen het wel.
 *
 * Google leest zijn prognose uit ClientDataProvider (useForecast), niet uit de route: die heeft de
 * live Google-API al bevraagd, en zo blijft de score hier op dezelfde prognose staan als de
 * Account Health op het Google-tabblad.
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

/** Wat de kaart per kanaal weet: een score, nog onderweg, of niets om te beoordelen. */
export interface KanaalScores {
  /** De kanalen met een score, de sterkste bovenaan en "te weinig beoordeeld" onderaan. */
  rijen: { kanaal: Kanaal; health: HealthScore }[];
  /** De route is nog onderweg: geen uitspraak, wel een plek in de lijst. */
  laden: Kanaal[];
  /** De route is klaar en er is geen score: geen dagcijfers, of de route faalde. */
  nietBeoordeeld: Kanaal[];
}

/**
 * Welk kanaal welke score krijgt. Zuiver, en geëxporteerd voor de invariant-test: de health van een
 * dagkanaal is HET OBJECT uit perKanaalTab (geen kopie, geen herberekening), dus wat hier staat is
 * wat ChannelHealthBadge op de tab van dat kanaal toont.
 *
 * "Laden" en "geen score" zijn hier twee toestanden. Eerder was een kanaal zonder antwoord gewoon
 * afwezig, en dan viel een kanaal dat nog onderweg was niet te onderscheiden van een kanaal waar
 * niets over te zeggen valt (zo ontbrak Microsoft stil onder een kop die "per kanaal" belooft).
 */
export function kanaalScores(
  kanalen: readonly Kanaal[],
  googleHealth: HealthScore | null,
  route: { perKanaalTab: PerKanaalTab | null; loading: boolean },
): KanaalScores {
  const rijen: KanaalScores["rijen"] = [];
  const laden: Kanaal[] = [];
  const nietBeoordeeld: Kanaal[] = [];
  for (const kanaal of kanalen) {
    if (kanaal === "google") {
      if (googleHealth) rijen.push({ kanaal, health: googleHealth });
      else nietBeoordeeld.push(kanaal);
      continue;
    }
    const tab = route.perKanaalTab?.[kanaal];
    if (tab && tab !== "leeg") rijen.push({ kanaal, health: tab.health });
    else if (route.loading) laden.push(kanaal);
    else nietBeoordeeld.push(kanaal);
  }
  // Kanalen zonder cijfer ("?") onderaan, niet bovenaan: een onbekende score is geen nul, maar
  // hij hoort ook niet tussen de beoordeelde kanalen in te dringen.
  rijen.sort((a, b) => {
    if (a.health.grade === "?" && b.health.grade !== "?") return 1;
    if (b.health.grade === "?" && a.health.grade !== "?") return -1;
    return b.health.total - a.health.total;
  });
  return { rijen, laden, nietBeoordeeld };
}

export function KanaalHealthRanking({ clientId, kanalen }: { clientId: string; kanalen: Kanaal[] }) {
  // Google uit de provider die de pagina toch al vult. useClientDataState en niet
  // useClientHistoricalData: die laatste gooit buiten een provider, en dan nam één ontbrekende
  // Google-bron de scores van de andere kanalen mee.
  const googleData = useClientDataState()?.data ?? null;
  const googleForecast = useForecast();
  const heeftGoogle = kanalen.includes("google");
  const googleHealth = useMemo(() => {
    if (!heeftGoogle) return null;
    const forecast = googleForecast ?? (googleData ? computeForecast(googleData) : null);
    // Zonder de Google-specifieke hygiëne-argumenten (impressionShare, zoektermen, ad groups):
    // die zijn hier niet beschikbaar en computeHealthScore zou die factor dan stilzwijgend vol
    // punten geven. Dezelfde correctie die de hook voor de dagkanalen doet (KanaalTab.health) --
    // en juist hier moet hij, want anders scoort Google hoger dan de rest om een reden die
    // niets met het account te maken heeft.
    return forecast ? zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) : null;
  }, [heeftGoogle, googleForecast, googleData]);

  // Hetzelfde verzoek als de KPI-band en het tabblad eromheen (de hook deelt en bewaart het).
  // Alleen als er een dagkanaal in de lijst staat: Google alleen heeft de route niet nodig.
  const route = useBlendedClientData(clientId, kanalen.some((k) => k !== "google"));
  const { rijen, laden, nietBeoordeeld } = useMemo(
    () => kanaalScores(kanalen, googleHealth, { perKanaalTab: route.perKanaalTab, loading: route.loading }),
    [kanalen, googleHealth, route.perKanaalTab, route.loading],
  );

  if (kanalen.length === 0) return null;
  // Nog geen enkele score en de route is onderweg: het skelet van de kaart, zodat de kolom zijn
  // hoogte al heeft. Hier stond niets tot de eerste score er was.
  if (rijen.length === 0 && laden.length > 0) {
    return <Laadvlak vorm="tekst" regels={kanalen.length} titel="Account Health per kanaal" />;
  }

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
  // Een as telt alleen mee voor de kanalen die hem beoordeeld hebben. Hygiëne staat in deze
  // vergelijking voor elk kanaal op "niet beoordeeld", en Budget voor een kanaal zonder budgetdoel
  // en zonder vorig jaar; die als nul meenemen zou het gemiddelde omlaag trekken om een reden die
  // niets met de prestatie te maken heeft. Meet geen enkel kanaal een as, dan is de as ook voor
  // het gemiddelde niet beoordeeld en tekent de radar er geen punt.
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

  // Op het aantal REGELS, met en zonder score: de vorm verspringt dan niet als de route
  // binnenkomt en een wachtende regel zijn score krijgt.
  const compact = rijen.length + laden.length + nietBeoordeeld.length >= COMPACT_VANAF;
  const factornamen = rijen[0]?.health.factors.map((f) => f.name) ?? [];
  const waaromGeenScore = (kanaal: Kanaal): string =>
    kanaal === "google" ? "niet beoordeeld: geen Google-cijfers geladen"
      : route.error ? "niet beoordeeld: de kanaalcijfers konden niet geladen worden"
      : "niet beoordeeld: geen dagcijfers om een prognose op te bouwen";

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
        <div className={`flex min-w-0 flex-1 flex-col ${compact ? "gap-1.5" : "gap-4"}`}>
          {/* De factornamen één keer, niet bij elk kanaal opnieuw. Dat is de hele winst van de
              compacte vorm: de namen zijn voor elk kanaal identiek, dus vanaf vier kanalen is het
              herhaalde label puur hoogte. */}
          {compact && factornamen.length > 0 && (
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
          {/* Een kanaal zonder score staat er WEL, met de reden. Weglaten las als "dit kanaal
              bestaat hier niet", en dat was voor een kanaal dat nog onderweg is en voor een kanaal
              zonder cijfers hetzelfde lege beeld. */}
          {laden.map((kanaal) => (
            <KanaalZonderScore key={kanaal} kanaal={kanaal} tekst="score wordt berekend" compact={compact} />
          ))}
          {nietBeoordeeld.map((kanaal) => (
            <KanaalZonderScore key={kanaal} kanaal={kanaal} tekst={waaromGeenScore(kanaal)} compact={compact} />
          ))}
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        De radar is het gemiddelde per as over de kanalen die die as meten. Een as die voor een
        kanaal niet beoordeeld is, telt daar niet mee: Hygiëne (verspilling op zoektermen en ad
        groups) staat alleen op het Google-tabblad, en Budget vraagt een budgetdoel of een vorig
        jaar. Dat kan omdat de assen al genormaliseerd zijn: elk kanaal is tegen zijn eigen
        maatstaf beoordeeld, met dezelfde prognose als op zijn eigen tabblad. Wat er bewust níét
        staat is één samengesteld cijfer over de spend van alle kanalen samen: dat zou tegen één
        doel moeten meten, en een doel dat voor het ene kanaal gezet is zegt niets over het andere.
      </p>
    </div>
  );
}

/** Een kanaal waar (nog) geen score voor is: dezelfde stip en naam als een gewone regel, en de
 *  reden op de plek van het cijfer. Gestippelde rand: dit is een open plek, geen meting. */
function KanaalZonderScore({ kanaal, tekst, compact }: { kanaal: Kanaal; tekst: string; compact: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-border/70 px-3 ${compact ? "py-1.5" : "py-2.5"}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: KANAAL_KLEUR[kanaal] }} aria-hidden />
      <span className={`${compact ? "text-body" : "text-title"} font-semibold text-brand-gray`}>{KANAAL_NAAM[kanaal]}</span>
      <span className="text-meta text-muted-foreground">{tekst}</span>
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
