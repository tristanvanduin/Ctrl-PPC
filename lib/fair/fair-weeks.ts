// Weken tot de beurs: de tijdas waarop een beursorganisatie daadwerkelijk stuurt.
//
// Het dashboard toonde "vorige, huidige en volgende maand". Voor een beursorganisatie zegt dat
// niets: een maand is geen mijlpaal, de beursdag wel. Wat telt is "we zitten nog veertien weken
// voor GreenTech" — dat bepaalt of een campagne op tijd loopt, niet of het april of mei is.
//
// Dit bestand zet de bestaande weekpunten uit de forecast op de kalenderweken van het lopende
// jaar en drukt ze uit in weken-tot-beurs, en leidt af over welke editie de pagina gaat (de
// aankomende, of de vorige zolang die nog in zijn nasleep zit). IO-vrij en los getest; het
// component leest alleen uit.

import type { WeeklyPoint } from "@/lib/forecast";
import { MONTH_LABELS } from "@/lib/forecast";
import type { Cadence, Edition } from "./geo-clone-settings";
import { daysToFair } from "./event-time-axis";
import { safeDiv } from "@/lib/util/math";

const DAG_MS = 86400000;

/** Hoeveel weken na de beurs de editie nog de actieve is (W+1 .. W+6). */
export const NASLEEP_WEKEN = 6;

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
  /**
   * Het conversiedoel voor ÉÉN editie van dit event. Alleen een event-eigen doel telt:
   * het jaardoel uit kpi_targets als event-doel gebruiken gaf vrijwel elke aanloop een
   * vals "MIST het doel" (sloop-audit 1 sep 2026).
   */
  conversionsTarget?: number | null;
}

