"use client";

// De sparkline — één huis.
//
// Er stonden er twee, en ze verschilden op precies het punt dat telt: de basislijn. Die in het
// portfolio-scorebord schaalde vanaf nul (`v / max`), die in de creative-deep-dive vanaf het
// laagste punt (`(v - min) / (max - min)`). Datzelfde lijntje zegt daardoor twee dingen: bij de
// eerste lees je hoe groot iets is, bij de tweede hoe grillig het verloopt. Een reeks die van 1000
// naar 1050 loopt is in de ene vorm een kaarsrechte streep en in de andere een steile klim.
//
// Allebei zijn ze goed — voor een andere grootheid. Een volume (conversies, omzet, spend) hoort
// vanaf nul, want de hoogte ís de betekenis. Een verhouding (CTR, ROAS, frequentie) hoort op zijn
// eigen bereik, want daar gaat het om de beweging en zou nul de vorm platdrukken. Dus geen keuze
// tussen de twee, maar één component waar de aanroeper de basislijn benoemt.
//
// Waarom het niet via recharts loopt: dit is een lijn van hooguit tachtig pixels zonder assen,
// tooltip of legenda. Een grafiekbibliotheek eromheen zou meer wegen dan het lijntje zelf, en deze
// staat in tabelcellen die er tientallen tegelijk tonen.

/** Vanaf nul (een volume) of op het eigen bereik (een verhouding). */
export type SparkBasis = "nul" | "bereik";

/**
 * De schaal van de reeks. Apart van de opmaak, want dít is het stuk dat fout kan gaan: een vlakke
 * reeks heeft een bereik van nul, en delen door nul geeft NaN — waarna de lijn zonder foutmelding
 * verdwijnt.
 */
export function sparkSchaal(waarden: number[], basis: SparkBasis): { min: number; max: number; bereik: number } {
  const max = Math.max(...waarden);
  // Vanaf nul, tenzij er negatieve waarden zijn: dan is nul niet de bodem en zou de lijn buiten
  // het vlak vallen.
  const min = basis === "nul" ? Math.min(0, ...waarden) : Math.min(...waarden);
  return { min, max, bereik: max - min || 1 };
}

export interface SparkPunt { x: number; y: number }

/**
 * De reeks omgerekend naar coördinaten, in stukken geknipt op de gaten.
 *
 * De x-positie volgt de index in de volledige reeks en niet de plek in de overgebleven punten:
 * anders schuift alles na een gat naar links en klopt de tijdas niet meer.
 */
export function sparkPunten(
  punten: (number | null)[],
  basis: SparkBasis,
  breedte: number,
  hoogte: number,
  marge = 2,
): { stukken: SparkPunt[][]; laatste: SparkPunt | null } {
  const bruikbaar = (p: number | null | undefined): p is number => p != null && Number.isFinite(p);
  const echte = punten.filter(bruikbaar);
  if (echte.length === 0) return { stukken: [], laatste: null };

  const { min, bereik } = sparkSchaal(echte, basis);
  const stap = punten.length > 1 ? breedte / (punten.length - 1) : 0;
  const y = (v: number) => hoogte - marge - ((v - min) / bereik) * (hoogte - marge * 2);

  const stukken: SparkPunt[][] = [];
  let huidig: SparkPunt[] = [];
  let laatste: SparkPunt | null = null;
  punten.forEach((p, i) => {
    if (!bruikbaar(p)) { if (huidig.length) { stukken.push(huidig); huidig = []; } return; }
    const punt = { x: i * stap, y: y(p) };
    huidig.push(punt);
    laatste = punt;
  });
  if (huidig.length) stukken.push(huidig);
  return { stukken, laatste };
}

export function Sparkline({
  punten,
  basis = "nul",
  breedte = 80,
  hoogte = 24,
  kleur = "var(--brand-primary, #08288C)",
  titel,
}: {
  /** De reeks, oud naar nieuw. `null` is een gat: geen meting, geen nul. */
  punten: (number | null)[];
  basis?: SparkBasis;
  breedte?: number;
  hoogte?: number;
  kleur?: string;
  /** Wat er staat, in woorden — de lijn zelf is voor een schermlezer niets. */
  titel?: string;
}) {
  // Eén punt is geen verloop. Een streep tekenen zou een trend suggereren die er niet is.
  if (punten.filter((p) => p != null && Number.isFinite(p)).length < 2) {
    return <span className="text-micro text-muted-foreground">—</span>;
  }

  // Gaten breken de lijn: een reeks met een ontbrekende maand wordt in stukken getekend in plaats
  // van dwars over het gat heen. Doorverbinden zou een meting suggereren die er niet is.
  const { stukken, laatste } = sparkPunten(punten, basis, breedte, hoogte);

  return (
    <svg
      width={breedte}
      height={hoogte}
      viewBox={`0 0 ${breedte} ${hoogte}`}
      className="inline-block align-middle overflow-visible"
      role="img"
      aria-label={titel}
    >
      {stukken.map((stuk, i) => (
        stuk.length === 1
          // Een los punt tussen twee gaten: een polyline van één punt tekent niets.
          ? <circle key={i} cx={stuk[0].x.toFixed(2)} cy={stuk[0].y.toFixed(2)} r={1.5} fill={kleur} opacity={0.5} />
          : <polyline key={i} points={stuk.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
                      fill="none" stroke={kleur} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
      ))}
      {/* Het laatste punt is waar je staat; de rest is hoe je er kwam. Vandaar de volle kleur op
          het eindpunt en een gedempte lijn ervoor — dezelfde verhouding als in de stat-tile-
          specificatie, waar de reeks in de gedempte tint staat en het huidige punt in de accent. */}
      {laatste && <circle cx={laatste.x.toFixed(2)} cy={laatste.y.toFixed(2)} r={2} fill={kleur} />}
    </svg>
  );
}
