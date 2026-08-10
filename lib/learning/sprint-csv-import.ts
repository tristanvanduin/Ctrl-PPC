// Gedeelde CSV-import voor sprintplanningen. Tot deze module bestond, lazen twee schermen
// dezelfde kolomstructuur onafhankelijk van elkaar in: components/insights/sprint-planning.tsx
// (de importknop op het sprintbord) en components/dashboard/client-files.tsx (een upload in de
// map "Sprintplanning"). Ze waren uit de pas gaan lopen: alleen de sprintplanning-versie kende
// de Kant-kolom en normaliseerde de eigenaar via normalizeOwner; de bestanden-versie schreef
// Verantwoordelijke ongenormaliseerd weg. En de sprintplanning-versie eiste altijd een
// Taak-kolom, waardoor het "alleen hypotheses"-formaat (wel Hypothese, geen Taak) daar simpelweg
// niets importeerde -- geen foutmelding, gewoon nul rijen. Eén implementatie, twee aanroepers.
//
// DIT IS EEN MIGRATIETOOL, GEEN DOORLOPENDE SYNC. Een agency die al een sprintplan op papier of
// in een spreadsheet heeft, zet dat eenmalig over. Een kolom die ontbreekt levert dus gewoon
// null op (bestaand gedrag, hier bewaard), geen foutmelding en geen poging tot fuzzy-matching op
// een niet-standaard structuur. Oude CSV-bestanden zonder de kolom "Verwacht Resultaat" moeten
// onveranderd blijven importeren.
//
// "Verwacht Resultaat" / "Expected Result" is de nieuwe kolom die expected_result vult, zodat
// de H1-evaluator (lib/learning/hypothesis-parser.ts + de wekelijkse cron) geimporteerde
// hypotheses ook kan toetsen. Ontbreekt de kolom of is de waarde leeg, dan blijft
// expected_result null -- precies zoals een hypothese zonder expected_result vandaag al
// "unmeasurable" wordt in plaats van een gegokt verdict te krijgen.

import { OWNER_TEAM } from "../branding/brand";
import { normalizeOwner } from "../branding/brand";
import { dbInsert } from "../data-access/client-write";
import { parseHypothesis } from "./hypothesis-parser";

// ── Puur: tekst naar rijen ───────────────────────────────────────────────────

/** Ontleedt CSV-tekst met aanhalingsteken-behandeling (komma's en newlines binnen quotes). */
export function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());

  const rows: Record<string, string>[] = [];
  let currentRow: string[] = [];
  let inQuote = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!inQuote) currentRow = [];

    let field = inQuote ? currentRow[currentRow.length - 1] + "\n" : "";
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { currentRow.push(field); field = ""; }
      else { field += ch; }
    }
    if (inQuote) { currentRow[currentRow.length - 1] = field; continue; }
    currentRow.push(field);

    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = (currentRow[k] || "").trim();
    rows.push(obj);
  }
  return rows;
}

const veld = (row: Record<string, string>, ...sleutels: string[]): string | null => {
  for (const s of sleutels) {
    const v = row[s];
    if (v && v.trim()) return v.trim();
  }
  return null;
};

