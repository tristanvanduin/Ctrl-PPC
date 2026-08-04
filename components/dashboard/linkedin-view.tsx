"use client";

import { Briefcase, Calendar, Globe, LayoutGrid, Sparkles } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import type { UpcomingEdition } from "@/lib/rai/fair-weeks";
import { CreativePerformance } from "./creative-performance";
import { ChannelViewHeader } from "./channel-view-header";
import { GeoBreakdown } from "./geo-breakdown";
import { BreakdownDonuts } from "./breakdown-donuts";
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
  return (
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Briefcase className="w-5 h-5 text-rm-blue-ink" />}
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

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <Sectie
        icoon={<Calendar className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Maandprestaties"
        bijschrift="Kerncijfers, pacing en het maandverloop"
      >
        <ChannelPerformance clientId={clientId} channel="linkedin" geoClone={geoClone} edition={edition} />
      </Sectie>

      {/* Geo-mapping: waar komt verkeer/conversies vandaan (per gekozen metric). */}
      <Sectie
        icoon={<Globe className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Markten"
        bijschrift="Waar het verkeer en de conversies vandaan komen"
      >
        <GeoBreakdown clientId={clientId} channel="linkedin" />
      </Sectie>

      {/* Waar het budget landt per uitsplitsing — het equivalent van de PMax-ringen bij Google. */}
      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wie het te zien krijgt"
        bijschrift="Functie, senioriteit, sector en bedrijfsgrootte"
      >
        <BreakdownDonuts clientId={clientId} channel="linkedin" />
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
        icoon={<Sparkles className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Creatives, hun prestaties en vermoeidheid"
      >
        <CreativePerformance clientId={clientId} channel="linkedin" />
      </Sectie>
    </div>
  );
}
