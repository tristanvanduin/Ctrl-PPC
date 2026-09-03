// De kanaalkoppeling per klant: welk Meta-, LinkedIn- of Microsoft-account hoort bij welke
// klant. Dit is de rij in meta_connections / linkedin_connections / microsoft_connections die de
// kanaalsyncs (lib/sync/kanaal-runs.ts) nodig hebben om überhaupt te kunnen beginnen.
//
// WAAROM DIT BESTAAT
//
// Op 3 september 2026 bleek dat geen enkele echte klant zo'n rij had, en dat niets in de app er
// een kon aanmaken. De bureau-OAuth (agency_connections, lib/tenancy/koppelingen.ts) regelde
// het TOKEN van het bureau, maar de stap "dit token mag voor deze klant account X lezen" bestond
// alleen in migratiescripts. Elke kanaalsync eindigde dus in "geen_koppeling", elke kanaalanalyse
// in "geen data". Deze module is die ontbrekende stap, met de route /api/kanaal-koppeling en de
// sectie in Instellingen als aanroepers.
//
// De regels zijn dezelfde als in de rest van de herbouw: een queryfout is een fout
// (DataLaagFout), en het overzicht komt uit de data zelf (koppelingsrij, laatste run, dagstand),
// niet uit een opgeslagen label.

import type { SupabaseClient } from "@supabase/supabase-js";
import { eis, DataLaagFout } from "@/lib/analysis/db-veilig";
import { klantVanId } from "@/lib/tenancy/klanten";
import { leesKoppelingen, type Provider, type KoppelingStatus } from "@/lib/tenancy/koppelingen";
import { dagstandVoorKlant, DAGKANAAL_LABEL, type Dagstand } from "./datastand";
import { KANAAL_TABELLEN, type SyncKanaal } from "./kanaal-runs";

export type KoppelKanaal = SyncKanaal;
export const KOPPEL_KANALEN: readonly KoppelKanaal[] = ["meta", "linkedin", "microsoft"];
export const KANAAL_PROVIDER: Record<KoppelKanaal, Provider> = { meta: "meta", linkedin: "linkedin", microsoft: "microsoft_ads" };
export const KANAAL_LABEL = DAGKANAAL_LABEL;

/** De kolom waarin de koppelingsrij het account-id draagt; per tabel anders (historisch). */
export const ACCOUNT_KOLOM: Record<KoppelKanaal, string> = { meta: "ad_account_id", linkedin: "ad_account_urn", microsoft: "account_id" };

export function isKoppelKanaal(v: unknown): v is KoppelKanaal {
  return typeof v === "string" && (KOPPEL_KANALEN as readonly string[]).includes(v);
}

// ── Puur: normaliseren en valideren ─────────────────────────────────────────

/**
 * Het account-id in de vorm die de sync verwacht, of null als het geen id is.
 *   meta:      "123456" of "act_123456"                     → "act_123456"
 *   linkedin:  "123456" of "urn:li:sponsoredAccount:123456" → "urn:li:sponsoredAccount:123456"
 *   microsoft: "123456"                                     → "123456"
 */
export function normaliseerAccountId(kanaal: KoppelKanaal, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (kanaal === "meta") {
    const m = /^(?:act_)?(\d{3,})$/.exec(s);
    return m ? `act_${m[1]}` : null;
  }
  if (kanaal === "linkedin") {
    const m = /^(?:urn:li:sponsoredAccount:)?(\d{3,})$/.exec(s);
    return m ? `urn:li:sponsoredAccount:${m[1]}` : null;
  }
  return /^\d{3,}$/.test(s) ? s : null;
}

export interface KoppelVerzoek {
  clientId: string;
  kanaal: KoppelKanaal;
  accountId: string;
  /** Alleen Microsoft: het customer-id (de beheerlaag boven het account). */
  customerId: string | null;
  valuta: string | null;
}

