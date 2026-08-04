/**
 * De indeling binnen een sectie: welke blokken naast elkaar passen.
 *
 * ── HET PROBLEEM ────────────────────────────────────────────────────────────
 *
 * De pagina was `space-y-6`: elk blok op volle breedte, onder elkaar. Sectie() heeft het ritme
 * TUSSEN onderwerpen al opgelost (veel witruimte ertussen, weinig erbinnen), maar binnen een
 * sectie staat alles nog onder elkaar. Twaalf blokken van 1200 pixels breed lezen als één kolom,
 * ook als er zeven verschillende grafiekvormen in zitten -- vormvariatie wordt onzichtbaar zodra
 * er geen maatvariatie is.
 *
 * ── WAAROM GEEN VASTE SJABLONEN PER KANAALCOMBINATIE ────────────────────────
 *
 * Het lag voor de hand om een indeling per situatie te maken: één kanaal zó, twee kanalen zó.
 * Maar bij drie kanalen zijn er acht combinaties, niet drie, en het is niet alleen kanalen -- er
 * is ook wel/geen beurs, wel/geen geo-clones, wel/geen video. Dat vermenigvuldigt.
 *
 * En de verdeling maakt het beslissend. Gemeten op de 71 accounts: 62 alleen Google, 8 helemaal
 * niets, 1 alle drie. Een sjabloon voor "twee kanalen" zou vandaag NUL klanten bedienen en stil
 * verrotten, want niemand opent het en niemand ziet het dus scheeflopen.
 *
 * Vandaar één inpakker en geen acht sjablonen: elk blok zegt hoe breed het wil zijn en of het
 * voor déze klant iets te tonen heeft, en de indeling valt daaruit. Dat geeft vanzelf een andere
 * compositie per klant, ook voor combinaties waar niemand aan gedacht heeft.
 *
 * ── DE GROEIREGEL ───────────────────────────────────────────────────────────
 *
 * Zonder groei krijg je gaten. Een grafiek van 8 met een tabel van 4 ernaast is een nette rij;
 * valt die tabel weg omdat deze klant er geen data voor heeft, dan staat er een grafiek van 8 met
 * vier lege kolommen ernaast, en dat leest als een fout. Dus: wat overblijft in een rij wordt
 * verdeeld over de blokken die er staan.
 *
 * Gelijkmatig verdelen en niet alles aan de laatste geven: twee blokken die allebei 4 vroegen
 * horen 6 en 6 te worden, niet 4 en 8. Ze vroegen hetzelfde, dus ze krijgen hetzelfde.
 */

export const KOLOMMEN = 12;

export type Blok = {
  /** Sleutel voor React en voor de test. */
  id: string;
  /** Gewenste breedte in kolommen, 1..12. */
  span: number;
  /**
   * Hoe breed dit blok maximaal mag worden als er ruimte overblijft. Default 12.
   *
   * Nodig omdat groeien niet altijd beter is: een compacte cijfertegel die naar de volle breedte
   * wordt uitgerekt is een lege kaart met een getal in de hoek.
   */
  maxSpan?: number;
  /**
   * Heeft deze klant hier iets te tonen? False betekent: helemaal weglaten, ook geen lege kaart.
   * Default true.
   *
   * Dit MOET de aanroeper zeggen. Een blok dat zelf null rendert verdwijnt wel uit de DOM, maar
   * dan weet de inpakker het te laat en is de rij al verdeeld -- dan krijg je het gat alsnog.
   */
  heeftInhoud?: boolean;
};

export type GeplaatstBlok = { id: string; span: number };

function klem(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Verdeelt de overgebleven kolommen over de blokken in een rij.
 *
 * Gelijkmatig, met de rest naar de blokken vooraan -- die staan links en vangen het oog het eerst,
 * dus daar valt een kolom extra het minst op. Blokken die hun maxSpan al hebben bereikt doen niet
 * meer mee; blijft er daarna nog ruimte over, dan blijft die leeg. Dat is beter dan een tegel van
 * 200 pixels breed uitrekken tot 1200.
 */
function verdeelRest(rij: GeplaatstBlok[], maxima: Map<string, number>, rest: number): void {
  let over = rest;
  // Meerdere rondes: na een ronde kan een blok zijn maximum raken en valt hij af, waardoor er voor
  // de rest meer overblijft.
  while (over > 0) {
    const groeibaar = rij.filter((b) => b.span < (maxima.get(b.id) ?? KOLOMMEN));
    if (groeibaar.length === 0) return;
    const perStuk = Math.floor(over / groeibaar.length);
    if (perStuk === 0) {
      // Minder over dan er blokken zijn: één kolom per blok, vooraan beginnen.
      for (const b of groeibaar) {
        if (over === 0) return;
        b.span += 1;
        over -= 1;
      }
      continue;
    }
    for (const b of groeibaar) {
      const max = maxima.get(b.id) ?? KOLOMMEN;
      const groei = Math.min(perStuk, max - b.span);
      b.span += groei;
      over -= groei;
    }
  }
}

/**
 * Deelt de blokken in rijen van twaalf kolommen.
 *
 * Volgorde blijft de invoervolgorde: de leesvolgorde van een pagina is een redactionele keuze en
 * geen optimalisatieprobleem. Er wordt dus niet geschoven om gaten te vermijden -- er wordt
 * gegroeid.
 */
export function pakIn(blokken: readonly Blok[], kolommen: number = KOLOMMEN): GeplaatstBlok[][] {
  const zichtbaar = blokken.filter((b) => b.heeftInhoud !== false);
  if (zichtbaar.length === 0) return [];

  const maxima = new Map<string, number>();
  for (const b of zichtbaar) {
    maxima.set(b.id, klem(b.maxSpan ?? kolommen, 1, kolommen));
  }

  const rijen: GeplaatstBlok[][] = [];
  let rij: GeplaatstBlok[] = [];
  let gebruikt = 0;

  for (const b of zichtbaar) {
    const gewenst = klem(b.span, 1, kolommen);
    if (gebruikt + gewenst > kolommen && rij.length > 0) {
      verdeelRest(rij, maxima, kolommen - gebruikt);
      rijen.push(rij);
      rij = [];
      gebruikt = 0;
    }
    rij.push({ id: b.id, span: gewenst });
    gebruikt += gewenst;
  }
  if (rij.length > 0) {
    verdeelRest(rij, maxima, kolommen - gebruikt);
    rijen.push(rij);
  }
  return rijen;
}

/** De uitkomst als platte lijst, in dezelfde volgorde. Handig voor het renderen. */
export function pakInPlat(blokken: readonly Blok[], kolommen: number = KOLOMMEN): GeplaatstBlok[] {
  return pakIn(blokken, kolommen).flat();
}

/**
 * De Tailwind-klasse voor een breedte.
 *
 * Een opzoektabel en geen `col-span-${n}`: Tailwind scant de bron op letterlijke klassenamen, dus
 * een samengestelde naam bestaat niet in de uitvoer-CSS. Dat faalt stil -- het blok krijgt geen
 * breedte en valt terug op de volle rij, wat er precies uitziet als de indeling die we net
 * probeerden weg te halen.
 */
const SPAN_KLASSE: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};

export function spanKlasse(span: number): string {
  return SPAN_KLASSE[klem(Math.round(span), 1, KOLOMMEN)] ?? SPAN_KLASSE[KOLOMMEN];
}
