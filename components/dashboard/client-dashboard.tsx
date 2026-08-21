"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, Settings, Target, Loader2, AlertTriangle, Wifi, FlaskConical, Clock, LayoutGrid, Lightbulb, TrendingUp, FolderOpen, Users, Kanban, ClipboardCheck, FileText, Megaphone, Briefcase, Layers } from "lucide-react";
import { SyncStatusBadge } from "./sync-status-badge";
import { getClientSettings } from "@/lib/client-settings";
import { SecondOpinionView } from "./second-opinion-view";
import { AnalysisOverview } from "./analysis-overview";
import { useUpcomingEdition } from "@/lib/fair/use-upcoming-edition";
import { ClientSettingsPanel } from "./client-settings";
import { InsightsBlock } from "../insights/insights-block";
import { RecommendationsBlock } from "../insights/recommendations-block";
import { TasksBlock } from "../insights/tasks-block";
import { TaskImpactReminder } from "../insights/task-impact-reminder";
import { SopTriggerButtons, type SopError } from "../insights/sop-trigger-buttons";
import { StandaloneAnalyses } from "../insights/standalone-analyses";
import { CreditBalanceBadge } from "../insights/credit-balance-badge";
import { HypothesesBlock } from "../insights/hypotheses-block";
import { ProposalQueue } from "../insights/proposal-queue";
import { supabase } from "@/lib/supabase";
import { ChannelFilter } from "../insights/channel-filter";
import {
  laadBeschikbareKanalen, zichtbareTabs, geldigeKeuze, geenDataTekst, kanalenOpsomming,
  type Kanaal,
} from "@/lib/kanalen/beschikbaar";
import { MetaCreativeAnalyses } from "../insights/meta-creative-analyses";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { CrossChannelAnalyses } from "./cross-channel-analyses";
import { MasterSynthesisAnalysis } from "./master-synthesis-analysis";
import { ChannelForecast } from "./channel-forecast";
import { EventForecaster } from "./event-forecaster";
import { ChatDrawer } from "@/components/chat/chat-drawer";
import { CreativeDeepDive } from "./creative-deep-dive";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { GodViewDemo } from "@/components/terminal/god-view-demo";
import type { InsightChannel } from "@/lib/insights/channel-of";
import { PeriodProvider, usePeriod } from "@/lib/period/period-context";
import { PeriodSelector } from "./period-selector";
import { PeriodSummary } from "./period-summary";
import { SprintPlanning } from "../insights/sprint-planning";
import { ClientFiles } from "./client-files";
import { DgmView } from "./dgm-view";
import { MetaView, MetaCampagnes } from "./meta-view";
import { LinkedInView, LinkedInCampagnes } from "./linkedin-view";
import { GoogleView, GoogleCampagnes, GoogleForecast } from "./google-view";
import { CrossChannelView } from "./cross-channel-view";
import { CampaignsPerChannel } from "./campaigns-per-channel";
import { BrandingView } from "./branding-view";
import { EventSettings } from "./event-settings";
import { GeoCloneSettingsPanel } from "./geo-clone-settings";
import { ChannelConversionSettings } from "./channel-conversion-settings";
import { Ga4Settings } from "./ga4-settings";
import { SearchConsoleSettings } from "./search-console-settings";
import { ChannelStructureAnalysis } from "./channel-structure-analysis";
import { GeoCloneScope } from "./geo-clone-scope";
import { TrackingAlert } from "./tracking-alert";
import { CodeRoodBanner } from "./code-rood-banner";
import { ClientReporting } from "./client-reporting";
import { BrandThemeProvider } from "../branding/brand-theme-provider";
import { BrandHeaderBar } from "../branding/brand-header-bar";
import { useClientData } from "@/lib/use-client-data";
import { useChannelPeriodData } from "@/lib/use-channel-period-data";
import { ClientDataProvider } from "@/lib/client-data-provider";
import { AnalysisProvider } from "@/lib/analysis-context";
import { Sectie } from "@/components/ui/sectie";

interface Client {
  id: string;
  name: string;
  source?: string;
}

type Tab = "dashboard" | "campaigns" | "forecast" | "insights" | "outcomes" | "sprint" | "reporting" | "dgm" | "second-opinion" | "files" | "settings";


type Channel = "google" | "meta" | "linkedin" | "blended";

