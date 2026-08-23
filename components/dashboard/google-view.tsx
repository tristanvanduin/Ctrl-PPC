"use client";

import { useState } from "react";
import { Calendar, Target, Globe, LayoutGrid, TrendingUp, Sparkles, AlertTriangle, Users, Gauge, SearchIcon } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import type { ForecastMetric } from "@/lib/forecast";
import { Sectie } from "@/components/ui/sectie";
import { HealthBadge } from "./health-badge";
import { ChannelViewHeader } from "./channel-view-header";
import { SearchScorecard } from "./search-scorecard";
import { PmaxScorecard } from "./pmax-scorecard";
import { DisplayScorecard } from "./display-scorecard";
import { ShoppingScorecard } from "./shopping-scorecard";
import { EventPacing } from "./event-pacing";
import { GeoCloneOverview } from "./geo-clone-overview";
import { MonthlyOverview } from "./monthly-overview";
import { FairWeeksOverview } from "./fair-weeks-overview";
import { PacingMonitor } from "./pacing-monitor";
import { MetricCards } from "./metric-cards";
import { PerformanceChart } from "./performance-chart";
import { GeoChannelMatrix } from "./geo-channel-matrix";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard, GeoRanglijstInKaart } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { VideoPerformance } from "./video-performance";
import { PmaxNetworkSplit } from "./pmax-network-split";
import { CampaignTypeSplit } from "./campaign-type-split";
import { MonthlyTrendBars } from "./monthly-trend-bars";
import { MonthlyTrendLine } from "./monthly-trend-line";
import { PmaxAssetCoverage } from "./pmax-asset-coverage";
import { VideoPlacements } from "./video-placements";
import { CampaignTable } from "./campaign-table";
import { CreativePerformance } from "./creative-performance";
import { CreativeDeepDive } from "./creative-deep-dive";
import { SearchTermsTable } from "./search-terms-table";
import { ForecastTable, ForecastSummaryTiles } from "./forecast-table";
import { BudgetScenario } from "./budget-scenario";
import { AudienceSplit } from "./audience-split";

// De Google-weergave, geëxtraheerd uit client-dashboard.tsx (was daar 1.070 van de 1.070 regels
// gedeeld met Meta, LinkedIn en blended). Zelfde verdeling als Meta en LinkedIn al hadden:
// GoogleView voor Overzicht, GoogleCampagnes voor Campagnes, GoogleForecast voor Prognose — zie
// de kop van meta-view.tsx, die letterlijk zegt "dezelfde verhuizing die bij Google al gedaan
// was". Deze drie namen zijn de vierde kant van diezelfde verdeling.
//
// PUUR VERPLAATST, GEEN GEDRAGSWIJZIGING. Elke sectie, elke kaart, elke voorwaarde staat er
// zoals hij in client-dashboard.tsx stond. Alleen de bronnen van client.id, clientData,
// countryFilter, tijdas en upcomingEdition zijn props geworden in plaats van closures over de
// staat van de oudercomponent — dat is wat een los bestand nodig heeft, niet een keuze over
// wat het scherm doet.

