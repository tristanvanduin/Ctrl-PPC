"use client";

import { useState } from "react";
import { Calendar, Target, Globe, LayoutGrid, TrendingUp, Sparkles, AlertTriangle, Users, Gauge } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { Sectie } from "@/components/ui/sectie";
import { HealthBadge } from "./health-badge";
import { SearchScorecard } from "./search-scorecard";
import { PmaxScorecard } from "./pmax-scorecard";
import { EventPacing } from "./event-pacing";
import { GeoCloneOverview } from "./geo-clone-overview";
import { ClientNotes } from "./client-notes";
import { MonthlyOverview } from "./monthly-overview";
import { FairWeeksOverview } from "./fair-weeks-overview";
import { PacingMonitor } from "./pacing-monitor";
import { MetricCards } from "./metric-cards";
import { PerformanceChart } from "./performance-chart";
import { GeoChannelMatrix } from "./geo-channel-matrix";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { VideoPerformance } from "./video-performance";
import { PmaxNetworkSplit } from "./pmax-network-split";
import { CampaignTypeSplit } from "./campaign-type-split";
import { MonthlyTrendBars } from "./monthly-trend-bars";
import { PmaxAssetCoverage } from "./pmax-asset-coverage";
import { VideoPlacements } from "./video-placements";
import { CampaignTable } from "./campaign-table";
import { CreativePerformance } from "./creative-performance";
import { SearchTermsTable } from "./search-terms-table";
import { ForecastTable } from "./forecast-table";
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
  const opties: { id: "beurs" | "maand"; label: string }[] = [
    { id: "beurs", label: "Weken tot beurs" },
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
  // Eén hook-aanroep voor de hele opener: GeoMapCard en GeoRanglijstCard staan straks in twee
  // verschillende kolommen maar moeten dezelfde metric-keuze en VS-drilldown-state delen (17.36).
  // `enabled: !geoClone` slaat de fetch over zolang de geo-kloon-weergave rendert, die deze state
  // niet gebruikt.
  const geo = useGeoBreakdown({ clientId, channel: "google", enabled: !geoClone });

  return (
    <>
      <HealthBadge clientId={clientId} />
      {geoClone ? (
        // Beurs gekozen: her-geaggregeerd beursoverzicht (uit campagnedata) i.p.v. de
        // account-brede kaarten, die niet per beurs te splitsen zijn.
        <>
          {/* Event-relatieve pacing: opbouw tot nu vs dezelfde afstand tot de vorige editie. */}
          <EventPacing clientId={clientId} geoClone={geoClone} />
          <GeoCloneOverview clientId={clientId} geoClone={geoClone} />
          <ClientNotes clientId={clientId} />
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

          {/* DE OPENER (17.36, vierde ronde: "dit kan toch een stuk groter binnen het blok" over
              de kaart, met een schets erbij -- de ranglijst verhuist naar de lege ruimte onder de
              donut, zodat de kaart ernaast helemaal alleen in zijn kolom staat. Kaart en ranglijst
              waren tot 17.35 nog altijd samen één component/state (GeoBreakdown); ze delen nu
              dezelfde useGeoBreakdown()-aanroep hier, éénmalig, en geven het resultaat als prop
              door aan GeoMapCard (rechts) en GeoRanglijstCard (links, onder de donut) -- anders
              lopen de metric-keuze en de VS-drilldown uit elkaar tussen de twee kolommen. */}
          <div className="hero-rij grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* `.hero-ring` blijft de marker voor globals.css' ":has(> .hero-ring:empty)"-regel:
                pas als hier écht niets in staat trekt de kolom rechts door naar de volle breedte.

                17.37: grid-stretch weer aan (het standaardgedrag, dus geen `items-start` meer
                nodig). Sinds de ranglijst-kaart hier links bij kwam (17.36) is die kolom bijna
                altijd de langste van de twee, en rechts bleef daardoor bladzij-achtergrond over
                onder de staafgrafiek -- "elimineer het witte gat rechtsonder". Stretch geeft
                `.hero-kaart` nu de rijhoogte, en de staafgrafiek erin (flex-1) vult het verschil
                gracieus op met hogere staven. Anders dan 17.35's probleem: toen was het de
                DONUTKAART die moest meegroeien (statische content, dus dood wit vlak); nu is het
                een grafiek, die schaalt gewoon mee. */}
            {/* 4/12 werd 5/12 (17.37, "40/60 i.p.v. 30/70"): met de ranglijst-kaart (17.36) staan
                hier nu drie kaarten in plaats van twee, en die verdienen ademruimte -- de kolom
                was er niet op berekend toen hij nog alleen pacing+donut droeg. */}
            <div className="hero-ring min-w-0 xl:col-span-5 flex flex-col gap-4">
              <PacingMonitor clientId={clientId} countryFilter={countryFilter} edition={edition} />
              <CampaignTypeSplit clientId={clientId} />
              <GeoRanglijstCard state={geo} />
            </div>
            <div className="hero-kaart min-w-0 xl:col-span-7 flex flex-col gap-4">
              {/* De land×kanaal-matrix alleen bij meerdere kanalen. Met één kanaal is het een
                  landentabel met één kolom -- dat is precies wat de kaart al toont, en de matrix
                  zou een "kanaalmix" beloven die niet bestaat. */}
              <GeoMapCard
                state={geo}
                verdieping={meerdereKanalen ? <GeoChannelMatrix clientId={clientId} /> : undefined}
              />
              {/* flex-1: de ranglijst-kaart ernaast (links) maakte die kolom meestal de langste
                  van de twee (17.36), dus blijft hier onderaan anders bladzij-achtergrond over.
                  Een staafgrafiek kan dat gracieus opvullen (hogere staven i.p.v. dode ruimte in
                  een kaartrand) -- zelfde afweging als 17.35, nu de andere kant op: NIET de
                  ranglijst-kaart laten meegroeien (die zou weer een leeg vlak onderin een lijst/
                  tabel geven), WEL de grafiek (die schaalt gewoon mee). */}
              <div className="flex-1 min-h-[130px]">
                <MonthlyTrendBars clientId={clientId} countryFilter={countryFilter} groeit />
              </div>
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
            {/* PacingMonitor staat sinds 17.33 in de opener hierboven, naast de donut -- hier
                blijft alleen de week-/maandvisualisatie over, die te breed is voor een kolom naast
                de donut. */}
            {beursAs
              ? <FairWeeksOverview clientId={clientId} countryFilter={countryFilter} edition={edition!} />
              : <MonthlyOverview clientId={clientId} countryFilter={countryFilter} />}
          </Sectie>

          <Sectie
            icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel={countryFilter ? `Jaaroverzicht 2026 — ${countryLabel(countryFilter)}` : "Jaaroverzicht 2026"}
            bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
          >
            <MetricCards clientId={clientId} countryFilter={countryFilter} />
            <PerformanceChart clientId={clientId} countryFilter={countryFilter} />
          </Sectie>

          {/* Video, PMax-netwerken en placements horen bij elkaar: het is allemaal "hoe ziet het
              budget eruit". De netwerkringen (PmaxNetworkSplit) staan hier en niet in de opener,
              want ze bestaan alleen bij Performance Max -- als PMax-specifieke verdieping onder
              de universele campagnetype-donut zijn ze op hun plek, in de opener zouden ze een
              account zonder PMax een lege plek laten zien. Elk van deze kaarten rendert niets als
              er geen data voor is, dus de sectie kan ook helemaal leeg blijven. */}
          <Sectie
            icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel="Waar het budget landt"
            bijschrift="Video, netwerken en placements"
          >
            <VideoPerformance clientId={clientId} />
            <PmaxNetworkSplit clientId={clientId} />
            <PmaxAssetCoverage clientId={clientId} />
            <VideoPlacements clientId={clientId} />
          </Sectie>

          <div className="mt-10">
            <ClientNotes clientId={clientId} />
          </div>
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
 * hebben er vandaag een -- de twee met genoeg echte data om zonder gok te bouwen (zie de koppen
 * van lib/search-scorecard.ts en lib/pmax-scorecard.ts). Shopping en Display tonen eerlijk dat ze
 * nog niet gebouwd zijn in plaats van een score te verzinnen -- dezelfde regel 3 uit de
 * vertrouwensdoctrine als overal elders in dit contract.
 */
function CampagneScorecard({ clientId, type }: { clientId: string; type: CampagneType }) {
  if (type === "SEARCH") return <SearchScorecard clientId={clientId} />;
  if (type === "PERFORMANCE_MAX") return <PmaxScorecard clientId={clientId} />;
  return (
    <div className="rounded-xl border border-dashed border-border p-5 text-meta text-muted-foreground">
      Nog geen scorecard voor {CAMPAGNE_TYPES.find((t) => t.id === type)?.label} — alleen Search en
      Performance Max zijn vandaag gebouwd (masterplan sectie 5.4).
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
        bijschrift="Hoe de creatives eruitzien en wat ze opleverden"
      >
        <CreativePerformance clientId={clientId} channel="google" />
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

/** De Prognose-tab voor Google Ads (alleen gerenderd buiten een gekozen geo-kloon). */
export function GoogleForecast({ clientId }: { clientId: string }) {
  return (
    <>
      {/* De prognose is het antwoord; het budgetscenario is wat je ermee doet.
          Twee onderwerpen, dus twee secties. */}
      <Sectie
        eerste
        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar dit jaar op uitkomt"
        bijschrift="Gerealiseerd plus prognose per maand, tegen het geschatte jaardoel (vorig jaar +10%)"
      >
        <ForecastTable clientId={clientId} />
      </Sectie>
      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat een budgetwijziging zou doen"
        bijschrift="Doorrekening van een hoger of lager mediabudget op dezelfde efficiëntie"
      >
        <BudgetScenario clientId={clientId} />
      </Sectie>
    </>
  );
}
