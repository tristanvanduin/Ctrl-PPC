/**
 * Waar land je, en waarom zijn dat twee verschillende antwoorden?
 *
 * ── DE VRAAG ────────────────────────────────────────────────────────────────
 *
 * De pacing-kaart zegt hoe hard je gaat ("3 per dag") en wat er nodig is ("6,8 per dag"). Wat er
 * niet stond is de vraag die daar meteen op volgt: en waar kom ik dan uit?
 *
 * ── WAAROM TWEE GETALLEN EN NIET EEN ────────────────────────────────────────
 *
 * OP DIT TEMPO is een rechte lijn: wat je tot nu toe haalde, plus je dagtempo maal de resterende
 * dagen. Dat is precies wat "op dit tempo" betekent en het is met de hand na te rekenen.
 *
 * VOLGENS DE PROGNOSE is het seizoensbewuste getal dat de forecast-engine al berekent
 * (adjustedAnnual). Die weet dat november niet op juli lijkt.
 *
 * Alleen het eerste tonen zou de prognose elders op het scherm tegenspreken: twee getallen die
 * allebei "het jaar" heten en niet hetzelfde zeggen. Alleen het tweede tonen laat de vraag "op dit
 * tempo" onbeantwoord en verstopt de aanname.
 *
 * Dus allebei, met het VERSCHIL als de eigenlijke boodschap. Loopt de prognose voor op de rechte
 * lijn, dan zit je piek nog voor je; loopt hij achter, dan heb je hem gehad. Dat is stuurbare
 * informatie, en het is precies wat een rechte lijn verzwijgt.
 *
 * ── HET DOEL IS NOG STEEDS GESCHAT ──────────────────────────────────────────
 *
 * Het percentage rekent tegen conv.annualTarget, en dat is vorig jaar x 1,10 uit
 * app/api/google-ads/client-data/route.ts -- er is nog geen scherm om een doel in te voeren. De
 * aanroeper hoort dat erbij te zetten; hier komt het als getal binnen en gaat het als getal weer
 * naar buiten.
 */

export type Landing = {
  /** Gerealiseerd + dagtempo x resterende dagen. De rechte lijn. */
  opTempo: number;
  /** Wat de forecast-engine ervan maakt, seizoen meegerekend. Null als die er niet is. */
  volgensPrognose: number | null;
  /** opTempo als deel van het doel, 0..oneindig. Null zonder doel. */
  deelVanDoel: number | null;
  /**
   * Hoeveel de prognose van de rechte lijn afwijkt, als fractie van de rechte lijn.
   * Positief = de prognose is hoger, dus het seizoen zit nog mee. Null als een van beide ontbreekt.
   */
  seizoensverschil: number | null;
};

export type Landingsinvoer = {
  gerealiseerd: number;
  tempoPerDag: number;
  dagenResterend: number;
  /** forecast.<metric>.kpi.adjustedAnnual, of null als er geen prognose is. */
  prognose?: number | null;
  /** Het jaardoel. 0 of ontbrekend betekent: geen doel, dus geen percentage. */
  doel?: number | null;
};

function eindig(v: unknown): number | null {
  // null en undefined EERST afvangen. Number(null) is 0, en dat is finite -- zonder deze regel
  // komt een ontbrekende prognose binnen als een prognose van nul, en dan meldt de kaart een
  // seizoensverschil van -100% waar er helemaal geen prognose is. Precies de fout die deze
  // codebase vaker maakte: afwezigheid die als een gemeten waarde binnenkomt.
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function berekenLanding(invoer: Landingsinvoer): Landing {
  const gerealiseerd = eindig(invoer.gerealiseerd) ?? 0;
  const tempo = Math.max(eindig(invoer.tempoPerDag) ?? 0, 0);
  // Negatieve resterende dagen zou de landing ONDER het gerealiseerde brengen, en dat kan niet:
  // wat binnen is, is binnen. Op of na de laatste dag is de landing gewoon wat er staat.
  const dagen = Math.max(eindig(invoer.dagenResterend) ?? 0, 0);

  const opTempo = gerealiseerd + tempo * dagen;

  const prognose = eindig(invoer.prognose ?? null);
  const doel = eindig(invoer.doel ?? null);

  return {
    opTempo,
    volgensPrognose: prognose,
    // Een doel van 0 of lager is geen doel; dan is er niets om een percentage van te nemen. Null
    // en geen 0: 0% zou lezen als "je haalt er niets van".
    deelVanDoel: doel !== null && doel > 0 ? opTempo / doel : null,
    // Delen door een landing van nul kan niet. Dan is er ook niets om een afwijking op te
    // betrekken -- zonder tempo en zonder realisatie is elk verschil oneindig.
    seizoensverschil: prognose !== null && opTempo > 0 ? (prognose - opTempo) / opTempo : null,
  };
}

/**
 * Hoe groot moet het seizoensverschil zijn voordat we het benoemen?
 *
 * Onder de vijf procent is het ruis: de prognose en de rechte lijn zijn twee modellen op dezelfde
 * data, en die lopen altijd een beetje uiteen. Een zin over elk verschil leert de lezer de zin
 * over te slaan, en dan mist hij hem op de dag dat er wél iets aan de hand is.
 */
export const SEIZOEN_DREMPEL = 0.05;

export function seizoensduiding(landing: Landing): string | null {
  const v = landing.seizoensverschil;
  if (v === null || Math.abs(v) < SEIZOEN_DREMPEL) return null;
  const pct = Math.round(Math.abs(v) * 100);
  return v > 0
    ? `De prognose ligt ${pct}% hoger dan de rechte lijn: het sterke seizoen moet nog komen.`
    : `De prognose ligt ${pct}% lager dan de rechte lijn: het sterke seizoen is geweest.`;
}
