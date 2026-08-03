"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, Settings, Calendar, Target, Loader2, AlertTriangle, Wifi, Clock, LayoutGrid, Lightbulb, TrendingUp, FolderOpen, Users, Kanban, ClipboardCheck, FileText, Globe, Megaphone, Briefcase, Layers, Sparkles } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import { SyncStatusBadge } from "./sync-status-badge";
import { getClientSettings } from "@/lib/client-settings";
import { SecondOpinionView } from "./second-opinion-view";
import { MetricCards } from "./metric-cards";
import { MonthlyOverview } from "./monthly-overview";
import { FairWeeksOverview } from "./fair-weeks-overview";
import { AnalysisOverview } from "./analysis-overview";
import { useUpcomingEdition } from "@/lib/rai/use-upcoming-edition";
import { PerformanceChart } from "./performance-chart";
import { ClientSettingsPanel } from "./client-settings";
import { InsightsBlock } from "../insights/insights-block";
import { RecommendationsBlock } from "../insights/recommendations-block";
import { TasksBlock } from "../insights/tasks-block";
import { TaskImpactReminder } from "../insights/task-impact-reminder";
import { SopTriggerButtons, type SopError } from "../insights/sop-trigger-buttons";
import { StandaloneAnalyses } from "../insights/standalone-analyses";
import { HypothesesBlock } from "../insights/hypotheses-block";
import { ProposalQueue } from "../insights/proposal-queue";
import { ChannelFilter } from "../insights/channel-filter";
import { MetaCreativeAnalyses } from "../insights/meta-creative-analyses";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { CrossChannelAnalyses } from "./cross-channel-analyses";
import { CreativePerformance } from "./creative-performance";
import { ChannelForecast } from "./channel-forecast";
import { CreativeDeepDive } from "./creative-deep-dive";
import { DEMO_GREENTECH_ID } from "@/lib/demo/greentech-mock";
import type { InsightChannel } from "@/lib/insights/channel-of";
import { PeriodProvider, usePeriod } from "@/lib/period/period-context";
import { PeriodSelector } from "./period-selector";
import { PeriodSummary } from "./period-summary";
import { SprintPlanning } from "../insights/sprint-planning";
import { CampaignTable } from "./campaign-table";
import { SearchTermsTable } from "./search-terms-table";
import { HealthBadge } from "./health-badge";
import { PacingMonitor } from "./pacing-monitor";
import { ClientNotes } from "./client-notes";
import { ForecastTable } from "./forecast-table";
import { BudgetScenario } from "./budget-scenario";
import { ClientFiles } from "./client-files";
import { DgmView } from "./dgm-view";
import { MetaView } from "./meta-view";
import { LinkedInView } from "./linkedin-view";
import { CrossChannelView } from "./cross-channel-view";
import { CampaignsPerChannel } from "./campaigns-per-channel";
import { BrandingView } from "./branding-view";
import { EventSettings } from "./event-settings";
import { GeoCloneSettingsPanel } from "./geo-clone-settings";
import { ChannelConversionSettings } from "./channel-conversion-settings";
import { ChannelStructureAnalysis } from "./channel-structure-analysis";
import { GeoCloneScope } from "./geo-clone-scope";
import { GeoCloneOverview } from "./geo-clone-overview";
import { EventPacing } from "./event-pacing";
import { GeoBreakdown } from "./geo-breakdown";
import { GeoChannelMatrix } from "./geo-channel-matrix";
import { VideoPerformance } from "./video-performance";
import { VideoPlacements } from "./video-placements";
import { PmaxNetworkSplit } from "./pmax-network-split";
import { TrackingAlert } from "./tracking-alert";
import { ClientReporting } from "./client-reporting";
import { BrandThemeProvider } from "../branding/brand-theme-provider";
import { BrandHeaderBar } from "../branding/brand-header-bar";
import { useClientData } from "@/lib/use-client-data";
import { ClientDataProvider } from "@/lib/client-data-provider";
import { AnalysisProvider } from "@/lib/analysis-context";
import { Sectie } from "@/components/ui/sectie";

interface Client {
  id: string;
  name: string;
  source?: string;
}

type Tab = "dashboard" | "campaigns" | "forecast" | "insights" | "outcomes" | "sprint" | "reporting" | "dgm" | "second-opinion" | "files" | "settings";


// De as-keuze bij de prestatiekaart. Alleen zichtbaar als er een beurs is om naartoe te tellen;
// zonder beurs is er niets te kiezen en zou de knop alleen ruis zijn.
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
            value === o.id ? "bg-rm-blue text-white" : "text-muted-foreground hover:text-rm-blue-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Channel = "google" | "meta" | "linkedin" | "blended";

