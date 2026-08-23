"use client";

import { useState, useEffect } from "react";
import { Briefcase, Calendar, LayoutGrid, Sparkles, Target, Users, AlertTriangle } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import { ChannelCampaignTable } from "./channel-campaign-table";
import { ChannelBleedersTable } from "./channel-bleeders-table";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { CreativePerformance } from "./creative-performance";
import { CreativeDeepDive } from "./creative-deep-dive";
import { ChannelViewHeader } from "./channel-view-header";
import { BreakdownDonuts } from "./breakdown-donuts";
import { ChannelHealthBadge } from "./channel-health-badge";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { Sectie } from "@/components/ui/sectie";
import { isDemoClient } from "@/lib/demo/demo-mode";
import { dbSelect } from "@/lib/data-access/client-read";
import { OBJECTIVE_EVAL_CRITERIA } from "@/lib/linkedin/campaign-types";
import { buildLinkedInObjectiveBreakdown } from "@/lib/linkedin/objective-breakdown";
import { ObjectiveInsights, type ObjectiveGroupLike } from "./objective-insights";

// LinkedIn Ads-tab. Zelfde opbouw als de Google- en Meta-weergave via de gedeelde
// ChannelViewHeader. Buiten demo is er nog geen gesyncte data; dan toont de header een eerlijke
// lege staat en de prestatie-view eronder blijft leeg tot de sync draait.
//
// Gesplitst om dezelfde reden als meta-view: deze view stond in zijn geheel op Overzicht én op
// Campagnes met dezelfde props, en toonde daar elf identieke koppen. Zie de toelichting daar.

const SECTIONS = [
  "Campagnegroepen & campagnes",
  "Creatives",
  "Dagelijkse performance (account / campagne / creative)",
  "Demografie (functie, senioriteit, industrie, bedrijfsgrootte)",
  "Lead-forms",
];

