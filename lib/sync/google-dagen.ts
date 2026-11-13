// Google per dag: het venster dat de sync ophaalt, en de omzetting naar de dagtabellen van
// migratie 111 (ads_account_daily, ads_campaign_daily, ads_country_daily en ads_region_daily).
//
// WAAROM. Elke periode werkt overal hetzelfde: per dag (zie lib/period/dag-opslag.ts). Google
// levert per dag; wij bewaarden per maand en per week. Nu bewaren we ook per dag, en gooien we
// niets weg: dit is onze eigen geschiedenis, ook als een dag buiten de bewaartermijn van Google
// valt.
//
// DE STAND PER TABEL (google_dag_stand, ook migratie 111). Per klant en per dagtabel: vanaf welke
// dag de opslag loopt (`vanaf`), tot welke dag hij zeker gevuld is (`tot`), en met welke
// conversieselectie. Niet afgeleid uit de laatste rij: een tabel zonder activiteit (geen regio's,
// een account dat stillag) heeft geen rijen, en zou dan elke run opnieuw drie jaar ophalen.
//
// HET VENSTER (googleDagVenster), per tabel.
// - Nog geen stand: de eerste run, zo ver terug als we Google vragen (GOOGLE_DAG_EERSTE_RUN_MAANDEN).
// - Daarna vanaf de dag na `tot`, maar minstens een naloopvenster van GOOGLE_NALOOP_DAGEN: Google
//   schrijft conversies met terugwerkende kracht bij (standaard conversievenster 30 dagen), zoals
//   Meta en Microsoft dat met hun 28 dagen doen (lib/meta/sync-windows.ts).
// - Is de conversieselectie veranderd, dan rekenen de tabellen die ervan afhangen (account en
//   campagne) opnieuw vanaf `vanaf`. Anders hielden dagen buiten de naloop de oude selectie en
//   liepen dagen en maanden uiteen.
//
// PER MAANDSTUK, VAN OUD NAAR NIEUW, MET EEN TIJDBUDGET (syncGoogleDagen). Na elk stuk wordt het
// geschreven en schuift de stand op. Is het budget op, dan stopt de run netjes; de volgende gaat
// verder waar deze stopte. Zo kan een eerste run van drie jaar de gewone sync niet laten vastlopen,
// en begint een afgebroken run niet steeds opnieuw. Mislukt een stuk, dan schuift de stand van die
// tabel niet op: de volgende run probeert hetzelfde stuk opnieuw.
//
// NOOIT WISSEN. De sync schrijft met upsert op de unieke sleutel per dag: een dag binnen het venster
// wordt overschreven, een dag erbuiten blijft staan. Er is geen delete. Een rij met een datum buiten
// het opgehaalde stuk (een API die meer teruggeeft dan gevraagd) wordt niet geschreven: dat is
// geen meting van deze run.
//
// ZONDER TABEL. leesGoogleDagStand leest google_dag_stand. Ontbreekt die (migratie 111 is nog niet
// gedraaid), dan vraagt de sync Google niets per dag, schrijft een logregel en gaat door.
//
// De checkouttrechter per dag (google_ads_checkout_funnel_daily) loopt mee in dezelfde lus, met
// de checkoutkaart uit de instellingen (client_settings.checkout_action_map). Verandert die kaart,
// dan rekent alleen het naloopvenster opnieuw; oudere dagen houden hun oude toewijzing, net als de
// maandtabel google_ads_checkout_funnel.
//
// De omzettingen en de lus (met ingespoten I/O) zijn los getest (__google_dagen_test.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutFunnelRow, GeoPerformanceRow, GoogleAdsCampagneDag, GoogleAdsMetrics } from "@/lib/api/google-ads";
import type { RegioResultaat } from "@/lib/geo/region-rows";
import { isOntbrekendeTabel } from "@/lib/meta/sync";
import { addMonths } from "@/lib/period/period-range";
import { addDays } from "@/lib/reporting-date";
import { monthlyChunks } from "@/lib/meta/sync-windows";

type Rij = Record<string, unknown>;

/** Zo ver haalt de eerste run terug. Google bewaart prestatiecijfers langer; dit begrenst alleen
 *  de eerste run. Wat ouder is, staat al per maand in ads_*_monthly. */