// De as-keuze bij de prestatiekaart, alleen gebruikt door GoogleView (bij een events-klant met
// een aankomende editie). Stond als losse functie in client-dashboard.tsx; had daar maar één
// aanroeper en die aanroeper verhuist nu mee.
function TijdasKeuze({ value, onChange }: { value: "beurs" | "maand"; onChange: (v: "beurs" | "maand") => void }) {
  // Label generiek ("event" i.p.v. "beurs"): de onderliggende data (client_settings.rai_events,
  // lib/events/standard-b2c-events.ts) ondersteunt al elk type moment (beurs, Black Friday, ...),
  // alleen deze knoptekst was nog beurs-specifiek getaald. Interne waarden ("beurs"/"maand")
  // blijven ongewijzigd -- dat raakt client-dashboard.tsx en de props hieronder, puur een
  // implementatiedetail zonder zichtbare betekenis.
  const opties: { id: "beurs" | "maand"; label: string }[] = [
    { id: "beurs", label: "Weken tot event" },
    { id: "maand", label: "Maanden" },
  ];
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
      {opties.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            value === o.id ? "bg-brand-blue text-white" : "text-muted-foreground hover:text-brand-blue-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface GoogleViewProps {
  clientId: string;
  geoClone: string | null;
  edition: UpcomingEdition | null;
  /** Alleen bepalend voor het bijschrift en de kanaalmix-verdieping bij Markten. */
  meerdereKanalen: boolean;
  detectedCountries: string[] | undefined;
  countryFilter: string | null;
  onCountryFilterChange: (value: string | null) => void;
  tijdas: "beurs" | "maand";
  onTijdasChange: (value: "beurs" | "maand") => void;
}

/** De Overzicht-tab voor Google Ads. */
export function GoogleView({
  clientId, geoClone, edition, meerdereKanalen, detectedCountries,
  countryFilter, onCountryFilterChange, tijdas, onTijdasChange,
}: GoogleViewProps) {
  const beursAs = edition !== null && tijdas === "beurs";
  // Eén hook-aanroep: GeoMapCard en GeoRanglijstCard staan in de nieuwe 2x2-indeling niet meer
  // naast elkaar maar boven/onder in dezelfde kolom (17.41 -- "als we deze in het gat plaatsen
  // kan de geo map breder"), en moeten nog steeds dezelfde metric-keuze en VS-drilldown delen.
  const geo = useGeoBreakdown({ clientId, channel: "google", enabled: !geoClone });
  // Feedback: "Jaaroverzicht-kaartjes klikbaar maken, dan de maandresultaten van dat element
  // tonen." MetricCards en PerformanceChart tonen al dezelfde vier metrics (Conversies/Omzet/
  // ROAS/CPA) naast elkaar; PerformanceChart had zijn metric-keuze als eigen interne state, dus
  // een klik op een kaartje kon 'm niet aansturen. Hier opgetild zodat beide dezelfde selectie
  // delen -- geen nieuwe grafiek nodig, alleen een gedeelde staat.
  const [jaaroverzichtMetric, setJaaroverzichtMetric] = useState<ForecastMetric>("conversions");

  return (
    <>
      {/* Zelfde kaart als Meta/LinkedIn (ChannelViewHeader, gebouwd "zodat ze dezelfde opbouw als
          de Google-weergave hebben" -- maar Google zelf gebruikte hem nooit. Toegevoegd 22 augustus
          2026 (feedback: "alle kanalen moeten een zelfde layout hebben... de structuur en layout
          moet exact hetzelfde voelen") zodat alle drie kanalen met dezelfde kop-kaart openen. */}
      <ChannelViewHeader
        icon={<SearchIcon className="w-5 h-5 text-brand-blue-ink" />}
        title="Google Ads"
        geoClone={geoClone}
        status={{ kind: "connected" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort.</>
            : <>Account-brede Google Ads-cijfers: kerncijfers, pacing, maandverloop, scorecards per campagnetype (Search, Performance Max, Shopping, Display) en de campagnes zelf.</>
        }
        delivers={["Scorecard per campagnetype", "Zoektermen en ad groups die weglekken", "Doelgroepsignalen", "Video & placements", "Advertenties en creative-vermoeidheid"]}
        analysesHint={
          meerdereKanalen
            ? <>De Google-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong> → Google.</>
            : <>De Google-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong>.</>
        }
      />

      {geoClone && <HealthBadge clientId={clientId} />}

      {geoClone ? (
        // Beurs gekozen: her-geaggregeerd beursoverzicht (uit campagnedata) i.p.v. de
        // account-brede kaarten, die niet per beurs te splitsen zijn.
        <>
          {/* Event-relatieve pacing: opbouw tot nu vs dezelfde afstand tot de vorige editie. */}
          <EventPacing clientId={clientId} geoClone={geoClone} />
          <GeoCloneOverview clientId={clientId} geoClone={geoClone} />
        </>
      ) : (
        <>
          {/* Country filter for dashboard (only if multi-country) */}
          {detectedCountries && detectedCountries.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <button
                onClick={() => onCountryFilterChange(null)}
                className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                  countryFilter === null ? "bg-brand-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-brand-gray"
                }`}
              >
                Alle landen
              </button>
              {detectedCountries.map((code) => (
                <button
                  key={code}
                  onClick={() => onCountryFilterChange(countryFilter === code ? null : code)}
                  className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                    countryFilter === code ? "bg-brand-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-brand-gray"
                  }`}
                >
                  {countryLabel(code)}
                </button>
              ))}
            </div>
          )}

          {/* DE OPENER (23 augustus 2026, teruggezet): 50/50, Account Health naast de wereldkaart --
              expliciete correctie op de eerdere 5/7-donut/kaart-indeling van vandaag, die de kaart
              te ver van Account Health had gezet. Zelfde 2-koloms opbouw als de oorspronkelijke
              Google-opener: links Health + Pacing + campagnetype-donut + CPA-lijn, rechts de kaart +
              ranglijst + maandstaven. Meta en LinkedIn krijgen dezelfde 50/50-indeling (health naast
              kaart), zie meta-view.tsx/linkedin-view.tsx. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-stretch">
            {/* PACING ONDER HEALTH, IN DEZELFDE CEL. Account Health vult zijn cel niet: de radar
                plus de score-uitsplitsing eindigt ruim boven de onderrand, en de cel rekt mee met
                de kaartcel ernaast. Dat gat is met echte data gevuld i.p.v. met rek -- pacing hoort
                er inhoudelijk ook bij ("hoe sta ik ervoor" naast "hoe gezond is het account"). */}
            <HealthBadge clientId={clientId} />
            {/* De landenranglijst hangt in de kaart (GeoRanglijstInKaart): gemeten is Health
                638px en de kale kaart 437px, en die balken vullen dat gat met inhoud die er
                inhoudelijk hoort. De land×kanaal-matrix alleen bij meerdere kanalen -- met één
                kanaal is het een landentabel met één kolom, precies wat de kaart al toont. */}
            <GeoMapCard
              state={geo}
              verdieping={
                <>
                  <GeoRanglijstInKaart state={geo} />
                  {meerdereKanalen ? <GeoChannelMatrix clientId={clientId} /> : null}
                </>
              }
            />
            {/* TWEEDE RIJ VAN DE HERO. Als losse cellen en niet als twee kolom-divs: rastercellen
                in dezelfde RIJ rekken naar dezelfde hoogte, dus elke rij lijnt apart uit. Twee
                lange kolommen daarentegen komen alleen bij toeval gelijk uit -- dat was het
                probleem in 17.114/17.115.

                Pacing vult het gat onder Account Health (de radar plus score-uitsplitsing eindigt
                ruim boven de onderrand) en hoort er inhoudelijk bij: "hoe sta ik ervoor" naast
                "hoe gezond is het". De campagnetype-ringen ernaast beantwoorden "waar gaat het
                geld heen", wat aansluit op de kaart erboven. */}
            <PacingMonitor clientId={clientId} countryFilter={countryFilter} edition={edition} />
            <CampaignTypeSplit clientId={clientId} />
          </div>

          {/* Wat eerst als tweede t/m vierde kaart in de hero-kolommen stond. Raster van gelijke
              cellen i.p.v. twee onafhankelijke kolommen: cellen in dezelfde rij rekken naar dezelfde
              hoogte, dus geen scheve onderrand meer. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Pacing stond hier; die is naar de hero verhuisd (zie hierboven). De CPA-lijn neemt
                zijn plek in, zodat de bovenste rij vol blijft. */}
            <MonthlyTrendLine clientId={clientId} countryFilter={countryFilter} />
            <GeoRanglijstCard state={geo} zonderBalken />
            {/* Drie kaarten in DRIE kolommen liet de derde cel van de bovenste rij leeg -- op
                1600px een wit vlak van een halve schermbreedte naast "Conversies per land".
                Twee kolommen vult die rij precies, en de maandstaven eronder over de volle
                breedte: een staafgrafiek per maand wint bij extra breedte, dus dat is geen
                opvulling maar de betere plek voor juist deze kaart. */}
            <div className="lg:col-span-2">
              <MonthlyTrendBars clientId={clientId} countryFilter={countryFilter} />
            </div>
          </div>

          <Sectie
            icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel={
              (beursAs ? "Prestaties richting de beurs" : "Maandprestaties")
              + (countryFilter ? ` — ${countryLabel(countryFilter)}` : "")
            }
            bijschrift={beursAs
              ? `Per week: hoeveel weken zijn we van ${edition!.eventName} en lopen we op schema?`
              : "Per maand: waar staan we en wat is de trend?"}
            actie={edition && <TijdasKeuze value={tijdas} onChange={onTijdasChange} />}
          >
            {beursAs
              ? <FairWeeksOverview clientId={clientId} countryFilter={countryFilter} edition={edition!} />
              : <MonthlyOverview clientId={clientId} countryFilter={countryFilter} />}
          </Sectie>

          <Sectie
            icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel={countryFilter ? `Jaaroverzicht 2026 — ${countryLabel(countryFilter)}` : "Jaaroverzicht 2026"}
            bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
          >
            <MetricCards clientId={clientId} countryFilter={countryFilter} selected={jaaroverzichtMetric} onSelect={setJaaroverzichtMetric} />
            <PerformanceChart clientId={clientId} countryFilter={countryFilter} metric={jaaroverzichtMetric} onMetricChange={setJaaroverzichtMetric} />
          </Sectie>

          {/* Feedback punt 29+31: PmaxNetworkSplit was hier al gemarkeerd als PMax-only ("ze
              bestaan alleen bij Performance Max"), maar stond toch op Overzicht i.p.v. onder de
              Campagnes-tab se PERFORMANCE_MAX-selectie. Verhuisd naar GoogleCampagnes, in de
              Scorecard-sectie naast PmaxAssetCoverage -- exact hetzelfde argument dat destijds al
              voor PmaxAssetCoverage gold: een PMax-specifieke structuurvraag hoort bij de andere
              PMax-structuurvraag, niet als losse kaart op de algemene Overzicht-pagina.

              Video (VideoPerformance/VideoPlacements) blijft bewust hier staan: video-/Demand
              Gen-campagnes hebben in de echte data een eigen campaign_type ("VIDEO") dat niet
              voorkomt in CAMPAGNE_TYPES hieronder (die vier zijn gemeten tegen
              ads_campaign_impression_share, een andere tabel, en dekken alleen SEARCH/
              PERFORMANCE_MAX/SHOPPING/DISPLAY). Een vijfde tab toevoegen voor uitsluitend video
              is een eigen ontwerpvraag -- welke tabs verder nog meeveranderen (Scorecard,
              CampaignTable-filter, Zoektermen) -- die niet stilzwijgend hier meegenomen wordt. */}
          <Sectie
            icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel="Waar het budget landt"
            bijschrift="Video en placements"
          >
            <VideoPerformance clientId={clientId} />
            <VideoPlacements clientId={clientId} />
          </Sectie>
        </>
      )}
    </>
  );
}

