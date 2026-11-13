"use client";

import { useState, useEffect, useMemo, useCallback, useLayoutEffect, useDeferredValue } from "react";
import { useSearchParams } from "next/navigation";
import { Database, BarChart3, Settings, Target, AlertTriangle, Wifi, FlaskConical, Clock, LayoutGrid, Lightbulb, TrendingUp, FolderOpen, Users, Kanban, ClipboardCheck, FileText, Megaphone, Briefcase, Layers, Crown, Search } from "lucide-react";
import { SyncStatusBadge } from "./sync-status-badge";
import { PaginaLaadvlak } from "@/components/ui/laadvlak";
import { getClientSettings, zaaiClientSettingsRij, type ClientSettingsRow } from "@/lib/client-settings";
import { zaadNogVers, type Zaad } from "@/lib/overzicht/zaadbak";
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
import { ChannelFilter } from "../insights/channel-filter";
import { dbSelect } from "@/lib/data-access/client-read";
import {
  laadBeschikbareKanalen, kanalenUitBronnen, proefjeNodig, PROEFJE_WACHT_MS, zichtbareTabs, geenDataTekst, kanalenOpsomming,
  KANAAL_PARAM, kanaalUitUrl, kanaalkeuzeUitUrl, kanaalParamRechtgezet,
  type Kanaal,
} from "@/lib/kanalen/beschikbaar";
import { GEO_PARAM, leesAdresbalk, schrijfAdresbalk, useUrlKeuze, type UrlKoppeling } from "@/lib/adresbalk";
import { periodeUitParams, zetPeriodeParams } from "@/lib/period/periode-url";
import { metDagUitParams, zetMetDagParams, type PeriodeKeuzeMetDag } from "@/lib/period/dag-keuze";
import { useEventPeriodes } from "@/lib/events/use-event-periodes";
import { googleHeeftData } from "@/lib/period/apply-period";

// laadBeschikbareKanalen() neemt structureel een client aan met .from(); de browser-singleton
// (lib/supabase.ts) is dat in demo-modus de mock, en die herkent alleen client_id ===
// "demo-greentech" als demo-klant -- de geo-klonen demo-grt/demo-gra/demo-grn (eigen rijen in
// `accounts`, eigen doorgeseede data) vallen daarbuiten en kregen dus altijd [] terug: de banier
// "nog geen data" bovenaan een klantpagina die eronder gewoon cijfers toonde (de rest van deze
// pagina loopt al via dbSelect, dus altijd de echte database). Deze kleine adapter praat met
// dezelfde /api/data-route als dbSelect, in plaats van met de mogelijk-gemockte singleton.
const dbSelectAlsSupabase = {
  from(tabel: string) {
    return {
      select(kolom: string) {
        return {
          eq(_kolom: string, waarde: string) {
            return { limit: (n: number) => dbSelect(tabel, { select: kolom, clientId: waarde, limit: n }) };
          },
        };
      },
    };
  },
};
import { MetaCreativeAnalyses } from "../insights/meta-creative-analyses";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { CrossChannelAnalyses } from "./cross-channel-analyses";
import { MasterSynthesisAnalysis } from "./master-synthesis-analysis";
import { ChannelForecastSections } from "./channel-forecast-sections";
import { ChannelBudgetScenario } from "./channel-budget-scenario";
import { EventForecaster } from "./event-forecaster";
import { ChatDrawer } from "@/components/chat/chat-drawer";
import { CreativeDeepDive } from "./creative-deep-dive";
import { isDemoClient, isDemoClientId } from "@/lib/demo/demo-mode";
import { GodViewDemo } from "@/components/terminal/god-view-demo";
import { ChannelGapCard } from "./channel-gap-card";
import type { InsightChannel } from "@/lib/insights/channel-of";
import { PeriodProvider, usePeriod, type PeriodDataStand } from "@/lib/period/period-context";
import { bandDataStand } from "@/lib/period/band-stand";
import { NIET_GOOGLE } from "@/lib/period/kanaal-maanden";
import { PeriodSelector, PeriodeSnelkoppelingen } from "./period-selector";
import { PeriodeKiezer } from "./periode-kiezer";
import { PeriodSummary } from "./period-summary";
import { GeenBeursfilter } from "./geen-beursfilter";
import { overzichtBeursmelding } from "@/lib/overzicht/beursfilter";
import { kiezerOpTab } from "@/lib/period/kiezer-per-tab";
import { OverzichtBovenkant } from "./overzicht-bovenkant";
import { OverzichtWatNu } from "./overzicht-wat-nu";
import { WeergaveSchakelaar } from "./weergave-schakelaar";
import { useWeergave } from "@/lib/use-weergave";
import { WEERGAVE_PARAM } from "@/lib/weergave";
import { kaartStand } from "@/lib/overzicht/bovenkant";
import { today } from "@/lib/reporting-date";
import { SprintPlanning } from "../insights/sprint-planning";
import { ClientFiles } from "./client-files";
import { DgmView } from "./dgm-view";
import { MetaView, MetaCampagnes } from "./meta-view";
import { LinkedInView, LinkedInCampagnes } from "./linkedin-view";
import { MicrosoftView, MicrosoftCampagnes } from "./microsoft-view";
import { GoogleView, GoogleCampagnes, GoogleForecast } from "./google-view";
import { ForecastSummaryTiles, ForecastTable } from "./forecast-table";
import { CrossChannelView } from "./cross-channel-view";
import { CampaignsPerChannel } from "./campaigns-per-channel";
import { BrandingView } from "./branding-view";
import { FullBrandingToggle } from "./full-branding-toggle";
import { EventSettings } from "./event-settings";
import { GeoCloneSettingsPanel } from "./geo-clone-settings";
import { ChannelConversionSettings } from "./channel-conversion-settings";
import { ConversieTrechterSettings } from "./conversie-trechter-settings";
import { Ga4Settings } from "./ga4-settings";
import { SearchConsoleSettings } from "./search-console-settings";
import { ChannelStructureAnalysis } from "./channel-structure-analysis";
import { GeoCloneScope } from "./geo-clone-scope";
import { TrackingAlert } from "./tracking-alert";
import { CodeRoodBanner } from "./code-rood-banner";
import { ClientNotes } from "./client-notes";
import { STAND_VAN_NU } from "@/components/ui/vensterlabel";
import { kanaalbalkCookieRegel, reserveerKaartenrij, type BalkGeheugen } from "@/lib/overzicht/kaartenrij";
import { SectieKopBijeen } from "@/components/ui/sectie";
import { ClientReporting } from "./client-reporting";
import { BrandThemeProvider } from "../branding/brand-theme-provider";
import { BrandHeaderBar } from "../branding/brand-header-bar";
import { useClientData, zaaiClientData, type GoogleAntwoord } from "@/lib/use-client-data";
import { BandUitZaad, type BandZaad } from "./band-uit-zaad";
import { useChannelPeriodData } from "@/lib/use-channel-period-data";
import { useBlendedClientData, vergeetBlendedClientData, zaaiBlendedClientData, type BlendedAntwoord } from "@/lib/use-blended-client-data";
import { ClientDataProvider } from "@/lib/client-data-provider";
import { AnalysisProvider } from "@/lib/analysis-context";
import { Sectie } from "@/components/ui/sectie";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import { OnderdeelGrens } from "@/app/(app)/foutgrens";

interface Client {
  id: string;
  name: string;
  source?: string;
}

type Tab = "dashboard" | "campaigns" | "forecast" | "insights" | "outcomes" | "godview" | "sprint" | "reporting" | "dgm" | "second-opinion" | "files" | "settings";


type Channel = "google" | "meta" | "linkedin" | "microsoft" | "blended";

// Eén vaste lege lijst: `kanalen ?? []` maakte bij elke render een nieuwe, en dan ziet de memo om
// CrossChannelView elke keer een andere prop.
const GEEN_KANALEN: Kanaal[] = [];

