"use client";

import { Globe2 } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import { CHANNEL_LABEL, int, nf, type Channel } from "@/lib/geo/use-geo-breakdown";
import { type GeoAgg } from "@/lib/demo/geo-demo";
import { Vensterlabel } from "@/components/ui/vensterlabel";

// Vervangt de stille `return null` die GeoBreakdown/GeoMapCard/GeoRanglijstCard tot 20 augustus
// 2026 gaven bij "één (of geen) land: geen geo-verhaal". De aanname klopt (een wereldkaart met
// één gekleurd land zegt niets), maar de UITVOERING was het probleem: de hele "Markten"-sectie
// verdween spoorloos, geen kop, geen melding, niets dat zegt WAAROM. Voor een Benelux-bureau met
// veel NL-only klanten is dat niet de uitzondering maar de norm op precies de nieuwe 2x2-opener
// (17.36-17.43) die GeoMapCard/GeoRanglijstCard introduceerde -- "ik mis de geo-kaart in al mijn
// overzichten" bleek dus geen kapotte kaart te zijn, maar een kaart die zich exact volgens
// ontwerp verstopt bij precies het klantprofiel dat het vaakst voorkomt.
//
// Eén gedeelde component i.p.v. de melding drie keer kopiëren (GeoBreakdown en GeoMapCard delen
// hem; GeoRanglijstCard laat een enkel land wél stil vallen -- een ranglijst van één rij heeft
// niets om te ranken en zou naast deze kaart pure herhaling zijn).
export function GeoEnkelLandKaart({ channel, land, voorbehoud, voorbehoudUitleg, perDag }: {
  channel: Channel;
  land: GeoAgg | null;
  /** Een voorbehoud bij deze cijfers ("zonder Microsoft"), uit de wereldkaart van de nieuwe weergave.
   *  Dan staat het venster met het voorbehoud in de kop; zonder is de kaart wat hij was. */
  voorbehoud?: string;
  /** Dat voorbehoud voluit, voor de uitleg bij het label. */
  voorbehoudUitleg?: string;
  /** De nieuwe weergave: de kaart volgt de periodekiezer per dag. Dan zegt het label dat, en niet
   *  het vaste venster van 180 dagen dat alleen de vertrouwde weergave heeft. */
  perDag?: boolean;
}) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Waar komt het vandaan</h3>
        <span className="text-micro font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{CHANNEL_LABEL[channel]}</span>
        {perDag
          ? <Vensterlabel soort="periode" perDag toevoeging={voorbehoud} toevoegingUitleg={voorbehoudUitleg} />
          : voorbehoud && <Vensterlabel soort="vast" venster="laatste 180 dagen" toevoeging={voorbehoud} toevoegingUitleg={voorbehoudUitleg} />}
      </div>
      {/* Deze kaart heeft geen lade waar de zin in kan staan, en is klein: hier staat hij open. */}
      {voorbehoudUitleg && <p className="border-b border-border px-5 py-2 text-micro leading-snug text-muted-foreground" data-venster-uitleg>{voorbehoudUitleg}</p>}
      {land ? (
        <div className="px-5 py-5 flex items-center justify-between flex-wrap gap-4">
          <p className="text-body text-brand-gray">
            Al het verkeer en alle conversies komen uit <strong>{countryLabel(land.code)}</strong> — met
            één land is er geen geografische spreiding om op een kaart te tonen.
          </p>
          <div className="flex gap-4 text-meta text-muted-foreground shrink-0">
            <span>Vertoningen <strong className="text-brand-gray">{int(land.impressions)}</strong></span>
            <span>Klikken <strong className="text-brand-gray">{int(land.clicks)}</strong></span>
            <span>Conversies <strong className="text-brand-gray">{land.conversions == null ? "—" : nf(1).format(land.conversions)}</strong></span>
          </div>
        </div>
      ) : (
        <p className="text-body text-muted-foreground py-6 text-center">Geen locatiedata beschikbaar voor {CHANNEL_LABEL[channel]}.</p>
      )}
    </div>
  );
}
