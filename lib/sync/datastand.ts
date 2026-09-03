// De datastand van een klant: tot welke maand (of week) er echt Google-data staat, hoe ver dat
// achterloopt op wat een analyse verwacht, en wanneer de laatste sync slaagde.
//
// WAAROM DIT BESTAAT
//
// Op 3 september 2026 bleek dat de Google-data van ELKE echte klant bij april stopt: de laatste
// syncrun in sync_runs is van 17 april, agency_connections is leeg (geen bureau heeft een
// Google-koppeling) en de omgeving droeg kennelijk geen terugval-token meer. Niets in de app
// zei dat. client_sync_status stond op "fresh" (die kolom wordt één keer geschreven aan het eind
// van een geslaagde run en daarna nooit meer aangeraakt), de nachtcron liet bij "geen
// credentials" geen spoor na, en de maandanalyse over augustus draaide gewoon door op een lege
// augustusmaand.
//
// De regel hier is dezelfde als in de rest van de herbouw: de stand wordt LIVE afgeleid uit de
// data zelf (de nieuwste maand in ads_account_monthly), niet uit een opgeslagen label. "Actueel"
// betekent: de laatste afgesloten maand staat erin. Eén maand achter is een waarschuwing (de
// sync kan net een nacht gemist hebben); twee of meer maanden achter betekent dat de sync niet
// draait, en dat is een storing, geen ouderdom.

import type { SupabaseClient } from "@supabase/supabase-js";
import { lastCompleteMonth, monthIndex, formatMonth, isValidMonth } from "@/lib/period/period-range";
import { today, addDays } from "@/lib/reporting-date";
import { eis } from "@/lib/analysis/db-veilig";

export type DatastandToestand = "actueel" | "achter" | "dood" | "geen";

export interface Datastand {
  /** Waar de data van is: "Google" (ads_account_monthly) of een kanaal ("Meta", "LinkedIn",
   *  "Microsoft", uit de dagtabel). Stuurt de teksten; voorheen zei elke melding "Google". */
  bron: string;
  /** Nieuwste maand met een accountrij, "YYYY-MM"; null als er niets staat. */
  laatsteMaand: string | null;
  /** Alleen bij dagbronnen: hoeveel dagen van de nieuwste maand er rijen hebben. Een maand
   *  met 3 van 31 dagen is aanwezig maar niet compleet, en dat hoort in de tekst. */
  dagenInLaatsteMaand?: number | null;
  /** De laatste afgesloten kalendermaand: wat een maandanalyse verwacht. */
  verwachteMaand: string;
  maandenAchter: number | null;
  laatsteGeslaagdeSync: string | null;
  dagenSindsSync: number | null;
  toestand: DatastandToestand;
  /** Eén zin voor het scherm en de foutmelding. */
  tekst: string;
}

/** Vanaf zoveel maanden achter is het geen ouderdom meer maar een sync die niet draait. */
export const DOOD_VANAF_MAANDEN = 2;

function maandTekst(m: string): string {
  const naam = formatMonth(m);
  return naam.charAt(0).toUpperCase() + naam.slice(1);
}

/** Kalenderdagen tussen een tijdstip en een dag: een sync van gisterochtend is "1 dag geleden",
 *  niet "0" omdat er nog geen 24 uur om zijn. */
function dagenTussen(vanIso: string, totDag: string): number | null {
  const van = Date.parse(`${vanIso.slice(0, 10)}T00:00:00Z`);
  const tot = Date.parse(`${totDag}T00:00:00Z`);
  if (!Number.isFinite(van) || !Number.isFinite(tot)) return null;
  return Math.max(0, Math.floor((tot - van) / 86_400_000));
}