export const GOOGLE_DAG_EERSTE_RUN_MAANDEN = 37;
/** Het naloopvenster voor late conversies, in dagen, t/m de einddatum. */
export const GOOGLE_NALOOP_DAGEN = 30;

export interface DagVenster {
  since: string;
  until: string;
}

/** De dagtabellen die deze sync schrijft, in de volgorde waarin ze per stuk aan de beurt komen. */
export const DAG_TABELLEN = [
  "ads_account_daily", "ads_country_daily", "ads_region_daily", "ads_campaign_daily", "google_ads_checkout_funnel_daily",
] as const;
export type DagTabel = (typeof DAG_TABELLEN)[number];

/** Tabellen waarvan de conversies van de conversieselectie afhangen. */
const MET_SELECTIE: ReadonlySet<DagTabel> = new Set(["ads_account_daily", "ads_campaign_daily"]);

export interface TabelStand {
  /** De eerste dag van de opslag (het begin van de eerste run). */
  vanaf: string;
  /** Tot en met deze dag is de tabel gevuld. */
  tot: string;
  /** De conversieselectie waarmee hij gevuld is ("" = alle conversies). */
  selectie: string;
}

const isDag = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** De conversieselectie als vaste tekst, voor de vergelijking met de stand. */
export function selectieSleutel(ids: readonly string[] | undefined): string {
  return [...new Set(ids ?? [])].sort().join(",");
}

/** Het venster van deze run voor één tabel, en het begin van de opslag. */
export function googleDagVenster(
  stand: TabelStand | null, endDate: string, tabel: DagTabel = "ads_account_daily", selectie = "",
): DagVenster & { vanaf: string; reden: "eerste run" | "naloop" | "selectie gewijzigd" } {
  if (!stand) {
    const eerste = `${addMonths(endDate.slice(0, 7), -(GOOGLE_DAG_EERSTE_RUN_MAANDEN - 1))}-01`;
    return { since: eerste, until: endDate, vanaf: eerste, reden: "eerste run" };
  }
  if (MET_SELECTIE.has(tabel) && stand.selectie !== selectie) {
    return { since: stand.vanaf, until: endDate, vanaf: stand.vanaf, reden: "selectie gewijzigd" };
  }
  const naloop = addDays(endDate, -(GOOGLE_NALOOP_DAGEN - 1));
  const naTot = addDays(stand.tot, 1);
  return { since: naTot < naloop ? naTot : naloop, until: endDate, vanaf: stand.vanaf, reden: "naloop" };
}

const binnen = (d: string, v: { since: string; until: string }) => d >= v.since && d <= v.until;
const getal = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** ads_account_daily: één rij per dag; een dag die twee keer terugkomt telt één keer (de laatste). */
export function accountDagRijen(raw: readonly GoogleAdsMetrics[], clientId: string, venster: DagVenster, nu: string): Rij[] {
  const perDag = new Map<string, Rij>();
  for (const m of raw) {
    if (!isDag(m.date) || !binnen(m.date, venster)) continue;
    perDag.set(m.date, {
      client_id: clientId, date: m.date,
      impressions: getal(m.impressions), clicks: getal(m.clicks), cost: getal(m.cost),
      conversions: getal(m.conversions), conversions_value: getal(m.conversionsValue), synced_at: nu,
    });
  }
  return [...perDag.values()];
}

/** ads_campaign_daily: één rij per campagne per dag. */
export function campagneDagRijen(raw: readonly GoogleAdsCampagneDag[], clientId: string, venster: DagVenster, nu: string): Rij[] {
  const uit = new Map<string, Rij>();
  for (const c of raw) {
    if (!isDag(c.date) || !binnen(c.date, venster) || !c.campaignId) continue;
    uit.set(`${c.date}|${c.campaignId}`, {
      client_id: clientId, date: c.date, campaign_id: c.campaignId, campaign_name: c.campaignName || null,
      campaign_type: c.campaignType || null,
      impressions: getal(c.impressions), clicks: getal(c.clicks), cost: getal(c.cost),
      conversions: getal(c.conversions), conversions_value: getal(c.conversionsValue), synced_at: nu,
    });
  }
  return [...uit.values()];
}

