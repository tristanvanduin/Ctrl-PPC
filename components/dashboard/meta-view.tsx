"use client";

import { useState, useEffect } from "react";
import { Megaphone, Calendar, CalendarClock, LayoutGrid, Sparkles, Target, Users, AlertTriangle } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import { ChannelCampaignTable } from "./channel-campaign-table";
import { ChannelBleedersTable } from "./channel-bleeders-table";
import { ChannelVideoPerformance } from "./channel-video-performance";
import { ChannelForecastOverview } from "./channel-forecast-overview";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { CreativePerformance } from "./creative-performance";
import { CreativeDeepDive } from "./creative-deep-dive";
import { ChannelViewHeader } from "./channel-view-header";
import { BreakdownDonuts } from "./breakdown-donuts";
import { ChannelHealthBadge } from "./channel-health-badge";
import { ChannelPacing } from "./channel-pacing";
import { ChannelMonthlyChart } from "./channel-monthly-chart";
import { ChannelFairWeeks } from "./channel-fair-weeks";
import { ChannelDataProvider } from "./channel-data-provider";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard, GeoRanglijstInKaart } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { Sectie } from "@/components/ui/sectie";
import { isDemoClient } from "@/lib/demo/demo-mode";
import { dbSelect } from "@/lib/data-access/client-read";
import { OBJECTIVE_EVAL_CRITERIA } from "@/lib/meta/campaign-types";
import { buildMetaObjectiveBreakdown, type MetaObjectiveDailyRow } from "@/lib/meta/objective-breakdown";
import { ObjectiveInsights, type ObjectiveGroupLike } from "./objective-insights";

// Meta Ads-tab: DATA-weergave (connectiestatus + wat het kanaal levert). Zelfde opbouw als de
// Google-weergave via de gedeelde ChannelViewHeader. De analyses (maand-SOP, creative vision,
// briefing, signalen) draaien vanaf het Analyses-tabblad — één plek voor alle analyses.
//
// ── WAAROM DIT IN TWEEËN IS GESPLITST ──────────────────────────────────────
//
// Deze view stond in zijn geheel op zowel Overzicht als Campagnes, met dezelfde props. Gemeten:
// beide tabbladen toonden elf identieke koppen en ruim 3.700 pixels dezelfde inhoud — het enige
// verschil was de periodekiezer bovenaan. Wie op Campagnes klikte verwachtte iets anders en
// kreeg hetzelfde, nog een keer.
//
// De verdeling volgt de vraag die je stelt. Overzicht beantwoordt "hoe loopt het en waar komt het
// vandaan"; Campagnes beantwoordt "wat draait er en hoe ziet het eruit". De advertenties zelf
// horen dus bij Campagnes — precies de verhuizing die bij Google al gedaan was.
//
// De secties eromheen zijn nieuw en niet cosmetisch. Google deelt zijn tabbladen op in benoemde
// secties (Markten, Waar het budget landt); Meta en LinkedIn waren kale stapels kaarten zonder
// één kop. Dezelfde titels en iconen als bij Google, zodat de kanalen als één product lezen.

const SECTIONS = ["Campagnes", "Ad sets", "Advertenties & creatives", "Breakdowns (leeftijd, plaatsing, device)"];

