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

/**
 * Korte vorm van de PRODUCTNAAM, voor krappe plekken waar het product zichzelf benoemt.
 *
 * Niet te gebruiken als aanduiding van een partij. Hij stond in de sprintplanning als optie in
 * het eigenaarsveld — daar las "Ctrl" als de naam van degene die de taak oppakt.
 */
export const BRAND_SHORT = "Ctrl";

/**
 * De regel onder de merknaam in klantdocumenten. Leeg betekent: geen regel.
 *
 * Hier stond letterlijk "De #1 SEM specialist in de Benelux", hardgecodeerd in de
 * Second-Opinion-PDF. Twee dingen mis daarmee. Het is een superlatief zonder onderbouwing in een
 * document dat naar een klant gaat — en het stond náást de merknaam, dus na de hernoeming was het
 * ineens een claim van Ctrl PPC over zichzelf, zonder dat iemand die claim had gedaan.
 *
 * En het tweede: als dit als SaaS draait, is de regel onder de naam per bureau anders. Dezelfde
 * fout als bij de eigenaar, op een andere plek. Dus hier, leeg, en de PDF laat hem weg als er
 * niets staat. Wie een regel wil, zet hem er bewust in.
 */
export const BRAND_TAGLINE = "";

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
// Ten tweede, en dat is de acute: deze waarde wordt OPGESLAGEN in sprint_items.owner. (Niet in
// sprint_planning en niet in sop_tasks — dat stond hier eerder en klopte allebei niet; nagekeken
// tegen het live schema, sop_tasks heeft helemaal geen owner-kolom.) Was de merknaam blijven
// meeliften, dan had het hernoemen naar Ctrl PPC elke bestaande rij met een eerdere productnaam
// stilzwijgend als KLANT-taak laten tellen — want die naam zou dan niet meer overeenkomen met de
// teamwaarde. Een naamswijziging in de zijbalk had zo de verdeling van het werk in de
// sprintplanning omgegooid.
//
// Wat er wordt opgeslagen is daarom geen naam meer maar een ROL. De naam is weergave en komt van
// de tenant; de rol is data en verandert nooit mee met een rebranding.
//
// TOT 17 augustus 2026 accepteerde het schema hier ook nog elke historische schrijfwijze
// (LEGACY_OWNER_TEAM), zodat bestaande rijen zonder migratie bleven werken. Die lijst bevatte
// letterlijke namen van eerdere, externe partijen — precies het soort referentie dat nooit in de
// broncode hoort te staan, migratie of niet. Verwijderd; scripts/migrations/097_owner_role_
// normalize.sql zet de kolom zelf om naar de rol. Zolang die migratie niet gedraaid is, vallen
// rijen met een oude schrijfwijze terug op OWNER_CLIENT ("Klant") in plaats van OWNER_TEAM — een
// bewuste, tijdelijke afweging: geen naam in de broncode weegt zwaarder dan de klassificatie van
// een handvol historische taken.
//
// Wat er werkelijk in die kolom stond, geteld op 3 augustus 2026: 38 rijen met een oude
// productnaam, 7 rijen "Minismus" (een klant van het bureau — die valt terecht door naar de
// klant-rol), en 4 rijen met een hele hypothesetekst erin, uit een import die het verkeerde veld
// raakte. Dat laatste is rommel, maar hij normaliseert netjes naar "Klant" en is daardoor
// onzichtbaar geworden.

/**
 * De opgeslagen waarde voor "onze kant doet dit". Een SLEUTEL, geen schermtekst.
 *
 * Hij staat zo in de database en verandert niet mee als de weergave verandert — wat hij inmiddels
 * ook heeft gedaan: het scherm zegt nu "Intern". Zie KANT_LABEL_INTERN.
 */
export const OWNER_TEAM = "Bureau";
/** De opgeslagen waarde voor "de andere kant doet dit". Ook een sleutel. */
export const OWNER_CLIENT = "Klant";

// ── Hoe de twee kanten op het scherm heten ─────────────────────────────────
//
// Los van de sleutels hierboven, en dat is precies waarom dit zonder migratie kon: de 49 rijen
// dragen nog steeds "Bureau" en "Klant", en er is geen enkele reden om daaraan te komen.
//
// "Intern" en "extern" beschrijven bovendien wat er werkelijk wordt bedoeld. "Bureau" en "klant"
// zijn twee partijen, maar de vraag die deze as beantwoordt is of het werk aan onze kant ligt of
// daarbuiten — en daarbuiten is niet altijd de klant zelf, het kan net zo goed hun webbouwer of
// een andere partner zijn. Met "Klant" als kop stond die partner onder een naam die niet klopte.