export interface UpcomingEdition {
  eventId: string;
  eventName: string;
  abbrev: string;
  /**
   * De beursdag (ISO) van de editie waar de pagina over gaat. Uit selectUpcomingEdition altijd
   * vandaag of later; uit selectActiveEdition kan hij tijdens de nasleep ook achter ons liggen.
   */
  fairDate: string;
  label: string;
  /**
   * True als deze datum niet in de instellingen staat maar is doorgerekend uit de cadans.
   * De UI moet dat tonen: een geschatte beursdag verdient geen harde deadline-taal.
   */
  afgeleid: boolean;
  /**
   * De cadans van dit event. De periodekiezer waarschuwt alleen bij een JAARLIJKSE editie dat
   * "voorgaande periode" de aanloop met de nasleep vergelijkt; zonder dit veld kon het dashboard
   * dat niet weten en stond de waarschuwing nergens aan.
   */
  cadence: Cadence | null;
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

/** De geldige edities van een event, vroegst eerst. */
function geldigeEdities(event: FairEventCfg): Edition[] {
  return (event.editions ?? [])
    .filter((e): e is Edition => Boolean(e?.date) && parseISO(e.date) != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function editieLabel(e: Edition): string {
  return e.label?.trim() || e.date.slice(0, 4);
}

/**
 * Wat elke editie van dit event deelt. Op één plek, zodat de aankomende en de laatst gehouden
 * editie van hetzelfde event niet elk hun eigen id of afkorting afleiden.
 */
function eventKern(event: FairEventCfg): Pick<UpcomingEdition, "eventId" | "eventName" | "abbrev" | "cadence"> {
  return {
    eventId: event.id ?? event.abbrev ?? event.name ?? "event",
    eventName: (event.name ?? event.abbrev ?? "beurs").trim(),
    abbrev: (event.abbrev ?? "").trim().toUpperCase(),
    cadence: event.cadence ?? null,
  };
}

function eerstvolgendeVoorEvent(event: FairEventCfg, vandaag: string): UpcomingEdition | null {
  const nu = parseISO(vandaag);
  if (nu == null) return null;

  const edities = geldigeEdities(event);
  if (edities.length === 0) return null;

  const toekomstIdx = edities.findIndex((e) => parseISO(e.date)! >= nu);
  if (toekomstIdx >= 0) {
    const ed = edities[toekomstIdx];
    const vorige = toekomstIdx > 0 ? edities[toekomstIdx - 1] : null;
    return {
      ...eventKern(event),
      fairDate: ed.date,
      label: editieLabel(ed),
      afgeleid: false,
      previousFairDate: vorige?.date ?? null,
      previousLabel: vorige ? editieLabel(vorige) : null,
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
        ...eventKern(event),
        fairDate: kandidaat,
        label: kandidaat.slice(0, 4),
        afgeleid: true,
        previousFairDate: laatste.date,
        previousLabel: editieLabel(laatste),
      };
    }
  }
  return null;
}

/**
 * De laatst GEHOUDEN editie van een event (beursdag vóór vandaag): de laatste geconfigureerde,
 * of — als die de nieuwste geconfigureerde is en de cadans bekend — de laatste cadansdatum die
 * daarna nog vóór vandaag viel. Dat laatste is dezelfde doorrekening als in
 * eerstvolgendeVoorEvent, alleen de andere kant op gekeken: zonder hem zou een jaarlijkse beurs
 * met alleen de editie van vorig jaar in de instellingen nooit een nasleep hebben.
 */
function laatstGehoudenVoorEvent(event: FairEventCfg, vandaag: string): UpcomingEdition | null {
  const nu = parseISO(vandaag);
  if (nu == null) return null;

  const edities = geldigeEdities(event);
  const verleden = edities.filter((e) => parseISO(e.date)! < nu);
  if (verleden.length === 0) return null;

  const laatsteVerleden = verleden[verleden.length - 1];
  let gehouden = { date: laatsteVerleden.date, label: editieLabel(laatsteVerleden), afgeleid: false };
  let vorige: { date: string; label: string } | null = verleden.length > 1
    ? { date: verleden[verleden.length - 2].date, label: editieLabel(verleden[verleden.length - 2]) }
    : null;

  const stap = cadansStapJaren(event.cadence);
  if (stap != null && gehouden.date === edities[edities.length - 1].date) {
    for (let i = 0; i < MAX_CADANS_STAPPEN; i++) {
      const volgende = plusJaren(gehouden.date, stap);
      const t = volgende == null ? null : parseISO(volgende);
      if (volgende == null || t == null || t >= nu) break;
      vorige = { date: gehouden.date, label: gehouden.label };
      gehouden = { date: volgende, label: volgende.slice(0, 4), afgeleid: true };
    }
  }

  return {
    ...eventKern(event),
    fairDate: gehouden.date,
    label: gehouden.label,
    afgeleid: gehouden.afgeleid,
    previousFairDate: vorige?.date ?? null,
    previousLabel: vorige?.label ?? null,
  };
}

/**
 * De eerstvolgende beurs over alle geconfigureerde events heen: die met de vroegste datum die
 * nog niet geweest is. Null als de klant geen beurzen heeft, of alleen beurzen waarvan de
 * volgende editie niet te bepalen valt.
 *
 * Kent geen nasleep en geen gekozen beurs; de pagina leest selectActiveEdition, die deze als
 * terugval gebruikt.
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
 * De editie waar de pagina over gaat. Twee dingen die selectUpcomingEdition niet doet:
 *
 * 1. De NASLEEP. Een editie blijft de actieve tot en met W+nasleepWeken; pas daarna schuift de
 *    pagina door naar de volgende. selectUpcomingEdition liet hem de dag na de beurs vallen, en
 *    de pagina sprong van "beursweek" naar "nog 31 weken tot GreenTech Amsterdam".
 * 2. De GEKOZEN beurs. Met ?geo= / GeoCloneScope telt alleen het event met die afkorting (dezelfde
 *    vergelijking als de geo-clone-route). Zonder dat stond "Beurs: GreenTech Americas" in de hero
 *    naast een aftelling naar GreenTech North America. Is er voor de gekozen beurs geen event
 *    ingesteld, dan null: liever geen aftelling dan die van een andere beurs.
 */
export function selectActiveEdition(
  events: FairEventCfg[],
  vandaag: string,
  opts: { selectedGeo?: string | null; nasleepWeken?: number } = {},
): UpcomingEdition | null {
  const nasleep = opts.nasleepWeken ?? NASLEEP_WEKEN;
  const geo = opts.selectedGeo?.trim().toUpperCase() || null;
  const kandidaten = geo ? events.filter((e) => (e.abbrev ?? "").trim().toUpperCase() === geo) : events;
  if (kandidaten.length === 0) return null;

  let nasleepEditie: UpcomingEdition | null = null;
  for (const ev of kandidaten) {
    const gehouden = laatstGehoudenVoorEvent(ev, vandaag);
    if (!gehouden) continue;
    const w = weeksToFair(gehouden.fairDate, vandaag);
    if (w == null || w > 0 || -w > nasleep) continue;
    if (!nasleepEditie || gehouden.fairDate > nasleepEditie.fairDate) nasleepEditie = gehouden;
  }
  const komend = selectUpcomingEdition(kandidaten, vandaag);
  if (!nasleepEditie) return komend;
  if (!komend) return nasleepEditie;

  // Twee kandidaten (zonder gekozen beurs, of als één event twee edities binnen de nasleep
  // heeft): de dichtstbijzijnde in kalenderweken, bij gelijke afstand de komende. "De nasleep
  // wint altijd" klinkt logischer maar hield op 1 november de beursweek van GreenTech North
  // America (drie dagen later) van het scherm achter de W+6 van GreenTech Americas.
  const naAfloop = -(weeksToFair(nasleepEditie.fairDate, vandaag) ?? 0);
  const tot = weeksToFair(komend.fairDate, vandaag) ?? Number.MAX_SAFE_INTEGER;
  return naAfloop < tot ? nasleepEditie : komend;
}

/** De maandag van de week waarin `ms` valt (UTC-dagindex, dus zonder zomertijd). */
function maandagVan(ms: number): number {
  const dagNaMaandag = (new Date(ms).getUTCDay() + 6) % 7; // 0 = maandag ... 6 = zondag
  return ms - dagNaMaandag * DAG_MS;
}

/**
 * KALENDERweken tot de beursweek (maandag t/m zondag). 0 = de week waarin de beurs valt,
 * negatief = erna. Dit is dezelfde as als de weekstrook, die vanaf maandagen rekent; voor een
 * maandag is het precies wat de oude `floor(dagen / 7)` gaf, dus de strook verschuift niet.
 * Voor elke andere dag gaf die oude vorm een ander antwoord dan de strook: op zondag 1 november
 * zei de hero "0 weken" (beursweek) terwijl de strook dezelfde dag "W-1 · Deze week" noemde.
 */
export function weeksToFair(fairDate: string, date: string): number | null {
  const f = parseISO(fairDate);
  const d = parseISO(date);
  if (f == null || d == null) return null;
  return Math.round((maandagVan(f) - maandagVan(d)) / DAG_MS / 7);
}

export type BeursFase = "aanloop" | "beursweek" | "nasleep";

export interface FairCountdown {
  /** Kalenderdagen tot de eerste beursdag; negatief erna. */
  dagen: number;
  /** Kalenderweken tot de beursweek (zie weeksToFair). */
  weken: number;
  /** "W-3", "beurs", "W+2": hetzelfde label als de strook. */
  label: string;
  fase: BeursFase;
}

/**
 * DE aftelling. Elke plek die "nog N weken" toont leest deze, zodat hero, sectiekop, pacing-kop
 * en strook niet elk hun eigen rekensom maken — dat waren er twee, en ze verschilden op vier van
 * de zeven dagen van elke week. De dagen komen uit daysToFair, dezelfde teller als de
 * event-tijdas.
 */
export function fairCountdown(fairDate: string, vandaag: string): FairCountdown | null {
  const weken = weeksToFair(fairDate, vandaag);
  const dagen = daysToFair(fairDate, vandaag);
  if (weken == null || dagen == null) return null;
  const fase: BeursFase = weken > 0 ? "aanloop" : weken === 0 ? "beursweek" : "nasleep";
  return { dagen, weken, label: fairWeekLabel(weken), fase };
}

/**
 * De editie bij naam in een aftelregel: "GRN 2026". Het label is in de praktijk een jaartal
 * (editieLabel valt terug op het jaar), en alleen het label gaf "Nog 32 weken tot 2027", wat leest
 * als een afstand tot het jaar en niet tot de beurs. De afkorting houdt de regel kort; zonder
 * afkorting de eventnaam, en geen "GRN GRN 2026" als het label hem al bevat. De pacingkop en de
 * beurssectie lezen allebei deze, zodat ze dezelfde beurs noemen.
 */
export function editieNaam(edition: Pick<UpcomingEdition, "abbrev" | "eventName" | "label">): string {
  const kort = edition.abbrev || edition.eventName;
  return !kort || edition.label.includes(kort) ? edition.label : `${kort} ${edition.label}`;
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
 * Vraagt de aanroeper om een maandag die niet in de maand past, dan rolt de datum door naar de
 * maand erna in plaats van te verdwijnen. toFairWeeks vraagt daar niet meer om (hij vraagt per
 * maand alleen de maandagen die mondaysInMonth telt); mondaysInMonth leunt juist op dit doorrollen.
 */
export function nthMondayOfMonth(year: number, month: number, n: number): string | null {
  if (!Number.isFinite(year) || month < 1 || month > 12 || n < 1) return null;
  const eersteVanDeMaand = Date.UTC(year, month - 1, 1);
  const dow = new Date(eersteVanDeMaand).getUTCDay(); // 0 = zondag
  const naarMaandag = (8 - dow) % 7;
  return toISO(eersteVanDeMaand + (naarMaandag + (n - 1) * 7) * DAG_MS);
}

/** Hoeveel maandagen deze maand in dit jaar heeft: 4 of 5 (0 bij een onmogelijke maand). */
export function mondaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(year)) return 0;
  const vijfde = nthMondayOfMonth(year, month, 5);
  return vijfde != null && Number(vijfde.slice(5, 7)) === month ? 5 : 4;
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
  /** Gemeten met een teller maar zonder noemer (kosten zonder conversies): zie ForecastPoint.geenNoemer. */
  geenNoemer?: boolean;
  /** Idem voor een prognose (kosten verwacht, geen conversie verwacht): zie ForecastPoint.geenNoemerPrognose. */
  geenNoemerPrognose?: boolean;
}

/**
 * Een maandwaarde over n weken. Optelbaar (conversies, omzet): het maandtotaal blijft exact
 * staan, in hele getallen zoals de forecast ze levert — afgerond op de lopende som, zodat de
 * afrondingen elkaar opheffen in plaats van zich op te stapelen. Een verhouding (ROAS, CPA)
 * wordt niet verdeeld maar gemiddeld: een ROAS van 2,5 is in elke week 2,5. Dat gemiddelde is
 * alleen de terugval voor een aanroeper zonder tellers; met tellers rekent toFairWeeks de
 * verhouding van de maand zelf uit (zie maandVerhouding).
 */
function verdeelMaand(vals: number[], n: number, additief: boolean): number[] {
  const som = vals.reduce((s, v) => s + v, 0);
  if (!additief) {
    const gem = vals.length > 0 ? Math.round((som / vals.length) * 100) / 100 : 0;
    return Array.from({ length: n }, () => gem);
  }
  const uit: number[] = [];
  let vorigeCum = 0;
  for (let i = 1; i <= n; i++) {
    const cum = Math.round((som * i) / n);
    uit.push(cum - vorigeCum);
    vorigeCum = cum;
  }
  return uit;
}

/** De tellerreeks en noemerreeks waar een verhouding uit komt: omzet/kosten (ROAS), kosten/conversies (CPA). */
export interface VerhoudingReeksen {
  teller: WeeklyPoint[];
  noemer: WeeklyPoint[];
}

/**
 * De verhouding van één maand uit de som van zijn tellers en de som van zijn noemers.
 *
 * Het gemiddelde van de emmer-verhoudingen is hier fout, om twee redenen. Een korte emmer (29-31
 * op de dag-emmers van het kanaalpad) telt even zwaar als een hele week. En deriveForecast geeft
 * een emmer zonder conversies CPA 0 in plaats van "niet te berekenen": oktober met 0 conversies
 * op 29-31 werd (4 x 100 + 0) / 5 = 80 per week, terwijl de maand 110,71 kostte, en een CPA onder
 * de verwachting kleurt groen. Een noemer van nul geeft geen waarde (null), dezelfde regel als
 * deriveForecast voor een gerealiseerde maand, zodat de week niets anders zegt dan de maandkaart:
 * 0 / 0 is geen CPA van € 0.
 */
function maandVerhouding(r: VerhoudingReeksen, month: number): { expected: number; waarde: number | null; geenNoemer: boolean } {
  const som = (pts: WeeklyPoint[], v: (p: WeeklyPoint) => number) =>
    pts.reduce((s, p) => (p.month === month ? s + v(p) : s), 0);
  const deel = (a: number, b: number) => {
    const q = safeDiv(a, b);
    return q == null ? 0 : parseFloat(q.toFixed(2));
  };
  const waarde = (p: WeeklyPoint) => p.realized ?? p.forecast ?? 0;
  const noemer = som(r.noemer, waarde);
  const teller = som(r.teller, waarde);
  return {
    expected: deel(som(r.teller, (p) => p.expected), som(r.noemer, (p) => p.expected)),
    waarde: noemer > 0 ? deel(teller, noemer) : null,
    // Kosten in de maand en geen conversie: geen getal, wel een meting (deriveForecast).
    geenNoemer: noemer <= 0 && teller > 0,
  };
}

/**
 * De weekpunten uit de forecast op de KALENDER van `year`: per maand precies zoveel weken als die
 * maand maandagen heeft, op datum gesorteerd (vroegst eerst).
 *
 * De forecast levert per maand emmers (month, week), en het AANTAL emmers komt niet uit dit jaar:
 * het blended pad en de kanaalpaden nemen vijf emmers voor elke 31-dagenmaand, het Google-pad het
 * aantal van de meest recente historische maand, de demo-mock altijd vier. November 2026 heeft
 * vijf maandagen (2, 9, 16, 23, 30) maar kreeg vier emmers; de vijfde maandag werd dus nooit
 * gevraagd en W+4 (30 november, bij een beurs op 4 november) viel uit de strook. Omgekeerd kreeg
 * oktober vijf emmers bij vier maandagen; de vijfde rolde naar 2 november en won de ontdubbeling,
 * zodat de BEURSWEEK de waarde van oktobers laatste emmer toonde — op het kanaalpad zelfs als
 * "gerealiseerd" voor een week die nog moest komen.
 *
 * Passen de emmers (evenveel als maandagen), dan blijft emmer n de n-de maandag. Passen ze niet,
 * dan wordt de maand over zijn echte maandagen verdeeld (zie verdeelMaand); `additief: false`
 * voor ROAS en CPA, met `verhouding` de reeksen waar die uit komt: dan krijgt elke week van zo'n
 * maand de verhouding van de maand (maandVerhouding). Een herverdeelde week is alleen gerealiseerd
 * als de hele maand dat was: anders zou een toekomstige week het etiket "gerealiseerd" lenen van
 * een week die al voorbij is.
 */
export function toFairWeeks(
  points: WeeklyPoint[],
  year: number,
  fairDate: string,
  opts: { additief?: boolean; verhouding?: VerhoudingReeksen } = {},
): FairWeek[] {
  const additief = opts.additief ?? true;
  const verhouding = additief ? undefined : opts.verhouding;
  const perMaand = new Map<number, WeeklyPoint[]>();
  for (const p of points) {
    if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12) continue;
    const lijst = perMaand.get(p.month) ?? [];
    lijst.push(p);
    perMaand.set(p.month, lijst);
  }

