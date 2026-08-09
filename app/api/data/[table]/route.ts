// De enige weg waarlangs de browser nog schrijft. Zie lib/data-access/write-policy.ts voor
// het waarom en de tabellen; hier staat alleen de uitvoering.
//
// GEDRAGT ZICH VANDAAG PRECIES ALS VOORHEEN
//
// Zolang O1_AUTH_ENFORCED uit staat is er geen sessie, en zou een rechtencheck elke
// schrijfactie in de app breken. Deze route hanteert daarom dezelfde vlag als de middleware:
// staat hij uit, dan gaat de bewerking door zonder rechten- en scope-check — net zoals de
// browser hem nu rechtstreeks uitvoert. Wat WEL verandert is dat de schrijfactie voortaan
// server-side gebeurt met de service role, zodat migratie 017 de anon key kan afsluiten
// zonder dat de app stukgaat. Dat is de hele bedoeling van deze stap.

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getAuthUser } from "@/lib/auth/server";
import { can, canAccessClient } from "@/lib/auth/roles";
import { isWriteOperation, policyFor, validateWrite, type WriteOperation } from "@/lib/data-access/write-policy";
import { validateRead, readPolicyFor, type ReadFilter } from "@/lib/data-access/read-policy";

function authEnforced(): boolean {
  return process.env.O1_AUTH_ENFORCED === "true";
}

interface Body {
  op?: string;
  clientId?: string | null;
  rows?: Record<string, unknown>[];
  values?: Record<string, unknown>;
  match?: Record<string, unknown>;
}

export async function POST(request: Request, context: { params: Promise<{ table: string }> }) {
  const { table } = await context.params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || !isWriteOperation(body.op)) {
    return Response.json({ error: "op moet insert, update, upsert of delete zijn" }, { status: 400 });
  }
  const op: WriteOperation = body.op;

  const policy = policyFor(table);
  if (!policy) return Response.json({ error: `tabel ${table} is niet schrijfbaar` }, { status: 400 });

  // Rechten en scope: alleen wanneer de enforcement aan staat (zie de kop).
  let inScope = true;
  if (authEnforced()) {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
    if (!can(user.role, policy.capability)) {
      return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }
    inScope = policy.clientColumn ? canAccessClient(user.scope, body.clientId) : true;
  }

  const check = validateWrite(
    { table, op, clientId: body.clientId, rows: body.rows, values: body.values, match: body.match },
    inScope,
  );
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
  }

  const from = admin.from(table);

  // match en matchIn worden altijd samen toegepast; matchIn kan de beurs-grens dus niet
  // vervangen, alleen aanvullen (validateWrite weigert matchIn op de beurs-kolom).
  function filtered<T extends { match: (m: Record<string, unknown>) => T; in: (c: string, v: unknown[]) => T }>(q: T): T {
    const withMatch = q.match(check.ok ? check.match : {});
    return check.ok && check.matchIn ? withMatch.in(check.matchIn.column, check.matchIn.values) : withMatch;
  }

  const { data, error } =
    op === "insert"
      ? await from.insert(check.rows).select()
      : op === "upsert"
        ? await from.upsert(check.rows, check.policy.conflictTarget ? { onConflict: check.policy.conflictTarget } : undefined).select()
        : op === "update"
          ? await filtered(from.update(check.values)).select()
          : await filtered(from.delete()).select();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, data: data ?? [] });
}

// De leeskant. Zelfde vlag, zelfde reden als POST hierboven: zolang O1_AUTH_ENFORCED uit staat
// gaat de leesactie door zonder rechten- en scope-check, precies het gedrag dat de browser nu
// met de anon-sleutel al had. Wat WEL verandert: de query loopt voortaan server-side met de
// service role, zodat migratie 065 (RLS op deze tabellen) straks aan kan zonder dat er eerst een
// sessie moet bestaan. Zie lib/data-access/read-policy.ts voor het "waarom nu al" per tabel.
interface ReadBody {
  select?: string;
  clientId?: string | null;
  clientIds?: string[];
  filters?: ReadFilter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: "maybeSingle" | "single";
}

export async function GET(request: Request, context: { params: Promise<{ table: string }> }) {
  const { table } = await context.params;
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const body = (q ? JSON.parse(q) : null) as ReadBody | null;
  if (!body?.select) return Response.json({ error: "q met minstens select is verplicht" }, { status: 400 });

  let inScope = true;
  if (authEnforced()) {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
    const policy = readPolicyFor(table);
    if (!policy) return Response.json({ error: `tabel ${table} is niet leesbaar` }, { status: 400 });
    if (!can(user.role, policy.capability)) {
      return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }
    inScope = !policy.clientColumn || (
      body.clientId
        ? canAccessClient(user.scope, body.clientId)
        : (body.clientIds ?? []).every((id) => canAccessClient(user.scope, id))
    );
  }

  const check = validateRead(
    { table, select: body.select, clientId: body.clientId, clientIds: body.clientIds, filters: body.filters, order: body.order, limit: body.limit, single: body.single },
    inScope,
  );
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
  }

  let query = admin.from(table).select(check.select);
  if (check.clientFilter) {
    query = "clientId" in check.clientFilter
      ? query.eq(check.clientFilter.column, check.clientFilter.clientId)
      : query.in(check.clientFilter.column, check.clientFilter.clientIds);
  }
  for (const f of check.filters) {
    if (f.op === "eq") query = query.eq(f.column, f.value);
    else if (f.op === "neq") query = query.neq(f.column, f.value);
    else if (f.op === "in") query = query.in(f.column, f.values);
    else if (f.op === "isNull") query = query.is(f.column, null);
    else if (f.op === "notNull") query = query.not(f.column, "is", null);
  }
  if (check.order) query = query.order(check.order.column, { ascending: check.order.ascending });
  if (check.limit != null) query = query.limit(check.limit);

  const { data, error } =
    check.single === "maybeSingle" ? await query.maybeSingle()
      : check.single === "single" ? await query.single()
        : await query;

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, data: data ?? (check.single ? null : []) });
}
