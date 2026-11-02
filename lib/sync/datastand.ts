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
import { lastCompleteMonth, monthIndex, formatMonth, isValidMonth, addMonths } from "@/lib/period/period-range";
import { today, addDays } from "@/lib/reporting-date";
import { eis } from "@/lib/analysis/db-veilig";
import { daysInMonthOf } from "@/lib/analysis/comparison-facts";

// ── Tot welke maand is de data VOL? ─────────────────────────────────────────
//
// Eén antwoord voor de KPI-band, de pacing, het jaaroverzicht en de kanaalprognose. Elk blok
// stelde die vraag op zijn eigen manier: "vorige kalendermaand", "de laatste maand met een rij",
// "het aantal niet-lege maanden", dag-van-het-jaar uit de browserklok. Bij demo-greentech (data
// t/m 26 augustus, bekeken op 1 november) gaf dat op één scherm vier antwoorden: augustus telde
// als volle maand, en september en oktober werden afhankelijk van het blok meegeteld als nullen,
// geprojecteerd alsof ze nog moesten komen, of weggelaten.
//
// `dataTot` is de laatste DAG waarvan de data definitief is: bij een dagbron de nieuwste datum
// met een rij, of na een geslaagde sync de dag vóór die sync of die rij (dataTotVanDagbron), bij
// een maandbron de dag vóór de laatste geslaagde sync (dataTotVanMaandbron), bij een live bron
// gisteren. Een maand is vol als dataTot op zijn laatste dag ligt, en nooit later
// dan de laatste afgesloten kalendermaand.
//
// Dit deel is puur en client-veilig: de KPI-band rekent het in de browser uit, de routes op de
// server. De rest van dit bestand (beoordeelDatastand en de lezers) blijft zoals het was; of de
// maandanalyse ook op een onvolledige maand moet blokkeren is een aparte beslissing.

export interface VolleMaand {
  /** Laatste maand die afgesloten is EN t/m zijn laatste dag gemeten, "YYYY-MM"; null zonder data. */
  laatsteVolleMaand: string | null;
  /** De maand direct na laatsteVolleMaand, als daar al een deel van gemeten is. */
  partieel: { maand: string; tmDag: number; dagenInMaand: number } | null;
  /** lastCompleteMonth(nu): de maand die de kalender als laatste afgesloten maand verwacht. */
  verwachteMaand: string;
  /** Hoeveel maanden laatsteVolleMaand achterloopt op verwachteMaand; null zonder data. */
  maandenAchter: number | null;
}

/** De datastand over meerdere bronnen samen, zoals een route hem meestuurt: volleMaand over
 *  gezamenlijkeDataTot, met de dag zelf en de bronnen die niet mochten remmen. */
export interface DataStandSamen extends VolleMaand {
  dataTot: string | null;
  uitgesloten: string[];
  /**
   * De invoer van gezamenlijkeDataTot, per bron. Alleen de blended route zet hem. De browser kan
   * <kanaal>_connections niet lezen, en zonder dit wist de KPI-band op een kanaaltab niet of de
   * sync na de laatste rij nog geslaagd is; en op "Alle kanalen" leest de band Google live, niet
   * uit fact_core, dus hoort hij de regel over zijn eigen bronnen te draaien (review [3], [12], [14]).
   */
  bronnen?: {
    bron: string;
    dataTot: string | null;
    syncDraait: boolean;
    /**
     * Alleen bij een dagkanaal: de nieuwste rij. Niet voor het venster (dat is dataTot), wel voor de
     * zin over een uitgesloten bron (uitgeslotenMetDag). dataTot is de laatste DEFINITIEVE dag: bij
     * een kanaal dat na zijn sync van 05:00 op dag D stopte (ontkoppeld, of de sync dood) is dat
     * D-1, terwijl de rij van D gewoon in de totalen staat en de laatste data is die nog komt.
     */
    laatsteRij?: string | null;
  }[];
}

