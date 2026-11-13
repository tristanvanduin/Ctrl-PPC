// Hoe een bevinding als inzicht op het scherm komt (sop_insights.title en .description), en welke
// waarschuwingen een run meegeeft. Puur, zodat de vorm getest kan worden zonder modelaanroep.
//
// Drie dingen die eerder misgingen (doorlichting 13 november):
//  1. "Account — cpa: 94.84 (was 45)" met in de titel "110.8%": 45 was het CPA-doel, geen vorige
//     week. De lezer zag een verdubbeling die er niet was. Het doel heet nu doel.
//  2. "(was null)" stond letterlijk in 29 beschrijvingen. Zonder vorige waarde valt het deel weg.
//  3. Een kerngetal dat nergens in de brondata staat kwam ongemarkeerd naar het scherm. Nu staat
//     er vooraan dat het niet te herleiden is, en welk getal.

import { MAATSTAF_LABEL, type DroppedItems, type Finding, type Recommendation, type Task } from "@/lib/schema/analysis-schema";
import { markeerTekst, nlGetal, toetsBevinding, toetsTekst, waardeInBron, type BevindingToets, type BronFeiten } from "./brondata-toets";

/** Voorvoegsel van de titel van een inzicht met een niet-herleidbaar kerngetal. */
export const NIET_HERLEIDBAAR_LABEL = "[niet herleidbaar]";

function getal(n: number | null | undefined): string {
  return typeof n === "number" ? nlGetal(n) : "geen waarde";
}

function maatstafLabel(f: Finding): string {
  return (f.benchmark_type && MAATSTAF_LABEL[f.benchmark_type]) || "doel";
}

export function bevindingTitel(f: Finding, toets?: BevindingToets | null): string {
  const heeftDoel = typeof f.target_value === "number";
  const verandering = typeof f.change_pct === "number" && f.change_pct !== 0
    ? `${f.change_pct > 0 ? "+" : ""}${nlGetal(f.change_pct)}%${heeftDoel ? ` t.o.v. ${maatstafLabel(f)}` : ""}`
    : "";
  const kern = `[Stap ${f.step}] ${f.entity_name}: ${f.metric}${verandering ? ` ${verandering}` : ""}`;
  const titel = toets?.kerngetalHerleidbaar === false ? `${NIET_HERLEIDBAAR_LABEL} ${kern}` : kern;
  return titel.slice(0, 80);
}

export function bevindingBeschrijving(f: Finding, toets?: BevindingToets | null): string {
  const delen = [`${f.entity_name} — ${f.metric}: ${getal(f.current_value)}`];
  if (typeof f.previous_value === "number") delen.push(` (was ${getal(f.previous_value)})`);
  if (typeof f.target_value === "number") delen.push(` tegenover ${maatstafLabel(f)} ${getal(f.target_value)}`);
  let tekst = delen.join("");
  if (f.cause) tekst += `. Oorzaak: ${f.cause}`;
  if (toets?.kerngetalHerleidbaar === false) {
    tekst = `Let op: het kerngetal ${getal(f.current_value)} komt niet voor in de data die de analyse kreeg, en is dus niet door de code bevestigd. ${tekst}`;
  }
  const overig = (toets?.nietHerleidbaar ?? []).filter((x) => !x.startsWith("kerngetal "));
  if (overig.length > 0) tekst += ` Niet teruggevonden in de brondata: ${overig.join("; ")}.`;
  return tekst;
}

/** De waarschuwing als het inlezen van de bevindingen iets liet vallen. Null als er niets afviel. */
export function afgevallenWaarschuwing(dropped: DroppedItems | null | undefined, behouden: number): string | null {
  const n = dropped?.counts.findings ?? 0;
  if (n === 0) return null;
  const reden = dropped?.reasons[0] ? ` Eerste reden: ${dropped.reasons[0]}` : "";
  return `${n} van de ${n + behouden} bevindingen vielen af bij het inlezen en staan niet bij Bevindingen.${reden}`;
}

// ── Wat een run is: geslaagd, geslaagd met waarschuwingen, of mislukt ──────────

