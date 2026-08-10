"use client";

// Admin-beheer. De server-side API (app/api/admin/users, altijd achter
// requireCapability("user:manage")) is de waarheid; deze pagina is de bediening.
//
// Twee assen: de ROL bepaalt wat iemand mag, de BEURZEN bepalen waarover. Voor rollen die
// per definitie alle beurzen dekken is de beurskeuze uitgeschakeld in plaats van verborgen,
// zodat zichtbaar blijft dat die as bestaat. LIVE-ONGETEST tot WL.3.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_CLIENTS, ROLES, ROL_LABEL, scopeFor, type Role } from "@/lib/auth/roles";
import { beoordeel, zwaarste, type Licht } from "@/lib/adoptie/stoplicht";
import { getAllClients, type Client } from "@/lib/clients";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel } from "@/components/dashboard/data-table";
import { SegmentatieBulk } from "@/components/dashboard/segmentatie-bulk";
import { MacroTrendsPreview } from "@/components/dashboard/macrotrends-preview";

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

// ── Adoptie per bureau ─────────────────────────────────────────────────────
//
// Het stoplicht dat zegt of de tool bij een bureau echt landt. Een bureau dat opzegt doet dat
// zelden plotseling: er gaat maanden aan onbenutte licentie aan vooraf, en dat is te zien.
//
// Op BUREAUNIVEAU, niet per persoon. "3 van de 12 gebruikers actief" stuurt een gesprek met de
// klant; een lijst met wie er lang niet inlogde stuurt een beoordelingsgesprek, en dat is een
// ander gereedschap. De namen staan wel in de tabel eronder -- die stonden daar al -- maar dan als
// onderdeel van gebruikersbeheer en niet als afrekening.

const LICHT_STIJL: Record<Licht, { rand: string; vlak: string; punt: string; tekst: string; label: string }> = {
  groen:    { rand: "border-green-200", vlak: "bg-green-50",  punt: "bg-green-500",  tekst: "text-green-800",  label: "Gezond" },
  amber:    { rand: "border-amber-200", vlak: "bg-amber-50",  punt: "bg-amber-500",  tekst: "text-amber-800",  label: "Let op" },
  rood:     { rand: "border-red-200",   vlak: "bg-red-50",    punt: "bg-red-500",    tekst: "text-red-800",    label: "Risico" },
  onbekend: { rand: "border-border",    vlak: "bg-muted/40",  punt: "bg-gray-400",   tekst: "text-muted-foreground", label: "Onbekend" },
};

interface AdoptieRij {
  agency_id: string; bureau: string; gekoppeld: number; actief: number;
  adoptie: number | string | null; laatst_gezien: string | null; nooit_actief: number;
}