/** Puur: de beoordeling uit de nieuwste maand en de laatste geslaagde sync. */
export function beoordeelDatastand(inp: {
  laatsteMaand: string | null | undefined;
  laatsteGeslaagdeSync?: string | null;
  /** Vandaag (YYYY-MM-DD); alleen de test zet hem vast. */
  nu?: string;
  /** "Google" (standaard) of een kanaallabel; zie Datastand.bron. */
  bron?: string;
  dagenInLaatsteMaand?: number | null;
}): Datastand {
  const nu = inp.nu ?? today();
  const bron = inp.bron ?? "Google";
  const verwachteMaand = lastCompleteMonth(nu.slice(0, 7));
  const sync = inp.laatsteGeslaagdeSync ?? null;
  const dagenSindsSync = sync ? dagenTussen(sync, nu) : null;
  const syncTekst = sync
    ? `laatste geslaagde sync ${sync.slice(0, 10)} (${dagenSindsSync} dagen geleden)`
    : "nog nooit een geslaagde sync geregistreerd";

  const ruw = inp.laatsteMaand ? String(inp.laatsteMaand).slice(0, 7) : null;
  if (!ruw || !isValidMonth(ruw)) {
    return {
      bron, laatsteMaand: null, dagenInLaatsteMaand: null, verwachteMaand, maandenAchter: null, laatsteGeslaagdeSync: sync, dagenSindsSync,
      toestand: "geen", tekst: `Geen ${bron}-data gesynct; ${syncTekst}.`,
    };
  }
  const dagen = inp.dagenInLaatsteMaand ?? null;
  const dagenTekst = dagen != null ? ` (${dagen} dag${dagen === 1 ? "" : "en"} met data)` : "";
  const maandenAchter = Math.max(0, monthIndex(verwachteMaand) - monthIndex(ruw));
  const basis = { bron, laatsteMaand: ruw, dagenInLaatsteMaand: dagen, verwachteMaand, maandenAchter, laatsteGeslaagdeSync: sync, dagenSindsSync };
  if (maandenAchter === 0) {
    return { ...basis, toestand: "actueel", tekst: `Data t/m ${maandTekst(ruw)}${dagenTekst}; ${syncTekst}.` };
  }
  if (maandenAchter < DOOD_VANAF_MAANDEN) {
    return { ...basis, toestand: "achter", tekst: `Data t/m ${maandTekst(ruw)}${dagenTekst}; ${maandTekst(verwachteMaand)} ontbreekt nog; ${syncTekst}.` };
  }
  return {
    ...basis, toestand: "dood",
    tekst: `De sync draait niet: data t/m ${maandTekst(ruw)}${dagenTekst}, ${maandenAchter} maanden achter op ${maandTekst(verwachteMaand)}; ${syncTekst}.`,
  };
}

/** Maandanalyses (monthly, biweekly) hebben de verwachte maand nodig; één maand achter is al
 *  een lege analysemaand. Geeft de blokkadetekst, of null als er gewoon gedraaid kan worden. */
export function datastandBlokkade(stand: Datastand): string | null {
  if (stand.toestand === "actueel") return null;
  if (stand.toestand === "geen") return `Geen ${stand.bron}-data voor deze klant. ${stand.tekst}`;
  return `Geen ${stand.bron}-data voor de analysemaand ${maandTekst(stand.verwachteMaand)}. ${stand.tekst}`;
}

// ── Weekstand, voor de weekly ────────────────────────────────────────────

export interface Weekstand {
  laatsteWeekStart: string | null;
  dagenSindsWeekEind: number | null;
  toestand: DatastandToestand;
  tekst: string;
}

/** Een week eindigt zeven dagen na week_start. Tot een week erna is de stand actueel (de
 *  volgende week is nog niet compleet), tot drie weken is het achterstand, daarna staat de
 *  sync stil. */
export const WEEK_DOOD_VANAF_DAGEN = 21;

export function beoordeelWeekstand(inp: { laatsteWeekStart: string | null | undefined; nu?: string }): Weekstand {
  const nu = inp.nu ?? today();
  const start = inp.laatsteWeekStart ? String(inp.laatsteWeekStart).slice(0, 10) : null;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return { laatsteWeekStart: null, dagenSindsWeekEind: null, toestand: "geen", tekst: "Geen wekelijkse Google-data gesynct." };
  }
  const weekEind = addDays(start, 7);
  const dagen = dagenTussen(`${weekEind}T00:00:00Z`, nu) ?? 0;
  if (dagen <= 7) return { laatsteWeekStart: start, dagenSindsWeekEind: dagen, toestand: "actueel", tekst: `Weekdata t/m de week van ${start}.` };
  if (dagen <= WEEK_DOOD_VANAF_DAGEN) return { laatsteWeekStart: start, dagenSindsWeekEind: dagen, toestand: "achter", tekst: `Weekdata loopt achter: laatste week van ${start}, ${dagen} dagen geleden afgesloten.` };
  return { laatsteWeekStart: start, dagenSindsWeekEind: dagen, toestand: "dood", tekst: `De sync draait niet: laatste weekdata van de week van ${start}, ${dagen} dagen geleden afgesloten.` };
}

export function weekstandBlokkade(stand: Weekstand): string | null {
  if (stand.toestand === "actueel" || stand.toestand === "achter") return null;
  return `Geen bruikbare weekdata voor de wekelijkse analyse. ${stand.tekst}`;
}

