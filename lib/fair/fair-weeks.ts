// Weken tot de beurs: de tijdas waarop een beursorganisatie daadwerkelijk stuurt.
//
// Het dashboard toonde "vorige, huidige en volgende maand". Voor een beursorganisatie zegt dat
// niets: een maand is geen mijlpaal, de beursdag wel. Wat telt is "we zitten nog veertien weken
// voor GreenTech" — dat bepaalt of een campagne op tijd loopt, niet of het april of mei is.
//
// Dit bestand zet de bestaande weekpunten uit de forecast (kalenderweken van het lopende jaar)
// om naar weken-tot-beurs, en leidt af welke editie de eerstvolgende is. IO-vrij en los getest;
// het component leest alleen uit.

import type { WeeklyPoint } from "@/lib/forecast";
import { MONTH_LABELS } from "@/lib/forecast";
import type { Cadence, Edition } from "./geo-clone-settings";

const DAG_MS = 86400000;

function parseISO(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Zoals de beurzen in client_settings.rai_events staan (migratie 024). */
export interface FairEventCfg {
  id?: string;
  name?: string;
  abbrev?: string;
  cadence?: Cadence | null;
  editions?: Edition[] | null;
}

export interface UpcomingEdition {
  eventId: string;
  eventName: string;
  abbrev: string;
  /** De eerstvolgende beursdag (ISO). */
  fairDate: string;
  label: string;
  /**
   * True als deze datum niet in de instellingen staat maar is doorgerekend uit de cadans.
   * De UI moet dat tonen: een geschatte beursdag verdient geen harde deadline-taal.
   */
  afgeleid: boolean;
  /** De editie ervoor, als ijkpunt voor de vergelijking. Null bij een eerste editie. */
  previousFairDate: string | null;
  previousLabel: string | null;
}

/** Hoeveel jaar zit er tussen twee edities bij deze cadans? Null = niet door te rekenen. */
function cadansStapJaren(cadence: Cadence | null | undefined): number | null {
  if (cadence === "annual") return 1;
  if (cadence === "biennial") return 2;
  // "custom" of niets ingevuld: we weten de afstand niet en verzinnen hem niet.
  return null;
}

/** Dezelfde dag-en-maand, n jaar later. */
function plusJaren(iso: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]) + n, Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : toISO(t);
}

// Meer dan dit aantal stappen vooruit rekenen is geen schatting meer maar een gok; bovendien
// beschermt het tegen een eindeloze lus bij onzinnige invoer.
const MAX_CADANS_STAPPEN = 20;

