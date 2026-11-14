// De campagnetabellen op Campagnes over de gekozen periode, per dag (nieuwe weergave).
//
// WAAROM. Op Campagnes volgden de kanaaltotalen de periodekiezer, maar de tabellen per campagne
// eronder hadden een vast venster: 90 dagen, Google op hele maanden sinds 90 dagen terug. Dan staan
// er onder elkaar twee totalen voor hetzelfde kanaal die niet over dezelfde dagen gaan, en de
// cijfercontrole kon ze niet naast elkaar leggen ("Niet vergeleken: de campagnetabellen").
//
// HET BESLUIT. Elke periode werkt overal hetzelfde: per dag. Meta, LinkedIn en Microsoft tellen uit
// hun campagne-dagtabellen; Google uit ads_campaign_daily (migratie 111), met voor het deel vóór de
// dagopslag dezelfde terugval op hele maanden als de kerncijfers en de kaart (splitsOpDagOpslag in
// lib/period/dag-opslag.ts). Dat label komt hier één op één uit, zodat het venster in de kop van
// de tabel hetzelfde zegt als elders op de pagina.
//
// GOOGLE OVER HELE MAANDEN: UIT DE MAANDRIJEN, ZOALS HET KANAALTOTAAL. Is de periode precies hele
// maanden, dan telt Google hier uit ads_campaign_monthly, net als telGoogle in lib/period/dag-telling.ts
// (die over hele maanden de maandreeks neemt) en de kanaaltotalen erboven (fact_core per maand).
// Dagrijen en maandrijen komen uit twee syncmomenten: op de demo telt november 2026 per dag € 5.579
// en 49 conversies, per maand € 5.576,66 en 47,12. Telde de tabel de dagen en het kanaaltotaal de
// maand, dan stonden er voor dezelfde maand twee totalen; nu komen beide uit dezelfde sync. Over
// een periode die geen hele maanden is, tellen beide per dag (het kanaaltotaal dan uit
// ads_account_daily, via dezelfde telling als de kerncijfers).
//
// WAAR DE GEGEVENS BEGINNEN. Elke bron draagt de eerste dag waarvoor er campagnerijen zijn
// (`bronStart`). Begint een van beide periodes eerder, dan is een verandering geen vergelijking van
// gelijke dagen maar van gegevens tegen geen gegevens: op de demo begint microsoft_campaign_daily op
// 11 okt 2025, en twaalf maanden tegen vorig jaar telde dan 21 dagen tegen 365 (+1.638%). Dan staat
// er geen percentage, en ook geen "nieuw" of "gestopt": of een campagne toen liep, is niet te zien.
//
// DE VERANDERING PER CAMPAGNE. Alleen waar hij eerlijk is:
// - de campagne liep in beide periodes (kosten of conversies boven nul); liep hij alleen nu, dan is
//   hij "nieuw", alleen toen "gestopt". Een percentage tegen nul of tegen niets is geen verandering.
// - beide periodes zijn op dezelfde korrel geteld (allebei per dag, of allebei met hetzelfde deel per
//   maand) en exact (geen hele maand voor een halve). Een week per dag tegen dezelfde week vorig jaar
//   als hele maand vergelijkt dagen met een maand; dan staat er geen percentage, met de reden.
//
// DE TOTAALRIJ telt alle campagnerijen van de periode, ook die buiten de lijst vallen omdat ze
// niets kostten en niets opleverden (die tellen voor kosten en conversies nul). Zo is hij precies
// de som van wat het kanaal over die dagen in de campagnetabel heeft staan.
//
// Zuiver, zonder React: de hook (use-campagne-periode.ts) laadt, dit rekent, en de tests rekenen mee.

import { splitsOpDagOpslag } from "@/lib/period/dag-opslag";
import { alsMaandPeriode, dagIn, formatDag, type Dag, type DagPeriode } from "@/lib/period/dag-periode";
import { monthsIn } from "@/lib/period/period-range";

export type CampagneKanaal = "google" | "meta" | "linkedin" | "microsoft";

