"use client";

import { ListOrdered } from "lucide-react";
import { useRememberedOpen, RegioToggle, Lade, MeerKnopPerBreedte, useTruncatedList } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { GeoRanglijst } from "./geo-ranglijst";
import { int, eur, pct, nf, type GeoBreakdownState } from "@/lib/geo/use-geo-breakdown";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { formatVerandering } from "@/lib/geo/geo-dag";

/** De verandering van een code als tekst, met de reden als er geen percentage is. Undefined zonder
 *  vergelijking: dan staat er geen kolom. */
function veranderingVan(state: GeoBreakdownState, code: string): { verandering?: string; veranderingUitleg?: string } {
  if (!state.verandering) return {};
  const v = state.verandering.get(code);
  if (!v) return { verandering: "—", veranderingUitleg: "geen data in deze periode" };
  if (v.pct === null) return { verandering: "—", veranderingUitleg: v.reden ?? undefined };
  return { verandering: formatVerandering(v.pct), veranderingUitleg: `${state.metric.label} tegen de vergelijkingsperiode` };
}

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
/** Hoeveel regio's de ranglijst naast de kaart toont voor "toon meer" (de nieuwe weergave). */
export const GEO_NAAST_ZICHTBAAR = 6;
/**
 * Op een telefoon (onder lg) staan er drie. Daar staat de ranglijst ONDER de projectie, over de
 * volle breedte, en elke regel is een naam met een balk: zes regels waren een half scherm onder een
 * kaart die zelf al een half scherm is. De vierde tot en met de zesde staan in de boom (verborgen
 * onder lg), de rest achter dezelfde knop, en alle landen met alle cijfers in "Toon als tabel".
 */
export const GEO_NAAST_ZICHTBAAR_SMAL = 3;

export function GeoRanglijstInKaart({ state, naast = false }: {
  state: GeoBreakdownState;
  /**
   * Naast de projectie in plaats van eronder (de nieuwe weergave): dan zonder de lijn erboven, en
   * kort beginnend. De eerste zes regio's zijn het verhaal; een klant met twintig landen had hier
   * een kolom van achthonderd pixels, op een telefoon onder de kaart. De rest staat achter "toon
   * meer", en alle landen met alle cijfers in "Toon als tabel" eronder. In de vertrouwde weergave
   * (zonder `naast`) staat de hele lijst er, zoals altijd.
   */
  naast?: boolean;
}) {
  const { metric, focus, setFocus, laden, canDrillUs, labelOf, ranked, eenLandOfMinder } = state;
  const lijst = useTruncatedList(ranked, naast ? GEO_NAAST_ZICHTBAAR : Number.MAX_SAFE_INTEGER);
  if (laden || eenLandOfMinder || ranked.length === 0) return null;
  return (
    <>
      <div className={naast ? "px-4 py-3" : "border-t border-border px-4 py-3"}>
        <GeoRanglijst
          regels={lijst.zichtbaar.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v), ...veranderingVan(state, c.code) }))}
          metriekLabel={metric.label}
          klikbaar={(code) => canDrillUs && code === "US" && focus == null}
          onKlik={() => setFocus("US")}
          smalTot={naast && !lijst.uitgeklapt ? GEO_NAAST_ZICHTBAAR_SMAL : undefined}
        />
      </div>
      <MeerKnopPerBreedte
        totaal={ranked.length}
        smal={naast ? GEO_NAAST_ZICHTBAAR_SMAL : Number.MAX_SAFE_INTEGER}
        breed={naast ? GEO_NAAST_ZICHTBAAR : Number.MAX_SAFE_INTEGER}
        uitgeklapt={lijst.uitgeklapt}
        onToggle={lijst.toggle}
        eenheid={focus === "US" ? "staten" : "landen"}
      />
    </>
  );
}

/**
 * De tabel per land (of per staat), met de totaalrij. Eén definitie voor de kaart "per land"
 * hieronder en voor "Toon als tabel" in de voet van de wereldkaart in de nieuwe weergave
 * (GeoTabelLade): dezelfde kolommen en dezelfde totalen op beide plekken.
 */
function GeoTabel({ state }: { state: GeoBreakdownState }) {
  const { focus, labelOf, ranked, totaal } = state;
  return (
    <Tabel>
      <Kop>
        <KolomKop>{focus === "US" ? "Staat" : "Land"}</KolomKop>
        <KolomKop getal>Vertoningen</KolomKop>
        <KolomKop getal>Klikken</KolomKop>
        <KolomKop getal>CTR</KolomKop>
        <KolomKop getal>Conversies</KolomKop>
        <KolomKop getal>Conv.ratio</KolomKop>
        <KolomKop getal>CPA</KolomKop>
        {state.verandering && <KolomKop getal>{state.metric.label}: verandering</KolomKop>}
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
            {state.verandering && (() => {
              const v = veranderingVan(state, c.code);
              // De reden ook als tekst voor schermlezers (een title is zonder muis niet bereikbaar).
              return (
                <GetalCel zacht>
                  <span title={v.veranderingUitleg} aria-hidden={v.veranderingUitleg ? true : undefined}>{v.verandering}</span>
                  {v.veranderingUitleg && <span className="sr-only">{v.verandering === "—" ? `geen verandering: ${v.veranderingUitleg}` : v.veranderingUitleg}</span>}
                </GetalCel>
              );
            })()}
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
        {state.verandering && <TotaalCel getal>{""}</TotaalCel>}
      </TotaalRij>
    </Tabel>
  );
}

