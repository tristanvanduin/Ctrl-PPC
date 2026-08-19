"use client";

import { ListOrdered } from "lucide-react";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { GeoRanglijst } from "./geo-ranglijst";
import { int, eur, pct, nf, type GeoBreakdownState } from "@/lib/geo/use-geo-breakdown";

// De ranglijst-helft van GeoBreakdown, apart (17.36): verhuisd naar de lege ruimte onder de
// campagnetype-donut, zodat GeoMapCard ernaast de kaart alleen heeft en dus groter kan. Zelfde
// state-object als GeoMapCard (uit useGeoBreakdown(), één keer aangeroepen door de aanroepende
// pagina) -- klik op de VS hier stuurt dezelfde focus-state die de kaart ernaast laat omschakelen.
export function GeoRanglijstCard({ state }: { state: GeoBreakdownState }) {
  const { metric, focus, setFocus, laden, canDrillUs, labelOf, geoWord, ranked, totaal, eenLandOfMinder } = state;
  const [tabelOpen, toggleTabel] = useRememberedOpen("geo-tabel", false);

  if (laden || eenLandOfMinder || ranked.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <ListOrdered className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{metric.label} per {geoWord}</h3>
      </div>

      <div className="px-4 py-3">
        <GeoRanglijst
          regels={ranked.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v) }))}
          metriekLabel={metric.label}
          klikbaar={(code) => canDrillUs && code === "US" && focus == null}
          onKlik={() => setFocus("US")}
          totalen={tabelOpen ? undefined : [
            { label: `Aantal ${geoWord}en`, waarde: String(ranked.length) },
            { label: "Vertoningen", waarde: int(totaal.impressions) },
            { label: "Klikken", waarde: int(totaal.clicks) },
            { label: "Conversies", waarde: nf(1).format(totaal.conversions) },
            { label: "CTR", waarde: pct(totaal.impressions > 0 ? totaal.clicks / totaal.impressions : null) },
            { label: "CPA", waarde: eur(totaal.conversions > 0 ? totaal.cost / totaal.conversions : null) },
          ]}
        />
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="geo-tabel-hero"
        label={`de tabel per ${geoWord} (${ranked.length})`}
      />
      <div id="geo-tabel-hero" hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>{focus === "US" ? "Staat" : "Land"}</KolomKop>
            <KolomKop getal>Vertoningen</KolomKop>
            <KolomKop getal>Klikken</KolomKop>
            <KolomKop getal>CTR</KolomKop>
            <KolomKop getal>Conversies</KolomKop>
            <KolomKop getal>Conv.ratio</KolomKop>
            <KolomKop getal>CPA</KolomKop>
          </Kop>
          <Body>
            {ranked.map(({ c }) => (
              <Rij key={c.code}>
                <NaamCel>{labelOf(c.code)}</NaamCel>
                <GetalCel>{int(c.impressions)}</GetalCel>
                <GetalCel>{int(c.clicks)}</GetalCel>
                <GetalCel zacht>{pct(c.impressions > 0 ? c.clicks / c.impressions : null)}</GetalCel>
                <GetalCel>{c.conversions == null ? "—" : nf(1).format(c.conversions)}</GetalCel>
                <GetalCel zacht>{pct(c.clicks > 0 ? c.conversions / c.clicks : null)}</GetalCel>
                <GetalCel zacht>{eur(c.conversions > 0 ? c.cost / c.conversions : null)}</GetalCel>
              </Rij>
            ))}
          </Body>
          <TotaalRij>
            <TotaalCel>Totaal ({ranked.length})</TotaalCel>
            <TotaalCel getal>{int(totaal.impressions)}</TotaalCel>
            <TotaalCel getal>{int(totaal.clicks)}</TotaalCel>
            <TotaalCel getal>{pct(totaal.impressions > 0 ? totaal.clicks / totaal.impressions : null)}</TotaalCel>
            <TotaalCel getal>{nf(1).format(totaal.conversions)}</TotaalCel>
            <TotaalCel getal>{pct(totaal.clicks > 0 ? totaal.conversions / totaal.clicks : null)}</TotaalCel>
            <TotaalCel getal>{eur(totaal.conversions > 0 ? totaal.cost / totaal.conversions : null)}</TotaalCel>
          </TotaalRij>
        </Tabel>
      </div>
    </div>
  );
}