/** Eén rij: een dag (of bij de maandterugval van Google een maand, "YYYY-MM-01") van een campagne. */
export interface CampagneRij {
  /** De campagne-id (Google campaign_id, Meta entity_id, LinkedIn entity_urn). */
  sleutel: string;
  naam: string;
  date: string;
  spend: number;
  /** Al met de conversieselectie van de klant geteld (Google: de acties die de sync toepaste). */
  conversions: number;
  impressions: number;
  clicks: number;
}

export interface CampagneBron {
  kanaal: CampagneKanaal;
  /** De dagrijen die de periode raken. */
  dagen: readonly CampagneRij[];
  /** Alleen Google: de vroegste dag in ads_campaign_daily over ALLE rijen, null zonder dagopslag. */
  eersteDag?: Dag | null;
  /** Alleen Google: de maandrijen (ads_campaign_monthly), voor hele maanden en voor het deel vóór
   *  de dagopslag. */
  maanden?: readonly CampagneRij[] | null;
  /**
   * De eerste dag waarvoor deze bron campagnerijen heeft, over ALLE rijen (niet alleen die van de
   * periode); null als er geen enkele is. Google: de eerste maand van ads_campaign_monthly (de 1e)
   * of de eerste dagrij, wat eerder is. Ontbreekt hij (undefined), dan is de start onbekend en wordt
   * er niet op gelet.
   */
  bronStart?: Dag | null;
}

/** "dag": alles per dag; "dag+maand": Google met een deel vóór de dagopslag per maand; "maand":
 *  Google uit de maandrijen (hele maanden, of de hele periode ligt vóór de dagopslag). */
export type CampagneKorrel = "dag" | "dag+maand" | "maand";

