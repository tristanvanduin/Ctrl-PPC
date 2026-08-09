// De browserkant van GET /api/data/[table]. Zie lib/data-access/client-write.ts voor de
// schrijfkant en dezelfde reden om te bestaan: dit vervangt de rechtstreekse
// supabase.from(...).select()-aanroepen in componenten door een server-side leesactie met de
// service role. Zie lib/data-access/read-policy.ts voor welke tabellen en waarom.
//
// Bewust ZONDER "use client": een gewone module met fetch-aanroepen, geen component. Zie de kop
// van client-write.ts voor de volledige toelichting -- die geldt hier woordelijk hetzelfde.

import type { ReadFilter } from "./read-policy";

export interface ReadOptions {
  select: string;
  clientId?: string | null;
  clientIds?: string[];
  filters?: ReadFilter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

async function get(
  table: string,
  body: ReadOptions & { single?: "maybeSingle" | "single" }
): Promise<{ data: unknown; error: { message: string } | null }> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(table)}?q=${encodeURIComponent(JSON.stringify(body))}`);
    const payload = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null;
    if (!res.ok) {
      return { data: null, error: { message: payload?.error ?? `HTTP ${res.status}` } };
    }
    return { data: payload?.data ?? null, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "netwerkfout" } };
  }
}

/** Een lijst rijen. Lege of falende respons geeft [] terug -- zelfde gedrag als `data ?? []` op
 *  de oude supabase-js-aanroepen die dit vervangt. */
export async function dbSelect<T = Record<string, unknown>>(table: string, opts: ReadOptions): Promise<{ data: T[]; error: { message: string } | null }> {
  const { data, error } = await get(table, opts);
  return { data: (data as T[] | null) ?? [], error };
}

/** Eén rij of null -- het equivalent van .maybeSingle(). */
export async function dbSelectOne<T = Record<string, unknown>>(
  table: string,
  opts: Omit<ReadOptions, "order" | "limit">
): Promise<{ data: T | null; error: { message: string } | null }> {
  const { data, error } = await get(table, { ...opts, single: "maybeSingle" });
  return { data: data as T | null, error };
}
