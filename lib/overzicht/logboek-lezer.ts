// Het logboek van één klant lezen (bouwplan fase 4): de serverkant van lib/overzicht/logboek.ts.
//
// Eén aanroep leest alle bronnen naast elkaar; de route (app/api/overzicht/logboek) geeft het
// resultaat in één antwoord. Voor de browser is het logboek dus één verzoek, hoeveel tabellen er
// ook achter zitten.
//
// EEN BRON DIE NIET TE LEZEN IS, HOUDT DE REST NIET TEGEN. Elders in deze app is een kapotte query
// een 500 die de tabel noemt (dataFoutNaarResponse), en dat is goed voor cijfers: een half totaal
// is een onwaar totaal. Een logboek is een lijst van losse gebeurtenissen. Ontbreekt
// code_rood_meldingen (migratie 073 is nog niet overal toegepast), dan zijn de syncs en de
// analyses nog steeds waar. De bron komt dan terug als `ok: false` met de reden, en het scherm
// zegt dat hij niet gelezen kon worden, in plaats van te doen alsof er niets gebeurd is.
//
// Alleen lezen. Hier staat geen insert, update of delete.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLE_KANALEN, type Kanaal } from "../kanalen/beschikbaar";
import {
  LOGBOEK_DAGEN, codeRoodItems, demoVoorbeelden, hypotheseItems, jobItems, notitieItems, sorteerLogboek,
  syncItems, syncUitkomst, voorstelItems,
  type CodeRoodRij, type HypotheseRij, type JobRij, type Logboek, type LogboekBron, type LogboekBronNaam,
  type LogboekItem, type NotitieRij, type SyncRun,
} from "./logboek";

/** De runtabel per kanaal. Google heeft de zijne (sync_runs), de dagkanalen elk een eigen. */
const RUN_TABEL: Record<Kanaal, string> = {
  google: "sync_runs", meta: "meta_sync_runs", linkedin: "linkedin_sync_runs", microsoft: "microsoft_sync_runs",
};

type Rij = Record<string, unknown>;
type Uitkomst = { rijen: Rij[]; fout: string | null };

