import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { renderSopPdf, type SopPdfProps } from "@/lib/analysis/sop-pdf-renderer";
import {
  validateFinalSopSynthesis,
  validateMonthlyDeliverableCompleteness,
  validateRenderedFinalSopMarkdown,
  type FinalSopSynthesis,
  type OperatingDetailLayer,
} from "@/lib/analysis/monthly-structured";
import type { CrossChannelSynthesisResult } from "@/lib/analysis/cross-channel-synthesis";
import type { PortfolioSynthesisResult } from "@/lib/analysis/portfolio-synthesis";
import { fetchGodViewComparison } from "@/lib/analysis/god-view-context";
import type { SopChannel } from "@/lib/analysis/sop-channel-config";
import {
  createProgressJob,
  markProgressCompleted,
  markProgressFailed,
  updateProgressPhase,
} from "@/lib/progress/server";
import { logger } from "@/lib/logger";

// sop_analysis_output/agency_analysis_output slaan "output" op als tekst (soms al als object
// terugkomend via de Supabase-client, afhankelijk van de kolomconfiguratie) -- zelfde
// dubbelvorm als parsedStructuredOutput hieronder, nu als kleine herbruikbare helper voor de
// twee nieuwe externe-context-fetches.
function parseJsonOutput<T>(raw: unknown): T | null {
  if (raw == null) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

// De negen sop_type-waarden die de analyse-routes daadwerkelijk schrijven: Google's drie
// kale namen, en Meta/LinkedIn's kanaal-voorvoegsel-varianten (zie sop-trigger-buttons.tsx
// CHANNEL_CONFIG). Elke maandvariant (monthly/meta_monthly/linkedin_monthly) krijgt hieronder de
// verrijkte structured-data-tak: alle drie draaien via dezelfde finalizeChannelMonthlySynthesis en
// hebben dus een geldige "full"-sectie mét final_sop (geverifieerd 20 augustus, zie de toelichting
// bij "if (baseType === "monthly")" hieronder -- stond eerst op de letterlijke string "monthly",
// dus alleen Google, terwijl Meta/LinkedIn's data allang klaarstond).
// Live gevonden (20 aug 2026): sop_insights/sop_recommendations HEBBEN allebei al een sop_type-
// kolom, maar de queries hieronder filterden er niet op -- alleen op client_id + analysis_date.
// Met meerdere kanalen/testruns op dezelfde dag (persistMonthlyStructuredData() schrijft naar
// sop_insights voor alle drie kanalen) leverde dat voor demo-greentech 258 samengevoegde rijen
// op, incl. LinkedIn-content ("Lead Gen Form Completion") in wat een Google-PDF hoorde te zijn --
// de "Positief"-tegel op pagina 1 telde die hele pool, niet alleen deze analyse. Nu .eq("sop_type",
// sopType) op beide queries.
const VALID_SOP_TYPES = [
  "weekly", "biweekly", "monthly",
  "meta_weekly", "meta_biweekly", "meta_monthly",
  "linkedin_weekly", "linkedin_biweekly", "linkedin_monthly",
] as const;
type PdfSopType = typeof VALID_SOP_TYPES[number];

// Welk kanaal bij welke maand-sopType hoort, voor de God View-marktbenchmark (fetchGodViewComparison
// vraagt een expliciet SopChannel). Alleen de drie maandvarianten hebben een entry -- weekly/
// biweekly krijgen sowieso geen marktbenchmark, dus hoeven hier niet in te staan.
const MONTHLY_SOP_TYPE_TO_CHANNEL: Partial<Record<PdfSopType, SopChannel>> = {
  monthly: "google_ads",
  meta_monthly: "meta_ads",
  linkedin_monthly: "linkedin_ads",
};

/**
 * GET /api/analysis/pdf?client_id=xxx&sop_type=weekly|biweekly|monthly|meta_weekly|...&client_name=yyy
 *
 * Generates and returns a PDF for the most recent SOP analysis.
 * Also saves the PDF to Supabase Storage and links it in client_files.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = request.nextUrl.searchParams.get("client_id");
  const sopTypeParam = request.nextUrl.searchParams.get("sop_type");
  const clientName = request.nextUrl.searchParams.get("client_name") || clientId || "Onbekend";
  const jobId = request.nextUrl.searchParams.get("job_id") || crypto.randomUUID();

  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });
  if (!sopTypeParam || !(VALID_SOP_TYPES as readonly string[]).includes(sopTypeParam)) {
    return Response.json({ error: `sop_type parameter vereist (${VALID_SOP_TYPES.join("|")})` }, { status: 400 });
  }
  const sopType = sopTypeParam as PdfSopType;

  await createProgressJob(supabase, {
    jobId,
    clientId,
    jobType: "pdf_generation",
    initialMessage: "SOP PDF wordt voorbereid...",
    metadata: { source: "sop", sop_type: sopType },
  });
  await updateProgressPhase(supabase, {
    jobId,
    phaseKey: "fetch_inputs",
    message: "SOP output en structured data ophalen...",
  });

  // Fetch the most recent analysis output
  if (sopType === "monthly") {
    const { data: qualityGateRow } = await supabase
      .from("sop_analysis_output")
      .select("output, analysis_date, created_at")
      .eq("client_id", clientId)
      .eq("sop_type", sopType)
      .eq("section", "quality_gate_monthly_v2")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const parsedQualityGate = (() => {
      if (typeof qualityGateRow?.output !== "string") return qualityGateRow?.output;
      try {
        return JSON.parse(qualityGateRow.output);
      } catch {
        return null;
      }
    })();
    if (parsedQualityGate && typeof parsedQualityGate === "object" && parsedQualityGate !== null && "passed" in parsedQualityGate && parsedQualityGate.passed === false) {
      const blockingReasons = Array.isArray((parsedQualityGate as { blocking_reasons?: unknown }).blocking_reasons)
        ? ((parsedQualityGate as { blocking_reasons: unknown[] }).blocking_reasons.filter((item): item is string => typeof item === "string"))
        : [];
      const errorMessage = blockingReasons.length > 0
        ? `Monthly PDF export geblokkeerd: ${blockingReasons.join("; ")}`
        : "Monthly PDF export geblokkeerd door quality gate.";
      await markProgressFailed(supabase, {
        jobId,
        errorMessage,
      });
      return Response.json({ error: errorMessage }, { status: 409 });
    }
  }

  const { data: analysis, error: analysisErr } = await supabase
    .from("sop_analysis_output")
    .select("*")
    .eq("client_id", clientId)
    .eq("sop_type", sopType)
    .eq("section", "full")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisErr || !analysis) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: `Geen ${sopType} analyse gevonden voor deze client`,
    });
    return Response.json({ error: `Geen ${sopType} analyse gevonden voor deze client` }, { status: 404 });
  }

  // De renderer kent alleen de layout-vorm (weekly/biweekly/monthly), geen kanaal -- de
  // klantnaam draagt de kanaalcontext al. meta_weekly/linkedin_biweekly/etc. worden dus
  // teruggebracht tot hun basisvorm voor alles wat de renderer en de bestandsnaam raakt.
  const baseType: "weekly" | "biweekly" | "monthly" = sopType.endsWith("monthly") ? "monthly" : sopType.endsWith("biweekly") ? "biweekly" : "weekly";

  try {
    // Build PDF props
    const pdfProps: SopPdfProps = {
      clientName,
      clientId,
      sopType: baseType,
      analysisDate: analysis.analysis_date,
      periodStart: analysis.period_start || analysis.analysis_date,
      periodEnd: analysis.period_end || analysis.analysis_date,
      fullOutput: analysis.output || "",
    };

    // Voor elke maandvariant (Google's kale "monthly", en meta_monthly/linkedin_monthly): ook de
    // gestructureerde data ophalen (findings, recommendations, tasks, final_sop). Stond eerst op
    // sopType === "monthly" -- alleen Google dus -- terwijl meta_monthly/linkedin_monthly dezelfde
    // finalizeChannelMonthlySynthesis draaien en dus dezelfde structured_monthly_v2-sectie met een
    // geldige final_sop hebben (geverifieerd 20 augustus: 99 resp. 125 sop_insights-rijen voor
    // demo-greentech, gewoon nooit opgehaald). Zonder deze fix viel de PDF voor die twee kanalen
    // terug op het lege legacy-pad: alle stat-tegels op 0 (findings/recommendations/tasks bleven
    // undefined) en 22 pagina's met rauwe Engelse veldnamen ("Primary thread") -- exact het defect
    // waar de hele redesign voor bedoeld was.
    if (baseType === "monthly") {
      const [structuredRes, findingsRes, recsRes, tasksRes] = await Promise.all([
        supabase
          .from("sop_analysis_output")
          .select("output")
          .eq("client_id", clientId)
          .eq("sop_type", sopType)
          .eq("section", "structured_monthly_v2")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("sop_insights")
          .select("title, description, severity, insight_type, affected_entity, affected_entity_type, metric, current_value, previous_value, change_pct, action_required")
          .eq("client_id", clientId)
          .eq("sop_type", sopType)
          .eq("analysis_date", analysis.analysis_date)
          .order("severity"),
        supabase
          .from("sop_recommendations")
          .select("hypothesis, expected_result, measurement_metric, timeframe, rationale, ice_impact, ice_confidence, ice_ease, ice_total, status")
          .eq("client_id", clientId)
          .eq("sop_type", sopType)
          .eq("analysis_date", analysis.analysis_date)
          .order("ice_total", { ascending: false }),
        supabase
          .from("sop_tasks")
          .select("title, description, action_type, priority, frequency, due_date, affected_campaign, status")
          .eq("client_id", clientId)
          .eq("analysis_date", analysis.analysis_date)
          .order("priority"),
      ]);

      const rawStructuredOutput = structuredRes.data?.output;
      const parsedStructuredOutput =
        typeof rawStructuredOutput === "string"
          ? JSON.parse(rawStructuredOutput)
          : rawStructuredOutput;
      const structuredPayload = parsedStructuredOutput && typeof parsedStructuredOutput === "object"
        ? parsedStructuredOutput as {
            final_sop?: FinalSopSynthesis;
            operating_detail?: OperatingDetailLayer;
            deliverable_markdown?: string;
            coverage_markdown?: string;
            appendix_markdown?: string;
            consistency_counts?: {
              display_findings_count?: number;
              critical_or_high_findings_count?: number;
            };
          }
        : null;
      const finalSop = structuredPayload?.final_sop;
      const operatingDetail = structuredPayload?.operating_detail;
      const deliverableMarkdown = structuredPayload?.deliverable_markdown || [finalSop?.markdown, operatingDetail?.markdown].filter(Boolean).join("\n\n");
      if (!finalSop) {
        throw new Error("Structured monthly final_sop ontbreekt; PDF export geweigerd.");
      }
      const deliverableErrors = validateMonthlyDeliverableCompleteness({
        final_sop: finalSop,
        operating_detail: operatingDetail,
        executive_markdown: finalSop.markdown,
        deliverable_markdown: deliverableMarkdown,
      });
      const finalSopErrors = [
        ...validateFinalSopSynthesis(finalSop),
        ...validateRenderedFinalSopMarkdown(finalSop.markdown).errors,
      ];
      if (finalSopErrors.length > 0 || deliverableErrors.length > 0) {
        throw new Error(`Structured monthly deliverable ongeldig voor export: ${[...finalSopErrors, ...deliverableErrors].join("; ")}`);
      }

      pdfProps.fullOutput = deliverableMarkdown || finalSop.markdown;
      pdfProps.finalSop = finalSop;
      pdfProps.operatingDetail = operatingDetail;
      pdfProps.coverageMarkdown = structuredPayload?.coverage_markdown;
      pdfProps.appendixMarkdown = structuredPayload?.appendix_markdown;
      pdfProps.executiveCounts = {
        displayFindingsCount: structuredPayload?.consistency_counts?.display_findings_count ?? finalSop.supporting_evidence.length,
        criticalOrHighCount: structuredPayload?.consistency_counts?.critical_or_high_findings_count ?? 1,
      };
      pdfProps.findings = (findingsRes.data ?? []) as SopPdfProps["findings"];
      pdfProps.recommendations = (recsRes.data ?? []) as SopPdfProps["recommendations"];
      pdfProps.tasks = (tasksRes.data ?? []) as SopPdfProps["tasks"];

      // Drie externe context-lagen, want dit document gaat nooit naar de klant (bureau-intern):
      // cross-channel (dezelfde klant, andere kanalen), cross-account (hetzelfde bureau, andere
      // klanten) en de anonieme cross-agency marktbenchmark ("God View"). Alle drie best-effort --
      // geen van de drie mag de hoofdexport blokkeren of vertragen bij een fout.
      const { data: accountRow } = await supabase.from("accounts").select("agency_id").eq("client_id", clientId).maybeSingle();
      const agencyId = accountRow?.agency_id ? String(accountRow.agency_id) : null;

      const [crossChannelRow, portfolioRow, marketComparison] = await Promise.all([
        supabase
          .from("sop_analysis_output")
          .select("output")
          .eq("client_id", clientId)
          .eq("sop_type", "cross_channel")
          .eq("section", "cross_channel_synthesis_v1")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        agencyId
          ? supabase
              .from("agency_analysis_output")
              .select("output")
              .eq("agency_id", agencyId)
              .eq("section", "portfolio_synthesis_v1")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        fetchGodViewComparison(supabase, clientId, MONTHLY_SOP_TYPE_TO_CHANNEL[sopType] ?? "google_ads").catch(() => null),
      ]);

      pdfProps.crossChannel = parseJsonOutput<CrossChannelSynthesisResult>(crossChannelRow.data?.output);
      pdfProps.crossAccount = parseJsonOutput<PortfolioSynthesisResult>(portfolioRow.data?.output);
      pdfProps.marketBenchmark = marketComparison?.available ? marketComparison : null;
    }

    // Generate PDF
    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "render_pdf",
      message: "SOP PDF opbouwen...",
    });
    const pdfBuffer = await renderSopPdf(pdfProps);

    // Save to Supabase Storage
    const typeLabel: Record<string, string> = {
      weekly: "Wekelijks",
      biweekly: "Tweewekelijks",
      monthly: "Maandelijks",
    };
    const filename = `SOP-${typeLabel[baseType]}-${analysis.analysis_date}.pdf`;
    const storagePath = `${clientId}/SOP's/${Date.now()}-${filename}`;

    await updateProgressPhase(supabase, {
      jobId,
      phaseKey: "store_artifact",
      message: "SOP PDF opslaan...",
    });
    await supabase.storage.from("client-files").upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

    // Ensure SOP's folder exists
    const { data: existingFolder } = await supabase
      .from("client_folders")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", "SOP's")
      .maybeSingle();

    if (!existingFolder) {
      await supabase.from("client_folders").insert({ client_id: clientId, name: "SOP's" });
    }

    // Insert file reference
    await supabase.from("client_files").insert({
      client_id: clientId,
      folder: "SOP's",
      file_name: filename,
      file_size: pdfBuffer.length,
      content_type: "application/pdf",
      storage_path: storagePath,
    });

    await markProgressCompleted(supabase, {
      jobId,
      message: "SOP PDF gereed.",
      metadata: { storage_path: storagePath, sop_type: sopType },
    });

    // Return PDF
    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    logger.error("[sop-pdf] Generation failed:", err);
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: err instanceof Error ? err.message : "PDF generatie mislukt",
    });
    return Response.json({ error: err instanceof Error ? err.message : "PDF generatie mislukt" }, { status: 500 });
  }
}
