// De naam van het product, en — daarvan losgekoppeld — wie een taak oppakt.
//
// Stond eerder als losse tekst op 78 plekken in 30 bestanden: de sidebar, de paginatitel, drie
// PDF-renderers, de SOP-prompts, de sprintplanning en een handvol tests. Een naamswijziging was
// daardoor een zoek-en-vervang-actie met kans op een vergeten hoekje — en juist een vergeten
// hoekje valt op, want het staat in een rapport dat naar buiten gaat.
//
// De bestandsnaam van het logo staat er bewust bij: die werd op drie plekken los samengesteld.

export const BRAND_NAME = "Ctrl PPC";

/**
 * Pad binnen /public. Vervang het bestand zelf om het logo te wisselen.
 *
 * Let op bij een nieuw logo: dit bestand staat op de zijbalk, en die is gevuld met de merkkleur
 * van de actieve klant. Een logo met een witte achtergrond geeft daar een wit blok. Wat hier hoort
 * is een SVG of een PNG met een doorzichtige achtergrond — bij voorkeur in één kleur, zodat hij op
 * elke tenantkleur leesbaar blijft.
 */
export const BRAND_LOGO_FILE = "ctrl-ppc-logo.png";

/** Korte vorm voor krappe plekken (tabelkoppen, selectievelden). */
export const BRAND_SHORT = "Ctrl";

// ── Eigenaarschap van taken ────────────────────────────────────────────────
//
// LOSGEKOPPELD VAN DE MERKNAAM, EN DAT IS GEEN OPRUIMING MAAR EEN CORRECTIE.
//
// Hier stond `OWNER_TEAM = BRAND_NAME`. Dat werkt zolang er één bureau is dat het dashboard voor
// zijn eigen klanten draait, en het breekt op twee manieren zodra dat niet meer zo is.
//
// Ten eerste: als dit als SaaS verkocht wordt, is de eigenaar per tenant een ander bureau. Een
// taak van bureau A zou dan letterlijk de naam van bureau B dragen zodra die de rij inleest.
//
// Ten tweede, en dat is de acute: deze waarde wordt OPGESLAGEN in sprint_planning.owner en
// sop_tasks.owner. Was de merknaam blijven meeliften, dan had het hernoemen naar Ctrl PPC elke
// bestaande rij met "RAI Amsterdam" stilzwijgend als KLANT-taak laten tellen — want die naam zou
// dan niet meer overeenkomen met de teamwaarde. Een naamswijziging in de zijbalk had zo de
// verdeling van het werk in de sprintplanning omgegooid.
//
// Wat er wordt opgeslagen is daarom geen naam meer maar een ROL. De naam is weergave en komt van
// de tenant; de rol is data en verandert nooit mee met een rebranding.
//
// Alle historische schrijfwijzen blijven gelezen worden. Daardoor is er géén databasemigratie
// nodig: bestaande rijen worden bij het lezen genormaliseerd, en pas wat daarna wordt weggeschreven
// draagt de rol. Die lijst hoort te krimpen, niet te groeien — hij is een geheugen van elke naam
// die dit product ooit heeft gedragen.

/** De opgeslagen waarde voor "het bureau doet dit". Een rol, geen naam. */
export const OWNER_TEAM = "Bureau";
/** De opgeslagen waarde voor "de klant doet dit". */
export const OWNER_CLIENT = "Klant";

/** Elke schrijfwijze die ooit als teamwaarde is weggeschreven. Bij het lezen allemaal geldig. */
export const LEGACY_OWNER_TEAM = ["RAI Amsterdam", "RAI", "Ranking Masters", "RM"] as const;

/** Hoort deze taak bij het bureau? Herkent de rol én elke naam die ooit is opgeslagen. */
export function isTeamOwner(owner: string | null | undefined): boolean {
  const v = (owner ?? "").trim();
  if (v === "") return false;
  if (v === OWNER_TEAM || v === BRAND_NAME || v === BRAND_SHORT) return true;
  return (LEGACY_OWNER_TEAM as readonly string[]).includes(v);
}

/** Zet een opgeslagen eigenaar om naar de rol die hij vertegenwoordigt. */
export function normalizeOwner(owner: string | null | undefined): string {
  return isTeamOwner(owner) ? OWNER_TEAM : OWNER_CLIENT;
}

/**
 * Hoe de eigenaar op het scherm heet.
 *
 * De rol is data, dit is weergave. Geef de bureaunaam van de tenant mee en die wint; zonder valt
 * hij terug op de productnaam, wat klopt zolang er één bureau is.
 */
export function ownerLabel(owner: string | null | undefined, bureauNaam: string = BRAND_NAME): string {
  return isTeamOwner(owner) ? bureauNaam : OWNER_CLIENT;
}