const CHANNELS: { id: Channel; label: string; icon: React.ReactNode }[] = [
  { id: "blended", label: "Alle kanalen", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "google", label: "Google Ads", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "meta", label: "Meta", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-3.5 h-3.5" /> },
];

/**
 * De kanaalkiezer, maar alleen voor de kanalen die deze klant écht heeft.
 *
 * Gemeten op de 71 accounts: 62 hebben alleen Google. Die zagen hier vier tabs, waarvan twee naar
 * een leeg scherm leidden en "Alle kanalen" hetzelfde toonde als het enige kanaal. Bij één kanaal
 * verdwijnt de balk daarom helemaal -- een kiezer met één knop is geen keuze.
 */
function ChannelTabs({ channel, onChange, beschikbaar }: {
  channel: Channel;
  onChange: (c: Channel) => void;
  beschikbaar: readonly Kanaal[];
}) {
  const toegestaan = zichtbareTabs(beschikbaar);
  if (toegestaan.length === 0) return null;
  const zichtbaar = CHANNELS.filter((c) => (toegestaan as string[]).includes(c.id));
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
      {zichtbaar.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            channel === c.id ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"
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
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"}`}>
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-lead font-medium transition-colors ${active ? "bg-brand-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-brand-gray"}`}>
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
  // null = nog niet geladen. Dat onderscheid telt: "nog niet weten" mag er niet uitzien als
  // "geen kanalen", anders flitst de lege staat op bij elke navigatie.
  const [kanalen, setKanalen] = useState<Kanaal[] | null>(null);
  // Alleen gebruikt voor het bronbijschrift verderop. isDemoMode() leest window.location, dus dit
  // hoort in een effect en niet in de eerste render -- anders rendert de server iets anders dan de
  // client en klapt de hydratie eruit.
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoMode()); }, []);

  useEffect(() => {
    let levend = true;
    if (!supabase) { setKanalen([]); return; }
    laadBeschikbareKanalen(supabase as never, client.id)
      .then((k) => { if (levend) setKanalen(k); })
      .catch(() => { if (levend) setKanalen([]); });
    return () => { levend = false; };
  }, [client.id]);

  // De keuze bijstellen zodra bekend is wat er is. Zonder dit blijf je hangen op een kanaal dat
  // deze klant niet heeft: van een Meta-klant doorklikken naar een Google-only klant liet een
  // leeg scherm zien onder een tab die niet eens meer bestond.
  useEffect(() => {
    if (!kanalen) return;
    setChannel((huidig) => geldigeKeuze(huidig, kanalen) as Channel);
  }, [kanalen]);
  // Beurs-scope; initieel en live gestuurd door ?geo= uit het menu (Fase 3), daarna ook
  // via de kiezer in de view aanpasbaar.
  const searchParams = useSearchParams();
  const geoParam = searchParams.get("geo");
  const [geoClone, setGeoClone] = useState<string | null>(geoParam);
  useEffect(() => { setGeoClone(geoParam); }, [geoParam]);
  const [sopErrors, setSopErrors] = useState<SopError[]>([]);
  const clientData = useClientData(client.id);
  // KPI-rij bovenaan: "deze kpi header rij moet standaard alles tonen. bij filtering pas kanaal
  // specifiek" -- op "blended" (de standaard) telt Google+Meta+LinkedIn op, op een gekozen kanaal
  // toont hij alleen dat kanaal. Voorheen las PeriodSummary altijd clientData.data (Google), ook
  // op de Meta/LinkedIn/Alle kanalen-tabs.
  const periodSummaryData = useChannelPeriodData({ clientId: client.id, channel, googleData: clientData.data });
  const [lagDays, setLagDays] = useState<number>(3);
  const [refreshKey, setRefreshKey] = useState(0);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  // Stuurt deze klant op een beurs, dan is de kalendermaand niet de as die telt. De
  // prestatiekaart schakelt dan naar weken-tot-beurs; de maandweergave blijft een klik ver weg
  // voor wie toch per maand wil kijken.
  const upcomingEdition = useUpcomingEdition(client.id);
  const [tijdas, setTijdas] = useState<"beurs" | "maand">("beurs");

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
      {/* Data source indicator + sync status.

        Het bijschrift noemt de kanalen die deze klant écht heeft en niet vast "Google Ads". Bij de
        LinkedIn-only doorloop stond er "Live data uit Google Ads" boven een scherm zonder één
        Google-rij: grammaticaal in orde, feitelijk onwaar, en door geen test te vangen omdat er
        niets aan gerekend wordt. Zolang de kanalen nog niet bekend zijn (null) blijft de balk weg
        in plaats van te gokken; bij nul kanalen staat de amberkleurige melding er al.

        Alleen dít bijschrift hangt aan de kanalen. De synchronisatieknop blijft staan, juist ook
        bij een klant zonder data -- dat is de klant die hem het hardst nodig heeft. */}
      {clientData.source === "api" && !clientData.loading && !clientData.error && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* "Live" alleen als het live IS. In demo-modus komen deze cijfers uit
              lib/demo/demo-rows.ts en niet uit een koppeling; er zijn niet eens sleutels. De
              badge zei toch "Live data uit Google Ads, Meta en LinkedIn" -- in een demonstratie
              is dat de zin waar je collega je op aanspreekt, en terecht.

              Dezelfde fout als de LinkedIn-doorloop hierboven, één laag dieper: toen was de
              KANAALNAAM onwaar, nu het woord "live". Zelfde les, dus dezelfde behandeling. */}
          {kanalenOpsomming(kanalen ?? []) !== null && (
            demoModus ? (
              <div className="flex items-center gap-2 text-xs text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-lg px-3 py-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                Demodata — {kanalenOpsomming(kanalen ?? [])}, geen live koppeling
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <Wifi className="w-3.5 h-3.5" />
                Live data uit {kanalenOpsomming(kanalen ?? [])}
              </div>
            )
          )}
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <Clock className="w-3.5 h-3.5" />
            Conversielag: {lagDays} {lagDays === 1 ? "dag" : "dagen"}
          </div>
          {/* Geen synchronisatieknop in demo-modus.
              De knop roept een server-route aan, en die gaat langs de mock heen: server-side is er
              geen demo-client, dus hij praat met de echte Google-API. Zonder sleutels wordt dat een
              foutmelding, en dit is precies zo'n knop waar iemand tijdens een demonstratie
              spontaan op drukt.
              Buiten de demo blijft hij staan, juist ook bij een klant zonder data -- dat is de
              klant die hem het hardst nodig heeft. */}
          {!demoModus && (
            <SyncStatusBadge
              clientId={client.id}
              onSyncComplete={() => setRefreshKey((k) => k + 1)}
            />
          )}
        </div>
      )}

      {/* Acht van de 71 klanten hebben nog geen enkel kanaal met data. Die zagen tot nu toe een
        volledig dashboard met overal nullen, en dat leest als "het gaat slecht" in plaats van
        "er is nog niets gekoppeld".

        Een melding en geen vervanging van het scherm: de weg naar de oplossing loopt via
        Instellingen, en die zou je met een lege staat over het hele dashboard juist afsluiten. */}
      {kanalen !== null && kanalen.length === 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-meta leading-snug text-amber-900">{geenDataTekst(kanalen)}</p>
        </div>
      )}

      {/* Tab navigation — de demo-accounts krijgen de nieuwe gegroepeerde IA (voorproefje).
        Eerst alleen demo-greentech; demo-grt/demo-gra/demo-grn (scripts/demo/seed-geoclone-
        clients.ts) volgden dezelfde "demo-"-naamconventie maar niet deze check, waardoor ze de
        oude platte tabbalk lieten zien -- inconsistent binnen dezelfde demo-omgeving. */}
      {client.id.startsWith("demo-") ? (
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
                ? "bg-card text-brand-blue-ink shadow-sm"
                : "text-muted-foreground hover:text-brand-gray"
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
          <Loader2 className="w-8 h-8 animate-spin text-brand-blue-ink" />
          {/* Geen kanaalnaam hier: tijdens het laden is nog niet bekend wélke kanalen deze klant
              heeft, dus elke naam zou een gok zijn. "Data ophalen" klopt altijd. */}
          <p className="text-sm text-muted-foreground">Data ophalen...</p>
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
          <CodeRoodBanner clientId={client.id} />
          <TrackingAlert clientId={client.id} onNavigateToSettings={() => setActiveTab("settings")} />

          <GeoCloneScope value={geoClone} onChange={setGeoClone} />

          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Kanaaltabs boven de KPI-rij (17.44): "is het niet onlogisch dat de kanaalfilter
                  onder de hoofd-KPI-rij staat?" -- je kiest eerst welk kanaal je bekijkt, dan pas
                  de cijfers ervoor. De KPI-rij zelf beweegt nu ook echt mee: op "blended" (de
                  standaard, "Alle kanalen") telt Google+Meta+LinkedIn op via
                  useChannelPeriodData(); op een gekozen kanaal toont hij alleen dat kanaal. Werkt
                  op data die de pagina al heeft (Google) of apart ophaalt (Meta/LinkedIn), dus ook
                  in demo-modus. */}
              <ChannelTabs channel={channel} onChange={setChannel} beschikbaar={kanalen ?? []} />
              <PeriodSummary data={periodSummaryData} />
              {channel === "meta" && <MetaView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} meerdereKanalen={(kanalen?.length ?? 0) > 1} />}
              {channel === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} meerdereKanalen={(kanalen?.length ?? 0) > 1} />}
              {channel === "blended" && <CrossChannelView clientId={client.id} />}
              {channel === "google" && (
                <GoogleView
                  clientId={client.id}
                  geoClone={geoClone}
                  edition={upcomingEdition}
                  meerdereKanalen={(kanalen?.length ?? 0) > 1}
                  detectedCountries={clientData.detectedCountries}
                  countryFilter={countryFilter}
                  onCountryFilterChange={setCountryFilter}
                  tijdas={tijdas}
                  onTijdasChange={setTijdas}
                />
              )}
            </div>
          )}

          {activeTab === "campaigns" && (
            <div className="space-y-6">
              <ChannelTabs channel={channel} onChange={setChannel} beschikbaar={kanalen ?? []} />
              {channel === "google" && (
                <GoogleCampagnes
                  clientId={client.id}
                  geoClone={geoClone}
                  countryFilter={countryFilter}
                  onCountryFilterChange={setCountryFilter}
                />
              )}
              {channel === "meta" && <MetaCampagnes clientId={client.id} />}
              {channel === "linkedin" && <LinkedInCampagnes clientId={client.id} />}
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
                  <ChannelTabs channel={channel} onChange={setChannel} beschikbaar={kanalen ?? []} />
                  {/* Fase 6: de T-minus Forecaster, los van de kalenderjaar-prognose hieronder en
                      los van de kanaal-subtab hierboven (hij heeft zijn eigen kanaal-toggle). Toont
                      zichzelf niet als de klant geen events met een editiedatum heeft ingesteld. */}
                  <EventForecaster clientId={client.id} />
                  {channel === "google" && <GoogleForecast clientId={client.id} />}
                  {channel === "blended" && (
                    <>
                      <Sectie
                        eerste
                        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
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
                kanalen={kanalen ?? []}
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
      {/* De spar-assistent. Buiten de tabbladen en buiten ClientDataProvider: het gesprek gaat over
          de klant en niet over het tabblad waar je toevallig staat, en de drawer haalt zijn eigen
          context server-side op. Rendert niets als het bureau geen tenminste growth-licentie heeft. */}
      <ChatDrawer clientId={client.id} klantnaam={client.name} />
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
  { id: "account", label: "Account & markt", uitleg: "Sector en benchmarks, actieve landen, Merchant Center, GA4 en Search Console." },
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
              g.id === groep ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"
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
        <div className="space-y-8">
          {/* Feedback: "heel Account & markt is puur integraties en settings, dus misschien niet
              verkeerd -- maar de opmaak kan beter." Eén koppentekst i.p.v. geen enkel onderscheid
              tussen WIE de klant is (sector, landen, Merchant Center -- context die de analyses
              gebruiken) en WAAR externe data vandaan komt (GA4, Search Console).

              Bewust GEEN twee losse <ClientSettingsPanel>-aanroepen (bv. kaarten={["sector","landen"]}
              apart van kaarten={["merchant"]}): handleSave() daarin slaat altijd het VOLLEDIGE
              settings-object op uit zijn eigen lokale state, ongeacht welke kaarten zichtbaar zijn.
              Twee instanties zijn dus twee onafhankelijke "Opslaan"-knoppen die elkaars ongesaved
              velden bij het opslaan stil terugzetten naar de waarde van bij het laden -- een
              last-write-wins-bug, niet een cosmetische kwestie. Eén aanroep, één kop erboven. */}
          <div>
            <h3 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Accountcontext
            </h3>
            <ClientSettingsPanel clientId={client.id} clientName={client.name} kaarten={["sector", "landen", "merchant"]} />
          </div>
          <div>
            <h3 className="text-meta font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Externe databronnen
            </h3>
            <div className="space-y-6">
              <Ga4Settings clientId={client.id} />
              <SearchConsoleSettings clientId={client.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightsTab({ clientId, onSopError, kanalen }: { clientId: string; onSopError?: (error: SopError) => void; kanalen: readonly Kanaal[] }) {
  const [, setRefreshKey] = useState(0);
  const [analysisChannel, setAnalysisChannel] = useState<Channel>("blended");
  // isDemoMode() leest window.location, dus in een effect en niet in de eerste render -- anders
  // rendert de server iets anders dan de client en klapt de hydratie eruit (zelfde reden als
  // demoModus in ClientDashboard zelf, hierboven in dit bestand).
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoMode()); }, []);

  // Het kanaal-subtabje kiest alleen WELKE analyses je draait; het uitkomsten-filter blijft
  // standaard op "Alle kanalen" (geen kanaal is belangrijker) en wisselt alleen op eigen klik.
  const onComplete = () => setRefreshKey((k) => k + 1);

  // Sectiekop: scheidt de losse (deterministische) analyses bovenaan van de zware maand-SOP
  // eronder, zodat je alle analyses ziet zonder dat een volledige SOP-uitwerking ze wegduwt.
  // Optionele `extra` rechts in dezelfde regel -- alleen gebruikt bij "Losse analyses" (Google),
  // want alleen dáár verbruiken de analyses credits (lib/analysis/credit-costs.ts).
  const Section = ({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) => (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-micro font-semibold text-brand-blue-ink uppercase tracking-wide whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-border" />
      {extra}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Alle analyses draaien hier, per kanaal; de kanaaltabs elders zijn data-weergaven. */}
      <ChannelTabs channel={analysisChannel} onChange={setAnalysisChannel} beschikbaar={kanalen ?? []} />

      {analysisChannel === "google" && (
        <>
          <Section extra={<CreditBalanceBadge />}>Losse analyses</Section>
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
          <SopTriggerButtons clientId={clientId} onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
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
          <SopTriggerButtons clientId={clientId} channel="meta_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
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
          <SopTriggerButtons clientId={clientId} channel="linkedin_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
        </>
      )}
      {analysisChannel === "blended" && (
        <>
          <Section>Sub-analyses</Section>
          {/* Cross-channel als losse sub-analyse-kaarten (net als de kanalen), uit één run. */}
          <CrossChannelAnalyses clientId={clientId} />
          {/* Master Synthesis (Pijler 6) heeft pas iets kanaaloverstijgends te zeggen bij 2+
              kanalen -- zelfde grootheid (kanalen.length > 1) als meerdereKanalen elders op deze
              pagina. Bij één kanaal is elke aanbeveling per definitie van dat ene kanaal. */}
          {kanalen.length > 1 && (
            <>
              <Section>Pijler 6</Section>
              <MasterSynthesisAnalysis clientId={clientId} />
            </>
          )}
          {/* God View en cross-account (portfolio-synthese) zijn platform-/bureaubreed, geen
              klant-eigen data -- ze horen normaal op /vandaag, niet op een klantpagina. Maar
              "in het demo-account" is precies waar een demo-bezoeker ze wil kunnen laten zien
              zonder eerst weg te navigeren. Zelfde componenten, zelfde statische demo-data
              (lib/demo/god-view-demo.ts, GEEN echte sessie of LLM-aanroep nodig) als op
              /vandaag?demo=1 -- puur hier ook ingesloten. Alleen in demo-modus: buiten demo
              is dit geen klant-eigen data en hoort het hier niet te staan. */}
          {demoModus && (
            <>
              <Section>Cross-account &amp; God View (demo)</Section>
              <GodViewDemo />
            </>
          )}
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
        icoon={<ClipboardCheck className="w-4.5 h-4.5 text-brand-blue-ink" />}
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
        icoon={<Lightbulb className="w-4.5 h-4.5 text-brand-blue-ink" />}
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
        icoon={<Kanban className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat eruit volgt"
        bijschrift="Aanbevelingen, hypotheses en de taken die eruit voortkomen"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