/** "YYYY-MM-DD" (ook uit een tijdstip) als het een bestaande dag is, anders null. "2026-02-30"
 *  is geen dag: die zou februari stilletjes vol verklaren. */
function alsDag(v: unknown): string | null {
  if (v == null) return null;
  const d = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d ? d : null;
}

/** De laatste bestaande dag uit een paar kandidaten, of null: een ongeldige of ontbrekende telt
 *  niet. Voor de rijen in de browser naast de dag van de route is het dagkanaalDataTot: daar telt
 *  de nieuwste rij niet als volle dag. */
export function laatsteGeldigeDag(...dagen: (string | null | undefined)[]): string | null {
  let laatste: string | null = null;
  for (const d of dagen) {
    const dag = alsDag(d);
    if (dag && (laatste === null || dag > laatste)) laatste = dag;
  }
  return laatste;
}

/** @param inp.nu vandaag als "YYYY-MM-DD" (standaard today(), Amsterdam); alleen tests en
 *  routes met een vaste peildatum zetten hem. Een maand ("2026-11") is geen dag en wordt
 *  geweigerd, in plaats van stil vervangen door vandaag. */
export function volleMaand(inp: { dataTot: string | null | undefined; nu?: string }): VolleMaand {
  const nu = inp.nu === undefined ? today() : alsDag(inp.nu);
  if (!nu) throw new Error(`volleMaand: nu moet een dag zijn (YYYY-MM-DD), kreeg ${JSON.stringify(inp.nu)}`);
  const verwachteMaand = lastCompleteMonth(nu.slice(0, 7));
  const ruw = alsDag(inp.dataTot);
  if (!ruw) return { laatsteVolleMaand: null, partieel: null, verwachteMaand, maandenAchter: null };

  // Vandaag (en later) is per definitie nog niet definitief: de rij van vandaag groeit nog, en een
  // bron met een andere klok kan al een dag verder staan.
  const tot = ruw >= nu ? addDays(nu, -1) : ruw;
  const maand = tot.slice(0, 7);
  const dagenInMaand = daysInMonthOf(tot);
  const tmDag = Number(tot.slice(8, 10));
  const kandidaat = tmDag >= dagenInMaand ? maand : addMonths(maand, -1);
  const laatsteVolleMaand = monthIndex(kandidaat) > monthIndex(verwachteMaand) ? verwachteMaand : kandidaat;
  const partieel = tmDag < dagenInMaand && maand === addMonths(laatsteVolleMaand, 1)
    ? { maand, tmDag, dagenInMaand }
    : null;
  return {
    laatsteVolleMaand,
    partieel,
    verwachteMaand,
    maandenAchter: Math.max(0, monthIndex(verwachteMaand) - monthIndex(laatsteVolleMaand)),
  };
}

/**
 * De laatste definitieve dag van een MAANDbron (ads_account_monthly, fact_core). Een maandrij
 * zegt niet tot welke dag hij gevuld is; het synctijdstip wel: een rij die op 26 augustus
 * geschreven is, is augustus t/m de 25e. Dus de dag vóór de laatste geslaagde sync, begrensd
 * door de maand van de nieuwste rij:
 * - niet later dan het eind van die maand (een sync in september maakt augustus vol, niet september);
 * - niet vroeger dan de dag vóór die maand: dat er een rij voor augustus staat, betekent dat er op
 *   of na 1 augustus gesynct is, ook als client_sync_status dat (nog) niet zegt.
 * Zonder synctijdstip: het eind van de maand, de oude aanname, alleen nog als terugval.
 *
 * Het synctijdstip wordt op zijn UTC-datum gelezen (zoals de rest van dit bestand). De nachtcron
 * draait om 05:00 UTC, dus dat is dezelfde dag als in Amsterdam; een handmatige sync tussen
 * middernacht en 02:00 Amsterdamse tijd komt een dag te vroeg uit, en dat is de veilige kant.
 */
