/**
 * SOP Analysis PDF renderer — Professional edition.
 *
 * Generates branded PDFs for weekly, bi-weekly, and monthly SOP analyses.
 * Uses @react-pdf/renderer (same as Second Opinion PDF).
 *
 * Structure per type:
 *   Weekly:    Cover page + analysis content
 *   Bi-weekly: Cover page + analysis content
 *   Monthly:   Cover page + findings table + recommendations + tasks + full analysis steps
 */

import React from "react";
import { BRAND_LOGO_FILE, BRAND_NAME } from "@/lib/branding/brand";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";
import type { FinalSopSynthesis, OperatingDetailLayer } from "@/lib/analysis/monthly-structured";
import { fixMojibake } from "@/lib/analysis/sanitize";

// Load brand logo as base64 (cached at module level)
let brandLogoDataUri: string | undefined;
try {
  const logoPath = path.join(process.cwd(), "public", "images", BRAND_LOGO_FILE);
  if (fs.existsSync(logoPath)) {
    brandLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  }
} catch { /* no logo */ }

// ── Types ─────────────────────────────────────────────────────────────────

type SopType = "weekly" | "biweekly" | "monthly";

interface SopFinding {
  title: string;
  description: string;
  severity: string;
  insight_type: string;
  affected_entity: string;
  affected_entity_type: string;
  metric: string;
  current_value: number | null;
  previous_value: number | null;
  change_pct: number | null;
  action_required: boolean;
}

interface SopRecommendation {
  hypothesis: string;
  expected_result: string;
  measurement_metric: string;
  timeframe: string;
  rationale: string;
  ice_impact: number;
  ice_confidence: number;
  ice_ease: number;
  ice_total: number;
  status: string;
}

interface SopTask {
  title: string;
  description: string;
  action_type: string;
  priority: string;
  frequency: string;
  due_date: string;
  affected_campaign: string | null;
  status: string;
}

export interface SopPdfProps {
  clientName: string;
  clientId: string;
  sopType: SopType;
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  /** Full markdown output (all types) */
  fullOutput: string;
  /** Monthly only: structured findings */
  findings?: SopFinding[];
  /** Monthly only: structured recommendations */
  recommendations?: SopRecommendation[];
  /** Monthly only: structured tasks */
  tasks?: SopTask[];
  /** Monthly only: strict executive SOP */
  finalSop?: FinalSopSynthesis;
  /** Monthly only: operating execution layer */
  operatingDetail?: OperatingDetailLayer;
  /** Monthly only: executive count alignment */
  executiveCounts?: {
    displayFindingsCount: number;
    criticalOrHighCount: number;
  };
  /** Monthly only: compact support appendices */
  coverageMarkdown?: string;
  appendixMarkdown?: string;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const orange = "#E87722";
const green = "#16a34a";
const greenLight = "#f0fdf4";
const greenBorder = "#bbf7d0";
const amber = "#d97706";
const amberLight = "#fffbeb";
const amberBorder = "#fde68a";
const red = "#dc2626";
const redLight = "#fef2f2";
const redBorder = "#fecaca";
const gray = "#6b7280";
const grayLight = "#f9fafb";
const grayBorder = "#e5e7eb";
// Brand Guide: het merkpalet
const dark = "#0A1628";        // Graphite (primair donker)
const blueDark = "#0F1D2F";    // Deep Navy
const blueLight = "#eff6ff";

const SEVERITY_COLOR: Record<string, string> = {
  critical: red,
  high: "#ea580c",
  medium: amber,
  low: gray,
  positive: green,
};

const SEVERITY_BG: Record<string, string> = {
  critical: redLight,
  high: "#fff7ed",
  medium: amberLight,
  low: grayLight,
  positive: greenLight,
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: red,
  high: "#ea580c",
  medium: amber,
  low: gray,
};

const SOP_TYPE_LABEL: Record<SopType, string> = {
  weekly: "Wekelijkse Analyse",
  biweekly: "Tweewekelijkse Analyse",
  monthly: "Maandelijkse Analyse",
};

const SOP_TYPE_SUBTITLE: Record<SopType, string> = {
  weekly: "Health check & bleeders",
  biweekly: "Campagne tracking & trends",
  monthly: "Volledige analyse met bevindingen, aanbevelingen & taken",
};

const MONTHLY_FINAL_SOP_HEADINGS = new Set([
  "primary thread",
  "root cause",
  "supporting evidence",
  "what is not the problem",
  "recommendations",
  "tasks",
  "qa self-check",
]);

const MONTHLY_OPERATING_DETAIL_HEADINGS = new Set([
  "operating detail: evidence trace",
  "operating detail: route-to-task mapping",
  "operating detail: hypotheses and next-month proof",
  "operating detail: execution detail",
  "operating detail: data gaps and validation notes",
  "operating detail: step-backed rationale",
]);

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: dark,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "bold", color: orange },
  subtitle: { fontSize: 9, color: gray, marginTop: 3 },
  brand: { fontSize: 13, fontWeight: "bold", color: orange },
  brandSub: { fontSize: 7, color: gray },
  divider: {
    height: 2,
    backgroundColor: orange,
    marginBottom: 14,
    borderRadius: 1,
  },
  // Stats
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 4,
    padding: 8,
    borderWidth: 0.5,
    borderColor: grayBorder,
    backgroundColor: grayLight,
    alignItems: "center",
  },
  statNumber: { fontSize: 20, fontWeight: "bold" },
  statLabel: { fontSize: 7, color: gray, marginTop: 1 },
  // Info card
  infoCard: {
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: grayBorder,
    backgroundColor: grayLight,
    marginBottom: 12,
  },
  infoTitle: { fontSize: 11, fontWeight: "bold", color: dark, marginBottom: 4 },
  infoText: { fontSize: 8, lineHeight: 1.5, color: gray },
  // Section header
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: orange,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 8,
    color: gray,
    marginBottom: 10,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: orange,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  tableHeaderText: { fontSize: 7, fontWeight: "bold", color: "white" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: grayBorder,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 18,
  },
  cellText: { fontSize: 7.5 },
  // Score bar (left edge)
  scoreBar: {
    width: 3,
    borderRadius: 1.5,
    marginRight: 4,
    minHeight: 14,
  },
  // ICE score badge
  iceBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  // Content block (for parsed markdown sections)
  contentBlock: {
    marginBottom: 8,
  },
  contentHeading: {
    fontSize: 10,
    fontWeight: "bold",
    color: dark,
    marginBottom: 4,
    marginTop: 8,
  },
  contentText: {
    fontSize: 8,
    lineHeight: 1.5,
    color: dark,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 6.5, color: gray },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function iceColor(score: number): string {
  if (score >= 8) return green;
  if (score >= 6) return amber;
  if (score >= 4) return "#ea580c";
  return red;
}

