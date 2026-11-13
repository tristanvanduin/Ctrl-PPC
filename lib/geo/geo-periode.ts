// De kaart per dag: de lezers achter /api/geo als de nieuwe weergave een periode meestuurt.
//
// De vertrouwde weergave leest via resolveGeo (lib/geo/geo-source.ts) een vast venster van 180
// dagen per maand; dat pad is ongewijzigd. Dit bestand is het pad van de nieuwe weergave: exact de
// periode van de kiezer, per dag, per kanaal, en de vergelijkingsperiode als die er is. Wat elk
// kanaal telde en hoe de verandering per land eerlijk blijft, staat in lib/geo/geo-dag.ts.
//
// PER KANAAL, PER NIVEAU
//   google    ads_country_daily / ads_region_daily (migratie 111), met ads_country_monthly /
//             ads_region_monthly voor het deel vóór de eerste dagrij (eerlijk gelabeld)
//   meta      meta_breakdown_daily, level "account", breakdown_type country / region
//   linkedin  linkedin_demographic_daily, level "CAMPAIGN" (som = account), MEMBER_COUNTRY /
//             MEMBER_REGION; de urn naar een landcode (lib/geo/land-namen.ts), een regio-urn via
//             zijn label in linkedin_urn_labels naar een staat
//   microsoft microsoft_breakdown_daily, level "account", breakdown_type country / region
//             ("US-CA"), als de sync die rijen heeft
// Een kanaal zonder landdata wordt genoemd, niet stil weggelaten. Bij "Alle kanalen" alleen de
// kanalen die voor deze klant iets doen: anders stond er bij elke klant "LinkedIn heeft geen
// landdata", ook bij wie nooit op LinkedIn adverteerde.
//
// NOOIT EEN THROW: een tabel die ontbreekt of een lezing die faalt, is een kanaal zonder dagbron
// (Google valt dan helemaal terug op de maanden, met dat in het label).
//
// In demo komen de rijen uit lib/demo/geo-demo.ts (demoGeoDagen), per dag en per kanaal.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isDemoClientValue } from "@/lib/demo/mock-supabase";
import { demoGeoDagen } from "@/lib/demo/geo-demo";
import type { DagPeriode } from "@/lib/period/dag-periode";
import { landcodeUitLinkedInUrn, landcodeUitNaam } from "./land-namen";
import { regionNameToUsps } from "./us-fips";
import {
  eersteDagVan, GEO_DAG_KANALEN, telGeoKanaal,
  type GeoDagKanaal, type GeoDagRij, type GeoKanaalBron, type GeoKanaalTelling,
} from "./geo-dag";
import type { GeoChannel, GeoLevel } from "./geo-source";

const NIVEAUS: GeoLevel[] = ["country", "region"];

export interface GeoPeriodeKanaal {
  kanaal: GeoDagKanaal;
  nu: Record<GeoLevel, GeoKanaalTelling>;
  /** Null zonder vergelijkingsperiode. */
  toen: Record<GeoLevel, GeoKanaalTelling> | null;
}

export interface GeoPeriodeResultaat {
  periode: DagPeriode;
  vergelijking: DagPeriode | null;
  kanalen: GeoPeriodeKanaal[];
}

type Bronlezer = (kanaal: GeoDagKanaal, niveau: GeoLevel, venster: DagPeriode) => Promise<GeoKanaalBron>;

/**
 * Telt de periode en de vergelijkingsperiode per kanaal en niveau uit de bronnen die `lees`
 * levert. Los van de database, zodat de test de hele weg kan lopen met nep-bronnen.
 */
export async function telGeoPeriode(
  kanalen: readonly GeoDagKanaal[],
  periode: DagPeriode,
  vergelijking: DagPeriode | null,
  lees: Bronlezer,
): Promise<GeoPeriodeResultaat> {
  // Eén lezing per kanaal en niveau over beide periodes samen.
  const venster: DagPeriode = vergelijking
    ? { start: vergelijking.start < periode.start ? vergelijking.start : periode.start, eind: vergelijking.eind > periode.eind ? vergelijking.eind : periode.eind }
    : periode;
  const uit: GeoPeriodeKanaal[] = [];
  for (const kanaal of kanalen) {
    const bronnen = await Promise.all(NIVEAUS.map((n) => lees(kanaal, n, venster)));
    const tel = (p: DagPeriode) => Object.fromEntries(NIVEAUS.map((n, i) => [n, telGeoKanaal(p, bronnen[i])])) as Record<GeoLevel, GeoKanaalTelling>;
    uit.push({ kanaal, nu: tel(periode), toen: vergelijking ? tel(vergelijking) : null });
  }
  return { periode, vergelijking, kanalen: uit };
}

