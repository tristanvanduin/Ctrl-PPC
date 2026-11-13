// De kiesbare event-periodes van een klant, gelezen uit client_settings.rai_events. Stap 1 van het
// periodemodel: alleen lezen. Dit bestand schrijft niets en de instellingenpagina verandert niet.
//
// WAT ER IN RAI_EVENTS STAAT, EN WAT HIER BIJ KOMT
//
// Per event: id, name, abbrev, cadence (annual/biennial/custom) en editions [{date, label}]
// (components/dashboard/event-settings.tsx; voor een B2C-klant met een lege lijst stelt die
// lib/events/standard-b2c-events.ts voor). `date` is één dag: de beursdag, of Black Friday zelf.
//
// Nieuw, optioneel en achterwaarts verenigbaar: per editie `start` en `end`, beide "YYYY-MM-DD",
// beide meegeteld. Gekozen naast `date` en `label` omdat die ook Engels en kort zijn: dezelfde
// JSON krijgt geen twee talen door elkaar, en `startDate`/`endDate` zou naast `date` suggereren
// dat `date` iets anders is dan een datum. De regels:
//
// - Alleen `date`: een periode van die ene dag. Zo leest elke editie die er vandaag staat.
// - `start` en `end`: die periode. `date` blijft het ankerpunt van de T-minus-analyse (lib/fair);
//   de periode hoeft hem niet te bevatten (een aanloopactie die eindigt op de beursdag kan).
// - Alleen `start` of alleen `end`: de ontbrekende grens is `date`, en zonder `date` de andere
//   grens. Een halve periode is meestal een half ingevuld formulier, geen bedoelde eendaagse.
// - Omgekeerde grenzen worden rechtgezet (normaliseerDagPeriode), zoals normalizeRange bij maanden.
// - Een datum die niet bestaat ("2026-02-30") maakt de editie onbruikbaar: overgeslagen, nooit
//   naar een bestaande dag gerold (fair-weeks.ts rolt hem wel door; voor een aftelling in weken
//   maakt een dag niet uit, voor een vergelijking per dag wel). Een event zonder id of naam ook,
//   zoals businessEventsUitRaiEvents.
//
// Let op: event-settings.tsx bewaart start en end bij het opslaan (hij spreidt de editie), maar
// gooit een editie zonder `date` weg. Een editie met alleen start/end overleeft dus het opslaan via
// die pagina niet, totdat stap 3 daar een veld voor maakt.
//
// Gelezen zoals lib/fair (geldigeEdities): een datum mag een tijd dragen ("2026-01-05T00:00:00Z");
// alleen de eerste tien tekens tellen, zoals bij week_start in de weekrijen. Het terugvallabel bij
// een leeg label is het jaar van `date` (editieLabel uit fair-weeks.ts, één regel), niet van de
// start: bij een aanloop over de jaargrens had dezelfde editie anders twee namen.
//
// DUBBELE EDITIES
//
// Twee edities van hetzelfde event op dezelfde `date` zijn één editie die twee keer is ingevuld
// (een kale en een met periode, na een half opgeslagen formulier). Ze worden er één: die met een
// periode gaat voor, bij gelijkspel de eerste, en de gehouden editie meldt de dubbele
// (`waarschuwing`). Zonder dat werd de kale dubbele een eigen kiesbare periode, die de periode
// eromheen als "vorige editie" kreeg, en vergeleek de editie erna met de kale dag in plaats van
// met de ingevulde periode.
//
// WAT DE GEBRUIKER INVULT IS DE WAARHEID
//
// De vorige editie is de editie van HETZELFDE event met de laatste `date` (het ankerpunt) vóór
// deze, zoals hij in de instellingen staat. Op het ankerpunt en niet op de start: een editie met
// een vroege aanloop mag de volgorde niet verschuiven. Er wordt niets doorgerekend uit de cadans
// (dat doet fair-weeks.ts voor de aftelling, met een vlag erbij); een tweejaarlijks event pakt
// vanzelf de editie van twee jaar terug, en een event zonder eerdere editie heeft er geen.

import { editieLabel, type FairEventCfg } from "@/lib/fair/fair-weeks";
import type { Cadence } from "@/lib/fair/geo-clone-settings";
import { aantalDagen, isGeldigeDag, normaliseerDagPeriode, type Dag, type DagPeriode } from "@/lib/period/dag-periode";

/** De vorige editie van hetzelfde event, voor de vergelijking previous_edition. */
export interface VorigeEditie extends DagPeriode {
  label: string;
  /** Het ankerpunt van de vorige editie (zijn `date`). */
  datum: Dag;
  /** Dagen van het ankerpunt van de vorige editie tot dat van deze. */
  afstandDagen: number;
}

/** Eén kiesbare periode: een editie van een event. */
export interface EventPeriode extends DagPeriode {
  eventId: string;
  naam: string;
  abbrev: string;
  cadence: Cadence | null;
  /** Het label van de editie ("2025"), of het jaar van `datum` als het leeg is. */
  label: string;
  /** De dag uit `date` (het ankerpunt), of de start als `date` ontbreekt. */
  datum: Dag;
  /** True als de editie uit start/end komt, false als het alleen `date` was (één dag). */
  heeftPeriode: boolean;
  vorige: VorigeEditie | null;
  /** Wat de lezer over deze editie moet weten (een dubbele op dezelfde datum), anders null. */
  waarschuwing: string | null;
}

