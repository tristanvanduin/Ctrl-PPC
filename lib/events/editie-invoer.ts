// Het invoeren en opslaan van edities in Instellingen > Events (components/dashboard/event-settings.tsx).
// Stap 2 van het periodemodel: per editie optioneel een begin en een eind naast de datum. Dit
// bestand is de regel; het formulier toont hem alleen. Puur, zonder React, los getest.
//
// WAT ER WORDT OPGESLAGEN
//
// Een editie is `{ date, label }`, met optioneel `start` en `end` ("YYYY-MM-DD", beide meegeteld;
// het type staat in lib/fair/geo-clone-settings.ts, het lezen in lib/events/event-periodes.ts).
// Een leeg begin of eind wordt WEGGELATEN, niet als "" of null bewaard: een editie zonder periode
// gaat byte-gelijk de database in zoals voor deze stap, zodat elke lezer die start/end niet kent
// (lib/fair, de pacing-route, de geo-clone-instellingen) precies hetzelfde ziet als voorheen.
//
// WAT ER WORDT GECONTROLEERD
//
// Alleen wat de gebruiker zelf invult; er wordt niets voorgesteld of doorgerekend. Black Friday
// staat niet bij iedereen op hetzelfde moment, dus het B2C-voorstel (standard-b2c-events.ts) blijft
// een voorstel met alleen een datum, en hier komt geen vaste aanloop of nasleep bij.
//
// - Een begin of eind dat geen bestaande dag is: fout.
// - Een begin of eind zonder datum: fout. De datum is het ankerpunt van de aftelling (lib/fair);
//   zonder datum gooit het opslaan de editie weg, en dat mag niet stil gebeuren.
// - Eind vóór begin: fout. De lezer zet omgedraaide grenzen recht, maar in een formulier is het
//   een tikfout en geen bedoeling.
// - De datum buiten begin en eind: fout, met de uitleg waarom. Bij een beurs is de datum de
//   beursdag, bij een actie de piekdag; de periode is de aanloop en nasleep eromheen. Een periode
//   die zijn eigen ankerpunt niet bevat, vergelijkt de aftelling met iets anders dan de periode.
//   (De lezer accepteert het wel, voor wat er al staat; het formulier laat het niet ontstaan.)
// - Langer dan MAX_EDITIE_DAGEN: fout. Een editie is één beurs of één actie; wie een heel jaar
//   wil vergelijken, kiest een vrije periode.
//
// Alleen een begin of alleen een eind is geen fout: de lezer laat de ontbrekende grens dan op de
// datum vallen. Het formulier vult daar niets voor in, maar zegt het wel (editieHint), zodat de
// gebruiker niet denkt dat een leeg eind "tot nader order" betekent.

import type { Edition } from "@/lib/fair/geo-clone-settings";
import { aantalDagen, formatDag, isGeldigeDag } from "@/lib/period/dag-periode";

/** De langste periode die een editie mag hebben, in dagen (beide grenzen meegeteld). */
export const MAX_EDITIE_DAGEN = 366;

export type EditieVeld = "date" | "start" | "end";
export type EditieFouten = Partial<Record<EditieVeld, string>>;

/** Leeg is: niet aanwezig, null of een lege string. */
function leeg(v: string | null | undefined): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Een begin, eind of datum zoals de lezer hem leest: alleen de eerste tien tekens, zodat een
 * waarde met een tijd erachter ("2026-01-05T00:00:00Z") als die dag telt (lib/fair, event-periodes.ts).
 * Leeg blijft "". Het formulier toont de velden hiermee, want <input type="date"> laat een waarde
 * met een tijd als leeg veld zien.
 */
export function editieDag(v: string | null | undefined): string {
  return leeg(v) ? "" : v!.slice(0, 10);
}

const ANKER_UITLEG = "De datum is het ankerpunt van de aftelling: bij een beurs de beursdag, bij een actie de piekdag. De periode is de aanloop en nasleep daaromheen, dus de datum valt erbinnen.";

