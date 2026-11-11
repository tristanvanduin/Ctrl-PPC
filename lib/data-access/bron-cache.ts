// Eén cachehulpje voor luie lezers in de browser: een antwoord per sleutel, een tijdje bewaard,
// en een lopend verzoek gedeeld door iedereen die er tegelijk om vraagt.
//
// WAAROM DIT EEN EIGEN HUIS HEEFT
//
// Een wissel van kanaaltab unmount de hele oude weergave en mount de nieuwe, en elk blok haalde
// bij elke mount opnieuw op: de wereldkaart twee verzoeken, de uitsplitsingen twee keer dezelfde
// query (twee kaarten naast elkaar, elk met een eigen fetch), de videokaart twee. Terug naar een
// tab waar je net was kostte daardoor evenveel als de eerste keer.
//
// Het patroon dat dat oplost staat al op vijf plekken uitgeschreven, en niet overal hetzelfde:
// use-blended-client-data en client-settings hebben een cache met tijdstempel, een Map met lopende
// verzoeken en een teller tegen verouderde antwoorden; use-access en use-code-rood missen de
// teller, use-client-data deelt geen lopende verzoeken. Dat is precies hoe `median` aan drie
// smaken kwam (AGENTS.md). Nieuwe lezers gebruiken daarom dit hulpje; `maakBronCache` staat in
// GEDEELD van scripts/check-hygiene.mjs. De bestaande vijf houden hun eigen, geteste bedrading
// tot ze hierheen verhuizen.
//
// HET CONTRACT (hetzelfde als de cache in lib/use-blended-client-data.ts)
//
// - `lees(sleutel, haal)`: een vers antwoord komt uit de cache, zonder verzoek. Loopt er al een
//   verzoek voor die sleutel, dan wacht de lezer daarop. Anders start `haal`.
// - Een MISLUKT `haal` (een afgewezen belofte) komt niet in de cache: de volgende lezer probeert
//   opnieuw. Een lezer die van een fout "geen data" wil maken, doet dat ná `lees`, niet erin:
//   anders staat de storing vijf minuten lang als een leeg antwoord in de cache.
// - `vergeet(prefix)`: weg met alles waarvan de sleutel zo begint (zonder prefix: alles). Een
//   verzoek dat vóór het vergeten vertrok, brengt nog de oude stand mee en zet die niet meer in de
//   cache (de generatieteller); wie er al op wachtte krijgt zijn antwoord wel.
// - `kijk(sleutel)`: het verse antwoord of undefined, zonder verzoek. Voor de beginstaat van een
//   hook, zodat een tweede bezoek niet eerst een laadvlak toont.
//
// De sleutels beginnen met `${clientId}|`, zodat één prefix alles van een klant raakt.
//
// ALLEEN IN DE BROWSER GEVULD. De caches staan op moduleniveau, en op de server leeft een module
// over verzoeken van verschillende gebruikers heen. Roep `lees` daarom alleen aan uit een effect
// of een gebeurtenis, nooit tijdens het renderen: dan blijft de cache op de server leeg en deelt
// hij niets tussen klanten. `kijk` mag wel tijdens het renderen (hij leest alleen).
//
// Bewust zonder "use client": een gewone module, geen component (zie client-read.ts).

export interface BronCache<T> {
  /** Het bewaarde antwoord als dat nog vers is, anders undefined. Doet geen verzoek. */
  kijk(sleutel: string): T | undefined;
  /** Het antwoord voor deze sleutel: uit de cache, van een lopend verzoek, of via `haal`. */
  lees(sleutel: string, haal: () => Promise<T>): Promise<T>;
  /** Vergeet elke sleutel die met `prefix` begint; zonder prefix alles. */
  vergeet(prefix?: string): void;
}

// Elke cache die hier gemaakt is, voor vergeetBronnen hieronder.
const alleCaches = new Set<{ vergeet(prefix?: string): void }>();

/**
 * @param ttl Hoe lang een antwoord vers blijft, in milliseconden.
 */
export function maakBronCache<T>(ttl: number): BronCache<T> {
  const cache = new Map<string, { waarde: T; timestamp: number }>();
  const onderweg = new Map<string, Promise<T>>();
  // Per sleutel opgehoogd door `vergeet` als er op dat moment een verzoek liep.
  const generatie = new Map<string, number>();

  const vers = (sleutel: string): { waarde: T } | null => {
    const c = cache.get(sleutel);
    return c && Date.now() - c.timestamp < ttl ? c : null;
  };

  const eigen: BronCache<T> = {
    kijk(sleutel) {
      return vers(sleutel)?.waarde;
    },

    lees(sleutel, haal) {
      const bewaard = vers(sleutel);
      if (bewaard) return Promise.resolve(bewaard.waarde);
      const lopend = onderweg.get(sleutel);
      if (lopend) return lopend;

      const gen = generatie.get(sleutel) ?? 0;
      // In een executor, zodat een `haal` die meteen gooit ook een afgewezen belofte wordt.
      const verzoek: Promise<T> = new Promise<T>((los) => los(haal()))
        .then((waarde) => {
          if ((generatie.get(sleutel) ?? 0) === gen) cache.set(sleutel, { waarde, timestamp: Date.now() });
          return waarde;
        })
        .finally(() => { if (onderweg.get(sleutel) === verzoek) onderweg.delete(sleutel); });
      onderweg.set(sleutel, verzoek);
      return verzoek;
    },

    vergeet(prefix = "") {
      for (const sleutel of [...cache.keys()]) {
        if (sleutel.startsWith(prefix)) cache.delete(sleutel);
      }
      // Alleen een lopend verzoek kan nog iets ouds terugzetten, dus alleen daar telt de generatie.
      for (const sleutel of [...onderweg.keys()]) {
        if (!sleutel.startsWith(prefix)) continue;
        onderweg.delete(sleutel);
        generatie.set(sleutel, (generatie.get(sleutel) ?? 0) + 1);
      }
    },
  };

  alleCaches.add(eigen);
  return eigen;
}

/**
 * Vergeet in ALLE caches van dit hulpje wat met `prefix` begint: één ingang voor wie niet weet
 * (en niet hoeft te weten) welke blokken er een hebben. Na een sync is `${clientId}|` genoeg om de
 * wereldkaart, de uitsplitsingen en de videokaart van die klant opnieuw te laten lezen.
 */
export function vergeetBronnen(prefix?: string): void {
  for (const c of alleCaches) c.vergeet(prefix);
}