function AdoptieSectie() {
  const [rijen, setRijen] = useState<AdoptieRij[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // ── NIET INGELOGD IS GEEN FOUT ───────────────────────────────────────────────
  //
  // Een 401 belandde in dezelfde rode balk als een kapotte server, met de tekst "Niet ingelogd".
  // Dit scherm is alleen voor beheerders, dus voor iedereen die hier per ongeluk komt -- en voor
  // iedereen die de demo bekijkt -- was dat het eerste wat er stond. Drie rode vlakken onder
  // elkaar op een scherm dat gewoon doet wat het hoort te doen.
  //
  // Rood is voor "er is iets stuk". Niet ingelogd zijn is een stand, geen storing.
  const [anoniem, setAnoniem] = useState(false);
  const [dagen, setDagen] = useState(30);

  useEffect(() => {
    let afgebroken = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/adoptie?dagen=${dagen}`);
        const body = await res.json();
        if (afgebroken) return;
        if (res.status === 401 || res.status === 403) { setAnoniem(true); setFout(null); setRijen([]); return; }
        if (!res.ok) { setFout(body?.error ?? `Fout ${res.status}`); setRijen([]); return; }
        setAnoniem(false);
        setFout(null);
        setRijen(body.bureaus ?? []);
      } catch (e) {
        if (!afgebroken) { setFout(e instanceof Error ? e.message : String(e)); setRijen([]); }
      }
    })();
    return () => { afgebroken = true; };
  }, [dagen]);

  if (rijen === null) return null;

  const oordelen = rijen.map((r) => ({
    rij: r,
    oordeel: beoordeel({
      bureau: r.bureau, gekoppeld: r.gekoppeld, actief: r.actief,
      adoptie: r.adoptie === null ? null : Number(r.adoptie),
      laatstGezien: r.laatst_gezien,
    }),
  }));
  const totaal = zwaarste(oordelen.map((o) => o.oordeel.licht));

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-rm-gray">Gebruik per bureau</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium ${LICHT_STIJL[totaal].vlak} ${LICHT_STIJL[totaal].tekst}`}>
          {/* Kleur nooit alleen: het bolletje staat naast een woord, zodat het ook leesbaar is
              voor wie geen kleurverschil ziet en in een afdruk. */}
          <span className={`h-2 w-2 rounded-full ${LICHT_STIJL[totaal].punt}`} />
          {LICHT_STIJL[totaal].label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDagen(d)}
              className={`rounded-md px-2 py-0.5 text-micro font-medium transition-colors ${
                dagen === d ? "bg-rm-blue/10 text-rm-blue-ink" : "text-muted-foreground hover:bg-gray-100"}`}>
              {d} dagen
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Aandeel gekoppelde gebruikers dat in dit venster actief was, en hoe lang het stil is.
        Activiteit komt uit de sessies &mdash; niet uit de laatste login, want die beweegt niet mee
        als iemand ingelogd blijft.
      </p>

      {fout && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-meta text-red-700">{fout}</p>
      )}

      {anoniem && (
        <p className="mb-3 rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-meta text-muted-foreground">
          Deze cijfers zijn alleen zichtbaar als beheerder. Log in om ze te zien.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {oordelen.map(({ rij, oordeel }) => {
          const st = LICHT_STIJL[oordeel.licht];
          return (
            <div key={rij.agency_id} className={`rounded-lg border p-3 ${st.rand} ${st.vlak}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${st.punt}`} />
                <span className="truncate text-body font-semibold text-rm-gray">{rij.bureau}</span>
                <span className={`ml-auto shrink-0 text-micro font-medium ${st.tekst}`}>{st.label}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-rm-gray">
                  {rij.adoptie === null ? "—" : `${Math.round(Number(rij.adoptie))}%`}
                </span>
                <span className="text-meta text-muted-foreground">{oordeel.reden}</span>
              </div>
              <p className="mt-1 text-micro text-muted-foreground">
                {oordeel.dagenStil === null
                  ? "nog geen activiteit gezien"
                  : oordeel.dagenStil === 0
                    ? "vandaag nog actief"
                    : `laatst actief ${oordeel.dagenStil} dag${oordeel.dagenStil === 1 ? "" : "en"} geleden`}
                {rij.nooit_actief > 0 && ` · ${rij.nooit_actief} nog nooit ingelogd`}
              </p>
            </div>
          );
        })}
        {oordelen.length === 0 && !anoniem && (
          <p className="text-body text-muted-foreground">Nog geen bureaus.</p>
        )}
      </div>
    </section>
  );
}


// ── Benchmarkdekking ────────────────────────────────────────────────────────
//
// Laat zien of het invullen van bedrijfsmodel en niche ergens toe leidt. Zonder dit scherm is de
// drempel in lib/benchmark/cel.ts een abstractie: je vult velden en hoopt maar wat. Hier staat
// per segment hoeveel accounts en bureaus er nog bij moeten.

interface Cel {
  model: string | null;
  niche: string | null;
  nicheLabel: string | null;
  accounts: number;
  bureaus: number;
  deelbaar: boolean;
  reden: string | null;
}
interface Dekking {
  stand: {
    bureaus: number; bureausMetToestemming: number; accounts: number;
    accountsInDePool: number; metModel: number; metNiche: number;
  };
  cellen: Cel[];
  deelbaar: number;
}

function BenchmarkSectie() {
  const [data, setData] = useState<Dekking | null>(null);
  const [anoniem, setAnoniem] = useState(false);

  useEffect(() => {
    let af = false;
    fetch("/api/admin/benchmarkdekking")
      .then(async (res) => {
        if (af) return;
        if (res.status === 401 || res.status === 403) { setAnoniem(true); return; }
        if (!res.ok) return;
        setData(await res.json());
      })
      .catch(() => { /* stil: een dekkingsoverzicht mag de pagina niet breken */ });
    return () => { af = true; };
  }, []);

  if (anoniem || !data) return null;
  const { stand } = data;
  const label = (c: Cel) =>
    c.model && c.niche ? `${c.model.toUpperCase()} + ${c.nicheLabel}`
      : c.niche ? String(c.nicheLabel)
      : String(c.model ?? "").toUpperCase();

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-rm-gray">Benchmarkdekking</h2>
        <span className="text-meta text-muted-foreground">
          {data.deelbaar} van {data.cellen.length} segmenten haalt de drempel
        </span>
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Een segment mag pas gedeeld worden bij genoeg accounts én genoeg verschillende bureaus.
        Dat tweede is de belangrijkste: één bureau met tien vergelijkbare klanten is tien accounts,
        maar verraadt het boek van dat ene bureau.
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        {[
          ["Bureaus met toestemming", `${stand.bureausMetToestemming} van ${stand.bureaus}`],
          ["Accounts in de pool", `${stand.accountsInDePool} van ${stand.accounts}`],
          ["Met bedrijfsmodel", `${stand.metModel} van ${stand.accounts}`],
          ["Met niche", `${stand.metNiche} van ${stand.accounts}`],
        ].map(([kop, waarde]) => (
          <div key={kop} className="rounded-lg border border-border bg-card p-3">
            <span className="block text-micro uppercase tracking-wider text-muted-foreground">{kop}</span>
            <span className="mt-0.5 block text-title font-semibold tabular-nums text-rm-gray">{waarde}</span>
          </div>
        ))}
      </div>

      {data.cellen.length === 0 ? (
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-meta text-muted-foreground">
          Nog geen enkel segment. Er is toestemming van minstens één bureau nodig, plus een
          bedrijfsmodel of niche op de klanten.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.cellen.map((c) => (
            <li key={label(c)} className={`rounded-lg border p-3 ${
              c.deelbaar ? "border-green-200 bg-green-50/60" : "border-border bg-card"}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-body font-medium text-rm-gray">{label(c)}</span>
                <span className="ml-auto text-meta tabular-nums text-muted-foreground">
                  {c.accounts} accounts · {c.bureaus} bureaus
                </span>
              </div>
              <p className={`mt-0.5 text-micro ${c.deelbaar ? "text-green-700" : "text-muted-foreground"}`}>
                {c.deelbaar ? "haalt de drempel" : c.reden}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [beurzen, setBeurzen] = useState<Client[]>([]);
  const [laden, setLaden] = useState(true);
  const [melding, setMelding] = useState<string | null>(null);
  // Zie de opmerking bij AdoptieSectie: 401 is een stand, geen storing, en hoort dus niet rood.
  const [meldingIsFout, setMeldingIsFout] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("performance_marketeer");
  const [inviteClients, setInviteClients] = useState<string[]>([]);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setLaden(true);
    const res = await fetch("/api/admin/users");
    if (res.status === 401 || res.status === 403) {
      setMelding("Log in als beheerder om gebruikers te beheren.");
      setMeldingIsFout(false);
      setUsers([]);
      setLaden(false);
      return;
    }
    setMeldingIsFout(true);
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
      <h1 className="mb-1 text-page font-bold text-rm-blue-ink">Gebruikersbeheer</h1>
      <p className="mb-6 text-body text-muted-foreground">
        De rol bepaalt wat iemand mag, de beurzen bepalen waarover. Alleen voor admins.
      </p>

      <AdoptieSectie />

      <SegmentatieBulk />

      <MacroTrendsPreview />

      <BenchmarkSectie />

      <form onSubmit={invite} className="mb-8 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label htmlFor="invite-email" className="mb-1 block text-body font-medium text-rm-gray">
              E-mail uitnodigen
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-body focus:border-rm-blue focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1 block text-body font-medium text-rm-gray">
              Rol
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="rounded-md border border-border px-3 py-2 text-body focus:border-rm-blue focus:outline-none"
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
            className="rounded-md bg-rm-blue px-4 py-2 text-body font-medium text-white hover:bg-rm-blue/90 disabled:opacity-60"
          >
            {bezig ? "Bezig..." : "Uitnodigen"}
          </button>
        </div>

        <p className="mt-2 text-meta text-muted-foreground">{ROL_UITLEG[inviteRole]}</p>

        <fieldset className="mt-4 border-t border-border pt-3">
          <legend className="sr-only">Beurzen</legend>
          <p className="mb-2 text-body font-medium text-rm-gray">
            Beurzen{" "}
            {inviteDektAlles && (
              <span className="font-normal text-muted-foreground">
                — deze rol dekt alle beurzen, ook nieuwe
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {beursOpties.map((beurs) => (
              <label
                key={beurs.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-body ${
                  inviteDektAlles
                    ? "cursor-not-allowed border-border text-muted-foreground"
                    : "cursor-pointer border-border text-rm-gray"
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
              <p className="text-body text-muted-foreground">Nog geen beurzen bekend.</p>
            )}
          </div>
        </fieldset>
      </form>

      {melding && (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-body ${
          meldingIsFout
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-border bg-gray-50/70 text-muted-foreground"
        }`}>
          {melding}
        </p>
      )}

      {laden ? (
        <p className="text-body text-muted-foreground">Laden...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* De gedeelde tabelcomponenten, net als de dertien andere schermen. Geen totaalregel en
              geen aandeelstrepen: dit is een beheerlijst, geen datatabel — er valt niets op te
              tellen en niets af te wegen. Wat het wél overneemt is het ritme, de kopstijl en de
              horizontale scroll. */}
          <Tabel>
            <Kop>
              <KolomKop breed>E-mail</KolomKop>
              <KolomKop>Rol</KolomKop>
              <KolomKop>Beurzen</KolomKop>
              <KolomKop>Status</KolomKop>
              <KolomKop><span className="sr-only">Acties</span></KolomKop>
            </Kop>
            <Body>
              {users.map((user) => (
                <Rij key={user.id} className="align-top">
                  <NaamCel>{user.email ?? user.id}</NaamCel>
                  <Cel>
                    <select
                      value={user.role ?? ""}
                      onChange={(e) => void wijzig(user.id, e.target.value as Role, user.clients)}
                      className="rounded-md border border-border px-2 py-1 text-body focus:border-rm-blue focus:outline-none"
                    >
                      {user.role === null && <option value="">geen rol</option>}
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROL_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </Cel>
                  <Cel>
                    {user.seesAllClients ? (
                      <span className="text-muted-foreground">alle beurzen</span>
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
                              className={`rounded-full border px-2.5 py-0.5 text-meta ${
                                aan
                                  ? "border-rm-blue bg-rm-blue text-white"
                                  : "border-border text-muted-foreground hover:border-gray-400"
                              }`}
                            >
                              {beurs.name}
                            </button>
                          );
                        })}
                        {user.clients.length === 0 && (
                          <span className="text-meta text-amber-700">
                            geen beurs toegewezen — ziet niets
                          </span>
                        )}
                      </div>
                    )}
                  </Cel>
                  <Cel zacht nowrap>{user.deactivated ? "gedeactiveerd" : "actief"}</Cel>
                  <Cel className="text-right">
                    {!user.deactivated && (
                      <button
                        type="button"
                        onClick={() => void deactiveer(user.id, user.email)}
                        className="text-body text-red-600 underline hover:text-red-700"
                      >
                        Deactiveren
                      </button>
                    )}
                  </Cel>
                </Rij>
              ))}
              {users.length === 0 && (
                <Rij>
                  <Cel colSpan={5} className="text-center" zacht>
                    <span className="block py-2">Geen gebruikers zichtbaar.</span>
                  </Cel>
                </Rij>
              )}
            </Body>
          </Tabel>
        </div>
      )}
    </div>
  );
}
