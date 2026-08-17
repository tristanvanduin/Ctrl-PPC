// Het leesbeleid naast lib/data-access/write-policy.ts. Zelfde reden om te bestaan: twintig
// bestanden lazen sop_insights, sop_analysis_output, sop_recommendations, sop_tasks,
// sprint_hypotheses, sprint_items, client_settings en task_completions RECHTSTREEKS met de
// anon-sleutel vanuit de browser. Migratie 065 (RLS op precies deze tabellen) zou die twintig
// schermen leeg trekken zolang er niemand is ingelogd -- zie de kop van die migratie. Deze
// route is de brug: dezelfde queries, maar server-side met de service role, zodat de migratie
// straks veilig kan draaien zonder dat er eerst ergens een sessie moet bestaan.
//
// BEWUST GEEN OPEN DOORGEEFLUIK. Alleen tabellen in READABLE_TABLES zijn te lezen, en alleen de
// kolommen die de aanroeper zelf opgeeft in `select` -- die komen uit de server, nooit uit de
// URL van de browser, dus er is geen "geef me *" van buitenaf mogelijk zonder dat de tabel er
// expliciet voor is opengezet.

import type { Capability } from "../auth/roles";

export interface TableReadPolicy {
  /** Het recht dat een gebruiker moet hebben om deze tabel te lezen (pas relevant zodra
   *  O1_AUTH_ENFORCED aan staat; zie de kop van route.ts). */
  capability: Capability;
  /** De kolom die bepaalt bij welke beurs een rij hoort, of null als de tabel niet
   *  beurs-gebonden is. */
  clientColumn: string | null;
}

export const READABLE_TABLES: Record<string, TableReadPolicy> = {
  sop_insights: { capability: "client:read", clientColumn: "client_id" },
  sop_analysis_output: { capability: "client:read", clientColumn: "client_id" },
  sop_recommendations: { capability: "client:read", clientColumn: "client_id" },
  sop_tasks: { capability: "client:read", clientColumn: "client_id" },
  sprint_hypotheses: { capability: "client:read", clientColumn: "client_id" },
  sprint_items: { capability: "client:read", clientColumn: "client_id" },
  client_settings: { capability: "client:read", clientColumn: "client_id" },
  task_completions: { capability: "client:read", clientColumn: "client_id" },
  // Niet in migratie 065 (geen SOP/intelligence-tabel), maar dezelfde anon-sleutel-lezer zit in
  // hetzelfde bestand (lib/feed/use-today-feed.ts) als vier tabellen die er wél in staan. Een
  // vijfde query in diezelfde Promise.all ongemoeid laten was vreemder dan hem meenemen.
  feed_item_state: { capability: "client:read", clientColumn: "client_id" },
  // Fase 5: is_primary voor de sidebar-groepering (primair direct uitgeklapt, back-up in een
  // ingeklapt mapje). Alleen id/is_primary worden gelezen, nooit agency_id of source hier.
  accounts: { capability: "client:read", clientColumn: "client_id" },

  // Migratie 067: de granulaire Google Ads-, Meta/LinkedIn- en appdata-tabellen die rechtstreeks
  // met de anon-sleutel werden gelezen. Zie de kop van scripts/migrations/067_rls_granulaire_
  // kanalen_en_appdata.sql voor de volledige lijst schermen per tabel; deze zeventien zijn precies
  // de tabellen uit die migratie met een gevonden browser-lezer.
  meta_breakdown_daily: { capability: "client:read", clientColumn: "client_id" },
  linkedin_demographic_daily: { capability: "client:read", clientColumn: "client_id" },
  meta_campaigns: { capability: "client:read", clientColumn: "client_id" },
  linkedin_campaigns: { capability: "client:read", clientColumn: "client_id" },
  meta_hourly_performance: { capability: "client:read", clientColumn: "client_id" },
  meta_ads: { capability: "client:read", clientColumn: "client_id" },
  meta_creatives: { capability: "client:read", clientColumn: "client_id" },
  linkedin_creatives: { capability: "client:read", clientColumn: "client_id" },
  ads_creative_performance: { capability: "client:read", clientColumn: "client_id" },
  ads_pmax_asset_performance: { capability: "client:read", clientColumn: "client_id" },
  ads_asset_group_performance_monthly: { capability: "client:read", clientColumn: "client_id" },
  ads_pmax_network_breakdown: { capability: "client:read", clientColumn: "client_id" },
  // Doelgroepsplitsing (components/dashboard/audience-split.tsx): dezelfde reden als de twee
  // regels hierboven om browser-side te mogen lezen, gewoon een nieuwe consument van een tabel
  // die al bestond (migratie 067) maar tot nu toe geen UI-lezer had.
  ads_audience_performance_monthly: { capability: "client:read", clientColumn: "client_id" },
  client_files: { capability: "client:read", clientColumn: "client_id" },
  client_folders: { capability: "client:read", clientColumn: "client_id" },
  client_notes: { capability: "client:read", clientColumn: "client_id" },
  client_sync_status: { capability: "client:read", clientColumn: "client_id" },
  geo_clone_settings: { capability: "client:read", clientColumn: "client_id" },

  // Decision Terminal (Fase 2, Task 4): de Decision Log-component leest ads_change_history
  // rechtstreeks vanuit de browser. Migratie 067 zette hier al RLS op zonder browser-lezer op
  // dat moment; dit is de eerste, dus meteen via het service-role-pad en nooit via de anon-key,
  // net als de zeventien tabellen hierboven.
  ads_change_history: { capability: "client:read", clientColumn: "client_id" },

  // Migratie 096: ads_video_placements droeg nog de oude, tenant-blinde auth_read-policy uit
  // migratie 012 (elke ingelogde gebruiker ziet alles, van elk bureau) en werd rechtstreeks
  // vanuit de browser gelezen (components/dashboard/video-placements.tsx). Zelfde patroon als
  // hierboven: eerst de leeskant om naar het service-role-pad, dan pas de policy vervangen --
  // anders valt het scherm leeg zolang O1_AUTH_ENFORCED uit staat. Zie scripts/migrations/
  // 096_rls_auth_read_opruiming.sql voor de overige vijf tabellen met dezelfde oude policy, die
  // geen van alle een browser-lezer hebben en dus zonder deze stap al veilig zijn.
  ads_video_placements: { capability: "client:read", clientColumn: "client_id" },
};

