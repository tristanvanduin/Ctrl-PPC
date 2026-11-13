// De kaart per dag: wat elk kanaal over een periode per land (of staat) telde, en de verandering
// per land tegen de vergelijkingsperiode. Puur: de lezers (lib/geo/geo-source.ts) en de demo
// (lib/demo/geo-demo.ts) leveren de rijen, dit telt ze.
//
// WAAROM. In de vertrouwde weergave toont de kaart een vast venster van 180 dagen, per maand. In de
// nieuwe weergave volgt hij de periodekiezer exact, per dag, zoals de kerncijfers: Meta, LinkedIn en
// Microsoft uit hun dagtabellen, Google uit ads_country_daily en ads_region_daily (migratie 111).
// Alleen het deel van een periode vóór de eerste Google-dagrij valt terug op de maandtabellen, en
// het label zegt dat (lib/period/dag-opslag.ts).
//
// DE VERANDERING PER LAND, ALLEEN WAAR EERLIJK.
// - Per kanaal gepaard, zoals de kerncijfers (telDagVergelijking): een kanaal dat in een van beide
//   periodes geen landdata heeft, telt niet mee in de verandering, met de reden erbij. Anders las
//   een kanaal dat later begon als groei in elk land waar het adverteert.
// - Een kanaal dat in een van beide periodes hele maanden telde waar om dagen gevraagd was (Google
//   vóór de dagopslag, midden in een maand), telt ook niet mee: dat zijn ongelijke vensters.
// - Een land zonder data in een van beide periodes krijgt geen percentage maar een reden. Een
//   nieuwe markt is geen "+100%", en een land dat wegviel geen "-100%" uit niets.
// Zonder vergelijking zijn er alleen totalen.

import type { GeoAgg } from "@/lib/demo/geo-demo";
import { KANAAL_NAAM } from "@/lib/kanalen/beschikbaar";
import { monthsIn } from "@/lib/period/period-range";
import { splitsOpDagOpslag } from "@/lib/period/dag-opslag";
import { dagIn, formatDagPeriode, type Dag, type DagPeriode } from "@/lib/period/dag-periode";

export type GeoDagKanaal = "google" | "meta" | "linkedin" | "microsoft";
export const GEO_DAG_KANALEN: readonly GeoDagKanaal[] = ["google", "meta", "linkedin", "microsoft"];

