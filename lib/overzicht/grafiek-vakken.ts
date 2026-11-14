// De hoofdgrafiek over een periode per dag: vakken met een korrel die bij de lengte past.
//
// WAAROM. Op een dagperiode (Black Friday, 21 nov t/m 1 dec 2025) telden de kerncijfers, de trechter
// en de kaarten per dag, maar tekende de grafiek de hele maanden die de periode raken: "per maand:
// nov-dec 2025". Dan staan er onder elkaar twee getallen voor dezelfde periode, en de staven gingen
// over zes weken meer dan de tegels erboven.
//
// DE KORREL. Tot zes weken per dag, tot ongeveer zes maanden per week, daarboven per maand. Een week
// loopt van maandag t/m zondag (zoals de weekrijen van Google), een maand van de 1e t/m de laatste;
// het eerste en laatste vak worden afgekapt op de periode, en dat staat bij het vak (`afgekapt`).
// Nooit fijner dan Google hier kan tellen (googleKorrel): zonder dagrijen telt Google per week, en
// dan werd elke dag een gat. Op Black Friday waren dat alle elf vakken, en stond er "Geen data"
// boven tegels met 179 conversies. Telt Google de periode alleen per hele maand, dan geen vakken
// maar de maandweg (kiesKorrel geeft null), die zegt welke maanden.
//
// GEEN TWEEDE REKENWEG. Elk vak is een eigen dagperiode door telDagPeriode (lib/period/dag-telling.ts),
// met precies de invoer van de kerncijfers (useDagTelling). Dus dezelfde conversieselectie, dezelfde
// start per kanaal en dezelfde terugval van Google. Bij dagen tellen de vakken samen op tot de
// kerncijfers, want dagen zijn optelbaar.
//
// EEN GAT, GEEN NUL. Een kanaal krijgt in een vak geen staaf als:
// - het in dat vak nog niet liep (nogNietGelopen, de regel van de trechter): `voorStart`;
// - er in dat vak niets te tellen viel (geen rijen, of na de laatste rij): `geenData`;
// - het dat vak niet op deze korrel kon tellen (Google vóór zijn dagopslag telt per hele maand of
//   week, en zo'n maand of week valt buiten het vak): `grof`. Een maand naar rato over de dagen
//   verdelen doen we niet (zie de kop van dag-telling.ts). Het totaal van de periode telt hem wel
//   mee; de grafiek zegt dat in zijn voetregel.

import { maandagVanWeek } from "@/lib/api/google-weekvensters";
import { addDays } from "@/lib/reporting-date";
import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { eersteWeekRij, nogNietGelopen, telDagPeriode, type DagTelInvoer, type KanaalTelling } from "@/lib/period/dag-telling";
import { splitsOpDagOpslag } from "@/lib/period/dag-opslag";
import { aantalDagen, alsMaandPeriode, type Dag, formatDag, formatDagPeriode, laatsteDagVanMaand, omhullendeMaanden, type DagPeriode } from "@/lib/period/dag-periode";
import { heeftData, type Totalen } from "@/lib/period/apply-period";
import { formatMonth, monthsIn } from "@/lib/period/period-range";
import type { GrafiekMaand } from "./bovenkant";

export type Korrel = "dag" | "week" | "maand";

/** T/m zes weken telt de grafiek per dag. */
export const DAG_KORREL_TOT_DAGEN = 42;
/** T/m ongeveer zes maanden per week; daarboven per maand. */
export const WEEK_KORREL_TOT_DAGEN = 184;

/**
 * De korrel naar de lengte, maar nooit fijner dan Google kan (`google`, uit googleKorrel): per week
 * als Google per week telt, en null (de maandweg) als Google alleen per hele maand telt en de lengte
 * om dagen of weken vraagt.
 */
export function kiesKorrel(p: DagPeriode, google: Korrel | null = null): Korrel | null {
  const n = aantalDagen(p);
  const lengte: Korrel = n <= DAG_KORREL_TOT_DAGEN ? "dag" : n <= WEEK_KORREL_TOT_DAGEN ? "week" : "maand";
  if (google === "maand") return lengte === "maand" ? "maand" : null;
  if (google === "week" && lengte === "dag") return "week";
  return lengte;
}

/**
 * Hoe fijn Google over deze periode kan tellen, en vanaf welke dag: met dagrijen per dag, zonder
 * per week, en het deel vóór de eerste dag- of weekrij per hele maand (dezelfde splitsing als de
 * kerncijfers, splitsOpDagOpslag). Telt niets van de periode fijner dan een maand: "maand", vanaf
 * null. Null zonder Google.
 */