const CHANNELS: { id: Channel; label: string; icon: React.ReactNode }[] = [
  { id: "blended", label: "Alle kanalen", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "google", label: "Google Ads", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "meta", label: "Meta", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-3.5 h-3.5" /> },
];

function ChannelTabs({ channel, onChange }: { channel: Channel; onChange: (c: Channel) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            channel === c.id ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground hover:text-rm-gray"
          }`}
        >
          {c.icon}
          {c.label}
        </button>
      ))}
    </div>
  );
}

// Nieuwe, gegroepeerde IA — VOORLOOPT als demo, uitsluitend voor de demo-greentech-klant.
// De 11 losse tabs worden vier secties met sub-navigatie; de nieuwe termen (Analyseren /
// Bevindingen / Doelen & voortgang) vervangen de oude labels. De tab-INHOUD verandert niet —
// alleen de navigatie hergroepeert (activeTab blijft dezelfde id-set).
const CLIENT_SECTIONS: { id: string; label: string; icon: React.ReactNode; tabs: Tab[] }[] = [
  { id: "prestaties", label: "Prestaties", icon: <BarChart3 className="w-4 h-4" />, tabs: ["dashboard", "campaigns", "forecast"] },
  { id: "analyse", label: "Analyse & advies", icon: <Lightbulb className="w-4 h-4" />, tabs: ["insights", "outcomes", "second-opinion"] },
  { id: "planning", label: "Planning & rapportage", icon: <Kanban className="w-4 h-4" />, tabs: ["sprint", "dgm", "reporting", "files"] },
  { id: "instellingen", label: "Instellingen", icon: <Settings className="w-4 h-4" />, tabs: ["settings"] },
];
const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Overzicht", campaigns: "Campagnes", forecast: "Prognose",
  insights: "Analyseren", outcomes: "Bevindingen", "second-opinion": "Second opinion",
  sprint: "Sprint", dgm: "Doelen & voortgang", reporting: "Rapporten", files: "Bestanden",
  settings: "Instellingen",
};

function GroupedTabNav({ activeTab, onChange, sopErrorCount }: { activeTab: Tab; onChange: (t: Tab) => void; sopErrorCount: number }) {
  const activeSection = CLIENT_SECTIONS.find((s) => s.tabs.includes(activeTab)) ?? CLIENT_SECTIONS[0];
  return (
    <div className="space-y-2">
      {/* Top: de vier secties */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {CLIENT_SECTIONS.map((s) => {
          const active = s.id === activeSection.id;
          const showBadge = s.tabs.includes("files") && sopErrorCount > 0;
          return (
            <button key={s.id} onClick={() => onChange(s.tabs[0])}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground hover:text-rm-gray"}`}>
              {s.icon}{s.label}
              {showBadge && <span className="ml-1 px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-500 text-white">{sopErrorCount}</span>}
            </button>
          );
        })}
      </div>
      {/* Sub-navigatie binnen de sectie (alleen bij meer dan één) */}
      {activeSection.tabs.length > 1 && (
        <div className="flex gap-1 flex-wrap pl-1">
          {activeSection.tabs.map((t) => {
            const active = activeTab === t;
            return (
              <button key={t} onClick={() => onChange(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-lead font-medium transition-colors ${active ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"}`}>
                {TAB_LABELS[t]}
                {t === "files" && sopErrorCount > 0 && <span className="px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-500 text-white">{sopErrorCount}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Apart component omdat usePeriod alleen binnen de PeriodProvider werkt, en de provider zit
// om de return van ClientDashboard heen.
function DashboardPeriodPicker() {
  const periode = usePeriod();
  return (
    <PeriodSelector
      value={{
        preset: periode.preset, custom: periode.custom, comparison: periode.comparison,
        range: periode.range, compareRange: periode.compareRange,
      }}
      onChange={(v) => periode.set(v.preset, v.custom, v.comparison)}
    />
  );
}

export function ClientDashboard({ client }: { client: Client }) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [channel, setChannel] = useState<Channel>("blended");
  // Beurs-scope; initieel en live gestuurd door ?geo= uit het menu (Fase 3), daarna ook
  // via de kiezer in de view aanpasbaar.
  const searchParams = useSearchParams();
  const geoParam = searchParams.get("geo");
  const [geoClone, setGeoClone] = useState<string | null>(geoParam);
  useEffect(() => { setGeoClone(geoParam); }, [geoParam]);
  const [sopErrors, setSopErrors] = useState<SopError[]>([]);
  const clientData = useClientData(client.id);
  const [lagDays, setLagDays] = useState<number>(3);
  const [refreshKey, setRefreshKey] = useState(0);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  // Stuurt deze klant op een beurs, dan is de kalendermaand niet de as die telt. De
  // prestatiekaart schakelt dan naar weken-tot-beurs; de maandweergave blijft een klik ver weg
  // voor wie toch per maand wil kijken.
  const upcomingEdition = useUpcomingEdition(client.id);
  const [tijdas, setTijdas] = useState<"beurs" | "maand">("beurs");
  const beursAs = upcomingEdition !== null && tijdas === "beurs";

  useEffect(() => {
    const settings = getClientSettings(client.id);
    setLagDays(settings.conversionLagDays ?? 3);
  }, [client.id]);

  return (
    <PeriodProvider scope={`client-${client.id}`}>
    <BrandThemeProvider clientId={client.id} geoClone={geoClone}>
    <div className="space-y-6">
      {/* Merk-header: logo + merk-/beursnaam, in de huisstijl van de actieve klant/beurs. */}
      <BrandHeaderBar geoClone={geoClone} fallbackName={client.name} edition={upcomingEdition} />
      {/* De periodekiezer staat in de kop en niet per tabblad: hij geldt voor de hele
          klantweergave, en per tabblad een eigen periode zou betekenen dat twee getallen
          op hetzelfde scherm over verschillende maanden gaan. Onder de hero i.p.v. ernaast:
          de hero loopt nu over de volle breedte, en de kiezer ertegenaan geklemd maakte hem smal. */}
      <div className="flex justify-end -mt-3">
        <DashboardPeriodPicker />
      </div>
      {/* Data source indicator + sync status */}
      {clientData.source === "api" && !clientData.loading && !clientData.error && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
            <Wifi className="w-3.5 h-3.5" />
            Live data uit Google Ads
          </div>
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <Clock className="w-3.5 h-3.5" />
            Conversielag: {lagDays} {lagDays === 1 ? "dag" : "dagen"}
          </div>
          <SyncStatusBadge
            clientId={client.id}
            onSyncComplete={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}

      {/* Tab navigation — demo-greentech krijgt de nieuwe gegroepeerde IA (voorproefje) */}
      {client.id === DEMO_GREENTECH_ID ? (
        <GroupedTabNav activeTab={activeTab} onChange={setActiveTab} sopErrorCount={sopErrors.length} />
      ) : (
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { id: "dashboard", label: "Overzicht", icon: <BarChart3 className="w-4 h-4" /> },
          { id: "campaigns", label: "Campagnes", icon: <LayoutGrid className="w-4 h-4" /> },
          { id: "forecast", label: "Prognose", icon: <TrendingUp className="w-4 h-4" /> },
          { id: "insights", label: "Analyses", icon: <Lightbulb className="w-4 h-4" /> },
          { id: "outcomes", label: "Inzichten", icon: <Target className="w-4 h-4" /> },
          { id: "sprint", label: "Sprintplanning", icon: <Kanban className="w-4 h-4" /> },
          { id: "reporting", label: "Rapportage", icon: <FileText className="w-4 h-4" /> },
          { id: "dgm", label: "BMS", icon: <Users className="w-4 h-4" /> },
          { id: "second-opinion", label: "Second Opinion", icon: <ClipboardCheck className="w-4 h-4" /> },
          { id: "files", label: "Bestanden", icon: <FolderOpen className="w-4 h-4" /> },
          { id: "settings", label: "Instellingen", icon: <Settings className="w-4 h-4" /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-card text-rm-blue-ink shadow-sm"
                : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "files" && sopErrors.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-500 text-white">
                {sopErrors.length}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {/* Loading state */}
      {clientData.loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-rm-blue-ink" />
          <p className="text-sm text-muted-foreground">Data ophalen uit Google Ads...</p>
        </div>
      )}

      {/* Error state */}
      {clientData.error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle className="w-8 h-8 text-red-500" />
          <p className="text-sm text-red-600 font-medium">Fout bij ophalen data</p>
          <p className="text-xs text-muted-foreground max-w-md text-center">{clientData.error}</p>
        </div>
      )}

      {/* All content wrapped in data provider */}
      {clientData.data && (
        <ClientDataProvider clientId={client.id}>
        <AnalysisProvider>
          <TrackingAlert clientId={client.id} onNavigateToSettings={() => setActiveTab("settings")} />

          <GeoCloneScope value={geoClone} onChange={setGeoClone} />

          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* De cijfers van de gekozen periode. Werkt op data die de pagina al heeft, dus
                  ook in demo-modus. */}
              <PeriodSummary data={clientData.data} />
              <ChannelTabs channel={channel} onChange={setChannel} />
              {channel === "meta" && <MetaView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
              {channel === "google" && (
              <>
              <HealthBadge clientId={client.id} />
              {geoClone ? (
                // Beurs gekozen: her-geaggregeerd beursoverzicht (uit campagnedata) i.p.v. de
                // account-brede kaarten, die niet per beurs te splitsen zijn.
                <>
                  {/* Event-relatieve pacing: opbouw tot nu vs dezelfde afstand tot de vorige editie. */}
                  <EventPacing clientId={client.id} geoClone={geoClone} />
                  <GeoCloneOverview clientId={client.id} geoClone={geoClone} />
                  <ClientNotes clientId={client.id} />
                </>
              ) : (
              <>
              {/* Country filter for dashboard (only if multi-country) */}
              {clientData.detectedCountries && clientData.detectedCountries.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <button
                    onClick={() => setCountryFilter(null)}
                    className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                      countryFilter === null ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    Alle landen
                  </button>
                  {clientData.detectedCountries.map((code) => (
                    <button
                      key={code}
                      onClick={() => setCountryFilter(countryFilter === code ? null : code)}
                      className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                        countryFilter === code ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                      }`}
                    >
                      {countryLabel(code)}
                    </button>
                  ))}
                </div>
              )}

              {/* De pagina is in secties gegroepeerd in plaats van dertien losse kaarten onder
                  elkaar. Elke sectie beantwoordt één vraag; binnen een sectie staan de kaarten
                  dicht op elkaar, ertussen zit ruim het dubbele. Zonder dat verschil groepeert er
                  niets en moet de lezer zelf uitzoeken wat bij wat hoort. */}
              <Sectie
                eerste
                icoon={<Calendar className="w-4.5 h-4.5 text-rm-blue-ink" />}
                titel={
                  (beursAs ? "Prestaties richting de beurs" : "Maandprestaties")
                  + (countryFilter ? ` — ${countryLabel(countryFilter)}` : "")
                }
                bijschrift={beursAs
                  ? `Per week: hoeveel weken zijn we van ${upcomingEdition!.eventName} en lopen we op schema?`
                  : "Per maand: waar staan we en wat is de trend?"}
                actie={upcomingEdition && <TijdasKeuze value={tijdas} onChange={setTijdas} />}
              >
                {beursAs
                  ? <FairWeeksOverview clientId={client.id} countryFilter={countryFilter} edition={upcomingEdition!} />
                  : <MonthlyOverview clientId={client.id} countryFilter={countryFilter} />}
                <PacingMonitor clientId={client.id} countryFilter={countryFilter} edition={upcomingEdition} />
              </Sectie>

              <Sectie
                icoon={<Target className="w-4.5 h-4.5 text-rm-blue-ink" />}
                titel={countryFilter ? `Jaaroverzicht 2026 — ${countryLabel(countryFilter)}` : "Jaaroverzicht 2026"}
                bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
              >
                <MetricCards clientId={client.id} countryFilter={countryFilter} />
                <PerformanceChart clientId={client.id} countryFilter={countryFilter} />
              </Sectie>

              {/* Waar het vandaan komt, en hóé die markten bediend worden. De kanaalmix per land
                  staat bewust naast de kaart en niet op een eigen pagina: het is de volgende vraag
                  na "welke landen", en een aparte pagina zou klant en periode opnieuw laten kiezen. */}
              <Sectie
                icoon={<Globe className="w-4.5 h-4.5 text-rm-blue-ink" />}
                titel="Markten"
                bijschrift="Waar het verkeer en de conversies vandaan komen, en met welke kanaalmix"
              >
                <GeoBreakdown clientId={client.id} />
                <GeoChannelMatrix clientId={client.id} />
              </Sectie>

              {/* Video, PMax-netwerken, placements en creatives horen bij elkaar: het is allemaal
                  "waar landt het budget en hoe ziet het eruit". Elk van deze kaarten rendert niets
                  als er geen data voor is, dus de sectie kan ook helemaal leeg blijven. */}
              <Sectie
                icoon={<LayoutGrid className="w-4.5 h-4.5 text-rm-blue-ink" />}
                titel="Waar het budget landt"
                bijschrift="Video, netwerken en placements"
              >
                <VideoPerformance clientId={client.id} />
                <PmaxNetworkSplit clientId={client.id} />
                <VideoPlacements clientId={client.id} />
              </Sectie>

              <div className="mt-10">
                <ClientNotes clientId={client.id} />
              </div>
              </>
              )}
              </>
              )}
            </div>
          )}

          {activeTab === "campaigns" && (
            <div className="space-y-6">
              <ChannelTabs channel={channel} onChange={setChannel} />
              {channel === "google" && (
                <div>
                  {/* Twee vragen, twee secties. Wat draait er, en waar lekt het weg — dat laatste
                      is geen detail van het eerste maar een eigen onderwerp met een eigen actie. */}
                  <Sectie
                    eerste
                    icoon={<LayoutGrid className="w-4.5 h-4.5 text-rm-blue-ink" />}
                    titel="Wat er draait"
                    bijschrift="Alle campagnes van dit account over de laatste 30 dagen"
                  >
                    <CampaignTable clientId={client.id} geoClone={geoClone} countryFilter={countryFilter} onCountryFilterChange={setCountryFilter} />
                  </Sectie>
                  {/* De advertenties zelf horen hier en niet op Overzicht.
                      Ze stonden in de sectie "Waar het budget landt", samen met video, netwerken
                      en placements: vier onderwerpen onder één kop, samen 1.872 pixels — ruim
                      anderhalf scherm en zesendertig procent van de hele pagina. Dit blok was het
                      grootste (616px) én het enige dat inhoudelijk ergens anders thuishoort: een
                      advertentie is waar een campagne uit bestaat, niet waar een budget landt.
                      Overzicht wordt hier een derde korter zonder dat er iets verdwijnt. */}
                  <Sectie
                    icoon={<Sparkles className="w-4.5 h-4.5 text-rm-blue-ink" />}
                    titel="De advertenties zelf"
                    bijschrift="Hoe de creatives eruitzien en wat ze opleverden"
                  >
                    <CreativePerformance clientId={client.id} channel="google" />
                  </Sectie>
                  <Sectie
                    icoon={<AlertTriangle className="w-4.5 h-4.5 text-rm-blue-ink" />}
                    titel="Waar het weglekt"
                    bijschrift="Zoektermen, ad groups en producten die kosten maken zonder conversie"
                  >
                    <SearchTermsTable clientId={client.id} geoClone={geoClone} countryFilter={countryFilter} />
                  </Sectie>
                </div>
              )}
              {channel === "meta" && <MetaView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} />}
              {/* Alle kanalen op de Campagnes-tab: welke campagnes draaien per kanaal (niet de
                  blended maandgrafiek — die hoort bij Prognose/Overzicht). */}
              {channel === "blended" && <CampaignsPerChannel clientId={client.id} geoClone={geoClone} />}
            </div>
          )}

          {activeTab === "forecast" && (
            <div className="space-y-6">
              {geoClone ? (
                // Beurs actief: de event-relatieve projectie (dagen-tot-beurs, blended over de
                // kanalen) is de juiste tool. De kalenderjaar-prognose vertekent bij een event —
                // die staat op "Hele account".
                <>
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-meta text-blue-800">
                    Je zit in de beurs <strong>{geoClone}</strong>. Hieronder de <strong>event-relatieve prognose</strong>
                    {" "}(dagen-tot-beurs, over alle kanalen) — de juiste projectie voor een beurs. De kalenderjaar-prognose
                    per kanaal staat op <strong>← Hele account</strong>.
                  </div>
                  <SignalAnalysisCard
                    clientId={client.id}
                    endpoint="/api/analysis/geo-clone"
                    extra={{ geo_clone: geoClone }}
                    title={`Beursprognose ${geoClone}`}
                    description="Event-relatief: waar staat de aanloop naar deze editie t.o.v. dezelfde afstand tot de vorige editie, plus de projectie richting de beursdag per kanaal en het blended totaal tegen het doel."
                    runLabel="Draai beursprognose"
                  />
                </>
              ) : (
                <>
                  <ChannelTabs channel={channel} onChange={setChannel} />
                  {channel === "google" && (
                    <>
                      {/* De prognose is het antwoord; het budgetscenario is wat je ermee doet.
                          Twee onderwerpen, dus twee secties. */}
                      <Sectie
                        eerste
                        icoon={<TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />}
                        titel="Waar dit jaar op uitkomt"
                        bijschrift="Gerealiseerd plus prognose per maand, tegen het jaardoel"
                      >
                        <ForecastTable clientId={client.id} />
                      </Sectie>
                      <Sectie
                        icoon={<Target className="w-4.5 h-4.5 text-rm-blue-ink" />}
                        titel="Wat een budgetwijziging zou doen"
                        bijschrift="Doorrekening van een hoger of lager mediabudget op dezelfde efficiëntie"
                      >
                        <BudgetScenario clientId={client.id} />
                      </Sectie>
                    </>
                  )}
                  {channel === "blended" && (
                    <>
                      <Sectie
                        eerste
                        icoon={<TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />}
                        titel="Prognose over alle kanalen"
                        bijschrift="De blended projectie richting het einde van de periode"
                      >
                        <ChannelForecast clientId={client.id} channel="blended" />
                      </Sectie>
                      <CrossChannelView clientId={client.id} />
                    </>
                  )}
                  {(channel === "meta" || channel === "linkedin") && (
                    <ChannelForecast clientId={client.id} channel={channel} />
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <div className="space-y-6">
              <PeriodSummary data={clientData.data} />
              <InsightsTab
                clientId={client.id}
                onSopError={(error) => setSopErrors((prev) => [...prev, error])}
              />
            </div>
          )}

          {activeTab === "outcomes" && (
            <div className="space-y-6">
              <PeriodSummary data={clientData.data} />
              <OutcomesTab clientId={client.id} />
            </div>
          )}

          {activeTab === "sprint" && (
            <SprintPlanning clientId={client.id} />
          )}

          {activeTab === "reporting" && (
            <ClientReporting clientId={client.id} />
          )}

          {activeTab === "dgm" && (
            <DgmView clientId={client.id} />
          )}

          {activeTab === "second-opinion" && (
            <SecondOpinionView clientId={client.id} clientName={client.name} />
          )}

          {activeTab === "files" && (
            <ClientFiles
              clientId={client.id}
              sopErrors={sopErrors}
              onDismissError={(id) => setSopErrors((prev) => prev.filter((e) => e.id !== id))}
              onDismissAllErrors={() => setSopErrors([])}
            />
          )}

          {activeTab === "settings" && (
            <div className="space-y-6">
              {geoClone ? (
                // Beurs gekozen: de eigen instellingen-laag van deze geo-clone (branding, doelen,
                // event-datums) met account-fallback. Het account-niveau blijft eronder zichtbaar.
                <>
                  <GeoCloneSettingsPanel clientId={client.id} geoClone={geoClone} />
                  {/* Alleen de account-brede KPI-instellingen als context. Branding en
                      event/edities zijn hierboven al beurs-specifiek geregeld; die niet
                      nog eens (en al helemaal niet voor álle beurzen) hieronder herhalen. */}
                  <details className="rounded-xl border border-border bg-gray-50/50">
                    <summary className="cursor-pointer px-5 py-3 text-body font-medium text-muted-foreground">
                      Account-instellingen (KPI-doelen, conversie-acties — waarvan deze beurs erft) tonen
                    </summary>
                    <div className="p-5 space-y-6">
                      <ClientSettingsPanel clientId={client.id} clientName={client.name} />
                    </div>
                  </details>
                </>
              ) : (
                <SettingsSections client={client} />
              )}
            </div>
          )}
        </AnalysisProvider>
        </ClientDataProvider>
      )}
    </div>
    </BrandThemeProvider>
    </PeriodProvider>
  );
}

// De instellingenpagina was een vlakke stapel van elf panelen in drie verschillende omhulsels:
// twee kale componenten en twee <details>, met dingen die bij elkaar horen ver uit elkaar. De
// Google-conversie-acties zaten in het klantpaneel, de Meta/LinkedIn-conversies in een los
// component daarna; het logo in het klantpaneel, de rest van de huisstijl in een eigen paneel
// daarna. Wie iets zocht moest weten waar het ooit was neergezet.
//
// Nu vier groepen op onderwerp, met één navigatie erboven. Elke groep past op één scherm, en
// wat bij elkaar hoort staat bij elkaar — de conversie-instellingen van alle drie de kanalen
// onder elkaar, merk en logo samen.
const SETTINGS_GROEPEN = [
  { id: "meten", label: "Doelen & meten", uitleg: "Waar stuurt deze klant op, en wat telt als conversie — per kanaal." },
  { id: "merk", label: "Merk & uiterlijk", uitleg: "Huisstijl, kleuren en logo; wat je terugziet in het dashboard en de rapporten." },
  { id: "beurzen", label: "Beurzen", uitleg: "Cadans en editie-datums. Voeden de weken-tot-beurs-weergave en de beursanalyse." },
  { id: "account", label: "Account & markt", uitleg: "Sector en benchmarks, actieve landen, Merchant Center." },
] as const;

type SettingsGroep = (typeof SETTINGS_GROEPEN)[number]["id"];

function SettingsSections({ client }: { client: Client }) {
  const [groep, setGroep] = useState<SettingsGroep>("meten");
  const actief = SETTINGS_GROEPEN.find((g) => g.id === groep)!;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {SETTINGS_GROEPEN.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroep(g.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              g.id === groep ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="text-meta text-muted-foreground">{actief.uitleg}</p>

      {groep === "meten" && (
        <div className="space-y-6">
          <ClientSettingsPanel clientId={client.id} clientName={client.name} kaarten={["kpi", "conversies", "overrides", "lag"]} />
          {/* Meta/LinkedIn direct onder de Google-conversie-acties: dezelfde vraag, ander kanaal. */}
          <ChannelConversionSettings clientId={client.id} />
        </div>
      )}

      {groep === "merk" && (
        <div className="space-y-6">
          <BrandingView clientId={client.id} clientName={client.name} />
          <ClientSettingsPanel clientId={client.id} clientName={client.name} kaarten={["logo"]} />
        </div>
      )}

      {groep === "beurzen" && <EventSettings clientId={client.id} />}

      {groep === "account" && (
        <ClientSettingsPanel clientId={client.id} clientName={client.name} kaarten={["sector", "landen", "merchant"]} />
      )}
    </div>
  );
}

function InsightsTab({ clientId, onSopError }: { clientId: string; onSopError?: (error: SopError) => void }) {
  const [, setRefreshKey] = useState(0);
  const [analysisChannel, setAnalysisChannel] = useState<Channel>("blended");

  // Het kanaal-subtabje kiest alleen WELKE analyses je draait; het uitkomsten-filter blijft
  // standaard op "Alle kanalen" (geen kanaal is belangrijker) en wisselt alleen op eigen klik.
  const onComplete = () => setRefreshKey((k) => k + 1);

  // Sectiekop: scheidt de losse (deterministische) analyses bovenaan van de zware maand-SOP
  // eronder, zodat je alle analyses ziet zonder dat een volledige SOP-uitwerking ze wegduwt.
  const Section = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-micro font-semibold text-rm-blue-ink uppercase tracking-wide whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Alle analyses draaien hier, per kanaal; de kanaaltabs elders zijn data-weergaven. */}
      <ChannelTabs channel={analysisChannel} onChange={setAnalysisChannel} />

      {analysisChannel === "google" && (
        <>
          <Section>Losse analyses</Section>
          <StandaloneAnalyses clientId={clientId} />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/google-funnel"
            title="Funnel-drop-off"
            description="Vertoning → klik → conversie over de recente 4 weken vs de 4 weken ervoor; een verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "google" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/google-video"
            title="Video & Performance Max"
            description="Kijkdiepte van de videocampagnes, placements die budget kosten zonder conversie, en netwerken binnen PMax die naar verhouding meer kosten dan ze opleveren. Bevindingen landen in de wachtrij."
            runLabel="Analyseer video & PMax"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/geo-markets"
            extra={{ channel: "google" }}
            title="Landen & staten"
            description="Welke markten kosten zonder te converteren, zijn structureel duurder, of trekken wel verkeer maar haken ná de klik af. Binnen de VS ook per staat, tegen een eigen norm."
            runLabel="Analyseer markten"
          />
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
        </>
      )}
      {analysisChannel === "meta" && (
        <>
          <Section>Losse analyses</Section>
          <MetaCreativeAnalyses clientId={clientId} />
          {/* Deterministische structuur-analyse (plaatsing/leeftijd/device), direct uit de data. */}
          <ChannelStructureAnalysis clientId={clientId} channel="meta" />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/meta-funnel"
            title="Funnel-drop-off"
            description="Fase-overgangen (klik → landing → winkelwagen → checkout → conversie) recent vs prior venster; de verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "meta" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/meta-signals"
            title="Meta-signalen"
            description="Deterministische detectie: creative fatigue, frequency-saturatie, ranking-zwakte, hook/hold, plus segment-efficiëntie en budget-concentratie. Voedt de goedkeuringswachtrij."
          />
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} channel="meta_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
        </>
      )}
      {analysisChannel === "linkedin" && (
        <>
          <Section>Losse analyses</Section>
          {/* Deterministische structuur-analyse (functie/seniority/industrie/bedrijfsgrootte), direct uit de data. */}
          <ChannelStructureAnalysis clientId={clientId} channel="linkedin" />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-icp-fit"
            title="ICP-fit"
            description="Welk deel van de spend en leads valt binnen het ideale klantprofiel, wat is de waste en wat kost een ICP-lead vs een niet-ICP-lead."
            runLabel="Draai ICP-fit"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-funnel"
            title="Funnel-drop-off"
            description="Vertoning → klik → landingspagina → form-open → lead over twee 28-dagen-vensters; een verslechterde fase landt in de wachtrij."
            runLabel="Draai funnel-analyse"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/kpi-relations"
            extra={{ channel: "linkedin" }}
            title="KPI-verhoudingen"
            description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
            runLabel="Analyseer verhoudingen"
          />
          <SignalAnalysisCard
            clientId={clientId}
            endpoint="/api/analysis/linkedin-signals"
            title="LinkedIn-signalen"
            description="Deterministische detectie: lead-form drop-off, CPL-druk, engagement- en video-zwakte, plus demografie-efficiëntie/-drift en budget-concentratie. Voedt de goedkeuringswachtrij."
          />
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} channel="linkedin_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} />
        </>
      )}
      {analysisChannel === "blended" && (
        <>
          <Section>Sub-analyses</Section>
          {/* Cross-channel als losse sub-analyse-kaarten (net als de kanalen), uit één run. */}
          <CrossChannelAnalyses clientId={clientId} />
        </>
      )}

      {/* Het overzicht staat onder elk kanaal, want de vraag "wat heb ik al gedraaid" is niet
          kanaalgebonden. Op "Alle kanalen" is het het hoofdgerecht: daar stond eerst één kaart. */}
      <Section>Wat er klaarstaat</Section>
      <AnalysisOverview clientId={clientId} onKiesKanaal={setAnalysisChannel} />

      <p className="text-meta text-muted-foreground pt-2">
        De uitkomsten (wachtrij, inzichten, aanbevelingen, hypotheses, taken) landen in het tabblad <strong>Bevindingen</strong>;
        van de maand-SOP komt automatisch een <strong>PDF bij Bestanden</strong>.
      </p>
    </div>
  );
}

// De uitkomsten-laag, losgetrokken van het draaien van analyses zodat beide pagina's
// behapbaar blijven: wachtrij, inzichten, aanbevelingen, hypotheses-workflows en taken,
// met het kanaal-filter (standaard Alle) over alles heen.
function OutcomesTab({ clientId }: { clientId: string }) {
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [channelFilter, setChannelFilter] = useState<InsightChannel | null>(null);

  return (
    <div>
      <div className="space-y-4">
        <TaskImpactReminder clientId={clientId} />
        {/* Kanaal-filter over inzichten, aanbevelingen, hypotheses, wachtrij en taken. */}
        <ChannelFilter value={channelFilter} onChange={setChannelFilter} />
      </div>

      {/* Wat op goedkeuring wacht staat vooraan: dat is het enige op deze pagina waar direct een
          handeling van jou op zit. De rest is lezen. */}
      <Sectie
        icoon={<ClipboardCheck className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wacht op je oordeel"
        bijschrift="Voorstellen uit de analyses; accepteren zet ze in de sprintplanning"
      >
        <ProposalQueue clientId={clientId} refreshKey={refreshKey} channel={channelFilter} onWorkflowChange={() => setRefreshKey((k) => k + 1)} />
      </Sectie>

      {/* Creative-vermoeidheid stond bij de analyses, maar er valt niets te draaien: het is een
          aflezing van data die er al is, dus een bevinding. Hij volgt het kanaalfilter; op
          "Alle" staan de kanalen naast elkaar en tonen alleen de kanalen die iets te zeggen
          hebben zichzelf. */}
      <Sectie
        icoon={<Lightbulb className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wat de analyses zien"
        bijschrift="Creative-vermoeidheid per kanaal, en de inzichten die eruit volgen"
      >
        {(channelFilter === null ? (["google", "meta", "linkedin"] as const) : channelFilter === "cross" ? [] : [channelFilter]).map((c) => (
          <CreativeDeepDive key={c} clientId={clientId} channel={c} />
        ))}
        <InsightsBlock
          clientId={clientId}
          selectedInsightId={selectedInsightId}
          onSelectInsight={setSelectedInsightId}
          refreshKey={refreshKey}
          channel={channelFilter}
        />
      </Sectie>

      <Sectie
        icoon={<Kanban className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wat eruit volgt"
        bijschrift="Aanbevelingen, hypotheses en de taken die eruit voortkomen"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <RecommendationsBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} channel={channelFilter} />
            <HypothesesBlock clientId={clientId} refreshKey={refreshKey} onWorkflowChange={() => setRefreshKey((k) => k + 1)} channel={channelFilter} />
          </div>
          <TasksBlock clientId={clientId} selectedInsightId={selectedInsightId} refreshKey={refreshKey} channel={channelFilter} />
        </div>
      </Sectie>
    </div>
  );
}
