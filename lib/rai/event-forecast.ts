// R1 forecast per stream, strikt event-relatief. De kern: een event bouwt niet lineair op maar
// versnelt naar de beursdatum, dus een kalender-run-rate onderschat de eindstand. De eerlijke
// projectie gebruikt de vorige editie op GELIJKE dagen-uit als sjabloon: de groei die de vorige
// editie van D-x naar de beurs maakte, toegepast op waar deze editie nu op D-x staat. Alles
// ankert op dagen-tot-beurs (x). Nooit voorbij de beursdatum. Bouwt op event-time-axis.ts.

import {
  daysToFair,
  windowLengthDays,
  cumulativeThroughDaysOut,
  type Edition,
  type DailyPoint,
} from "./event-time-axis";
import { MATERIAL_WINDOW_DIFF } from "./event-time-axis";

export type ForecastMethod = "vorige_editie_sjabloon" | "vorige_editie_restvolume" | "tempo_extrapolatie" | "beurs_bereikt" | "geen_basis";
export type ForecastConfidence = "hoog" | "gemiddeld" | "laag" | "geen_basis";

export interface StreamForecast {
  method: ForecastMethod;
  daysToFairNow: number | null;
  currentCumulative: number;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  confidence: ForecastConfidence;
  note: string;
  /** Op hoeveel eerdere edities de projectie rust. */
  basedOnEditions: number;
  /**
   * De spreiding tussen die edities, als (hoogste - laagste) / mediaan van de tempo-ratio.
   * null bij minder dan twee edities. Een grote spreiding betekent dat de edities het
   * oneens zijn, en dat hoort zichtbaar te zijn in plaats van weggemiddeld.
   */
  editionSpread: number | null;
}

// Binnen dit deel van het venster (dicht bij de beurs) is de sjabloon-projectie het meest
// betrouwbaar, want er rest weinig curve om te extrapoleren.
const HIGH_CONFIDENCE_WINDOW_FRAC = 0.3;

// Een event bouwt extreem exponentieel op: het gros van de conversies valt pas in de laatste
// dagen/weken voor de beurs. Vroeg op die ramp staat er nog bijna niets, en dan is de
// tempo-ratio (eindstand ÷ stand-op-D-x) een deling door een piepklein getal — die explodeert
// bij ruis, en met een stand van 0 klapt de projectie juist naar 0. Pas als de vorige-editie-
// curve op D-x minstens dit deel van zijn eindstand had opgebouwd, vertrouwen we de ratio;
// daaronder ankeren we op het ABSOLUTE restvolume dat de vorige editie ná D-x nog opbouwde.
const RAMP_SIGNAL_FRAC = 0.15;

