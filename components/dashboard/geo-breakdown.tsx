"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { Globe2, Loader2, ChevronLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { countryLabel } from "@/lib/countries";
import { stateLabel } from "@/lib/geo/us-fips";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { type GeoAgg } from "@/lib/demo/geo-demo";
import { MapErrorBoundary } from "./map-error-boundary";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";
import { GeoRanglijst } from "./geo-ranglijst";

// De kaarten (SVG + geometrie + d3-geo) client-only en code-split laden: pas geladen als deze
// weergave rendert, en nooit tijdens SSR.
const WorldMap = dynamic(() => import("./world-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-rm-blue-ink" /></div>,
});
const UsStatesMap = dynamic(() => import("./us-states-map"), {
  ssr: false,
  loading: () => <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-rm-blue-ink" /></div>,
});

// Geo-mapping: waar komt het verkeer / de conversies vandaan, per gekozen metric. Interactief —
// je kiest de metric (impressies, klikken, CTR, conversies, conversieratio, CPA) en de landen
// herordenen + herkleuren ernaar. Klik op de VS om in te zoomen op de staten (drilldown).
// Werkt per kanaal: Google toont echte landdata; Meta/LinkedIn/blended tonen demo-geo tot de sync
// er is (Laag 2). Ratio's altijd uit de landtotalen, nooit uit een gemiddelde van maand-deelwaarden.

type Channel = "google" | "meta" | "linkedin" | "blended";

type MetricKey = "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate" | "cpa";
interface MetricDef { key: MetricKey; label: string; higherIsBetter: boolean; value: (a: GeoAgg) => number | null; fmt: (v: number | null) => string }

const nf = (d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d });
const eur = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const int = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : nf(0).format(v));

const METRICS: MetricDef[] = [
  { key: "impressions", label: "Vertoningen", higherIsBetter: true, value: (a) => a.impressions, fmt: int },
  { key: "clicks", label: "Klikken", higherIsBetter: true, value: (a) => a.clicks, fmt: int },
  { key: "ctr", label: "CTR", higherIsBetter: true, value: (a) => (a.impressions > 0 ? a.clicks / a.impressions : null), fmt: pct },
  { key: "conversions", label: "Conversies", higherIsBetter: true, value: (a) => a.conversions, fmt: (v) => (v == null ? "—" : nf(1).format(v)) },
  { key: "conversionRate", label: "Conversieratio", higherIsBetter: true, value: (a) => (a.clicks > 0 ? a.conversions / a.clicks : null), fmt: pct },
  { key: "cpa", label: "CPA", higherIsBetter: false, value: (a) => (a.conversions > 0 ? a.cost / a.conversions : null), fmt: eur },
];

