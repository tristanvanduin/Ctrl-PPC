/**
 * Twee groeperingsassen tegelijk: op merk, en daarbinnen op specialist (of andersom).
 *
 * Een account kan in meerdere groepen zitten -- dat is de N:M-relatie van client_group_members en
 * die is met opzet zo. Wat het NIET mag, is in twee MERKgroepen zitten; dat bewaken de triggers uit
 * migratie 052 en 053, want dan telt een merkvergelijking hem dubbel. Op de specialist-as is
 * overlap juist normaal: twee mensen kunnen samen aan een account werken.
 *
 * ── WAAROM DIT EEN LOSSE FUNCTIE IS ─────────────────────────────────────────
 *
 * De zijbalk zette voorheen alle groepen plat naast elkaar. Zodra dezelfde accounts zowel een merk
 * als een specialist hebben, verschijnt elk account twee keer in dat lijstje -- één keer onder
 * "MPC" en één keer onder "Edwin" -- zonder dat iets zegt dat het hetzelfde account is. Bij één
 * bureau met vier groepen valt dat nog mee. Bij veertig specialisten en achthonderd accounts is
 * het onbruikbaar.
 *
 * Vandaar: kies een HOOFDAS, en hang de andere as er als tweede laag onder. Dan staat elk account
 * precies één keer in de boom.
 *
 * ── SCHAAL ──────────────────────────────────────────────────────────────────
 *
 * Alles gaat via Maps en elke lijst wordt één keer doorlopen: de kosten groeien lineair met het
 * aantal lidmaatschappen, niet met accounts × groepen. Bij 800 accounts en 40 specialisten scheelt
 * dat het verschil tussen 800 en 32.000 stappen. De test ernaast draait precies dat geval.
 */

export type GroepAs = "merk" | "specialist" | "vrij";

export interface GroepInvoer {
  id: string;
  name: string;
  soort: GroepAs | null;
  bevestigd: boolean;
  clientIds: readonly string[];
}

export interface KlantInvoer {
  id: string;
  name: string;
}

export interface Tak<T extends KlantInvoer> {
  /** De groep, of null voor de restbak. */
  groepId: string | null;
  naam: string;
  /** false als deze groep nog een voorstel is; de restbak is altijd true. */
  bevestigd: boolean;
  klanten: T[];
  /** Alleen gevuld als er een tweede as is gekozen. */
  takken: Tak<T>[];
  /** Alle klanten in deze tak en zijn subtakken, ontdubbeld. */
  aantal: number;
}

/** De naam van de restbak. Eén plek, want hij komt op twee niveaus voor. */
export const REST = "Overig";

/**
 * Bouwt de boom.
 *
 * `primair` bepaalt de bovenste laag. `secundair` is optioneel; is hij gelijk aan `primair` of
 * null, dan blijft de boom één laag diep.
 *
 * Een account dat op de hoofdas nergens in zit, komt in de restbak. Dat is bewust een echte tak en
 * geen weggelaten rij: bij veertig specialisten is "wie heeft er nog geen eigenaar" precies de
 * vraag die je wilt kunnen stellen, en accounts die stilletjes uit de lijst vallen zijn de reden
 * dat zoiets niet opvalt.
 */
export function bouwHierarchie<T extends KlantInvoer>(
  klanten: readonly T[],
  groepen: readonly GroepInvoer[],
  primair: GroepAs,
  secundair: GroepAs | null = null
): Tak<T>[] {
  const perId = new Map(klanten.map((k) => [k.id, k]));

  /** klant-id → de groepen van die soort waar hij in zit. */
  function indexeer(soort: GroepAs): Map<string, GroepInvoer[]> {
    const uit = new Map<string, GroepInvoer[]>();
    for (const g of groepen) {
      if (g.soort !== soort) continue;
      for (const cid of g.clientIds) {
        if (!perId.has(cid)) continue;   // een lid zonder zichtbare klant telt niet mee
        const lijst = uit.get(cid);
        if (lijst) lijst.push(g); else uit.set(cid, [g]);
      }
    }
    return uit;
  }

  const hoofdIndex = indexeer(primair);
  const tweedeAs = secundair && secundair !== primair ? secundair : null;
  const tweedeIndex = tweedeAs ? indexeer(tweedeAs) : null;

  // Eerst de klanten over de hoofdtakken verdelen, in de volgorde waarin de groepen binnenkwamen.
  const takken = new Map<string, { groep: GroepInvoer | null; klanten: T[] }>();
  for (const g of groepen) {
    if (g.soort === primair) takken.set(g.id, { groep: g, klanten: [] });
  }
  const rest: T[] = [];

  for (const klant of klanten) {
    const hoort = hoofdIndex.get(klant.id);
    if (!hoort || hoort.length === 0) { rest.push(klant); continue; }
    // Bij meerdere groepen op de hoofdas telt de eerste. Op de merk-as kan dat niet voorkomen
    // (de database staat maar één merk per account toe); op de specialist-as wel, en daar is
    // "de eerste" een keuze en geen waarheid -- vandaar dat de vergelijking alleen op merk mag.
    takken.get(hoort[0].id)?.klanten.push(klant);
  }

  const maakTak = (groep: GroepInvoer | null, klanten: T[]): Tak<T> => {
    if (!tweedeIndex) {
      return {
        groepId: groep?.id ?? null,
        naam: groep?.name ?? REST,
        bevestigd: groep?.bevestigd ?? true,
        klanten,
        takken: [],
        aantal: klanten.length,
      };
    }
    const sub = new Map<string, { groep: GroepInvoer | null; klanten: T[] }>();
    const subRest: T[] = [];
    for (const klant of klanten) {
      const hoort = tweedeIndex.get(klant.id);
      if (!hoort || hoort.length === 0) { subRest.push(klant); continue; }
      const g = hoort[0];
      const bestaand = sub.get(g.id);
      if (bestaand) bestaand.klanten.push(klant);
      else sub.set(g.id, { groep: g, klanten: [klant] });
    }
    const subTakken: Tak<T>[] = [...sub.values()].map((s) => ({
      groepId: s.groep!.id, naam: s.groep!.name, bevestigd: s.groep!.bevestigd,
      klanten: s.klanten, takken: [], aantal: s.klanten.length,
    }));
    if (subRest.length > 0) {
      subTakken.push({ groepId: null, naam: REST, bevestigd: true, klanten: subRest, takken: [], aantal: subRest.length });
    }
    return {
      groepId: groep?.id ?? null,
      naam: groep?.name ?? REST,
      bevestigd: groep?.bevestigd ?? true,
      klanten: [],          // op dit niveau hangen ze onder de subtakken
      takken: subTakken,
      aantal: klanten.length,
    };
  };

  const uit = [...takken.values()]
    .filter((t) => t.klanten.length > 0)
    .map((t) => maakTak(t.groep, t.klanten));

  if (rest.length > 0) uit.push(maakTak(null, rest));
  return uit;
}

/** Welke assen daadwerkelijk groepen hebben. Bepaalt of de keuzeknop getoond hoeft te worden. */
export function beschikbareAssen(groepen: readonly GroepInvoer[]): GroepAs[] {
  const gezien = new Set<GroepAs>();
  for (const g of groepen) if (g.soort) gezien.add(g.soort);
  return (["merk", "specialist", "vrij"] as const).filter((a) => gezien.has(a));
}