export function MetaView({ clientId, geoClone, edition, meerdereKanalen = true }: { clientId: string; geoClone?: string | null; edition?: UpcomingEdition | null; meerdereKanalen?: boolean }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  // Eén hook-aanroep voor de opener: GeoMapCard en GeoRanglijstCard delen dezelfde metric-keuze
  // en VS-drilldown-state (zelfde reden als Google's opener, 17.36).
  const geo = useGeoBreakdown({ clientId, channel: "meta" });

  useEffect(() => {
    if (isDemoClient(clientId)) { setConnected(true); return; } // demo: geen live status-call
    let cancelled = false;
    fetch("/api/meta-ads?action=status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setConnected(Boolean(d?.connected)); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    // Eén provider om alle kaarten heen: pacing, maandverloop, de beurs-sectie en het
    // jaaroverzicht lezen allemaal dezelfde dagrijen en dezelfde forecast. Zie
    // channel-data-provider.tsx voor wat er zonder gebeurde.
    <ChannelDataProvider clientId={clientId} channel="meta">
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Megaphone className="w-5 h-5 text-brand-blue-ink" />}
        title="Meta Ads"
        geoClone={geoClone}
        status={connected === null ? { kind: "loading" } : connected ? { kind: "connected" } : { kind: "warning", label: "Niet gekoppeld" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort. Ratio&apos;s (CPA, CTR) komen uit de venstertotalen, niet uit dag-gemiddelden.</>
            : <>Account-brede Meta-cijfers: kerncijfers over de laatste 28 dagen, pacing tegen vorige maand, maandverloop en de campagnes.</>
        }
        delivers={SECTIONS}
        analysesHint={
          /* De verwijzing "→ Meta" klopt alleen als er een kanaalkiezer IS. Bij een klant
             met alleen dit kanaal is die balk weg (zie lib/kanalen/beschikbaar.ts), en dan wijst
             deze zin naar een tabblad dat niet bestaat -- je klikt en zoekt naar iets wat er niet is.
             Voor 62 van de 71 klanten in de database is precies dat de situatie. */
          meerdereKanalen
            ? <>De Meta-analyses (maand-SOP, creative vision, briefing, signalen) draai je via het tabblad <strong>Analyses</strong> → Meta.</>
            : <>De Meta-analyses (maand-SOP, creative vision, briefing, signalen) draai je via het tabblad <strong>Analyses</strong>.</>
        }
        warning={connected === false ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
            Meta is nog niet gekoppeld. Configureer de Meta-credentials (env) en draai de sync; daarna vult dit tabblad met campagnes, ad sets, creatives en breakdowns.
          </div>
        ) : undefined}
      />

      {/* DE OPENER (23 augustus 2026, teruggezet naar 50/50): Account Health naast de wereldkaart,
          zelfde indeling als Google's hero (zie google-view.tsx).

          RANGLIJST HOORT RECHTS, ONDER DE KAART -- en dat is een correctie op mezelf. Eerder is de
          ranglijst naar links verhuisd met als reden "de kaart is intrinsiek hoger dan Health+donut
          samen". Dat is nagemeten en het klopt niet: de kaart is 415px, Health 480px en de donut
          397px. Links was dus al de hoogste kolom, en de verhuizing maakte het veel erger in plaats
          van beter -- gemeten 1012px van de 1427px rechterkolom bleef leeg (71%).

          De gemeten verdeling met de ranglijst hier rechts: links 480+397 = 893px, rechts
          415+518 = 949px. Verschil 56px, tegen 1012px daarvoor.

          De les: kolomhoogtes narekenen in de browser, niet beredeneren uit "wat intrinsiek hoger
          voelt". Een wereldkaart-SVG ziet er groot uit maar is in deze kaart maar 415px hoog.

          BreakdownDonuts is Meta's eigen equivalent van CampaignTypeSplit: spend/conversies per
          plaatsing, platform of device (tabs), altijd gevuld zodra er breakdown-data is.
          groep="levering": alleen plaatsing/platform/device, dus "waar komt het vandaan". Leeftijd
          en gender staan op Campagnes onder "Doelgroepsignalen" (groep="doelgroep"). */}
      {/* Zelfde asymmetrische opzet als Google (zie google-view.tsx voor de volledige redenering):
          twee KOLOMMEN in plaats van losse rastercellen, elk met precies één aangewezen opvanger,
          en pas vanaf 1800px twee kolommen -- daaronder haalt Account Health de 672px
          container-breedte niet die hij nodig heeft om zijn drie stukken naast elkaar te zetten,
          en staat hij gestapeld naast een kaart die door de smalle kolom juist lager wordt. */}
      <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2 min-[1800px]:items-stretch">
        <div className="flex flex-col gap-4">
          <ChannelHealthBadge clientId={clientId} channel="meta" />
          {/* Pacing direct onder Account Health, net als op Google -- en tegelijk de opvanger van
              deze kolom: zes blokken met een ring worden leesbaarder van hoogte. Dit blok stond
              tot 23 augustus 2026 onderaan de sectie "Maandprestaties", terwijl het de vraag
              beantwoordt die je bovenaan stelt. */}
          <div className="flex flex-1 flex-col">
            <ChannelPacing edition={edition} />
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <GeoMapCard state={geo} channel="meta" verdieping={<GeoRanglijstInKaart state={geo} />} />
        </div>
      </div>

      {/* DEZELFDE VOLGORDE ALS GOOGLE, en dat is het punt: hero, dan de landencijfers, dan een rij
          grafiek- en diagramkaarten. De drie tabbladen hadden alle drie een andere volgorde, en dan
          moet je bij elke tabwissel opnieuw zoeken waar iets staat.

          De landencijfers horen direct onder de wereldkaart uit de hero: "waar komt het vandaan"
          en "wat leverde het per land op" is één vraag in twee kaarten. */}
      <GeoRanglijstCard state={geo} zonderBalken />

      {/* "Prestaties richting de beurs" -- de sectie die Google al had en deze kanalen niet.
          Alleen als er een event gekozen is; zonder event is "nog N weken tot" een lege zin.
          Zie channel-fair-weeks.tsx voor waarom hij hier ontbrak: niet de cijfers maar de ingang. */}
      {edition && (
        <Sectie
          icoon={<CalendarClock className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Prestaties richting de beurs"
          bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
        >
          <ChannelFairWeeks edition={edition} />
        </Sectie>
      )}

      {/* groep="levering" is plaatsing/platform/device ("waar komt het vandaan"), groep="doelgroep"
          is leeftijd en gender ("wie bereiken we"), en het maandverloop zet dat in de tijd. Drie
          kaarten die alle drie een verdeling of een verloop tonen -- en alle drie inhoudsgestuurd,
          dus er valt niets uit te rekken. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BreakdownDonuts clientId={clientId} channel="meta" groep="levering" />
        <BreakdownDonuts clientId={clientId} channel="meta" groep="doelgroep" />
        <ChannelMonthlyChart />
      </div>

      {/* Meta-equivalent van Google's "Jaaroverzicht 2026" (23 augustus 2026). Zelfde plek en icoon
          als bij Google; renderd niets zolang er geen dagcijfers gesynced zijn (demo heeft die
          wel). Zie channel-forecast-overview.tsx voor de volledige toelichting -- computeForecast
          is al kanaalneutraal, dit levert alleen de Meta-databron en het client_targets-jaardoel. */}
      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Jaaroverzicht 2026"
        bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
      >
        <ChannelForecastOverview />
      </Sectie>

      {/* Wat er van de prestatie-view overblijft: de kerncijfers over 28 dagen en de maandtabel.
          Pacing staat nu in de hero en het maandverloop naast de landencijfers -- allebei
          losgetrokken omdat ze de vraag beantwoorden die je bovenaan stelt, niet onderaan. */}
      <Sectie
        icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Maandprestaties"
        bijschrift="Kerncijfers over 28 dagen en het verloop per maand"
      >
        <ChannelPerformance clientId={clientId} channel="meta" geoClone={geoClone} />
      </Sectie>

      {/* Meta-equivalent van Google's "Waar het budget landt" (23 augustus 2026) -- alleen het
          campagne-niveau videodeel; zie channel-video-performance.tsx voor waarom het
          placement-uitsluitingsadvies (VideoPlacements) hier ontbreekt. */}
      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar het budget landt"
        bijschrift="Video"
      >
        <ChannelVideoPerformance clientId={clientId} channel="meta" />
      </Sectie>
    </div>
    </ChannelDataProvider>
  );
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Feedback punt 29+31: per objective welke campagnes daaronder hangen en welke cijfers daar het
 * meest toe doen. Rekenkern in lib/meta/objective-breakdown.ts; dit haalt alleen de twee bronnen
 * op (campagnes met hun `objective`-veld, en de dagcijfers over een venster van 90 dagen -- lang
 * genoeg voor representatieve totalen, kort genoeg om niet jaren oude, gepauzeerde campagnes mee
 * te tellen).
 */
function useMetaObjectiveGroups(clientId: string): ObjectiveGroupLike[] | null {
  const [groups, setGroups] = useState<ObjectiveGroupLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const DAILY_SELECT = "entity_id, spend, impressions, reach, frequency, link_clicks, cpm, cpc_link, ctr_link, conversions, conversion_value, purchase_roas, cpa, roas, leads, add_to_cart, initiate_checkout, landing_page_views, video_thruplay, post_engagement, hook_rate, hold_rate";

    Promise.all([
      dbSelect<Record<string, unknown>>("meta_campaigns", { select: "campaign_id, name, objective", clientId }),
      dbSelect<Record<string, unknown>>("meta_campaign_daily", { select: DAILY_SELECT, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
    ]).then(([campRes, dailyRes]) => {
      if (cancelled) return;
      const campaigns = ((campRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.campaign_id ?? ""), name: String(r.name ?? ""), objective: (r.objective as string | null) ?? null,
      }));
      const daily = ((dailyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        campaignId: String(r.entity_id ?? ""), entityId: String(r.entity_id ?? ""),
        spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), frequency: num(r.frequency),
        linkClicks: num(r.link_clicks), cpm: num(r.cpm), cpcLink: num(r.cpc_link), ctrLink: num(r.ctr_link),
        conversions: num(r.conversions), conversionValue: num(r.conversion_value), purchaseRoas: num(r.purchase_roas),
        cpa: num(r.cpa), roas: num(r.roas), leads: num(r.leads), addToCart: num(r.add_to_cart),
        initiateCheckout: num(r.initiate_checkout), landingPageViews: num(r.landing_page_views),
        videoThruplay: num(r.video_thruplay), postEngagement: num(r.post_engagement), hookRate: num(r.hook_rate), holdRate: num(r.hold_rate),
      }));
      const built = buildMetaObjectiveBreakdown(campaigns, daily);
      setGroups(built.map((g) => ({
        objective: g.objective, label: g.label, spend: g.spend,
        campaigns: g.campaigns.map((c) => ({ key: c.id, name: c.name, spend: c.spend, primaryValue: c.primaryValue })),
        metrics: g.metrics,
      })));
    });
    return () => { cancelled = true; };
  }, [clientId]);

  return groups;
}