export interface ResolveGeoPeriodeArgs {
  clientId: string;
  channel: GeoChannel;
  periode: DagPeriode;
  vergelijking: DagPeriode | null;
}

export async function resolveGeoPeriode({ clientId, channel, periode, vergelijking }: ResolveGeoPeriodeArgs): Promise<GeoPeriodeResultaat> {
  const gevraagd: GeoDagKanaal[] = channel === "blended" ? [...GEO_DAG_KANALEN] : [channel];
  if (isDemoClientValue(clientId)) {
    return telGeoPeriode(gevraagd, periode, vergelijking, async (kanaal, niveau) => {
      // Microsoft heeft in de demo geen landdata: dat hoort de kaart te zeggen.
      const dagen = kanaal === "microsoft" ? [] : demoGeoDagen(kanaal, niveau);
      return { kanaal, dagen, eersteDag: eersteDagVan(dagen) };
    });
  }
  const sb = getSupabaseAdmin();
  if (!sb) return telGeoPeriode(gevraagd, periode, vergelijking, async (kanaal) => ({ kanaal, dagen: null }));
  const kanalen = channel === "blended"
    ? (await Promise.all(gevraagd.map(async (k) => ((await kanaalActief(sb, clientId, k)) ? k : null)))).filter((k): k is GeoDagKanaal => k !== null)
    : gevraagd;
  return telGeoPeriode(kanalen, periode, vergelijking, (kanaal, niveau, venster) =>
    leesBron(sb, clientId, kanaal, niveau, venster).catch(() => ({ kanaal, dagen: null })));
}

// ── De lezers ────────────────────────────────────────────────────────────────

const PAGINA = 1000;
type Antwoord = { data: unknown[] | null; error: { message: string } | null };

/** Alle rijen van een lezing, pagina voor pagina: de database geeft er niet meer dan PAGINA per keer. */
async function allePaginas(maak: (van: number, tot: number) => PromiseLike<Antwoord>): Promise<Record<string, unknown>[] | null> {
  const rijen: Record<string, unknown>[] = [];
  for (let van = 0; ; van += PAGINA) {
    const { data, error } = await maak(van, van + PAGINA - 1);
    if (error) return null;
    rijen.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PAGINA) return rijen;
  }
}

const getal = (v: unknown) => Number(v ?? 0) || 0;
function rij(date: unknown, code: string | null, r: Record<string, unknown>, k: { clicks: string; cost: string; value: string | null; conversions: (r: Record<string, unknown>) => number }): GeoDagRij | null {
  if (!code) return null;
  return {
    date: String(date ?? "").slice(0, 10), code,
    impressions: getal(r.impressions), clicks: getal(r[k.clicks]), cost: getal(r[k.cost]),
    conversions: k.conversions(r), conversionsValue: k.value ? getal(r[k.value]) : 0,
  };
}

/**
 * Vertaalt ruwe rijen; wat niet te vertalen valt, wordt geteld. `buiten(r)`: de rij hoort niet op
 * deze kaart (een regio buiten de VS op de statenkaart) en is dus niet "onbekend": die telt niet mee
 * en wordt ook niet gemeld. Anders stond er in de VS-weergave bij elke Nederlandse provincie van Meta
 * dat er rijen met een onbekende staat waren.
 */
function vertaal(
  ruw: Record<string, unknown>[], f: (r: Record<string, unknown>) => GeoDagRij | null, buiten: (r: Record<string, unknown>) => boolean = () => false,
): { dagen: GeoDagRij[]; onbekend: number } {
  const dagen: GeoDagRij[] = [];
  let onbekend = 0;
  for (const r of ruw) {
    const x = f(r);
    if (x) dagen.push(x); else if (!buiten(r)) onbekend++;
  }
  return { dagen, onbekend };
}