export function isReadableTable(table: string): boolean {
  return Object.hasOwn(READABLE_TABLES, table);
}

export function readPolicyFor(table: string): TableReadPolicy | null {
  return isReadableTable(table) ? READABLE_TABLES[table] : null;
}

// Bewust een kleine, vaste verzameling operatoren -- precies wat de omgezette lezers nodig
// hebben (nagemeten, geen giswerk): gelijk, ongelijk, "zit in deze lijst", groter-of-gelijk en
// kleiner-of-gelijk voor een rollend datumvenster, en de twee vormen van een null-check. Geen
// vrije operator-string vanuit de client: dat zou net zo goed een eigen SQL-achtige taal zijn,
// met alle validatieproblemen van dien.
//
// gte/lte kwamen erbij met de granulaire kanaaltabellen (migratie 067): elke omgezette lezer
// daar filtert op een rollend venster ("laatste 60 dagen", "sinds vorige maand") op de datum-
// of maandkolom, nooit op de beurskolom -- dezelfde bescherming als bij eq/neq/in hieronder
// geldt dus automatisch mee.
export type ReadFilter =
  | { op: "eq"; column: string; value: string | number | boolean }
  | { op: "neq"; column: string; value: string | number | boolean }
  | { op: "in"; column: string; values: Array<string | number> }
  | { op: "gte"; column: string; value: string | number }
  | { op: "lte"; column: string; value: string | number }
  | { op: "isNull"; column: string }
  | { op: "notNull"; column: string };

export interface ReadRequest {
  table: string;
  select: string;
  /** Eén beurs: wordt eq op de beurskolom. */
  clientId?: string | null;
  /** Meerdere beurzen tegelijk (bijv. de Vandaag-feed over alle zichtbare klanten): wordt IN
   *  op de beurskolom. Nooit samen met clientId. */
  clientIds?: string[];
  filters?: ReadFilter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
  /** Weglaten geeft een array terug; "maybeSingle" of "single" spiegelt de gelijknamige
   *  supabase-js-methoden. */
  single?: "maybeSingle" | "single";
}

export type ReadRejection = { ok: false; status: 400 | 403; error: string };

export type ReadApproval = {
  ok: true;
  policy: TableReadPolicy;
  select: string;
  clientFilter: { column: string; clientId: string } | { column: string; clientIds: string[] } | null;
  filters: ReadFilter[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  single: "maybeSingle" | "single" | null;
};

/**
 * Controleert een leesverzoek tegen het beleid. Zelfde opzet als validateWrite in
 * write-policy.ts: puur, geen IO, zodat de route alleen nog hoeft uit te voeren wat hier al
 * goedgekeurd is.
 *
 * @param inScope Of de aanroeper bij deze beurs/beurzen mag. De route bepaalt dat (alleen
 *   relevant zodra O1_AUTH_ENFORCED aan staat); hier wordt het alleen toegepast.
 */
export function validateRead(req: ReadRequest, inScope: boolean): ReadApproval | ReadRejection {
  const policy = readPolicyFor(req.table);
  if (!policy) return { ok: false, status: 400, error: `tabel ${req.table} is niet leesbaar` };
  if (!req.select?.trim()) return { ok: false, status: 400, error: "select is verplicht" };
  if (req.clientId && req.clientIds) {
    return { ok: false, status: 400, error: "clientId en clientIds gaan niet samen" };
  }

  const filters = req.filters ?? [];
  if (policy.clientColumn) {
    // Een filter op de beurskolom zou de server-side tenant-scoping kunnen overschrijven of
    // aanvullen op een manier die niet via clientId/clientIds liep -- zelfde regel als matchIn
    // op de beurskolom in write-policy.ts.
    const raaktBeurskolom = filters.some((f) => f.column === policy.clientColumn);
    if (raaktBeurskolom) {
      return { ok: false, status: 400, error: `${policy.clientColumn} kan niet via filters gaan, gebruik clientId of clientIds` };
    }
    if (!req.clientId && !(req.clientIds && req.clientIds.length > 0)) {
      return { ok: false, status: 400, error: `${req.table} vereist clientId of clientIds` };
    }
    if (!inScope) return { ok: false, status: 403, error: "Onvoldoende rechten" };
  }

  let clientFilter: ReadApproval["clientFilter"] = null;
  if (policy.clientColumn) {
    clientFilter = req.clientId
      ? { column: policy.clientColumn, clientId: req.clientId }
      : { column: policy.clientColumn, clientIds: req.clientIds! };
  }

  return {
    ok: true,
    policy,
    select: req.select,
    clientFilter,
    filters,
    order: req.order ? { column: req.order.column, ascending: req.order.ascending ?? true } : null,
    limit: req.limit ?? null,
    single: req.single ?? null,
  };
}
