// De naam van de organisatie achter dit dashboard, op één plek.
//
// Stond eerder als losse tekst op 78 plekken in 30 bestanden: de sidebar, de paginatitel, drie
// PDF-renderers, de SOP-prompts, de sprintplanning en een handvol tests. Een naamswijziging was
// daardoor een zoek-en-vervang-actie met kans op een vergeten hoekje — en juist een vergeten
// hoekje valt op, want het staat in een rapport dat naar buiten gaat.
//
// De bestandsnaam van het logo staat er bewust bij: die werd op drie plekken los samengesteld.

export const BRAND_NAME = "RAI Amsterdam";

/** Pad binnen /public. Vervang het bestand zelf om het logo te wisselen. */
export const BRAND_LOGO_FILE = "rai-amsterdam-logo.png";

/** Korte vorm voor krappe plekken (tabelkoppen, selectievelden). */
export const BRAND_SHORT = "RAI";

// ── Eigenaarschap van taken ────────────────────────────────────────────────
// Wie een taak oppakt: het eigen team of de klant. Deze waarde wordt OPGESLAGEN in
// sprint_planning.owner en sop_tasks.owner, en is dus geen loutere weergavetekst.
//
// Daarom accepteren we bij het lezen ook de oude waarde. Rijen die vóór de naamswijziging zijn
// weggeschreven dragen "Ranking Masters"; die mogen niet ineens ongeldig worden of als
// klant-taken gaan tellen. Nieuwe rijen krijgen de nieuwe waarde. Zodra
// scripts/rename-owner-to-rai.sql gedraaid is, kan LEGACY_OWNER_TEAM hier weg.

export const OWNER_TEAM = BRAND_NAME;
export const OWNER_CLIENT = "Klant";

/** De waarde zoals die vóór de naamswijziging werd opgeslagen. */
export const LEGACY_OWNER_TEAM = "Ranking Masters";

/** Hoort deze taak bij het eigen team? Herkent ook de oude opgeslagen waarde. */
export function isTeamOwner(owner: string | null | undefined): boolean {
  const v = (owner ?? "").trim();
  return v === OWNER_TEAM || v === LEGACY_OWNER_TEAM || v === BRAND_SHORT || v === "RM";
}

/** Zet een opgeslagen eigenaar om naar de huidige schrijfwijze. */
export function normalizeOwner(owner: string | null | undefined): string {
  return isTeamOwner(owner) ? OWNER_TEAM : OWNER_CLIENT;
}