function round(v: number): number {
  return Math.round(v);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function withTarget(
  projectedFinal: number | null,
  target: number | null,
  base: Omit<StreamForecast, "projectedFinal" | "projectedVsTargetPct" | "willHitTarget" | "target" | "basedOnEditions" | "editionSpread"> &
    Partial<Pick<StreamForecast, "basedOnEditions" | "editionSpread">>,
): StreamForecast {
  const projectedVsTargetPct =
    projectedFinal != null && target != null && target > 0
      ? Math.round((projectedFinal / target) * 1000) / 1000
      : null;
  return {
    basedOnEditions: 0,
    editionSpread: null,
    ...base,
    projectedFinal,
    target,
    projectedVsTargetPct,
    willHitTarget: projectedVsTargetPct == null ? null : projectedVsTargetPct >= 1,
  };
}

// De forecast voor een stream. current en previous zijn al gefilterd op geo-clone en stream.
// previous mag null zijn (eerste editie).
export function forecastStream(input: {
  current: { edition: Edition; points: DailyPoint[] };
  /** De meest recente eerdere editie. Blijft werken; intern als lijst van een behandeld. */
  previous?: { edition: Edition; points: DailyPoint[] } | null;
  /**
   * ALLE eerdere edities, meest recente eerst. Hiermee rust de projectie op elke editie die
   * vergelijkbaar is in plaats van op de laatste. Zie priorEditionsFor in event-comparison.ts.
   */
  previousEditions?: { edition: Edition; points: DailyPoint[] }[];
  target: number | null;
  asOfDate: string;
}): StreamForecast {
  const { current, target, asOfDate } = input;
  // Meervoud wint; enkelvoud blijft werken voor bestaande aanroepers.
  const eerdere = input.previousEditions ?? (input.previous ? [input.previous] : []);
  const previous = eerdere[0] ?? null;
  const x = daysToFair(current.edition.fairStartDate, asOfDate);

  if (x == null) {
    return withTarget(null, target, { method: "geen_basis", daysToFairNow: null, currentCumulative: 0, confidence: "geen_basis", note: "geen geldige beurs- of peildatum" });
  }

  // Cumulatief tot nu. Voorbij de beurs (x <= 0) is de eindstand bekend.
  const clampX = Math.max(x, 0);
  const currentCumulative = cumulativeThroughDaysOut(current.points, current.edition, clampX);

  if (x <= 0) {
    return withTarget(currentCumulative, target, { method: "beurs_bereikt", daysToFairNow: x, currentCumulative, confidence: "hoog", note: "de beurs is bereikt, dit is de eindstand" });
  }

  // ── Sjabloon-pad over ALLE vergelijkbare edities ─────────────────────────
  //
  // Wat hier stond leunde op de meest recente editie alleen. Dat was op twee manieren fragiel.
  // Een enkele afwijkende editie werd in zijn eentje de norm — een verschoven datum, een jaar
  // dat om externe redenen niet representatief was. En als juist die ene editie een materieel
  // ander campagnevenster had, viel het hele sjabloon-pad weg en bleef er lineaire extrapolatie
  // over, terwijl de editie daarvoor prima vergelijkbaar was. De code zegt zelf dat lineair de
  // eindpiek onderschat, dus dat is niet "iets minder precies" maar systematisch te laag.
  //
  // Nu: elke editie met een vergelijkbaar venster levert een tempo-ratio, en we nemen de
  // MEDIAAN. Geen gemiddelde — een uitschieter mag de norm niet zetten, en dat is precies wat
  // we willen opvangen. Het aantal edities en hun spreiding gaan mee naar buiten, zodat een
  // projectie die op een enkele vergelijking rust te onderscheiden is van een die op vier rust.
  const curWindow = windowLengthDays(current.edition);

  interface EditieSignaal { id: string; ratio: number; restVolume: number; materializedFrac: number }
  const signalen: EditieSignaal[] = [];
  const restVolumes: { id: string; rest: number; frac: number }[] = [];

  for (const eerder of eerdere) {
    const prevWindow = windowLengthDays(eerder.edition);
    const vergelijkbaar =
      curWindow != null && prevWindow != null && prevWindow > 0 &&
      Math.abs(curWindow - prevWindow) / prevWindow <= MATERIAL_WINDOW_DIFF;
    if (!vergelijkbaar) continue;

    const prevAtX = cumulativeThroughDaysOut(eerder.points, eerder.edition, x);
    const prevFinal = cumulativeThroughDaysOut(eerder.points, eerder.edition, 0);
    if (prevFinal <= 0) continue;

    const materializedFrac = prevAtX / prevFinal;
    const rest = Math.max(prevFinal - prevAtX, 0);
    restVolumes.push({ id: eerder.edition.editionId, rest, frac: materializedFrac });

    // Alleen edities die op D-x genoeg curve hadden leveren een betrouwbare ratio. Daaronder
    // is eindstand ÷ stand-op-D-x een deling door een piepklein getal.
    if (prevAtX > 0 && materializedFrac >= RAMP_SIGNAL_FRAC) {
      signalen.push({ id: eerder.edition.editionId, ratio: prevFinal / prevAtX, restVolume: rest, materializedFrac });
    }
  }

  const pct = (v: number) => Math.round(v * 100);
  const fracLeft = curWindow && curWindow > 0 ? x / curWindow : 1;

  if (signalen.length > 0) {
    const ratios = signalen.map((s) => s.ratio);
    const ratio = median(ratios);
    const projectedFinal = round(currentCumulative * ratio);
    const spread = ratios.length > 1 && ratio > 0
      ? Math.round(((Math.max(...ratios) - Math.min(...ratios)) / ratio) * 1000) / 1000
      : null;

    // Vertrouwen: dichter bij de beurs is zekerder, en meer edities die het eens zijn ook.
    // Een enkele editie kan nooit "hoog" halen — dan rust alles op een vergelijking.
    const dichtbij = fracLeft <= HIGH_CONFIDENCE_WINDOW_FRAC;
    const eensgezind = spread == null || spread <= 0.5;
    const confidence: ForecastConfidence =
      dichtbij && signalen.length >= 2 && eensgezind ? "hoog"
      : dichtbij || (signalen.length >= 2 && eensgezind) ? "gemiddeld"
      : "laag";

    const welk = signalen.length === 1
      ? `de curve van editie ${signalen[0].id}`
      : `de mediaan van ${signalen.length} eerdere edities (${signalen.map((s) => s.id).join(", ")})`;
    const spreidingTekst = spread != null
      ? `; spreiding tussen de edities ${pct(spread)}%${spread > 0.5 ? " — die zijn het onderling niet eens, behandel de projectie als richting" : ""}`
      : "";

    return withTarget(projectedFinal, target, {
      method: "vorige_editie_sjabloon",
      daysToFairNow: x,
      currentCumulative,
      confidence,
      basedOnEditions: signalen.length,
      editionSpread: spread,
      note: `geprojecteerd met ${welk} op gelijke dagen-uit (mediaan ${pct(median(signalen.map((s) => s.materializedFrac)))}% van de curve stond op D-${x})${spreidingTekst}`,
    });
  }

  // Vroeg op de ramp: geen enkele editie had op D-x genoeg opbouw voor een betrouwbare ratio.
  // Anker op het absolute restvolume dat die edities ná D-x nog maakten — mediaan, om dezelfde
  // reden. Expliciet laag-zeker.
  const bruikbaar = restVolumes.filter((r) => r.rest > 0);
  if (bruikbaar.length > 0) {
    const rest = median(bruikbaar.map((r) => r.rest));
    const projectedFinal = round(currentCumulative + rest);
    return withTarget(projectedFinal, target, {
      method: "vorige_editie_restvolume",
      daysToFairNow: x,
      currentCumulative,
      confidence: "laag",
      basedOnEditions: bruikbaar.length,
      editionSpread: null,
      note: `vroeg op de ramp: mediaan ${pct(median(bruikbaar.map((r) => r.frac)))}% van de curve stond op D-${x} bij ${bruikbaar.length === 1 ? `editie ${bruikbaar[0].id}` : `${bruikbaar.length} eerdere edities`}, dus geankerd op het restvolume (${round(rest)}) dat na D-${x} nog werd opgebouwd; wordt betrouwbaarder richting de beurs`,
    });
  }

  // Terugval: tempo-extrapolatie. Lineair vanaf de campagnestart naar de beurs. Expliciet
  // onzeker, want een event versnelt naar het einde en lineair onderschat dat.
  const daysElapsed = curWindow != null ? curWindow - x : null;
  if (daysElapsed == null || daysElapsed <= 0 || currentCumulative <= 0) {
    return withTarget(null, target, { method: "geen_basis", daysToFairNow: x, currentCumulative, confidence: "geen_basis", note: "te weinig verstreken venster om te projecteren" });
  }
  const pace = currentCumulative / daysElapsed;
  const projectedFinal = round(pace * (curWindow as number));
  const reason = previous ? "geen vergelijkbaar vorige-editie-venster" : "eerste editie, geen sjabloon";
  return withTarget(projectedFinal, target, {
    method: "tempo_extrapolatie",
    daysToFairNow: x,
    currentCumulative,
    confidence: "laag",
    note: `${reason}; lineaire extrapolatie onderschat waarschijnlijk de eindpiek`,
  });
}