export function dataTotVanMaandbron(laatsteMaand: string | null | undefined, laatsteSync: string | null | undefined): string | null {
  const m = laatsteMaand ? String(laatsteMaand).slice(0, 7) : null;
  if (!m || !isValidMonth(m)) return null;
  const eind = `${m}-${String(daysInMonthOf(`${m}-01`)).padStart(2, "0")}`;
  const syncDag = alsDag(laatsteSync);
  if (!syncDag) return eind;
  const dagVoorSync = addDays(syncDag, -1);
  const dagVoorMaand = addDays(`${m}-01`, -1);
  if (dagVoorSync > eind) return eind;
  if (dagVoorSync < dagVoorMaand) return dagVoorMaand;
  return dagVoorSync;
}

/**
 * Over kanalen samen: de VROEGSTE dataTot. Een totaal over een maand waarin één kanaal nog niet
 * volledig gemeten is, is geen totaal: dan telt dat kanaal als nul in een maand waarin het wel
 * liep.
 *
 * Uitzondering: een bron waarvan de sync WEL draait (Datastand/Dagstand.syncDraait) heeft na zijn
 * dataTot echte nullen, geen ontbrekende data. Een gepauzeerd account mag de rest dan niet
 * tegenhouden. Zo'n bron telt niet mee voor de rem, en staat in `uitgesloten` als hij anders
 * had geremd (een stille bron die toch al verder loopt dan de rest, hoeft niemand te noemen).
 *
 * De rem is begrensd: een bron die meer dan DOOD_VANAF_MAANDEN x 30 dagen achterloopt op de
 * nieuwste bron, remt niet meer en staat ook in `uitgesloten`. Zo ver achter wacht hij niet op een
 * gemiste nacht maar op data die niet komt: een verlopen token, of een koppeling die via
 * Instellingen is uitgezet en daarom nooit meer synct. Onbegrensd hield een LinkedIn die in maart
 * 2025 stopte heel "Alle kanalen" op februari 2025, en werden de gemeten Google-maanden erna als
 * toekomst geprojecteerd (review [9], [36]). Tot die grens remt hij wel: een sync die een paar
 * nachten of weken mist, hoort de rest tegen te houden. Dezelfde orde als "dood" in
 * beoordeelDatastand (twee maanden), maar NIET dezelfde maat: die telt hoeveel afgesloten maanden er
 * ontbreken tegen de kalender, dit hoeveel dagen een bron achterloopt op de andere. Een bron die
 * daar nog "actueel" is, wordt hier dus ook niet opgegeven.
 *
 * Remt er niemand (alle bronnen stil, of alleen stille en opgegeven bronnen), dan de LAATSTE dag.
 * Hier stond de vroegste, en dan gooide een Meta die tot 15 september gemeten was, mei t/m augustus
 * weg zodra ook Google stillag (review [11]). Stil betekent: de sync slaagt en na zijn dataTot zijn
 * het echte nullen, dus de laatste dag van de stille bronnen loopt nooit voorbij gemeten data.
 *
 * Een bron zonder bruikbare dataTot (nog nooit data) doet niet mee: die heeft geen maanden om
 * onvolledig te zijn.
 *
 * LET OP bij het vullen van `syncDraait`: geef niet rauw Datastand/Dagstand.syncDraait door, maar
 * remtNietBijAchterstand(stand). De lezers zetten syncDraait ook bij een bron die gewoon actueel
 * is, en dan stonden een actuele Google en een gepauzeerde LinkedIn allebei "stil": volgens de
 * regel hierboven remden ze dan weer allebei, en kreeg het venster dat van LinkedIn (maart in
 * plaats van oktober).
 */