/** De weergave van de eigen kant, als de tenant geen eigen bureaunaam meegeeft. */
export const KANT_LABEL_INTERN = "Intern";
/** De weergave van de andere kant. */
export const KANT_LABEL_EXTERN = "Extern";

/**
 * Was tot 17 augustus 2026 een lijst van elke historische productnaam die ooit als teamwaarde is
 * weggeschreven. Verwijderd: geen naam van een externe partij hoort in de broncode te staan. Zie
 * scripts/migrations/097_owner_role_normalize.sql voor de migratie die de database zelf
 * normaliseert, en de toelichting hierboven voor de tijdelijke afweging zolang die nog niet
 * gedraaid is.
 */
export const LEGACY_OWNER_TEAM = [] as const;

/**
 * Hoort deze taak bij het bureau? Herkent de rol, en (tot de migratie hierboven gedraaid is)
 * eventuele nog niet genormaliseerde historische rijen via LEGACY_OWNER_TEAM.
 *
 * De productnaam staat hier bewust NIET tussen. Ctrl PPC is het gereedschap, niet een partij die
 * werk uitvoert — het kan dus nooit de eigenaar van een taak zijn. Eerder stonden BRAND_NAME en
 * BRAND_SHORT hier wel, en dat was mijn denkfout: ik had de merknaam als bureaunaam gelezen.
 * Nagekeken in de database voordat ze eruit gingen: geen enkele rij draagt "Ctrl PPC" of "Ctrl",
 * dus er wordt niets stilzwijgend geherclassificeerd.
 */
export function isTeamOwner(owner: string | null | undefined): boolean {
  const v = (owner ?? "").trim();
  if (v === "") return false;
  // De schermtekst telt mee, niet uit slordigheid maar omdat hij terugkomt: de CSV-export schrijft
  // de kolom Kant als "Intern" of "Extern", en de import leest diezelfde kolom. Zonder deze regel
  // zou elke geëxporteerde interne taak bij het terugzetten extern worden — de labels staan
  // immers niet in de sleutels of in de historische namen.
  if (v === OWNER_TEAM || v === KANT_LABEL_INTERN) return true;
  return (LEGACY_OWNER_TEAM as readonly string[]).includes(v);
}

/** Zet een opgeslagen eigenaar om naar de rol die hij vertegenwoordigt. */
export function normalizeOwner(owner: string | null | undefined): string {
  return isTeamOwner(owner) ? OWNER_TEAM : OWNER_CLIENT;
}

/**
 * Hoe de eigenaar op het scherm heet.
 *
 * De rol is data, dit is weergave. Geef de bureaunaam van de tenant mee en die wint.
 *
 * Zonder tenantnaam valt hij terug op de ROL, niet op de productnaam. Dat stond hier eerst wel
 * zo, met als redenering "dat klopt zolang er één bureau is" — maar die redenering was fout,
 * niet onvolledig. Ctrl PPC is de naam van het gereedschap; het voert geen taken uit en is nooit
 * verantwoordelijk voor iets. In de sprintplanning stond daardoor letterlijk "Ctrl PPC" in de
 * kolom Verantwoordelijke, alsof de software zelf het werk deed.
 *
 * De terugval is bovendien eerlijker dan een naam: hij zegt aan welke kant het werk ligt zonder
 * een bureaunaam te verzinnen die niemand heeft opgegeven. Zodra er een tenantveld met een echte
 * bureaunaam is, gaat die hier naar binnen en verandert er verder niets.
 */
export function ownerLabel(owner: string | null | undefined, bureauNaam: string = KANT_LABEL_INTERN): string {
  return isTeamOwner(owner) ? bureauNaam : KANT_LABEL_EXTERN;
}

