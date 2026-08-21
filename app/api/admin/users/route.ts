// =====================================================================
// W1.2 (O1, 5e): server-side gebruikersbeheer. Alle handlers staan ALTIJD achter
// requireCapability("user:manage"), onafhankelijk van de O1_AUTH_ENFORCED-flag: gebruikersbeheer
// zonder auth is per definitie onveilig, dus deze route werkt pas zodra er ingelogde
// admins bestaan (seed via scripts/seed-first-admin.mjs). LIVE-ONGETEST: de invite-mail,
// ban en de admin-API vergen de echte Supabase-omgeving, en de reset-redirect moet in de
// Supabase-config als toegestane URL staan.
// =====================================================================

import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ALL_CLIENTS, isRole, normalizeRole, ROLES, scopeFor } from "@/lib/auth/roles";

function adminUnavailable(): Response {
  return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });
}

// Telt de huidige admins; de guards voorkomen dat de laatste admin zichzelf buitensluit.
async function countAdmins(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<number> {
  const { count } = await admin
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin");
  return count ?? 0;
}

export async function GET() {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const [{ data: roleRows }, { data: clientRows }, { data: agencyRows }] = await Promise.all([
    admin.from("user_roles").select("user_id, role"),
    admin.from("user_clients").select("user_id, client_id"),
    admin.from("user_agencies").select("user_id"),
  ]);
  const roleByUser = new Map((roleRows ?? []).map((row) => [String(row.user_id), String(row.role)]));
  const clientsByUser = new Map<string, string[]>();
  for (const row of clientRows ?? []) {
    const key = String(row.user_id);
    clientsByUser.set(key, [...(clientsByUser.get(key) ?? []), String(row.client_id)]);
  }
  const usersWithAgency = new Set((agencyRows ?? []).map((row) => String(row.user_id)));

  const users = data.users.map((user) => {
    const role = normalizeRole(roleByUser.get(user.id));
    return {
      id: user.id,
      email: user.email ?? null,
      role,
      clients: clientsByUser.get(user.id) ?? [],
      // Zodat de UI "alle beurzen" niet als een lege lijst toont: bij deze rollen zegt de
      // toewijzing niets, de rol dekt per definitie alles.
      seesAllClients: scopeFor(role, []) === ALL_CLIENTS,
      // Een organisatiebrede rol ZONDER user_agencies-koppeling ziet in werkelijkheid niets
      // (bepaalScope() in lib/auth/scope.ts valt terug op scope: [] zonder bureau) -- dus
      // "alle beurzen" hierboven is dan een leugen. Zie de uitleg bij ensureAgencyLink.
      hasAgency: usersWithAgency.has(user.id),
      deactivated: Boolean((user as { banned_until?: string | null }).banned_until),
      lastSignIn: user.last_sign_in_at ?? null,
    };
  });
  return Response.json({ users });
}

// De beurs-toewijzing van een gebruiker vervangen. Bewust vervangen en niet samenvoegen:
// een beurs afnemen moet net zo makkelijk zijn als er een geven, en een PATCH die alleen
// kan toevoegen levert scope die stilletjes blijft groeien.
async function replaceClients(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  clients: string[],
): Promise<string | null> {
  const gewenst = [...new Set(clients.map((c) => c.trim()).filter(Boolean))];
  const { error: delError } = await admin.from("user_clients").delete().eq("user_id", userId);
  if (delError) return delError.message;
  if (gewenst.length === 0) return null;
  const { error } = await admin
    .from("user_clients")
    .insert(gewenst.map((client_id) => ({ user_id: userId, client_id })));
  return error?.message ?? null;
}

// Koppelt de gebruiker aan de bureaus van de HANDELENDE beheerder. Zonder deze koppeling
// levert bepaalScope() (lib/auth/scope.ts) voor een organisatiebrede rol scope: [] op --
// "onvoldoende rechten" ondanks een correcte rol, want die functie valt met opzet niet
// stilzwijgend terug op "geen bureau dus maar alles". Precies dit overkwam een collega die
// buiten deze route om is aangemaakt (rol wel gezet, user_agencies nooit): bleek bij
// onderzoek geen eenmalige fout te zijn maar een gat in deze route zelf, die het via de
// normale uitnodiging ook nooit deed. Bewust puur additief (nooit een bestaande koppeling
// weghalen) en alleen zinvol als de handelende beheerder zelf ergens bij hoort -- een
// platformbeheerder zonder eigen bureau (platform_beheerders, migratie 057) heeft hier
// niets om aan te koppelen, en dat blijft dan zoals het was.
async function ensureAgencyLink(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  agencyIds: readonly string[],
): Promise<string | null> {
  if (agencyIds.length === 0) return null;
  const { error } = await admin
    .from("user_agencies")
    .upsert(
      agencyIds.map((agency_id) => ({ user_id: userId, agency_id })),
      { onConflict: "user_id,agency_id", ignoreDuplicates: true },
    );
  return error?.message ?? null;
}

export async function POST(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as
    | { email?: string; role?: string; clients?: string[] }
    | null;
  const email = body?.email?.trim();
  const role = body?.role;
  if (!email || !isRole(role)) {
    return Response.json({ error: `email en een geldige rol (${ROLES.join(", ")}) zijn verplicht` }, { status: 400 });
  }
  // Een rol met een eigen beurs-scope zonder beurzen ziet niets. Dat is bijna nooit de
  // bedoeling, dus het is een fout en geen stilzwijgend lege toegang.
  const clients = body?.clients ?? [];
  if (scopeFor(role, []) !== ALL_CLIENTS && clients.length === 0) {
    return Response.json(
      { error: `de rol ${role} werkt per beurs; wijs minimaal een beurs toe` },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/reset`,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const userId = data.user?.id ?? null;
  if (userId) {
    const { error: roleError } = await admin.from("user_roles").upsert({ user_id: userId, role });
    if (roleError) return Response.json({ error: roleError.message }, { status: 500 });
    const clientError = await replaceClients(admin, userId, clients);
    if (clientError) return Response.json({ error: clientError }, { status: 500 });
    const agencyError = await ensureAgencyLink(admin, userId, auth.agencyIds);
    if (agencyError) return Response.json({ error: agencyError }, { status: 500 });
  }
  return Response.json({ ok: true, userId });
}

export async function PATCH(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as
    | { userId?: string; role?: string; clients?: string[] }
    | null;
  const userId = body?.userId;
  const role = body?.role;
  if (!userId || !isRole(role)) {
    return Response.json({ error: "userId en een geldige rol zijn verplicht" }, { status: 400 });
  }

  if (role !== "admin") {
    const { data: current } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    if (current?.role === "admin" && (await countAdmins(admin)) <= 1) {
      return Response.json({ error: "De laatste admin kan niet gedegradeerd worden" }, { status: 400 });
    }
  }

  const { error } = await admin.from("user_roles").upsert({ user_id: userId, role });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const agencyError = await ensureAgencyLink(admin, userId, auth.agencyIds);
  if (agencyError) return Response.json({ error: agencyError }, { status: 500 });

  // De scope alleen aanraken als hij is meegestuurd: een rolwijziging zonder clients-veld
  // hoort de bestaande beurs-toewijzing niet weg te gooien.
  if (body?.clients) {
    const clientError = await replaceClients(admin, userId, body.clients);
    if (clientError) return Response.json({ error: clientError }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireCapability("user:manage");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return adminUnavailable();

  const body = (await request.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId;
  if (!userId) return Response.json({ error: "userId is verplicht" }, { status: 400 });
  if (userId === auth.id) {
    return Response.json({ error: "Je kunt jezelf niet deactiveren" }, { status: 400 });
  }

  const { data: current } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (current?.role === "admin" && (await countAdmins(admin)) <= 1) {
    return Response.json({ error: "De laatste admin kan niet gedeactiveerd worden" }, { status: 400 });
  }

  // Deactiveren via een lange ban: omkeerbaar, in tegenstelling tot verwijderen.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
