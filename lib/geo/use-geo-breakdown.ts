"use client";

import { useEffect, useMemo, useState } from "react";
import { countryLabel } from "@/lib/countries";
import { stateLabel } from "@/lib/geo/us-fips";
import { type GeoAgg } from "@/lib/demo/geo-demo";
import { maakBronCache } from "@/lib/data-access/bron-cache";
import { usePeriod } from "@/lib/period/period-context";
import { formatDagPeriode, type DagPeriode } from "@/lib/period/dag-periode";
import { KANAAL_NAAM } from "@/lib/kanalen/beschikbaar";
import { geoVergelijking, somPerCode, type GeoKanaalTelling, type GeoVerandering } from "@/lib/geo/geo-dag";
import type { GeoPeriodeKanaal } from "@/lib/geo/geo-periode";

// De gedeelde state achter GeoBreakdown, uitgelicht (17.36) zodat de opener op Google Overzicht de
// kaart en de ranglijst in TWEE aparte kolommen kan zetten zonder de data twee keer op te halen of
// twee losse metric-keuzes te laten ontstaan. GeoBreakdown zelf blijft dit gewoon intern aanroepen
// voor de drie andere plekken (cross-channel, Meta, LinkedIn) waar kaart en lijst nog in één kaart
// staan -- puur een verhuizing van bestaande logica, geen gedragswijziging.

export type Channel = "google" | "meta" | "linkedin" | "blended";
export type MetricKey = "impressions" | "clicks" | "ctr" | "conversions" | "conversionRate" | "cpa";
export interface MetricDef { key: MetricKey; label: string; higherIsBetter: boolean; value: (a: GeoAgg) => number | null; fmt: (v: number | null) => string }

const nf = (d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d });
const eur = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
const int = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : nf(0).format(v));

export const METRICS: MetricDef[] = [
  { key: "impressions", label: "Vertoningen", higherIsBetter: true, value: (a) => a.impressions, fmt: int },
  { key: "clicks", label: "Klikken", higherIsBetter: true, value: (a) => a.clicks, fmt: int },
  { key: "ctr", label: "CTR", higherIsBetter: true, value: (a) => (a.impressions > 0 ? a.clicks / a.impressions : null), fmt: pct },
  { key: "conversions", label: "Conversies", higherIsBetter: true, value: (a) => a.conversions, fmt: (v) => (v == null ? "—" : nf(1).format(v)) },
  { key: "conversionRate", label: "Conversieratio", higherIsBetter: true, value: (a) => (a.clicks > 0 ? a.conversions / a.clicks : null), fmt: pct },
  { key: "cpa", label: "CPA", higherIsBetter: false, value: (a) => (a.conversions > 0 ? a.cost / a.conversions : null), fmt: eur },
];

export const CHANNEL_LABEL: Record<Channel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn", blended: "Alle kanalen" };

type GeoNiveau = "country" | "region";

// De landen en de staten per (klant, kanaal), vijf minuten bewaard. Elke kanaalweergave mount deze
// hook opnieuw, en elke mount haalde beide niveaus opnieuw op: twee verzoeken bij elke wissel van
// tabblad, ook terug naar een tabblad waar je net was. De rijen veranderen alleen door een sync
// (het venster is 180 dagen, per maand); die vergeet ze via vergeetBronnen in bron-cache.ts.
//
// Eén verzoek per kanaal, met beide niveaus in het antwoord (level=beide). Hier stonden er twee
// (land en staat elk een eigen verzoek naar /api/geo); de server doet er dezelfde twee lezingen
// voor als voorheen, alleen in één antwoord. Bewust NIET alle kanalen in één antwoord bij "Alle
// kanalen": dat zou het eerste laden verzwaren (acht lezingen in plaats van twee, ook voor een
// klant met alleen Google) om een latere kanaalwissel te versnellen, en dat is niet gemeten op een
// echte klant.
const GEO_TTL = 5 * 60 * 1000;
type GeoPaar = Record<GeoNiveau, GeoAgg[]>;
const geoCache = maakBronCache<GeoPaar>(GEO_TTL);
const geoSleutel = (clientId: string, channel: Channel) => `${clientId}|${channel}|geo`;
const GEEN_GEO: GeoPaar = { country: [], region: [] };

