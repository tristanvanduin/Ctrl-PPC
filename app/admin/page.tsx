"use client";

// Admin-beheer. De server-side API (app/api/admin/users, altijd achter
// requireCapability("user:manage")) is de waarheid; deze pagina is de bediening.
//
// Twee assen: de ROL bepaalt wat iemand mag, de BEURZEN bepalen waarover. Voor rollen die
// per definitie alle beurzen dekken is de beurskeuze uitgeschakeld in plaats van verborgen,
// zodat zichtbaar blijft dat die as bestaat. LIVE-ONGETEST tot WL.3.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_CLIENTS, ROLES, ROL_LABEL, scopeFor, type Role } from "@/lib/auth/roles";
import { getAllClients, type Client } from "@/lib/clients";

interface AdminUser {
  id: string;
  email: string | null;
  role: Role | null;
  clients: string[];
  seesAllClients: boolean;
  deactivated: boolean;
  lastSignIn: string | null;
}

const ROL_UITLEG: Record<Role, string> = {
  admin: "Alles, plus gebruikersbeheer en koppelingen.",
  performance_marketeer: "Alle beurzen, alle inzichten, runs en instellingen.",
  beurs_manager: "Eigen beurzen: alle inzichten en de sprint, geen runs of instellingen.",
  brand_strateeg: "Merk- en creatie-inzichten, lezend. Geen budget of biedingen.",
  it: "Koppelingen, syncs en techniek. Geen inzichten of instellingen.",
  viewer: "Meekijken bij de eigen beurzen, verder niets.",
};

function dektAlleBeurzen(role: Role | null): boolean {
  return role !== null && scopeFor(role, []) === ALL_CLIENTS;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [beurzen, setBeurzen] = useState<Client[]>([]);
  const [laden, setLaden] = useState(true);
  const [melding, setMelding] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("performance_marketeer");
  const [inviteClients, setInviteClients] = useState<string[]>([]);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setLaden(true);
    const res = await fetch("/api/admin/users");
    if (res.status === 401 || res.status === 403) {
      setMelding("Log in als admin om gebruikers te beheren.");
      setUsers([]);
      setLaden(false);
      return;
    }
    const data = (await res.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Laden mislukt.");
      setLaden(false);
      return;
    }
    setUsers(data?.users ?? []);
    setMelding(null);
    setLaden(false);
  }, []);

  useEffect(() => {
    void laad();
    setBeurzen(getAllClients());
  }, [laad]);

  // Beurzen die aan iemand zijn toegewezen maar niet (meer) in de lijst staan, blijven
  // zichtbaar. Anders verdwijnt een toewijzing stilletjes uit beeld terwijl hij nog geldt.
  const beursOpties = useMemo(() => {
    const bekend = new Map(beurzen.map((c) => [c.id, c.name]));
    for (const user of users) {
      for (const id of user.clients) if (!bekend.has(id)) bekend.set(id, `${id} (onbekend)`);
    }
    return [...bekend.entries()].map(([id, name]) => ({ id, name }));
  }, [beurzen, users]);

  const inviteDektAlles = dektAlleBeurzen(inviteRole);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, clients: inviteClients }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    setBezig(false);
    if (!res.ok) {
      setMelding(data?.error ?? "Uitnodigen mislukt.");
      return;
    }
    setMelding(`Uitnodiging verstuurd naar ${inviteEmail}.`);
    setInviteEmail("");
    setInviteClients([]);
    void laad();
  }

  // Rol en beurzen lopen via dezelfde PATCH: een rolwijziging kan de beurs-eis raken, dus
  // ze horen in een verzoek thuis en niet in twee die elkaar kunnen kruisen.
  async function wijzig(userId: string, role: Role, clients: string[]) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role, clients }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Wijzigen mislukt.");
      return;
    }
    setMelding(null);
    void laad();
  }

  async function deactiveer(userId: string, email: string | null) {
    if (!window.confirm(`Weet je zeker dat je ${email ?? "deze gebruiker"} wilt deactiveren?`)) return;
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setMelding(data?.error ?? "Deactiveren mislukt.");
      return;
    }
    setMelding(null);
    void laad();
  }

  function toggleBeurs(huidig: string[], id: string): string[] {
    return huidig.includes(id) ? huidig.filter((c) => c !== id) : [...huidig, id];
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Gebruikersbeheer</h1>
      <p className="mb-6 text-sm text-gray-500">
        De rol bepaalt wat iemand mag, de beurzen bepalen waarover. Alleen voor admins.
      </p>

      <form onSubmit={invite} className="mb-8 rounded-lg border border-gray-200 bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-gray-700">
              E-mail uitnodigen
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1 block text-sm font-medium text-gray-700">
              Rol
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={bezig}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {bezig ? "Bezig..." : "Uitnodigen"}
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-500">{ROL_UITLEG[inviteRole]}</p>

        <fieldset className="mt-4 border-t border-gray-100 pt-3">
          <legend className="sr-only">Beurzen</legend>
          <p className="mb-2 text-sm font-medium text-gray-700">
            Beurzen{" "}
            {inviteDektAlles && (
              <span className="font-normal text-gray-500">
                — deze rol dekt alle beurzen, ook nieuwe
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {beursOpties.map((beurs) => (
              <label
                key={beurs.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                  inviteDektAlles
                    ? "cursor-not-allowed border-gray-200 text-gray-400"
                    : "cursor-pointer border-gray-300 text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={inviteDektAlles}
                  checked={inviteDektAlles || inviteClients.includes(beurs.id)}
                  onChange={() => setInviteClients((huidig) => toggleBeurs(huidig, beurs.id))}
                />
                {beurs.name}
              </label>
            ))}
            {beursOpties.length === 0 && (
              <p className="text-sm text-gray-500">Nog geen beurzen bekend.</p>
            )}
          </div>
        </fieldset>
      </form>

      {melding && <p className="mb-4 text-sm text-red-600">{melding}</p>}

      {laden ? (
        <p className="text-sm text-gray-500">Laden...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">E-mail</th>
                <th className="px-4 py-2 font-medium">Rol</th>
                <th className="px-4 py-2 font-medium">Beurzen</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-2 text-gray-900">{user.email ?? user.id}</td>
                  <td className="px-4 py-2">
                    <select
                      value={user.role ?? ""}
                      onChange={(e) => void wijzig(user.id, e.target.value as Role, user.clients)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                    >
                      {user.role === null && <option value="">geen rol</option>}
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROL_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {user.seesAllClients ? (
                      <span className="text-gray-500">alle beurzen</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {beursOpties.map((beurs) => {
                          const aan = user.clients.includes(beurs.id);
                          return (
                            <button
                              key={beurs.id}
                              type="button"
                              onClick={() =>
                                user.role &&
                                void wijzig(user.id, user.role, toggleBeurs(user.clients, beurs.id))
                              }
                              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                aan
                                  ? "border-gray-900 bg-gray-900 text-white"
                                  : "border-gray-300 text-gray-500 hover:border-gray-400"
                              }`}
                            >
                              {beurs.name}
                            </button>
                          );
                        })}
                        {user.clients.length === 0 && (
                          <span className="text-xs text-amber-700">
                            geen beurs toegewezen — ziet niets
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{user.deactivated ? "gedeactiveerd" : "actief"}</td>
                  <td className="px-4 py-2 text-right">
                    {!user.deactivated && (
                      <button
                        type="button"
                        onClick={() => void deactiveer(user.id, user.email)}
                        className="text-sm text-red-600 underline hover:text-red-700"
                      >
                        Deactiveren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Geen gebruikers zichtbaar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
