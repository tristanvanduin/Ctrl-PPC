"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar, CheckCircle2, AlertCircle, FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { useAnalysis } from "@/lib/analysis-context";
import { getAllClients } from "@/lib/clients";
import { useGenerationProgress } from "@/lib/use-generation-progress";
import { dbInsert, dbDelete } from "@/lib/data-access/client-write";
import { GenerationProgressCard } from "@/components/ui/generation-progress-card";
import { today } from "@/lib/reporting-date";
// Verplaatst naar lib/analysis/sop-channel-config.ts (nightly-cron-werk) zodat de cron
// (app/api/cron/trigger-sops) dezelfde kanaal/cadans-tabel gebruikt in plaats van een tweede
// kopie -- zie de kop van dat bestand. Gedrag van deze knoppen blijft ongewijzigd.
import { CHANNEL_CONFIG, type SopType, type SopChannel } from "@/lib/analysis/sop-channel-config";
import { isDemoClient } from "@/lib/demo/demo-mode";

export type { SopChannel };

interface SopStatus {
  running: boolean;
  lastDate: string | null;
  error: string | null;
  success: boolean;
}

const SOP_CONFIG: Record<SopType, { label: string; description: string; endpoint: string }> = {
  weekly: {
    label: "Weekly",
    description: "Health check & bleeders",
    endpoint: "/api/analysis/weekly",
  },
  biweekly: {
    label: "Bi-weekly",
    description: "Campagne tracking & trends",
    endpoint: "/api/analysis/biweekly",
  },
  monthly: {
    label: "Monthly",
    description: "Volledige analyse & actiepunten",
    endpoint: "/api/analysis/monthly",
  },
};

export interface SopError {
  id: string;
  type: SopType;
  label: string;
  error: string;
  timestamp: string;
}

interface Props {
  clientId: string;
  onAnalysisComplete: () => void;
  onAnalysisError?: (error: SopError) => void;
  /** Kanaal waarvoor de SOPs draaien; bepaalt de zichtbare SOPs, de sop_type en de body-channel. */
  channel?: SopChannel;
  /** Heeft deze klant meer dan 1 gekoppeld kanaal? Bepaalt of monthly automatisch cross-channel
   *  meetriggert (masterplan 16.4/16.6) -- met 1 kanaal is er niets om te kruisen. De route zelf
   *  gate't dit ook (defense-in-depth), maar hier voorkomt het al een nutteloze aanroep. */
  multiChannel?: boolean;
}