export function valideerKoppelVerzoek(body: unknown): { ok: true; verzoek: KoppelVerzoek } | { ok: false; fout: string } {
  if (!body || typeof body !== "object") return { ok: false, fout: "Verwacht een JSON-object" };
  const b = body as Record<string, unknown>;
  const clientId = typeof b.client_id === "string" ? b.client_id.trim() : "";
  if (!clientId) return { ok: false, fout: "client_id ontbreekt" };
  if (!isKoppelKanaal(b.kanaal)) return { ok: false, fout: `kanaal moet een van ${KOPPEL_KANALEN.join(", ")} zijn` };
  const kanaal = b.kanaal;
  const accountId = normaliseerAccountId(kanaal, b.account_id);
  if (!accountId) {
    const vorm = kanaal === "meta" ? "act_<cijfers> of alleen cijfers" : kanaal === "linkedin" ? "urn:li:sponsoredAccount:<cijfers> of alleen cijfers" : "alleen cijfers";
    return { ok: false, fout: `account_id ongeldig voor ${KANAAL_LABEL[kanaal]}: verwacht ${vorm}` };
  }
  let customerId: string | null = null;
  if (kanaal === "microsoft" && b.customer_id != null && b.customer_id !== "") {
    const c = typeof b.customer_id === "string" ? b.customer_id.trim() : typeof b.customer_id === "number" ? String(b.customer_id) : "";
    if (!/^\d{3,}$/.test(c)) return { ok: false, fout: "customer_id ongeldig: alleen cijfers" };
    customerId = c;
  }
  let valuta: string | null = null;
  if (b.currency != null && b.currency !== "") {
    const v = typeof b.currency === "string" ? b.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(v)) return { ok: false, fout: "currency ongeldig: verwacht een ISO-code van drie letters" };
    valuta = v;
  }
  return { ok: true, verzoek: { clientId, kanaal, accountId, customerId, valuta } };
}

/** De rij die de koppeling vastlegt. `token_ref` op meta_connections is NOT NULL uit het oude
 *  per-klant-tokenontwerp; "bureau" zegt dat het token sinds migratie 062 via de kluis van het
 *  bureau loopt (kanaal-runs leest die kolom bewust niet). */
export function koppelRij(verzoek: KoppelVerzoek, nu: string = new Date().toISOString()): { tabel: string; rij: Record<string, unknown> } {
  const basis = { client_id: verzoek.clientId, currency: verzoek.valuta, status: "active", last_error: null, updated_at: nu };
  if (verzoek.kanaal === "meta") {
    return { tabel: "meta_connections", rij: { ...basis, ad_account_id: verzoek.accountId, token_ref: "bureau" } };
  }
  if (verzoek.kanaal === "linkedin") {
    return { tabel: "linkedin_connections", rij: { ...basis, ad_account_urn: verzoek.accountId } };
  }
  return { tabel: "microsoft_connections", rij: { ...basis, account_id: verzoek.accountId, customer_id: verzoek.customerId } };
}

// ── Schrijven ───────────────────────────────────────────────────────────────

export async function koppelKanaal(supabase: SupabaseClient, verzoek: KoppelVerzoek): Promise<void> {
  const { tabel, rij } = koppelRij(verzoek);
  const { error } = await supabase.from(tabel).upsert(rij, { onConflict: "client_id" });
  if (error) throw new DataLaagFout(`${tabel} (koppelen)`, error.message);
}

/** Zet de koppeling uit. De rij blijft staan (met status "disabled"): "ontkoppeld op ..." is
 *  een ander verhaal dan "nooit gekoppeld", en de sync-historie hangt eraan. */
