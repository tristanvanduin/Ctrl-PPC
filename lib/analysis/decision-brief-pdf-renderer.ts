// PDF-renderers voor de twee Decision Brief-documenten (masterplan 17.22). Zelfde bibliotheek en
// merkpalet als sop-pdf-renderer.ts (@react-pdf/renderer), React.createElement in een .ts-bestand
// (geen JSX/.tsx) -- zelfde conventie als de rest van de PDF-laag.

import React from "react";
import { BRAND_LOGO_FILE, BRAND_NAME } from "@/lib/branding/brand";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";
import type { ClientDecisionBrief, AgencyPortfolioBrief, MacroMatrixRow } from "./decision-brief";

const e = React.createElement;

let brandLogoDataUri: string | undefined;
try {
  const logoPath = path.join(process.cwd(), "public", "images", BRAND_LOGO_FILE);
  if (fs.existsSync(logoPath)) {
    brandLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  }
} catch { /* geen logo */ }

const orange = "#E87722";
const dark = "#0A1628";
const gray = "#6b7280";
const grayLight = "#f9fafb";
const grayBorder = "#e5e7eb";

const PRIORITY_COLOR: Record<string, string> = {
  Hoog: "#dc2626",
  Midden: "#d97706",
  Laag: "#6b7280",
};

const s = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 8.5, color: dark },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "bold", color: orange },
  subtitle: { fontSize: 8, color: gray, marginTop: 2 },
  brand: { fontSize: 11, fontWeight: "bold", color: orange },
  divider: { height: 2, backgroundColor: orange, marginBottom: 10, borderRadius: 1 },
  metaRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  metaText: { fontSize: 8.5, color: gray },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: orange, marginTop: 10, marginBottom: 6 },
  h3: { fontSize: 10.5, fontWeight: "bold", color: dark, marginTop: 8, marginBottom: 4 },
  bold: { fontWeight: "bold" },
  bullet: { fontSize: 8.5, lineHeight: 1.4, marginBottom: 3 },
  tableHeader: { flexDirection: "row", backgroundColor: orange, paddingVertical: 4, paddingHorizontal: 3, borderRadius: 2 },
  tableHeaderText: { fontSize: 6.5, fontWeight: "bold", color: "white" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: grayBorder, paddingVertical: 4, paddingHorizontal: 3, minHeight: 16 },
  cellText: { fontSize: 7 },
  priorityBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, alignSelf: "flex-start" },
  priorityText: { fontSize: 6.5, fontWeight: "bold", color: "white" },
  card: { padding: 8, borderRadius: 4, borderWidth: 0.5, borderColor: grayBorder, backgroundColor: grayLight, marginBottom: 8 },
  cardLabel: { fontSize: 6.5, fontWeight: "bold", color: gray, marginBottom: 1, textTransform: "uppercase" },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 6, color: gray },
});

function labeledBullet(label: string, value: string, key?: string | number) {
  return e(Text, { style: s.bullet, key }, e(Text, { style: s.bold }, `${label}: `), value);
}

function header(title: string, subtitle: string) {
  return e(
    View,
    { style: s.header },
    e(View, null, e(Text, { style: s.title }, title), e(Text, { style: s.subtitle }, subtitle)),
    e(
      View,
      { style: { alignItems: "flex-end" } },
      brandLogoDataUri ? e(Image, { src: brandLogoDataUri, style: { width: 70, height: 20, objectFit: "contain" } }) : null,
      e(Text, { style: s.brand }, BRAND_NAME)
    )
  );
}

