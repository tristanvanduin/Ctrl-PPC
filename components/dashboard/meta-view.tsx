"use client";

import { useState, useEffect } from "react";
import { Megaphone, Calendar, Sparkles } from "lucide-react";
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
    if (isDemoMode()) { setConnected(true); return; } // demo: geen live status-call
    let cancelled = false;
    fetch("/api/meta-ads?action=status")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setConnected(Boolean(d?.connected)); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
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

      <ChannelHealthBadge clientId={clientId} channel="meta" />

      {/* DE OPENER (17.38, eerste kanaal na Google): "moeten we dit op andere pagina's
          voortzetten?" -- "ja". Zelfde patroon als Google's opener (17.34-17.37): donut + ranglijst
          links, kaart alleen rechts, gedeelde geo-state via useGeoBreakdown(). Bewust NIET pacing/
          KPI's erbij -- die zitten hier, anders dan bij Google, in één gedeeld component
          (ChannelPerformance) dat ook LinkedIn's weergave voedt. Dat uit elkaar trekken is een
          grotere ingreep die LinkedIn meteen meeraakt; de eigenaar koos expliciet voor "alleen
          kaart + donuts in de hero" en ChannelPerformance ongewijzigd laten.

          BreakdownDonuts is Meta's eigen equivalent van CampaignTypeSplit: spend/conversies per
          leeftijd, plaatsing of device (tabs), altijd gevuld zodra er breakdown-data is -- geen
          kanaalspecifieke leegte zoals PmaxNetworkSplit bij Google had. */}
      <div className="hero-rij grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="hero-ring min-w-0 xl:col-span-5 flex flex-col gap-4">
          <BreakdownDonuts clientId={clientId} channel="meta" />
          <GeoRanglijstCard state={geo} />
        </div>
        <div className="hero-kaart min-w-0 xl:col-span-7 flex flex-col gap-4">
          <GeoMapCard state={geo} channel="meta" />
        </div>
      </div>

      {/* Volwaardige prestatie-view: KPI's, pacing, grafiek, maand- en campagnetabel. */}
      <Sectie
        icoon={<Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Maandprestaties"
        bijschrift="Kerncijfers, pacing en het maandverloop"
      >
        <ChannelPerformance clientId={clientId} channel="meta" geoClone={geoClone} edition={edition} />
      </Sectie>
    </div>
  );
}

/**
 * Het campagne-deel van Meta: de advertenties zelf.
 *
 * Geen ChannelViewHeader hier, en dat is bewust. Google's Campagnes-tab begint ook meteen bij
 * "Wat er draait" — de koppelingsstatus van een kanaal is een overzichtsvraag en hoort niet op
 * elk tabblad herhaald te worden.
 */
export function MetaCampagnes({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-6">
      {/* Quick scan: creatives + prestaties + samenvatting. */}
      <Sectie
        eerste
        icoon={<Sparkles className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Creatives, hun prestaties en vermoeidheid"
      >
        <CreativePerformance clientId={clientId} channel="meta" />
      </Sectie>
    </div>
  );
}
