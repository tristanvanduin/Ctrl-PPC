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
  // Het vierde kanaal (migratie 106). Zelfde patroon als de meta_*- en linkedin_*-tabellen.
  microsoft_campaigns: { capability: "client:read", clientColumn: "client_id" },
  microsoft_adgroups: { capability: "client:read", clientColumn: "client_id" },
  microsoft_account_daily: { capability: "client:read", clientColumn: "client_id" },
  microsoft_campaign_daily: { capability: "client:read", clientColumn: "client_id" },
  microsoft_adgroup_daily: { capability: "client:read", clientColumn: "client_id" },
  microsoft_breakdown_daily: { capability: "client:read", clientColumn: "client_id" },
  microsoft_keyword_monthly: { capability: "client:read", clientColumn: "client_id" },
  microsoft_search_terms_monthly: { capability: "client:read", clientColumn: "client_id" },
  microsoft_campaign_impression_share: { capability: "client:read", clientColumn: "client_id" },
  microsoft_profile_monthly: { capability: "client:read", clientColumn: "client_id" },
  meta_campaigns: { capability: "client:read", clientColumn: "client_id" },
  linkedin_campaigns: { capability: "client:read", clientColumn: "client_id" },
  meta_hourly_performance: { capability: "client:read", clientColumn: "client_id" },
  meta_ads: { capability: "client:read", clientColumn: "client_id" },
  meta_creatives: { capability: "client:read", clientColumn: "client_id" },
  linkedin_creatives: { capability: "client:read", clientColumn: "client_id" },
  ads_creative_performance: { capability: "client:read", clientColumn: "client_id" },
  // components/dashboard/creative-performance.tsx haalde de METRICS voor Meta/LinkedIn (in
  // tegenstelling tot de identiteitstabellen twee regels hierboven, die al langer via dbSelect
  // liepen) nog rechtstreeks op met supabase.from() -- in demo-modus loopt dat via de
  // demo-mock (lib/demo/mock-supabase.ts), die alleen de curated fixture in demo-rows.ts
  // teruggeeft. Die fixture droeg nog de oude ad-id's (demo-m-hero, ...); de echte database was
  // ondertussen doorgeseed met een nieuwe reeks (demo-ad-hero-a, ...) waar de identiteitstabellen
  // (via dbSelect, dus altijd de echte database) al wel op stonden. Twee routes naar dezelfde
  // kaart die niet meer over dezelfde ad-id's spraken -- vandaar dat elke Meta/LinkedIn-creative
  // in demo-modus €0/0 conversies toonde terwijl de vermoeidheidstabel (die alleen de dagcijfers
  // leest, geen identiteitsjoin) wél echte cijfers had. Hier bijgezet zodat ook deze twee via
  // dbSelect lopen, dezelfde bron als de identiteitstabellen, geen tweede waarheid meer.
  meta_ad_daily: { capability: "client:read", clientColumn: "client_id" },
  linkedin_creative_daily: { capability: "client:read", clientColumn: "client_id" },
  // Zelfde route, gevonden in components/dashboard/campaigns-per-channel.tsx ("Wat er draait"):
  // de campagnenamen kwamen al via dbSelect (meta_campaigns/linkedin_campaigns, dus de echte
  // database), maar de dagcijfers waarmee ze aan elkaar geknoopt worden nog via supabase.from() --
  // in demo-modus dus de demo-mock. De curated LinkedIn-fixture in demo-rows.ts gebruikt een eigen
  // URN-schema (urn:li:demo:1...) dat niets te maken heeft met wat de echte, inmiddels doorgeseede
  // database voor demo-greentech draagt (urn:li:sponsoredCampaign:demo1...) -- dus de naam-
  // opzoeking trof nooit een match en viel terug op de rauwe URN als "naam". Beide kanten nu op
  // dezelfde bron.
  meta_campaign_daily: { capability: "client:read", clientColumn: "client_id" },
  linkedin_campaign_daily: { capability: "client:read", clientColumn: "client_id" },
  // Dezelfde route als de twee hierboven, voor Google's kant van creative-performance.tsx --
  // deze drie "toevallig" al goed omdat de curated demo-rows.ts-ad-id's daar (nog) matchten met
  // de echte database, maar dat was geluk, geen garantie. Nu structureel gelijk aan de rest.
  google_ads_rsa_assets: { capability: "client:read", clientColumn: "client_id" },
  google_ads_ad_meta: { capability: "client:read", clientColumn: "client_id" },
  google_ads_image_assets: { capability: "client:read", clientColumn: "client_id" },
  ads_pmax_asset_performance: { capability: "client:read", clientColumn: "client_id" },
  ads_asset_group_performance_monthly: { capability: "client:read", clientColumn: "client_id" },
  ads_pmax_network_breakdown: { capability: "client:read", clientColumn: "client_id" },
  // 17.32: de opener-donut (campaign-type-split.tsx) leest campagnetype + kosten/conversies per
  // maand -- zelfde tabel als CampaignTable al via een eigen, breder API-pad krijgt, maar dit is
  // de eerste rechtstreekse client-read-consument ervan, dus moet hij hier expliciet bij, net als
  // de rij hierboven.
  ads_campaign_monthly: { capability: "client:read", clientColumn: "client_id" },
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

  // 22 augustus 2026: dezelfde split-brain-bug als hierboven, gevonden bij een systematische grep
  // op resterende supabase.from()-lezers na de derde ronde. channel-performance.tsx ("Maand-
  // prestaties", gemount in elke Meta/LinkedIn-view), cross-channel-view.tsx (het Cross-channel/
  // blended-tabblad) en channel-structure-analysis.tsx (de signaaldetectie op Analyse & advies)
  // lazen deze drie tabellen nog rechtstreeks met de anon-key -- in demo-modus dus via de
  // demo-mock met lege of niet-matchende fixtures, terwijl de rest van diezelfde schermen al via
  // dbSelect liep. Zelfde symptoom als eerder: kaarten die voor demo-klanten leeg of nul draaien
  // terwijl de identieke code voor een echte klant gewoon werkt.
  meta_account_daily: { capability: "client:read", clientColumn: "client_id" },
  linkedin_account_daily: { capability: "client:read", clientColumn: "client_id" },
  blended_account_monthly: { capability: "client:read", clientColumn: "client_id" },

  // 22 augustus 2026: lib/kanalen/beschikbaar.ts's laadBeschikbareKanalen() neemt structureel een
  // client aan met .from() -- de meeste aanroepers geven de echte, service-role admin-client mee
  // (server-side cron/analyse-routes), maar components/dashboard/client-dashboard.tsx gaf de
  // browser-singleton mee, en dat is in demo-modus de demo-mock. De mock herkent alleen
  // client_id === "demo-greentech" als demo-klant (isDemoClientValue in mock-supabase.ts) -- de
  // geo-klonen demo-grt/demo-gra/demo-grn, die als eigen rijen in `accounts` bestaan met eigen
  // doorgeseede data, vallen daarbuiten en kregen dus altijd [] terug. Zichtbaar op
  // /client/demo-grt: de banier "Voor deze klant staat nog geen data in het systeem" bovenaan,
  // terwijl de kaarten eronder (die al via dbSelect liepen) gewoon €62.760 omzet en 368 conversies
  // toonden -- dezelfde pagina die zichzelf tegenspreekt. client-dashboard.tsx geeft nu een kleine
  // dbSelect-adapter mee in plaats van de singleton; de functie zelf en haar server-side
  // aanroepers blijven ongewijzigd.
  ads_account_monthly: { capability: "client:read", clientColumn: "client_id" },

  // 23 augustus 2026: channel-forecast-overview.tsx (Meta/LinkedIn's "Jaaroverzicht 2026") is de
  // eerste browser-lezer van client_targets. De tabel bestond al (migratie 002/082, fase 2
  // MASTERPLAN.md) maar werd tot nu toe uitsluitend server-side gelezen (de analyseroutes, met de
  // service-role-client) -- vandaar dat hij hier nog ontbrak. Zonder deze regel gaf /api/data een
  // 400 terug (tabel niet in READABLE_TABLES) en viel de forecast stil terug op "geen doel
  // ingesteld", niet omdat er geen doel was maar omdat de query nooit aankwam.
  client_targets: { capability: "client:read", clientColumn: "client_id" },
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