export function LinkedInView({ clientId, geoClone, edition, meerdereKanalen = true }: { clientId: string; geoClone?: string | null; edition?: UpcomingEdition | null; meerdereKanalen?: boolean }) {
  const demo = isDemoClient(clientId);
  // Eén hook-aanroep voor de opener: GeoMapCard en GeoRanglijstCard delen dezelfde metric-keuze
  // en VS-drilldown-state (zelfde patroon als Google 17.36 en Meta 17.38).
  const geo = useGeoBreakdown({ clientId, channel: "linkedin" });
  return (
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Briefcase className="w-5 h-5 text-brand-blue-ink" />}
        title="LinkedIn Ads"
        geoClone={geoClone}
        status={demo ? { kind: "connected", label: "Gekoppeld (demo)" } : { kind: "warning", label: "Nog geen data" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort. Ratio&apos;s (CPL, CTR) komen uit de venstertotalen, niet uit dag-gemiddelden.</>
            : <>Account-brede LinkedIn-cijfers: kerncijfers over de laatste 28 dagen, pacing tegen vorige maand, maandverloop en de campagnes.</>
        }
        delivers={SECTIONS}
        analysesHint={
          /* De verwijzing "→ LinkedIn" klopt alleen als er een kanaalkiezer IS. Bij een klant
             met alleen dit kanaal is die balk weg (zie lib/kanalen/beschikbaar.ts), en dan wijst
             deze zin naar een tabblad dat niet bestaat -- je klikt en zoekt naar iets wat er niet is.
             Voor 62 van de 71 klanten in de database is precies dat de situatie. */
          meerdereKanalen
            ? <>De LinkedIn-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong> → LinkedIn.</>
            : <>De LinkedIn-analyses (maand-SOP, signalen) draai je via het tabblad <strong>Analyses</strong>.</>
        }
        warning={!demo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
            Het LinkedIn-datamodel en de sync-laag staan klaar. Zodra de LinkedIn-koppeling live is en de
            sync draait, vult dit tabblad met onderstaande secties.
          </div>
        ) : undefined}
      />

      <ChannelHealthBadge clientId={clientId} channel="linkedin" />

      {/* DE OPENER (17.39, derde kanaal): zelfde patroon als Google (17.34-17.37) en Meta
          (17.38) -- BreakdownDonuts + ranglijst links, kaart alleen rechts, gedeelde geo-state
          via useGeoBreakdown().

          groep="levering" (23 augustus 2026): LinkedIn heeft geen leveringsdimensie zoals Meta's
          plaatsing/platform/device -- functie/senioriteit/industrie/bedrijfsgrootte zijn zelf
          allemaal wie-vragen, en die staan sinds vandaag op Campagnes onder "Doelgroepsignalen"
          (zie LinkedInCampagnes hieronder). BreakdownDonuts rendert hier dus niets voor LinkedIn;
          dat is de bewuste consequentie van de scheiding en geen ontbrekende data. De hero blijft
          met alleen de ranglijst en de kaart staan, precies zoals de kaart er ook staat als een
          van de twee leeg is (zie BreakdownDonuts' eigen "niets tonen"-afvang).

          Ook hier bewust geen pacing/KPI's in de hero: die zitten in ChannelPerformance, dat
          Meta en LinkedIn delen (zie 17.38's toelichting). */}
      {/* items-start: zelfde reden als meta-view.tsx -- zonder deze guard rekt Grid's default
          stretch-gedrag de kortste kolom uit tot de hoogte van de langste en blijft er een leeg
          vlak staan. */}
      <div className="hero-rij grid grid-cols-1 gap-4 items-start xl:grid-cols-12">
        <div className="hero-ring min-w-0 xl:col-span-5 flex flex-col gap-4">
          <BreakdownDonuts clientId={clientId} channel="linkedin" groep="levering" />
          <GeoRanglijstCard state={geo} />
        </div>
        <div className="hero-kaart min-w-0 xl:col-span-7 flex flex-col gap-4">
          <GeoMapCard state={geo} channel="linkedin" />
        </div>
      </div>

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <Sectie
        icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Maandprestaties"
        bijschrift="Kerncijfers, pacing en het maandverloop"
      >
        <ChannelPerformance clientId={clientId} channel="linkedin" geoClone={geoClone} edition={edition} />
      </Sectie>
    </div>
  );
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Feedback punt 29+31: zelfde behandeling als Meta (zie meta-view.tsx's toelichting) --
 * per objective welke campagnes daaronder hangen en welke cijfers daar het meest toe doen.
 * Rekenkern in lib/linkedin/objective-breakdown.ts.
 */
function useLinkedInObjectiveGroups(clientId: string): ObjectiveGroupLike[] | null {
  const [groups, setGroups] = useState<ObjectiveGroupLike[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const DAILY_SELECT = "entity_urn, spend, impressions, clicks, ctr, cpc, cpm, landing_page_clicks, one_click_lead_form_opens, one_click_leads, external_website_conversions, post_click_conversions, conversion_value, cpl, form_completion_rate, video_starts, video_views, video_completions, video_completion_rate, total_engagements, follows, reactions, comments, shares";

    Promise.all([
      dbSelect<Record<string, unknown>>("linkedin_campaigns", { select: "campaign_urn, name, objective_type", clientId }),
      dbSelect<Record<string, unknown>>("linkedin_campaign_daily", { select: DAILY_SELECT, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
    ]).then(([campRes, dailyRes]) => {
      if (cancelled) return;
      const campaigns = ((campRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        urn: String(r.campaign_urn ?? ""), name: String(r.name ?? ""), objectiveType: (r.objective_type as string | null) ?? null,
      }));
      const daily = ((dailyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        campaignUrn: String(r.entity_urn ?? ""), entityUrn: String(r.entity_urn ?? ""),
        spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), ctr: num(r.ctr),
        cpc: num(r.cpc), cpm: num(r.cpm), landingPageClicks: num(r.landing_page_clicks),
        oneClickLeadFormOpens: num(r.one_click_lead_form_opens), oneClickLeads: num(r.one_click_leads),
        externalWebsiteConversions: num(r.external_website_conversions), postClickConversions: num(r.post_click_conversions),
        conversionValue: num(r.conversion_value), cpl: num(r.cpl), formCompletionRate: num(r.form_completion_rate),
        videoStarts: num(r.video_starts), videoViews: num(r.video_views), videoCompletions: num(r.video_completions),
        videoCompletionRate: num(r.video_completion_rate), totalEngagements: num(r.total_engagements),
        follows: num(r.follows), reactions: num(r.reactions), comments: num(r.comments), shares: num(r.shares),
      }));
      const built = buildLinkedInObjectiveBreakdown(campaigns, daily);
      setGroups(built.map((g) => ({
        objective: g.objective, label: g.label, spend: g.spend,
        campaigns: g.campaigns.map((c) => ({ key: c.urn, name: c.name, spend: c.spend, primaryValue: c.primaryValue })),
        metrics: g.metrics,
      })));
    });
    return () => { cancelled = true; };
  }, [clientId]);

  return groups;
}