/**
 * Het campagne-deel van Meta: welk objective drijft welke campagnes, en de advertenties zelf.
 *
 * Geen ChannelViewHeader hier, en dat is bewust. Google's Campagnes-tab begint ook meteen bij
 * "Wat er draait" — de koppelingsstatus van een kanaal is een overzichtsvraag en hoort niet op
 * elk tabblad herhaald te worden.
 */
export function MetaCampagnes({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const objectiveGroups = useMetaObjectiveGroups(clientId);

  return (
    <div className="space-y-6">
      <Sectie
        eerste
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Per objective"
        bijschrift="Welke campagnes bij welk doel horen, en welke cijfers daar het meest toe doen"
      >
        {objectiveGroups === null ? (
          <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          <ObjectiveInsights
            groups={objectiveGroups}
            criteria={OBJECTIVE_EVAL_CRITERIA}
            emptyLabel="Geen campagnes met een herkend objective in de laatste 90 dagen."
          />
        )}
      </Sectie>

      {/* Verhuisd van Overzicht (ChannelPerformance) hierheen, 22 augustus 2026: zelfde plek als
          bij Google ("Wat er draait" op Campagnes) -- deze view beantwoordt zelf al "hoe loopt
          het", niet "wat draait er", zie de toelichting bovenaan dit bestand. */}
      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat er draait"
        bijschrift="Alle campagnes van dit account over de laatste 28 dagen"
      >
        <ChannelCampaignTable clientId={clientId} channel="meta" geoClone={geoClone} />
      </Sectie>

      {/* Meta-equivalent van Google's "Doelgroepsignalen" (23 augustus 2026). Google's sectie
          draait op audience-targeting-typedata (affiniteit/in-market/remarketing) die Meta niet
          syncet; wat wél al gesynced is (meta_breakdown_daily) bevat leeftijd en gender, zelf ook
          doelgroepsignalen. Zelfde component als de hero (BreakdownDonuts), ander dimensiefilter
          (groep="doelgroep") -- geen dubbele kaart met identieke data, want de hero toont alleen
          plaatsing/platform/device. Vóór "De advertenties zelf", zelfde volgorde als bij Google:
          de doelgroepmix is een targeting-vraag, geen creative-vraag. */}
      <Sectie
        icoon={<Users className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Doelgroepsignalen"
        bijschrift="Welke leeftijds- en gendergroepen de campagnes bereiken, en wat het oplevert"
      >
        <BreakdownDonuts clientId={clientId} channel="meta" groep="doelgroep" />
      </Sectie>

      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <Sectie
        icoon={<Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Creatives, hun prestaties en vermoeidheid"
      >
        <CreativePerformance clientId={clientId} channel="meta" />
        {/* Verhuisd van Bevindingen hierheen (feedback 22 augustus): het bijschrift beloofde
            "vermoeidheid" hier al, maar de kaart zelf stond drie tabbladen verderop. */}
        <CreativeDeepDive clientId={clientId} channel="meta" />
      </Sectie>

      {/* Meta-equivalent van Google's "Waar het weglekt" (23 augustus 2026). Google ziet dit tot op
          zoekterm- en ad group-niveau omdat het een zoekplatform is; Meta syncet geen
          zoektermrapport. Wat wél kan: campagnes met spend en nul conversies in de laatste 28
          dagen, zelfde databron als "Wat er draait" hierboven maar gefilterd op het risico. Zie
          channel-bleeders-table.tsx voor de toelichting waarom dit de eerlijke granulariteit is. */}
      <Sectie
        icoon={<AlertTriangle className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar het weglekt"
        bijschrift="Campagnes die kosten maken zonder conversie"
      >
        <ChannelBleedersTable clientId={clientId} channel="meta" geoClone={geoClone} />
      </Sectie>
    </div>
  );
}