/**
 * ads_country_daily: de campagnerijen van geographic_view opgeteld per dag en land. Rijen zonder
 * landcode (een criterium dat CRITERION_TO_COUNTRY niet kent) vallen af, maar worden geteld: een
 * sync die ze stil weglaat, toont een land als "geen data" terwijl het wel liep.
 */
export function landDagRijen(raw: readonly GeoPerformanceRow[], clientId: string, venster: DagVenster, nu: string): { rijen: Rij[]; zonderLand: number } {
  const som = new Map<string, Rij & { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>();
  let zonderLand = 0;
  for (const g of raw) {
    if (!isDag(g.date) || !binnen(g.date, venster)) continue;
    const land = (g.countryCode || "").toUpperCase();
    if (!land) { zonderLand++; continue; }
    const sleutel = `${g.date}|${land}`;
    const a = som.get(sleutel) ?? { client_id: clientId, date: g.date, country_code: land, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, synced_at: nu };
    a.impressions += getal(g.impressions);
    a.clicks += getal(g.clicks);
    a.cost += getal(g.cost);
    a.conversions += getal(g.conversions);
    a.conversions_value += getal(g.conversionsValue);
    som.set(sleutel, a);
  }
  return { rijen: [...som.values()], zonderLand };
}

/** ads_region_daily: de uitkomst van buildRegionRows op dagrijen (daar draagt `month` de dag). */
export function regioDagRijen(res: RegioResultaat, clientId: string, venster: DagVenster, nu: string): Rij[] {
  return res.rijen
    .filter((r) => isDag(r.month) && binnen(r.month, venster))
    .map((r) => ({
      client_id: clientId, date: r.month, country_code: r.country_code, region_code: r.region_code,
      region_name: r.region_name, impressions: r.impressions, clicks: r.clicks, cost: r.cost,
      conversions: r.conversions, conversions_value: r.conversions_value, synced_at: nu,
    }));
}

/** De conflictsleutels, gelijk aan de unieke sleutels in migratie 111. */
export const DAG_SLEUTELS = {
  ads_account_daily: "client_id,date",
  ads_campaign_daily: "client_id,date,campaign_id",
  ads_country_daily: "client_id,date,country_code",
  ads_region_daily: "client_id,date,country_code,region_code",
  google_ads_checkout_funnel_daily: "client_id,date,campaign_id,device",
} as const;

/** De checkoutstappen per dag, zoals de maandsync ze in google_ads_checkout_funnel schrijft. Alleen
 *  rijen binnen het stuk; dubbele sleutels (campagne, apparaat, dag) worden opgeteld. */
export function checkoutDagRijen(raw: readonly CheckoutFunnelRow[], clientId: string, venster: DagVenster, nu: string): Rij[] {
  const uit = new Map<string, Rij>();
  for (const r of raw) {
    if (!isDag(r.date) || !binnen(r.date, venster)) continue;
    const campaign_id = r.campaignId || "", device = r.device || "UNSPECIFIED";
    const k = `${r.date}|${campaign_id}|${device}`;
    const o = uit.get(k);
    if (o) {
      for (const [kol, v] of [["add_to_cart_count", r.addToCartCount], ["add_to_cart_value", r.addToCartValue], ["begin_checkout_count", r.beginCheckoutCount], ["begin_checkout_value", r.beginCheckoutValue], ["purchase_count", r.purchaseCount], ["purchase_value", r.purchaseValue]] as const) {
        o[kol] = (o[kol] as number) + (Number(v) || 0);
      }
      continue;
    }
    uit.set(k, {
      client_id: clientId, date: r.date, campaign_id, campaign_name: r.campaignName || null, device, sessions: null,
      add_to_cart_count: Number(r.addToCartCount) || 0, add_to_cart_value: Number(r.addToCartValue) || 0,
      begin_checkout_count: Number(r.beginCheckoutCount) || 0, begin_checkout_value: Number(r.beginCheckoutValue) || 0,
      purchase_count: Number(r.purchaseCount) || 0, purchase_value: Number(r.purchaseValue) || 0, synced_at: nu,
    });
  }
  return [...uit.values()];
}

export type DagStand = { ontbreekt: true } | { ontbreekt: false; stand: Map<DagTabel, TabelStand>; fout: string | null };

/**
 * De stand per dagtabel uit google_dag_stand. Ontbreekt die tabel, dan is migratie 111 niet gedraaid
 * en bestaan de dagtabellen ook niet. Een andere fout geeft `fout`: dan is niet te zeggen welk
 * venster nodig is, en slaat de sync de dagen deze run over.
 */
export async function leesGoogleDagStand(supabase: SupabaseClient, clientId: string): Promise<DagStand> {
  const { data, error } = await supabase.from("google_dag_stand").select("tabel, vanaf, tot, conversie_selectie").eq("client_id", clientId);
  if (error) {
    if (isOntbrekendeTabel(error)) return { ontbreekt: true };
    return { ontbreekt: false, stand: new Map(), fout: error.message };
  }
  const stand = new Map<DagTabel, TabelStand>();
  for (const r of (data ?? []) as Rij[]) {
    const tabel = String(r.tabel) as DagTabel;
    const vanaf = String(r.vanaf ?? "").slice(0, 10), tot = String(r.tot ?? "").slice(0, 10);
    if (DAG_TABELLEN.includes(tabel) && isDag(vanaf) && isDag(tot)) {
      stand.set(tabel, { vanaf, tot, selectie: String(r.conversie_selectie ?? "") });
    }
  }
  return { ontbreekt: false, stand, fout: null };
}

/** Wat de lus van buiten nodig heeft: ophalen, schrijven, de stand bewaren en de klok. */
export interface DagSyncIO {
  /** De rijen van één tabel over een stuk, al omgezet; `fout` als het ophalen mislukte. */
  haal(tabel: DagTabel, stuk: DagVenster): Promise<{ rijen: Rij[]; fout: string | null }>;
  /** Upsert; gooit bij een fout. */
  schrijf(tabel: DagTabel, rijen: Rij[]): Promise<number>;
  /** Upsert van de stand; gooit bij een fout. */
  bewaarStand(tabel: DagTabel, stand: TabelStand): Promise<void>;
  nuMs(): number;
}

export interface DagTabelUitkomst {
  name: DagTabel;
  rows: number;
  success: boolean;
  error?: string;
  /** Tot en met deze dag is de tabel na deze run gevuld (null: niets bijgekomen). */
  gevuldTot: string | null;
  /** Het budget was op voordat het venster van deze tabel af was. */
  onaf: boolean;
}

/**
 * De dagsync: per maandstuk, van oud naar nieuw, voor elke tabel waarvan het venster dat stuk
 * raakt. Na elk stuk schrijven en de stand opschuiven; stoppen als het budget op is.
 */
export async function syncGoogleDagen(
  io: DagSyncIO, standen: Map<DagTabel, TabelStand>, endDate: string, selectie: string, budgetMs: number,
): Promise<DagTabelUitkomst[]> {
  const start = io.nuMs();
  const vensters = new Map(DAG_TABELLEN.map((t) => [t, googleDagVenster(standen.get(t) ?? null, endDate, t, selectie)]));
  const uit = new Map<DagTabel, DagTabelUitkomst>(DAG_TABELLEN.map((t) => [t, { name: t, rows: 0, success: true, gevuldTot: null, onaf: false }]));
  const vroegste = [...vensters.values()].map((v) => v.since).sort()[0];
  for (const maand of monthlyChunks(vroegste, endDate)) {
    for (const tabel of DAG_TABELLEN) {
      const v = vensters.get(tabel)!, u = uit.get(tabel)!;
      if (!u.success) continue; // een mislukt stuk: deze tabel deze run niet verder
      const stuk = { since: maand.since < v.since ? v.since : maand.since, until: maand.until };
      if (stuk.since > stuk.until) continue;
      if (io.nuMs() - start > budgetMs) { u.onaf = true; continue; }
      const { rijen, fout } = await io.haal(tabel, stuk);
      if (fout) { u.success = false; u.error = `ophalen mislukt: ${fout}`; continue; }
      try {
        u.rows += await io.schrijf(tabel, rijen.filter((r) => isDag(r.date) && binnen(r.date, stuk)));
        await io.bewaarStand(tabel, { vanaf: v.vanaf, tot: stuk.until, selectie: MET_SELECTIE.has(tabel) ? selectie : "" });
        u.gevuldTot = stuk.until;
      } catch (e) {
        u.success = false;
        u.error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return [...uit.values()];
}