interface GoogleCampagnesProps {
  clientId: string;
  geoClone: string | null;
  countryFilter: string | null;
  onCountryFilterChange: (value: string | null) => void;
}

// campaign_type-waarden zoals ze echt in ads_campaign_impression_share staan (nagemeten
// 15 augustus 2026): SEARCH, PERFORMANCE_MAX, SHOPPING, DISPLAY.
type CampagneType = "SEARCH" | "PERFORMANCE_MAX" | "SHOPPING" | "DISPLAY";
const CAMPAGNE_TYPES: { id: CampagneType; label: string }[] = [
  { id: "SEARCH", label: "Search" },
  { id: "PERFORMANCE_MAX", label: "Performance Max" },
  { id: "SHOPPING", label: "Shopping" },
  { id: "DISPLAY", label: "Display" },
];

/** Zelfde pil-stijl als de kanaalkiezer in client-dashboard.tsx (ChannelTabs) -- een tweede
 *  filteras naast kanaal, geen nieuwe visuele taal ernaast. */
function CampagneTypeTabs({ type, onChange }: { type: CampagneType; onChange: (t: CampagneType) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
      {CAMPAGNE_TYPES.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            type === t.id ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Sectie 5.4 (Campaign Type Intelligence): per campagnetype zijn eigen scorecard. Search en PMax
 * waren de eerste twee; Shopping en Display zijn hier bijgekomen, elk met een eigen opbouw (zie
 * de koppen van lib/display-scorecard.ts en lib/shopping-scorecard.ts) en een factor die eerlijk
 * "niet beoordeeld" blijft waar de data ontbreekt (viewability resp. Merchant Center-feedkwaliteit)
 * -- regel 3 van de vertrouwensdoctrine, geen gegokte score.
 */
function CampagneScorecard({ clientId, type }: { clientId: string; type: CampagneType }) {
  if (type === "SEARCH") return <SearchScorecard clientId={clientId} />;
  if (type === "PERFORMANCE_MAX") return <PmaxScorecard clientId={clientId} />;
  if (type === "DISPLAY") return <DisplayScorecard clientId={clientId} />;
  if (type === "SHOPPING") return <ShoppingScorecard clientId={clientId} />;
  return (
    <div className="rounded-xl border border-dashed border-border p-5 text-meta text-muted-foreground">
      Nog geen scorecard voor {CAMPAGNE_TYPES.find((t) => t.id === type)?.label} (masterplan sectie 5.4).
    </div>
  );
}

/** De Campagnes-tab voor Google Ads: scorecard per campagnetype, wat draait er, de advertenties
 *  zelf, en waar het weglekt. */
export function GoogleCampagnes({ clientId, geoClone, countryFilter, onCountryFilterChange }: GoogleCampagnesProps) {
  const [campagneType, setCampagneType] = useState<CampagneType>("SEARCH");
  return (
    <div>
      <Sectie
        eerste
        icoon={<Gauge className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Scorecard"
        bijschrift="Hoe gezond is dit campagnetype — vijf factoren, per type verschillend"
        actie={<CampagneTypeTabs type={campagneType} onChange={setCampagneType} />}
      >
        <CampagneScorecard clientId={clientId} type={campagneType} />
        {/* Assetdekking en netwerkverdeling zijn allebei PMax-eigen structuurvragen ("wat heb je
            aangeleverd", "waar draait het") en horen dus bij de PMax-scorecard, niet bij Search.
            Allebei verhuisd hierheen vanuit "Waar het budget landt" op Overzicht -- zie de
            toelichting daar. */}
        {campagneType === "PERFORMANCE_MAX" && (
          <>
            <PmaxAssetCoverage clientId={clientId} />
            <PmaxNetworkSplit clientId={clientId} />
          </>
        )}
      </Sectie>
      {/* Twee vragen, twee secties. Wat draait er, en waar lekt het weg — dat laatste
          is geen detail van het eerste maar een eigen onderwerp met een eigen actie. */}
      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat er draait"
        bijschrift="Alle campagnes van dit account over de laatste 30 dagen"
      >
        <CampaignTable clientId={clientId} geoClone={geoClone} countryFilter={countryFilter} onCountryFilterChange={onCountryFilterChange} />
      </Sectie>
      {/* Wie de campagnes bereiken, tussen "wat draait er" en "hoe zien de advertenties eruit" --
          de doelgroepmix is een targeting-vraag, geen creative-vraag, en hoort dus vóór de
          advertenties zelf. Rendert niets zonder doelgroepdata (bv. alleen Performance Max zonder
          expliciete signalen), dus de sectie kan leeg blijven zoals de andere kaarten hier ook
          stil zijn zonder data. */}
      <Sectie
        icoon={<Users className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Doelgroepsignalen"
        bijschrift="Welk type doelgroep de campagnes bereikt, en wat het oplevert"
      >
        <AudienceSplit clientId={clientId} />
      </Sectie>
      {/* De advertenties zelf horen hier en niet op Overzicht.
          Ze stonden in de sectie "Waar het budget landt", samen met video, netwerken
          en placements: vier onderwerpen onder één kop, samen 1.872 pixels — ruim
          anderhalf scherm en zesendertig procent van de hele pagina. Dit blok was het
          grootste (616px) én het enige dat inhoudelijk ergens anders thuishoort: een
          advertentie is waar een campagne uit bestaat, niet waar een budget landt.
          Overzicht wordt hier een derde korter zonder dat er iets verdwijnt. */}
      <Sectie
        icoon={<Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Hoe de creatives eruitzien, wat ze opleverden, en of ze vermoeid raken"
      >
        <CreativePerformance clientId={clientId} channel="google" />
        {/* Vermoeidheid + asset-uitsplitsing verhuisd van Bevindingen hierheen (feedback 22
            augustus): dit is waar je al naar de creatives zelf kijkt, dus hier hoort ook te staan
            of ze verslijten -- niet op een aparte pagina, drie kaarten ver uit elkaar. */}
        <CreativeDeepDive clientId={clientId} channel="google" />
      </Sectie>
      <Sectie
        icoon={<AlertTriangle className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar het weglekt"
        bijschrift="Zoektermen, ad groups en producten die kosten maken zonder conversie"
      >
        <SearchTermsTable clientId={clientId} geoClone={geoClone} countryFilter={countryFilter} />
      </Sectie>
    </div>
  );
}

/**
 * De Prognose-tab voor Google Ads (alleen gerenderd buiten een gekozen geo-kloon).
 *
 * Volgorde uniform met Meta/LinkedIn (feedback 22 augustus: "dit moet voor elk kanaal de layout
 * worden"): eerst het antwoord op "waar komen we uit" (hier: ForecastSummaryTiles, het Google-
 * equivalent van Meta/LinkedIn's Lopende-/Volgende-maand-tegels), dan het budgetscenario, dan pas
 * de detailtabel. Stond hiervoor als tabel-eerst-dan-slider -- de jaarprognose en bandbreedte
 * zaten als voetregels ONDER de tabel, dus je moest voorbij de slider scrollen om ze te missen.
 */
export function GoogleForecast({ clientId }: { clientId: string }) {
  return (
    <>
      <Sectie
        eerste
        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar dit jaar op uitkomt"
        bijschrift="Jaarprognose tegen het geschatte jaardoel (vorig jaar +10%)"
      >
        <ForecastSummaryTiles clientId={clientId} />
      </Sectie>
      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat een budgetwijziging zou doen"
        bijschrift="Doorrekening van een hoger of lager mediabudget op dezelfde efficiëntie"
      >
        <BudgetScenario clientId={clientId} />
      </Sectie>
      <Sectie
        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Maandelijkse uitsplitsing"
        bijschrift="Gerealiseerd plus prognose per maand"
      >
        <ForecastTable clientId={clientId} />
      </Sectie>
    </>
  );
}