/** Wat een editie in rai_events mag dragen. `start` en `end` zijn nieuw en optioneel. */
interface RuweEditie {
  date?: unknown;
  label?: unknown;
  start?: unknown;
  end?: unknown;
}

type Veld = { leeg: true } | { leeg: false; dag: Dag | null };

/** Een datumveld: leeg, een geldige dag (de eerste tien tekens), of ingevuld maar onbruikbaar. */
function leesDag(v: unknown): Veld {
  if (v === undefined || v === null || v === "") return { leeg: true };
  const d = typeof v === "string" ? v.slice(0, 10) : "";
  return { leeg: false, dag: isGeldigeDag(d) ? d : null };
}

/** De periode van één editie, of null als hij onbruikbaar is. */
export function editiePeriode(ed: RuweEditie | null | undefined): (DagPeriode & { datum: Dag; heeftPeriode: boolean }) | null {
  if (!ed) return null;
  const velden = [leesDag(ed.date), leesDag(ed.start), leesDag(ed.end)];
  // Een ingevuld maar onbestaand veld maakt de editie onbruikbaar; een leeg veld telt als afwezig.
  if (velden.some((v) => !v.leeg && v.dag === null)) return null;
  const [date, start, end] = velden.map((v) => (v.leeg ? null : v.dag));
  const a = start ?? date ?? end;
  const b = end ?? date ?? start;
  if (!a || !b) return null;
  return { ...normaliseerDagPeriode(a, b), datum: date ?? a, heeftPeriode: start !== null || end !== null };
}

const labelVan = (ed: RuweEditie, datum: Dag): string =>
  editieLabel({ date: datum, label: typeof ed.label === "string" ? ed.label : "" });

/**
 * Alle kiesbare event-periodes van een klant, uit de `events` van rai_events.
 *
 * Gesorteerd op start, dan eind, dan naam: chronologisch, vroegst eerst, zoals geldigeEdities in
 * fair-weeks.ts. Een kiezer die het nieuwste bovenaan wil, draait de lijst om; de volgorde zelf
 * ligt hier vast, zodat twee kiezers niet elk een eigen volgorde verzinnen.
 *
 * Per editie de vorige editie van HETZELFDE event (zelfde id): de laatste `date` strikt vóór deze.
 * Dubbele edities op dezelfde `date` worden er één (zie de kop).
 */
export function eventPeriodesVoorKlant(events: readonly FairEventCfg[] | null | undefined): EventPeriode[] {
  const uit: EventPeriode[] = [];
  for (const e of events ?? []) {
    const id = typeof e?.id === "string" ? e.id : "";
    const naam = typeof e?.name === "string" ? e.name.trim() : "";
    if (!id || !naam) continue;

    type Gelezen = { ed: RuweEditie; p: NonNullable<ReturnType<typeof editiePeriode>>; dubbel: number };
    const opDatum = new Map<Dag, Gelezen>();
    for (const ruw of e.editions ?? []) {
      const ed = (ruw ?? {}) as RuweEditie;
      const p = editiePeriode(ed);
      if (!p) continue;
      const er = opDatum.get(p.datum);
      if (!er) { opDatum.set(p.datum, { ed, p, dubbel: 0 }); continue; }
      // Die met een periode gaat voor; bij gelijkspel blijft de eerste staan.
      const vervang = p.heeftPeriode && !er.p.heeftPeriode;
      opDatum.set(p.datum, vervang ? { ed, p, dubbel: er.dubbel + 1 } : { ...er, dubbel: er.dubbel + 1 });
    }
    const edities = [...opDatum.values()].sort((x, y) => x.p.datum.localeCompare(y.p.datum));

    edities.forEach(({ ed, p, dubbel }, i) => {
      const v = i > 0 ? edities[i - 1] : null;
      uit.push({
        eventId: id,
        naam,
        abbrev: typeof e.abbrev === "string" ? e.abbrev : "",
        cadence: e.cadence ?? null,
        label: labelVan(ed, p.datum),
        start: p.start,
        eind: p.eind,
        datum: p.datum,
        heeftPeriode: p.heeftPeriode,
        vorige: v ? {
          start: v.p.start,
          eind: v.p.eind,
          datum: v.p.datum,
          label: labelVan(v.ed, v.p.datum),
          afstandDagen: aantalDagen({ start: v.p.datum, eind: p.datum }) - 1,
        } : null,
        waarschuwing: dubbel
          ? `${naam} heeft ${dubbel + 1} edities op ${p.datum}; alleen ${p.heeftPeriode ? "die met een periode" : "de eerste"} telt. Haal de dubbele weg in Instellingen > Events.`
          : null,
      });
    });
  }
  return uit.sort((a, b) => a.start.localeCompare(b.start) || a.eind.localeCompare(b.eind) || a.naam.localeCompare(b.naam));
}
/** Hetzelfde, rechtstreeks uit de kolom client_settings.rai_events (`{ events: [...] }` of leeg). */
export function eventPeriodesUitRaiEvents(raiEvents: unknown): EventPeriode[] {
  const events = (raiEvents as { events?: unknown } | null | undefined)?.events;
  return eventPeriodesVoorKlant(Array.isArray(events) ? (events as FairEventCfg[]) : []);
}
