// =====================================================================
// STATUS: ORKESTRATIE BOUWT OP GEVERIFIEERDE KERNEN, MAAR DE HTTP-CALLS ZIJN
// LIVE-ONGETEST. De transform, vensters en rij-mapping zijn unit-getest; het async
// insights-pad zelf is pas tegen een echte token en account te verifieren. Neem niet
// aan dat de sync live data binnenhaalt tot dat is bevestigd.
// =====================================================================
//
// Knoopt de M1-onderdelen aan elkaar: haal insights per niveau via het async-pad,
// map met de transform, schrijf weg met de rij-mapping en upsert op de conflict-sleutel.
// Auth wordt door de aanroeper geresolved volgens het Google-secret-patroon (credentials
// naar access_token) en als accessToken plus accountId doorgegeven; deze module bevat
// dus geen tokenopslag.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaInsightsRow } from "./types";
import { mapInsightsRow } from "./transform";
import { metaDailyToDbRow, META_DAILY_CONFLICT } from "./rows";
import { trailingWindow, backfillWindow, monthlyChunks } from "./sync-windows";
import { logger } from "@/lib/logger";
import { META_GRAPH_BASE } from "./api-version";
import { schrijftabel } from "@/lib/data-access/feitentabellen";
import { recordFetchFailure, withFetchFailures, hasFetchFailure } from "@/lib/api/fetch-failures";

// De versie staat in lib/meta/api-version.ts, zodat hij niet opnieuw uit de pas kan lopen met
// het koppelscherm. Blijft hier herge-exporteerd voor bestaande importeurs.
export { META_API_VERSION } from "./api-version";
const GRAPH = META_GRAPH_BASE;

const log = logger.child("meta-sync");

export type MetaLevel = "account" | "campaign" | "adset" | "ad";

// adset staat er los in: die tabel krijgt geen view in fase 3, dus zijn schrijfbestemming
// verandert niet mee. Hem toch door schrijftabel() halen zou een verband suggereren dat er niet is.
const LEVEL_TABLE: Record<MetaLevel, string> = {
  account: schrijftabel("meta_account_daily"),
  campaign: schrijftabel("meta_campaign_daily"),
  adset: "meta_adset_daily",
  ad: schrijftabel("meta_ad_daily"),
};

// De velden die we per insights-pull vragen. De transform mapt deze naar getypeerde kolommen.
const INSIGHTS_FIELDS = [
  "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "spend", "cpm", "cpc", "ctr",
  "actions", "action_values", "purchase_roas",
  "video_3sec_watched_actions", "video_thruplay_watched_actions",
  "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions",
  "quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking",
].join(",");

// Bereik en frequentie zijn onbruikbaar zodra er per uur wordt uitgesplitst: Meta geeft ze dan
// terug als 0, zonder foutmelding. Die nul is gevaarlijker dan een ontbrekende waarde — de
// verzadigingsdetector leest hem als "niemand bereikt" en concludeert het tegenovergestelde van
// wat er aan de hand is. We vragen ze in dat geval dus niet op; parseNum maakt er dan null van,
// en null is eerlijk.
const UNIQUE_FIELDS = ["reach", "frequency"];
const isHourlyBreakdown = (b?: string): boolean => !!b && b.includes("hourly");

export function fieldsFor(breakdowns?: string): string {
  if (!isHourlyBreakdown(breakdowns)) return INSIGHTS_FIELDS;
  return INSIGHTS_FIELDS.split(",").filter((f) => !UNIQUE_FIELDS.includes(f)).join(",");
}

export interface SyncContext {
  supabase: SupabaseClient;
  clientId: string;
  accountId: string; // act_XXXX
  accessToken: string;
}