export function googleKorrel(p: DagPeriode, google: DagTelInvoer["google"]): { korrel: Korrel; vanaf: Dag | null } | null {
  if (!google) return null;
  const dagen = (google.dagen ?? []).map((r) => String(r.date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  // Zoals telGoogle: met dagrijen nooit de weekrijen.
  const grens = dagen.length ? { korrel: "dag" as const, eerste: dagen[0] } : google.weken ? { korrel: "week" as const, eerste: eersteWeekRij(google.weken) } : null;
  if (!grens?.eerste) return { korrel: "maand", vanaf: null };
  const vanaf = splitsOpDagOpslag(p, grens.eerste).dagDeel?.start ?? null;
  return vanaf ? { korrel: grens.korrel, vanaf } : { korrel: "maand", vanaf: null };
}

export interface Vak {
  periode: DagPeriode;
  /** Een week of maand die de periode maar voor een deel raakt: alleen dat deel telt. */
  afgekapt: boolean;
}

/** De vakken van een periode op een korrel, van oud naar nieuw, samen precies de periode. */
export function vakkenVan(p: DagPeriode, korrel: Korrel): Vak[] {
  const uit: Vak[] = [];
  const knip = (start: string, eind: string): Vak => {
    const periode = { start: start < p.start ? p.start : start, eind: eind > p.eind ? p.eind : eind };
    return { periode, afgekapt: periode.start !== start || periode.eind !== eind };
  };
  if (korrel === "dag") {
    for (let d = p.start; d <= p.eind; d = addDays(d, 1)) uit.push({ periode: { start: d, eind: d }, afgekapt: false });
  } else if (korrel === "week") {
    for (let m = maandagVanWeek(p.start); m <= p.eind; m = addDays(m, 7)) uit.push(knip(m, addDays(m, 6)));
  } else {
    for (const m of monthsIn(omhullendeMaanden(p))) uit.push(knip(`${m}-01`, laatsteDagVanMaand(m)));
  }
  return uit;
}

const KORT_MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const kortDag = (d: string) => `${Number(d.slice(8, 10))} ${KORT_MAAND[Number(d.slice(5, 7)) - 1]}`;

/** Het label op de as: "21 nov" voor een dag of een week (zijn eerste getelde dag), "nov '25" voor een maand. */
export function vakAsLabel(vak: Vak, korrel: Korrel): string {
  if (korrel === "maand") return `${KORT_MAAND[Number(vak.periode.start.slice(5, 7)) - 1]} '${vak.periode.start.slice(2, 4)}`;
  return kortDag(vak.periode.start);
}

/** Het label voluit, voor de tooltip en de tabel: welke dagen het vak telt, en of het afgekapt is. */
export function vakLabel(vak: Vak, korrel: Korrel): string {
  if (korrel === "dag") return formatDag(vak.periode.start);
  if (korrel === "maand" && !vak.afgekapt) return formatMonth(vak.periode.start.slice(0, 7), true);
  const wat = korrel === "week" ? "week" : "maand";
  return `${formatDagPeriode(vak.periode)}${vak.afgekapt ? ` (deel van de ${wat})` : ""}`;
}

/** Eén vak van de hoofdgrafiek. `maand` is hier de eerste dag van het vak: de sleutel op de as. */
export interface GrafiekVak extends GrafiekMaand {
  periode: DagPeriode;
  afgekapt: boolean;
  /** Kanalen zonder rijen in dit vak (ook: na hun laatste rij). Geen nul: een gat. */
  geenData: Kanaal[];
  /** Kanalen die dit vak niet op deze korrel konden tellen (Google per maand of week). Een gat. */
  grof: Kanaal[];
}

/** Alle kanalen met een gat in dit vak, om welke reden ook. */
export function gatenIn(r: GrafiekMaand | GrafiekVak): Kanaal[] {
  return "grof" in r ? [...r.voorStart, ...r.geenData, ...r.grof] : r.voorStart;
}

/**
 * De vakken van de periode met per vak de getoonde kanalen, geteld zoals de kerncijfers tellen.
 * `invoer` is de invoer van de kerncijfers voor de getoonde kanalen (useDagTelling).
 */
export function grafiekVakken(p: DagPeriode, korrel: Korrel, invoer: DagTelInvoer, getoond: readonly Kanaal[]): GrafiekVak[] {
  const lijst = ALLE_KANALEN.filter((k) => getoond.includes(k));
  // Waar Google over de HELE periode fijn begint te tellen. Een vak daarvóór telt in de kerncijfers
  // in een hele maand mee, ook als het vak zelf op of na de eerste dagrij begint (een dagopslag die
  // op 28 nov begint: de kern telt heel november per maand). Zulke vakken zijn een gat, anders
  // stonden die dagen in de tegel via de maand en ernaast nog eens als staaf.
  const googleVanaf = googleKorrel(p, invoer.google)?.vanaf ?? null;
  return vakkenVan(p, korrel).map(({ periode, afgekapt }) => {
    const telling = telDagPeriode(periode, invoer);
    const rij: GrafiekVak = {
      maand: periode.start, periode, afgekapt, perKanaal: {}, conversions: 0, adSpend: 0, revenue: 0, cpa: null, leeg: true,
      voorStart: [], geenData: [], grof: [],
    };
    for (const kanaal of lijst) {
      const t = telling.perKanaal.find((x) => x.kanaal === kanaal) ?? null;
      const nul: Totalen = { conversions: 0, revenue: 0, adSpend: 0 };
      rij.perKanaal[kanaal] = nul;
      if (!t) { rij.geenData.push(kanaal); continue; }
      if (nogNietGelopen(t)) { rij.voorStart.push(kanaal); continue; }
      if (!t.geteld) { rij.geenData.push(kanaal); continue; }
      const voorFijn = kanaal === "google" && googleVanaf !== null && periode.start < googleVanaf;
      if (voorFijn || t.exact === false || t.geteld.start < periode.start || t.geteld.eind > periode.eind) { rij.grof.push(kanaal); continue; }
      rij.perKanaal[kanaal] = { ...t.totalen };
      rij.conversions += t.totalen.conversions;
      rij.adSpend += t.totalen.adSpend;
      rij.revenue += t.totalen.revenue;
      if (heeftData(t.totalen)) rij.leeg = false;
    }
    rij.cpa = rij.conversions > 0 ? rij.adSpend / rij.conversions : null;
    return rij;
  });
}

const KORREL_TEKST: Record<Korrel, string> = { dag: "per dag", week: "per week", maand: "per maand" };

/**
 * De vergelijkingsperiode naast de gekozen: vak voor vak, maar alleen als de korrel aan beide kanten
 * gelijk is en elk vak even veel dagen telt. Anders geen tweede lijn, en de reden in een zin: een
 * week van drie dagen naast een volle week, of dagen naast weken, leest als een daling die er niet is.
 * `vorig.korrel` null: de vergelijkingsperiode kan alleen per hele maand (kiesKorrel).
 *
 * Een punt alleen waar de twee vakken over dezelfde kanalen gaan (vergelijkWaarde). Komt er zo geen
 * enkel punt uit, dan ook geen lijn: een legenda en een kolom "Vergelijking" zonder één waarde
 * zeggen niets. Valt er een deel weg, dan blijft de lijn en zegt de reden welk kanaal het gat maakt.
 */
export function vergelijkVakken(
  huidig: { korrel: Korrel; vakken: readonly GrafiekVak[] },
  vorig: { korrel: Korrel | null; vakken: readonly GrafiekVak[] },
): { vorig: GrafiekVak[] | null; reden: string | null } {
  if (vorig.korrel === null) {
    return { vorig: null, reden: `Geen vergelijkingslijn: ${KANAAL_NAAM.google} telt de vergelijkingsperiode alleen per hele maand.` };
  }
  if (huidig.korrel !== vorig.korrel) {
    return { vorig: null, reden: `Geen vergelijkingslijn: de gekozen periode telt ${KORREL_TEKST[huidig.korrel]}, de vergelijkingsperiode ${KORREL_TEKST[vorig.korrel]}.` };
  }
  const lengtes = (v: readonly GrafiekVak[]) => v.map((x) => aantalDagen(x.periode)).join(",");
  if (lengtes(huidig.vakken) !== lengtes(vorig.vakken)) {
    return {
      vorig: null,
      reden: huidig.korrel === "dag"
        ? "Geen vergelijkingslijn: de vergelijkingsperiode telt een ander aantal dagen."
        : `Geen vergelijkingslijn: de ${huidig.korrel === "week" ? "weken" : "maanden"} vallen in de vergelijkingsperiode anders, dus vak voor vak zijn het niet even veel dagen.`,
    };
  }
  // Welke kanalen aan één kant een gat hebben, en in hoeveel vakken er daardoor geen punt is.
  const anders = new Set<Kanaal>();
  let zonderPunt = 0;
  huidig.vakken.forEach((h, i) => {
    const a = gatenIn(h), b = gatenIn(vorig.vakken[i]);
    const verschil = [...a.filter((k) => !b.includes(k)), ...b.filter((k) => !a.includes(k))];
    verschil.forEach((k) => anders.add(k));
    if (verschil.length) zonderPunt += 1;
  });
  if (!zonderPunt) return { vorig: [...vorig.vakken], reden: null };
  const lijst = ALLE_KANALEN.filter((k) => anders.has(k)).map((k) => KANAAL_NAAM[k]);
  const namen = lijst.length > 1 ? `${lijst.slice(0, -1).join(", ")} en ${lijst[lijst.length - 1]}` : lijst[0];
  const waarom = `${namen} ${lijst.length > 1 ? "tellen" : "telt"} aan één kant niet (liep nog niet, geen data, of niet ${KORREL_TEKST[huidig.korrel]} geteld), en dan is het verschil een kanaal, geen verandering.`;
  return zonderPunt === huidig.vakken.length
    ? { vorig: null, reden: `Geen vergelijkingslijn: ${waarom}` }
    : { vorig: [...vorig.vakken], reden: `De vergelijkingslijn heeft in ${zonderPunt} van de ${huidig.vakken.length} vakken geen punt: ${waarom}` };
}

/**
 * De waarde van de vergelijkingslijn in vak i: het totaal van de getoonde maat in het gepaarde vak,
 * of null als de twee vakken niet over dezelfde kanalen gaan (een kanaal met een gat aan de ene kant
 * en niet aan de andere): dan is het verschil een kanaal, geen verandering.
 */
export function vergelijkWaarde(huidig: GrafiekVak, vorig: GrafiekVak | undefined, maat: "conversions" | "adSpend"): number | null {
  if (!vorig) return null;
  const a = [...gatenIn(huidig)].sort().join(",");
  const b = [...gatenIn(vorig)].sort().join(",");
  return a === b ? vorig[maat] : null;
}

/**
 * De hoofdgrafiek bij een periode per dag, in één keer: de korrel, de vakken en de vergelijking. Null:
 * Google telt deze periode alleen per hele maand, dan de maandweg (grafiekMaanden).
 * `c` is de vergelijkingsperiode, of null zonder vergelijking.
 */
export function dagGrafiek(p: DagPeriode, c: DagPeriode | null, invoer: DagTelInvoer, getoond: readonly Kanaal[]): {
  korrel: Korrel; vakken: GrafiekVak[]; vergelijking: { vorig: GrafiekVak[] | null; reden: string | null } | null;
} | null {
  const korrel = kiesKorrel(p, googleKorrel(p, invoer.google)?.korrel ?? null);
  if (!korrel) return null;
  const vakken = grafiekVakken(p, korrel, invoer, getoond);
  if (!c) return { korrel, vakken, vergelijking: null };
  const cKorrel = kiesKorrel(c, googleKorrel(c, invoer.google)?.korrel ?? null);
  const vergelijking = vergelijkVakken({ korrel, vakken }, { korrel: cKorrel, vakken: cKorrel ? grafiekVakken(c, cKorrel, invoer, getoond) : [] });
  return { korrel, vakken, vergelijking };
}

const GOOGLE_FIJN: Record<KanaalTelling["fijnheid"], string | null> = {
  dag: null, week: "per week", maand: "per maand", "dag+maand": "deels per maand", "week+maand": "per week en maand",
};

/**
 * Het voorbehoud bij het venster als Google de periode niet helemaal per dag telt: kort voor het
 * label, voluit voor de uitleg en de voetregel. Op de fijnheid, niet alleen op `venster`: Google
 * per week (telGoogleWeken) zet geen venster, en dan zei het label zonder voorbehoud "per dag".
 */
export function googleVoorbehoud(google: KanaalTelling | null | undefined): { kort: string; uitleg: string } | null {
  const fijn = google ? GOOGLE_FIJN[google.fijnheid] : null;
  // Hele maanden per maand (het bestaande pad van telGoogle) is exact: geen voorbehoud.
  if (!google || !fijn || (google.fijnheid === "maand" && alsMaandPeriode(google.gevraagd))) return null;
  const naam = KANAAL_NAAM.google;
  const uitleg = google.venster ? `${naam}: ${google.venster}.`
    : google.uitleg ?? `${naam} telt deze periode ${fijn}, niet per dag.`;
  return { kort: `Google ${fijn}`, uitleg };
}

/** De voetregel voor de kanalen die (een deel van) de vakken niet op deze korrel konden tellen. */
export function grofRegel(vakken: readonly GrafiekVak[], korrel: Korrel): string | null {
  const kanalen = ALLE_KANALEN.filter((k) => vakken.some((v) => v.grof.includes(k)));
  if (!kanalen.length) return null;
  return kanalen.map((k) => {
    const n = vakken.filter((v) => v.grof.includes(k)).length;
    return `${KANAAL_NAAM[k]} telt ${n === vakken.length ? "deze periode" : `${n} van de ${vakken.length} vakken`} niet ${KORREL_TEKST[korrel]} (alleen per hele maand of week, en die valt buiten het vak): daar staat geen staaf. Het totaal rechts telt hem wel mee.`;
  }).join(" ");
}
