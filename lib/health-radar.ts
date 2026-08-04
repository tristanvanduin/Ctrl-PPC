/**
 * De gezondheidsscore als vorm in plaats van als getal.
 *
 * ── WAAROM ──────────────────────────────────────────────────────────────────
 *
 * computeHealthScore() rekent vijf factoren uit -- Doelstelling, Efficiency, Trend, Budget,
 * Hygiëne -- en die worden vandaag samengeperst tot één donut met een cijfer erin. Vier vijfde van
 * wat we uitrekenen komt nooit op het scherm. Een account met 68 dat overal middelmatig is, en een
 * account met 68 dat uitstekend scoort op budget en faalt op hygiëne, zien er identiek uit.
 *
 * ── WAAROM EEN RADAR HIER WÉL MAG ───────────────────────────────────────────
 *
 * Een radar is meestal een slechte keuze: het omsloten oppervlak schaalt met het product van
 * naastgelegen assen, dus je verandert de vorm door de assen te herordenen zonder één cijfer aan te
 * raken. Een vorm die je met een kolomvolgorde kunt veranderen is geen meting.
 *
 * Hier gelden die bezwaren niet, om drie redenen die alle drie moeten kloppen:
 *
 *   1. Alle assen dragen DEZELFDE eenheid (0..maxScore per factor, altijd 20).
 *   2. De volgorde ligt vast in de bron (health-score.ts nummert ze 1 t/m 5) en mag hier niet
 *      gesorteerd worden. Zie SORTEREN VERBODEN hieronder.
 *   3. "Groot en in balans" is echt het doel. Een scheve vijfhoek is een diagnose.
 *
 * Vijf assen is ook het minimum waarbij een radar leest; bij drie krijg je een driehoek waarvan de
 * vorm meer over de driehoek zegt dan over de data.
 *
 * ── HET GAT ─────────────────────────────────────────────────────────────────
 *
 * Elke factor draagt een `assessed`-vlag, met deze opmerking in health-score.ts: "ontbrekende
 * kennis is geen slechte score en al helemaal geen nul". Een niet-beoordeelde as wordt daarom niet
 * naar het midden getrokken -- dat zou als een gemeten nul lezen -- maar krijgt géén punt. De
 * randen die eraan zouden hangen vervallen, en de vulling vervalt in zijn geheel.
 *
 * Die laatste regel is de belangrijkste. Een gevuld vlak beweert dat de figuur gesloten is, en dus
 * dat er op elke as een waarde staat. Zodra er één ontbreekt is dat onwaar, dus dan is er geen
 * vlak: alleen losse randen en punten. Dat leest onmiddellijk als "onvolledig" en het is
 * meetkundig eerlijk.
 */

/** Wat deze module van een factor nodig heeft. Losser dan HealthFactor, zodat de test zelf kan bouwen. */
export type RadarFactor = {
  name: string;
  score: number;
  maxScore: number;
  assessed: boolean;
};

export type RadarPunt = {
  as: string;
  /** Hoek in graden, met -90 bovenaan. */
  hoek: number;
  /** 0..1, of null als de as niet beoordeeld is. */
  waarde: number | null;
  /** Waar het datapunt staat. Null bij een niet-beoordeelde as: er is geen punt. */
  x: number | null;
  y: number | null;
  /** Waar de spaak eindigt. Altijd gevuld -- de as bestaat, ook als de waarde ontbreekt. */
  spaakX: number;
  spaakY: number;
  assessed: boolean;
};

/**
 * Onder dit aantal beoordeelde assen tonen we de radar niet.
 *
 * Twee punten en drie gaten is geen vorm; dat is ruis die eruitziet als een meting. De donut
 * ernaast zegt dan al "2 van 5 beoordeeld", en dat is het eerlijke antwoord. Relevant voor
 * Meta- en LinkedIn-klanten: de factor Hygiëne leunt op zoektermen en ad groups, die daar niet
 * bestaan, dus die kan er per definitie niet zijn.
 */
export const MIN_BEOORDEELDE_ASSEN = 3;

/** Genoeg om te tonen? */
export function magRadarTonen(factoren: readonly RadarFactor[]): boolean {
  return factoren.filter((f) => f.assessed).length >= MIN_BEOORDEELDE_ASSEN;
}

function graadNaarRad(graden: number): number {
  return (graden * Math.PI) / 180;
}

