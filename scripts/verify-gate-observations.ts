// Bewijst de eerste observatie-koppeling (fase 2, docs/MASTERPLAN.md) tegen echte data: dezelfde
// GateInput-opbouw als app/api/admin/kwaliteitspoorten/route.ts, maar dan door
// lib/decision/gate-observations.ts heen naar de echte tabel, met een echte klant/analysedatum.
// Ruimt de eigen testrijen op (op run_id) na afloop -- dit script mag de trendtabel niet vervuilen.
//
// Gebruik: npx tsx scripts/verify-gate-observations.ts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recordGateObservations } from "../lib/decision/gate-observations";
import type { GateInput } from "../lib/decision/quality-gates";
import type { KeywordQsRow } from "../lib/analysis/metric-cross-checks";

try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }
for (const regel of (() => { try { return readFileSync(".env.local", "utf8").split("\n"); } catch { return []; } })()) {
  const i = regel.indexOf("=");
  if (i <= 0 || regel.trimStart().startsWith("#")) continue;
  const naam = regel.slice(0, i).trim();
  if (process.env[naam] === undefined) process.env[naam] = regel.slice(i + 1).trim();
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.log("verify-gate-observations: overgeslagen (geen NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
    return;
  }
  const admin = createClient(url, serviceKey);

  const { data: laatste } = await admin
    .from("sop_insights").select("client_id, analysis_date")
    .order("analysis_date", { ascending: false }).limit(1).maybeSingle();
  if (!laatste) throw new Error("geen sop_insights-rijen gevonden");
  const clientId = String(laatste.client_id);
  const analysisDate = String(laatste.analysis_date);

  const [{ data: accountMonthly }, { data: campaignMonthly }, { data: keywordRows }, { data: structuredRun }, { data: klant }] = await Promise.all([
    admin.from("ads_account_monthly")
      .select("month, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId).order("month", { ascending: true }),
    admin.from("ads_campaign_monthly")
      .select("campaign_name, month, cost, conversions, conversions_value")
      .eq("client_id", clientId).order("month", { ascending: false }).limit(200),
    admin.from("ads_keyword_performance_monthly")
      .select("cost, quality_score, month")
      .eq("client_id", clientId).order("month", { ascending: false }).limit(500),
    admin.from("sop_analysis_output").select("output")
      .eq("client_id", clientId).eq("analysis_date", analysisDate).eq("section", "structured_monthly_v2")
      .maybeSingle(),
    admin.from("accounts").select("agency_id").eq("client_id", clientId).maybeSingle(),
  ]);

  let structured: { recommendations?: unknown[]; tasks?: unknown[]; findings?: unknown[]; coverage?: unknown[]; step_validations?: unknown[]; quality_gate?: { passed: boolean; state: string; blocking_reasons: string[] } } | null = null;
  if (structuredRun?.output) {
    try { structured = JSON.parse(structuredRun.output as string); } catch { structured = null; }
  }

  const runId = `verify-${Date.now()}`;
  const accountRijen = accountMonthly ?? [];
  const kwMaand = (keywordRows ?? []).reduce<string | undefined>((max, r) => {
    const m = String(r.month ?? "");
    return m && (!max || m > max) ? m : max;
  }, undefined);
  const kwLaatsteMaand = kwMaand ? (keywordRows ?? []).filter((k) => String(k.month ?? "") === kwMaand) : [];

  const gateInput: GateInput = {
    runId,
    agencyId: (klant?.agency_id as string | undefined) ?? "onbekend",
    accountId: clientId,
    analysisDate,
    dataQuality: accountRijen.length > 0 ? {
      accountMonthly: accountRijen.map((r) => ({
        month: String(r.month), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        cost: Number(r.cost ?? 0), conversions: Number(r.conversions ?? 0), conversions_value: Number(r.conversions_value ?? 0),
      })),
      campaignMonthly: (campaignMonthly ?? []).map((r) => ({
        campaign_name: String(r.campaign_name ?? ""), month: String(r.month),
        cost: Number(r.cost ?? 0), conversions: Number(r.conversions ?? 0), conversions_value: Number(r.conversions_value ?? 0),
      })),
      conversionLagDays: 3,
      lastCompleteMonth: accountRijen.length > 0 ? new Date(String(accountRijen[accountRijen.length - 1].month)).getUTCMonth() + 1 : 0,
      hasKpiTargets: true,
    } : undefined,
    rankLoss: kwLaatsteMaand.length > 0 ? {
      keywords: kwLaatsteMaand.map((k): KeywordQsRow => ({ cost: Number(k.cost ?? 0), quality_score: k.quality_score == null ? null : Number(k.quality_score) })),
      rankLostIs: 0,
    } : undefined,
    kpiChain: accountRijen.length >= 2 ? {
      previousMonth: accountRijen[accountRijen.length - 2] as unknown as Record<string, number>,
      currentMonth: accountRijen[accountRijen.length - 1] as unknown as Record<string, number>,
      resultMetric: "conversions",
    } : undefined,
    contradiction: (structured?.recommendations && structured.tasks)
      ? { recommendations: structured.recommendations as never, tasks: structured.tasks as never } : undefined,
    stepValidationsReport: structured?.step_validations as never,
    coverageReport: structured?.coverage as never,
    actionGating: (structured?.findings && structured.recommendations)
      ? { findings: structured.findings as never, recommendations: structured.recommendations as never } : undefined,
    publishReport: structured?.quality_gate
      ? { passed: structured.quality_gate.passed, state: structured.quality_gate.state, blockingReasons: structured.quality_gate.blocking_reasons } : undefined,
  };

  await recordGateObservations(admin, gateInput);

  const { data: opgeslagen, error } = await admin
    .from("quality_gate_observations").select("gate_name, status, reason").eq("run_id", runId);
  if (error) throw new Error(`lezen mislukt: ${error.message}`);

  console.log(`${clientId} / ${analysisDate} -- ${(opgeslagen ?? []).length} poortresultaten weggeschreven:\n`);
  for (const r of opgeslagen ?? []) {
    console.log(`  ${r.status.padEnd(5)} ${r.gate_name}: ${String(r.reason).slice(0, 90)}`);
  }

  await admin.from("quality_gate_observations").delete().eq("run_id", runId);
  const { count } = await admin.from("quality_gate_observations").select("*", { count: "exact", head: true }).eq("run_id", runId);
  console.log(`\nOpgeruimd (testrijen resterend voor deze run_id: ${count ?? 0}).`);

  if ((opgeslagen ?? []).length !== 9) {
    console.log(`\nFOUT: verwachtte 9 poortresultaten, kreeg ${(opgeslagen ?? []).length}.`);
    process.exit(1);
  }
  console.log("\nOK  alle negen poorten leverden een resultaat op en landden in quality_gate_observations.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