/**
 * Meta: het land als alpha-2, de regio als naam ("California"). Een regio zonder Amerikaanse staat
 * ligt buiten de VS ("North Holland"): Meta geeft er geen land bij, en een staatnaam die
 * regionNameToUsps niet kent bestaat niet (alle 50 plus DC staan erin). Die is dus niet onbekend.
 */
export function metaGeoDagen(ruw: Record<string, unknown>[], niveau: GeoLevel): { dagen: GeoDagRij[]; onbekend: number } {
  const code = (w: unknown) => (niveau === "country" ? landcodeUitNaam(String(w ?? "")) : regionNameToUsps(String(w ?? "")));
  return vertaal(ruw, (r) => rij(r.date, code(r.breakdown_value), r, { clicks: "link_clicks", cost: "spend", value: "conversion_value", conversions: (x) => getal(x.conversions) }),
    () => niveau === "region");
}

async function kanaalActief(sb: SupabaseClient, clientId: string, kanaal: GeoDagKanaal): Promise<boolean> {
  const vraag = kanaal === "google" ? sb.from("ads_account_monthly").select("client_id").eq("client_id", clientId).limit(1)
    : kanaal === "meta" ? sb.from("meta_account_daily").select("client_id").eq("client_id", clientId).limit(1)
    : kanaal === "linkedin" ? sb.from("linkedin_account_daily").select("client_id").eq("client_id", clientId).limit(1)
    : sb.from("microsoft_account_daily").select("client_id").eq("client_id", clientId).limit(1);
  const { data, error } = await vraag;
  return !error && (data ?? []).length > 0;
}

async function leesBron(sb: SupabaseClient, clientId: string, kanaal: GeoDagKanaal, niveau: GeoLevel, v: DagPeriode): Promise<GeoKanaalBron> {
  if (kanaal === "google") return leesGoogle(sb, clientId, niveau, v);
  if (kanaal === "meta") {
    const ruw = await allePaginas((van, tot) => sb.from("meta_breakdown_daily")
      .select("date, breakdown_value, impressions, link_clicks, spend, conversions, conversion_value")
      .eq("client_id", clientId).eq("level", "account").eq("breakdown_type", niveau)
      .gte("date", v.start).lte("date", v.eind).order("date").range(van, tot));
    if (!ruw) return { kanaal, dagen: null };
    return { kanaal, ...metaGeoDagen(ruw, niveau) };
  }
  if (kanaal === "microsoft") {
    const ruw = await allePaginas((van, tot) => sb.from("microsoft_breakdown_daily")
      .select("date, breakdown_value, impressions, clicks, spend, conversions, conversion_value")
      .eq("client_id", clientId).eq("level", "account").eq("breakdown_type", niveau)
      .gte("date", v.start).lte("date", v.eind).order("date").range(van, tot));
    if (!ruw) return { kanaal, dagen: null };
    // Land als alpha-2, staat als "US-CA" (lib/microsoft/transform.ts, naarGeoBreakdownRijen).
    const code = (w: unknown) => {
      const s = String(w ?? "");
      return niveau === "country" ? landcodeUitNaam(s) : s.startsWith("US-") ? s.slice(3) : null;
    };
    return { kanaal, ...vertaal(ruw, (r) => rij(r.date, code(r.breakdown_value), r, { clicks: "clicks", cost: "spend", value: "conversion_value", conversions: (x) => getal(x.conversions) })) };
  }
  // LinkedIn: de som over de campagnes is het accountbeeld; de dekkingsrij ("TOTAL") is geen land.
  const ruw = await allePaginas((van, tot) => sb.from("linkedin_demographic_daily")
    .select("date, pivot_value_urn, impressions, clicks, spend, leads, conversions")
    .eq("client_id", clientId).eq("level", "CAMPAIGN").eq("pivot_type", niveau === "country" ? "MEMBER_COUNTRY" : "MEMBER_REGION")
    .gte("date", v.start).lte("date", v.eind).order("date").range(van, tot));
  if (!ruw) return { kanaal, dagen: null };
  const echt = ruw.filter((r) => r.pivot_value_urn !== "TOTAL");
  let regio = new Map<string, string>();
  const gelabeld = new Set<string>();
  if (niveau === "region") {
    const urns = [...new Set(echt.map((r) => String(r.pivot_value_urn ?? "")).filter(Boolean))];
    const { data } = urns.length ? await sb.from("linkedin_urn_labels").select("urn, label").in("urn", urns) : { data: [] };
    for (const l of (data ?? []) as { urn: string; label: string | null }[]) if (l.label) gelabeld.add(l.urn);
    regio = new Map(((data ?? []) as { urn: string; label: string | null }[])
      .map((l) => [l.urn, regionNameToUsps(String(l.label ?? "").split(",")[0]) ?? ""] as const)
      .filter(([, usps]) => usps !== ""));
  }
  const code = (urn: unknown) => (niveau === "country" ? landcodeUitLinkedInUrn(String(urn ?? "")) : regio.get(String(urn ?? "")) ?? null);
  // Een regio met een label maar zonder Amerikaanse staat ligt buiten de VS; alleen een regio zonder
  // label is echt onbekend.
  return { kanaal, ...vertaal(echt, (r) => rij(r.date, code(r.pivot_value_urn), r, { clicks: "clicks", cost: "spend", value: null, conversions: (x) => getal(x.leads) + getal(x.conversions) }),
    (r) => niveau === "region" && gelabeld.has(String(r.pivot_value_urn ?? ""))) };
}

