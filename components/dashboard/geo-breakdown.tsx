"use client";

import { type ReactNode } from "react";
import { Globe2, Loader2, ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { MapErrorBoundary } from "./map-error-boundary";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";
import { GeoRanglijst } from "./geo-ranglijst";
import { GeoEnkelLandKaart } from "./geo-empty-state";
import { useGeoBreakdown, CHANNEL_LABEL, int, eur, pct, nf, type Channel } from "@/lib/geo/use-geo-breakdown";

// De kaarten (SVG + geometrie + d3-geo) client-only en code-split laden: pas geladen als deze
// weergave rendert, en nooit tijdens SSR.
const WorldMap = dynamic(() => import("./world-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-blue-ink" /></div>,
});
const UsStatesMap = dynamic(() => import("./us-states-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-blue-ink" /></div>,
});

// Geo-mapping: waar komt het verkeer / de conversies vandaan, per gekozen metric. Interactief —
// je kiest de metric (impressies, klikken, CTR, conversies, conversieratio, CPA) en de landen
// herordenen + herkleuren ernaar. Klik op de VS om in te zoomen op de staten (drilldown).
// Werkt per kanaal: Google toont echte landdata; Meta/LinkedIn/blended tonen demo-geo tot de sync
// er is (Laag 2). Ratio's altijd uit de landtotalen, nooit uit een gemiddelde van maand-deelwaarden.
//
// De state (fetch, metric-keuze, drilldown-focus) zit sinds 17.36 in lib/geo/use-geo-breakdown.ts:
// de opener op Google Overzicht zet kaart en ranglijst in TWEE aparte kolommen (geo-map-card.tsx +
// geo-ranglijst-card.tsx) en heeft daarvoor dezelfde hook-aanroep nodig zonder de data twee keer op
// te halen. Dit component blijft de ATOMAIRE kaart+ranglijst-samen-versie voor de drie plekken waar
// dat nog klopt (cross-channel, Meta, LinkedIn) -- puur een verhuizing van bestaande logica.

export function GeoBreakdown({ clientId, channel = "google", verdieping }: {
  clientId: string;
  channel?: Channel;
  /**
   * Extra uitsplitsing onderin dezelfde kaart, bijvoorbeeld land x kanaal.
   *
   * Als eigen kaart eronder werd dit een losse strook van 60px onder een kaart van 600: twee
   * dichtgeklapte balkjes op elkaar lezen als restjes in plaats van als twee manieren om dieper
   * te kijken. In dezelfde kaart is het één blok met twee uitklappers.
   */
  verdieping?: ReactNode;
}) {
  const { metricKey, setMetricKey, metric, focus, setFocus, countries, laden, canDrillUs, labelOf, geoWord, ranked, values, totaal, eenLandOfMinder } =
    useGeoBreakdown({ clientId, channel });
  // De tabel begint dicht: de kaart is het antwoord op "waar komt het vandaan", de tabel is de
  // naslag erachter. Vijftig landregels tussen twee kaarten in maakt de pagina onleesbaar.
  const [tabelOpen, toggleTabel] = useRememberedOpen("geo-tabel", false);

  // Tijdens het laden nog niets concluderen: "één of geen land" was anders even waar voor elke
  // klant, en dan knippert de kaart weg en weer terug.
  if (laden) {
    return <Laadvlak vorm="grafiek" hoogte={220} titel="Waar komt het vandaan" />;
  }
  // Was tot 20 augustus 2026 een stille `return null` -- zie geo-empty-state.tsx voor waarom dat
  // de verkeerde uitvoering was van een verder juiste aanname.
  if (eenLandOfMinder) return <GeoEnkelLandKaart channel={channel} land={countries[0] ?? null} />;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">
          Waar komt het vandaan{focus === "US" ? " — Verenigde Staten" : ""}
        </h3>
        <span className="text-micro font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{CHANNEL_LABEL[channel]}</span>
        {focus === "US" && (
          <button
            onClick={() => setFocus(null)}
            className="flex items-center gap-0.5 text-meta font-medium text-brand-blue-ink hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Wereld
          </button>
        )}
        {/* Slimme dropdown naast de kaart: kies de metric die de kaart inkleurt. */}
        <label className="ml-auto flex items-center gap-1.5 text-meta text-muted-foreground">
          Toon
          <select
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value as typeof metricKey)}
            className="rounded-md border border-border bg-card px-2 py-1 text-body font-medium text-brand-gray focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            {[
              { key: "conversions", label: "Conversies" },
              { key: "impressions", label: "Vertoningen" },
              { key: "clicks", label: "Klikken" },
              { key: "ctr", label: "CTR" },
              { key: "conversionRate", label: "Conversieratio" },
              { key: "cpa", label: "CPA" },
            ].map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          per {geoWord}
        </label>
      </div>

      {/* De kaart schaalde mee met de kolombreedte, en werd op een breed scherm bijna 400px hoog
          voordat er ook maar een cijfer in beeld kwam. Een wereldkaart wordt niet beter van meer
          pixels; hij wordt alleen duurder in verticale ruimte. */}
      {/* Kaart en ranglijst naast elkaar. Twee vragen, twee vormen: de kaart zegt WAAR, de
          ranglijst zegt WIE DE GROOTSTE IS en hoeveel dat scheelt. Dat tweede leest niemand van
          een projectie af -- daar wint Groenland altijd. De ruimte naast een kaart van 680px was
          op een breed scherm leeg; nu draagt hij de cijfers die anders een klik weg zaten. */}
      {/* xl:items-start: zonder deze guard rekt de grid de ranglijst-kolom uit tot de hoogte van de
          kaart (default stretch), en GeoRanglijst's eigen `h-full` volgt daarin mee. Bij weinig
          landen (twee, drie) is de lijst + totalenblok samen veel korter dan een volle wereldkaart,
          en bleef daaronder een leeg stuk kolom over dat nergens bij hoort -- een gat, niet marge,
          want er staat geen rand of achtergrond omheen die het als "einde van het blok" markeert. */}
      <div className="grid grid-cols-1 gap-5 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start">
      <div className="w-full max-w-[680px] mx-auto">
        {ranked.length === 0 ? (
          <p className="text-body text-muted-foreground py-4 text-center">Geen {geoWord}-data voor deze metric.</p>
        ) : (
          <MapErrorBoundary>
            {focus === "US" ? (
              <UsStatesMap values={values} format={metric.fmt} metricLabel={metric.label} />
            ) : (
              <WorldMap values={values} format={metric.fmt} metricLabel={metric.label} onCountryClick={canDrillUs ? (a) => a === "US" && setFocus("US") : undefined} />
            )}
          </MapErrorBoundary>
        )}
        {focus == null && canDrillUs && (
          <p className="text-center text-meta text-muted-foreground pt-1">Klik op de <strong>Verenigde Staten</strong> om de staten te zien.</p>
        )}
        {/* De VS staat op de kaart maar er zijn geen staten om naar door te klikken. Dat was
            eerder stilte: een groot land dat op een klik niet reageert leest als kapot. Zeg dan
            wát er ontbreekt.
            De rijen die er wél zijn dragen "LOCATION_OF_PRESENCE" in de regiokolom — het
            geo-doeltype van Google, niet de naam van een staat — dus er valt niets uit te lezen. */}
        {focus == null && !canDrillUs && countries.some((c) => c.code === "US") && (
          <p className="text-center text-meta text-muted-foreground pt-1">
            Voor de <strong>Verenigde Staten</strong> is geen staten-uitsplitsing beschikbaar: die data is
            voor dit account nog niet gesynct.
          </p>
        )}
      </div>

      <GeoRanglijst
        regels={ranked.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v) }))}
        metriekLabel={metric.label}
        klikbaar={(code) => canDrillUs && code === "US" && focus == null}
        onKlik={() => setFocus("US")}
        // Alleen zolang de tabel dicht is. Sla je hem open, dan staan diezelfde zes getallen
        // tweehonderd pixels lager in zijn totaalrij. Dit blok bestaat om de kolom naast de kaart
        // vol te maken; met de tabel open is de kaart toch al langer en zou het herhaling zijn.
        totalen={tabelOpen ? undefined : [
          { label: `Aantal ${geoWord}en`, waarde: String(ranked.length) },
          { label: "Vertoningen", waarde: int(totaal.impressions) },
          { label: "Klikken", waarde: int(totaal.clicks) },
          { label: "Conversies", waarde: nf(1).format(totaal.conversions) },
          // Ratio's uit de TOTALEN en niet als gemiddelde van de landwaarden: een gemiddelde CTR
          // over landen weegt Nederland even zwaar als Malta.
          { label: "CTR", waarde: pct(totaal.impressions > 0 ? totaal.clicks / totaal.impressions : null) },
          { label: "CPA", waarde: eur(totaal.conversions > 0 ? totaal.cost / totaal.conversions : null) },
        ]}
      />
      </div>

      {/* Volledige tabel: alle metrics per land/staat, zodat je naast de gekozen metric ook de rest ziet. */}
      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="geo-tabel"
        label={`de tabel per ${geoWord} (${ranked.length})`}
      />
      <div id="geo-tabel" hidden={!tabelOpen} className="border-t border-border">
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
          {/* Vijftig landregels zonder som laten de lezer optellen om te weten of "de VS" nu groot
              of klein is. De ratio's staan uit de totalen berekend en niet als gemiddelde van de
              landwaarden: een gemiddelde CTR over landen weegt Nederland even zwaar als Malta. */}
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

      {verdieping}
    </div>
  );
}