function footer(label: string) {
  return e(
    View,
    { style: s.footer, fixed: true },
    e(Text, { style: s.footerText }, `${BRAND_NAME} — ${label}`),
    e(Text, { style: s.footerText, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${pageNumber} / ${totalPages}` })
  );
}

// ── DOCUMENT 1: Client Decision Brief (1 A4) ────────────────────────────────────────────────

export async function renderClientDecisionBriefPdf(brief: ClientDecisionBrief): Promise<Buffer> {
  const { sprintActions, decisionRule } = brief;

  const doc = e(
    Document,
    { title: `Decision Brief: ${brief.clientName}`, author: BRAND_NAME },
    e(
      Page,
      { size: "A4", style: s.page },
      header(`Decision Brief: ${brief.clientName}`, ""),
      e(View, { style: s.divider }),
      e(
        View,
        { style: s.metaRow },
        e(Text, { style: s.metaText }, e(Text, { style: s.bold }, "Periode: "), brief.period),
        e(Text, { style: s.metaText }, e(Text, { style: s.bold }, "Fase: "), brief.phase),
        e(
          View,
          null,
          e(View, { style: { ...s.priorityBadge, backgroundColor: PRIORITY_COLOR[brief.priority] ?? gray } }, e(Text, { style: s.priorityText }, brief.priority))
        )
      ),

      e(Text, { style: s.h3 }, "1. Diagnose"),
      e(
        View,
        { style: s.card },
        labeledBullet("Primary Thread", brief.primaryThread),
        labeledBullet("Root Cause", brief.rootCause),
        labeledBullet("What is NOT the problem", brief.whatIsNotTheProblem)
      ),

      e(Text, { style: s.h3 }, "2. Sprint-Acties"),
      e(
        View,
        { style: s.card },
        labeledBullet("Containment / Rem", sprintActions.containment ?? "Niet van toepassing."),
        labeledBullet("Validation / Recovery", sprintActions.validationRecovery ?? "Niet van toepassing."),
        labeledBullet("Controlled Scale", sprintActions.controlledScale ?? "Niet gedefinieerd.")
      ),

      e(Text, { style: s.h3 }, "3. Beslisregel & Falsificatie"),
      e(
        View,
        { style: s.card },
        decisionRule
          ? e(
              React.Fragment,
              null,
              labeledBullet("Evaluatievenster", decisionRule.evaluationWindow),
              labeledBullet("Accept if", decisionRule.acceptIf),
              labeledBullet("Reject / Rollback if", decisionRule.rejectIf)
            )
          : e(Text, { style: s.bullet }, "Geen beslisregel beschikbaar.")
      ),

      brief.portfolioContext.length > 0
        ? e(
            React.Fragment,
            null,
            e(Text, { style: s.h3 }, "Portfolio-context"),
            e(View, { style: s.card }, ...brief.portfolioContext.map((line, i) => e(Text, { style: s.bullet, key: i }, line)))
          )
        : null,

      footer("Decision Brief")
    )
  );
  return await renderToBuffer(doc);
}

// ── DOCUMENT 2: Agency Portfolio Brief ──────────────────────────────────────────────────────

function macroMatrix(rows: readonly MacroMatrixRow[]) {
  const widths = [0.2, 0.32, 0.15, 0.23, 0.1];
  const headerCells = ["Account / Regio", "Primaire Blokkade", "Fase", "Directe Kernactie", "Prioriteit"].map((label, i) =>
    e(Text, { key: label, style: { ...s.tableHeaderText, width: `${widths[i] * 100}%` } }, label)
  );
  const rowEls = rows.map((r, i) =>
    e(
      View,
      { style: s.tableRow, key: i },
      e(Text, { style: { ...s.cellText, width: `${widths[0] * 100}%`, fontWeight: "bold" } }, r.accountName),
      e(Text, { style: { ...s.cellText, width: `${widths[1] * 100}%` } }, r.primaryBlockage),
      e(Text, { style: { ...s.cellText, width: `${widths[2] * 100}%` } }, r.phase),
      e(Text, { style: { ...s.cellText, width: `${widths[3] * 100}%` } }, r.coreAction),
      e(
        View,
        { style: { width: `${widths[4] * 100}%` } },
        e(View, { style: { ...s.priorityBadge, backgroundColor: PRIORITY_COLOR[r.priority] ?? gray } }, e(Text, { style: s.priorityText }, r.priority))
      )
    )
  );
  return e(View, null, e(View, { style: s.tableHeader }, ...headerCells), ...rowEls);
}

export async function renderAgencyPortfolioBriefPdf(brief: AgencyPortfolioBrief): Promise<Buffer> {
  const syn = brief.portfolioSynthese;
  const synBullets = [
    syn?.sharedBlockage ? labeledBullet("Gedeelde Blokkade", syn.sharedBlockage, "shared") : null,
    syn?.exception ? labeledBullet("Uitzondering", syn.exception, "exception") : null,
    syn?.portfolioWarning ? labeledBullet("Portfolio Waarschuwing", syn.portfolioWarning, "warning") : null,
  ].filter(Boolean);

  const doc = e(
    Document,
    { title: "Agency Portfolio Brief", author: BRAND_NAME },
    e(
      Page,
      { size: "A4", style: s.page },
      header("Agency Portfolio Brief", `${brief.agencyName} — ${brief.generatedAt}`),
      e(View, { style: s.divider }),

      e(Text, { style: s.sectionTitle }, "Macro Matrix"),
      macroMatrix(brief.macroMatrix),

      e(Text, { style: s.sectionTitle }, "Portfolio Synthese"),
      synBullets.length > 0
        ? e(View, { style: s.card }, ...synBullets)
        : e(Text, { style: s.bullet }, "Geen cross-account-synthese beschikbaar voor dit bureau."),

      footer("Agency Portfolio Brief")
    )
  );
  return await renderToBuffer(doc);
}
