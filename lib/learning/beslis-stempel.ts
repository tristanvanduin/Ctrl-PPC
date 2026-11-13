// Wie besliste over een voorstel, en wanneer, volgens de SERVER.
//
// De kolommen decided_by en decided_at bestaan sinds migratie 021, maar decided_by werd nergens
// gezet: 0 van de 129 hypotheses had een beslisser, ook de 28 aanvaarde niet (doorlichting 13
// november). De voorstellenwachtrij schrijft via /api/data rechtstreeks status, accepted_at en
// decided_at, met de klok van de browser. accepted_at is het startpunt van de nameting; een
// browserklok die een dag verkeerd staat schuift het hele meetvenster op.
//
// Deze stempel draait server-side op elke beslissing over een sprint_hypotheses-rij: de beslisser
// komt uit de sessie (nooit uit de browser), de tijd van de server. Zonder sessie (O1_AUTH_ENFORCED
// uit) blijft decided_by leeg in plaats van een gok; de tijd wordt wel rechtgezet.

export const BESLIS_STATUSSEN = new Set(["accepted", "rejected", "completed"]);

export interface Beslisser {
  id: string;
  email: string | null;
}

/** Hoe de beslisser in decided_by komt: het e-mailadres als dat er is, anders het gebruikers-id. */
export function beslisserVan(user: Beslisser | null | undefined): string | null {
  if (!user) return null;
  return user.email?.trim() || user.id || null;
}

/** De huidige stand van de rij, als de route hem kon lezen. */
export interface HuidigeStand {
  status: string | null;
  accepted_at: string | null;
}

/**
 * Stempelt een update op sprint_hypotheses die een beslissing is (status naar accepted, rejected
 * of completed). Laat elke andere update ongemoeid.
 *
 * - decided_at alleen bij een OVERGANG naar accepted of rejected. Afronden (completed) is geen
 *   nieuwe beslissing over het voorstel; het overschreef eerst de tijd van de aanvaarding.
 * - accepted_at alleen bij de overgang naar accepted, nooit als de rij al accepted was: het is het
 *   startpunt van de nameting (dezelfde regel als decideTransition in hypothesis-status.ts).
 *   Zonder bekende huidige stand blijft het oude gedrag: alleen als de update hem meestuurde.
 * - decided_by alleen uit de sessie, en alleen waar decided_at gezet wordt.
 *
 * Bewust niet decideTransition zelf: die weigert ook een afwijzing zonder reden, en de
 * voorstellenwachtrij stuurt er geen mee. Weigeren hoort bij de statusmachine, niet bij de stempel.
 */
export function stempelBeslissing(opts: {
  table: string;
  values: Record<string, unknown> | undefined;
  beslisser: string | null;
  nu: Date;
  /** undefined: onbekend; null: een nieuwe rij (insert). */
  huidig?: HuidigeStand | null;
}): Record<string, unknown> | undefined {
  const { table, values, beslisser, nu, huidig } = opts;
  if (table !== "sprint_hypotheses" || !values) return values;
  const status = values.status;
  if (typeof status !== "string" || !BESLIS_STATUSSEN.has(status)) return values;
  const iso = nu.toISOString();
  const uit: Record<string, unknown> = { ...values };
  // De browser mag zichzelf geen beslisser of beslistijd toekennen.
  delete uit.decided_by;
  delete uit.decided_at;

  const vorige = huidig === undefined ? undefined : (huidig?.status ?? null);
  const isOvergang = vorige === undefined || vorige !== status;
  if ((status === "accepted" || status === "rejected") && isOvergang) {
    uit.decided_at = iso;
    if (beslisser) uit.decided_by = beslisser;
  }

  if (status === "accepted" && vorige !== "accepted") {
    if (vorige !== undefined || "accepted_at" in values) uit.accepted_at = iso;
  } else {
    delete uit.accepted_at;
  }
  return uit;
}