// Klant-PDF-tekst mag geen interne stap-/taaknummering bevatten (feedback op de eerste versie:
// "Steps 1, 6, 7, 13" / "Tasks 1, 2" zijn werkbenaming van de AI-pijplijn, geen informatie die
// een specialist iets zegt). Sommige al opgeslagen markdown (bv. coverage_markdown, dat "uit stap
// X, Y" in de tekst bakt) is van vóór deze opschoning; deze scrub vangt dat ook voor bestaande
// analyses, niet alleen nieuwe.
export function stripInternalRefs(text: string): string {
  return text
    .replace(/\s*(?:uit|via|in|op)?\s*stap(?:pen)?\s+\d+(?:\s*(?:,|en)\s*\d+)*/gi, "")
    .replace(/\s*\bsteps?\s+\d+(?:\s*(?:,|en|&)\s*\d+)*/gi, "")
    .replace(/\s*\btasks?\s+\d+(?:\s*(?:,|en|&)\s*\d+)*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const ROUTE_LABEL: Record<string, string> = {
  validation: "Valideer",
  containment: "Beperk",
  recovery: "Herstel",
  "controlled scale": "Schaal",
};

const ROUTE_COLOR: Record<string, string> = {
  validation: blueDark,
  containment: amber,
  recovery: green,
  "controlled scale": orange,
};

/**
 * Parse markdown output into sections (split on ## headings).
 * Returns array of { heading, content } objects.
 */
function parseMarkdownSections(
  md: string
): Array<{ heading: string; content: string }> {
  const lines = md.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    // Only split on ## headings (H2). Keep ### (H3) and deeper as content.
    // This preserves AI-generated sub-headings within each analysis step.
    const h2Match = line.match(/^#{1,2}\s+(.+)/);
    const isH3OrDeeper = line.match(/^#{3,}\s+/);

    if (h2Match && !isH3OrDeeper) {
      // Save previous section
      if (currentHeading || currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n").trim(),
        });
      }
      currentHeading = h2Match[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Push last section
  if (currentHeading || currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
    });
  }

  return sections.filter((s) => s.content.length > 0);
}

function groupAppendixSections(
  sections: Array<{ heading: string; content: string }>,
  maxCharsPerPage = 4000
): Array<Array<{ heading: string; content: string }>> {
  const groups: Array<Array<{ heading: string; content: string }>> = [];
  let currentGroup: Array<{ heading: string; content: string }> = [];
  let currentLength = 0;

  for (const section of sections) {
    const contentLength = section.content.length;
    if (currentGroup.length > 0 && currentLength + contentLength > maxCharsPerPage) {
      groups.push(currentGroup);
      currentGroup = [section];
      currentLength = contentLength;
      continue;
    }
    currentGroup.push(section);
    currentLength += contentLength;
  }

  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}

export function buildMonthlyPdfViewModel(props: SopPdfProps): {
  sections: Array<{ heading: string; content: string }>;
  executiveSections: Array<{ heading: string; content: string }>;
  operatingSections: Array<{ heading: string; content: string }>;
  appendixSections: Array<{ heading: string; content: string }>;
  findingsCount: number;
  recommendationsCount: number;
  tasksCount: number;
  stepBackedCount: number;
  usesFinalSop: boolean;
  usesOperatingDetail: boolean;
  includeStructuredTables: boolean;
} {
  const usesFinalSop = Boolean(props.finalSop);
  const usesOperatingDetail = Boolean(props.operatingDetail);
  const fullSections = parseMarkdownSections(props.fullOutput);
  const executiveSections = usesFinalSop
    ? parseMarkdownSections(props.finalSop?.markdown || props.fullOutput).filter((section) =>
        MONTHLY_FINAL_SOP_HEADINGS.has(section.heading.toLowerCase())
      )
    : fullSections.filter((section) => !MONTHLY_OPERATING_DETAIL_HEADINGS.has(section.heading.toLowerCase()));
  const operatingSections = usesOperatingDetail
    ? parseMarkdownSections(props.operatingDetail?.markdown || "").filter((section) =>
        MONTHLY_OPERATING_DETAIL_HEADINGS.has(section.heading.toLowerCase())
      )
    : fullSections.filter((section) => MONTHLY_OPERATING_DETAIL_HEADINGS.has(section.heading.toLowerCase()));
  const appendixSections = [
    ...parseMarkdownSections(props.coverageMarkdown || ""),
    ...parseMarkdownSections(props.appendixMarkdown || ""),
  ];
  const sections = executiveSections.concat(operatingSections);

  return {
    sections,
    executiveSections,
    operatingSections,
    appendixSections,
    findingsCount: props.executiveCounts?.displayFindingsCount ?? props.findings?.length ?? 0,
    recommendationsCount: props.finalSop?.recommendations.length ?? props.recommendations?.length ?? 0,
    tasksCount: props.finalSop?.tasks.length ?? props.tasks?.length ?? 0,
    stepBackedCount: props.operatingDetail?.step_backed_rationale.length ?? 0,
    usesFinalSop,
    usesOperatingDetail,
    includeStructuredTables: !usesFinalSop,
  };
}

/**
 * Clean markdown formatting for plain-text PDF rendering.
 * Strips **, *, `, ```, ---, and other markdown syntax.
 */
function cleanMarkdown(text: string): string {
  return fixMojibake(text)
    .replace(/```[\s\S]*?```/g, "") // remove code blocks
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // strip ALL markdown headings (###, ####, etc.)
    .replace(/^---+$/gm, "") // horizontal rules
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
    .replace(/^\|.*\|$/gm, "") // table rows
    .replace(/^[-:| ]+$/gm, "") // table separators
    // Null suppression — remove ALL visible null/undefined artifacts (order matters!)
    .replace(/null\s*\(was\s*null\)/gi, "n.v.t.") // "null (was null)" → "n.v.t."
    .replace(/n\.v\.t\.\s*\(was\s*null\)/gi, "n.v.t.") // "n.v.t. (was null)" → "n.v.t."
    .replace(/\(was\s*null\)/gi, "") // "(was null)" → remove
    .replace(/\(was\s*n\.v\.t\.\)/gi, "") // "(was n.v.t.)" → remove
    .replace(/:\s*null\b/gi, ": n.v.t.") // ": null" → ": n.v.t."
    .replace(/\bnull\b(?!\s*[)}\]])/gi, "n.v.t.") // standalone "null" → "n.v.t."
    .replace(/\bundefined\b/gi, "")
    .replace(/n\.v\.t\.\s*n\.v\.t\./g, "n.v.t.") // collapse double "n.v.t."
    .replace(/—\s*n\.v\.t\.\s*\./g, "— ") // clean trailing "— n.v.t.."
    // Terminology normalization
    .replace(/Belgium \(BE\)/g, "België")
    .replace(/Belgium/g, "België")
    .replace(/Search Lost IS \(budget\)/gi, "Search IS verlies (budget)")
    .replace(/Search Lost IS \(rank\)/gi, "Search IS verlies (rank)")
    .replace(/\n{3,}/g, "\n\n") // collapse multiple newlines
    .trim();
}

