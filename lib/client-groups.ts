/**
 * Client groups: organize clients into collapsible folders in the sidebar.
 * Persisted in Supabase.
 */

import { supabase } from "./supabase";

/**
 * Wat een groep IS.
 *
 * Dit onderscheid bestaat omdat dezelfde verzameling accounts twee dingen kan betekenen. In de
 * database staan drie GoedeInnovaties-webshops gegroepeerd onder "Labels Edwin" -- de naam van de
 * persoon die ze beheert. Wie dat als merk leest en er een merkvergelijking op bouwt, legt drie
 * losse webshops naast elkaar alsof het regio's van hetzelfde ding zijn.
 *
 * null betekent: nog niet ingedeeld. Dat is geen ontbrekende waarde maar een eerlijke: de drie
 * bestaande groepen zijn gemaakt voordat deze vraag bestond, en er zelf een antwoord bij verzinnen
 * zou het gokken zijn dat dit veld juist moet voorkomen.
 */
export type GroepSoort = "merk" | "specialist" | "vrij";

export interface ClientGroup {
  id: string;
  name: string;
  sort_order: number;
  soort: GroepSoort | null;
  /** false = door het naamalgoritme voorgesteld, nog niet door een mens beoordeeld. */
  bevestigd: boolean;
  /** Waar een voorstel vandaan komt. Leeg bij een groep die iemand zelf heeft bedacht. */
  reden: string | null;
}

export interface GroupWithMembers extends ClientGroup {
  clientIds: string[];
}

// In-memory cache
let groupsCache: GroupWithMembers[] | null = null;

/**
 * Load all groups with their member client IDs from Supabase.
 */
export async function loadClientGroups(): Promise<GroupWithMembers[]> {
  if (!supabase) return [];

  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from("client_groups").select("*").order("sort_order"),
    supabase.from("client_group_members").select("*"),
  ]);

  const membersByGroup = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m.client_id);
    membersByGroup.set(m.group_id, list);
  }

  groupsCache = (groups ?? []).map((g) => ({
    ...g,
    // Kolommen uit migratie 052. Een oude database zonder die kolommen geeft undefined; dan is de
    // veilige aanname "bevestigd", want anders zou elke bestaande groep ineens als geraden gelden.
    soort: (g.soort ?? null) as GroepSoort | null,
    bevestigd: g.bevestigd ?? true,
    reden: g.reden ?? null,
    clientIds: membersByGroup.get(g.id) ?? [],
  }));

  return groupsCache;
}

/** Get cached groups (call loadClientGroups first) */
export function getClientGroups(): GroupWithMembers[] {
  return groupsCache ?? [];
}

/** Create a new group */
export async function createGroup(name: string): Promise<ClientGroup | null> {
  if (!supabase) return null;
  const maxOrder = (groupsCache ?? []).reduce((max, g) => Math.max(max, g.sort_order), 0);
  const { data } = await supabase
    .from("client_groups")
    .insert({ name, sort_order: maxOrder + 1 })
    .select()
    .single();
  if (data) {
    groupsCache = null; // invalidate
  }
  return data;
}

/** Rename a group */
export async function renameGroup(groupId: string, name: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_groups").update({ name }).eq("id", groupId);
  groupsCache = null;
}

/** Delete a group (members are cascade-deleted) */
export async function deleteGroup(groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_groups").delete().eq("id", groupId);
  groupsCache = null;
}

/** Add a client to a group */
export async function addClientToGroup(clientId: string, groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_group_members").upsert({ client_id: clientId, group_id: groupId });
  groupsCache = null;
}

/** Remove a client from a group */
export async function removeClientFromGroup(clientId: string, groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("client_group_members")
    .delete()
    .eq("client_id", clientId)
    .eq("group_id", groupId);
  groupsCache = null;
}

/** Move a client from one group to another */
export async function moveClientToGroup(clientId: string, fromGroupId: string, toGroupId: string): Promise<void> {
  await removeClientFromGroup(clientId, fromGroupId);
  await addClientToGroup(clientId, toGroupId);
}

// ── Soort en bevestiging ───────────────────────────────────────────────────
//
// Deze drie geven een FOUTMELDING terug in plaats van void, en dat is nodig. De database bewaakt
// dat een account bij hoogstens één merkgroep hoort (migraties 052 en 053), en die controle slaat
// toe op precies het moment dat iemand hier op een knop drukt. Zou dit stil falen, dan ziet de
// gebruiker een soort die niet is opgeslagen -- en dat is erger dan een foutmelding, want het lijkt
// gelukt.

/** Zet de soort. Geeft null bij succes, anders de melding uit de database. */
export async function setGroupSoort(groupId: string, soort: GroepSoort | null): Promise<string | null> {
  if (!supabase) return "Supabase is niet geconfigureerd";
  const { error } = await supabase.from("client_groups").update({ soort }).eq("id", groupId);
  groupsCache = null;
  return error?.message ?? null;
}

/**
 * Legt vast dat een mens naar deze groep heeft gekeken, en met welke uitkomst.
 *
 * Ook "dit is geen merk" is een bevestiging. Dat is met opzet: zou afwijzen betekenen dat de groep
 * verdwijnt, dan stelt het naamalgoritme hem bij de volgende run gewoon opnieuw voor en doet de
 * knop niets. Een groep die als 'vrij' of 'specialist' is bevestigd, herkent dat script als
 * bestaand en laat hij met rust.
 */
export async function bevestigGroep(groupId: string, soort: GroepSoort): Promise<string | null> {
  if (!supabase) return "Supabase is niet geconfigureerd";
  const { error } = await supabase
    .from("client_groups")
    .update({ soort, bevestigd: true })
    .eq("id", groupId);
  groupsCache = null;
  return error?.message ?? null;
}

/** Menselijke tekst bij de reden die het algoritme meegaf. */
export function redenTekst(reden: string | null): string | null {
  if (!reden) return null;
  const delen: string[] = [];
  if (reden.includes("regiosuffix")) delen.push("de namen verschillen alleen in het land aan het eind");
  if (reden.includes("scheidingsteken")) delen.push("de namen delen het deel vóór het streepje");
  if (delen.length === 0) return reden;
  const zin = delen.length === 2 ? `${delen[0]}, en ${delen[1]}` : delen[0];
  return reden.startsWith("het naamalgoritme")
    ? `Het naamalgoritme komt op dezelfde indeling uit: ${zin}.`
    : `Voorgesteld omdat ${zin}.`;
}