async function leesGoogle(sb: SupabaseClient, clientId: string, niveau: GeoLevel, v: DagPeriode): Promise<GeoKanaalBron> {
  // De eerste dagrij overall: daar begint de dagopslag, en wat ervoor ligt telt per maand.
  const eerste = niveau === "country"
    ? await sb.from("ads_country_daily").select("date").eq("client_id", clientId).order("date", { ascending: true }).limit(1)
    : await sb.from("ads_region_daily").select("date").eq("client_id", clientId).order("date", { ascending: true }).limit(1);
  const metDagen = !eerste.error;
  const eersteDag = metDagen ? eersteDagVan((eerste.data ?? []) as { date: string }[]) : null;
  const ruw = metDagen && eersteDag
    ? await allePaginas((van, tot) => (niveau === "country"
      ? sb.from("ads_country_daily").select("date, country_code, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId).gte("date", v.start).lte("date", v.eind).order("date").range(van, tot)
      : sb.from("ads_region_daily").select("date, region_code, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId).eq("country_code", "US").gte("date", v.start).lte("date", v.eind).order("date").range(van, tot)))
    : [];
  const k = { clicks: "clicks", cost: "cost", value: "conversions_value", conversions: (x: Record<string, unknown>) => getal(x.conversions) };
  const dagen = ruw === null ? null
    : vertaal(ruw, (r) => rij(r.date, String((niveau === "country" ? r.country_code : r.region_code) ?? "").toUpperCase() || null, r, k)).dagen;

  // De maanden alleen als de periode vóór de eerste dagrij begint (of er geen is): zie
  // splitsOpDagOpslag, die beslist welk deel welke rijen telt.
  let maanden: GeoDagRij[] | null = null;
  if (!eersteDag || v.start < eersteDag) {
    const vanMaand = `${v.start.slice(0, 7)}-01`;
    const totMaand = `${v.eind.slice(0, 7)}-01`;
    const m = niveau === "country"
      ? await sb.from("ads_country_monthly").select("country_code, month, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId).gte("month", vanMaand).lte("month", totMaand)
      : await sb.from("ads_region_monthly").select("region_code, region_name, month, impressions, clicks, cost, conversions, conversions_value")
        .eq("client_id", clientId).eq("country_code", "US").gte("month", vanMaand).lte("month", totMaand);
    maanden = (m.data ?? []).map((r: Record<string, unknown>) => rij(r.month,
      niveau === "country" ? String(r.country_code ?? "").toUpperCase() || null
        : (String(r.region_code ?? "") || regionNameToUsps(String(r.region_name ?? ""))),
      r, k)).filter((x): x is GeoDagRij => x !== null);
  }
  return { kanaal: "google", dagen: eersteDag ? dagen : null, eersteDag, maanden };
}