/**
 * Eén niveau mislukte op de server, het andere niet. De fout draagt wat er wel is: de kaart toont
 * dat (land en staat faalden altijd al los van elkaar), maar het staat niet in de cache, zodat de
 * volgende mount het opnieuw probeert.
 */
class GeoDeelsMislukt extends Error {
  constructor(readonly deel: GeoPaar) { super("/api/geo gaf niet beide niveaus"); }
}

function leesGeo(clientId: string, channel: Channel): Promise<GeoPaar> {
  // /api/geo bepaalt demo vs. echt zelf aan de hand van clientId (lib/geo/geo-source.ts), dus
  // hier is geen aparte demo-vlag meer nodig.
  return geoCache.lees(geoSleutel(clientId, channel), () =>
    fetch(`/api/geo?clientId=${encodeURIComponent(clientId)}&channel=${channel}&level=beide`)
      .then((r) => {
        // Gooien, niet "geen rijen" teruggeven: een storing hoort niet vijf minuten lang als een
        // lege kaart in de cache te staan. De lege kaart maakt de hook er hieronder van.
        if (!r.ok) throw new Error(`/api/geo gaf HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { niveaus?: Partial<Record<GeoNiveau, unknown>> }) => {
        const land = d?.niveaus?.country, staat = d?.niveaus?.region;
        const paar: GeoPaar = {
          country: Array.isArray(land) ? (land as GeoAgg[]) : [],
          region: Array.isArray(staat) ? (staat as GeoAgg[]) : [],
        };
        if (!Array.isArray(land) || !Array.isArray(staat)) throw new GeoDeelsMislukt(paar);
        return paar;
      }));
}

// ── De nieuwe weergave: de periode van de kiezer, per dag ────────────────────
//
// Met de schakelaar "Nieuwe weergave" aan heeft de periodekiezer een keuze per dag (usePeriod().dag).
// Dan vraagt deze hook /api/geo met die periode en de vergelijkingsperiode, en volgt de kaart de
// kiezer exact (lib/geo/geo-periode.ts). Met de schakelaar uit is `dag` null en verandert er niets:
// hetzelfde verzoek, dezelfde cache, hetzelfde venster van 180 dagen.

/** Wat /api/geo per dag teruggeeft. */
interface GeoPeriodeAntwoord {
  periode: DagPeriode;
  vergelijking: DagPeriode | null;
  kanalen: GeoPeriodeKanaal[];
}
const geoPeriodeCache = maakBronCache<GeoPeriodeAntwoord>(GEO_TTL);
const periodeSleutel = (clientId: string, channel: Channel, p: DagPeriode, c: DagPeriode | null) =>
  `${clientId}|${channel}|geo-dag|${p.start}|${p.eind}|${c ? `${c.start}|${c.eind}` : "-"}`;

function leesGeoPeriode(clientId: string, channel: Channel, p: DagPeriode, c: DagPeriode | null): Promise<GeoPeriodeAntwoord> {
  const vgl = c ? `&vvan=${c.start}&vtot=${c.eind}` : "";
  return geoPeriodeCache.lees(periodeSleutel(clientId, channel, p, c), () =>
    fetch(`/api/geo?clientId=${encodeURIComponent(clientId)}&channel=${channel}&level=beide&van=${p.start}&tot=${p.eind}${vgl}`)
      .then((r) => {
        if (!r.ok) throw new Error(`/api/geo gaf HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Partial<GeoPeriodeAntwoord>) => {
        if (!Array.isArray(d?.kanalen)) throw new Error("/api/geo gaf geen kanalen");
        return { periode: d.periode ?? p, vergelijking: d.vergelijking ?? null, kanalen: d.kanalen };
      }));
}

/** Het venster van de kaart per dag, voor het label in de kop en de regel eronder. */
export interface GeoDagVenster {
  periode: DagPeriode;
  vergelijking: DagPeriode | null;
  /** Kort, achter het vensterlabel: "Google deels per maand", "zonder Microsoft". */
  toevoeging: string | null;
  /** Voluit, per kanaal: wat anders telde, welk kanaal geen landdata heeft, en wat buiten de
   *  verandering valt. Leeg als alles per dag telde en elk kanaal data had. */
  regels: string[];
}

/**
 * De regels onder de kaart per dag, uit wat de kanalen telden. Zuiver, zodat de test de tekst ziet.
 */
export function geoDagRegels(kanalen: readonly GeoPeriodeKanaal[], niveau: GeoNiveau, buiten: readonly string[]): { toevoeging: string | null; regels: string[] } {
  const regels: string[] = [];
  const zonder: string[] = [];
  let deelsMaand = false;
  for (const k of kanalen) {
    const t = k.nu[niveau];
    const v = k.toen?.[niveau] ?? null;
    if (t.label) { regels.push(`${KANAAL_NAAM[k.kanaal]}: ${t.label}.`); deelsMaand = true; }
    if (v?.label) regels.push(`${KANAAL_NAAM[k.kanaal]} in de vergelijkingsperiode: ${v.label}.`);
    if (t.opmerking) regels.push(t.opmerking);
    if (t.rows.length === 0) zonder.push(KANAAL_NAAM[k.kanaal]);
  }
  regels.push(...buiten);
  const delen = [deelsMaand ? "Google deels per maand" : null, zonder.length ? `zonder ${zonder.join(", ")}` : null].filter((x): x is string => !!x);
  return { toevoeging: delen.length ? delen.join(" · ") : null, regels: [...new Set(regels)] };
}

export function useGeoBreakdown({ clientId, channel = "google", enabled = true }: {
  clientId: string;
  channel?: Channel;
  /** Fetch overslaan zolang er niets met het resultaat gebeurt (bv. de geo-kloon-weergave op
   *  Google Overzicht, die deze hook niet gebruikt maar de aanroepende component wel altijd
   *  rendert). */
  enabled?: boolean;
}) {
  const [metricKey, setMetricKey] = useState<MetricKey>("conversions");
  const [focus, setFocus] = useState<"US" | null>(null);
  const metric = METRICS.find((m) => m.key === metricKey)!;

  // De beginstaat uit de cache: een tweede bezoek binnen de cachetijd toont de kaart meteen, zonder
  // laadvlak en zonder verzoek.
  const [countries, setCountries] = useState<GeoAgg[]>(() => (enabled ? geoCache.kijk(geoSleutel(clientId, channel))?.country : undefined) ?? []);
  const [states, setStates] = useState<GeoAgg[]>(() => (enabled ? geoCache.kijk(geoSleutel(clientId, channel))?.region : undefined) ?? []);
  const [laden, setLaden] = useState(() => !enabled || geoCache.kijk(geoSleutel(clientId, channel)) === undefined);

  // De nieuwe weergave: de periode van de kiezer, per dag. Null in de vertrouwde weergave.
  const dag = usePeriod().dag;
  const dagP = dag?.periode ?? null;
  const dagC = dag && dag.keuze.vergelijk !== "none" ? dag.vergelijking.periode : null;
  const dagSleutel = dagP ? periodeSleutel(clientId, channel, dagP, dagC) : null;
  const [perDag, setPerDag] = useState<{ sleutel: string; antwoord: GeoPeriodeAntwoord | null } | null>(null);

  useEffect(() => {
    if (!enabled || !dagP || !dagSleutel) return;
    let cancelled = false;
    // Een mislukte lezing: geen rijen (de kaart zegt "geen data"), niet het oude venster van 180
    // dagen onder een label dat de periode belooft.
    leesGeoPeriode(clientId, channel, dagP, dagC).catch(() => null).then((antwoord) => {
      if (!cancelled) setPerDag({ sleutel: dagSleutel, antwoord });
    });
    return () => { cancelled = true; };
    // dagP en dagC zitten in dagSleutel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, channel, enabled, dagSleutel]);

  useEffect(() => {
    if (!enabled || dagSleutel) return;
    const bewaard = geoCache.kijk(geoSleutel(clientId, channel));
    if (bewaard !== undefined) {
      setCountries(bewaard.country);
      setStates(bewaard.region);
      setLaden(false);
      return;
    }
    let cancelled = false;
    setLaden(true);
    // Een mislukte lezing toont een lege kaart, zoals altijd (of het ene niveau dat wel lukte); ze
    // staat alleen niet in de cache, dus de volgende mount probeert het opnieuw.
    leesGeo(clientId, channel).catch((e): GeoPaar => (e instanceof GeoDeelsMislukt ? e.deel : GEEN_GEO)).then((paar) => {
      if (cancelled) return;
      setCountries(paar.country);
      setStates(paar.region);
      setLaden(false);
    });
    return () => { cancelled = true; };
  }, [clientId, channel, enabled]);

  // Per dag: de som over de kanalen per niveau. Zolang de periode laadt, niets (en `laden`).
  const dagAntwoord = dagSleutel && perDag?.sleutel === dagSleutel ? perDag.antwoord : undefined;
  const dagLanden = useMemo(() => (dagAntwoord ? somPerCode(dagAntwoord.kanalen.flatMap((k) => k.nu.country.rows)) : null), [dagAntwoord]);
  const dagStaten = useMemo(() => (dagAntwoord ? somPerCode(dagAntwoord.kanalen.flatMap((k) => k.nu.region.rows)) : null), [dagAntwoord]);
  const toonLanden = dagSleutel ? (dagLanden ?? []) : countries;
  const toonStaten = dagSleutel ? (dagStaten ?? []) : states;
  const toonLaden = dagSleutel ? dagAntwoord === undefined : laden;

  const canDrillUs = toonStaten.length > 0 && toonLanden.some((c) => c.code === "US");
  const active = focus === "US" ? toonStaten : toonLanden;
  const labelOf = focus === "US" ? stateLabel : countryLabel;
  const geoWord = focus === "US" ? "staat" : "land";

  const ranked = useMemo(() => {
    return active
      .map((c) => ({ c, v: metric.value(c) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
      .sort((a, b) => (metric.higherIsBetter ? (b.v! - a.v!) : (a.v! - b.v!)));
  }, [active, metric]);

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

  // De verandering per land (of staat), alleen met een vergelijking, per kanaal gepaard (geo-dag.ts).
  const niveau: GeoNiveau = focus === "US" ? "region" : "country";
  const vergelijking = useMemo(() => {
    if (!dagAntwoord?.vergelijking) return null;
    const nu: GeoKanaalTelling[] = dagAntwoord.kanalen.map((k) => k.nu[niveau]);
    const toen: GeoKanaalTelling[] = dagAntwoord.kanalen.flatMap((k) => (k.toen ? [k.toen[niveau]] : []));
    return geoVergelijking(nu, toen, metric.value);
  }, [dagAntwoord, niveau, metric]);
  const dagVenster = useMemo((): GeoDagVenster | null => {
    if (!dagSleutel || !dagP) return null;
    const { toevoeging, regels } = dagAntwoord ? geoDagRegels(dagAntwoord.kanalen, niveau, vergelijking?.buiten ?? [])
      : { toevoeging: null, regels: dagAntwoord === null ? [`De landcijfers over ${formatDagPeriode(dagP)} konden niet geladen worden.`] : [] };
    return { periode: dagP, vergelijking: dagC, toevoeging, regels };
  }, [dagSleutel, dagP, dagC, dagAntwoord, niveau, vergelijking]);
  const verandering: Map<string, GeoVerandering> | null = vergelijking?.perCode ?? null;

  return {
    metricKey, setMetricKey, metric, focus, setFocus,
    countries: toonLanden, states: toonStaten, laden: toonLaden, canDrillUs, labelOf, geoWord, ranked, values, totaal,
    eenLandOfMinder: toonLanden.length <= 1,
    /** Alleen in de nieuwe weergave: het venster per dag. Null: het vaste venster van 180 dagen. */
    dagVenster,
    /** Alleen met een vergelijking per dag: de verandering per code van de gekozen metriek. */
    verandering,
  };
}

export type GeoBreakdownState = ReturnType<typeof useGeoBreakdown>;
export { int, eur, pct, nf };
