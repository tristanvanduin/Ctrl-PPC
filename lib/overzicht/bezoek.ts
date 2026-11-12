// Het ijkpunt "sinds je vorige bezoek" (bouwplan fase 4): de regels, zonder React.
//
// WAT HET IS. Per klant, per browser: het moment waarop je VORIGE bezoek aan deze klant eindigde.
// Alles in het logboek dat daarna gebeurde is nieuw voor jou, en krijgt een markering.
//
// WAAROM NIET GEWOON "DE LAATSTE KEER DAT DE PAGINA LAADDE". Dan wist een herlaad de markering:
// je opent de klant, ziet drie nieuwe regels, drukt op F5 en ze zijn niet nieuw meer, terwijl je
// ze nog niet gelezen hebt. Het ijkpunt schuift daarom pas op als het bezoek VOORBIJ is: als je
// langer dan BEZOEK_VOORBIJ_NA_MS niet naar deze klant hebt gekeken. Tot dan is het hetzelfde
// bezoek, hoe vaak je ook herlaadt of van tabblad wisselt.
//
// Er worden twee tijdstippen bewaard:
//   gezien   het laatste moment dat deze klant in beeld was (bijgewerkt bij openen, bij het
//            verbergen van het tabblad en bij het verlaten van de pagina)
//   ijkpunt  het einde van het vorige bezoek: de `gezien` van toen het huidige bezoek begon
//
// Bij het EERSTE bezoek is er geen ijkpunt, en is er dus niets "nieuw": er valt niets te
// vergelijken, en alles markeren zou de markering betekenisloos maken.
//
// In localStorage, per browser. De servertabel klant_bezoeken (scripts/migrations/
// 109_klant_bezoeken.sql, klaargezet en nog niet toegepast of aangesloten) maakt er later een
// ijkpunt per gebruiker van, over apparaten heen.

/** Na zoveel tijd niet kijken is een bezoek voorbij. */
export const BEZOEK_VOORBIJ_NA_MS = 30 * 60_000;

export interface BezoekStand {
  /** Het einde van het vorige bezoek, ISO; null bij het eerste bezoek. */
  ijkpunt: string | null;
  /** Het laatste moment dat deze klant in beeld was, ISO. */
  gezien: string;
}

/** De sleutel in localStorage. */
export function bezoekSleutel(clientId: string): string {
  return `vorig-bezoek:${clientId}`;
}

const isTijd = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** De bewaarde stand, of null als er niets (of iets onleesbaars) staat. */
export function leesBezoek(ruw: string | null | undefined): BezoekStand | null {
  if (!ruw) return null;
  try {
    const v = JSON.parse(ruw) as { ijkpunt?: unknown; gezien?: unknown };
    if (!isTijd(v.gezien)) return null;
    return { ijkpunt: isTijd(v.ijkpunt) ? v.ijkpunt : null, gezien: v.gezien };
  } catch {
    return null;
  }
}

/**
 * De stand bij het openen van de klant (of bij het terugkomen op het tabblad).
 *
 * - Niets bewaard: het eerste bezoek. Geen ijkpunt.
 * - Langer dan BEZOEK_VOORBIJ_NA_MS niet gekeken: een nieuw bezoek. Het ijkpunt wordt het einde van
 *   het vorige (`gezien`).
 * - Anders: hetzelfde bezoek. Het ijkpunt blijft staan; een herlaad wist de markering niet.
 * Een klok die terugliep (`nu` vóór `gezien`) telt als hetzelfde bezoek.
 */
export function openBezoek(bewaard: BezoekStand | null, nu: string): { stand: BezoekStand; eerste: boolean; nieuwBezoek: boolean } {
  if (!bewaard) return { stand: { ijkpunt: null, gezien: nu }, eerste: true, nieuwBezoek: true };
  const weg = Date.parse(nu) - Date.parse(bewaard.gezien);
  if (weg > BEZOEK_VOORBIJ_NA_MS) return { stand: { ijkpunt: bewaard.gezien, gezien: nu }, eerste: false, nieuwBezoek: true };
  return { stand: { ijkpunt: bewaard.ijkpunt, gezien: nu }, eerste: bewaard.ijkpunt === null, nieuwBezoek: false };
}

/** De stand bij het verbergen of verlaten: alleen `gezien` schuift op, het ijkpunt nooit. Wie een
 *  uur naar de pagina kijkt en dan wegklikt, heeft één bezoek gehad dat nu eindigt. */
export function sluitBezoek(bewaard: BezoekStand | null, nu: string): BezoekStand {
  return { ijkpunt: bewaard?.ijkpunt ?? null, gezien: nu };
}

/** Is dit tijdstip van na het ijkpunt? Zonder ijkpunt (eerste bezoek) is niets nieuw. */
export function isNieuwSinds(tijd: string, ijkpunt: string | null): boolean {
  if (!ijkpunt) return false;
  const t = Date.parse(tijd), ijk = Date.parse(ijkpunt);
  return Number.isFinite(t) && Number.isFinite(ijk) && t > ijk;
}