// ── De toewijzing: wie precies ─────────────────────────────────────────────
//
// Hierboven staat de KANT (bureau of klant). Dit is de tweede as: wie binnen die kant. De twee
// staan bewust los, en dat is de hele reden dat dit werkt.
//
// Zou "Sanne" of "hun webbouwer" rechtstreeks in `owner` zijn beland, dan was elke specifiekere
// toewijzing meteen het antwoord kwijt op de vraag hoeveel werk er bij de klant ligt — want
// zo'n waarde lijkt op niets en valt door naar de klant-rol. Dat is hier al een keer gebeurd:
// zeven klantnamen en vier hypotheseteksten in de kolom tellen nu allemaal als klant-taak.
//
// Leeg is een geldige en gewone toestand: de taak ligt bij de kant als geheel. Daarom hoefde
// er bij migratie 033 geen enkele rij te worden aangepast.
//
// Voor de drie soorten geldt een andere bron, en dat is geen inconsistentie maar het verschil
// tussen intern en extern:
//
//   persoon  — een verwijzing naar auth.users. Alleen aan bureaukant bruikbaar: mensen aan
//              klantzijde loggen niet in en bestaan dus niet als gebruiker.
//   functie  — vrije tekst. De app-rollen zijn suggesties aan bureaukant, geen keuzelijst:
//              die rollen gaan over rechten in het dashboard, niet over wie werk uitvoert, en
//              aan klantzijde bestaan functies als "webdeveloper" die daar nooit in staan.
//   bedrijf  — vrije tekst. De naam van een externe partner, of van het bureau zelf.

export const EIGENAAR_SOORTEN = ["bedrijf", "functie", "persoon"] as const;
export type EigenaarSoort = (typeof EIGENAAR_SOORTEN)[number];

export interface Toewijzing {
  /** De opgeslagen kant. Wordt genormaliseerd; ruwe historische waarden mogen erin. */
  kant: string | null | undefined;
  soort: EigenaarSoort | null;
  /** De vrije tekst bij 'bedrijf' en 'functie'. Bij 'persoon' ongebruikt. */
  naam: string | null;
  /** De gebruiker bij 'persoon'. Bij de andere soorten ongebruikt. */
  userId: string | null;
}

/** Herkent een opgeslagen soort. Alles wat niet klopt wordt leeg — dus: de kant als geheel. */
export function normalizeSoort(soort: string | null | undefined): EigenaarSoort | null {
  const v = (soort ?? "").trim();
  return (EIGENAAR_SOORTEN as readonly string[]).includes(v) ? (v as EigenaarSoort) : null;
}

/**
 * Hoe de toewijzing op het scherm heet.
 *
 * Valt terug op de kant zodra de specifieke toewijzing ontbreekt of niet op te lossen is. Een
 * taak toont dus nooit een leeg vakje: in het slechtste geval staat er "Bureau" of "Klant", en
 * dat is nog steeds waar.
 *
 * Die terugval is niet theoretisch. `owner_user_id` heeft `on delete set null`, dus zodra
 * iemand uit dienst gaat verliezen zijn taken de persoon en houden ze de kant. En omdat
 * auth.users vandaag leeg is, is "wel een soort, geen oplosbare naam" nu de normale toestand
 * en niet de uitzondering.
 */
export function toewijzingLabel(
  t: Toewijzing,
  opties: { bureauNaam?: string; personen?: ReadonlyMap<string, string> } = {},
): string {
  // Geen eigen terugval hier: `undefined` doorgeven laat de standaard van ownerLabel gelden.
  // Er stond `?? OWNER_TEAM`, een tweede kopie van dezelfde beslissing — en die liep meteen uit
  // de pas toen het label van de kant "Intern" werd: ownerLabel gaf "Intern", deze regel gaf
  // nog "Bureau". De test viel erover, wat precies de bedoeling was.
  const kant = ownerLabel(t.kant, opties.bureauNaam);
  const soort = normalizeSoort(t.soort);
  if (soort === "persoon") {
    const naam = t.userId ? opties.personen?.get(t.userId) : undefined;
    return naam ?? kant;
  }
  if (soort === "bedrijf" || soort === "functie") {
    const naam = (t.naam ?? "").trim();
    return naam === "" ? kant : naam;
  }
  return kant;
}

/**
 * Is deze toewijzing houdbaar zoals hij is opgeslagen?
 *
 * 'persoon' zonder gebruiker, of 'functie'/'bedrijf' zonder tekst, is een half ingevuld veld.
 * Het label valt dan netjes terug op de kant, maar het scherm hoort te laten zien dat er iets
 * onaf is in plaats van te doen alsof de taak globaal is toegewezen.
 */
export function toewijzingCompleet(t: Toewijzing): boolean {
  const soort = normalizeSoort(t.soort);
  if (soort === null) return true;
  if (soort === "persoon") return t.userId != null && t.userId !== "";
  return (t.naam ?? "").trim() !== "";
}