// ── Shared Components ──────────────────────────────────────────────────────

function Header({
  clientName,
  sopType,
  dateStr,
}: {
  clientName: string;
  sopType: SopType;
  dateStr: string;
}) {
  return [
    React.createElement(
      View,
      { key: "header", style: s.header },
      React.createElement(
        View,
        {},
        React.createElement(
          Text,
          { style: s.title },
          "SOP Analyse"
        ),
        React.createElement(
          Text,
          { style: s.subtitle },
          `${clientName}  |  ${SOP_TYPE_LABEL[sopType]}  |  ${dateStr}`
        )
      ),
      React.createElement(
        View,
        { style: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 } },
        brandLogoDataUri
          ? React.createElement(Image, { src: brandLogoDataUri, style: { height: 30, width: 30, objectFit: "contain" as const } })
          : null,
        React.createElement(
          View,
          { style: { alignItems: "flex-end" as const } },
          React.createElement(Text, { style: s.brand }, BRAND_NAME),
          React.createElement(Text, { style: s.brandSub }, "De #1 SEM specialist in de Benelux"),
        )
      )
    ),
    React.createElement(View, { key: "divider", style: s.divider }),
  ];
}

function Footer({
  clientName,
  sopType,
}: {
  clientName: string;
  sopType: SopType;
}) {
  return React.createElement(
    View,
    { style: s.footer, fixed: true },
    React.createElement(
      Text,
      { style: s.footerText },
      `${clientName}  |  ${SOP_TYPE_LABEL[sopType]}`
    ),
    React.createElement(View, { style: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 } },
      React.createElement(Text, {
        style: s.footerText,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Pagina ${pageNumber} / ${totalPages}  `,
      }),
      brandLogoDataUri
        ? React.createElement(Image, { src: brandLogoDataUri, style: { height: 14, width: 14, objectFit: "contain" as const } })
        : null,
    ),
  );
}

// ── PDF Document ───────────────────────────────────────────────────────────

function SopAnalysisPdf(props: SopPdfProps) {
  const {
    clientName,
    sopType,
    analysisDate,
    periodStart,
    periodEnd,
    fullOutput,
    findings = [],
    recommendations = [],
    tasks = [],
    finalSop,
    operatingDetail,
    executiveCounts,
  } = props;

  const dateStr = formatDate(analysisDate);
  const monthlyView = sopType === "monthly" ? buildMonthlyPdfViewModel(props) : null;
  const sections = monthlyView?.sections ?? parseMarkdownSections(fullOutput);
  const executiveSections = monthlyView?.executiveSections ?? sections;
  const operatingSections = monthlyView?.operatingSections ?? [];
  const appendixSections = monthlyView?.appendixSections ?? [];

  // Debug: log parsed sections to understand what the PDF renderer sees
  console.log(`[sop-pdf] Parsed ${sections.length} sections from fullOutput (${fullOutput.length} chars):`);
  for (const sec of sections) {
    console.log(`  - "${sec.heading}" (${sec.content.length} chars)`);
  }

  // Count severity for monthly
  const criticalCount = findings.filter(
    (f) => f.severity === "critical"
  ).length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const mediumCount = findings.filter((f) => f.severity === "medium").length;
  const positiveCount = findings.filter(
    (f) => f.severity === "positive"
  ).length;
  const actionCount = findings.filter((f) => f.action_required).length;
  const displayedFindingsCount = monthlyView?.findingsCount ?? findings.length;
  const displayedRecommendationsCount = monthlyView?.recommendationsCount ?? recommendations.length;
  const displayedTasksCount = monthlyView?.tasksCount ?? tasks.length;
  const displayedCriticalHighCount = monthlyView?.usesFinalSop
    ? (executiveCounts?.criticalOrHighCount ?? criticalCount + highCount)
    : criticalCount + highCount;

  const pages: React.ReactElement[] = [];

  // ══════════════════════════════════════════════════════════════════
  // PAGE 1: COVER / EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════
  const coverChildren: React.ReactElement[] = [
    ...Header({ clientName, sopType, dateStr }),

    // Type description card
    React.createElement(
      View,
      {
        key: "type-card",
        style: {
          ...s.infoCard,
          borderColor: orange,
          borderLeftWidth: 3,
        },
      },
      React.createElement(
        Text,
        { style: s.infoTitle },
        SOP_TYPE_LABEL[sopType]
      ),
      React.createElement(
        Text,
        { style: s.infoText },
        SOP_TYPE_SUBTITLE[sopType]
      ),
      React.createElement(
        Text,
        { style: { ...s.infoText, marginTop: 4 } },
        `Periode: ${formatDate(periodStart)} t/m ${formatDate(periodEnd)}`
      )
    ),
  ];

  // Stats row for monthly
  if (sopType === "monthly") {
    coverChildren.push(
      React.createElement(
        View,
        { key: "stats", style: s.statsRow },
        React.createElement(
          View,
          { style: s.statBox },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: dark } },
            String(displayedFindingsCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Bevindingen"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: redBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: red } },
            String(displayedCriticalHighCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Kritiek/Hoog"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: greenBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: green } },
            String(positiveCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Positief"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: amberBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: amber } },
            String(displayedRecommendationsCount)
          ),
          React.createElement(
            Text,
            { style: s.statLabel },
            "Aanbevelingen"
          )
        ),
        React.createElement(
          View,
          { style: { ...s.statBox, borderColor: grayBorder } },
          React.createElement(
            Text,
            { style: { ...s.statNumber, color: dark } },
            String(displayedTasksCount)
          ),
          React.createElement(Text, { style: s.statLabel }, "Taken")
        )
      )
    );

    // Priority summary blocks
    const criticalFindings = findings.filter(
      (f) => f.severity === "critical" && f.action_required
    );
    const highFindings = findings.filter(
      (f) => f.severity === "high" && f.action_required
    );

    if (monthlyView?.usesFinalSop && finalSop) {
      coverChildren.push(
        React.createElement(
          View,
          { key: "final-sop-summary", style: s.infoCard },
          React.createElement(Text, { style: s.infoTitle }, "Executive focus"),
          React.createElement(
            Text,
            { style: { ...s.infoText, color: dark } },
            stripInternalRefs(`${finalSop.primary_thread} ${finalSop.root_cause}`)
          )
        )
      );
    }

    // Prioriteiten-actietabel: bovenaan, direct onder de executive focus (feedback op de eerste
    // versie -- dit is het deel waar een specialist als eerste naar kijkt). Rechtstreeks uit
    // finalSop.recommendations, geen operatingDetail-tekst: die droeg "Tasks 1, 2 | Steps 1, 6, 7,
    // 13" mee, interne pijplijn-nummering die voor een klant niets betekent.
    if (monthlyView?.usesFinalSop && finalSop && finalSop.recommendations.length > 0) {
      coverChildren.push(
        React.createElement(
          View,
          { key: "priority-actions", style: { ...s.infoCard, backgroundColor: blueLight, padding: 0 } },
          React.createElement(
            View,
            { style: { padding: 12, paddingBottom: 0 } },
            React.createElement(Text, { style: s.infoTitle }, "Prioriteiten")
          ),
          React.createElement(
            View,
            { style: { ...s.tableHeader, marginHorizontal: 12, marginTop: 6 }, fixed: true },
            React.createElement(Text, { style: { width: "13%", ...s.tableHeaderText } }, "Route"),
            React.createElement(Text, { style: { width: "44%", ...s.tableHeaderText, paddingRight: 6 } }, "Actie"),
            React.createElement(Text, { style: { width: "43%", ...s.tableHeaderText } }, "Stoppen/doorgaan als")
          ),
          ...finalSop.recommendations.map((rec, i) =>
            React.createElement(
              View,
              {
                key: `prio-${i}`,
                style: { ...s.tableRow, marginHorizontal: 12, backgroundColor: i % 2 === 1 ? "white" : blueLight },
                wrap: false,
              },
              React.createElement(
                View,
                { style: { width: "13%" } },
                React.createElement(
                  Text,
                  {
                    style: {
                      fontSize: 7,
                      fontWeight: "bold",
                      color: "white",
                      backgroundColor: ROUTE_COLOR[rec.route] ?? gray,
                      paddingHorizontal: 4,
                      paddingVertical: 2,
                      borderRadius: 3,
                      alignSelf: "flex-start",
                    },
                  },
                  ROUTE_LABEL[rec.route] ?? rec.route
                )
              ),
              React.createElement(
                Text,
                { style: { width: "44%", ...s.cellText, fontWeight: "bold", paddingRight: 6 } },
                `[ ] ${stripInternalRefs(rec.handeling)}`
              ),
              React.createElement(Text, { style: { width: "43%", ...s.cellText, color: gray } }, stripInternalRefs(rec.beslisregel))
            )
          ),
          React.createElement(View, { style: { height: 8 } })
        )
      );
    } else if (criticalFindings.length > 0 || highFindings.length > 0) {
      const priorityItems: React.ReactElement[] = [];

      if (criticalFindings.length > 0) {
        priorityItems.push(
          React.createElement(
            View,
            {
              key: "crit-block",
              style: {
                flex: 1,
                borderRadius: 4,
                padding: 10,
                borderWidth: 0.5,
                borderColor: redBorder,
                backgroundColor: redLight,
              },
            },
            React.createElement(
              Text,
              {
                style: {
                  fontSize: 9,
                  fontWeight: "bold",
                  color: red,
                  marginBottom: 5,
                },
              },
              `Kritiek (${criticalFindings.length})`
            ),
            ...criticalFindings.slice(0, 5).map((f, i) =>
              React.createElement(
                View,
                {
                  key: `cf-${i}`,
                  style: {
                    flexDirection: "row",
                    marginBottom: 2.5,
                    paddingLeft: 2,
                  },
                },
                React.createElement(View, {
                  style: {
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 2,
                    marginRight: 5,
                    backgroundColor: red,
                  },
                }),
                React.createElement(
                  Text,
                  { style: { fontSize: 7.5, flex: 1, lineHeight: 1.3 } },
                  `${f.affected_entity}: ${f.metric} ${f.change_pct ? `(${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%)` : ""}`
                )
              )
            )
          )
        );
      }

      if (highFindings.length > 0) {
        priorityItems.push(
          React.createElement(
            View,
            {
              key: "high-block",
              style: {
                flex: 1,
                borderRadius: 4,
                padding: 10,
                borderWidth: 0.5,
                borderColor: amberBorder,
                backgroundColor: amberLight,
              },
            },
            React.createElement(
              Text,
              {
                style: {
                  fontSize: 9,
                  fontWeight: "bold",
                  color: amber,
                  marginBottom: 5,
                },
              },
              `Hoog (${highFindings.length})`
            ),
            ...highFindings.slice(0, 5).map((f, i) =>
              React.createElement(
                View,
                {
                  key: `hf-${i}`,
                  style: {
                    flexDirection: "row",
                    marginBottom: 2.5,
                    paddingLeft: 2,
                  },
                },
                React.createElement(View, {
                  style: {
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    marginTop: 2,
                    marginRight: 5,
                    backgroundColor: amber,
                  },
                }),
                React.createElement(
                  Text,
                  { style: { fontSize: 7.5, flex: 1, lineHeight: 1.3 } },
                  `${f.affected_entity}: ${f.metric} ${f.change_pct ? `(${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%)` : ""}`
                )
              )
            )
          )
        );
      }

      coverChildren.push(
        React.createElement(
          View,
          {
            key: "priority-row",
            style: { flexDirection: "row", gap: 10, marginBottom: 12 },
          },
          ...priorityItems
        )
      );
    }
  }

  // For weekly/biweekly: show first section as summary on cover
  if (sopType !== "monthly" && sections.length > 0) {
    const summaryText = cleanMarkdown(
      sections
        .slice(0, 2)
        .map((sec) => sec.content)
        .join("\n\n")
    );
    const truncated =
      summaryText.length > 1500
        ? summaryText.slice(0, 1500) + "..."
        : summaryText;

    coverChildren.push(
      React.createElement(
        View,
        { key: "summary-card", style: s.infoCard },
        React.createElement(
          Text,
          { style: s.infoTitle },
          "Samenvatting"
        ),
        React.createElement(
          Text,
          { style: { ...s.infoText, color: dark } },
          truncated
        )
      )
    );
  }

  coverChildren.push(
    Footer({ clientName, sopType })
  );

  pages.push(
    React.createElement(
      Page,
      {
        key: "cover",
        size: "A4",
        orientation: "landscape",
        style: s.page,
      },
      ...coverChildren
    )
  );

  if (sopType === "monthly" && monthlyView?.usesFinalSop && finalSop) {
    // Herontworpen na klantfeedback (19 aug 2026): de vorige versie dumpte de Operating Detail
    // Layer (interne evidence-traces/route-to-task-mapping/hypotheses-bewijs) en een ruw
    // stap-voor-stap-transcript (met letterlijke pijplijn-syntax als "A | executive_layer |
    // status KRITIEK | ...") in de klant-PDF -- 18 pagina's, grotendeels een datadump. Dit
    // vervangt beide door twee compacte pagina's op de al-gestructureerde finalSop-velden.
    const evidenceBullets = finalSop.supporting_evidence.slice(0, 6);
    const notProblemBullets = finalSop.what_is_not_the_problem.slice(0, 6);

    pages.push(
      React.createElement(
        Page,
        { key: "diagnose", size: "A4", orientation: "landscape", style: s.page, wrap: true },
        React.createElement(Text, { style: s.sectionTitle }, "Diagnose"),
        evidenceBullets.length > 0
          ? React.createElement(
              View,
              { key: "evidence", style: s.infoCard },
              React.createElement(Text, { style: s.infoTitle }, "Onderbouwing"),
              ...evidenceBullets.map((line, i) =>
                React.createElement(
                  View,
                  { key: `ev-${i}`, style: { flexDirection: "row", marginBottom: 3 } },
                  React.createElement(Text, { style: { ...s.infoText, marginRight: 4 } }, "•"),
                  React.createElement(Text, { style: { ...s.infoText, color: dark, flex: 1 } }, stripInternalRefs(line))
                )
              )
            )
          : null,
        notProblemBullets.length > 0
          ? React.createElement(
              View,
              { key: "not-problem", style: { ...s.infoCard, backgroundColor: grayLight } },
              React.createElement(Text, { style: s.infoTitle }, "Dit is NIET het probleem"),
              ...notProblemBullets.map((line, i) =>
                React.createElement(
                  View,
                  { key: `np-${i}`, style: { flexDirection: "row", marginBottom: 3 } },
                  React.createElement(Text, { style: { ...s.infoText, marginRight: 4 } }, "•"),
                  React.createElement(Text, { style: { ...s.infoText, color: dark, flex: 1 } }, stripInternalRefs(line))
                )
              )
            )
          : null,
        Footer({ clientName, sopType })
      )
    );

    if (finalSop.tasks.length > 0) {
      pages.push(
        React.createElement(
          Page,
          { key: "tasks", size: "A4", orientation: "landscape", style: s.page, wrap: true },
          React.createElement(Text, { style: s.sectionTitle }, "Taken"),
          React.createElement(
            Text,
            { style: s.sectionSubtitle },
            `${finalSop.tasks.length} taken, gekoppeld aan de prioriteiten op pagina 1.`
          ),
          ...finalSop.tasks.map((task, i) =>
            React.createElement(
              View,
              {
                key: `task-${i}`,
                style: { ...s.infoCard, marginBottom: 8, backgroundColor: i % 2 === 0 ? grayLight : "white" },
                wrap: false,
              },
              React.createElement(Text, { style: { ...s.infoTitle, fontSize: 9 } }, `[ ] ${stripInternalRefs(task.handeling)}`),
              React.createElement(
                Text,
                { style: { ...s.infoText, marginTop: 2 } },
                [task.object, task.meet_via].filter(Boolean).join("  •  ")
              ),
              task.beslisregel
                ? React.createElement(
                    Text,
                    { style: { ...s.infoText, marginTop: 2, color: dark } },
                    `Stoppen/doorgaan: ${stripInternalRefs(task.beslisregel)}`
                  )
                : null
            )
          ),
          Footer({ clientName, sopType })
        )
      );
    }

    const coverageAppendixSections = appendixSections.filter((sec) => !sec.heading.startsWith("Stap "));
    coverageAppendixSections.forEach((sec, index) => {
      pages.push(
        React.createElement(
          Page,
          { key: `appendix-coverage-${index}`, size: "A4", orientation: "landscape", style: s.page, wrap: true },
          React.createElement(Text, { style: s.sectionTitle }, "Data-dekking"),
          React.createElement(
            View,
            { style: { ...s.infoCard, backgroundColor: grayLight } },
            React.createElement(
              Text,
              { style: { ...s.infoText, color: dark } },
              stripInternalRefs(cleanMarkdown(sec.content)).slice(0, 6000)
            )
          ),
          Footer({ clientName, sopType })
        )
      );
    });
    // Operating Detail Layer (evidence-trace/route-to-task-mapping/hypotheses-bewijs) en het ruwe
    // stap-voor-stap-transcript zijn hier bewust NIET gerenderd: interne AI-validatielogica,
    // geen informatie die een specialist nodig heeft om te handelen.
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 2 — FINDINGS TABLE
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && findings.length > 0 && !monthlyView?.usesFinalSop) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "findings",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Bevindingen"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${findings.length} bevindingen  |  ${actionCount} vereisen actie  |  ${criticalCount} kritiek, ${highCount} hoog, ${mediumCount} medium, ${positiveCount} positief`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(Text, {
            style: { width: "3%", ...s.tableHeaderText },
          }),
          React.createElement(
            Text,
            { style: { width: "12%", ...s.tableHeaderText } },
            "Entiteit"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "Type"
          ),
          React.createElement(
            Text,
            { style: { width: "12%", ...s.tableHeaderText } },
            "Metric"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Huidig"
          ),
          React.createElement(
            Text,
            { style: { width: "7%", ...s.tableHeaderText } },
            "Verschil"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Ernst"
          ),
          React.createElement(
            Text,
            { style: { width: "6%", ...s.tableHeaderText } },
            "Actie"
          ),
          React.createElement(
            Text,
            { style: { width: "34%", ...s.tableHeaderText } },
            "Beschrijving"
          )
        ),

        // Finding rows
        ...findings.map((f, i) => {
          const bg = i % 2 === 1 ? grayLight : "white";
          const sevColor = SEVERITY_COLOR[f.severity] ?? gray;

          return React.createElement(
            View,
            {
              key: `f-${i}`,
              style: { ...s.tableRow, backgroundColor: bg },
              wrap: false,
            },
            React.createElement(View, {
              style: {
                ...s.scoreBar,
                backgroundColor: sevColor,
                width: "3%",
              },
            }),
            React.createElement(
              Text,
              {
                style: {
                  width: "12%",
                  ...s.cellText,
                  fontWeight: "bold",
                },
              },
              f.affected_entity?.slice(0, 25) ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "10%", ...s.cellText, color: gray } },
              f.affected_entity_type ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "12%", ...s.cellText } },
              f.metric ?? "-"
            ),
            React.createElement(
              Text,
              { style: { width: "8%", ...s.cellText } },
              f.current_value != null
                ? String(
                    Math.abs(f.current_value) >= 1000
                      ? Math.round(f.current_value).toLocaleString("nl-NL")
                      : Number(f.current_value.toFixed(2))
                  )
                : "-"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "7%",
                  ...s.cellText,
                  color:
                    f.change_pct != null
                      ? f.change_pct > 0
                        ? green
                        : red
                      : gray,
                  fontWeight: "bold",
                },
              },
              f.change_pct != null
                ? `${f.change_pct > 0 ? "+" : ""}${Math.round(f.change_pct)}%`
                : "-"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "8%",
                  ...s.cellText,
                  color: sevColor,
                  fontWeight: "bold",
                },
              },
              f.severity
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "6%",
                  ...s.cellText,
                  color: f.action_required ? red : gray,
                },
              },
              f.action_required ? "Ja" : "Nee"
            ),
            React.createElement(
              Text,
              {
                style: {
                  width: "34%",
                  ...s.cellText,
                  color: gray,
                },
              },
              (f.description ?? "").slice(0, 120)
            )
          );
        }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 3 — RECOMMENDATIONS WITH ICE SCORES
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && recommendations.length > 0 && !monthlyView?.usesFinalSop) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "recs",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Aanbevelingen"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${recommendations.length} aanbevelingen gesorteerd op ICE score (impact x vertrouwen x gemak)`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(
            Text,
            { style: { width: "4%", ...s.tableHeaderText } },
            "#"
          ),
          React.createElement(
            Text,
            { style: { width: "30%", ...s.tableHeaderText } },
            "Hypothese"
          ),
          React.createElement(
            Text,
            { style: { width: "20%", ...s.tableHeaderText } },
            "Verwacht resultaat"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "KPI"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Termijn"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "I"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "C"
          ),
          React.createElement(
            Text,
            { style: { width: "5%", ...s.tableHeaderText, textAlign: "center" } },
            "E"
          ),
          React.createElement(
            Text,
            { style: { width: "6%", ...s.tableHeaderText, textAlign: "center" } },
            "ICE"
          ),
          React.createElement(
            Text,
            { style: { width: "7%", ...s.tableHeaderText } },
            "Status"
          )
        ),

        // Sorted by ICE total descending
        ...[...recommendations]
          .sort((a, b) => b.ice_total - a.ice_total)
          .map((rec, i) => {
            const bg = i % 2 === 1 ? grayLight : "white";
            const iceCol = iceColor(rec.ice_total);

            return React.createElement(
              View,
              {
                key: `r-${i}`,
                style: { ...s.tableRow, backgroundColor: bg },
                wrap: false,
              },
              React.createElement(
                Text,
                {
                  style: {
                    width: "4%",
                    ...s.cellText,
                    color: gray,
                  },
                },
                String(i + 1)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "30%",
                    ...s.cellText,
                    fontWeight: "bold",
                  },
                },
                rec.hypothesis?.slice(0, 90) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "20%", ...s.cellText, color: gray } },
                rec.expected_result?.slice(0, 60) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "10%", ...s.cellText } },
                rec.measurement_metric ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText } },
                rec.timeframe ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_impact)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_confidence)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "5%",
                    ...s.cellText,
                    textAlign: "center",
                  },
                },
                String(rec.ice_ease)
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "6%",
                    ...s.cellText,
                    textAlign: "center",
                    fontWeight: "bold",
                    color: iceCol,
                  },
                },
                String(rec.ice_total)
              ),
              React.createElement(
                Text,
                { style: { width: "7%", ...s.cellText, color: gray } },
                rec.status ?? "open"
              )
            );
          }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // MONTHLY: PAGE 4 — TASKS
  // ══════════════════════════════════════════════════════════════════
  if (sopType === "monthly" && tasks.length > 0 && !monthlyView?.usesFinalSop) {
    pages.push(
      React.createElement(
        Page,
        {
          key: "tasks",
          size: "A4",
          orientation: "landscape",
          style: s.page,
          wrap: true,
        },
        React.createElement(
          Text,
          { style: s.sectionTitle },
          "Taken"
        ),
        React.createElement(
          Text,
          { style: s.sectionSubtitle },
          `${tasks.length} taken met deadlines en prioriteiten`
        ),

        // Table header
        React.createElement(
          View,
          { style: s.tableHeader, fixed: true },
          React.createElement(Text, {
            style: { width: "3%", ...s.tableHeaderText },
          }),
          React.createElement(
            Text,
            { style: { width: "22%", ...s.tableHeaderText } },
            "Taak"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Type"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Prioriteit"
          ),
          React.createElement(
            Text,
            { style: { width: "8%", ...s.tableHeaderText } },
            "Frequentie"
          ),
          React.createElement(
            Text,
            { style: { width: "10%", ...s.tableHeaderText } },
            "Deadline"
          ),
          React.createElement(
            Text,
            { style: { width: "14%", ...s.tableHeaderText } },
            "Campagne"
          ),
          React.createElement(
            Text,
            { style: { width: "27%", ...s.tableHeaderText } },
            "Beschrijving"
          )
        ),

        // Task rows sorted by priority
        ...[...tasks]
          .sort((a, b) => {
            const order: Record<string, number> = {
              critical: 0,
              high: 1,
              medium: 2,
              low: 3,
            };
            return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
          })
          .map((task, i) => {
            const bg = i % 2 === 1 ? grayLight : "white";
            const prioColor = PRIORITY_COLOR[task.priority] ?? gray;

            return React.createElement(
              View,
              {
                key: `t-${i}`,
                style: { ...s.tableRow, backgroundColor: bg },
                wrap: false,
              },
              React.createElement(View, {
                style: {
                  ...s.scoreBar,
                  backgroundColor: prioColor,
                  width: "3%",
                },
              }),
              React.createElement(
                Text,
                {
                  style: {
                    width: "22%",
                    ...s.cellText,
                    fontWeight: "bold",
                  },
                },
                task.title?.slice(0, 50) ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText, color: gray } },
                task.action_type ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "8%",
                    ...s.cellText,
                    color: prioColor,
                    fontWeight: "bold",
                  },
                },
                task.priority ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "8%", ...s.cellText } },
                task.frequency ?? "-"
              ),
              React.createElement(
                Text,
                { style: { width: "10%", ...s.cellText } },
                task.due_date
                  ? formatDate(task.due_date)
                  : "-"
              ),
              React.createElement(
                Text,
                { style: { width: "14%", ...s.cellText, color: gray } },
                task.affected_campaign?.slice(0, 30) ?? "-"
              ),
              React.createElement(
                Text,
                {
                  style: {
                    width: "27%",
                    ...s.cellText,
                    color: gray,
                  },
                },
                (task.description ?? "").slice(0, 100)
              )
            );
          }),

        Footer({ clientName, sopType })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // CONTENT PAGES — Full analysis text (all types)
  // ══════════════════════════════════════════════════════════════════
  // Filter out metadata sections (client, datum, periode, model, ---)
  const contentSections = sections.filter((sec) => {
    const h = sec.heading.toLowerCase();
    return (
      !h.includes("client:") &&
      !h.includes("datum:") &&
      !h.includes("periode:") &&
      !h.includes("model:") &&
      !(sopType === "monthly" && monthlyView?.usesFinalSop) &&
      sec.content.length > 10
    );
  });

  console.log(`[sop-pdf] ${contentSections.length} content sections after filtering (from ${sections.length} total)`);
  for (const sec of contentSections) {
    console.log(`  → "${sec.heading}" (${sec.content.length} chars)`);
  }

  if (contentSections.length > 0 && !(sopType === "monthly" && monthlyView?.usesFinalSop)) {
    // Each analysis step gets its own page(s) to prevent truncation
    for (let i = 0; i < contentSections.length; i++) {
      const sec = contentSections[i];
      const cleaned = cleanMarkdown(sec.content);
      // Allow up to 8000 chars per section (was 3000 — fits on 2 landscape pages)
      const text =
        cleaned.length > 8000
          ? cleaned.slice(0, 8000) + "\n\n[...ingekort voor PDF]"
          : cleaned;

      pages.push(
        React.createElement(
          Page,
          {
            key: `content-${i}`,
            size: "A4",
            orientation: "landscape",
            style: s.page,
            wrap: true,
          },
          ...(i === 0
            ? [React.createElement(Text, { style: s.sectionTitle }, "Volledige Analyse")]
            : []),
          React.createElement(
            View,
            { key: `sec-${i}`, style: s.contentBlock, wrap: true },
            React.createElement(
              Text,
              { style: s.contentHeading },
              sec.heading
            ),
            React.createElement(
              Text,
              { style: s.contentText },
              text
            )
          ),
          Footer({ clientName, sopType })
        )
      );
    }
  }

  return React.createElement(Document, {}, ...pages);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function renderSopPdf(opts: SopPdfProps): Promise<Buffer> {
  const doc = SopAnalysisPdf(opts);
  return await renderToBuffer(doc);
}