function eerstvolgendeVoorEvent(event: FairEventCfg, vandaag: string): UpcomingEdition | null {
  const nu = parseISO(vandaag);
  if (nu == null) return null;

  const edities = (event.editions ?? [])
    .filter((e): e is Edition => Boolean(e?.date) && parseISO(e.date) != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (edities.length === 0) return null;

  const eventId = event.id ?? event.abbrev ?? event.name ?? "event";
  const eventName = (event.name ?? event.abbrev ?? "beurs").trim();
  const abbrev = (event.abbrev ?? "").trim().toUpperCase();

  const toekomstIdx = edities.findIndex((e) => parseISO(e.date)! >= nu);
  if (toekomstIdx >= 0) {
    const ed = edities[toekomstIdx];
    const vorige = toekomstIdx > 0 ? edities[toekomstIdx - 1] : null;
    return {
      eventId, eventName, abbrev,
      fairDate: ed.date,
      label: ed.label?.trim() || ed.date.slice(0, 4),
      afgeleid: false,
      previousFairDate: vorige?.date ?? null,
      previousLabel: vorige ? (vorige.label?.trim() || vorige.date.slice(0, 4)) : null,
    };
  }

  // Alle edities liggen achter ons. Uit de cadans is de volgende door te rekenen; zonder
  // cadans niet, en dan zeggen we dat liever dan een datum te verzinnen.
  const stap = cadansStapJaren(event.cadence);
  const laatste = edities[edities.length - 1];
  if (stap == null) return null;

  let kandidaat = laatste.date;
  for (let i = 0; i < MAX_CADANS_STAPPEN; i++) {
    const volgende = plusJaren(kandidaat, stap);
    if (volgende == null) return null;
    kandidaat = volgende;
    const t = parseISO(kandidaat);
    if (t != null && t >= nu) {
      return {
        eventId, eventName, abbrev,
        fairDate: kandidaat,
        label: kandidaat.slice(0, 4),
        afgeleid: true,
        previousFairDate: laatste.date,
        previousLabel: laatste.label?.trim() || laatste.date.slice(0, 4),
      };
    }
  }
  return null;
}

/**
 * De eerstvolgende beurs over alle geconfigureerde events heen: die met de vroegste datum die
 * nog niet geweest is. Null als de klant geen beurzen heeft, of alleen beurzen waarvan de
 * volgende editie niet te bepalen valt.
 */
export function selectUpcomingEdition(events: FairEventCfg[], vandaag: string): UpcomingEdition | null {
  let beste: UpcomingEdition | null = null;
  for (const ev of events) {
    const kandidaat = eerstvolgendeVoorEvent(ev, vandaag);
    if (!kandidaat) continue;
    if (!beste || kandidaat.fairDate < beste.fairDate) beste = kandidaat;
  }
  return beste;
}

/**
 * Hele weken tot de beursdag. 0 = de week waarin de beurs valt, negatief = erna.
 * Zeven dagen ervoor is dus 1 week, dertien dagen ook — pas op veertien dagen wordt het 2.
 */
export function weeksToFair(fairDate: string, date: string): number | null {
  const f = parseISO(fairDate);
  const d = parseISO(date);
  if (f == null || d == null) return null;
  return Math.floor((f - d) / DAG_MS / 7);
}

/** Het korte label voor de tijdas: W-14 loopt naar de beurs toe, W+2 ligt erachter. */
export function fairWeekLabel(weeksOut: number): string {
  if (weeksOut > 0) return `W-${weeksOut}`;
  if (weeksOut === 0) return "beurs";
  return `W+${-weeksOut}`;
}

/**
 * De n-de maandag van een maand (1-based). De weekemmers in de data zijn gebouwd uit
 * ads_account_weekly, waar week_start altijd een maandag is en de emmers per maand genummerd
 * worden in volgorde van startdatum — de n-de emmer is dus de n-de maandag.
 *
 * Vraagt de aanroeper om een maandag die niet in de maand past (synthetische data verzint soms
 * vijf weken in een maand met vier maandagen), dan rolt de datum door naar de maand erna in
 * plaats van te verdwijnen. De chronologie klopt dan nog; toFairWeeks vangt de dubbeling af.
 */
export function nthMondayOfMonth(year: number, month: number, n: number): string | null {
  if (!Number.isFinite(year) || month < 1 || month > 12 || n < 1) return null;
  const eersteVanDeMaand = Date.UTC(year, month - 1, 1);
  const dow = new Date(eersteVanDeMaand).getUTCDay(); // 0 = zondag
  const naarMaandag = (8 - dow) % 7;
  return toISO(eersteVanDeMaand + (naarMaandag + (n - 1) * 7) * DAG_MS);
}

export interface FairWeek {
  /** Hele weken tot de beursdag; hoger = verder ervoor. */
  weeksOut: number;
  /** "W-14" */
  label: string;
  /** De maandag waarop deze week begint (ISO). */
  weekStart: string;
  /** "Jul" — houdt de kalender zichtbaar zonder er de as van te maken. */
  monthLabel: string;
  expected: number;
  realized: number | null;
  forecast: number | null;
}

/**
 * De weekpunten uit de forecast, uitgedrukt in weken tot de beurs en op datum gesorteerd
 * (vroegst eerst). Alleen weken waarvan de startdatum te bepalen is; dubbele startdata (zie
 * nthMondayOfMonth) tellen één keer mee, de eerste wint.
 */
export function toFairWeeks(points: WeeklyPoint[], year: number, fairDate: string): FairWeek[] {
  const gezien = new Set<string>();
  const weken: FairWeek[] = [];
  for (const p of points) {
    const weekStart = nthMondayOfMonth(year, p.month, p.week);
    if (weekStart == null || gezien.has(weekStart)) continue;
    const weeksOut = weeksToFair(fairDate, weekStart);
    if (weeksOut == null) continue;
    gezien.add(weekStart);
    weken.push({
      weeksOut,
      label: fairWeekLabel(weeksOut),
      weekStart,
      monthLabel: MONTH_LABELS[p.month - 1] ?? "",
      expected: p.expected,
      realized: p.realized,
      forecast: p.forecast,
    });
  }
  return weken.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * De index van de week waarin `vandaag` valt. Ligt vandaag vóór de eerste week, dan 0; erna,
 * dan de laatste. Zo houdt de weergave altijd een ankerpunt, ook als de data een ander jaar
 * beslaat dan de kalender.
 */
export function currentWeekIndex(weken: FairWeek[], vandaag: string): number {
  if (weken.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < weken.length; i++) {
    if (weken[i].weekStart <= vandaag) idx = i;
    else break;
  }
  return idx;
}