/** Eén rij: een dag (of bij de maandterugval een maand, "YYYY-MM-01") en een geo-code. */
export interface GeoDagRij {
  date: string;
  code: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

export interface GeoKanaalBron {
  kanaal: GeoDagKanaal;
  /** Alle dagrijen van het kanaal op dit niveau die het venster raken, plus de eerste dagrij
   *  overall in `eersteDag`. Null: er is geen dagbron (de tabel ontbreekt of was niet te lezen). */
  dagen: readonly GeoDagRij[] | null;
  /** De vroegste dag met een rij in de dagtabel, over ALLE rijen; null zonder rijen. */
  eersteDag?: Dag | null;
  /** Alleen Google: de maandrijen voor het deel vóór de dagopslag. */
  maanden?: readonly GeoDagRij[] | null;
  /** Rijen die niet naar een land of staat te vertalen waren: geteld, niet stil weggelaten. */
  onbekend?: number;
}

export interface GeoKanaalTelling {
  kanaal: GeoDagKanaal;
  rows: GeoAgg[];
  /** Het venster als niet alles per dag telde (Google vóór de dagopslag); anders null. */
  label: string | null;
  /** False als het kanaal meer dagen telde dan gevraagd (een hele maand voor een halve). */
  exact: boolean;
  /** Waarom er niets staat, of wat er mist; null als er gewoon data is. */
  opmerking: string | null;
}

/** Som per code. Ratio's komen later uit deze totalen, nooit uit een gemiddelde van dagwaarden. */
export function somPerCode(rijen: Iterable<Omit<GeoDagRij, "date">>): GeoAgg[] {
  const m = new Map<string, GeoAgg>();
  for (const r of rijen) {
    const code = (r.code || "").toUpperCase();
    if (!code) continue;
    const a = m.get(code) ?? { code, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
    a.impressions += r.impressions || 0;
    a.clicks += r.clicks || 0;
    a.cost += r.cost || 0;
    a.conversions += r.conversions || 0;
    a.conversionsValue += r.conversionsValue || 0;
    m.set(code, a);
  }
  return [...m.values()];
}

/** De vroegste dag in een reeks rijen; null als er geen zijn. */
export function eersteDagVan(rijen: readonly { date: string }[] | null | undefined): Dag | null {
  let eerste: Dag | null = null;
  for (const r of rijen ?? []) {
    const d = String(r.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (eerste === null || d < eerste)) eerste = d;
  }
  return eerste;
}

/**
 * Wat één kanaal over de periode telde. Google splitst op zijn dagopslag; de andere kanalen tellen
 * alleen per dag (hun dagtabellen bestaan al langer dan de dagopslag van Google).
 */
export function telGeoKanaal(p: DagPeriode, bron: GeoKanaalBron): GeoKanaalTelling {
  const naam = KANAAL_NAAM[bron.kanaal];
  const onbekend = bron.onbekend ? ` ${bron.onbekend} rijen met een onbekend land of staat zijn niet meegeteld.` : "";
  if (bron.kanaal !== "google") {
    if (!bron.dagen || bron.dagen.length === 0) {
      return { kanaal: bron.kanaal, rows: [], label: null, exact: true, opmerking: `${naam} heeft geen landdata.${onbekend}` };
    }
    const rows = somPerCode(bron.dagen.filter((r) => dagIn(r.date.slice(0, 10), p)));
    return {
      kanaal: bron.kanaal, rows, label: null, exact: true,
      opmerking: rows.length ? (onbekend.trim() || null) : `${naam} heeft geen landdata in ${formatDagPeriode(p)}.${onbekend}`,
    };
  }

  const eerste = bron.eersteDag ?? eersteDagVan(bron.dagen);
  const split = splitsOpDagOpslag(p, eerste);
  const delen: GeoDagRij[] = [];
  if (split.dagDeel && bron.dagen) delen.push(...bron.dagen.filter((r) => dagIn(r.date.slice(0, 10), split.dagDeel!)));
  let opmerking: string | null = null;
  if (split.maanden) {
    const maanden = new Set(monthsIn(split.maanden));
    const maandRijen = (bron.maanden ?? []).filter((r) => maanden.has(r.date.slice(0, 7)));
    delen.push(...maandRijen);
    if (maandRijen.length === 0) opmerking = `${naam} heeft geen landdata voor ${formatDagPeriode(split.maandDeel!)}.`;
  }
  const rows = somPerCode(delen);
  if (!rows.length) opmerking = `${naam} heeft geen landdata in ${formatDagPeriode(p)}.`;
  return {
    kanaal: "google", rows, label: split.label, exact: !split.maandenRuimer,
    opmerking: opmerking || onbekend.trim() ? `${opmerking ?? ""}${onbekend}`.trim() : null,
  };
}

// ── De verandering per land ──────────────────────────────────────────────────

export interface GeoVerandering {
  /** (nu - toen) / toen, of null met een reden. */
  pct: number | null;
  reden: string | null;
}

export interface GeoVergelijking {
  /** Per code die nu data heeft. */
  perCode: Map<string, GeoVerandering>;
  /** De kanalen in de verandering. */
  gepaard: GeoDagKanaal[];
  /** Per kanaal dat buiten de verandering valt, waarom. */
  buiten: string[];
}

/**
 * De verandering per land van een metriek, over de kanalen die in BEIDE periodes landdata hebben
 * en in beide periodes exact telden. `waarde` is de metriek uit de totalen (METRICS in
 * use-geo-breakdown.ts), dus ook CTR en CPA komen uit opgetelde totalen.
 */
export function geoVergelijking(
  nu: readonly GeoKanaalTelling[],
  toen: readonly GeoKanaalTelling[],
  waarde: (a: GeoAgg) => number | null,
): GeoVergelijking {
  const gepaard: GeoDagKanaal[] = [];
  const buiten: string[] = [];
  for (const h of nu) {
    if (h.rows.length === 0) continue;
    const naam = KANAAL_NAAM[h.kanaal];
    const v = toen.find((t) => t.kanaal === h.kanaal);
    if (!v || v.rows.length === 0) { buiten.push(`${naam} had in de vergelijkingsperiode geen landdata en telt niet mee in de verandering.`); continue; }
    if (!h.exact || !v.exact) { buiten.push(`${naam} telde in een van beide periodes hele maanden in plaats van de gevraagde dagen; dat is geen eerlijke vergelijking en telt niet mee in de verandering.`); continue; }
    gepaard.push(h.kanaal);
  }
  const nuSom = new Map(somPerCode(nu.filter((t) => gepaard.includes(t.kanaal)).flatMap((t) => t.rows)).map((a) => [a.code, a]));
  const toenSom = new Map(somPerCode(toen.filter((t) => gepaard.includes(t.kanaal)).flatMap((t) => t.rows)).map((a) => [a.code, a]));
  const perCode = new Map<string, GeoVerandering>();
  for (const code of new Set(nu.flatMap((t) => t.rows.map((r) => r.code)))) {
    if (!gepaard.length) { perCode.set(code, { pct: null, reden: "geen kanaal met landdata in beide periodes" }); continue; }
    const a = nuSom.get(code);
    const b = toenSom.get(code);
    if (!a) { perCode.set(code, { pct: null, reden: "alleen data van kanalen die niet te vergelijken zijn" }); continue; }
    if (!b) { perCode.set(code, { pct: null, reden: "geen data in de vergelijkingsperiode" }); continue; }
    const x = waarde(a);
    const y = waarde(b);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) { perCode.set(code, { pct: null, reden: "niet te berekenen in een van beide periodes" }); continue; }
    if (y === 0) { perCode.set(code, { pct: null, reden: "nul in de vergelijkingsperiode" }); continue; }
    perCode.set(code, { pct: (x - y) / y, reden: null });
  }
  return { perCode, gepaard, buiten };
}

/** "+12,4%" of "-3,0%": de verandering zoals de ranglijst hem toont. */
export function formatVerandering(pct: number): string {
  const tekst = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(pct) * 100);
  return `${pct >= 0 ? "+" : "-"}${tekst}%`;
}
