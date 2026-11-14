// De stappen van app/api/cron/trigger-sops die een andere route aanroepen, en de beslissing per due
// item. Uit de route gehaald zodat ze te toetsen zijn: een routebestand mag in Next alleen zijn
// handlers en route-config exporteren.
//
// Alle wachtende aanroepen gaan via interneAanroep (lib/scheduler/interne-aanroep.ts), niet via
// fetch: fetch geeft het na 300 s zonder headers op, en de analyse-routes sturen pas aan het eind
// headers. Zie de kop van dat bestand.
//
// verwerkDueItem is de lus-stap per due item: beslissen (lib/scheduler/sop-tijdbudget.ts), de
// analyse draaien, en daarna de vervolgstappen zolang de tijd ze dekt. De route geeft de klok, de
// analyse en de vervolgstappen mee; de test geeft nepversies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHANNEL_CONFIG, type SopChannel, type SopType } from "@/lib/analysis/sop-channel-config";
import { today } from "@/lib/reporting-date";
import { interneAanroep } from "@/lib/scheduler/interne-aanroep";
import { beslisDueItem, vervolgTimeoutMs, type Tijdbudget } from "@/lib/scheduler/sop-tijdbudget";

// Alle interne aanroepen op de eigen origin dragen het CRON_SECRET als Bearer: geen
// browsersessie, en zodra O1_AUTH_ENFORCED aangaat is dit geheim de doorgang langs de
// middleware en de route-eigen toegangscheck (vereisKlantToegangUitBody). De cronroute draait
// zelf alleen met een geldig CRON_SECRET, dus het geheim is daar per definitie aanwezig.
export function interneHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) };
}

function foutUit(data: Record<string, unknown>, standaard: string): string {
  return typeof data.error === "string" && data.error ? data.error : standaard;
}