export function SopTriggerButtons({ clientId, onAnalysisComplete, onAnalysisError, channel = "google_ads", multiChannel = false }: Props) {
  const channelCfg = CHANNEL_CONFIG[channel];
  const { startJob, isRunning: isJobRunning } = useAnalysis();
  // isDemoMode() leest window.location, dus in een effect en niet in de eerste render -- anders
  // rendert de server iets anders dan de client en klapt de hydratie eruit (zelfde reden als
  // demoModus in client-dashboard.tsx). SOP's roepen een echte LLM aan (OpenRouter/Gemini,
  // reasoning-budget) -- in demo-modus zou een bezoeker anders op een publieke link telkens een
  // echte, kostende run tegen demo-greentech kunnen starten.
  const [demoModus, setDemoModus] = useState(false);
  useEffect(() => { setDemoModus(isDemoClient(clientId)); }, [clientId]);
  const [status, setStatus] = useState<Record<SopType, SopStatus>>({
    weekly: { running: false, lastDate: null, error: null, success: false },
    biweekly: { running: false, lastDate: null, error: null, success: false },
    monthly: { running: false, lastDate: null, error: null, success: false },
  });
  const [activeJobIds, setActiveJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const [activePdfJobIds, setActivePdfJobIds] = useState<Record<SopType, string | null>>({
    weekly: null,
    biweekly: null,
    monthly: null,
  });
  const weeklyProgress = useGenerationProgress(activeJobIds.weekly);
  const biweeklyProgress = useGenerationProgress(activeJobIds.biweekly);
  const monthlyProgress = useGenerationProgress(activeJobIds.monthly);
  const weeklyPdfProgress = useGenerationProgress(activePdfJobIds.weekly);
  const biweeklyPdfProgress = useGenerationProgress(activePdfJobIds.biweekly);
  const monthlyPdfProgress = useGenerationProgress(activePdfJobIds.monthly);
  const progressByType = {
    weekly: weeklyProgress.job,
    biweekly: biweeklyProgress.job,
    monthly: monthlyProgress.job,
  } as const;
  const pdfProgressByType = {
    weekly: weeklyPdfProgress.job,
    biweekly: biweeklyPdfProgress.job,
    monthly: monthlyPdfProgress.job,
  } as const;

  // Load last analysis dates on mount
  useEffect(() => {
    async function loadLastDates() {
      const types: SopType[] = channelCfg.types;
      const updates: Partial<Record<SopType, SopStatus>> = {};

      for (const type of types) {
        const { data } = await dbSelect<{ analysis_date: string }>("sop_analysis_output", {
          select: "analysis_date", clientId,
          filters: [{ op: "eq", column: "sop_type", value: channelCfg.sopTypeKey[type] }],
          order: { column: "analysis_date", ascending: false }, limit: 1,
        });

        if (data.length > 0) {
          updates[type] = { ...status[type], lastDate: data[0].analysis_date };
        }
      }

      if (Object.keys(updates).length > 0) {
        setStatus((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(updates)) {
            next[k as SopType] = { ...next[k as SopType], ...v };
          }
          return next;
        });
      }
    }

    loadLastDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, channel]);

  async function uploadSopFile(sopType: SopType, analysisDate: string, markdownContent: string) {
    const sb = supabase;
    if (!sb) return;

    const fileName = `${analysisDate}-${channelCfg.sopTypeKey[sopType]}-analyse.md`;
    const storagePath = `${clientId}/SOP's/${Date.now()}-${fileName}`;
    const blob = new Blob([markdownContent], { type: "text/markdown" });

    const { error: storageErr } = await sb.storage
      .from("client-files")
      .upload(storagePath, blob);

    if (storageErr) {
      console.error("SOP upload error:", storageErr.message);
      return;
    }

    // Zelfde dedup als de PDF-route en de cron-tegenhanger van deze functie (voerSopUit in
    // app/api/cron/trigger-sops/route.ts, 20 augustus 2026): handmatig twee keer dezelfde
    // analyse dezelfde dag draaien maakte tot nu toe een tweede, identiek genummerd bestand
    // -- de bestaande rij (en zijn storage-object) hoort vervangen te worden, niet verdubbeld.
    const { data: verouderdeBestanden } = await dbSelect<{ id: string; storage_path: string }>("client_files", {
      select: "id, storage_path", clientId,
      filters: [
        { op: "eq", column: "folder", value: "SOP's" },
        { op: "eq", column: "file_name", value: fileName },
      ],
    });
    if (verouderdeBestanden.length > 0) {
      const oudePaden = verouderdeBestanden.map((f) => f.storage_path).filter(Boolean);
      if (oudePaden.length > 0) {
        await sb.storage.from("client-files").remove(oudePaden).catch(() => {});
      }
      await dbDelete("client_files", clientId, { folder: "SOP's", file_name: fileName });
    }

    await dbInsert("client_files", clientId, {
      folder: "SOP's",
      file_name: fileName,
      file_size: blob.size,
      content_type: "text/markdown",
      storage_path: storagePath,
    });
  }

  function runSop(type: SopType) {
    // Geen live SOP's in demo-modus, ook niet als iemand de knop toch bereikt -- zie de
    // toelichting bij demoModus hierboven.
    if (demoModus) return;
    const config = SOP_CONFIG[type];
    const jobId = `sop-${channelCfg.sopTypeKey[type]}-${clientId}`;
    const progressJobId = crypto.randomUUID();
    setActiveJobIds((prev) => ({ ...prev, [type]: progressJobId }));

    setStatus((prev) => ({
      ...prev,
      [type]: { ...prev[type], running: true, error: null, success: false },
    }));

    startJob(jobId, `${config.label} analyse`, async () => {
      try {
        const res = await fetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, job_id: progressJobId, channel }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analyse mislukt");

        // Build markdown from response. De executive summary (fullOutput / deliverable_markdown)
        // is de synthese, niet de losse stappen -- die laatste zijn backend-redenering en horen
        // niet als "Stap 1: ..., Stap 2: ..."-dump in het bestand dat de specialist opent.
        const analysisDate = data.analysisDate || today();
        const period = type === "monthly" ? data.period : { start: data.periodStart, end: data.periodEnd };
        const cadenceLabel = type === "monthly" ? "Maandelijkse" : type === "weekly" ? "Wekelijkse" : "Tweewekelijkse";
        const typeLabel = `${cadenceLabel} ${channelCfg.headerLabel}`;
        const header = `# ${typeLabel} Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${period?.start} t/m ${period?.end}\n**Model:** ${data.model}\n\n---\n\n`;
        const markdown = header + (data.fullOutput || data.output || "Geen output");

        await uploadSopFile(type, analysisDate, markdown);

        // Cross-channel hoort bij elke maandanalyse (masterplan 16.4: "cross channel moet de
        // basis zijn in de maandanalyse"), niet alleen bij een handmatige klik op de losse
        // cross-channel-kaart. Volledig deterministisch, geen LLM-kosten -- op de achtergrond,
        // een mislukking daar mag deze (al geslaagde) kanaalanalyse niet als mislukt tonen.
        // Alleen vanaf 2 kanalen (masterplan 16.6) -- met 1 kanaal is er niets om te kruisen.
        //
        // Ná de deterministische signalen: de kanaaloverstijgende SYNTHESE (masterplan 17.12,
        // lib/analysis/cross-channel-synthesis.ts) -- wél een LLM-call, dus bewust NA in plaats
        // van naast cross-channel, zodat de synthese de vers berekende signalen kan lezen. De
        // route zelf bepaalt of alle kanalen deze cyclus al klaar zijn (skipped:true zolang dat
        // niet zo is) -- elk kanaal dat hier afrondt mag 'm dus altijd aanroepen, alleen de
        // laatste doet daadwerkelijk de call.
        if (type === "monthly" && multiChannel) {
          (async () => {
            try {
              await fetch("/api/analysis/cross-channel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId }),
              });
            } catch (err) {
              console.error("Cross-channel-analyse (automatisch) mislukt:", err);
            }
            fetch("/api/analysis/cross-channel-synthesis", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ client_id: clientId }),
            }).catch((err) => console.error("Cross-channel-synthese (automatisch) mislukt:", err));
          })();
        }

        setStatus((prev) => ({
          ...prev,
          [type]: { running: false, lastDate: analysisDate, error: null, success: true },
        }));

        setTimeout(() => {
          setStatus((prev) => ({
            ...prev,
            [type]: { ...prev[type], success: false },
          }));
        }, 5000);

        onAnalysisComplete();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Onbekende fout";
        setStatus((prev) => ({
          ...prev,
          [type]: { ...prev[type], running: false, error: errorMsg, success: false },
        }));
        onAnalysisError?.({
          id: `${type}-${Date.now()}`,
          type,
          label: config.label,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
        throw err; // Re-throw so startJob marks it as error
      }
    });
  }

  const [pdfLoading, setPdfLoading] = useState<Record<SopType, boolean>>({
    weekly: false,
    biweekly: false,
    monthly: false,
  });

  async function downloadPdf(type: SopType, e: React.MouseEvent) {
    e.stopPropagation(); // Don't trigger the analysis button
    const clientName = getAllClients().find((c) => c.id === clientId)?.name ?? clientId;
    const progressJobId = crypto.randomUUID();
    setActivePdfJobIds((prev) => ({ ...prev, [type]: progressJobId }));
    setPdfLoading((prev) => ({ ...prev, [type]: true }));

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        sop_type: channelCfg.sopTypeKey[type],
        client_name: clientName,
        job_id: progressJobId,
      });
      const res = await fetch(`/api/analysis/pdf?${params}`);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generatie mislukt" }));
        throw new Error(err.error || "PDF generatie mislukt");
      }

      // Download the PDF
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `SOP-${type}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download failed:", err);
      alert(err instanceof Error ? err.message : "PDF download mislukt");
    } finally {
      setPdfLoading((prev) => ({ ...prev, [type]: false }));
    }
  }

  const anyRunning = Object.values(status).some((s) => s.running) ||
    channelCfg.types.some((t) => isJobRunning(`sop-${channelCfg.sopTypeKey[t]}-${clientId}`));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-title font-semibold text-brand-gray">SOP Analyse — {channelCfg.headerLabel}</h3>
        <p className="text-micro text-muted-foreground mt-0.5">
          {demoModus
            ? "In demo-modus kun je geen live SOP's starten -- dit zou een echte LLM-aanroep zijn."
            : <>Klik op een analyse om deze handmatig uit te voeren. Output wordt opgeslagen bij Bestanden &gt; SOP&apos;s.</>}
        </p>
      </div>
      <div className="px-5 py-4 flex gap-3 flex-wrap">
        {channelCfg.types.map((type) => {
          const config = SOP_CONFIG[type];
          const s = status[type];
          const progressJob = progressByType[type];
          const pdfProgressJob = pdfProgressByType[type];
          const progressState = type === "weekly" ? weeklyProgress : type === "biweekly" ? biweeklyProgress : monthlyProgress;
          const pdfProgressState = type === "weekly" ? weeklyPdfProgress : type === "biweekly" ? biweeklyPdfProgress : monthlyPdfProgress;
          return (
            <div key={type} className="flex-1 min-w-[160px] flex flex-col gap-1.5">
              <button
                onClick={() => runSop(type)}
                disabled={anyRunning || demoModus}
                title={demoModus ? "Niet beschikbaar in demo-modus" : undefined}
                className={`w-full px-4 py-3 rounded-lg border transition-all text-left ${
                  s.running
                    ? "border-brand-blue/30 bg-brand-blue/5 cursor-wait"
                    : s.success
                    ? "border-emerald-300 bg-emerald-50"
                    : s.error
                    ? "border-red-300 bg-red-50"
                    : "border-border hover:border-brand-blue/40 hover:bg-gray-50 cursor-pointer"
                } ${(anyRunning && !s.running) || demoModus ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-brand-gray">{config.label}</span>
                  {s.running && <Loader2 className="w-4 h-4 text-brand-blue-ink animate-spin" />}
                  {s.success && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {s.error && <AlertCircle className="w-4 h-4 text-red-500" />}
                </div>
                <p className="text-micro text-muted-foreground">{config.description}</p>
                {s.lastDate && (
                  <div className="flex items-center gap-1 mt-2 text-micro text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    Laatst: {s.lastDate}
                  </div>
                )}
                {s.error && (
                  <p className="text-micro text-red-500 mt-1 truncate">{s.error}</p>
                )}
                {s.running && type === "monthly" && (
                  <p className="text-micro text-brand-blue-ink mt-1">Dit duurt ca. 2-3 minuten...</p>
                )}
                {s.running && type !== "monthly" && (
                  <p className="text-micro text-brand-blue-ink mt-1">Dit duurt ca. 30-60 seconden...</p>
                )}
              </button>
              {s.lastDate && (
                <button
                  onClick={(e) => downloadPdf(type, e)}
                  disabled={pdfLoading[type] || anyRunning}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-micro text-muted-foreground hover:bg-gray-50 hover:text-brand-gray hover:border-brand-orange/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pdfLoading[type] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                  {pdfLoading[type] ? "PDF genereren..." : "Download PDF"}
                </button>
              )}
              {(s.running || progressJob) && (
                <GenerationProgressCard
                  title={`${config.label} voortgang`}
                  job={progressJob}
                  fallbackMessage="Voortgang wordt gestart..."
                />
              )}
              {progressState.trackerUnavailable && !progressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-700">
                  {progressState.trackerMessage || "Live voortgang niet beschikbaar. Analyse loopt mogelijk nog door."}
                </div>
              )}
              {(pdfLoading[type] || pdfProgressJob) && (
                <GenerationProgressCard
                  title={`${config.label} PDF`}
                  job={pdfProgressJob}
                  fallbackMessage="PDF-generatie wordt gestart..."
                />
              )}
              {pdfProgressState.trackerUnavailable && !pdfProgressJob && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-700">
                  {pdfProgressState.trackerMessage || "Live PDF-voortgang niet beschikbaar."}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