/**
 * Zet de factoren om in punten op een cirkel.
 *
 * ── SORTEREN VERBODEN ───────────────────────────────────────────────────────
 *
 * De volgorde van `factoren` wordt letterlijk overgenomen. Niet sorteren op score, niet op naam,
 * niet "even de beste vooraan". De hele reden dat deze radar mag bestaan, is dat de asvolgorde
 * vastligt; ga je sorteren, dan verandert de vorm van het account zonder dat er een cijfer
 * verandert, en dan is de vorm een illusie. health-score.ts levert ze in vaste volgorde aan.
 */
export function radarPunten(
  factoren: readonly RadarFactor[],
  straal: number,
  cx: number,
  cy: number
): RadarPunt[] {
  const n = factoren.length;
  if (n === 0) return [];
  const stap = 360 / n;

  return factoren.map((f, i) => {
    const hoek = -90 + i * stap;
    const rad = graadNaarRad(hoek);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Een maxScore van 0 zou delen door nul geven. Dan is de as niet te schalen en dus niet te
    // beoordelen, ongeacht wat de vlag zegt.
    const schaalbaar = f.maxScore > 0;
    const beoordeeld = f.assessed && schaalbaar;
    const waarde = beoordeeld ? Math.min(Math.max(f.score / f.maxScore, 0), 1) : null;

    return {
      as: f.name,
      hoek,
      waarde,
      x: waarde === null ? null : cx + straal * waarde * cos,
      y: waarde === null ? null : cy + straal * waarde * sin,
      spaakX: cx + straal * cos,
      spaakY: cy + straal * sin,
      assessed: beoordeeld,
    };
  });
}

/**
 * De randen van de figuur: alleen tussen twee ópeenvolgende beoordeelde assen.
 *
 * De ring loopt rond, dus de laatste as grenst aan de eerste. Een rand die aan een niet-beoordeelde
 * as raakt vervalt -- daar is het gat.
 */
export function radarRanden(punten: readonly RadarPunt[]): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const n = punten.length;
  if (n < 2) return [];
  const randen: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = punten[i];
    const b = punten[(i + 1) % n];
    if (a.x === null || a.y === null || b.x === null || b.y === null) continue;
    randen.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return randen;
}

/**
 * Het gevulde vlak, of null als er ook maar één as ontbreekt.
 *
 * Null en geen gedeeltelijke vulling: een vlak beweert een gesloten figuur, en dus een waarde op
 * elke as. Dat is bij een gat onwaar. Liever geen vulling dan een vulling die iets invult.
 */
export function radarVlak(punten: readonly RadarPunt[]): string | null {
  if (punten.length < 3) return null;
  if (punten.some((p) => p.x === null || p.y === null)) return null;
  return punten.map((p) => `${p.x!.toFixed(2)},${p.y!.toFixed(2)}`).join(" ");
}

/** De ringen van het web, als fracties van de straal. Vier stuks: 25/50/75/100. */
export const WEBRINGEN = [0.25, 0.5, 0.75, 1] as const;

/**
 * Een samenvatting in woorden, voor wie de vorm niet ziet.
 *
 * Een radar is voor een schermlezer niets: het is een polygoon. Deze zin komt in het aria-label,
 * zodat de inhoud er ook zonder de vorm is. Sterkste en zwakste beoordeelde as, plus wat ontbreekt.
 */
export function radarSamenvatting(factoren: readonly RadarFactor[]): string {
  const beoordeeld = factoren.filter((f) => f.assessed && f.maxScore > 0);
  if (beoordeeld.length === 0) return "Geen enkele factor kon beoordeeld worden.";

  const metRatio = beoordeeld.map((f) => ({ naam: f.name, ratio: f.score / f.maxScore }));
  const sterkst = metRatio.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const zwakst = metRatio.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const ontbreekt = factoren.filter((f) => !f.assessed || f.maxScore <= 0).map((f) => f.name);

  const delen = [
    `${beoordeeld.length} van ${factoren.length} factoren beoordeeld`,
    sterkst.naam === zwakst.naam
      ? `${sterkst.naam} op ${Math.round(sterkst.ratio * 100)}%`
      : `sterkst ${sterkst.naam} (${Math.round(sterkst.ratio * 100)}%), zwakst ${zwakst.naam} (${Math.round(zwakst.ratio * 100)}%)`,
  ];
  if (ontbreekt.length > 0) delen.push(`niet beoordeeld: ${ontbreekt.join(", ")}`);
  return `${delen.join(". ")}.`;
}