export interface CampagneSom {
  spend: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

export interface CampagneAgg extends CampagneSom {
  sleutel: string;
  naam: string;
}

export interface CampagneTelling {
  kanaal: CampagneKanaal;
  periode: DagPeriode;
  /** Per campagne, op kosten aflopend. Alle campagnes met een rij, ook die met alleen nullen. */
  campagnes: CampagneAgg[];
  /** De som over ALLE campagnerijen van de periode. */
  totaal: CampagneSom;
  korrel: CampagneKorrel;
  /** False als een deel als hele maand telde terwijl er maar een deel van die maand gevraagd was. */
  exact: boolean;
  /** Het venster als niet alles per dag telde ("... per dag; sep 2026 per maand, ..."), anders null. */
  label: string | null;
  /** De start van de bron (CampagneBron.bronStart); undefined als die onbekend is. */
  bronStart?: Dag | null;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const leeg = (): CampagneSom => ({ spend: 0, conversions: 0, impressions: 0, clicks: 0 });

/** Liep de campagne: kostte hij iets of leverde hij iets op? Alleen vertoningen is geen lopen. */
export function liep(a: CampagneSom | null | undefined): boolean {
  return !!a && (a.spend > 0 || a.conversions > 0);
}

/** Som per campagne. De naam is die van de laatste rij: een hernoemde campagne heet zoals nu. */
export function somPerCampagne(rijen: Iterable<CampagneRij>): CampagneAgg[] {
  const per = new Map<string, CampagneAgg & { laatst: string }>();
  for (const r of rijen) {
    const a = per.get(r.sleutel) ?? { sleutel: r.sleutel, naam: r.naam, laatst: r.date, ...leeg() };
    a.spend += n(r.spend);
    a.conversions += n(r.conversions);
    a.impressions += n(r.impressions);
    a.clicks += n(r.clicks);
    if (r.date >= a.laatst && r.naam) { a.naam = r.naam; a.laatst = r.date; }
    per.set(r.sleutel, a);
  }
  return [...per.values()]
    .map(({ laatst: _laatst, ...a }) => a)
    .sort((a, b) => b.spend - a.spend || a.naam.localeCompare(b.naam));
}

/** De som van een lijst campagnes. */
export function somVan(lijst: Iterable<CampagneSom>): CampagneSom {
  const t = leeg();
  for (const a of lijst) { t.spend += a.spend; t.conversions += a.conversions; t.impressions += a.impressions; t.clicks += a.clicks; }
  return t;
}

/**
 * Wat één kanaal over de periode telde, per campagne. Google splitst op zijn dagopslag; de andere
 * kanalen tellen per dag.
 */
export function telCampagnes(p: DagPeriode, bron: CampagneBron): CampagneTelling {
  const bronStart = bron.bronStart;
  if (bron.kanaal !== "google") {
    const campagnes = somPerCampagne(bron.dagen.filter((r) => dagIn(r.date.slice(0, 10), p)));
    return { kanaal: bron.kanaal, periode: p, campagnes, totaal: somVan(campagnes), korrel: "dag", exact: true, label: null, bronStart };
  }
  // Hele maanden: de maandrijen, zoals telGoogle en de kanaaltotalen (zie de kop).
  const heel = alsMaandPeriode(p);
  if (heel && bron.maanden) {
    const maanden = new Set(monthsIn(heel));
    const campagnes = somPerCampagne(bron.maanden.filter((r) => maanden.has(r.date.slice(0, 7))));
    return { kanaal: "google", periode: p, campagnes, totaal: somVan(campagnes), korrel: "maand", exact: true, label: null, bronStart };
  }
  const split = splitsOpDagOpslag(p, bron.eersteDag ?? null);
  const delen: CampagneRij[] = [];
  if (split.dagDeel) delen.push(...bron.dagen.filter((r) => dagIn(r.date.slice(0, 10), split.dagDeel!)));
  if (split.maanden) {
    const maanden = new Set(monthsIn(split.maanden));
    delen.push(...(bron.maanden ?? []).filter((r) => maanden.has(r.date.slice(0, 7))));
  }
  const campagnes = somPerCampagne(delen);
  const korrel: CampagneKorrel = !split.maanden ? "dag" : split.dagDeel ? "dag+maand" : "maand";
  return { kanaal: "google", periode: p, campagnes, totaal: somVan(campagnes), korrel, exact: !split.maandenRuimer, label: split.label, bronStart };
}

// ── De vergelijking per campagne ─────────────────────────────────────────────

export interface CampagneVerandering {
  /** (nu - toen) / toen, of null met een reden. */
  pct: number | null;
  reden: string | null;
}

export type CampagneStatus = "beide" | "nieuw" | "gestopt";

export interface CampagneRegel extends CampagneAgg {
  /** Null zonder vergelijkingsperiode, of als de gegevens een van beide periodes niet dekken (dan
   *  staat de reden in `kosten` en `conversies`). */
  status: CampagneStatus | null;
  /** De verandering in kosten en in conversies; null zonder vergelijking of bij nieuw/gestopt. */
  kosten: CampagneVerandering | null;
  conversies: CampagneVerandering | null;
}

export interface CampagneVergelijking {
  /** De regels van de tabel: elke campagne die nu liep, en met een vergelijking ook die alleen toen liep. */
  regels: CampagneRegel[];
  /** Waarom er bij geen enkele campagne een percentage staat, als dat aan de periodes ligt; anders null. */
  reden: string | null;
}

const KANAAL_NAAM: Record<CampagneKanaal, string> = { google: "Google Ads", meta: "Meta", linkedin: "LinkedIn", microsoft: "Microsoft Ads" };

/**
 * Begint een van beide periodes vóór de eerste campagnerij van de bron? Dan de korte reden voor in
 * de cel ("geen campagnegegevens vóór 11 okt 2025") en de zin voor boven de tabel; anders null.
 * Zonder enige rij (bronStart null) is er niets te vergelijken. Een onbekende start (undefined):
 * null, zoals voorheen.
 */
export function ongedekt(nu: CampagneTelling, toen: CampagneTelling): { kort: string; zin: string } | null {
  const start = nu.bronStart !== undefined ? nu.bronStart : toen.bronStart;
  if (start === undefined) return null;
  const naam = KANAAL_NAAM[nu.kanaal];
  if (start === null) {
    return { kort: "geen campagnegegevens", zin: `Geen verandering per campagne: ${naam} heeft geen campagnegegevens.` };
  }
  const welke = toen.periode.start < start ? "de vergelijkingsperiode" : nu.periode.start < start ? "deze periode" : null;
  if (!welke) return null;
  return {
    kort: `geen campagnegegevens vóór ${formatDag(start)}`,
    zin: `Geen verandering per campagne: ${naam} heeft geen campagnegegevens vóór ${formatDag(start)}, en ${welke} begint eerder. Of een campagne toen liep, is dus niet te zien; daarom ook geen "nieuw" of "gestopt".`,
  };
}

/** Waarom twee tellingen niet als verandering naast elkaar mogen, of null als het kan. */
export function ongelijkeKorrel(nu: CampagneTelling, toen: CampagneTelling): string | null {
  if (!nu.exact || !toen.exact) {
    return "Geen verandering per campagne: in een van beide periodes telde Google hele maanden in plaats van de gevraagde dagen, en dan gaat het percentage over meer dagen dan er staan.";
  }
  if (nu.korrel !== toen.korrel) {
    return `Geen verandering per campagne: de ene periode telt ${KORREL_WOORD[nu.korrel]}, de andere ${KORREL_WOORD[toen.korrel]}. Dat is geen vergelijking van gelijke dagen.`;
  }
  return null;
}

const KORREL_WOORD: Record<CampagneKorrel, string> = {
  dag: "per dag",
  "dag+maand": "deels per maand (vóór de dagopslag)",
  maand: "per maand",
};

function verandering(nu: number, toen: number): CampagneVerandering {
  if (toen === 0) return { pct: null, reden: "nul in de vergelijkingsperiode" };
  return { pct: (nu - toen) / toen, reden: null };
}

/**
 * De regels van de tabel, met de verandering per campagne waar die eerlijk is. `toen` null: geen
 * vergelijking gekozen (of er viel niets te vergelijken), dan alleen de campagnes die nu liepen.
 */
export function vergelijkCampagnes(nu: CampagneTelling, toen: CampagneTelling | null): CampagneVergelijking {
  const lopend = nu.campagnes.filter(liep);
  if (!toen) return { regels: lopend.map((a) => ({ ...a, status: null, kosten: null, conversies: null })), reden: null };
  // De gegevens dekken een van beide periodes niet: geen percentage, geen nieuw of gestopt, alleen
  // de campagnes die nu liepen, met de reden in de cel en boven de tabel.
  const gat = ongedekt(nu, toen);
  if (gat) {
    const geen = { pct: null, reden: gat.kort };
    return { regels: lopend.map((a) => ({ ...a, status: null, kosten: geen, conversies: geen })), reden: gat.zin };
  }
  const reden = ongelijkeKorrel(nu, toen);
  const toenPer = new Map(toen.campagnes.filter(liep).map((a) => [a.sleutel, a]));
  const regels: CampagneRegel[] = lopend.map((a) => {
    const t = toenPer.get(a.sleutel);
    if (!t) return { ...a, status: "nieuw", kosten: null, conversies: null };
    if (reden) {
      const geen = { pct: null, reden: "andere korrel in de vergelijkingsperiode" };
      return { ...a, status: "beide", kosten: geen, conversies: geen };
    }
    return { ...a, status: "beide", kosten: verandering(a.spend, t.spend), conversies: verandering(a.conversions, t.conversions) };
  });
  const nuSleutels = new Set(lopend.map((a) => a.sleutel));
  for (const t of toenPer.values()) {
    if (nuSleutels.has(t.sleutel)) continue;
    // Gestopt: toen liep hij, nu niet. Nu telt hij nul (of alleen vertoningen), en die waarden staan er.
    const nuAgg = nu.campagnes.find((a) => a.sleutel === t.sleutel);
    regels.push({ sleutel: t.sleutel, naam: nuAgg?.naam ?? t.naam, ...(nuAgg ? somVan([nuAgg]) : leeg()), status: "gestopt", kosten: null, conversies: null });
  }
  return { regels, reden };
}

/** "+12,4%" of "-3,0%", met een echt minteken. */
export function formatCampagneVerandering(pct: number): string {
  const tekst = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(pct) * 100);
  return `${pct >= 0 ? "+" : "−"}${tekst}%`;
}