const CHANNELS: { id: Channel; label: string; icon: React.ReactNode }[] = [
  { id: "blended", label: "Alle kanalen", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "google", label: "Google Ads", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "meta", label: "Meta", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { id: "microsoft", label: "Microsoft", icon: <Search className="w-3.5 h-3.5" /> },
];

/**
 * De kanaalkiezer, maar alleen voor de kanalen die deze klant écht heeft.
 *
 * Gemeten op de 71 accounts: 62 hebben alleen Google. Die zagen hier vier tabs, waarvan twee naar
 * een leeg scherm leidden en "Alle kanalen" hetzelfde toonde als het enige kanaal. Bij één kanaal
 * verdwijnt de balk daarom helemaal -- een kiezer met één knop is geen keuze.
 */
function ChannelTabs({ channel, onChange, beschikbaar, ladenMetBalk = false }: {
  channel: Channel;
  onChange: (c: Channel) => void;
  beschikbaar: readonly Kanaal[];
  /** De kanalen zijn nog onbekend en deze klant had de vorige keer een kanaalbalk. */
  ladenMetBalk?: boolean;
}) {
  const toegestaan = zichtbareTabs(beschikbaar);
  if (toegestaan.length === 0) {
    // Zolang de kanalen onbekend zijn: de hoogte van de balk reserveren als deze klant er de
    // vorige keer een had. De balk verscheen anders ná de band en duwde die zestig pixels omlaag
    // (CLS 0,17). Zonder herinnering niets: de meeste klanten hebben één kanaal en dus geen balk.
    return ladenMetBalk ? <div className="h-9 w-72 max-w-full rounded-lg bg-gray-100" aria-hidden /> : null;
  }
  const zichtbaar = CHANNELS.filter((c) => (toegestaan as string[]).includes(c.id));
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto bg-gray-100 rounded-lg p-1 w-fit">
      {zichtbaar.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          aria-pressed={channel === c.id}
          className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
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
  { id: "analyse", label: "Analyse & advies", icon: <Lightbulb className="w-4 h-4" />, tabs: ["insights", "outcomes", "godview", "second-opinion"] },
  { id: "planning", label: "Planning & rapportage", icon: <Kanban className="w-4 h-4" />, tabs: ["sprint", "dgm", "reporting", "files"] },
  { id: "instellingen", label: "Instellingen", icon: <Settings className="w-4 h-4" />, tabs: ["settings"] },
];
const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Overzicht", campaigns: "Campagnes", forecast: "Prognose",
  insights: "Analyseren", outcomes: "Bevindingen", godview: "God View", "second-opinion": "Second opinion",
  sprint: "Sprint", dgm: "Doelen & voortgang", reporting: "Rapporten", files: "Bestanden",
  settings: "Instellingen",
};

// eenRegel (de nieuwe weergave): de twee rijen breken niet af maar schuiven opzij binnen hun vak
// (het klantdashboard zet er een schuifbaar vak omheen). Op een telefoon waren het drie regels
// knoppen boven het eerste cijfer; zo zijn het er altijd twee.
function GroupedTabNav({ activeTab, onChange, sopErrorCount, eenRegel = false }: { activeTab: Tab; onChange: (t: Tab) => void; sopErrorCount: number; eenRegel?: boolean }) {
  const activeSection = CLIENT_SECTIONS.find((s) => s.tabs.includes(activeTab)) ?? CLIENT_SECTIONS[0];
  const regel = eenRegel ? "w-max [&>button]:shrink-0 [&>button]:whitespace-nowrap" : "flex-wrap";
  return (
    <div className="space-y-2">
      {/* Top: de vier secties */}
      <div className={`flex gap-1 bg-gray-100 rounded-lg p-1 ${eenRegel ? regel : "w-fit flex-wrap"}`}>
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
        <div className={`flex gap-1 pl-1 ${regel}`}>
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
//
// jaarlijkseEditie: de kiezer waarschuwt dat "voorgaande periode" bij een jaarlijkse beurs de
// aanloop met de nasleep vergelijkt. Die waarschuwing bestond, maar de vlag werd hier nooit
// meegegeven, dus hij kon in productie niet verschijnen. maxMaand: de eindmaand van de presets,
// zodat je met de hand niet voorbij het eind van de data kunt kiezen. klaar: dezelfde poort als de
// KPI-band; tot de stand bekend is, is eindMaand de kalender, en dan toonde de kiezer een venster
// dat even later versprong (review [8]).
//
// De snelkoppelingen 3, 6 en 12 maanden staan ernaast (bouwplan fase 2): de drie vensters die je
// het vaakst wisselt, zonder eerst het paneel te openen. Ze zetten de bestaande presets via
// dezelfde periode.set; er komt geen tweede periodemodel bij.
//
// snelVanafTablet (de nieuwe weergave): op een telefoon staan de snelkoppelingen niet los boven de
// kiezer. Dezelfde drie vensters staan in het paneel van de kiezer; de losse rij kostte daar
// veertig pixels boven het eerste cijfer. `contents` in de gewone weergave: dan doet het vak niet
// mee in de opmaak en staat alles precies waar het stond.
function DashboardPeriodPicker({ jaarlijkseEditie, klaar, snelVanafTablet = false }: { jaarlijkseEditie: boolean; klaar: boolean; snelVanafTablet?: boolean }) {
  const periode = usePeriod();
  return (
    <>
      <div className={snelVanafTablet ? "hidden sm:block" : "contents"}>
      <PeriodeSnelkoppelingen
        preset={periode.preset}
        laden={!klaar}
        onKies={(preset) => periode.set(preset, null, periode.comparison)}
      />
      </div>
      <PeriodSelector
        jaarlijkseEditie={jaarlijkseEditie}
        laden={!klaar}
        maxMaand={periode.eindMaand}
        value={{
          preset: periode.preset, custom: periode.custom, comparison: periode.comparison,
          range: periode.range, compareRange: periode.compareRange,
        }}
        onChange={(v) => periode.set(v.preset, v.custom, v.comparison)}
      />
    </>
  );
}

export function ClientDashboard({ client, bewaardeWeergave = null, kanaalbalkVanServer = null, blendedVanServer = null, instellingenVanServer = null, googleVanServer = null, periodeVanServer = null, vandaagVanServer = null }: {
  client: Client;
  /** De weergave zoals de server hem in de cookie las (lib/weergave.ts), zodat de eerste render al
   *  de gekozen kop toont in plaats van eerst de vertrouwde en dan de nieuwe. */
  bewaardeWeergave?: string | null;
  /** Of deze klant de vorige keer een kanaalbalk had, zoals de server het in de cookie las
   *  (lib/overzicht/kaartenrij.ts): dan staat de vrijgehouden rij al in de eerste HTML. */
  kanaalbalkVanServer?: BalkGeheugen;
  /** Het antwoord van de blended route en de client_settings-rij, door de server al gelezen terwijl
   *  hij de pagina stuurde (lib/overzicht/zaad-server.ts). Beloften, niet afgewacht: ze komen in
   *  dezelfde respons na. Null (een navigatie binnen de app: de server las niets) of een belofte
   *  met null (geen toegang, een fout): dan vraagt de browser het zelf, zoals het was. Het blended
   *  antwoord kan ook "geen data" zijn ({ error }): de uitkomst van de 404 van de route. */
  blendedVanServer?: Promise<Zaad<BlendedAntwoord> | null> | null;
  instellingenVanServer?: Promise<Zaad<{ rij: ClientSettingsRow | null }> | null> | null;
  /** Het antwoord van de Google-route, idem; alleen een geslaagd antwoord (zaad-server.ts). */
  googleVanServer?: Promise<Zaad<GoogleAntwoord> | null> | null;
  /** De bewaarde periode zoals de server hem uit de cookie las (lib/period/periode-cookie.ts). */
  periodeVanServer?: PeriodeKeuzeMetDag | null;
  /** Vandaag volgens de server: de kerncijfers uit het zaad rekenen in de browser met dezelfde dag. */
  vandaagVanServer?: string | null;
}) {
  // Het zaad klaarleggen VOOR de hooks hieronder hun eerste verzoek doen (dat gebeurt in een
  // effect, dus na deze render). Tijdens het renderen en niet in een effect: de effecten van de
  // kinderen lopen vóór die van deze component, en dan was het eerste verzoek al weg. Het mag
  // hier, want het is herhaalbaar: dezelfde belofte twee keer zaaien doet niets, op de server
  // doet het helemaal niets (zaadbak.ts), en er verandert geen staat door.
  zaaiBlendedClientData(client.id, blendedVanServer);
  zaaiClientSettingsRij(client.id, instellingenVanServer);
  zaaiClientData(client.id, googleVanServer);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  // DE KANAALKEUZE WOONT IN DE ADRESBALK (?kanaal=meta; bouwplan fase 2). Hier stond een useState:
  // een herlaad sprong terug naar "Alle kanalen", Terug verliet de klant, en een link naar één
  // kanaal bestond niet. De wissel zelf gaat via history.pushState en kost geen navigatie, geen
  // serverwerk en geen verzoek; ?geo= en ?demo= blijven staan (lib/adresbalk.ts). `kanaalUitAdres`
  // is het kanaal zoals het er staat; wat er getoond wordt (`channel`) volgt verderop, als bekend
  // is welke kanalen deze klant heeft.
  const searchParams = useSearchParams();
  const kanaalRuw = searchParams.get(KANAAL_PARAM);
  const [kanaalUitAdres, kiesKanaalInAdres] = useUrlKeuze<Kanaal>({
    waarde: kanaalUitUrl(kanaalRuw),
    leesNu: () => kanaalUitUrl(leesAdresbalk().get(KANAAL_PARAM)),
    schrijf: (k) => schrijfAdresbalk((p) => { if (k) p.set(KANAAL_PARAM, k); else p.delete(KANAAL_PARAM); }, "push"),
  });
  const setChannel = useCallback((c: Channel) => kiesKanaalInAdres(c === "blended" ? null : c), [kiesKanaalInAdres]);
  // De schakelaar "Nieuwe weergave" (bouwplan fase 3): per gebruiker bewaard, standaard uit, en met
  // ?weergave=nieuw voorop zodat de meting hem kan openen (lib/weergave.ts; de server geeft de
  // bewaarde keuze mee uit de cookie, zodat de kop niet verspringt bij het laden). Uit: de pagina is wat
  // hij was. Aan: de merkregel, de kanaalkaarten, de tegels en de hoofdgrafiek van
  // OverzichtBovenkant, en onder de bovenkant de herschikte opbouw van fase 5 op elk tabblad (de
  // prop `nieuw` van CrossChannelView, GoogleView, MetaView, LinkedInView en MicrosoftView).
  const [weergave, zetWeergave] = useWeergave(searchParams.get(WEERGAVE_PARAM), bewaardeWeergave);
  const nieuweWeergave = weergave === "nieuw";
  // De periode in de adresbalk (?periode=, ?vergelijk=): dezelfde keuze als de PeriodProvider al
  // bewaart, geen tweede model. Bijstellen vervangt het adres (replace): Terug hoort naar het
  // vorige kanaal te gaan, niet door vijf periodes terug te lopen.
  //
  // In de nieuwe weergave met de keuze per dag erbij (lib/period/dag-keuze.ts): een event, vrije
  // datums, de vorige editie, een vrije vergelijking. Een oud adres leest daar precies zoals hier.
  const periodeAdres = useMemo((): UrlKoppeling<PeriodeKeuzeMetDag> => (nieuweWeergave ? {
    waarde: metDagUitParams(searchParams),
    leesNu: () => metDagUitParams(leesAdresbalk()),
    schrijf: (k) => schrijfAdresbalk((p) => zetMetDagParams(p, k), "replace"),
  } : {
    waarde: periodeUitParams(searchParams),
    leesNu: () => periodeUitParams(leesAdresbalk()),
    schrijf: (k) => schrijfAdresbalk((p) => zetPeriodeParams(p, k), "replace"),
  }), [searchParams, nieuweWeergave]);
  // De kerncijfers die de server al uit het zaad rekent (band-uit-zaad.tsx), zolang de hooks
  // hieronder laden. Alleen met beide antwoorden van de server, en alleen als server en browser
  // dezelfde periode kennen: uit de adresbalk, of uit de cookie die de server meegaf. Zonder een
  // van beide begint de PeriodProvider op de standaard en leest hij daarna localStorage; dan zou
  // het getal uit het zaad kunnen verspringen, en wacht de band op de hooks zoals altijd. En niet
  // met een belofte die de router na meer dan een minuut terugbrengt (zaadNogVers, zaadbak.ts).
  //
  // En niet bij een keuze per dag (een event, vrije datums): die telt de server niet uit het zaad
  // (dat zijn maandreeksen), dus dan wachten de tegels op de telling per dag.
  const periodeBekend = periodeVanServer !== null || periodeUitParams(searchParams) !== null;
  const dagKeuzeBekend = nieuweWeergave && !!(periodeAdres.waarde ?? periodeVanServer)?.dag;
  const zaadAanbod = useMemo((): BandZaad | null => (
    googleVanServer && blendedVanServer && vandaagVanServer && periodeBekend && !dagKeuzeBekend && zaadNogVers(googleVanServer)
      ? { clientId: client.id, google: googleVanServer, blended: blendedVanServer, kanaal: kanaalUitAdres, vandaag: vandaagVanServer }
      : null
  ), [client.id, googleVanServer, blendedVanServer, vandaagVanServer, periodeBekend, dagKeuzeBekend, kanaalUitAdres]);
  // Alleen gebruikt voor het bronbijschrift verderop. isDemoMode() leest window.location, dus dit
  // hoort in een effect en niet in de eerste render -- anders rendert de server iets anders dan de
  // client en klapt de hydratie eruit.
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoClient(client.id)); }, [client.id]);

  const clientData = useClientData(client.id);
  // De blended route, voor ÉLKE klant en meteen bij de mount (fase 1, stap 4). Hij draagt wat het
  // Overzicht nodig heeft: de maandreeks per kanaal voor de KPI-band, de syncstand per kanaal
  // (<kanaal>_connections is in de browser niet leesbaar), en welke dagkanalen deze klant heeft.
  // Eerder startte hij pas nadat vier aanwezigheidsproefjes (laadBeschikbareKanalen) klaar waren,
  // en alleen bij een niet-Google-kanaal: een waterval proefjes -> route -> band. Een klant zonder
  // enige data krijgt een 404; dat is de terugvalweg hieronder. CrossChannelView en de
  // kanaalprovider lezen dezelfde hook; meerdere mounts geven één verzoek.
  const blendedStand = useBlendedClientData(client.id);

  // Welke kanalen deze klant heeft, per kanaal uit de bron die het al weet:
  // - Google uit het Google-antwoord zelf (een maand met data): de band toont Google live, dus een
  //   account dat nog niet in de database gesynct is, is er hier wel.
  // - De drie dagkanalen uit perKanaal van de blended route (alleen kanalen met rijen staan erin).
  // - En het proefje laadBeschikbareKanalen (vier verzoeken met limit 1 en één kolom) als RACE
  //   ernaast, niet erna: het vertrekt bij de mount, tegelijk met de twee routes, en wie het eerst
  //   antwoordt bepaalt de dagkanalen. Zo hangt de kanalenlijst van een klant met alleen Google
  //   (62 van de 71) niet aan de duur van de blended route, en is een routefout (404 bij een klant
  //   zonder fact_core-rijen) geen tweede ronde: het antwoord van het proefje ligt er dan al.
  //   EEN UITZONDERING: stuurt de server het antwoord van de route met de pagina mee
  //   (lib/overzicht/zaad-server.ts), dan valt er niets te racen. Het antwoord is er dan vóór het
  //   proefje kon terugkomen, en de vier verzoeken waren bij elke paginalaad voor niets. Het
  //   proefje vertrekt in dat geval alleen nog als het zaad niets bruikbaars bleek te dragen, de
  //   route een fout geeft (ook "geen data" uit het zaad zelf) of PROEFJE_WACHT_MS stil blijft:
  //   proefjeNodig in lib/kanalen/beschikbaar.ts.
  // De route gaat voor zodra hij er is: hij is ook de bron van de cijfers in de band.
  const [proefje, setProefje] = useState<{ clientId: string; kanalen: Kanaal[] } | null>(null);
  const routeKlaar = !blendedStand.loading && blendedStand.error === null && blendedStand.perKanaal !== null;
  const routeFout = blendedStand.error !== null;
  // Welke belofte van de server niets bruikbaars droeg (geen toegang, een fout daar, de stroom
  // brak af). Tot dat blijkt geldt het zaad als verwacht. Vastgehouden als de belofte zelf: een
  // volgende paginalaad brengt een nieuwe mee, en die begint weer als verwacht.
  const [zaadZonderAntwoord, setZaadZonderAntwoord] = useState<unknown>(null);
  useEffect(() => {
    if (!blendedVanServer) return;
    let levend = true;
    Promise.resolve(blendedVanServer).then((z) => !z, () => true).then((leeg) => { if (levend && leeg) setZaadZonderAntwoord(blendedVanServer); });
    return () => { levend = false; };
  }, [blendedVanServer]);
  const zaadVerwacht = blendedVanServer != null && zaadZonderAntwoord !== blendedVanServer;
  // Voor welke klant de route te lang stil bleef. Per klant: na een klantwissel begint de klok opnieuw.
  const [routeStilVoor, setRouteStilVoor] = useState<string | null>(null);
  useEffect(() => {
    if (routeKlaar || routeFout) return;
    const klok = setTimeout(() => setRouteStilVoor(client.id), PROEFJE_WACHT_MS);
    return () => clearTimeout(klok);
  }, [client.id, routeKlaar, routeFout]);
  const startProefje = proefjeNodig({
    routeKlaar, routeFout, routeStil: routeStilVoor === client.id, proefjeBekend: proefje?.clientId === client.id, zaadVerwacht,
  });
  useEffect(() => {
    if (!startProefje) return;
    let levend = true;
    laadBeschikbareKanalen(dbSelectAlsSupabase, client.id)
      .then((k) => { if (levend) setProefje({ clientId: client.id, kanalen: k }); })
      .catch(() => { if (levend) setProefje({ clientId: client.id, kanalen: [] }); });
    return () => { levend = false; };
  }, [client.id, startProefje]);
  // null = nog niet bekend. Dat onderscheid telt: "nog niet weten" mag er niet uitzien als
  // "geen kanalen", anders flitst de lege staat op bij elke navigatie.
  const googleData = clientData.data;
  const routePerKanaal = blendedStand.perKanaal;
  // De regel zelf (wie gaat voor, wanneer is het nog onbekend) staat in kanalenUitBronnen
  // (lib/kanalen/beschikbaar.ts) en is daar getoetst.
  const kanalenNu = useMemo((): Kanaal[] | null => kanalenUitBronnen({
    googleLaadt: clientData.loading,
    google: googleHeeftData(googleData),
    route: routeKlaar ? (routePerKanaal ?? []).map((r) => r.kanaal) : null,
    proefje: proefje?.clientId === client.id ? proefje.kanalen : null,
  }), [client.id, clientData.loading, googleData, routeKlaar, routePerKanaal, proefje]);
  // Eenmaal bekend blijft de lijst staan terwijl een bron opnieuw laadt (de Google-route na het
  // opslaan van de instellingen zet `loading` weer op true): het zijn dezelfde kanalen, en zonder
  // dit sprong de periodekiezer bij elke opslag terug naar "laden", ook op een Meta-, LinkedIn- of
  // Microsoft-tab, die de Google-route niet eens leest.
  const [kanalenBekend, setKanalenBekend] = useState<{ clientId: string; kanalen: Kanaal[] } | null>(null);
  useEffect(() => { if (kanalenNu) setKanalenBekend({ clientId: client.id, kanalen: kanalenNu }); }, [client.id, kanalenNu]);
  const kanalen = kanalenNu ?? (kanalenBekend?.clientId === client.id ? kanalenBekend.kanalen : null);

  // Wat er getoond wordt: het kanaal uit de adresbalk, bijgesteld zodra bekend is wat deze klant
  // heeft (geldigeKeuze, via kanaalkeuzeUitUrl). Zonder dat bijstellen blijf je hangen op een
  // kanaal dat deze klant niet heeft: ?kanaal=meta bij een klant met alleen Google liet een leeg
  // scherm zien onder een tab die niet eens bestond. Afgeleid en geen eigen state: de adresbalk
  // is de bron, en een tweede kopie kan ervan afwijken.
  const channel: Channel = kanaalkeuzeUitUrl(kanaalUitAdres, kanalen);
  // Het kanaal voor het deel ONDER de bovenkant (het hele kanaaltabblad), een render later dan de
  // klik. Een kanaalwissel brak in één synchrone render het oude tabblad af en bouwde het nieuwe
  // op, samen met de kaarten, de tegels en de grafiek: gemeten één lange taak per wissel (76 tot
  // 141 ms, bij een vier keer tragere processor 443 tot 1076 ms), en de gekozen kaart lichtte pas
  // op als dat allemaal klaar was. Nu krijgen de kaarten, de tegels en de grafiek het kanaal
  // meteen, en volgt het tabblad in een render die React mag onderbreken. Zolang het achterloopt
  // staat het gedimd en met aria-busy (zie verderop): boven staan dan al de cijfers van het
  // nieuwe kanaal en eronder nog het oude tabblad, en dat mag niet als één geheel lezen. De
  // cijfers zelf veranderen niet, alleen het moment waarop het tabblad wisselt.
  // ALLEEN IN DE NIEUWE WEERGAVE. Met de schakelaar uit wisselt het tabblad in dezelfde render als
  // de tabs en de band, zoals het altijd deed: de oude weergave mag alleen sneller worden, niet
  // anders, en een moment met de band van het ene kanaal boven het tabblad van het andere is anders.
  const naarBeoordelen = useCallback(() => setActiveTab("outcomes"), []);
  const naarInstellingen = useCallback(() => setActiveTab("settings"), []);
  const kanaalUitgesteld = useDeferredValue(channel);
  const kanaalOnder: Channel = nieuweWeergave ? kanaalUitgesteld : channel;
  const onderLooptAchter = kanaalOnder !== channel;
  // En het adres zelf rechtzetten als er iets staat wat niet kan (een onbekend kanaal, een kanaal
  // dat deze klant niet heeft, of een kanaal bij een klant zonder kiezer): dan staat er geen adres
  // boven dat iets anders beweert dan het scherm. Alleen weghalen, nooit toevoegen, en als
  // vervanging (replace): Terug hoort niet naar het ongeldige adres te leiden.
  useEffect(() => {
    if (!kanalen) return;
    const ruw = leesAdresbalk().get(KANAAL_PARAM);
    if (ruw !== null && kanaalParamRechtgezet(ruw, kanalen) === null) {
      schrijfAdresbalk((p) => p.delete(KANAAL_PARAM), "replace");
    }
  }, [kanalen, kanaalRuw]);
  // Beurs-scope; initieel en live gestuurd door ?geo= uit het menu (Fase 3), daarna ook
  // via de kiezer in de view aanpasbaar.
  const geoParam = searchParams.get(GEO_PARAM);
  const [geoClone, setGeoClone] = useState<string | null>(geoParam);
  useEffect(() => { setGeoClone(geoParam); }, [geoParam]);
  const [sopErrors, setSopErrors] = useState<SopError[]>([]);
  // KPI-rij bovenaan: "deze kpi header rij moet standaard alles tonen. bij filtering pas kanaal
  // specifiek" -- op "blended" (de standaard) telt hij alle kanalen op, op een gekozen kanaal
  // toont hij alleen dat kanaal. Voorheen las PeriodSummary altijd clientData.data (Google), ook
  // op de Meta/LinkedIn/Alle kanalen-tabs. Meta/LinkedIn/Microsoft komen uit de blended route
  // (perKanaal); de eigen dagrijen alleen als terugval (zie lib/use-channel-period-data.ts).
  const periodSummary = useChannelPeriodData({ clientId: client.id, channel, googleData: clientData.data, route: blendedStand });
  const [lagDays, setLagDays] = useState<number>(3);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  // Stuurt deze klant op een beurs, dan is de kalendermaand niet de as die telt. De
  // prestatiekaart schakelt dan naar weken-tot-beurs; de maandweergave blijft een klik ver weg
  // voor wie toch per maand wil kijken.
  // Met de gekozen beurs: zonder geo stond in de hero de naam van de gekozen beurs naast de
  // aftelling van welke ingestelde beurs toevallig de eerstvolgende was.
  const upcomingEdition = useUpcomingEdition(client.id, geoClone);
  // De events van de klant als kiesbare periodes, alleen voor de kiezer van de nieuwe weergave.
  const eventPeriodes = useEventPeriodes(client.id, nieuweWeergave, activeTab);
  const [tijdas, setTijdas] = useState<"beurs" | "maand">("beurs");

  useEffect(() => {
    const settings = getClientSettings(client.id);
    setLagDays(settings.conversionLagDays ?? 3);
  }, [client.id]);

  // Tot waar de data van het ACTIEVE kanaal loopt. De presets eindigen daarop (PeriodProvider) en
  // niet op de kalender: bij een sync die op 26 augustus stopte liep "laatste 12 maanden" op
  // 1 november t/m oktober, en telden september en oktober mee als maanden zonder kosten en
  // conversies: de vergelijking zakte in zonder dat er iets gebeurd was.
  // Per kanaal en niet één stand voor alles: een achterlopend Meta hoort het venster van het
  // Google-tabblad niet in te korten. Uit de bronnen die de band zelf toont, met de syncstand van de
  // blended route erbij; zie lib/period/band-stand.ts (review [3], [7], [12]).
  const dataStand: PeriodDataStand | null = bandDataStand({
    channel,
    kanalen: kanalen ?? [],
    google: clientData.data?.dataStand,
    laatsteDag: periodSummary.laatsteDag,
    route: blendedStand.dataStand,
  });
  // Geen cijfers (en geen periode in de kiezer) zolang de stand nog niet bekend is: anders staat de
  // band eerst op het kalendervenster en springt hij daarna, met tussendoor percentages over
  // maanden die er niet zijn. Bekend is: de kanalen en de eigen bronnen van dit tabblad. Google uit
  // de Google-route; een dagkanaal is `klaar` zodra de blended route er is (zijn maandreeks én de
  // syncstand komen in hetzelfde antwoord), of in de terugvalweg -- een routefout, of een route die
  // WACHT_MS stil blijft -- zodra zijn eigen rijen binnen zijn; dan rekent de band daarop.
  // Het Google-tabblad wacht niet op de blended route: zijn stand komt uit de Google-route zelf.
  // Een losse `!blendedStand.loading` staat er daarom niet meer bij: die hield het Google-tabblad
  // van een klant met alleen Google aan de blended route vast, en een route die bleef hangen de
  // band voor altijd dicht, ook nadat de eigen rijen er al waren.
  const eigenStandBekend = channel === "google" ? !clientData.loading
    : channel === "blended" ? !clientData.loading && NIET_GOOGLE.every((k) => periodSummary.klaar[k])
      : periodSummary.klaar[channel];
  // Had deze klant de vorige keer een kanaalbalk (meer dan één kanaal)? Alleen om tijdens het laden
  // de hoogte te reserveren; de waarheid komt uit `kanalen`.
  // Drie standen en geen twee: "er was een balk", "er was er geen", en "over deze klant is niets
  // bekend" (lib/overzicht/kaartenrij.ts). In de nieuwe weergave komt de beginwaarde van de server
  // (een cookie onder het pad van deze klant), zodat de eerste HTML al klopt. De vertrouwde
  // weergave leest en schrijft die cookie niet: daar begint het op "niets bekend" en komt het
  // antwoord uit localStorage, vóór het eerste beeld, zoals het was.
  const vanServer = nieuweWeergave ? kanaalbalkVanServer : null;
  const [balkGeheugen, setBalkGeheugen] = useState<BalkGeheugen>(vanServer);
  const hadKanaalbalk = balkGeheugen === "1";
  // Layout-effect: vóór het eerste beeld, anders verschijnt de reservering zelf als een sprong.
  useLayoutEffect(() => {
    try {
      const v = window.localStorage.getItem(`kanaalbalk:${client.id}`);
      setBalkGeheugen(v === "1" || v === "0" ? v : vanServer);
    } catch { /* geen opslag: dan wat de server wist */ }
  }, [client.id, vanServer]);
  useEffect(() => {
    if (kanalen === null) return;
    const metBalk = zichtbareTabs(kanalen).length > 0;
    try { window.localStorage.setItem(`kanaalbalk:${client.id}`, metBalk ? "1" : "0"); } catch { /* idem */ }
    // En in de cookie, voor de server bij de volgende paginalaad. Alleen in de nieuwe weergave.
    if (!nieuweWeergave) return;
    try {
      const regel = kanaalbalkCookieRegel(metBalk, window.location.pathname);
      if (regel) document.cookie = regel;
    } catch { /* geen cookies: dan weet alleen de browser het */ }
  }, [client.id, kanalen, nieuweWeergave]);
  const bandKlaar = kanalen !== null && eigenStandBekend;
  // Het zaad is ALLEEN voor de eerste laad. Is de band hier één keer zelf klaar geweest, dan is elke
  // latere laadstand een verversing (invalidateClientCache na een andere conversieselectie in de
  // instellingen, client-settings.tsx), en dan zijn de cijfers van de paginalaad aantoonbaar oud:
  // ze horen bij de selectie van toen. Die toonden we eerst als het huidige getal, tot de route
  // antwoordde en ze versprongen (1.534 naar 7.534 in de toets). Nu het laadvlak, zoals vóór het zaad.
  // In een effect, dus pas na het hydrateren: de eerste render is op server en browser gelijk. Per
  // klant: met een andere klant in hetzelfde dashboard telt "was klaar" van de vorige niet.
  const [klaarVoorKlant, setKlaarVoorKlant] = useState<string | null>(null);
  useEffect(() => { if (bandKlaar) setKlaarVoorKlant(client.id); }, [bandKlaar, client.id]);
  const bandZaad = klaarVoorKlant === client.id ? null : zaadAanbod;

  // De datastand in woorden, voor de bronrij van de nieuwe weergave (bouwplan fase 4): tot welke
  // dag de cijfers op dit scherm lopen, voor het gekozen kanaal of voor alle kanalen samen. Dezelfde
  // regel als op de kanaalkaarten (kaartStand): "stil sinds" in rood als de data meer dan twee
  // weken achterloopt, behalve als de sync van elk betrokken kanaal gewoon draait. De demo had hier
  // niets staan (de syncbadge is er in de demo niet), terwijl juist daar de data op een vaste dag
  // ophoudt.
  const standTekst = useMemo(() => {
    const betrokken = channel === "blended" ? (kanalen ?? []) : [channel];
    const bronnen = blendedStand.dataStand?.bronnen ?? [];
    return kaartStand({
      dataTot: dataStand?.dataTot, vandaag: today(), demo: demoModus, bekend: bandKlaar,
      achterMaarSyncDraait: betrokken.length > 0 && betrokken.every((k) => bronnen.find((b) => b.bron === k)?.syncDraait === true),
    });
  }, [channel, kanalen, blendedStand.dataStand, dataStand?.dataTot, demoModus, bandKlaar]);

  // ── De stukken van de kop die in BEIDE weergaven staan ──────────────────────────────────────────
  // Benoemd en niet twee keer uitgeschreven: de nieuwe weergave zet ze in een andere volgorde en
  // dichter op elkaar, maar het zijn dezelfde onderdelen met dezelfde bedrading.

  // De periodekiezer staat in de kop en niet per tabblad: hij geldt voor de hele klantweergave, en
  // per tabblad een eigen periode zou betekenen dat twee getallen op hetzelfde scherm over
  // verschillende maanden gaan.
  //
  // Maar alleen op een tabblad waar een blok hem volgt (lib/period/kiezer-per-tab.ts). Op Prognose,
  // Bevindingen, Sprint en Doelen veranderde bij een andere keuze alleen het label van de kiezer
  // zelf; daar staat nu welk venster het tabblad wel heeft.
  const kiezerHier = kiezerOpTab(activeTab, nieuweWeergave);
  // Eén regel voor beide weergaven (lib/overzicht/beursfilter.ts).
  const beursmelding = overzichtBeursmelding(geoClone, activeTab, channel);
  //
  // In de nieuwe weergave de kiezer van stap 3 (components/dashboard/periode-kiezer.tsx): twee knoppen,
  // Periode en Vergelijk met, met de events van de klant en vrije datums. Met de schakelaar uit de
  // vertrouwde kiezer, precies zoals hij was.
  const periodeKiezer = kiezerHier.toon && nieuweWeergave ? (
    <PeriodeKiezer scope={`client-${client.id}`} clientId={client.id} events={eventPeriodes} kanalen={kanalen ?? GEEN_KANALEN} laden={!bandKlaar}
      onNaarEvents={() => setActiveTab("settings")} />
  ) : kiezerHier.toon ? (
    <DashboardPeriodPicker klaar={bandKlaar} jaarlijkseEditie={upcomingEdition?.cadence === "annual"} snelVanafTablet={nieuweWeergave} />
  ) : (
    <span className="text-meta text-muted-foreground" data-venster="vast">{kiezerHier.uitleg}</span>
  );
  // Op het Overzicht, en in de nieuwe weergave op elk tabblad: daar is de kop anders, dus daar hoort
  // ook de weg terug te staan. Met de schakelaar uit staat hij op de andere tabbladen niet.
  const schakelaar = (activeTab === "dashboard" || nieuweWeergave) && (
    <WeergaveSchakelaar weergave={weergave} onKies={zetWeergave} compactOpTelefoon={nieuweWeergave} />
  );
  const bronrij = (
    <>
      {/* Data source indicator + sync status.

        Het bijschrift noemt de kanalen die deze klant écht heeft en niet vast "Google Ads". Bij de
        LinkedIn-only doorloop stond er "Live data uit Google Ads" boven een scherm zonder één
        Google-rij: grammaticaal in orde, feitelijk onwaar, en door geen test te vangen omdat er
        niets aan gerekend wordt. Zolang de kanalen nog niet bekend zijn (null) blijft de balk weg
        in plaats van te gokken; bij nul kanalen staat de amberkleurige melding er al.

        Dit bijschrift hangt aan de kanalen, en de kleur van de datastand in de syncbadge ook: zonder
        Google-kanaal is "geen Google-data" geen storing. De synchronisatieknop blijft staan, juist
        ook bij een klant zonder data -- dat is de klant die hem het hardst nodig heeft. */}
      {/* Zolang de data laadt: dezelfde rij met dezelfde pillen, zonder tekst. De rij verscheen
          pas na het laden en duwde dan alles eronder omlaag -- op een telefoon 84 px, want het
          bronbijschrift breekt daar in twee regels. Representatieve teksten, onzichtbaar, zodat de
          pillen ook al ongeveer de goede breedte hebben en op dezelfde manier omlopen. */}
      {clientData.source === "api" && clientData.loading && (
        <div className="flex items-center gap-2 flex-wrap" aria-hidden>
          <span className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-transparent select-none">Live data uit Google Ads, Meta en LinkedIn</span>
          <span className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-transparent select-none">Conversielag: 3 dagen</span>
          {!demoModus && (
            <span className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-transparent select-none">Cijfers actueel · laatste run 3u geleden</span>
          )}
          {nieuweWeergave && (
            <span className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-transparent select-none">Data t/m 31 dec 2026</span>
          )}
        </div>
      )}
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
              <div {...STAND_VAN_NU} className="flex items-center gap-2 text-xs text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-lg px-3 py-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                Demodata — {kanalenOpsomming(kanalen ?? [])}, geen live koppeling
              </div>
            ) : (
              <div {...STAND_VAN_NU} className="flex items-center gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                <Wifi className="w-3.5 h-3.5" />
                Live data uit {kanalenOpsomming(kanalen ?? [])}
              </div>
            )
          )}
          {/* Neutraal en niet amber. De conversielag is een EIGENSCHAP van het account -- hij
              staat er elke dag, verandert zelden, en er is niets aan te doen. In alarmkleur zegt
              hij elke sessie opnieuw "let op" over iets waar niet op te letten valt; naast de
              live-badge is hij precies wat hij is: een stukje context bij de cijfers. */}
          <div {...STAND_VAN_NU} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 border border-border rounded-lg px-3 py-1.5">
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
          {/* Na een geslaagde sync de blended route opnieuw, via de ene vergeet-ingang: de band, de
              kanalenlijst, het Jaaroverzicht, de ranking en de kanaaltabs lezen hem, en gemounte
              lezers herladen in stilte (de vorige cijfers blijven staan tot de nieuwe binnen zijn).
              Hier stond een refreshKey die nergens gelezen werd: na een sync ververste niets.
              Bewust GEEN invalidateClientCache op dit pad. Die zet de Google-data op null en
              `loading` op true: deze hele rij staat achter `!clientData.loading`, dus de badge
              unmount met zijn melding ("N datasets, M rijen") voordat iemand hem leest, en alles
              onder de datapoort mount opnieuw. En er valt daar niets te halen: de Google-route
              leest live bij Google en haar datastand is "t/m gisteren" (liveDataStand), geen van
              beide verandert door een sync naar de database. Haar cache verloopt gewoon na vijf
              minuten. (De demo, die Google wel uit de database leest, heeft deze knop niet.) */}
          {/* De datastand, in de rij waar de bron staat (nieuwe weergave, fase 4): "live" zegt waar
              de cijfers vandaan komen, dit zegt tot welke dag ze lopen. Neutraal zolang dat klopt,
              rood als de data stilstaat. Het woord en een icoon, niet alleen de kleur. */}
          {nieuweWeergave && standTekst && (
            <div
              {...STAND_VAN_NU}
              data-datastand={standTekst.alarm ? "alarm" : "ok"}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${standTekst.alarm ? "border-red-200 bg-red-50 font-semibold text-red-700" : "border-border bg-muted/60 text-muted-foreground"}`}
            >
              {standTekst.alarm ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <Database className="h-3.5 w-3.5" aria-hidden />}
              <span>
                <span className="sr-only">Datastand{channel === "blended" ? " van alle kanalen samen" : ""}: </span>
                {standTekst.tekst.charAt(0).toUpperCase() + standTekst.tekst.slice(1)}
              </span>
            </div>
          )}
          {!demoModus && (
            <SyncStatusBadge
              clientId={client.id}
              kanalen={kanalen}
              onSyncComplete={() => vergeetBlendedClientData(client.id)}
              eerlijkeTijd={nieuweWeergave}
            />
          )}
        </div>
      )}

    </>
  );
  const geenDataMelding = (
    <>
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

    </>
  );
  const tabnav = (
    <>
      {/* Tab navigation — de demo-accounts krijgen de nieuwe gegroepeerde IA (voorproefje).
        Eerst alleen demo-greentech; demo-grt/demo-gra/demo-grn (scripts/demo/seed-geoclone-
        clients.ts) volgden dezelfde "demo-"-naamconventie maar niet deze check, waardoor ze de
        oude platte tabbalk lieten zien -- inconsistent binnen dezelfde demo-omgeving. */}
      {client.id.startsWith("demo-") ? (
        <GroupedTabNav activeTab={activeTab} onChange={setActiveTab} sopErrorCount={sopErrors.length} eenRegel={nieuweWeergave} />
      ) : (
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { id: "dashboard", label: "Overzicht", icon: <BarChart3 className="w-4 h-4" /> },
          { id: "campaigns", label: "Campagnes", icon: <LayoutGrid className="w-4 h-4" /> },
          { id: "forecast", label: "Prognose", icon: <TrendingUp className="w-4 h-4" /> },
          { id: "insights", label: "Analyseren", icon: <Lightbulb className="w-4 h-4" /> },
          { id: "outcomes", label: "Bevindingen", icon: <Target className="w-4 h-4" /> },
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

    </>
  );
  // De alarmbanner blijft boven de cijfers, op elk tabblad: hij leest geen providercontext, en
  // onder de band zakte hij driehonderd pixels weg.
  const codeRood = clientData.data && <CodeRoodBanner clientId={client.id} />;

  return (
    <PeriodProvider scope={`client-${client.id}`} dataStand={dataStand} adres={periodeAdres} beginKeuze={periodeVanServer} bewaarInCookie
      dagModus={nieuweWeergave} events={eventPeriodes}>
    <BrandThemeProvider clientId={client.id} geoClone={geoClone}>
    <div className="space-y-6">
      {nieuweWeergave ? (
        // ── De nieuwe weergave (bouwplan fase 3) ──
        // Eén blok met kleine tussenruimtes, zodat het eerste kerncijfer hoog staat: de merkregel met
        // de periodekiezer ernaast (was: een hero van 94 px en een eigen rij voor de kiezer), de
        // tabbladen, en dan de kaarten, de tegels en de grafiek. De bronrij (live of demo,
        // conversielag, sync) staat eronder in plaats van erboven: de datastand staat al per kanaal
        // op de kaarten, en de rij kostte vierenvijftig pixels boven het eerste cijfer. Hij is er
        // nog, met dezelfde knop.
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <BrandHeaderBar compact geoClone={geoClone} fallbackName={client.name} edition={upcomingEdition} />
            {/* Op een telefoon staat de schakelaar naast de naam en de kiezer op de regel eronder;
                vanaf een tablet staat alles op één regel, met de schakelaar rechts. */}
            <div className="order-2 sm:order-3">{schakelaar}</div>
            <div className="order-3 flex flex-wrap items-center justify-end gap-2 max-sm:w-full sm:order-2">{periodeKiezer}</div>
          </div>
          {geenDataMelding}
          {/* Een schuifbaar vak: de tabbalk mag breder zijn dan een telefoon zonder dat de pagina
              zelf opzij schuift. */}
          <div className="max-w-full overflow-x-auto">{tabnav}</div>
          {codeRood}
          {activeTab === "dashboard" && !clientData.error && (
            <OverzichtBovenkant
              clientId={client.id}
              channel={channel}
              kanalen={kanalen}
              onKies={setChannel}
              onBeoordeel={naarBeoordelen}
              onNaarInstellingen={naarInstellingen}
              googleData={clientData.data}
              googleStaat={clientData}
              route={blendedStand}
              band={periodSummary}
              bandKlaar={bandKlaar}
              demo={demoModus}
              bandZaad={bandZaad}
              reserveerKaarten={reserveerKaartenrij({ kanalenBekend: kanalen !== null, geheugen: balkGeheugen, nieuw: true, meerdereVerwacht: isDemoClientId(client.id) })}
            />
          )}
          {/* Dezelfde regel als in de vertrouwde weergave: de tegels lezen het account, niet de beurs. */}
          {!clientData.error && <GeenBeursfilter geo={geoClone} tekst={beursmelding?.tekst ?? null} />}
          {bronrij}
        </div>
      ) : (
        // ── De vertrouwde weergave: precies zoals hij was, met alleen de schakelaar erbij ──
        <>
      {/* Merk-header: logo + merk-/beursnaam, in de huisstijl van de actieve klant/beurs. */}
      <BrandHeaderBar geoClone={geoClone} fallbackName={client.name} edition={upcomingEdition} />
      {/* Onder de hero i.p.v. ernaast: de hero loopt over de volle breedte, en de kiezer
          ertegenaan geklemd maakte hem smal. */}
      {/* flex-wrap: op een telefoon staan de snelkoppelingen op een eigen regel boven de kiezer in
          plaats van hem uit beeld te duwen. */}
      <div className="flex flex-wrap items-center justify-end gap-2 -mt-3">
        {periodeKiezer}
        {schakelaar}
      </div>
      {bronrij}
      {geenDataMelding}
      {tabnav}
      {/* De kanaaltabs en de KPI-band staan BUITEN de datapoort hieronder (fase 1, stap 4): ze
          hebben de Google-route alleen op het Google-tabblad en op Alle kanalen nodig, en de
          instellingenpoort van ClientDataProvider (tot 3 s) nooit. Zo wacht het eerste kerncijfer
          op max(Google-route, blended route) in plaats van op de hele keten. Alleen op het
          Overzicht, en niet bij een fout van de Google-route: dan staat de foutmelding er.
          Kanaaltabs boven de KPI-rij (17.44): "is het niet onlogisch dat de kanaalfilter onder de
          hoofd-KPI-rij staat?" -- je kiest eerst welk kanaal je bekijkt, dan pas de cijfers ervoor.
          De KPI-rij beweegt mee: op "blended" (de standaard, "Alle kanalen") telt hij alle kanalen
          op via useChannelPeriodData(); op een gekozen kanaal toont hij alleen dat kanaal. De losse
          kanalen gaan mee als bronnen, zodat de vergelijking per kanaal paart. */}
      {codeRood}
      {activeTab === "dashboard" && !clientData.error && (
        <div className="space-y-6">
          <ChannelTabs channel={channel} onChange={setChannel} beschikbaar={kanalen ?? []} ladenMetBalk={kanalen === null && hadKanaalbalk} />
          <PeriodSummary data={bandKlaar ? periodSummary.data : null} bronnen={periodSummary.bronnen} laden={!bandKlaar}
            zolangLaden={bandZaad && <BandUitZaad zaad={bandZaad} />} />
          {/* De band (en Alle kanalen) leest de accountreeksen, niet de beurs: zeg dat in plaats
              van accountcijfers onder "Beurs: GreenTech Amsterdam" te zetten. */}
          <GeenBeursfilter geo={geoClone} tekst={beursmelding?.tekst ?? null} />
        </div>
      )}

        </>
      )}

      {/* Laden: een vlak op de maten van de eerste kaarten, geen spinner. De spinner stond
          gecentreerd in een lege pagina en alles wat daarna kwam, schoof 200 px omlaag (CLS 0,14
          desktop, 0,58 mobiel). Zonder band-deel: de band hierboven toont zijn eigen laadvlak, en
          twee band-skeletten onder elkaar verspringen bij het binnenkomen. Geen kanaalnaam hier:
          tijdens het laden is nog niet bekend wélke kanalen deze klant heeft. */}
      {clientData.loading && <PaginaLaadvlak metBand={false} />}

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
        <ClientDataProvider clientId={client.id} kanalen={kanalen} wachtvlak={<PaginaLaadvlak metBand={false} />}>
        <AnalysisProvider>
          <TrackingAlert clientId={client.id} onNavigateToSettings={() => setActiveTab("settings")} />

          <GeoCloneScope value={geoClone} onChange={setGeoClone} />

          {/* Een fout in een tabblad blijft in dat tabblad: kop, navigatie en de andere tabbladen
              blijven werken (app/(app)/foutgrens.tsx). De key zet de grens terug bij een wissel. */}
          <OnderdeelGrens key={activeTab} onderdeel={TAB_LABELS[activeTab]}>
          {activeTab === "dashboard" && (
            // De koppen van de nieuwe weergave houden icoon en titel bij elkaar (components/ui/sectie.tsx);
            // met de schakelaar uit, en op elk ander tabblad, blijft de kop wat hij was.
            <SectieKopBijeen.Provider value={nieuweWeergave}>
            <div
              className={`space-y-6 transition-opacity ${onderLooptAchter ? "opacity-60" : ""}`}
              aria-busy={onderLooptAchter || undefined}
              data-tabblad-kanaal={kanaalOnder}
            >
              {/* De kanaaltabs en de KPI-band staan hierboven, buiten de datapoort. */}
              {/* Op kanaalOnder en niet op channel: het tabblad volgt de klik een render later
                  (zie useDeferredValue hierboven). De tabbladen staan in memo. */}
              {kanaalOnder === "meta" && <MetaView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} meerdereKanalen={(kanalen?.length ?? 0) > 1} nieuw={nieuweWeergave} />}
              {kanaalOnder === "linkedin" && <LinkedInView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} meerdereKanalen={(kanalen?.length ?? 0) > 1} nieuw={nieuweWeergave} />}
              {kanaalOnder === "microsoft" && <MicrosoftView clientId={client.id} geoClone={geoClone} edition={upcomingEdition} meerdereKanalen={(kanalen?.length ?? 0) > 1} nieuw={nieuweWeergave} />}
              {kanaalOnder === "blended" && <CrossChannelView clientId={client.id} kanalen={kanalen ?? GEEN_KANALEN} edition={upcomingEdition} nieuw={nieuweWeergave} googleData={nieuweWeergave ? clientData.data : null} />}
              {kanaalOnder === "google" && (
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
                  nieuw={nieuweWeergave}
                />
              )}
              {/* Het einde van de trechter in de nieuwe weergave: de open voorstellen en to-do's, met
                  de weg naar Bevindingen. Met de schakelaar uit staat hier niets. */}
              {nieuweWeergave && (
                <OverzichtWatNu clientId={client.id} channel={channel} onBeoordeel={naarBeoordelen} herlees={blendedStand.perKanaalTab} />
              )}
            </div>
            </SectieKopBijeen.Provider>
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
              {channel === "meta" && <MetaCampagnes clientId={client.id} geoClone={geoClone} />}
              {channel === "linkedin" && <LinkedInCampagnes clientId={client.id} geoClone={geoClone} />}
              {channel === "microsoft" && <MicrosoftCampagnes clientId={client.id} geoClone={geoClone} />}
              {/* Alle kanalen op de Campagnes-tab: welke campagnes draaien per kanaal (niet de
                  blended maandgrafiek — die hoort bij Prognose/Overzicht). */}
              {/* De nieuwe weergave (fase 5, element 57): de kanaaltotalen staan hier open, boven de
                  campagnes. Op het Overzicht zitten ze dan achter "Toon als tabel". */}
              {channel === "blended" && nieuweWeergave && <CrossChannelView clientId={client.id} kanalen={kanalen ?? []} alleenTabel />}
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
                      {/* Zelfde kalenderjaar-prognosetabel als Google altijd al had (GoogleForecast
                          hierboven), nu ook over Google+Meta+LinkedIn samen (feedback 22 augustus:
                          "ik wil daadwerkelijk alle kanalen ook die tabel krijgt met gecombineerde
                          data"). Bron: lib/api/blended-historical.ts, fact_core level='account'/
                          grain='month' over alle drie kanalen. Eerder bewust weggelaten omdat
                          Meta/LinkedIn geen meerjarige historie hebben voor de seizoenscorrectie --
                          dat blokkeert alleen de interpretatie van vroege maanden, niet de data:
                          computeMonthlyExpected negeert een maand toch al zodra de waarde 0 is, dus
                          een periode voordat Meta/LinkedIn liepen levert gewoon Google's eigen
                          totaal op. Zelfde drie secties, zelfde volgorde als GoogleForecast. */}
                      <Sectie
                        eerste
                        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
                        titel="Waar dit jaar op uitkomt"
                        bijschrift="Jaarprognose over alle kanalen samen, tegen het jaardoel (ingevoerd in Instellingen, anders vorig jaar +10%)"
                      >
                        <ForecastSummaryTiles clientId={client.id} channel="blended" />
                      </Sectie>
                      <Sectie
                        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
                        titel="Wat een budgetwijziging zou doen"
                        bijschrift="Meta, LinkedIn en Microsoft Ads samen, zonder Google: Google rekent zijn eigen scenario op de Google-tab"
                      >
                        <ChannelBudgetScenario clientId={client.id} channel="blended" />
                      </Sectie>
                      <Sectie
                        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
                        titel="Maandelijkse uitsplitsing"
                        bijschrift="Gerealiseerd plus prognose per maand, over alle kanalen samen"
                      >
                        <ForecastTable clientId={client.id} channel="blended" />
                      </Sectie>
                    </>
                  )}
                  {(channel === "meta" || channel === "linkedin" || channel === "microsoft") && (
                    <ChannelForecastSections clientId={client.id} channel={channel} />
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <div className="space-y-6">
              <GeenBeursfilter geo={geoClone} onderwerp="Bevindingen" meervoud />
              <InsightsTab
                kanalen={kanalen ?? []}
                clientId={client.id}
                onSopError={(error) => setSopErrors((prev) => [...prev, error])}
              />
            </div>
          )}

          {activeTab === "outcomes" && (
            <div className="space-y-6">
              <GeenBeursfilter geo={geoClone} onderwerp="Dit tabblad" />
              <OutcomesTab clientId={client.id} />
            </div>
          )}

          {activeTab === "godview" && (
            <div className="space-y-6">
              <GodViewTab clientId={client.id} />
            </div>
          )}

          {activeTab === "sprint" && (
            <div className="space-y-6">
              <GeenBeursfilter geo={geoClone} onderwerp="De sprint" />
              <SprintPlanning clientId={client.id} />
            </div>
          )}

          {activeTab === "reporting" && (
            <div className="space-y-6">
              <GeenBeursfilter geo={geoClone} onderwerp="Rapportages" meervoud />
              <ClientReporting clientId={client.id} />
            </div>
          )}

          {activeTab === "dgm" && (
            <DgmView clientId={client.id} kanalen={kanalen} geoClone={geoClone} />
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
                <SettingsSections client={client} nieuweWeergave={nieuweWeergave} />
              )}
            </div>
          )}
          </OnderdeelGrens>

          {/* Notities & to-do's onderaan elke "werk"-pagina, gesynchroniseerd (zelfde tabel/
              client-scope overal): niet op Instellingen of Bestanden, dat zijn pure
              configuratieschermen waar een notitieblok niet hoort (feedbackronde 21 augustus). */}
          {activeTab !== "settings" && activeTab !== "files" && (
            <div className="mt-10">
              <ClientNotes clientId={client.id} />
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
  { id: "beurzen", label: "Beurzen & momenten", uitleg: "Cadans en editie-datums van beurzen of andere terugkerende momenten. Voeden de weken-tot-event-weergave en de eventanalyse." },
  { id: "account", label: "Account & markt", uitleg: "Sector en benchmarks, actieve landen, Merchant Center, GA4 en Search Console." },
] as const;

type SettingsGroep = (typeof SETTINGS_GROEPEN)[number]["id"];

function SettingsSections({ client, nieuweWeergave }: { client: Client; nieuweWeergave: boolean }) {
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
          {/* De stappen na de klik die het Overzicht in de nieuwe weergave toont: alleen daar, met de
              schakelaar uit verandert er niets. */}
          {nieuweWeergave && <ConversieTrechterSettings clientId={client.id} />}
        </div>
      )}

      {groep === "merk" && (
        <div className="space-y-6">
          <BrandingView clientId={client.id} clientName={client.name} />
          <ClientSettingsPanel clientId={client.id} clientName={client.name} kaarten={["logo"]} />
          <FullBrandingToggle clientId={client.id} />
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
          <CollapsiblePanel id="analyse-kern-google" icon={<Layers className="w-4 h-4 text-brand-blue-ink" />} title="Kern-analyses" subtitle="Losse analyses, direct uit de data" meta={<CreditBalanceBadge />}>
            <div className="p-4">
              <StandaloneAnalyses clientId={clientId} />
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel id="analyse-verdieping-google" defaultOpen={false} icon={<Search className="w-4 h-4 text-brand-blue-ink" />} title="Verdieping" subtitle="Funnel, KPI-verhoudingen, video/PMax, markten">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
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
            </div>
          </CollapsiblePanel>
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
        </>
      )}
      {analysisChannel === "meta" && (
        <>
          <CollapsiblePanel id="analyse-kern-meta" icon={<Layers className="w-4 h-4 text-brand-blue-ink" />} title="Kern-analyses" subtitle="Creatives en structuur, direct uit de data">
            <div className="space-y-4 p-4">
              <MetaCreativeAnalyses clientId={clientId} />
              {/* Deterministische structuur-analyse (plaatsing/leeftijd/device), direct uit de data. */}
              <ChannelStructureAnalysis clientId={clientId} channel="meta" />
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel id="analyse-verdieping-meta" defaultOpen={false} icon={<Search className="w-4 h-4 text-brand-blue-ink" />} title="Verdieping" subtitle="Funnel, KPI-verhoudingen, Meta-signalen">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
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
            </div>
          </CollapsiblePanel>
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} channel="meta_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
        </>
      )}
      {analysisChannel === "linkedin" && (
        <>
          <CollapsiblePanel id="analyse-kern-linkedin" icon={<Layers className="w-4 h-4 text-brand-blue-ink" />} title="Kern-analyses" subtitle="Structuur, direct uit de data">
            <div className="p-4">
              {/* Deterministische structuur-analyse (functie/seniority/industrie/bedrijfsgrootte), direct uit de data. */}
              <ChannelStructureAnalysis clientId={clientId} channel="linkedin" />
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel id="analyse-verdieping-linkedin" defaultOpen={false} icon={<Search className="w-4 h-4 text-brand-blue-ink" />} title="Verdieping" subtitle="ICP-fit, funnel, KPI-verhoudingen, LinkedIn-signalen">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
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
            </div>
          </CollapsiblePanel>
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} channel="linkedin_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
        </>
      )}
      {analysisChannel === "microsoft" && (
        <>
          {/* Microsoft heeft (nog) geen deterministische kern-analyses zoals Meta's creatives of
              LinkedIn's structuur: het kanaaleigen rekenwerk (import-pariteit, netwerk-lek,
              volumerem) zit in de maand-SOP zelf, als prepared facts. De Verdieping biedt wel de
              gedeelde KPI-verhoudingen. */}
          <CollapsiblePanel id="analyse-verdieping-microsoft" defaultOpen={false} icon={<Search className="w-4 h-4 text-brand-blue-ink" />} title="Verdieping" subtitle="KPI-verhoudingen">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
              <SignalAnalysisCard
                clientId={clientId}
                endpoint="/api/analysis/kpi-relations"
                extra={{ channel: "microsoft" }}
                title="KPI-verhoudingen"
                description="Hoe KPI's zich tot elkaar verhouden: CPA-decompositie (klik duurder vs slechter converterend), belofte-kloof, verzadiging, bereik-verdunning en meer."
                runLabel="Analyseer verhoudingen"
              />
            </div>
          </CollapsiblePanel>
          <Section>Maandrapportage (SOP)</Section>
          <SopTriggerButtons clientId={clientId} channel="microsoft_ads" onAnalysisComplete={onComplete} onAnalysisError={onSopError} multiChannel={(kanalen?.length ?? 0) > 1} />
        </>
      )}
      {analysisChannel === "blended" && (
        <>
          <CollapsiblePanel id="analyse-kern-blended" icon={<Layers className="w-4 h-4 text-brand-blue-ink" />} title="Sub-analyses" subtitle="Cross-channel, uit één run">
            <div className="p-4">
              {/* Cross-channel als losse sub-analyse-kaarten (net als de kanalen), uit één run. */}
              <CrossChannelAnalyses clientId={clientId} />
            </div>
          </CollapsiblePanel>
          {/* Master Synthesis (Pijler 6) heeft pas iets kanaaloverstijgends te zeggen bij 2+
              kanalen -- zelfde grootheid (kanalen.length > 1) als meerdereKanalen elders op deze
              pagina. Bij één kanaal is elke aanbeveling per definitie van dat ene kanaal. */}
          {kanalen.length > 1 && (
            <CollapsiblePanel id="analyse-verdieping-blended" defaultOpen={false} icon={<Search className="w-4 h-4 text-brand-blue-ink" />} title="Pijler 6" subtitle="Master Synthesis, kanaaloverstijgend">
              <div className="p-4">
                <MasterSynthesisAnalysis clientId={clientId} />
              </div>
            </CollapsiblePanel>
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

// Los eigen tabblad, niet langer een sectie boven in Bevindingen (feedback 22 augustus: "ik zou
// god view uit de bevindingen halen ... en een eigen god view sub tablad geven op dezelfde hoogte
// als analyse en bevindingen en voor second opinion. Dat is de logische plaats"). Bevindingen is
// een uitkomst/inzicht over DEZE klant; God View is platform-/bureaubreed en had daar nooit
// inhoudelijk bij gehoord -- het stond er alleen omdat er nog geen eigen plek was.
function GodViewTab({ clientId }: { clientId: string }) {
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoClient(clientId)); }, [clientId]);

  if (!demoModus) {
    return (
      <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-body text-muted-foreground">
        God View is platform-/bureaubreed en hoort normaal op Vandaag, niet op een klantpagina — hier
        alleen zichtbaar in demo-modus.
      </p>
    );
  }
  return (
    <Sectie
      eerste
      icoon={<Crown className="w-4.5 h-4.5 text-brand-blue-ink" />}
      titel="Cross-account & God View (demo)"
      bijschrift="Platform-/bureaubreed voorbeeld — hoort normaal op Vandaag, hier alleen zichtbaar in demo-modus"
    >
      <GodViewDemo />
    </Sectie>
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

      {/* Inzichten direct na de wachtrij (feedback 22 augustus: "starten met wacht op je
          oordeel, daaronder de inzichten"). Creative-vermoeidheid stond hier ook tot vandaag --
          verplaatst naar "De advertenties zelf" op elk kanaal se Campagnes-tab (google-view.tsx/
          meta-view.tsx/linkedin-view.tsx): dat is waar je al naar de creatives zelf kijkt, en een
          materiële vermoeidheid landt sowieso al als eigen inzicht hieronder via de kanaal-
          signalen -- een aparte, meestal-lege "geen materiële vermoeidheid"-tabel per kanaal,
          drie kaarten ver uit elkaar, voegde daarnaast niets toe. InsightsBlock heeft al zijn
          eigen koptekst ("Inzichten"), dus geen dubbele Sectie-chrome eromheen. */}
      <InsightsBlock
        clientId={clientId}
        selectedInsightId={selectedInsightId}
        onSelectInsight={setSelectedInsightId}
        refreshKey={refreshKey}
        channel={channelFilter}
      />

      {/* Geen demo-gate, in tegenstelling tot het God View-blok hierboven: dit is de echte,
          niet-fictieve God View-laag, alleen (nog) vrijwel altijd insufficient_data bij minder
          dan 4 bureaus in het segment. ChannelGapCard rendert zichzelf weg (return null) zolang
          er niets deelbaars is -- geen "onvoldoende data"-ruis, gewoon stilte. */}
      <ChannelGapCard clientId={clientId} />

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