// ── Ophalen ────────────────────────────────────────────────────────────
//
// Het maximum wordt in het geheugen bepaald over alle rijen van de klant (hooguit ~26 maanden,
// ~120 weken): de demo-mock past sorteer- en bereikfilters niet toe, dus `.order().limit(1)`
// zou daar een willekeurige rij geven.

export async function datastandVoorKlant(supabase: SupabaseClient, clientId: string): Promise<Datastand> {
  const [maanden, status] = await Promise.all([
    supabase.from("ads_account_monthly").select("month").eq("client_id", clientId).limit(500),
    supabase.from("client_sync_status").select("last_successful_sync_at").eq("client_id", clientId).limit(1),
  ]);
  const rijen = eis(maanden, "ads_account_monthly (datastand)") as { month: unknown }[];
  const statusRijen = eis(status, "client_sync_status (datastand)") as { last_successful_sync_at: unknown }[];
  const laatsteMaand = rijen.map((r) => String(r.month ?? "").slice(0, 7)).filter((m) => isValidMonth(m)).sort().pop() ?? null;
  const sync = statusRijen[0]?.last_successful_sync_at ? String(statusRijen[0].last_successful_sync_at) : null;
  return beoordeelDatastand({ laatsteMaand, laatsteGeslaagdeSync: sync });
}

