"use client";

import { Briefcase, Calendar, Sparkles } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { CreativePerformance } from "./creative-performance";
import { ChannelViewHeader } from "./channel-view-header";
import { BreakdownDonuts } from "./breakdown-donuts";
import { ChannelHealthBadge } from "./channel-health-badge";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { Sectie } from "@/components/ui/sectie";
import { isDemoMode } from "@/lib/demo/demo-mode";

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
  const demo = isDemoMode();
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
          via useGeoBreakdown(). BreakdownDonuts toont hier functie/senioriteit/industrie/
          bedrijfsgrootte i.p.v. Meta's leeftijd/plaatsing/device -- zelfde component, andere
          dimensies (BREAKDOWN_DIMENSIES["linkedin"]), geen aparte code nodig.

          Ook hier bewust geen pacing/KPI's in de hero: die zitten in ChannelPerformance, dat
          Meta en LinkedIn delen (zie 17.38's toelichting). */}
      <div className="hero-rij grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="hero-ring min-w-0 xl:col-span-5 flex flex-col gap-4">
          <BreakdownDonuts clientId={clientId} channel="linkedin" />
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

/**
 * Het campagne-deel van LinkedIn: de advertenties zelf.
 *
 * Geen ChannelViewHeader, net als bij Meta en Google: de koppelingsstatus is een overzichtsvraag
 * en hoort niet op elk tabblad herhaald te worden.
 */
export function LinkedInCampagnes({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-6">
      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <Sectie
        eerste
        icoon={<Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Creatives, hun prestaties en vermoeidheid"
      >
        <CreativePerformance clientId={clientId} channel="linkedin" />
      </Sectie>
    </div>
  );
}