/**
 * De weekly zette de job op "gereed" en gaf een 200, ook als de bevindingen niet te lezen waren
 * of het opslaan mislukte: de knop en de cron keken alleen naar res.ok, en een run met nul
 * opgeslagen bevindingen telde als gedraaid. Mislukt is nu: de bevindingen onleesbaar, of er
 * waren bevindingen en ze staan niet in de database. Nul bevindingen bij een leesbare uitvoer is
 * een geldige uitkomst (een rustige week), geen fout.
 */
export function extractieUitkomst(
  x: { findingsParseOk: boolean; findings: unknown[]; saved: boolean; saveError: string | null; waarschuwingen: string[] },
  gereedTekst: string,
): { mislukt: boolean; melding: string } {
  if (!x.findingsParseOk) {
    return { mislukt: true, melding: `Analyse niet afgerond: de bevindingen konden niet worden ingelezen. ${x.waarschuwingen.join(" ")}`.trim() };
  }
  if (x.findings.length > 0 && !x.saved) {
    return { mislukt: true, melding: `Analyse niet afgerond: de bevindingen zijn niet opgeslagen (${x.saveError ?? "onbekende fout"}).` };
  }
  if (x.waarschuwingen.length === 0) return { mislukt: false, melding: gereedTekst };
  return { mislukt: false, melding: `${gereedTekst} Let op: ${x.waarschuwingen.join(" ")}` };
}

// ── De brondata-toets over een hele extractie ────────────────────────────────

export interface ExtractieToets {
  /** Per bevinding (zelfde index) de uitkomst van de toets. */
  bevindingen: BevindingToets[];
  recommendations: Recommendation[];
  tasks: Task[];
  /** Hoeveel bevindingen een niet-herleidbaar kerngetal hebben. */
  bevindingenNietHerleidbaar: number;
  /** Hoeveel getallen in aanbevelingen en taken door een markering zijn vervangen. */
  cijfersNietHerleidbaar: number;
}

function waardenVan(f: Finding | undefined): number[] {
  if (!f) return [];
  return [f.current_value, f.previous_value, f.target_value ?? null].filter((x): x is number => typeof x === "number");
}

/**
 * Legt bevindingen, aanbevelingen en taken naast de brondata. De onderbouwing (hypothesis,
 * rationale) en de taaktekst krijgen een markering op elk getal dat niet te herleiden is.
 * expected_result bewust NIET: daar staat de drempel van het voorstel ("CPA onder € 40"), een
 * belofte en geen bewering over de data; die vervangen maakt het voorstel onmeetbaar.
 */
export function toetsExtractie(
  findings: Finding[],
  recs: Recommendation[],
  tasks: Task[],
  feiten: BronFeiten,
): ExtractieToets {
  // De doelen van deze extractie die zelf in de brondata staan: daartegen mag een percentage
  // afgezet zijn. Een doel dat het model verzon draagt niets.
  const doelen = [...new Set(findings
    .filter((f) => typeof f.target_value === "number" && waardeInBron(f.target_value, f.metric, feiten))
    .map((f) => f.target_value as number))];
  const bevindingen = findings.map((f) => toetsBevinding(f, feiten, doelen));
  let cijfers = 0;
  const markeer = (tekst: string, lokaal: number[]): string => {
    const getoetst = toetsTekst(tekst, feiten, [...lokaal, ...doelen]);
    cijfers += getoetst.filter((c) => !c.herleidbaar).length;
    return markeerTekst(tekst, getoetst);
  };
  const uitRecs = recs.map((r) => {
    const lokaal = waardenVan(r.finding_index != null ? findings[r.finding_index] : undefined);
    return { ...r, hypothesis: markeer(r.hypothesis, lokaal), rationale: markeer(r.rationale, lokaal) };
  });
  const uitTasks = tasks.map((t) => {
    const rec = recs[t.recommendation_index];
    const lokaal = waardenVan(rec?.finding_index != null ? findings[rec.finding_index] : undefined);
    return { ...t, title: markeer(t.title, lokaal), description: markeer(t.description, lokaal) };
  });
  return {
    bevindingen,
    recommendations: uitRecs,
    tasks: uitTasks,
    bevindingenNietHerleidbaar: bevindingen.filter((b) => b.kerngetalHerleidbaar === false).length,
    cijfersNietHerleidbaar: cijfers,
  };
}