/**
 * "Toon als tabel" in de voet van de wereldkaart (bouwplan fase 5). De tabel is het tekstalternatief
 * van de projectie en draagt in zijn totaalrij wat de zes losse tegels "per land" toonden
 * (vertoningen, klikken, conversies, CTR, CPA; het aantal landen staat in de kop van de kaart). Die
 * tegels waren een eigen kaart van 180 px met een eigen conversietotaal naast dat van de band.
 * Dicht staat er alleen de knop; de rijen worden pas gerenderd als je hem opent.
 */
export function GeoTabelLade({ state, toelichting }: {
  state: GeoBreakdownState;
  /** Een voorbehoud bij deze cijfers, voluit, boven de tabel: de zin die in de uitleg van het
   *  vensterlabel staat, voor wie geen muis heeft om die uitleg te zien. */
  toelichting?: string;
}) {
  const { laden, eenLandOfMinder, ranked, focus } = state;
  if (laden || eenLandOfMinder || ranked.length === 0) return null;
  return (
    // Zeven kolommen: op een telefoon schuift de tabel binnen de kaart (Tabel heeft een eigen schuifvak).
    <Lade id="geo-tabel-nieuw" label={`Toon als tabel (${ranked.length} ${focus === "US" ? "staten" : "landen"}, met totalen)`} labelOpen="Verberg de tabel">
      {toelichting && <p className="border-b border-border px-5 py-2 text-meta leading-snug text-muted-foreground" data-venster-uitleg>{toelichting}</p>}
      <GeoTabel state={state} />
    </Lade>
  );
}

export function GeoRanglijstCard({ state, zonderBalken = false }: { state: GeoBreakdownState; zonderBalken?: boolean }) {
  const { metric, focus, setFocus, laden, canDrillUs, labelOf, geoWord, ranked, totaal, eenLandOfMinder } = state;
  const [tabelOpen, toggleTabel] = useRememberedOpen("geo-tabel", false);

  if (laden || eenLandOfMinder || ranked.length === 0) return null;

  return (
    // `flex flex-col` met het cijferblok als `flex-1`, en met OPZET geen `h-full`. Als directe
    // rastercel (Meta/LinkedIn) rekt de kaart al vanzelf naar de rijhoogte -- `h-full` voegt daar
    // niets toe. In een flex-KOLOM (de Google-hero) zou het wél iets doen, en precies het
    // verkeerde: dan rekt élke kaart in de kolom mee en heeft de aangewezen opvanger niets meer
    // op te vangen. Zie google-view.tsx voor waarom er per kolom precies één opvanger is.
    <div className="@container bg-card flex h-full flex-col rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <ListOrdered className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{metric.label} per {geoWord}</h3>
        {/* Zelfde bron en dus zelfde venster als de kaart erboven. */}
        {state.dagVenster
          ? <Vensterlabel soort="periode" perDag toevoeging={state.dagVenster.toevoeging ?? undefined}
            toevoegingUitleg={state.dagVenster.regels.length ? state.dagVenster.regels.join(" ") : undefined} />
          : <Vensterlabel soort="vast" venster="laatste 180 dagen" />}
      </div>

      <div className="flex flex-1 flex-col justify-center px-4 py-3">
        {/* zonderBalken: de balken staan dan al in de kaart erboven (GeoRanglijstInKaart). Alleen
            de totalen tonen voorkomt dat dezelfde rangorde twee keer op het scherm staat. */}
        <GeoRanglijst
          regels={zonderBalken ? [] : ranked.map(({ c, v }) => ({ code: c.code, label: labelOf(c.code), waarde: v, weergave: metric.fmt(v), ...veranderingVan(state, c.code) }))}
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

      {/* Per dag: wat elk kanaal telde, leesbaar en niet alleen in de uitleg van het label (die is
          zonder muis niet te zien). Zoals onder GeoMapCard. */}
      {state.dagVenster && state.dagVenster.regels.length > 0 && (
        <div className="border-t border-border px-5 py-2" data-venster-uitleg>
          {state.dagVenster.regels.map((r) => <p key={r} className="text-micro leading-snug text-muted-foreground">{r}</p>)}
        </div>
      )}

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="geo-tabel-hero"
        label={`de tabel per ${geoWord} (${ranked.length})`}
      />
      <div id="geo-tabel-hero" hidden={!tabelOpen} className="border-t border-border">
        <GeoTabel state={state} />
      </div>
    </div>
  );
}