export async function weekstandVoorKlant(supabase: SupabaseClient, clientId: string): Promise<Weekstand> {
  const res = await supabase.from("ads_account_weekly").select("week_start").eq("client_id", clientId).limit(1000);
  const rijen = eis(res, "ads_account_weekly (weekstand)") as { week_start: unknown }[];
  const laatste = rijen.map((r) => String(r.week_start ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
  return beoordeelWeekstand({ laatsteWeekStart: laatste });
}

// ── Dagstand, voor de kanalen (Meta, LinkedIn, Microsoft) ───────────────────
//
// De kanaalsyncs schrijven DAGrijen (meta_account_daily, linkedin_account_daily,
// microsoft_account_daily) en de weekly/biweekly lezen daar een venster van 7 of 14 dagen uit.
// "Actueel" is hier dus: de nieuwste dag ligt hooguit een paar dagen terug (de nachtcron van
// vannacht, plus het attributievenster waarin het platform nog herschrijft). Tot twee weken is
// het achterstand; daarna staat de sync stil. De laatste geslaagde sync komt uit
// <kanaal>_connections.last_sync_at, dat sinds deze ronde alleen bij een GESLAAGDE run wordt
// gezet (lib/sync/kanaal-runs.ts).

export type Dagkanaal = "meta" | "linkedin" | "microsoft";

/** Tot zoveel dagen achter is dagdata actueel (nachtcron + attributievenster). */
export const DAG_ACHTER_VANAF_DAGEN = 3;
/** Vanaf zoveel dagen achter draait de sync niet meer. */
export const DAG_DOOD_VANAF_DAGEN = 14;

export const DAGKANAAL_LABEL: Record<Dagkanaal, string> = { meta: "Meta", linkedin: "LinkedIn", microsoft: "Microsoft" };

export interface Dagstand {
  kanaal: Dagkanaal;
  /** Nieuwste dag met een accountrij, "YYYY-MM-DD"; null als er niets staat. */
  laatsteDag: string | null;
  dagenAchter: number | null;
  laatsteGeslaagdeSync: string | null;
  toestand: DatastandToestand;
  tekst: string;
}

export function beoordeelDagstand(inp: {
  kanaal: Dagkanaal;
  laatsteDag: string | null | undefined;
  laatsteGeslaagdeSync?: string | null;
  nu?: string;
}): Dagstand {
  const nu = inp.nu ?? today();
  const label = DAGKANAAL_LABEL[inp.kanaal];
  const sync = inp.laatsteGeslaagdeSync ?? null;
  const syncTekst = sync ? `laatste geslaagde sync ${sync.slice(0, 10)}` : "nog nooit een geslaagde sync geregistreerd";
  const dag = inp.laatsteDag ? String(inp.laatsteDag).slice(0, 10) : null;
  if (!dag || !/^\d{4}-\d{2}-\d{2}$/.test(dag)) {
    return { kanaal: inp.kanaal, laatsteDag: null, dagenAchter: null, laatsteGeslaagdeSync: sync, toestand: "geen", tekst: `Geen ${label}-dagdata gesynct; ${syncTekst}.` };
  }
  const dagenAchter = dagenTussen(dag, nu) ?? 0;
  const basis = { kanaal: inp.kanaal, laatsteDag: dag, dagenAchter, laatsteGeslaagdeSync: sync };
  if (dagenAchter <= DAG_ACHTER_VANAF_DAGEN) {
    return { ...basis, toestand: "actueel", tekst: `${label}-data t/m ${dag}; ${syncTekst}.` };
  }
  if (dagenAchter <= DAG_DOOD_VANAF_DAGEN) {
    return { ...basis, toestand: "achter", tekst: `${label}-data loopt achter: t/m ${dag}, ${dagenAchter} dagen geleden; ${syncTekst}.` };
  }
  return { ...basis, toestand: "dood", tekst: `De ${label}-sync draait niet: data t/m ${dag}, ${dagenAchter} dagen geleden; ${syncTekst}.` };
}

/** Weekly/biweekly lezen een venster van 7-14 dagen; "achter" kan nog rijen in dat venster
 *  hebben, "dood" en "geen" per definitie niet. */
export function dagstandBlokkade(stand: Dagstand): string | null {
  if (stand.toestand === "actueel" || stand.toestand === "achter") return null;
  return `Geen bruikbare ${DAGKANAAL_LABEL[stand.kanaal]}-dagdata. ${stand.tekst}`;
}

export async function dagstandVoorKlant(supabase: SupabaseClient, clientId: string, kanaal: Dagkanaal): Promise<Dagstand> {
  // Nieuwste eerst en afgekapt op 400 rijen (ruim een jaar dagdata); het maximum wordt daarna in
  // het geheugen bepaald, zodat de uitkomst niet afhangt van hoe strikt een bron de sortering
  // toepast.
  const [dagen, conn] = await Promise.all([
    supabase.from(`${kanaal}_account_daily`).select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(400),
    supabase.from(`${kanaal}_connections`).select("last_sync_at").eq("client_id", clientId).limit(1),
  ]);
  const rijen = eis(dagen, `${kanaal}_account_daily (dagstand)`) as { date: unknown }[];
  const connRijen = eis(conn, `${kanaal}_connections (dagstand)`) as { last_sync_at: unknown }[];
  const laatsteDag = rijen.map((r) => String(r.date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
  const sync = connRijen[0]?.last_sync_at ? String(connRijen[0].last_sync_at) : null;
  return beoordeelDagstand({ kanaal, laatsteDag, laatsteGeslaagdeSync: sync });
}

/**
 * De MAANDstand van een kanaal, voor de maandanalyse: dezelfde beoordeling als bij Google
 * (verwachte maand = laatste afgesloten maand), maar afgeleid uit de dagtabel, met erbij hoeveel
 * dagen van die nieuwste maand er rijen hebben. Blokkeert via datastandBlokkade zodra de
 * analysemaand geen enkele rij heeft; een maand met weinig dagen draait wél, met het aantal in
 * de tekst, zodat de lezer de dekking kent.
 */
export async function kanaalMaandstandVoorKlant(supabase: SupabaseClient, clientId: string, kanaal: Dagkanaal): Promise<Datastand> {
  const [dagen, conn] = await Promise.all([
    supabase.from(`${kanaal}_account_daily`).select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(400),
    supabase.from(`${kanaal}_connections`).select("last_sync_at").eq("client_id", clientId).limit(1),
  ]);
  const rijen = eis(dagen, `${kanaal}_account_daily (maandstand)`) as { date: unknown }[];
  const connRijen = eis(conn, `${kanaal}_connections (maandstand)`) as { last_sync_at: unknown }[];
  const datums = rijen.map((r) => String(r.date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const laatsteDag = datums.length > 0 ? datums[datums.length - 1] : null;
  const laatsteMaand = laatsteDag ? laatsteDag.slice(0, 7) : null;
  const dagenInLaatsteMaand = laatsteMaand ? new Set(datums.filter((d) => d.startsWith(laatsteMaand))).size : null;
  const sync = connRijen[0]?.last_sync_at ? String(connRijen[0].last_sync_at) : null;
  return beoordeelDatastand({ laatsteMaand, laatsteGeslaagdeSync: sync, bron: DAGKANAAL_LABEL[kanaal], dagenInLaatsteMaand });
}

// ── Bureaubreed: staat de sync stil voor iedereen? ──────────────────────────
//
// De stand per klant staat in de badge op het klantdashboard; wie daar niet kijkt, ziet niets.
// Op 3 september 2026 stond de Google-sync al vier en een halve maand stil voor ELKE klant, en
// de app toonde gewoon dashboards met aprildata. Dit hulpje telt de standen van alle klanten
// van het bureau op tot één oordeel voor een banner boven elke pagina.

export interface KlantDatastand {
  clientId: string;
  naam: string;
  stand: Datastand;
}

export interface BureauDatastand {
  toestand: "ok" | "nooit" | "stilstand";
  totaal: number;
  actueel: number;
  achter: number;
  dood: number;
  geen: number;
  /** Eén zin voor de banner; null als er niets te melden is. */
  tekst: string | null;
}

/** Puur: het bureauoordeel uit de klantstanden. "stilstand" zodra één klant dood is; "nooit"
 *  als geen enkele klant ooit data kreeg; anders ok (één klant achter is een badge, geen banner). */
export function samenvatDatastanden(standen: KlantDatastand[]): BureauDatastand {
  const telling = { actueel: 0, achter: 0, dood: 0, geen: 0 };
  for (const k of standen) telling[k.stand.toestand] += 1;
  const totaal = standen.length;
  const basis = { totaal, ...telling };
  if (totaal === 0) return { ...basis, toestand: "ok", tekst: null };

  if (telling.dood > 0) {
    const doden = standen.filter((k) => k.stand.toestand === "dood");
    const maanden = doden.map((k) => k.stand.laatsteMaand).filter((m): m is string => !!m).sort();
    const oudste = maanden[0], nieuwste = maanden[maanden.length - 1];
    const maandDeel = oudste === nieuwste ? `data t/m ${maandTekst(nieuwste)}` : `data t/m ${maandTekst(oudste)} tot ${maandTekst(nieuwste)}`;
    const syncs = doden.map((k) => k.stand.laatsteGeslaagdeSync).filter((s): s is string => !!s).sort();
    const syncDeel = syncs.length > 0 ? `laatste geslaagde sync ${syncs[syncs.length - 1].slice(0, 10)}` : "nog nooit een geslaagde sync geregistreerd";
    const wie = telling.dood === totaal ? `alle ${totaal} klanten` : `${telling.dood} van ${totaal} klanten`;
    return {
      ...basis, toestand: "stilstand",
      tekst: `De Google-sync staat stil voor ${wie}: ${maandDeel}, ${syncDeel}. Analyses over recentere maanden worden geblokkeerd tot de sync weer draait.`,
    };
  }
  if (telling.geen === totaal) {
    return {
      ...basis, toestand: "nooit",
      tekst: `Nog geen Google-data gesynct voor ${totaal === 1 ? "de enige klant" : `alle ${totaal} klanten`}; verbind Google Ads en start een sync.`,
    };
  }
  return { ...basis, toestand: "ok", tekst: null };
}

/** De standen van een lijst klanten in twee queries (niet één per klant), via `in`. */
export async function datastandVoorBureau(
  supabase: SupabaseClient,
  klanten: { clientId: string; naam: string }[]
): Promise<KlantDatastand[]> {
  if (klanten.length === 0) return [];
  const ids = klanten.map((k) => k.clientId);
  const [maanden, status] = await Promise.all([
    supabase.from("ads_account_monthly").select("client_id, month").in("client_id", ids).limit(10_000),
    supabase.from("client_sync_status").select("client_id, last_successful_sync_at").in("client_id", ids).limit(1000),
  ]);
  const maandRijen = eis(maanden, "ads_account_monthly (bureaustand)") as { client_id: unknown; month: unknown }[];
  const statusRijen = eis(status, "client_sync_status (bureaustand)") as { client_id: unknown; last_successful_sync_at: unknown }[];
  const nieuwste = new Map<string, string>();
  for (const r of maandRijen) {
    const id = String(r.client_id ?? ""), m = String(r.month ?? "").slice(0, 7);
    if (!isValidMonth(m)) continue;
    const huidig = nieuwste.get(id);
    if (!huidig || m > huidig) nieuwste.set(id, m);
  }
  const sync = new Map<string, string>();
  for (const r of statusRijen) {
    if (r.last_successful_sync_at) sync.set(String(r.client_id ?? ""), String(r.last_successful_sync_at));
  }
  return klanten.map((k) => ({
    clientId: k.clientId,
    naam: k.naam,
    stand: beoordeelDatastand({ laatsteMaand: nieuwste.get(k.clientId) ?? null, laatsteGeslaagdeSync: sync.get(k.clientId) ?? null }),
  }));
}