/** Eén query, die nooit gooit: een fout wordt een reden. */
async function veilig(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Uitkomst> {
  try {
    const { data, error } = await query;
    if (error) return { rijen: [], fout: error.message ?? "onbekende fout" };
    return { rijen: Array.isArray(data) ? (data as Rij[]) : [], fout: null };
  } catch (e) {
    return { rijen: [], fout: e instanceof Error ? e.message : String(e) };
  }
}

const tekst = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const nummer = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Hoeveel rijen een run van een dagkanaal schreef. rows_upserted is daar jsonb, een telling per
 * tabel ({"meta_campaign_daily": 412, "meta_ad_daily": 1380}), geen getal: de som van de getallen
 * erin. Een leeg object of iets anders dan een object zegt niets over het aantal, en is dus null
 * (geen chip "0 rijen" voor een run waarvan de telling ontbreekt).
 */
function rijenUitTelling(v: unknown): number | null {
  if (typeof v === "number") return nummer(v);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const getallen = Object.values(v as Record<string, unknown>).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return getallen.length > 0 ? getallen.reduce((a, b) => a + b, 0) : null;
}

function alsSyncRun(kanaal: Kanaal, r: Rij): SyncRun {
  return {
    id: String(r.id),
    tijd: tekst(r.finished_at) ?? tekst(r.started_at),
    uitkomst: syncUitkomst(tekst(r.status)),
    rijen: kanaal === "google" ? nummer(r.total_rows_written) : rijenUitTelling(r.rows_upserted),
    fout: kanaal === "google" ? tekst(r.error_summary) : tekst(r.error),
    gevraagdTot: kanaal === "google" ? tekst(r.date_range_end) : null,
  };
}

/**
 * Het logboek van een klant.
 *
 * @param supabase De service-role client, of null als de omgeving er geen heeft. Zonder client
 *   zijn alle bronnen "niet te lezen"; de demo krijgt dan alleen zijn voorbeelden.
 * @param opties.demo De demoklant: de voorbeelden komen erbij, per stuk gemarkeerd.
 * @param opties.nu De klok, voor tests.
 */
export async function leesLogboek(
  supabase: SupabaseClient | null,
  clientId: string,
  opties: { demo?: boolean; nu?: Date } = {},
): Promise<Logboek> {
  const nu = opties.nu ?? new Date();
  const vanaf = new Date(nu.getTime() - LOGBOEK_DAGEN * 86_400_000).toISOString();
  const voorbeelden = opties.demo ? demoVoorbeelden(nu) : [];
  const namen: LogboekBronNaam[] = ["code-rood", "sync", "analyses", "voorstellen", "hypothesen", "notities"];

  if (!supabase) {
    return {
      items: sorteerLogboek(voorbeelden),
      bronnen: namen.map((bron) => ({ bron, ok: false, aantal: 0, fout: "Supabase is niet geconfigureerd" })),
      wachtOpOordeel: 0, opgehaaldOp: nu.toISOString(), dagen: LOGBOEK_DAGEN,
    };
  }

  const codeKolommen = "id, licht, redenen, gedetecteerd_op, status, gereageerd_op";
  const [codeLopend, codeRecent, analyses, voorstellen, hypothesen, notities, ...runs] = await Promise.all([
    // Twee lezingen. Een melding die nog loopt (open of geaccepteerd) blijft staan, hoe oud ook;
    // die wordt apart gelezen, zonder venster. Eén query op "de tien nieuwste" liet een oude open
    // melding vallen zodra er tien nieuwere, afgehandelde na kwamen.
    veilig(supabase.from("code_rood_meldingen").select(codeKolommen)
      .eq("client_id", clientId).in("status", ["open", "geaccepteerd"])
      .order("gedetecteerd_op", { ascending: false }).limit(10)),
    veilig(supabase.from("code_rood_meldingen").select(codeKolommen)
      .eq("client_id", clientId).gte("gedetecteerd_op", vanaf)
      .order("gedetecteerd_op", { ascending: false }).limit(10)),
    veilig(supabase.from("generation_jobs")
      .select("job_id, job_type, status, channel, period_start, period_end, completed_at, updated_at, error_message, triggered_by")
      .eq("client_id", clientId).in("status", ["completed", "failed"]).gte("updated_at", vanaf)
      .order("updated_at", { ascending: false }).limit(40)),
    // Alle voorstellen die wachten, ook de oudere: het aantal staat onder het logboek.
    veilig(supabase.from("sprint_hypotheses")
      .select("id, hypothesis, expected_result, measurement_metric, timeframe, rationale, ice_total, source, created_at")
      .eq("client_id", clientId).eq("status", "pending").order("created_at", { ascending: false }).limit(200)),
    veilig(supabase.from("sprint_hypotheses")
      .select("id, hypothesis, expected_result, source, outcome, result_met, learning, evaluated_at")
      .eq("client_id", clientId).gte("evaluated_at", vanaf).order("evaluated_at", { ascending: false }).limit(20)),
    veilig(supabase.from("client_notes")
      .select("id, title, content, created_at, is_todo, done")
      .eq("client_id", clientId).gte("created_at", vanaf).order("created_at", { ascending: false }).limit(20)),
    ...ALLE_KANALEN.map((kanaal) => veilig(supabase.from(RUN_TABEL[kanaal])
      .select(kanaal === "google"
        ? "id, status, started_at, finished_at, total_rows_written, date_range_end, error_summary"
        : "id, status, started_at, finished_at, rows_upserted, error")
      .eq("client_id", clientId).gte("started_at", vanaf).order("started_at", { ascending: false }).limit(120))),
  ]);

  const bron = (naam: LogboekBronNaam, uitkomsten: Uitkomst[], items: LogboekItem[]): { items: LogboekItem[]; bron: LogboekBron } => {
    const fouten = uitkomsten.map((u) => u.fout).filter((f): f is string => f !== null);
    // Pas "niet te lezen" als GEEN van de tabellen van deze bron antwoordde: drie van de vier
    // runtabellen zijn nog steeds drie kanalen waar het logboek iets over kan zeggen.
    const ok = fouten.length < uitkomsten.length;
    return { items, bron: { bron: naam, ok, aantal: items.length, ...(fouten.length > 0 ? { fout: fouten.join("; ") } : {}) } };
  };

  // Een lopende melding binnen het venster komt uit beide lezingen: één keer tellen.
  const codeMeldingen = [...new Map([...codeLopend.rijen, ...codeRecent.rijen].map((r) => [String(r.id), r])).values()];

  const delen = [
    bron("code-rood", [codeLopend, codeRecent], codeRoodItems(codeMeldingen as unknown as CodeRoodRij[], vanaf)),
    bron("sync", runs, ALLE_KANALEN.flatMap((kanaal, i) => syncItems(kanaal, runs[i].rijen.map((r) => alsSyncRun(kanaal, r))))),
    bron("analyses", [analyses], jobItems(analyses.rijen as unknown as JobRij[], vanaf)),
    bron("voorstellen", [voorstellen], voorstelItems(voorstellen.rijen as unknown as HypotheseRij[], vanaf)),
    bron("hypothesen", [hypothesen], hypotheseItems(hypothesen.rijen as unknown as HypotheseRij[], vanaf)),
    bron("notities", [notities], notitieItems(notities.rijen as unknown as NotitieRij[], vanaf)),
  ];

  return {
    items: sorteerLogboek([...delen.flatMap((d) => d.items), ...voorbeelden]),
    bronnen: delen.map((d) => d.bron),
    wachtOpOordeel: voorstellen.rijen.length,
    opgehaaldOp: nu.toISOString(),
    dagen: LOGBOEK_DAGEN,
  };
}
