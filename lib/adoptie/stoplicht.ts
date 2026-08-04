/**
 * Wordt de tool bij dit bureau eigenlijk gebruikt?
 *
 * Twee signalen samen, want elk apart liegt:
 *
 *   adoptie      hoeveel van de gekoppelde gebruikers is de laatste dertig dagen actief geweest.
 *                Eén bureau met twaalf licenties waarvan er twee inloggen betaalt voor tien
 *                mensen die het niet gebruiken. Dat is het gesprek dat je wilt voeren vóór de
 *                opzegging, niet erna.
 *
 *   stilte       hoe lang geleden er íemand is geweest. Een klein bureau kan honderd procent
 *                adoptie hebben en toch zes weken niets hebben gedaan; dan zegt dat percentage
 *                niets. Andersom is een groot bureau waar dagelijks iemand werkt niet in gevaar
 *                omdat de helft van de accounts slaapt.
 *
 * ── DE DREMPELS ZIJN EEN OORDEEL, GEEN METING ────────────────────────────────
 *
 * Ze staan hier op één plek en met een getal erbij zodat ze te betwisten zijn. Er is geen data om
 * ze op te ijken -- daarvoor moeten er eerst opzeggingen zijn geweest om tegen te vergelijken, en
 * die zijn er niet. Wie ze later op echte uitstroom kan ijken, hoort ze te vervangen.
 *
 * Wat ze NIET zijn: een voorspelling. Rood betekent "hier is iets aan de hand dat je wilt weten",
 * niet "deze klant zegt op".
 */

export type Licht = "groen" | "amber" | "rood" | "onbekend";

/** Vanaf welk aandeel actieve gebruikers het gezond oogt. */
export const ADOPTIE_GOED = 60;
/** Daaronder wordt het een aandachtspunt; nog lager is het een probleem. */
export const ADOPTIE_ZWAK = 25;
/** Hoeveel dagen stilte nog normaal is. Ruim een week, zodat vakantie geen alarm geeft. */
export const STIL_DAGEN_GOED = 14;
/** Daarboven is het niet meer "even druk". */
export const STIL_DAGEN_ZWAK = 30;

export interface BureauAdoptie {
  bureau: string;
  gekoppeld: number;
  actief: number;
  /** null als er geen gekoppelde gebruikers zijn: dan bestaat er geen adoptiegraad. */
  adoptie: number | null;
  laatstGezien: string | null;
}

export interface Oordeel {
  licht: Licht;
  /** Waarom dit licht brandt, in gewone taal. Een kleur zonder reden stuurt geen gesprek. */
  reden: string;
  dagenStil: number | null;
}

/** Hele dagen tussen een tijdstip en nu. Null als er nooit iets is geweest. */
export function dagenGeleden(iso: string | null, nu: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((nu.getTime() - t) / 86_400_000);
}

/**
 * Het oordeel over één bureau.
 *
 * Volgorde is significant. Eerst de gevallen waarin er niets te oordelen valt, dan de stilte, dan
 * pas de adoptiegraad -- want stilte overrulet een mooi percentage. Een bureau met één gebruiker
 * die zes weken weg is heeft 0 % adoptie én zes weken stilte; het is de stilte die het verhaal
 * vertelt.
 */
export function beoordeel(b: BureauAdoptie, nu: Date = new Date()): Oordeel {
  const stil = dagenGeleden(b.laatstGezien, nu);

  // Geen gekoppelde gebruikers is geen slecht nieuws maar een onbeantwoorde vraag. Dit grijs
  // maken in plaats van rood is het verschil tussen "hier is niemand" en "hier gebruikt niemand
  // het" -- en dat eerste is meestal een bureau dat nog moet worden ingericht.
  if (b.gekoppeld === 0) {
    return { licht: "onbekend", reden: "nog geen gebruikers gekoppeld", dagenStil: null };
  }
  if (stil === null) {
    return { licht: "rood", reden: `${b.gekoppeld} gebruiker(s) gekoppeld, nog nooit ingelogd`, dagenStil: null };
  }
  if (stil > STIL_DAGEN_ZWAK) {
    return { licht: "rood", reden: `al ${stil} dagen niemand actief`, dagenStil: stil };
  }

  const pct = b.adoptie ?? 0;
  if (stil > STIL_DAGEN_GOED) {
    return { licht: "amber", reden: `${stil} dagen geen activiteit`, dagenStil: stil };
  }
  if (pct < ADOPTIE_ZWAK) {
    return { licht: "rood", reden: `${b.actief} van ${b.gekoppeld} gebruikers actief`, dagenStil: stil };
  }
  if (pct < ADOPTIE_GOED) {
    return { licht: "amber", reden: `${b.actief} van ${b.gekoppeld} gebruikers actief`, dagenStil: stil };
  }
  return { licht: "groen", reden: `${b.actief} van ${b.gekoppeld} gebruikers actief`, dagenStil: stil };
}

/** Het zwaarste licht van een verzameling, voor een samenvatting bovenaan. */
export function zwaarste(lichten: readonly Licht[]): Licht {
  if (lichten.includes("rood")) return "rood";
  if (lichten.includes("amber")) return "amber";
  if (lichten.includes("groen")) return "groen";
  return "onbekend";
}