const CHANNEL_LABEL: Record<Channel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", blended: "Alle kanalen" };

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
  const [metricKey, setMetricKey] = useState<MetricKey>("conversions");
  const [focus, setFocus] = useState<"US" | null>(null); // null = wereld, "US" = staten-drilldown
  // De tabel begint dicht: de kaart is het antwoord op "waar komt het vandaan", de tabel is de
  // naslag erachter. Vijftig landregels tussen twee kaarten in maakt de pagina onleesbaar.
  const [tabelOpen, toggleTabel] = useRememberedOpen("geo-tabel", false);
  const metric = METRICS.find((m) => m.key === metricKey)!;

  // Beide niveaus via /api/geo, dat per (kanaal, niveau) de juiste tabel kiest — zie
  // lib/geo/geo-source.ts. Dat lag er al, maar dit component las het niet: landen kwamen uit de
  // client-data-provider en staten kwamen ALLEEN uit de demo-mock. Buiten demo was `states` dus
  // altijd leeg, waardoor de klik op de VS niets deed — geen kapotte kaart, maar een dood
  // eindpunt dat er wél uitzag als een knop.
  //
  // De staten worden meteen meegehaald en niet pas bij de klik: alleen zo weet de kaart óf de
  // drilldown iets oplevert, en pas dan mag de uitnodiging "klik op de VS" er staan.
  const [countries, setCountries] = useState<GeoAgg[]>([]);
  const [states, setStates] = useState<GeoAgg[]>([]);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLaden(true);
    const demoParam = isDemoMode() ? "&demo=1" : "";
    const haal = (level: "country" | "region") =>
      fetch(`/api/geo?clientId=${encodeURIComponent(clientId)}&channel=${channel}&level=${level}${demoParam}`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d) => (Array.isArray(d?.rows) ? (d.rows as GeoAgg[]) : []))
        .catch(() => [] as GeoAgg[]);

    Promise.all([haal("country"), haal("region")]).then(([land, staat]) => {
      if (cancelled) return;
      setCountries(land);
      setStates(staat);
      setLaden(false);
    });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  const canDrillUs = states.length > 0 && countries.some((c) => c.code === "US");

  const active = focus === "US" ? states : countries;
  const labelOf = focus === "US" ? stateLabel : countryLabel;
  const geoWord = focus === "US" ? "staat" : "land";

  const ranked = useMemo(() => {
    return active
      .map((c) => ({ c, v: metric.value(c) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
      // Sorteer op de metric: bij "hoger is beter" aflopend, bij CPA oplopend (goedkoopst eerst).
      .sort((a, b) => (metric.higherIsBetter ? (b.v! - a.v!) : (a.v! - b.v!)));
  }, [active, metric]);

  // Waarde per code (alpha-2-land óf USPS-staat) voor de kaart-inkleuring van de gekozen metric.
  const values = useMemo(() => {
    const m = new Map<string, number>();
    for (const { c, v } of ranked) if (v != null && Number.isFinite(v)) m.set(c.code, v);
    return m;
  }, [ranked]);

  const totaal = useMemo(() => {
    const t = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    for (const { c } of ranked) {
      t.impressions += c.impressions; t.clicks += c.clicks;
      t.cost += c.cost; t.conversions += c.conversions;
    }
    return t;
  }, [ranked]);

  // De aandeelstreep staat in de kolom die je zelf hebt gekozen — dezelfde metric die de kaart
  // inkleurt. Zo lezen kaart en tabel hetzelfde verhaal in plaats van elk een eigen.
  //
  // Alleen bij optelbare grootheden. CTR, conversieratio en CPA zijn verhoudingen: daar bestaat
  // "aandeel van het geheel" niet, en bij CPA zou een lange streep "veel" zeggen waar het "duur"
  // betekent. Kies je zo'n metric, dan staat er nergens een streep.
  const balkKolom = (["impressions", "clicks", "conversions"] as const).find((k) => k === metricKey) ?? null;
  // Tegen de koploper en niet tegen de som: bij vijftig landen is elk aandeel-van-het-totaal klein
  // en zijn alle streepjes even kort.
  const grootste = useMemo(
    () => (balkKolom ? Math.max(0, ...ranked.map(({ c }) => c[balkKolom])) : 0),
    [ranked, balkKolom],
  );
  const balk = (c: GeoAgg, kolom: "impressions" | "clicks" | "conversions", waarde: string) =>
    balkKolom === kolom
      ? <AandeelCel waarde={waarde} aandeel={grootste > 0 ? c[kolom] / grootste : 0} />
      : <GetalCel>{waarde}</GetalCel>;

  // Tijdens het laden nog niets concluderen: "één of geen land" was anders even waar voor elke
  // klant, en dan knippert de kaart weg en weer terug.
  if (laden) {
    return <Laadvlak vorm="grafiek" hoogte={220} titel="Waar komt het vandaan" />;
  }
  if (countries.length <= 1) return null; // één (of geen) land: geen geo-verhaal

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Globe2 className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">
          Waar komt het vandaan{focus === "US" ? " — Verenigde Staten" : ""}
        </h3>
        <span className="text-micro font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{CHANNEL_LABEL[channel]}</span>
        {focus === "US" && (
          <button
            onClick={() => setFocus(null)}
            className="flex items-center gap-0.5 text-meta font-medium text-rm-blue-ink hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Wereld
          </button>
        )}
        {/* Slimme dropdown naast de kaart: kies de metric die de kaart inkleurt. */}
        <label className="ml-auto flex items-center gap-1.5 text-meta text-muted-foreground">
          Toon
          <select
            value={metricKey}
            onChange={(e) => setMetricKey(e.target.value as MetricKey)}
            className="rounded-md border border-border bg-card px-2 py-1 text-body font-medium text-rm-gray focus:outline-none focus:ring-1 focus:ring-rm-blue"
          >
            {METRICS.map((m) => (
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
      <div className="grid grid-cols-1 gap-5 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_17rem]">
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
        totalen={[
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
            <KolomKop getal bijschrift={balkKolom === "impressions" ? "aandeel" : undefined}>Vertoningen</KolomKop>
            <KolomKop getal bijschrift={balkKolom === "clicks" ? "aandeel" : undefined}>Klikken</KolomKop>
            <KolomKop getal>CTR</KolomKop>
            <KolomKop getal bijschrift={balkKolom === "conversions" ? "aandeel" : undefined}>Conversies</KolomKop>
            <KolomKop getal>Conv.ratio</KolomKop>
            <KolomKop getal>CPA</KolomKop>
          </Kop>
          <Body>
            {ranked.map(({ c }) => (
              <Rij key={c.code}>
                <NaamCel>{labelOf(c.code)}</NaamCel>
                {balk(c, "impressions", int(c.impressions))}
                {balk(c, "clicks", int(c.clicks))}
                <GetalCel zacht>{pct(c.impressions > 0 ? c.clicks / c.impressions : null)}</GetalCel>
                {balk(c, "conversions", c.conversions == null ? "—" : nf(1).format(c.conversions))}
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