export function gezamenlijkeDataTot(
  bronnen: { bron: string; dataTot: string | null | undefined; syncDraait?: boolean }[],
): { dataTot: string | null; uitgesloten: string[] } {
  const geldig = bronnen
    .map((b) => ({ bron: b.bron, dag: alsDag(b.dataTot), stil: b.syncDraait === true }))
    .filter((b): b is { bron: string; dag: string; stil: boolean } => b.dag !== null);
  if (geldig.length === 0) return { dataTot: null, uitgesloten: [] };
  const nieuwsteDag = geldig.map((b) => b.dag).sort()[geldig.length - 1];
  // In dagen, niet in kalendermaanden van de twee dagen: dan was 31 augustus tegen 1 oktober al
  // "twee maanden" (31 dagen) en 1 september tegen 31 oktober nog "één" (60 dagen), en sprong het
  // venster in één nacht een maand vooruit zodra een haperende sync over de maandgrens ging.
  const opgegeven = (b: { dag: string }) => (dagenTussen(b.dag, nieuwsteDag) ?? 0) > DOOD_VANAF_MAANDEN * 30;
  const remmers = geldig.filter((b) => !b.stil && !opgegeven(b));
  const dagen = (remmers.length > 0 ? remmers : geldig).map((b) => b.dag).sort();
  const dataTot = remmers.length > 0 ? dagen[0] : dagen[dagen.length - 1];
  const uitgesloten = geldig.filter((b) => !remmers.includes(b) && b.dag < dataTot).map((b) => b.bron);
  return { dataTot, uitgesloten };
}

/** De bronnen uit `uitgesloten`, elk met de dag waarop zijn data ophoudt (uit `bronnen`). De
 *  KPI-band, het Jaaroverzicht en de Pacing noemen ze zo met dezelfde dag.
 *
 *  Die dag is de LAATSTE van de nieuwste rij en dataTot (laatsteGeldigeDag). dataTot alleen zei
 *  "geen data na 14 mei" voor een LinkedIn die na zijn sync van 15 mei stopte, terwijl de rij van
 *  15 mei in het meitotaal staat; Instellingen en de dagstand noemden 15 mei. De rij alleen zou een
 *  gepauzeerd account met een gezonde sync terugzetten naar zijn laatste levering, terwijl de sync
 *  de dagen erna als nul gemeten heeft: dan wint dataTot. Het venster blijft op dataTot. */
export function uitgeslotenMetDag(
  samen: { uitgesloten?: readonly string[]; bronnen?: readonly { bron: string; dataTot: string | null | undefined; laatsteRij?: string | null }[] } | null | undefined,
): { bron: string; dataTot: string | null }[] {
  return (samen?.uitgesloten ?? []).map((bron) => {
    const b = samen?.bronnen?.find((x) => x.bron === bron);
    return { bron, dataTot: laatsteGeldigeDag(b?.laatsteRij, b?.dataTot) };
  });
}

export type DatastandToestand = "actueel" | "achter" | "dood" | "geen";

/**
 * De `syncDraait` voor gezamenlijkeDataTot: alleen een bron die ACHTERloopt terwijl zijn sync
 * slaagt, heeft na zijn dataTot echte nullen (gepauzeerd) en mag de rest niet remmen. Een actuele
 * bron remt gewoon mee; hij staat toch al op de nieuwste dag.
 */
export function remtNietBijAchterstand(stand: { syncDraait: boolean; toestand: DatastandToestand }): boolean {
  return stand.syncDraait && stand.toestand !== "actueel";
}

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
  /** Zie SYNC_DRAAIT_BINNEN_DAGEN: de data loopt achter, maar de sync slaagt wel. */
  syncDraait: boolean;
  /** Eén zin voor het scherm en de foutmelding. */
  tekst: string;
}

/** Vanaf zoveel maanden achter is het geen ouderdom meer maar een sync die niet draait. */
export const DOOD_VANAF_MAANDEN = 2;