/**
 * Het campagne-deel van LinkedIn: welk objective drijft welke campagnes, en de advertenties zelf.
 *
 * Geen ChannelViewHeader, net als bij Meta en Google: de koppelingsstatus is een overzichtsvraag
 * en hoort niet op elk tabblad herhaald te worden.
 */
export function LinkedInCampagnes({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const objectiveGroups = useLinkedInObjectiveGroups(clientId);

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
          het", niet "wat draait er", zie de toelichting bovenaan meta-view.tsx (zelfde opzet). */}
      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat er draait"
        bijschrift="Alle campagnes van dit account over de laatste 28 dagen"
      >
        <ChannelCampaignTable clientId={clientId} channel="linkedin" geoClone={geoClone} />
      </Sectie>

      {/* LinkedIn-equivalent van Google's "Doelgroepsignalen" (23 augustus 2026). Zelfde component
          als de hero (BreakdownDonuts), maar hier zonder ander dimensiefilter nodig: LinkedIn's
          vier dimensies (functie/senioriteit/industrie/bedrijfsgrootte) zijn allemaal
          doelgroepsignalen, dus groep="doelgroep" toont ze alle vier -- de hero's groep="levering"
          toont er sindsdien geen enkele, zie de toelichting daarboven. Vóór "De advertenties
          zelf", zelfde volgorde als bij Google en Meta. */}
      <Sectie
        icoon={<Users className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Doelgroepsignalen"
        bijschrift="Welke functies, senioriteit, industrieën en bedrijfsgroottes de campagnes bereiken, en wat het oplevert"
      >
        <BreakdownDonuts clientId={clientId} channel="linkedin" groep="doelgroep" />
      </Sectie>

      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <Sectie
        icoon={<Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Creatives, hun prestaties en vermoeidheid"
      >
        <CreativePerformance clientId={clientId} channel="linkedin" />
        {/* Verhuisd van Bevindingen hierheen (feedback 22 augustus): het bijschrift beloofde
            "vermoeidheid" hier al, maar de kaart zelf stond drie tabbladen verderop. */}
        <CreativeDeepDive clientId={clientId} channel="linkedin" />
      </Sectie>

      {/* LinkedIn-equivalent van Google's "Waar het weglekt" (23 augustus 2026). Zelfde toelichting
          als bij Meta: geen zoektermrapport op dit platform, dus de granulariteit die er wél is --
          campagnes met spend en nul conversies in de laatste 28 dagen. */}
      <Sectie
        icoon={<AlertTriangle className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar het weglekt"
        bijschrift="Campagnes die kosten maken zonder conversie"
      >
        <ChannelBleedersTable clientId={clientId} channel="linkedin" geoClone={geoClone} />
      </Sectie>
    </div>
  );
}