// LIVE-ONGETEST. Het async insights-pad: maak een report_run_id, poll tot klaar, haal
// de resultaten op. De vorm volgt de Meta-docs (POST /act_<id>/insights met level,
// time_increment=1, time_range, fields, breakdowns; poll; GET). Tegen een echte account
// te verifieren; tot dan een dunne, expliciet gemarkeerde grens.
export async function fetchInsightsAsync(
  ctx: SyncContext,
  opts: { level: MetaLevel; since: string; until: string; breakdowns?: string }
): Promise<MetaInsightsRow[]> {
  // Bron-naam per niveau, niet één "fetchInsightsAsync" voor alle vier: syncMetaLevel moet per
  // niveau kunnen zien of ZIJN ophaal mislukte, anders trekt een mislukte account-pull ook de
  // (misschien wel geslaagde) campaign/adset/ad-pulls mee als "onbetrouwbaar".
  const source = `meta:${opts.level}`;
  const params = new URLSearchParams({
    level: opts.level,
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    fields: fieldsFor(opts.breakdowns),
    access_token: ctx.accessToken,
  });
  if (opts.breakdowns) params.set("breakdowns", opts.breakdowns);

  const createRes = await fetch(`${GRAPH}/${ctx.accountId}/insights`, { method: "POST", body: params });
  const created = (await createRes.json()) as { report_run_id?: string; error?: { message?: string } };
  if (!created.report_run_id) {
    recordFetchFailure(source, created.error?.message ?? "geen report_run_id van Meta", "meta");
    return [];
  }

  // Poll tot het rapport klaar is (max een redelijk aantal pogingen).
  let completed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${GRAPH}/${created.report_run_id}?access_token=${ctx.accessToken}`);
    const status = (await statusRes.json()) as { async_status?: string; async_percent_completion?: number };
    if (status.async_status === "Job Completed") { completed = true; break; }
    if (status.async_status === "Job Failed") {
      recordFetchFailure(source, `Meta insights-job faalde voor ${opts.level} ${opts.since}..${opts.until}`, "meta");
      return [];
    }
  }
  // Alle 30 pogingen op, nooit "Job Completed" of "Job Failed" gezien: dit las voorheen gewoon
  // door naar de resultaat-pull, met een (mogelijk halfklaar) rapport als bron -- een timeout is
  // geen bevestigde leegte, dus telt hier ook als mislukt in plaats van als stilzwijgend "klaar".
  if (!completed) {
    recordFetchFailure(source, `polling voor ${opts.level} ${opts.since}..${opts.until} timed out na 30 pogingen`, "meta");
    return [];
  }

  // Haal de resultaten op met paginatie.
  const rows: MetaInsightsRow[] = [];
  let next: string | null = `${GRAPH}/${created.report_run_id}/insights?limit=500&access_token=${ctx.accessToken}`;
  while (next) {
    const page = (await (await fetch(next)).json()) as { data?: MetaInsightsRow[]; paging?: { next?: string } };
    if (Array.isArray(page.data)) rows.push(...page.data);
    next = page.paging?.next ?? null;
  }
  return rows;
}

// Dedupliceert op de samengestelde sleutel voor we upserten (zelfde discipline als de
// Google-orchestrator), zodat een her-pull van dezelfde dag muteert in plaats van dupliceert.
function dedupeByKey(rows: Record<string, unknown>[], keyFields: string[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = keyFields.map((f) => String(row[f])).join("|");
    seen.set(key, row); // laatste wint
  }
  return [...seen.values()];
}

/** Resultaat van één niveau/venster: expliciet succes/mislukking, niet alleen een rijenaantal --
 *  0 rijen door een lege periode en 0 rijen door een mislukte fetch/upsert zagen er voorheen
 *  identiek uit. */
export interface MetaSyncOutcome {
  rows: number;
  success: boolean;
  error?: string;
}

// Synct een niveau voor een venster: pull, map, dedupe, upsert.
export async function syncMetaLevel(ctx: SyncContext, level: MetaLevel, since: string, until: string): Promise<MetaSyncOutcome> {
  const insights = await fetchInsightsAsync(ctx, { level, since, until });
  // De fetch zelf noteert zijn eigen mislukking (zie fetchInsightsAsync); hier alleen uitlezen.
  // Zonder deze check leest "insights is leeg" altijd als "niets te syncen", ook wanneer de
  // fetch juist daarom leeg was.
  if (hasFetchFailure(`meta:${level}`)) {
    return { rows: 0, success: false, error: `ophalen mislukt voor ${level}` };
  }
  const dbRows = insights.map((r) => metaDailyToDbRow(mapInsightsRow(r), ctx.clientId, { includeRankings: level === "ad" }));
  const deduped = dedupeByKey(dbRows, ["client_id", "date", "entity_id"]);
  if (deduped.length === 0) return { rows: 0, success: true };
  const { error } = await ctx.supabase.from(LEVEL_TABLE[level]).upsert(deduped, { onConflict: META_DAILY_CONFLICT, ignoreDuplicates: false });
  if (error) {
    recordFetchFailure(`meta:${level}:upsert`, error.message, "meta");
    log.error("Upsert mislukt voor", level, error.message);
    return { rows: 0, success: false, error: error.message };
  }
  return { rows: deduped.length, success: true };
}

// Daily incremental: alle vier de niveaus over het 28-daagse trailing venster (attributie-herstatement).
// Draait binnen een eigen ophaal-fout-verzamelaar (zelfde patroon als de Google-orchestrator,
// lib/sync/orchestrator.ts): twee gelijktijdige syncs voor verschillende klanten lopen elkaar zo
// niet voor de voeten.
export async function syncMetaDaily(ctx: SyncContext, endDate: string): Promise<Record<MetaLevel, MetaSyncOutcome>> {
  const { result } = await withFetchFailures(async () => {
    const { since, until } = trailingWindow(endDate, 28);
    const result = {} as Record<MetaLevel, MetaSyncOutcome>;
    for (const level of ["account", "campaign", "adset", "ad"] as MetaLevel[]) {
      result[level] = await syncMetaLevel(ctx, level, since, until);
    }
    return result;
  });
  return result;
}

// Initiele backfill: 13 maanden, in maand-chunks om de async-pulls behapbaar te houden.
export async function syncMetaBackfill(ctx: SyncContext, endDate: string): Promise<{ rows: number; success: boolean; failedChunks: string[] }> {
  const { result } = await withFetchFailures(async () => {
    const { since, until } = backfillWindow(endDate, 13);
    let total = 0;
    const failedChunks: string[] = [];
    for (const chunk of monthlyChunks(since, until)) {
      for (const level of ["account", "campaign", "adset", "ad"] as MetaLevel[]) {
        const outcome = await syncMetaLevel(ctx, level, chunk.since, chunk.until);
        total += outcome.rows;
        if (!outcome.success) failedChunks.push(`${level} ${chunk.since}..${chunk.until}`);
      }
    }
    return { rows: total, success: failedChunks.length === 0, failedChunks };
  });
  return result;
}