export async function ontkoppelKanaal(supabase: SupabaseClient, clientId: string, kanaal: KoppelKanaal): Promise<{ gevonden: boolean }> {
  const tabel = KANAAL_TABELLEN[kanaal].koppeling;
  const res = await supabase.from(tabel)
    .update({ status: "disabled", last_error: "ontkoppeld via Instellingen", updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .select("client_id");
  const rijen = eis(res, `${tabel} (ontkoppelen)`) as unknown[];
  return { gevonden: rijen.length > 0 };
}

// ── Lezen: het overzicht per klant ──────────────────────────────────────────

export interface KanaalKoppelingStand {
  kanaal: KoppelKanaal;
  label: string;
  /** Er is een rij en die staat niet op disabled. */
  gekoppeld: boolean;
  accountId: string | null;
  customerId: string | null;
  status: string | null;
  laatsteSync: string | null;
  laatsteFout: string | null;
  valuta: string | null;
  laatsteRun: { status: string | null; gestart: string | null; fout: string | null } | null;
  dagstand: Dagstand;
}

export async function leesKanaalKoppelingen(supabase: SupabaseClient, clientId: string): Promise<KanaalKoppelingStand[]> {
  const uit: KanaalKoppelingStand[] = [];
  for (const kanaal of KOPPEL_KANALEN) {
    const { koppeling: tabel, runs } = KANAAL_TABELLEN[kanaal];
    const kolommen = `${ACCOUNT_KOLOM[kanaal]}, status, last_sync_at, last_error, currency${kanaal === "microsoft" ? ", customer_id" : ""}`;
    const [rijRes, runRes, dagstand] = await Promise.all([
      supabase.from(tabel).select(kolommen).eq("client_id", clientId).limit(1),
      supabase.from(runs).select("status, started_at, error").eq("client_id", clientId).order("started_at", { ascending: false }).limit(1),
      dagstandVoorKlant(supabase, clientId, kanaal),
    ]);
    // Via unknown: de select-string is hier dynamisch (kolom per kanaal), en dan typeert de
    // Supabase-client het resultaat als een foutvorm in plaats van als rijen.
    const rij = (eis(rijRes, `${tabel} (koppelingstand)`) as unknown as Record<string, unknown>[])[0] ?? null;
    const run = (eis(runRes, `${runs} (laatste run)`) as unknown as Record<string, unknown>[])[0] ?? null;
    const status = rij && rij.status != null ? String(rij.status) : null;
    const tekst = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
    uit.push({
      kanaal,
      label: KANAAL_LABEL[kanaal],
      gekoppeld: rij !== null && status !== "disabled",
      accountId: rij ? tekst(rij[ACCOUNT_KOLOM[kanaal]]) : null,
      customerId: rij ? tekst(rij.customer_id) : null,
      status,
      laatsteSync: rij ? tekst(rij.last_sync_at) : null,
      laatsteFout: rij ? tekst(rij.last_error) : null,
      valuta: rij ? tekst(rij.currency) : null,
      laatsteRun: run ? { status: tekst(run.status), gestart: tekst(run.started_at), fout: tekst(run.error) } : null,
      dagstand,
    });
  }
  return uit;
}

// ── De bureaukant: is er een token om mee te syncen? ────────────────────────

export type CredentialBronStand = "bureau" | "omgeving" | null;

export interface BureauKanaalStand {
  status: KoppelingStatus | null;
  heeftToken: boolean;
  /** Of een sync voor dit kanaal aan credentials kan komen: bureau-OAuth of omgevingsterugval. */
  bruikbaar: boolean;
  bron: CredentialBronStand;
}

/** Puur: de omgevingsterugval, spiegel van kanaal-credentials.ts. */
export function omgevingHeeftCredentials(kanaal: KoppelKanaal, env: Record<string, string | undefined> = process.env): boolean {
  const heeft = (...k: string[]) => k.every((naam) => !!(env[naam] ?? "").trim());
  if (kanaal === "meta") return heeft("META_ADS_APP_ID", "META_ADS_APP_SECRET", "META_ADS_ACCESS_TOKEN");
  if (kanaal === "linkedin") return heeft("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REFRESH_TOKEN");
  return heeft("MICROSOFT_ADS_CLIENT_ID", "MICROSOFT_ADS_CLIENT_SECRET", "MICROSOFT_ADS_DEVELOPER_TOKEN", "MICROSOFT_ADS_REFRESH_TOKEN");
}

export async function bureauKoppelingStand(
  supabase: SupabaseClient,
  clientId: string
): Promise<{ agencyId: string | null; perKanaal: Record<KoppelKanaal, BureauKanaalStand> }> {
  const agencyId = (await klantVanId(supabase, clientId))?.agencyId ?? null;
  const koppelingen = agencyId ? await leesKoppelingen(supabase, agencyId) : [];
  const perKanaal = {} as Record<KoppelKanaal, BureauKanaalStand>;
  for (const kanaal of KOPPEL_KANALEN) {
    const k = koppelingen.find((x) => x.provider === KANAAL_PROVIDER[kanaal]) ?? null;
    const bureauOk = !!k && k.status === "actief" && k.heeftToken;
    const omgevingOk = omgevingHeeftCredentials(kanaal);
    perKanaal[kanaal] = {
      status: k?.status ?? null,
      heeftToken: k?.heeftToken ?? false,
      bruikbaar: bureauOk || omgevingOk,
      bron: bureauOk ? "bureau" : omgevingOk ? "omgeving" : null,
    };
  }
  return { agencyId, perKanaal };
}
