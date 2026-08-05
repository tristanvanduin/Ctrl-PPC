"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Copy, Check, Eye, EyeOff, Building2, FolderPlus, Trash2, Pencil, Plus, X, FolderOpen, Sparkles, Globe, UserRound, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAllClients, saveApiClients, type Client } from "@/lib/clients";
import { getVisibleClientIds, setVisibleClientIds } from "@/lib/visible-clients";
import {
  loadClientGroups, createGroup, renameGroup, deleteGroup,
  addClientToGroup, removeClientFromGroup, setGroupSoort, bevestigGroep, redenTekst,
  type GroupWithMembers, type GroepSoort,
} from "@/lib/client-groups";

interface ConnectionStatus {
  googleAds: { configured: boolean; hasManagerId: boolean };
  metaAds: { configured: boolean; hasAppCredentials: boolean };
  anyConnected: boolean;
}

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
      <CheckCircle2 className="w-4 h-4" /> Verbonden
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <XCircle className="w-4 h-4" /> Niet geconfigureerd
    </span>
  );
}

function EnvVar({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <code
      onClick={() => {
        navigator.clipboard.writeText(name);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-meta font-mono text-rm-gray cursor-pointer hover:bg-gray-200 transition-colors"
    >
      {name}
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </code>
  );
}

function ClientVisibilitySection() {
  const [allClients, setAllClients] = useState<Client[]>(() => getAllClients());
  const [visibleIds, setVisible] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setVisible(getVisibleClientIds());
    // Re-read when API clients are saved (e.g. after "Verbinding testen")
    function onClientsChanged() {
      const updated = getAllClients();
      setAllClients(updated);
      setVisible(getVisibleClientIds());
    }
    window.addEventListener("clients-changed", onClientsChanged);
    return () => window.removeEventListener("clients-changed", onClientsChanged);
  }, []);

  function toggle(clientId: string) {
    const updated = visibleIds.includes(clientId)
      ? visibleIds.filter((id) => id !== clientId)
      : [...visibleIds, clientId];
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  function selectAll() {
    const all = filtered.map((c) => c.id);
    const updated = [...new Set([...visibleIds, ...all])];
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  function selectNone() {
    const filteredIds = new Set(filtered.map((c) => c.id));
    const updated = visibleIds.filter((id) => !filteredIds.has(id));
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  const filtered = allClients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const visibleCount = allClients.filter((c) => visibleIds.includes(c.id)).length;

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-rm-blue-ink text-title">Klanten in sidebar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Selecteer welke klanten zichtbaar zijn in het menu. {visibleCount} van {allClients.length} zichtbaar.
            {allClients.length > 0 && allClients[0].source === "google-ads" && (
              <span className="text-green-600 font-medium ml-1">· Live vanuit Google Ads</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-meta text-rm-blue-ink hover:underline"
          >
            Alles aan
          </button>
          <span className="text-muted-foreground text-meta">·</span>
          <button
            onClick={selectNone}
            className="text-meta text-muted-foreground hover:underline"
          >
            Alles uit
          </button>
        </div>
      </div>

      {/* Search */}
      {allClients.length > 10 && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Zoek klant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
        {filtered.map((client) => {
          const isVisible = visibleIds.includes(client.id);
          return (
            <button
              key={client.id}
              onClick={() => toggle(client.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                isVisible
                  ? "bg-rm-blue/5 border border-rm-blue/20 text-rm-gray"
                  : "bg-gray-50 border border-transparent text-muted-foreground"
              }`}
            >
              {isVisible
                ? <Eye className="w-4 h-4 text-rm-blue-ink shrink-0" />
                : <EyeOff className="w-4 h-4 text-gray-300 shrink-0" />
              }
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className={`truncate ${isVisible ? "font-medium" : ""}`}>
                {client.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ── De soort van een groep ─────────────────────────────────────────────────
//
// Waarom dit gevraagd wordt in plaats van afgeleid: dezelfde drie accounts staan in deze database
// gegroepeerd als "Labels Edwin" -- de persoon die ze beheert -- terwijl het naamalgoritme er
// "GoedeInnovaties" van maakt. Eén verzameling, twee betekenissen. Alleen de gebruiker weet welke.
//
// De omschrijving staat bij elke optie en niet in een tooltip. Wie hier voor het eerst komt, weet
// niet wat het verschil uitmaakt, en een keuze zonder uitleg wordt een willekeurige keuze.
const SOORTEN: { waarde: GroepSoort; label: string; uitleg: string; icoon: typeof Globe }[] = [
  { waarde: "merk", label: "Merk", icoon: Globe,
    uitleg: "Land- of regiovarianten van dezelfde zaak. Deze mogen met elkaar vergeleken worden." },
  { waarde: "specialist", label: "Specialist", icoon: UserRound,
    uitleg: "Wie de accounts beheert. Bedoeld voor werkverdeling, niet voor vergelijking." },
  { waarde: "vrij", label: "Vrije map", icoon: Folder,
    uitleg: "Alleen om de zijbalk te ordenen, zonder verdere betekenis." },
];

function SoortKeuze({ waarde, onKies, compact = false, voorgesteld = null }: {
  waarde: GroepSoort | null;
  onKies: (s: GroepSoort) => void;
  compact?: boolean;
  /**
   * Wat het algoritme denkt, in de voorstelstand.
   *
   * Apart van `waarde`, en dat is het verschil dat ertoe doet. In de eerste versie stond de
   * voorgestelde soort gewoon als gekozen aangevinkt: blauwe rand, gevulde achtergrond. Op het
   * scherm las dat als "dit is al besloten", direct onder de vraag "Klopt dit, en wat is het?".
   * Precies de vergissing die dit hele blok moet voorkomen -- een gok die eruitziet als een besluit.
   *
   * Nu een gestippelde rand met het woord "voorgesteld" erbij: zichtbaar, maar niet aangevinkt.
   */
  voorgesteld?: GroepSoort | null;
}) {
  return (
    <div className={compact ? "flex flex-wrap gap-1" : "grid gap-2 sm:grid-cols-3"}>
      {SOORTEN.map((s) => {
        const Icoon = s.icoon;
        const actief = waarde === s.waarde;
        const gesuggereerd = !actief && voorgesteld === s.waarde;
        if (compact) {
          return (
            <button key={s.waarde} onClick={() => onKies(s.waarde)} title={s.uitleg}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-micro font-medium transition-colors ${
                actief ? "border-rm-blue bg-rm-blue/10 text-rm-blue-ink"
                       : "border-border text-muted-foreground hover:border-rm-blue/40"}`}>
              <Icoon className="h-3 w-3 shrink-0" /> {s.label}
            </button>
          );
        }
        return (
          <button key={s.waarde} onClick={() => onKies(s.waarde)}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              actief ? "border-rm-blue bg-rm-blue/5"
                     : gesuggereerd ? "border-dashed border-amber-300 bg-card hover:border-rm-blue/40"
                     : "border-border hover:border-rm-blue/40"}`}>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-rm-blue-ink">
              <Icoon className="h-3.5 w-3.5 shrink-0" /> {s.label}
              {gesuggereerd && (
                <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-px text-micro font-medium text-amber-800">
                  voorgesteld
                </span>
              )}
            </span>
            <span className="mt-1 block text-micro leading-snug text-muted-foreground">{s.uitleg}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Client Groups Management ──────────────────────────────────────────────

function ClientGroupsSection() {
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  // Per groep, want de database kan een soort weigeren (een account hoort bij hoogstens één merk)
  // en die melding hoort bij de groep te staan waar hij vandaan komt, niet ergens bovenaan.
  const [fout, setFout] = useState<Record<string, string>>({});
  const [laadfout, setLaadfout] = useState<string | null>(null);
  const [groepZoek, setGroepZoek] = useState("");
  // Welke groepen OPEN staan. Niet andersom: bij veertig specialisten is dicht de bruikbare
  // begintoestand, en dan is een set van de paar open groepen kleiner dan een set van de rest.
  const [open, setOpen] = useState<Set<string>>(new Set());

  // try/finally, en een zichtbare fout in plaats van niets.
  //
  // Hiervoor stond hier een kale await met setLoading(false) erachter. Faalde het laden -- en dat
  // gebeurt, de browser praat rechtstreeks met Supabase -- dan werd die regel nooit bereikt, bleef
  // loading op true staan en gaf de sectie `null` terug. Het hele blok verdween dan van de pagina
  // zonder melding. Zo gevonden: op /settings ontbrak "Klantgroepen" volledig terwijl er vier
  // groepen in de database staan.
  const refresh = useCallback(async () => {
    try {
      setGroups(await loadClientGroups());
      setAllClients(getAllClients());
      setLaadfout(null);
    } catch (e) {
      setLaadfout(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    await createGroup(newGroupName.trim());
    setNewGroupName("");
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleRename(groupId: string) {
    if (!editingName.trim()) return;
    await renameGroup(groupId, editingName.trim());
    setEditingId(null);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleDelete(groupId: string) {
    await deleteGroup(groupId);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleAddClient(clientId: string, groupId: string) {
    await addClientToGroup(clientId, groupId);
    setAddingToGroup(null);
    setClientSearch("");
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleSoort(groupId: string, soort: GroepSoort, bevestigen: boolean) {
    const melding = bevestigen ? await bevestigGroep(groupId, soort) : await setGroupSoort(groupId, soort);
    setFout((v) => ({ ...v, [groupId]: melding ?? "" }));
    if (!melding) { await refresh(); window.dispatchEvent(new Event("groups-changed")); }
  }

  async function handleRemoveClient(clientId: string, groupId: string) {
    await removeClientFromGroup(clientId, groupId);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  // Clients that are already in a group
  const assignedClientIds = new Set(groups.flatMap((g) => g.clientIds));
  const onbevestigd = groups.filter((g) => !g.bevestigd).length;
  const nogInTeDelen = groups.filter((g) => g.bevestigd && !g.soort).length;

  // ── Indelen in secties ────────────────────────────────────────────────────
  //
  // Bij vier groepen is één lijst prima. Bij een bureau met veertig specialisten staan er straks
  // veertig kaarten met elk twintig accounts uitgeklapt onder elkaar: achthonderd regels in één
  // blok. Vandaar secties, een zoekveld, en dicht als begintoestand.
  //
  // Voorstellen staan bovenaan en gaan NIET dicht. Die vragen om een antwoord; wegstoppen achter
  // een klik maakt van "wacht op een mens" stilzwijgend "blijft eeuwig staan".
  const gezocht = groepZoek.trim().toLowerCase();
  const zichtbaar = gezocht
    ? groups.filter((g) => g.name.toLowerCase().includes(gezocht))
    : groups;

  const SECTIES: { sleutel: string; titel: string; test: (g: GroupWithMembers) => boolean }[] = [
    { sleutel: "voorstel", titel: "Voorstellen", test: (g) => !g.bevestigd },
    { sleutel: "merk", titel: "Merken", test: (g) => g.bevestigd && g.soort === "merk" },
    { sleutel: "specialist", titel: "Specialisten", test: (g) => g.bevestigd && g.soort === "specialist" },
    { sleutel: "vrij", titel: "Vrije mappen", test: (g) => g.bevestigd && g.soort === "vrij" },
    { sleutel: "onbepaald", titel: "Nog niet ingedeeld", test: (g) => g.bevestigd && !g.soort },
  ];
  const secties = SECTIES
    .map((sec) => ({ ...sec, groepen: zichtbaar.filter(sec.test) }))
    .filter((sec) => sec.groepen.length > 0);

  function wisselOpen(id: string) {
    setOpen((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  if (loading) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-rm-blue-ink text-title">Klantgroepen</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bundel accounts en leg vast wat de bundel betekent. {groups.length} groep{groups.length !== 1 ? "en" : ""}
            {onbevestigd > 0 ? `, waarvan ${onbevestigd} voorgesteld` : ""}
            {nogInTeDelen > 0 ? ` \u00b7 ${nogInTeDelen} nog niet ingedeeld` : ""}.
          </p>
        </div>
      </div>

      {laadfout && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-meta leading-snug text-red-700">
          De groepen konden niet geladen worden: {laadfout}
        </p>
      )}

      {/* Create new group */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
          placeholder="Nieuwe groep naam..."
          className="flex-1 text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
        />
        <button
          onClick={handleCreateGroup}
          disabled={!newGroupName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-50"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Aanmaken
        </button>
      </div>

      {/* Zoeken pas tonen als er iets te zoeken valt. Bij vier groepen is een zoekveld ruis. */}
      {groups.length > 8 && (
        <input
          type="text"
          value={groepZoek}
          onChange={(e) => setGroepZoek(e.target.value)}
          placeholder="Zoek een groep..."
          className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-rm-blue focus:outline-none"
        />
      )}

      {/* Groups list */}
      <div className="space-y-4">
        {secties.map((sectie) => (
        <div key={sectie.sleutel}>
          <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            {sectie.titel} <span className="font-normal">({sectie.groepen.length})</span>
          </p>
          <div className="space-y-3">
        {sectie.groepen.map((group) => {
          const groupClients = group.clientIds
            .map((id) => allClients.find((c) => c.id === id))
            .filter((c): c is Client => c !== undefined);

          return (
            <div key={group.id} className={`rounded-lg border p-4 ${
              group.bevestigd ? "border-border" : "border-amber-200 bg-amber-50/50"}`}>
              {/* Group header */}
              <div className="flex items-center justify-between mb-2">
                {editingId === group.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(group.id)}
                      className="flex-1 text-sm border border-border rounded px-2 py-1 focus:outline-none focus:border-rm-blue"
                      autoFocus
                    />
                    <button onClick={() => handleRename(group.id)} className="text-meta text-rm-blue-ink font-medium">Opslaan</button>
                    <button onClick={() => setEditingId(null)} className="text-meta text-muted-foreground">Annuleer</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-rm-blue-ink" />
                    <span className="text-sm font-semibold text-rm-gray">{group.name}</span>
                    <span className="text-micro text-muted-foreground">({groupClients.length})</span>
                    {!group.bevestigd && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-medium text-amber-800">
                        <Sparkles className="h-2.5 w-2.5 shrink-0" /> Voorstel
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {group.bevestigd && editingId !== group.id && (
                    <button
                      onClick={() => wisselOpen(group.id)}
                      className="rounded px-1.5 py-1 text-micro text-muted-foreground hover:bg-gray-100"
                    >
                      {open.has(group.id) ? "Inklappen" : "Bekijken"}
                    </button>
                  )}
                  {editingId !== group.id && (
                    <button
                      onClick={() => { setEditingId(group.id); setEditingName(group.name); }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <Pencil className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(group.id)}
                    className="p-1 rounded hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>

              {/* Voorstel, of de soort van een bevestigde groep.
                  Een voorstel ziet er anders uit dan een besluit -- dat is het hele punt van dit
                  blok. Zonder dat verschil is een indeling die uit een naam is geraden op het
                  scherm niet te onderscheiden van een indeling die iemand heeft bedacht. */}
              {!group.bevestigd ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-card/70 p-3">
                  {redenTekst(group.reden) && (
                    <p className="mb-2 text-meta leading-snug text-amber-900">{redenTekst(group.reden)}</p>
                  )}
                  <p className="mb-2 text-meta font-medium text-rm-gray">Klopt dit, en wat is het?</p>
                  <SoortKeuze waarde={null} voorgesteld={group.soort}
                    onKies={(soort) => handleSoort(group.id, soort, true)} />
                  <p className="mt-2 text-micro leading-snug text-muted-foreground">
                    Ook &ldquo;dit is geen merk&rdquo; is een antwoord: kies dan Specialist of Vrije map.
                    Verwijderen helpt niet &mdash; dan stelt het naamalgoritme deze groep bij de volgende
                    ronde opnieuw voor.
                  </p>
                </div>
              ) : (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-micro text-muted-foreground">Soort:</span>
                  <SoortKeuze compact waarde={group.soort} onKies={(soort) => handleSoort(group.id, soort, false)} />
                  {!group.soort && (
                    <span className="text-micro text-muted-foreground">nog niet ingedeeld</span>
                  )}
                </div>
              )}

              {fout[group.id] && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-meta leading-snug text-red-700">
                  {fout[group.id]}
                </p>
              )}

              {/* Clients in this group.
                  Dicht als begintoestand, want veertig groepen met elk twintig accounts
                  uitgeklapt is achthonderd regels in één blok. Een voorstel staat altijd open:
                  dat vraagt om een antwoord en hoort niet achter een klik te verdwijnen. */}
              {(!group.bevestigd || open.has(group.id)) && (
              <div className="space-y-1 mb-2">
                {groupClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate text-rm-gray">{client.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveClient(client.id, group.id)}
                      className="p-0.5 rounded hover:bg-red-50 shrink-0"
                      title="Verwijder uit groep"
                    >
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))}
                {groupClients.length === 0 && (
                  <p className="text-meta text-muted-foreground px-2 py-1">Nog geen klanten in deze groep</p>
                )}
              </div>
              )}

              {/* Add client button */}
              {addingToGroup === group.id ? (
                <div className="mt-2">
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Zoek klant om toe te voegen..."
                    className="w-full text-xs border border-border rounded px-2 py-1.5 mb-1 focus:outline-none focus:border-rm-blue"
                    autoFocus
                  />
                  <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                    {allClients
                      .filter((c) =>
                        !group.clientIds.includes(c.id) &&
                        c.name.toLowerCase().includes(clientSearch.toLowerCase())
                      )
                      .slice(0, 20)
                      .map((client) => (
                        <button
                          key={client.id}
                          onClick={() => handleAddClient(client.id, group.id)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-rm-gray hover:bg-rm-blue/5 text-left"
                        >
                          <Plus className="w-3 h-3 text-rm-blue-ink shrink-0" />
                          <span className="truncate">{client.name}</span>
                          {assignedClientIds.has(client.id) && (
                            <span className="ml-auto text-micro text-muted-foreground shrink-0">al in groep</span>
                          )}
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => { setAddingToGroup(null); setClientSearch(""); }}
                    className="text-meta text-muted-foreground mt-1"
                  >
                    Sluiten
                  </button>
                </div>
              ) : !group.bevestigd || open.has(group.id) ? (
                <button
                  onClick={() => setAddingToGroup(group.id)}
                  className="flex items-center gap-1 text-meta text-rm-blue-ink hover:underline mt-1"
                >
                  <Plus className="w-3 h-3" /> Klant toevoegen
                </button>
              ) : null}
            </div>
          );
        })}

          </div>
        </div>
        ))}

        {groups.length === 0 && (
          <p className="text-body text-muted-foreground text-center py-4">
            Nog geen groepen. Maak een groep aan om klanten te bundelen.
          </p>
        )}
        {groups.length > 0 && secties.length === 0 && (
          <p className="py-4 text-center text-body text-muted-foreground">
            Geen groep gevonden voor &ldquo;{groepZoek}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [googleResult, setGoogleResult] = useState<string | null>(null);
  const [metaResult, setMetaResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  async function testGoogle() {
    setTestingGoogle(true);
    setGoogleResult(null);
    try {
      const res = await fetch("/api/google-ads?action=customers");
      const data = await res.json();
      if (data.error) {
        setGoogleResult(`Fout: ${data.error}`);
      } else if (data.customers) {
        // Save accounts as selectable clients
        const apiClients: Client[] = data.customers.map((c: { customerId: string; descriptiveName: string }) => ({
          id: `gads-${c.customerId}`,
          name: c.descriptiveName || c.customerId,
          googleAdsCustomerId: c.customerId,
          source: "google-ads" as const,
        }));
        saveApiClients(apiClients);
        setGoogleResult(`Verbonden! ${data.customers.length} account(s) gevonden en beschikbaar als klanten.`);
      }
    } catch (e) {
      setGoogleResult(`Verbinding mislukt: ${e instanceof Error ? e.message : "Onbekende fout"}`);
    }
    setTestingGoogle(false);
  }

  async function testMeta() {
    setTestingMeta(true);
    setMetaResult(null);
    try {
      const res = await fetch("/api/meta-ads?action=accounts");
      const data = await res.json();
      if (data.error) {
        setMetaResult(`Fout: ${data.error}`);
      } else if (data.accounts) {
        setMetaResult(`Verbonden! ${data.accounts.length} ad account(s) gevonden: ${data.accounts.map((a: { name: string }) => a.name).join(", ")}`);
      }
    } catch (e) {
      setMetaResult(`Verbinding mislukt: ${e instanceof Error ? e.message : "Onbekende fout"}`);
    }
    setTestingMeta(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-rm-blue-ink" />
      </div>
    );
  }

  const googleConnected = status?.googleAds.configured ?? false;
  const metaConnected = status?.metaAds.configured ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page font-bold text-rm-blue-ink">Instellingen</h1>
        <p className="mt-1 text-body text-muted-foreground">
          API koppelingen en dashboard configuratie. Credentials worden ingesteld via{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">.env.local</code>
        </p>
      </div>

      {/* Overall status */}
      {!status?.anyConnected && (
        <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-rm-blue-ink font-medium mb-1">Dashboard draait op demo data</p>
          <p className="text-xs text-muted-foreground">
            Configureer de API keys in <code className="font-mono">.env.local</code> om live data te gebruiken.
            Kopieer <code className="font-mono">.env.example</code> als startpunt.
          </p>
        </div>
      )}

      {/* ── Client Visibility ──────────────────────────────── */}
      <ClientVisibilitySection />

      {/* ── Client Groups ──────────────────────────────────── */}
      <ClientGroupsSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Google Ads ──────────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue-ink text-title">Google Ads API</h3>
            <StatusBadge connected={googleConnected} />
          </div>

          {googleConnected ? (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">Credentials geconfigureerd</p>
                <p className="text-xs text-green-700 mt-1">
                  {status?.googleAds.hasManagerId
                    ? "MCC Manager ID is ingesteld — je kunt meerdere klantaccounts benaderen."
                    : "Geen MCC Manager ID — alleen direct gekoppelde accounts beschikbaar."}
                </p>
              </div>

              <Button
                onClick={testGoogle}
                variant="outline"
                className="w-full gap-2"
                disabled={testingGoogle}
              >
                {testingGoogle ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Verbinding testen
              </Button>

              {googleResult && (
                <div className={`px-4 py-3 rounded-lg text-sm ${
                  googleResult.startsWith("Verbonden")
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  {googleResult}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-body text-muted-foreground">
                Voeg de volgende variabelen toe aan je <code className="font-mono text-xs">.env.local</code>:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_DEVELOPER_TOKEN" />
                  <span className="text-micro text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_CLIENT_ID" />
                  <span className="text-micro text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_CLIENT_SECRET" />
                  <span className="text-micro text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_REFRESH_TOKEN" />
                  <span className="text-micro text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_MANAGER_CUSTOMER_ID" />
                  <span className="text-micro text-muted-foreground">Optioneel (MCC)</span>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>
                    Ga naar{" "}
                    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                      Google Cloud Console <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    en maak een OAuth2 Client ID aan (type: Web application)
                  </li>
                  <li>
                    Ga naar{" "}
                    <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                      Google Ads API Center <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    voor je Developer Token
                  </li>
                  <li>
                    Genereer een Refresh Token via de{" "}
                    <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                      OAuth Playground <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    met scope <code className="font-mono text-micro">https://www.googleapis.com/auth/adwords</code>
                  </li>
                  <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* ── Meta Ads ────────────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue-ink text-title">Meta Ads API</h3>
            <StatusBadge connected={metaConnected} />
          </div>

          {metaConnected ? (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">Access Token geconfigureerd</p>
                <p className="text-xs text-green-700 mt-1">
                  {status?.metaAds.hasAppCredentials
                    ? "App ID en Secret zijn ingesteld — token kan automatisch verlengd worden."
                    : "Geen App ID/Secret — token verloopt na ~60 dagen en moet handmatig vernieuwd worden."}
                </p>
              </div>

              <Button
                onClick={testMeta}
                variant="outline"
                className="w-full gap-2"
                disabled={testingMeta}
              >
                {testingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Verbinding testen
              </Button>

              {metaResult && (
                <div className={`px-4 py-3 rounded-lg text-sm ${
                  metaResult.startsWith("Verbonden")
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  {metaResult}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-body text-muted-foreground">
                Voeg de volgende variabelen toe aan je <code className="font-mono text-xs">.env.local</code>:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_ACCESS_TOKEN" />
                  <span className="text-micro text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_APP_ID" />
                  <span className="text-micro text-muted-foreground">Optioneel (token refresh)</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_APP_SECRET" />
                  <span className="text-micro text-muted-foreground">Optioneel (token refresh)</span>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>
                    Ga naar{" "}
                    <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                      Meta for Developers <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    en maak een app aan (type: Business)
                  </li>
                  <li>Voeg de Marketing API product toe aan je app</li>
                  <li>
                    Genereer een User Access Token via de{" "}
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                      Graph API Explorer <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    met permissions: <code className="font-mono text-micro">ads_read, ads_management</code>
                  </li>
                  <li>Wissel het token om voor een long-lived token (geldig ~60 dagen)</li>
                  <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* ── LinkedIn Ads ────────────────────────────────────── */}
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue-ink text-title">LinkedIn Ads API</h3>
            <span className="text-meta text-muted-foreground px-2 py-0.5 rounded-full bg-gray-100">Via .env.local</span>
          </div>
          <div className="space-y-4">
            <p className="text-body text-muted-foreground">
              Het LinkedIn-datamodel en de sync-laag staan klaar. Voeg de volgende variabelen toe aan je{" "}
              <code className="font-mono text-xs">.env.local</code> om de koppeling te activeren:
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_CLIENT_ID" />
                <span className="text-micro text-muted-foreground">Verplicht</span>
              </div>
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_CLIENT_SECRET" />
                <span className="text-micro text-muted-foreground">Verplicht</span>
              </div>
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_REFRESH_TOKEN" />
                <span className="text-micro text-muted-foreground">Verplicht</span>
              </div>
            </div>
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>
                  Maak een app aan in het{" "}
                  <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener" className="text-rm-blue-ink hover:underline inline-flex items-center gap-0.5">
                    LinkedIn Developer Portal <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>Vraag toegang aan tot de Advertising API (Marketing Developer Platform)</li>
                <li>Genereer via OAuth2 een refresh token met scope <code className="font-mono text-micro">r_ads, r_ads_reporting</code></li>
                <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Architecture info */}
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <h3 className="font-semibold text-rm-blue-ink text-title mb-3">Architectuur</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">API Calls</p>
            <p>Alle API calls gaan via Next.js server-side routes. Credentials verlaten nooit de server.</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">Data Flow</p>
            <p>Google Ads + Meta → Unified Adapter → ClientHistoricalData → Forecast Engine → Dashboard</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">Fallback</p>
            <p>Zonder API keys draait het dashboard op deterministische demo data. Geen data gaat verloren.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