/** De fouten in één editie, per veld. Een lege editie en een editie met alleen een datum hebben er geen. */
export function valideerEditie(ed: Edition): EditieFouten {
  const fouten: EditieFouten = {};
  const heeftStart = !leeg(ed.start);
  const heeftEnd = !leeg(ed.end);
  if (!heeftStart && !heeftEnd) return fouten;

  if (heeftStart && !isGeldigeDag(editieDag(ed.start))) fouten.start = "Het begin is geen bestaande datum.";
  if (heeftEnd && !isGeldigeDag(editieDag(ed.end))) fouten.end = "Het eind is geen bestaande datum.";
  if (leeg(ed.date)) {
    fouten.date = "Vul ook de datum in. Die is het ankerpunt van de aftelling (bij een beurs de beursdag, bij een actie de piekdag); zonder datum wordt de editie niet bewaard.";
  } else if (!isGeldigeDag(editieDag(ed.date))) {
    fouten.date = "De datum is geen bestaande datum.";
  }
  if (fouten.start || fouten.end || fouten.date) return fouten;

  // Zoals de lezer: een datum, begin of eind met een tijd telt op zijn eerste tien tekens.
  const date = editieDag(ed.date);
  const start = heeftStart ? editieDag(ed.start) : null;
  const end = heeftEnd ? editieDag(ed.end) : null;

  if (start && end && end < start) {
    fouten.end = `Het eind ligt vóór het begin. Kies een eind op of na ${formatDag(start)}.`;
    return fouten;
  }
  if (start && start > date) fouten.start = `Het begin ligt na de datum (${formatDag(date)}). ${ANKER_UITLEG}`;
  if (end && end < date) fouten.end = `Het eind ligt vóór de datum (${formatDag(date)}). ${ANKER_UITLEG}`;
  if (fouten.start || fouten.end) return fouten;

  const dagen = aantalDagen({ start: start ?? date, eind: end ?? date });
  if (dagen > MAX_EDITIE_DAGEN) {
    const tekst = `Deze periode is ${dagen} dagen; een editie mag er hoogstens ${MAX_EDITIE_DAGEN} hebben. Een editie is één beurs of één actie; voor een langere vergelijking kies je een vrije periode.`;
    if (end) fouten.end = tekst;
    else fouten.start = tekst;
  }
  return fouten;
}

/**
 * Wat een half ingevulde periode betekent, of null. Het formulier vult geen eind of begin voor
 * de gebruiker in; het zegt alleen wat de lezer met de lege grens doet (die valt op de datum).
 */
export function editieHint(ed: Edition): string | null {
  const heeftStart = !leeg(ed.start);
  const heeftEnd = !leeg(ed.end);
  if (heeftStart === heeftEnd) return null;
  if (Object.keys(valideerEditie(ed)).length > 0) return null;
  const date = editieDag(ed.date);
  return heeftStart
    ? `Geen eind ingevuld: de periode loopt van ${formatDag(editieDag(ed.start))} t/m de datum (${formatDag(date)}). Vul een eind in als de actie daarna doorloopt.`
    : `Geen begin ingevuld: de periode loopt van de datum (${formatDag(date)}) t/m ${formatDag(editieDag(ed.end))}. Vul een begin in als er een aanloop is.`;
}

/**
 * Eén editie zoals hij wordt opgeslagen: een leeg begin of eind weggelaten, de rest ongemoeid en
 * in dezelfde volgorde. Een editie zonder begin en eind komt er byte-gelijk uit.
 */
export function editieVoorOpslag<E extends Edition>(ed: E): E {
  if (!("start" in ed) && !("end" in ed)) return ed;
  const { start, end, ...rest } = ed;
  const uit = { ...rest } as E;
  if (!leeg(start)) uit.start = start;
  if (!leeg(end)) uit.end = end;
  return uit;
}

interface EventInvoer<E extends Edition> {
  name: string;
  editions: E[];
}

/**
 * De events zoals ze in rai_events.events gaan: zonder naam eruit, edities zonder datum eruit
 * (zoals voor deze stap), en per editie editieVoorOpslag. Controleer eerst met foutenVoorOpslag:
 * een editie met een begin maar zonder datum valt hier anders stil weg.
 */
export function eventsVoorOpslag<E extends Edition, T extends EventInvoer<E>>(events: readonly T[]): T[] {
  return events
    .filter((e) => e.name.trim())
    .map((e) => ({ ...e, editions: e.editions.filter((ed) => ed.date).map(editieVoorOpslag) }));
}

/** Alle fouten die het opslaan tegenhouden, leesbaar: "Black Friday, editie 2: ...". Leeg = opslaan mag. */
export function foutenVoorOpslag<E extends Edition>(events: readonly EventInvoer<E>[]): string[] {
  const uit: string[] = [];
  for (const e of events) {
    if (!e.name.trim()) continue;
    e.editions.forEach((ed, i) => {
      const f = valideerEditie(ed);
      for (const veld of ["date", "start", "end"] as const) {
        if (f[veld]) uit.push(`${e.name.trim()}, editie ${i + 1}: ${f[veld]}`);
      }
    });
  }
  return uit;
}