// Volledig deterministisch, geen LLM-aanroep (model_used: "deterministisch", tokens_used: 0 in
// app/api/analysis/cross-channel/route.ts) -- dus geen budgetimpact, alleen een handvol extra
// Supabase-reads. Gooit door bij een fout; de aanroeper vangt en logt, zonder de kanaalanalyse
// als mislukt te markeren.
export async function triggerCrossChannel(origin: string, clientId: string, timeoutMs: number): Promise<void> {
  const res = await interneAanroep(`${origin}/api/analysis/cross-channel`, {
    method: "POST",
    timeoutMs,
    headers: interneHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok) throw new Error(foutUit(res.data, `cross-channel gaf ${res.status}`));
}

// Kanaaloverstijgende SYNTHESE (masterplan 17.12) -- ná de deterministische signalen hierboven,
// zodat de synthese de vers berekende cross-channel-context kan lezen. 409 (skipped) is hier geen
// fout: de route zelf beslist of alle beschikbare kanalen deze cyclus al klaar zijn, en met deze
// cron-loop (limit vaak 1) is dat lang niet elke invocatie zo -- pas het laatste kanaal dat deze
// nacht afrondt triggert daadwerkelijk een LLM-call. De route heeft maxDuration 600, dus ook hier
// geen fetch.
export async function triggerCrossChannelSynthesis(origin: string, clientId: string, timeoutMs: number): Promise<void> {
  const res = await interneAanroep(`${origin}/api/analysis/cross-channel-synthesis`, {
    method: "POST",
    timeoutMs,
    headers: interneHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok && res.status !== 409) throw new Error(foutUit(res.data, `cross-channel-synthesis gaf ${res.status}`));
}

// Draait exact wat de handmatige knop doet (runSop in sop-trigger-buttons.tsx): het endpoint
// aanroepen, de executive-summary/output tot markdown maken, en die naar Bestanden > SOP's
// schrijven. Geeft de analysisDate terug voor het resultaatoverzicht.
export async function voerSopUit(
  supabase: SupabaseClient,
  origin: string,
  clientId: string,
  channel: SopChannel,
  cadence: SopType,
  timeoutMs: number,
): Promise<string> {
  const endpoint = `${origin}/api/analysis/${cadence}`;
  const jobId = crypto.randomUUID();
  const res = await interneAanroep(endpoint, {
    method: "POST",
    // Ruimer dan de maxDuration van de analyse-route (beslisDueItem eist dat), dus in de praktijk
    // breekt het platform de analyse eerder af dan deze timeout. Hij is er zodat de cronroute nooit
    // zelf over zijn eigen grens wacht.
    timeoutMs,
    headers: interneHeaders({ "Content-Type": "application/json" }),
    // `automatisch: true` markeert dit als een AUTOMATISCHE run. Alleen dan geldt de
    // sops_enabled-dekkingsgate in de analyse-routes, en alleen dan (samen met het CRON_SECRET)
    // telt de run als gepland in generation_jobs.triggered_by (lib/progress/gestart-door.ts). De
    // handmatige knop laat de vlag weg en blijft dus altijd werken, ook voor accounts die buiten de
    // dekking zijn gezet.
    body: JSON.stringify({ client_id: clientId, job_id: jobId, channel, automatisch: true }),
  });
  const data = res.data as Record<string, unknown> & {
    analysisDate?: string; period?: { start?: string; end?: string }; periodStart?: string; periodEnd?: string;
    model?: string; fullOutput?: string; output?: string;
  };
  if (!res.ok) throw new Error(foutUit(data, `${endpoint} gaf ${res.status}`));

  const analysisDate: string = data.analysisDate || today();
  const period = cadence === "monthly" ? data.period : { start: data.periodStart, end: data.periodEnd };
  const cadenceLabel = cadence === "monthly" ? "Maandelijkse" : cadence === "weekly" ? "Wekelijkse" : "Tweewekelijkse";
  const typeLabel = `${cadenceLabel} ${CHANNEL_CONFIG[channel].headerLabel}`;
  const header = `# ${typeLabel} Analyse\n**Client:** ${clientId}\n**Datum:** ${analysisDate}\n**Periode:** ${period?.start} t/m ${period?.end}\n**Model:** ${data.model}\n\n---\n\n`;
  const markdown = header + (data.fullOutput || data.output || "Geen output");

  const sopTypeKey = CHANNEL_CONFIG[channel].sopTypeKey[cadence];
  const fileName = `${analysisDate}-${sopTypeKey}-analyse.md`;
  const storagePath = `${clientId}/SOP's/${Date.now()}-${fileName}`;

  const { error: storageErr } = await supabase.storage
    .from("client-files")
    .upload(storagePath, markdown, { contentType: "text/markdown" });
  if (storageErr) throw new Error(`upload mislukt: ${storageErr.message}`);

  // Zelfde dedup als de PDF-route (app/api/analysis/pdf/route.ts, 20 augustus 2026): een
  // herdraaide analyse dezelfde dag (bestandsnaam is analysisDate-gekeyd) hoort de bestaande rij
  // te VERVANGEN, niet er een tweede naast te zetten. .limit(1) i.p.v. .maybeSingle() om dezelfde
  // reden als daar -- bij al bestaande dubbelen faalt .maybeSingle() stil op "meerdere rijen".
  const { data: verouderdeBestanden } = await supabase
    .from("client_files")
    .select("id, storage_path")
    .eq("client_id", clientId)
    .eq("folder", "SOP's")
    .eq("file_name", fileName);
  if (verouderdeBestanden && verouderdeBestanden.length > 0) {
    const oudePaden = (verouderdeBestanden as { storage_path?: string | null }[])
      .map((f) => f.storage_path).filter((p): p is string => Boolean(p));
    if (oudePaden.length > 0) {
      await supabase.storage.from("client-files").remove(oudePaden).catch(() => {});
    }
    await supabase.from("client_files").delete().in("id", (verouderdeBestanden as { id: string }[]).map((f) => f.id));
  }

  const { error: insertErr } = await supabase.from("client_files").insert({
    client_id: clientId,
    folder: "SOP's",
    file_name: fileName,
    file_size: Buffer.byteLength(markdown, "utf8"),
    content_type: "text/markdown",
    storage_path: storagePath,
  });
  if (insertErr) throw new Error(`client_files-rij mislukt: ${insertErr.message}`);

  return analysisDate;
}

// ── De stap per due item ─────────────────────────────────────────────────────

export interface DueItem {
  clientId: string;
  channel: SopChannel;
  cadence: SopType;
  lastRunDate: string | null;
}

export interface ItemUitkomst extends DueItem {
  status: "triggered" | "failed" | "due_deferred";
  /** Bij due_deferred: de batch was vol (limit) of de tijd dekte geen volledige analyse meer. */
  uitstelreden?: "limiet" | "tijd";
  analysisDate?: string;
  error?: string;
}

export interface Vervolgstap {
  /** Voor `vervolg_uitgesteld` in het cron-antwoord, bijvoorbeeld "cross-channel demo-greentech". */
  naam: string;
  stap: (timeoutMs: number) => Promise<void>;
}

/**
 * Beslist over een due item en voert het uit. Een vervolgstap start alleen als de tijd hem nog
 * dekt (vervolgTimeoutMs); anders staat zijn naam in `vervolgUitgesteld`. Een mislukte vervolgstap
 * wordt gelogd en laat de analyse een succes: cross-channel is een aanvulling, geen voorwaarde.
 * `vervolgstappen` wordt pas aangeroepen als de analyse gelukt is, zodat de route daar zijn
 * dedup (een keer per klant per invocatie) kan bijhouden.
 */
export async function verwerkDueItem(inp: {
  item: DueItem;
  getriggerd: number;
  limit: number;
  budget: Tijdbudget;
  nu: () => number;
  voerUit: (timeoutMs: number) => Promise<string>;
  vervolgstappen: () => readonly Vervolgstap[];
}): Promise<{ uitkomst: ItemUitkomst; vervolgUitgesteld: string[] }> {
  const { item } = inp;
  const vervolgUitgesteld: string[] = [];
  const beslissing = beslisDueItem({ getriggerd: inp.getriggerd, limit: inp.limit, budget: inp.budget, nuMs: inp.nu() });
  if (beslissing.soort === "uitgesteld") {
    return { uitkomst: { ...item, status: "due_deferred", uitstelreden: beslissing.reden }, vervolgUitgesteld };
  }

  let analysisDate: string;
  try {
    analysisDate = await inp.voerUit(beslissing.timeoutMs);
  } catch (err) {
    return {
      uitkomst: { ...item, status: "failed", error: err instanceof Error ? err.message : String(err) },
      vervolgUitgesteld,
    };
  }

  for (const v of inp.vervolgstappen()) {
    const timeoutMs = vervolgTimeoutMs(inp.budget, inp.nu());
    if (timeoutMs === null) {
      vervolgUitgesteld.push(v.naam);
      continue;
    }
    await v.stap(timeoutMs).catch((err) => {
      console.error(`[trigger-sops] ${v.naam} mislukt:`, err);
    });
  }
  return { uitkomst: { ...item, status: "triggered", analysisDate }, vervolgUitgesteld };
}
