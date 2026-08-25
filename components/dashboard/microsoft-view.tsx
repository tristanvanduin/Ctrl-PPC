"use client";

import { Calendar, CalendarClock, Search, Target } from "lucide-react";
import { ChannelPerformance } from "./channel-performance";
import { ChannelCampaignTable } from "./channel-campaign-table";
import { ChannelBleedersTable } from "./channel-bleeders-table";
import { ChannelForecastOverview } from "./channel-forecast-overview";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { ChannelViewHeader } from "./channel-view-header";
import { ChannelHealthBadge } from "./channel-health-badge";
import { ChannelPacing } from "./channel-pacing";
import { ChannelMonthlyChart } from "./channel-monthly-chart";
import { ChannelFairWeeks } from "./channel-fair-weeks";
import { Sectie } from "@/components/ui/sectie";
import { isDemoClient } from "@/lib/demo/demo-mode";

// Microsoft Ads (Bing)-tab: DATA-weergave, zelfde opbouw als Meta en LinkedIn via de gedeelde
// ChannelKind-bouwstenen (channel-performance.tsx's CONFIG kent "microsoft"). De analyses draaien
// vanaf het Analyses-tabblad, zoals bij elk kanaal.
//
// BEWUST SMALLER dan de Meta/LinkedIn-views: geen creative-secties (search-advertenties worden
// nog niet gesynct), geen geo-kaart (geen microsoft-geodata) en geen breakdown-donuts (de
// netwerk/device-splitsing leeft in de analyses, waar het lek-criterium erbij staat). Wat hier
// staat is wat de microsoft_*-tabellen vandaag echt dragen -- liever een kleinere eerlijke view
// dan lege kaarten met een belofte.

const SECTIONS = [
  "Campagnes & ad groups",
  "Dagelijkse performance (account / campagne / ad group)",
  "Keywords & zoektermen (maandkorrel)",
  "Netwerk & device, impressieaandeel, profieldimensies",
];

export function MicrosoftView({ clientId, geoClone, edition, meerdereKanalen = true }: { clientId: string; geoClone?: string | null; edition?: UpcomingEdition | null; meerdereKanalen?: boolean }) {
  const demo = isDemoClient(clientId);
  return (
    <div className="space-y-6">
      <ChannelViewHeader
        icon={<Search className="w-5 h-5 text-brand-blue-ink" />}
        title="Microsoft Ads (Bing)"
        geoClone={geoClone}
        status={demo ? { kind: "connected", label: "Gekoppeld (demo)" } : { kind: "warning", label: "Nog geen data" }}
        blurb={
          geoClone
            ? <>Cijfers hieronder zijn <strong>her-geaggregeerd per beurs</strong> ({geoClone}) uit de campagnes waarvan de naam bij deze beurs hoort. Ratio&apos;s (CPA, CTR) komen uit de venstertotalen, niet uit dag-gemiddelden.</>
            : <>Account-brede Microsoft-cijfers: kerncijfers over de laatste 28 dagen, pacing tegen vorige maand, maandverloop en de campagnes.</>
        }
        delivers={SECTIONS}
        analysesHint={
          /* Zelfde regel als Meta/LinkedIn: de verwijzing "→ Microsoft" klopt alleen als er een
             kanaalkiezer IS -- bij een klant met alleen dit kanaal is die balk weg. */
          meerdereKanalen
            ? <>De Microsoft-analyses (maand-SOP, weekly, bi-weekly) draai je via het tabblad <strong>Analyses</strong> → Microsoft.</>
            : <>De Microsoft-analyses (maand-SOP, weekly, bi-weekly) draai je via het tabblad <strong>Analyses</strong>.</>
        }
        warning={!demo ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
            Het Microsoft-datamodel en de analyses staan klaar. Zodra de Microsoft Advertising-koppeling
            live is en de sync draait, vult dit tabblad met onderstaande secties.
          </div>
        ) : undefined}
      />

      {/* Geen geo-kaart naast Account Health (Microsoft levert geen geodata): health en pacing
          naast elkaar in plaats van gestapeld, zodat de opener geen halve lege kolom draagt. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
        <ChannelHealthBadge clientId={clientId} channel="microsoft" />
        <div className="flex flex-col">
          <ChannelPacing clientId={clientId} channel="microsoft" edition={edition} />
        </div>
      </div>

      <ChannelMonthlyChart clientId={clientId} channel="microsoft" />

      {/* "Prestaties richting de beurs" -- alleen als er een event gekozen is, zelfde regel als
          Meta en LinkedIn. */}
      {edition && (
        <Sectie
          icoon={<CalendarClock className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Prestaties richting de beurs"
          bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
        >
          <ChannelFairWeeks clientId={clientId} channel="microsoft" edition={edition} />
        </Sectie>
      )}

      <Sectie
        icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Maandprestaties"
        bijschrift="Kerncijfers over 28 dagen en het verloop per maand"
      >
        <ChannelPerformance clientId={clientId} channel="microsoft" geoClone={geoClone} />
      </Sectie>

      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Jaaroverzicht"
        bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
      >
        <ChannelForecastOverview clientId={clientId} channel="microsoft" />
      </Sectie>
    </div>
  );
}

/**
 * Het campagne-deel van Microsoft: de campagnetabel en de bleeders. Geen objective-secties zoals
 * Meta/LinkedIn -- Microsoft-campagnes dragen geen objective-as; het keyword-niveau (de
 * search-tegenhanger) leeft in de analyses met de volumerem erbij.
 */
export function MicrosoftCampagnes({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  return (
    <div className="space-y-6">
      <Sectie
        eerste
        icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat er draait"
        bijschrift="Campagnes over de laatste 28 dagen"
      >
        <ChannelCampaignTable clientId={clientId} channel="microsoft" geoClone={geoClone} />
      </Sectie>
      <ChannelBleedersTable clientId={clientId} channel="microsoft" geoClone={geoClone} />
    </div>
  );
}