const schoon = (v: string | null): string | null =>
  v == null ? null : v.replace(/<|>/g, "").replace(/#N\/A/g, "").trim() || null;

const STATUS_MAP: Record<string, string> = {
  "Klaar": "done", "To Do": "todo", "in Planning": "in_planning",
  "On going": "ongoing", "Backlog / Verlopen": "expired", "Backlog": "backlog", "Verlopen": "expired",
};

export interface ParsedSprintTask {
  weekNumber: number | null;
  task: string;
  status: string;
  owner: string;
  metrics: string | null;
  reviewTimeframe: string | null;
}

export interface ParsedSprintHypothesis {
  hypothesis: string;
  measurementMetric: string | null;
  timeframe: string | null;
  expectedResult: string | null;
  status: "accepted" | "completed" | "pending";
  tasks: ParsedSprintTask[];
}

export interface ParsedSprintCsv {
  format: "full" | "hypotheses_only";
  hypotheses: ParsedSprintHypothesis[];
}

/**
 * Rijen naar gegroepeerde hypotheses, met formaatdetectie. "full" (met Taak-kolom) groepeert
 * per hypothese en bouwt de taken erbij; "hypotheses_only" (Hypothese zonder Taak) levert losse
 * voorstellen op, elk zonder taken en met status pending -- die horen eerst in de
 * goedkeuringswachtrij bij Bevindingen, niet meteen op het sprintbord.
 */
export function parseSprintCsv(text: string): ParsedSprintCsv {
  const rows = parseCsvRows(text);
  const hasTaskCol = rows.some((r) => veld(r, "Taak", "taak", "Task") != null);
  const hasHypCol = rows.some((r) => veld(r, "Hypothese", "hypothese") != null);

  if (!hasTaskCol && hasHypCol) {
    const hypotheses: ParsedSprintHypothesis[] = [];
    for (const row of rows) {
      const hypText = schoon(veld(row, "Hypothese", "hypothese"));
      if (!hypText) continue;
      hypotheses.push({
        hypothesis: hypText,
        measurementMetric: schoon(veld(row, "Metrics", "metrics")),
        timeframe: schoon(veld(row, "Looptijd", "looptijd", "Looptijd tot Beoordeling")),
        expectedResult: schoon(veld(row, "Verwacht Resultaat", "verwacht resultaat", "Expected Result", "expected result")),
        status: "pending",
        tasks: [],
      });
    }
    return { format: "hypotheses_only", hypotheses };
  }

  const bruikbareRijen = rows.filter((r) => veld(r, "Taak", "taak", "Task") != null);
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of bruikbareRijen) {
    const hyp = veld(row, "Hypothese", "hypothese") ?? "(geen hypothese)";
    if (!groups.has(hyp)) groups.set(hyp, []);
    groups.get(hyp)!.push(row);
  }

  const hypotheses: ParsedSprintHypothesis[] = [];
  for (const [hypothesis, taken] of groups) {
    const allDone = taken.every((t) => STATUS_MAP[t["Status"]] === "done");
    hypotheses.push({
      hypothesis: hypothesis === "(geen hypothese)" ? "Import: geen hypothese" : hypothesis,
      measurementMetric: veld(taken[0], "Metrics", "metrics"),
      timeframe: veld(taken[0], "Looptijd tot Beoordeling", "looptijd"),
      expectedResult: veld(taken[0], "Verwacht Resultaat", "verwacht resultaat", "Expected Result", "expected result"),
      status: allDone ? "completed" : "accepted",
      tasks: taken.map((t) => ({
        weekNumber: (() => { const w = veld(t, "Week", "week"); return w ? Number.parseInt(w, 10) || null : null; })(),
        task: veld(t, "Taak", "taak", "Task") ?? "(geen taak)",
        status: STATUS_MAP[veld(t, "Status", "status") ?? ""] ?? "todo",
        // De KANT komt uit "Kant" en niet uit "Verantwoordelijke". Dat onderscheid is de reden
        // dat de rommel in deze kolom ooit is ontstaan: die kolom bevat sinds de toewijzing een
        // persoons-, functie- of bedrijfsnaam, en die als kant terugschrijven maakt van elke
        // bureaupersoon stilzwijgend een klant-taak -- normalizeOwner kent de naam immers niet.
        // Oudere bestanden hebben geen Kant-kolom; daar stond wel een rol of bureaunaam in
        // Verantwoordelijke, en die wordt genormaliseerd.
        owner: normalizeOwner(veld(t, "Kant", "kant", "Verantwoordelijke", "verantwoordelijke") ?? OWNER_TEAM),
        metrics: veld(t, "Metrics", "metrics"),
        reviewTimeframe: veld(t, "Looptijd tot Beoordeling", "looptijd"),
      })),
    });
  }
  return { format: "full", hypotheses };
}

// ── IO: de geparste hypotheses wegschrijven ──────────────────────────────────

export interface SprintCsvImportSummary {
  format: "full" | "hypotheses_only";
  hypothesesImported: number;
  tasksImported: number;
  /** Geen Verwacht Resultaat-kolom of lege waarde: de H1-evaluator kan er nooit een verdict
   *  over vellen omdat er niets is om tegen te toetsen. */
  missingExpectedResult: number;
  /** Wel een Verwacht Resultaat, maar parseHypothesis() herkent er geen predicaat in (geen
   *  metric of geen richting). Ook deze blijft "unmeasurable" tot iemand de tekst aanscherpt. */
  unparseableExpectedResult: number;
}

export async function importSprintCsv(text: string, clientId: string): Promise<SprintCsvImportSummary> {
  const parsed = parseSprintCsv(text);
  let hypothesesImported = 0;
  let tasksImported = 0;
  let missingExpectedResult = 0;
  let unparseableExpectedResult = 0;

  for (const h of parsed.hypotheses) {
    if (!h.expectedResult) missingExpectedResult++;
    else if (!parseHypothesis({ expectedResult: h.expectedResult, measurementMetric: h.measurementMetric, timeframe: h.timeframe }).ok) {
      unparseableExpectedResult++;
    }

    const payload: Record<string, unknown> = {
      hypothesis: h.hypothesis,
      measurement_metric: h.measurementMetric,
      timeframe: h.timeframe,
      expected_result: h.expectedResult,
      status: h.status,
    };
    if (h.status === "accepted" || h.status === "completed") payload.accepted_at = new Date().toISOString();
    if (h.status === "pending") payload.source = "sprint_import";

    const { data: hypRows } = await dbInsert("sprint_hypotheses", clientId, payload);
    const hyp = hypRows?.[0] as { id: string } | undefined;
    if (!hyp) continue;
    hypothesesImported++;

    if (h.tasks.length === 0) continue;
    const sprintItems = h.tasks.map((t) => ({
      hypothesis_id: hyp.id,
      week_number: t.weekNumber,
      task: t.task,
      status: t.status,
      owner: t.owner,
      metrics: t.metrics,
      review_timeframe: t.reviewTimeframe,
    }));
    await dbInsert("sprint_items", clientId, sprintItems);
    tasksImported += sprintItems.length;
  }

  return { format: parsed.format, hypothesesImported, tasksImported, missingExpectedResult, unparseableExpectedResult };
}
