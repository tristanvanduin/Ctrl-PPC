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
/**
 * De ranglijst-BALKEN alleen, om als `verdieping` ín GeoMapCard te hangen.
 *
 * Waarom in de kaart en niet ernaast. De hero is twee kaarten: Account Health links, de kaart
 * rechts. Gemeten bij een kolombreedte van 574px is Health 638-705px hoog en de kaart 390-437px --
 * een gat van 200 tot 315px dat met CSS niet te dichten is zonder een kaart uit te rekken. De
 * balken vullen precies dat gat MET inhoud, en ze horen er inhoudelijk ook: de kaart codeert
 * ligging, de ranglijst rangorde. "Wie is de grootste en hoeveel scheelt dat" lees je niet van een
 * projectie af (zie de kop van geo-ranglijst.tsx).
 *
 * De cijfers en de uitklaptabel blijven eronder in GeoRanglijstCard (met `zonderBalken`), zodat er
 * niets dubbel staat.
 */
export function GeoRanglijstInKaart({ state }: { state: GeoBreakdownState }) {
  const { metric, focus, setFocus, laden, canDrillUs, labelOf, ranked, eenLandOfMinder } = state;
  if (laden || eenLandOfMinder || ranked.length === 0) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <GeoRanglijst
        regels={ranked.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v) }))}
        metriekLabel={metric.label}
        klikbaar={(code) => canDrillUs && code === "US" && focus == null}
        onKlik={() => setFocus("US")}
      />
    </div>
  );
}

export function GeoRanglijstCard({ state, zonderBalken = false }: { state: GeoBreakdownState; zonderBalken?: boolean }) {
  const { metric, focus, setFocus, laden, canDrillUs, labelOf, geoWord, ranked, totaal, eenLandOfMinder } = state;
  const [tabelOpen, toggleTabel] = useRememberedOpen("geo-tabel", false);

  if (laden || eenLandOfMinder || ranked.length === 0) return null;

  return (
    // `flex h-full flex-col` met het cijferblok als `flex-1`: deze kaart deelt op elk kanaal een
    // rasterrij met een kaart die hoger is (de CPA-lijn op Google, de doelgroepenkaart op Meta).
    // Zonder dit zakte dat verschil naar de onderrand -- 144 tot 170px wit onder de laatste tegel.
    <div className="bg-card flex h-full flex-col rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <ListOrdered className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{metric.label} per {geoWord}</h3>
      </div>

      <div className="flex flex-1 flex-col justify-center px-4 py-3">
        {/* zonderBalken: de balken staan dan al in de kaart erboven (GeoRanglijstInKaart). Alleen
            de totalen tonen voorkomt dat dezelfde rangorde twee keer op het scherm staat. */}
        <GeoRanglijst
          regels={zonderBalken ? [] : ranked.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v) }))}
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