  const weken: FairWeek[] = [];
  for (const [month, ruw] of perMaand) {
    const pts = [...ruw].sort((a, b) => a.week - b.week);
    const n = mondaysInMonth(year, month);
    if (n === 0) continue;
    const passend = pts.length === n;
    // Of de maand gerealiseerd, prognose of leeg is: met `verhouding` uit de noemerreeks van die
    // maand (kosten bij ROAS, conversies bij CPA), anders uit de reeks zelf. Een verhouding is
    // sinds deriveForecast ook null in een GEREALISEERDE emmer zonder noemer (0 / 0); las je de
    // status dan van de verhouding, dan werd een hele gerealiseerde maand "prognose" omdat één
    // emmer van drie dagen geen conversie had.
    const status = verhouding ? verhouding.noemer.filter((p) => p.month === month) : pts;
    const statusPts = status.length > 0 ? status : pts;
    const alleGerealiseerd = statusPts.every((p) => p.realized !== null);
    // Een maand in het verleden zonder rij (kanaal liep nog niet, of een gat) heeft in de forecast
    // realized EN forecast null. Herverdeeld werd dat "prognose 0" per week: een gemeten nul in
    // een maand waarin niets gemeten is. Dan blijft de week leeg, net als bij passende emmers.
    const geenWaarde = statusPts.every((p) => p.realized === null && p.forecast === null);
    // Alleen het getal komt uit de maandtellers.
    const maand = passend || !verhouding ? null : maandVerhouding(verhouding, month);
    const elkeWeek = <T,>(v: T) => Array.from({ length: n }, () => v);
    const expected = passend ? null : maand ? elkeWeek(maand.expected) : verdeelMaand(pts.map((q) => q.expected), n, additief);
    // Zonder noemer geen waarde (een streepje), zoals de maandkaart; gerealiseerd met alleen een
    // teller krijgt de vlag. Een prognose zonder noemer ook geen waarde: deriveForecast geeft daar
    // sinds de stopregel (nul kosten op nul conversies) null, geen CPA van € 0.
    const realized = passend || !alleGerealiseerd
      ? null
      : maand ? elkeWeek(maand.waarde) : verdeelMaand(pts.map((q) => q.realized ?? 0), n, additief);
    const geenNoemer = !passend && alleGerealiseerd && maand !== null && maand.geenNoemer;
    // Dezelfde vlag voor een prognosemaand: kosten verwacht en geen conversie. Anders heette die
    // week "Geen data" terwijl de maandkaart "Geen conversies verwacht" zegt.
    const geenNoemerPrognose = !passend && !alleGerealiseerd && !geenWaarde && maand !== null && maand.geenNoemer;
    const forecast = passend || alleGerealiseerd || geenWaarde
      ? null
      : maand ? elkeWeek(maand.waarde) : verdeelMaand(pts.map((q) => q.realized ?? q.forecast ?? 0), n, additief);

    for (let i = 1; i <= n; i++) {
      const weekStart = nthMondayOfMonth(year, month, i);
      const weeksOut = weekStart == null ? null : weeksToFair(fairDate, weekStart);
      if (weekStart == null || weeksOut == null) continue;
      const p = passend ? pts[i - 1] : null;
      weken.push({
        weeksOut,
        label: fairWeekLabel(weeksOut),
        weekStart,
        monthLabel: MONTH_LABELS[month - 1] ?? "",
        expected: p ? p.expected : expected![i - 1],
        realized: p ? p.realized : realized ? realized[i - 1] : null,
        forecast: p ? p.forecast : forecast ? forecast[i - 1] : null,
        ...((p ? p.geenNoemer : geenNoemer) ? { geenNoemer: true } : {}),
        ...((p ? p.geenNoemerPrognose : geenNoemerPrognose) ? { geenNoemerPrognose: true } : {}),
      });
    }
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
