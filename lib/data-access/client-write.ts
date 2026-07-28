// De browserkant van /api/data/[table]. Vervangt de rechtstreekse supabase.from(...).insert()
// en vrienden in componenten.
//
// Bewust ZONDER "use client": dit is een gewone module met fetch-aanroepen, geen component.
// Met de directive wordt het een client-grens, en modules als lib/clients.ts — die ook in
// servercontext geladen worden — kunnen er dan niet meer van importeren. De relatieve URL
// werkt alleen in de browser, en dat is ook de enige plek waar deze functies vandaan komen.
//
// De vorm van de uitkomst is met opzet gelijk aan die van supabase-js — { data, error } — zodat
// de aanroepende code niet hoeft te veranderen behalve de aanroep zelf. Dat houdt de conversie
// van 35 schrijfacties mechanisch, en mechanisch is hier belangrijker dan mooi: elke afwijking
// is een plek waar een foutafhandeling stilletjes anders gaat werken.

export interface WriteResult<T = Record<string, unknown>> {
  data: T[] | null;
  error: { message: string } | null;
}

type Op = "insert" | "update" | "upsert" | "delete";

async function post(table: string, body: Record<string, unknown>): Promise<WriteResult> {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as
      | { data?: Record<string, unknown>[]; error?: string }
      | null;
    if (!res.ok) {
      return { data: null, error: { message: payload?.error ?? `HTTP ${res.status}` } };
    }
    return { data: payload?.data ?? [], error: null };
  } catch (e) {
    // Een netwerkfout is hier hetzelfde soort gebeurtenis als een databasefout: de schrijfactie
    // is niet gebeurd. Door hem in dezelfde vorm terug te geven hoeft de aanroeper geen tweede
    // foutpad te hebben.
    return { data: null, error: { message: e instanceof Error ? e.message : "netwerkfout" } };
  }
}

function withOp(op: Op, table: string, rest: Record<string, unknown>): Promise<WriteResult> {
  return post(table, { op, ...rest });
}

/** clientId is verplicht bij beurs-gebonden tabellen; de server vult de kolom zelf in. */
export function dbInsert(
  table: string,
  clientId: string | null,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<WriteResult> {
  return withOp("insert", table, { clientId, rows: Array.isArray(rows) ? rows : [rows] });
}

export function dbUpsert(
  table: string,
  clientId: string | null,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<WriteResult> {
  return withOp("upsert", table, { clientId, rows: Array.isArray(rows) ? rows : [rows] });
}

export function dbUpdate(
  table: string,
  clientId: string | null,
  values: Record<string, unknown>,
  match: Record<string, unknown>,
): Promise<WriteResult> {
  return withOp("update", table, { clientId, values, match });
}

export function dbDelete(
  table: string,
  clientId: string | null,
  match: Record<string, unknown>,
): Promise<WriteResult> {
  return withOp("delete", table, { clientId, match });
}

/** Batch-update op een lijst waarden, het equivalent van .in(kolom, waarden). */
export function dbUpdateIn(
  table: string,
  clientId: string | null,
  values: Record<string, unknown>,
  column: string,
  inValues: unknown[],
): Promise<WriteResult> {
  return withOp("update", table, { clientId, values, matchIn: { column, values: inValues } });
}