// ── Achter, maar de sync draait ──────────────────────────────────────────────
//
// "Achter" en "dood" zeiden altijd "de sync draait niet". Maar een account dat sinds juni
// gepauzeerd staat, levert na juni geen rijen meer, ook als de sync elke nacht slaagt: dan stond
// er een bureaubrede rode banner ("De Google-sync staat stil") voor een klant die gewoon geen
// besteding heeft. De TOESTAND blijft hetzelfde -- er is geen data voor de analysemaand, dus de
// blokkades (datastandBlokkade, dagstandBlokkade, kanaal-datapoort) blijven precies zo -- maar
// `syncDraait` zegt erbij dat de oorzaak niet de sync is: de laatste geslaagde sync is hooguit
// zoveel dagen oud (de nachtcron plus één gemiste nacht) en ligt NA de ontbrekende periode.
// Het scherm toont zo'n stand gedempt, en samenvatDatastanden telt hem niet als stilstand --
// behalve als ALLE klanten met data zo staan, want een sync die "slaagt" zonder dat er iets in
// de views terechtkomt, moet zichtbaar blijven.
export const SYNC_DRAAIT_BINNEN_DAGEN = 3;

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

  // Na de verwachte maand: een sync op de laatste dagen van die maand zelf kon hem nog niet compleet zien.
  const syncDraait = sync != null && dagenSindsSync != null && dagenSindsSync <= SYNC_DRAAIT_BINNEN_DAGEN && sync.slice(0, 7) > verwachteMaand;

  const ruw = inp.laatsteMaand ? String(inp.laatsteMaand).slice(0, 7) : null;
  if (!ruw || !isValidMonth(ruw)) {
    return {
      bron, laatsteMaand: null, dagenInLaatsteMaand: null, verwachteMaand, maandenAchter: null, laatsteGeslaagdeSync: sync, dagenSindsSync,
      toestand: "geen", syncDraait: false, tekst: `Geen ${bron}-data gesynct; ${syncTekst}.`,
    };
  }
  const dagen = inp.dagenInLaatsteMaand ?? null;
  const dagenTekst = dagen != null ? ` (${dagen} dag${dagen === 1 ? "" : "en"} met data)` : "";
  const maandenAchter = Math.max(0, monthIndex(verwachteMaand) - monthIndex(ruw));
  const basis = { bron, laatsteMaand: ruw, dagenInLaatsteMaand: dagen, verwachteMaand, maandenAchter, laatsteGeslaagdeSync: sync, dagenSindsSync };
  if (maandenAchter === 0) {
    return { ...basis, toestand: "actueel", syncDraait, tekst: `Data t/m ${maandTekst(ruw)}${dagenTekst}; ${syncTekst}.` };
  }
  if (syncDraait) {
    return {
      ...basis, toestand: maandenAchter < DOOD_VANAF_MAANDEN ? "achter" : "dood", syncDraait,
      tekst: `Geen ${bron}-data na ${maandTekst(ruw)}${dagenTekst}, terwijl de sync wel draait (${syncTekst}): vermoedelijk geen besteding sinds dan.`,
    };
  }
  if (maandenAchter < DOOD_VANAF_MAANDEN) {
    return { ...basis, toestand: "achter", syncDraait, tekst: `Data t/m ${maandTekst(ruw)}${dagenTekst}; ${maandTekst(verwachteMaand)} ontbreekt nog; ${syncTekst}.` };
  }
  return {
    ...basis, toestand: "dood", syncDraait,
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

/** @param nu vandaag als "YYYY-MM-DD" (standaard today()); de blended route geeft zijn eigen peildag mee. */
export async function datastandVoorKlant(supabase: SupabaseClient, clientId: string, nu?: string): Promise<Datastand> {
  const [maanden, status] = await Promise.all([
    supabase.from("ads_account_monthly").select("month").eq("client_id", clientId).limit(500),
    supabase.from("client_sync_status").select("last_successful_sync_at").eq("client_id", clientId).limit(1),
  ]);
  const rijen = eis(maanden, "ads_account_monthly (datastand)") as { month: unknown }[];
  const statusRijen = eis(status, "client_sync_status (datastand)") as { last_successful_sync_at: unknown }[];
  const laatsteMaand = rijen.map((r) => String(r.month ?? "").slice(0, 7)).filter((m) => isValidMonth(m)).sort().pop() ?? null;
  const sync = statusRijen[0]?.last_successful_sync_at ? String(statusRijen[0].last_successful_sync_at) : null;
  return beoordeelDatastand({ laatsteMaand, laatsteGeslaagdeSync: sync, nu });
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
  /** Zie SYNC_DRAAIT_BINNEN_DAGEN: de data loopt achter, maar de sync slaagt wel. */
  syncDraait: boolean;
  /**
   * Er is een koppelingsrij en die staat niet op "disabled" (dezelfde regel als
   * leesKanaalKoppelingen). Een uitgezette koppeling synct nooit meer (lib/sync/kanaal-runs.ts:
   * "uitgezet is uitgezet"), dus zijn achterstand is geen storing die bijgewerkt gaat worden.
   */
  gekoppeld: boolean;
  tekst: string;
}

export function beoordeelDagstand(inp: {
  kanaal: Dagkanaal;
  laatsteDag: string | null | undefined;
  laatsteGeslaagdeSync?: string | null;
  nu?: string;
  /** Standaard true: wie de koppeling niet kent, behandelt het kanaal zoals voorheen. */
  gekoppeld?: boolean;
}): Dagstand {
  const nu = inp.nu ?? today();
  const label = DAGKANAAL_LABEL[inp.kanaal];
  const sync = inp.laatsteGeslaagdeSync ?? null;
  const gekoppeld = inp.gekoppeld ?? true;
  const syncTekst = sync ? `laatste geslaagde sync ${sync.slice(0, 10)}` : "nog nooit een geslaagde sync geregistreerd";
  const dag = inp.laatsteDag ? String(inp.laatsteDag).slice(0, 10) : null;
  if (!dag || !/^\d{4}-\d{2}-\d{2}$/.test(dag)) {
    return { kanaal: inp.kanaal, laatsteDag: null, dagenAchter: null, laatsteGeslaagdeSync: sync, toestand: "geen", syncDraait: false, gekoppeld, tekst: `Geen ${label}-dagdata gesynct; ${syncTekst}.` };
  }
  const dagenAchter = dagenTussen(dag, nu) ?? 0;
  const dagenSindsSync = sync ? dagenTussen(sync, nu) : null;
  const syncDraait = sync != null && dagenSindsSync != null && dagenSindsSync <= SYNC_DRAAIT_BINNEN_DAGEN && sync.slice(0, 10) > dag;
  const basis = { kanaal: inp.kanaal, laatsteDag: dag, dagenAchter, laatsteGeslaagdeSync: sync, syncDraait, gekoppeld };
  if (dagenAchter <= DAG_ACHTER_VANAF_DAGEN) {
    return { ...basis, toestand: "actueel", tekst: `${label}-data t/m ${dag}; ${syncTekst}.` };
  }
  if (syncDraait) {
    return {
      ...basis, toestand: dagenAchter <= DAG_DOOD_VANAF_DAGEN ? "achter" : "dood",
      tekst: `Geen ${label}-data na ${dag}, terwijl de sync wel draait (${syncTekst}): vermoedelijk geen besteding sinds dan.`,
    };
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

/**
 * De laatste definitieve dag van een DAGbron: de nieuwste rij, of, als er daarna nog een sync
 * slaagde, de dag vóór die sync. De syncs schrijven geen nulrijen: een dag zonder levering (geen
 * advertenties in het weekend, het maandbudget op, een gepauzeerd account) heeft geen rij, ook als
 * hij gemeten is. Op de nieuwste rij alleen las een Microsoft zonder zaterdag 31 oktober als
 * "oktober t/m de 30e", en verloor een gepauzeerd account op zijn eigen tab maanden (review [3],
 * [10], [14]). Zonder geslaagde sync na de nieuwste rij blijft het die rij: ontbrekend is dan geen nul.
 *
 * Bewust niet syncDraait: dat eist ook een sync van hooguit SYNC_DRAAIT_BINNEN_DAGEN oud, en dan
 * verloor een gepauzeerd account de dagen die zijn laatste geslaagde sync wél gemeten had zodra die
 * sync een dag te oud werd (op 1 november t/m 28 oktober, op 2 november t/m 20 september: het
 * venster viel van oktober terug naar augustus). Wat gemeten is, blijft gemeten. syncDraait beslist
 * alleen nog of een bron het gezamenlijke venster mag tegenhouden (remtNietBijAchterstand).
 *
 * Valt de nieuwste rij OP of NA de dag van de laatste geslaagde sync, dan telt die rij zelf niet. De
 * nachtcron draait om 05:00 UTC en haalt de dagrijen t/m todayUTC() op (lib/sync/kanaal-runs.ts), dus
 * de rij van de syncdag is zo'n zes van de 24 uur. Als de nieuwste rij telde, was een oktober waarvan
 * de sync op de 31e voor het laatst slaagde "vol", met een 31e van zes uur erin, en de maandbron zei
 * voor dezelfde sync "t/m de 30e" (dataTotVanMaandbron). Bij een rij NA de sync (een run die de
 * dagrijen schreef en daarna op iets anders faalde, zet last_sync_at niet) is het de dag vóór die
 * rij, niet de dag vóór de oude sync: ook die run haalde t/m zijn eigen dag op, maar de dagen ervoor
 * zijn compleet, en anders bleef een kanaal waarvan alleen een bijstap faalt wekenlang op de oude
 * sync staan en de rest remmen. Zonder bekende sync blijft het de nieuwste rij (de oude aanname).
 */
export function dataTotVanDagbron(stand: Pick<Dagstand, "laatsteDag" | "laatsteGeslaagdeSync">): string | null {
  const dag = alsDag(stand.laatsteDag);
  const syncDag = alsDag(stand.laatsteGeslaagdeSync);
  if (!dag || !syncDag) return dag;
  if (dag >= syncDag) return addDays(dag, -1);
  return addDays(syncDag, -1);
}

/**
 * De dataTot van een dagkanaal in de BROWSER: de nieuwste rij die de browser zelf laadde, samen met
 * de dataTot die de blended route voor dat kanaal gaf (dataTotVanDagbron; de browser kan
 * <kanaal>_connections niet lezen). Voor de KPI-band en de kanaalprognose, met één regel.
 *
 * Hier stond de LAATSTE van de twee (laatsteGeldigeDag). Dan kwam de correctie van de route voor de
 * rij van de syncdag nooit aan: de browser ziet dezelfde rij van 31 oktober waarvan de route zegt
 * "t/m de 30e", en die rij won. Een rij die later valt dan de routedag telt nu t/m de dag ervoor: het
 * is die syncdag-rij zelf, of een rij van een sync ná het antwoord van de route (dat staat vijf
 * minuten in de cache), en ook die sync haalde t/m zijn eigen dag op. Geeft de route geen dag (hij
 * faalde, laadt niet, of kent het kanaal niet), dan de rij, zoals voorheen.
 */
export function dagkanaalDataTot(laatsteRij: string | null | undefined, routeDataTot: string | null | undefined): string | null {
  const rij = alsDag(laatsteRij);
  const route = alsDag(routeDataTot);
  if (!route) return rij;
  return laatsteGeldigeDag(rij ? addDays(rij, -1) : null, route);
}

/** @param nu vandaag als "YYYY-MM-DD" (standaard today()); de blended route geeft zijn eigen peildag mee. */
export async function dagstandVoorKlant(supabase: SupabaseClient, clientId: string, kanaal: Dagkanaal, nu?: string): Promise<Dagstand> {
  // Nieuwste eerst en afgekapt op 400 rijen (ruim een jaar dagdata); het maximum wordt daarna in
  // het geheugen bepaald, zodat de uitkomst niet afhangt van hoe strikt een bron de sortering
  // toepast.
  const [dagen, conn] = await Promise.all([
    supabase.from(`${kanaal}_account_daily`).select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(400),
    supabase.from(`${kanaal}_connections`).select("last_sync_at, status").eq("client_id", clientId).limit(1),
  ]);
  const rijen = eis(dagen, `${kanaal}_account_daily (dagstand)`) as { date: unknown }[];
  const connRijen = eis(conn, `${kanaal}_connections (dagstand)`) as { last_sync_at: unknown; status?: unknown }[];
  const laatsteDag = rijen.map((r) => String(r.date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
  const sync = connRijen[0]?.last_sync_at ? String(connRijen[0].last_sync_at) : null;
  const gekoppeld = connRijen.length > 0 && connRijen[0].status !== "disabled";
  return beoordeelDagstand({ kanaal, laatsteDag, laatsteGeslaagdeSync: sync, nu, gekoppeld });
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

/** Puur: het bureauoordeel uit de klantstanden. "stilstand" zodra één klant dood is waarvan de
 *  sync niet draait (een gepauzeerd account met een werkende sync is geen stilstand, zie
 *  SYNC_DRAAIT_BINNEN_DAGEN), of zodra ALLE klanten met data dood zijn; "nooit" als geen enkele
 *  klant ooit data kreeg; anders ok (één klant achter is een badge, geen banner). */
export function samenvatDatastanden(standen: KlantDatastand[]): BureauDatastand {
  const telling = { actueel: 0, achter: 0, dood: 0, geen: 0 };
  for (const k of standen) telling[k.stand.toestand] += 1;
  const totaal = standen.length;
  const basis = { totaal, ...telling };
  if (totaal === 0) return { ...basis, toestand: "ok", tekst: null };

  const metData = standen.filter((k) => k.stand.toestand !== "geen");
  const allesMetDataDood = metData.length > 0 && metData.every((k) => k.stand.toestand === "dood");
  const doden = standen.filter((k) => k.stand.toestand === "dood" && (allesMetDataDood || !k.stand.syncDraait));
  if (doden.length > 0) {
    const maanden = doden.map((k) => k.stand.laatsteMaand).filter((m): m is string => !!m).sort();
    const oudste = maanden[0], nieuwste = maanden[maanden.length - 1];
    const maandDeel = oudste === nieuwste ? `data t/m ${maandTekst(nieuwste)}` : `data t/m ${maandTekst(oudste)} tot ${maandTekst(nieuwste)}`;
    const syncs = doden.map((k) => k.stand.laatsteGeslaagdeSync).filter((s): s is string => !!s).sort();
    const syncDeel = syncs.length > 0 ? `laatste geslaagde sync ${syncs[syncs.length - 1].slice(0, 10)}` : "nog nooit een geslaagde sync geregistreerd";
    const wie = doden.length === totaal ? `alle ${totaal} klanten` : `${doden.length} van ${totaal} klanten`;
    // Slaagt de sync wél voor al deze klanten, dan is "staat stil" niet waar; de banner blijft,
    // want bij alle klanten tegelijk is "allemaal gepauzeerd" de minst waarschijnlijke uitleg.
    if (doden.every((k) => k.stand.syncDraait)) {
      return {
        ...basis, toestand: "stilstand",
        tekst: `Geen nieuwe Google-data voor ${wie} (${maandDeel}), terwijl de sync wel slaagt (${syncDeel}). Staan niet al deze accounts stil, dan komt de gesyncte data niet in de app terecht. Analyses over recentere maanden worden geblokkeerd.`,
      };
    }
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
