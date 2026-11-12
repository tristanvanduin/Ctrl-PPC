// Twee lezingen van dezelfde maand naast elkaar: de hoofdgrafiek en de kanaaltabel (bouwplan
// fase 5 en 6). Zuiver, geen IO.
//
// WAAROM DIT BESTAAT. In de nieuwe weergave verving de stand "Kosten" van de hoofdgrafiek de kaart
// "Spend per kanaal per maand". Dezelfde as en dezelfde maanden, maar niet dezelfde telling: de
// grafiek staat op de reeksen van de KPI-band (lib/use-channel-period-data.ts), en daarin komt
// Google uit de Google-route, die live bij Google leest. De kanaaltabel en de ring lezen de
// blended route, en daar komt Google uit de gesynchroniseerde database. Staat die sync stil (bij
// een groot deel van de klanten sinds half april), dan toont de grafiek bedragen die de tabel
// eronder niet kent, terwijl de kop van de tabel "de cijfers achter de grafiek" beloofde.
//
// De grafiek blijft op de reeksen van de band: hij hoort op te tellen tot de tegel "Kosten" direct
// erboven, en die leest dezelfde bron. In plaats van één van de twee stil te verleggen, zegt de
// tabel het: per kanaal de maanden waarin de twee lezingen uiteenlopen, met beide bedragen. Lopen
// ze gelijk (de demo, of een klant waarvan de sync bij is), dan staat er niets.
//
// De drie dagkanalen kunnen hier niet uiteenlopen: band en tabel lezen voor Meta, LinkedIn en
// Microsoft dezelfde reeks uit dezelfde route. De vergelijking loopt toch over elk kanaal dat
// beide kanten kennen, zodat een toekomstig verschil niet stil blijft.

import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { channelKeyVanKanaal, type KanaalMaandRij } from "@/lib/cross-channel/kanaal-maandrijen";
import { formatMonth, type Month } from "@/lib/period/period-range";
import type { GrafiekMaand } from "./bovenkant";

/** Onder dit verschil in euro's zijn twee maandbedragen hetzelfde: afronding, geen andere bron. */
export const BRONVERSCHIL_VANAF_EURO = 1;
/** En onder dit aandeel van het grootste van de twee ook: een halve procent is geen andere telling. */
export const BRONVERSCHIL_VANAF_AANDEEL = 0.005;

export interface BronVerschilMaand {
  maand: Month;
  /** De kosten van dit kanaal in deze maand zoals de hoofdgrafiek ze tekent. */
  grafiek: number;
  /** En zoals de kanaaltabel ze telt; 0 als de tabel voor deze maand geen rij heeft. */
  tabel: number;
}

export interface BronVerschil {
  kanaal: Kanaal;
  /** Hoeveel maanden van de periode voor dit kanaal vergeleken zijn. */
  maanden: number;
  /** De maanden waarin de twee lezingen uiteenlopen, oudste eerst. */
  afwijkend: BronVerschilMaand[];
  /** De som over de hele periode, aan beide kanten. */
  grafiekTotaal: number;
  tabelTotaal: number;
}

const wijktAf = (a: number, b: number): boolean => {
  const verschil = Math.abs(a - b);
  return verschil > BRONVERSCHIL_VANAF_EURO && verschil > Math.max(Math.abs(a), Math.abs(b)) * BRONVERSCHIL_VANAF_AANDEEL;
};

/**
 * Per kanaal: lopen de maandkosten in de hoofdgrafiek en in de kanaaltabel gelijk?
 *
 * @param grafiek De maanden van de gekozen periode zoals de grafiek ze tekent (grafiekMaanden).
 * @param tabel De rijen van dezelfde periode zoals de tabel ze telt (rijenInPeriode over
 *   kanaalMaandRijen).
 * @returns Alleen de kanalen met minstens één afwijkende maand. Een lege lijst: de twee blokken
 *   tonen dezelfde bedragen.
 */
export function kostenBronVerschil(grafiek: readonly GrafiekMaand[], tabel: readonly KanaalMaandRij[]): BronVerschil[] {
  const uit: BronVerschil[] = [];
  for (const kanaal of ALLE_KANALEN) {
    // Alleen een kanaal dat de grafiek kent: een kanaal dat alleen in de tabel staat, staat ook
    // niet in de grafiek, en dan valt er niets naast elkaar te leggen.
    if (!grafiek.some((m) => m.perKanaal[kanaal] !== undefined)) continue;
    const sleutel = channelKeyVanKanaal(kanaal);
    const perMaand = new Map<string, number>();
    for (const r of tabel) {
      if (r.channel !== sleutel) continue;
      const maand = r.month.slice(0, 7);
      perMaand.set(maand, (perMaand.get(maand) ?? 0) + (r.spend ?? 0));
    }
    const afwijkend: BronVerschilMaand[] = [];
    let grafiekTotaal = 0, tabelTotaal = 0;
    for (const m of grafiek) {
      // Een maand voor de start van het kanaal is aan geen van beide kanten gemeten.
      if (m.voorStart.includes(kanaal) && !perMaand.has(m.maand)) continue;
      const g = m.perKanaal[kanaal]?.adSpend ?? 0;
      const t = perMaand.get(m.maand) ?? 0;
      grafiekTotaal += g;
      tabelTotaal += t;
      if (wijktAf(g, t)) afwijkend.push({ maand: m.maand, grafiek: g, tabel: t });
    }
    if (afwijkend.length > 0) uit.push({ kanaal, maanden: grafiek.length, afwijkend, grafiekTotaal, tabelTotaal });
  }
  return uit;
}

const euro = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

/**
 * Het verschil in één zin per kanaal, voor de kop van de kanaaltabel. Noemt welke blokken welke
 * lezing tonen, in hoeveel maanden het uiteenloopt en beide totalen: wie de twee bedragen ziet,
 * weet welk bij welk blok hoort.
 */
export function bronVerschilZin(v: BronVerschil): string {
  const naam = KANAAL_NAAM[v.kanaal];
  const eerste = v.afwijkend[0], laatste = v.afwijkend[v.afwijkend.length - 1];
  const welke = v.afwijkend.length === 1 ? `in ${formatMonth(eerste.maand)}`
    : `in ${v.afwijkend.length} van de ${v.maanden} maanden (${formatMonth(eerste.maand)} t/m ${formatMonth(laatste.maand)})`;
  // Google is het kanaal waar de reden bekend is; bij een ander kanaal alleen het feit.
  const reden = v.kanaal === "google"
    ? "De tegels en de grafiek bovenaan lezen Google Ads live bij Google; de ring en deze tabel lezen de gesynchroniseerde database."
    : `De tegels en de grafiek bovenaan lezen ${naam} uit een andere lezing dan de ring en deze tabel.`;
  return `${reden} De kosten lopen uiteen ${welke}: ${euro(v.grafiekTotaal)} bovenaan tegen ${euro(v.tabelTotaal)} hier, over de gekozen periode.`;
}
