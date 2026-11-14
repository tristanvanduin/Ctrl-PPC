// De kaart per dag in de demo: dezelfde kanaaltotalen als de kerncijfers op de pagina, verdeeld over
// de landen met de vaste aandelen van de mock (lib/demo/geo-demo.ts).
//
// WAAROM. De pagina van de demo leest via /api/data de geseede database: Meta begint daar pas in juni
// 2026, Google heeft geen dagrijen (migratie 111) en telt per week of maand. De kaart kreeg in de
// demo mockcijfers voor elke dag van twee jaar, ook voor Meta en LinkedIn in een periode waarin die
// volgens de rest van de pagina nog niet liepen. Twee bronnen op één pagina die elkaar tegenspreken.
//
// HOE. De rijen die de pagina leest (dezelfde tabellen, dezelfde laadgrens, dezelfde
// conversieselectie) gaan door dezelfde telling als de kerncijfers (telDagPeriode in
// lib/period/dag-telling.ts). Alleen de verdeling over de landen komt uit de mock: per kanaal de
// aandelen van elk land in de vertoningen, klikken, kosten, conversies en omzet van zijn profiel
// (demoGeoCountries), en de staten binnen het deel van de VS (demoGeoStates). Per kanaal telt de
// kaart dus exact op tot het totaal in de kerncijfers.
//
// Een kanaal dat in de periode nog niet liep, heeft daar geen landcijfers en wordt genoemd, met de
// regel van de trechter (nogNietGelopen). Microsoft heeft in de mock geen landprofiel: dat zegt de
// kaart, zoals voorheen.
//
// DE GRENS. Dit wordt alleen aangeroepen voor de demoklant (resolveGeoPeriode, isDemoClientValue,
// dezelfde vraag als lib/demo/server-supabase.ts). Buiten de demo leest de kaart de echte landtabellen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { demoGeoCountries, demoGeoStates, type GeoAgg } from "./geo-demo";
import { seededDemoClientData } from "./geoclone-demo-data";
import { splitInt } from "./split";
import { googleDataUitAntwoord } from "@/lib/api/adapter";
import { fetchBlendedHistoricalData } from "@/lib/api/blended-historical";
import { alleRijen } from "@/lib/analysis/db-veilig";
import { resolveChannelConversionConfig, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { KANAAL_NAAM } from "@/lib/kanalen/beschikbaar";
import { tellersPerMaand } from "@/lib/overzicht/trechter";
import { kanaalDagbron, MAANDEN_TERUG, NIET_GOOGLE } from "@/lib/period/kanaal-maanden";
import {
  nogNietGelopen, telDagPeriode,
  type DagTelInvoer, type DagTelling, type GoogleDagRij, type GoogleWeekRij, type KanaalTelling,
} from "@/lib/period/dag-telling";
import { formatDagPeriode, type DagPeriode } from "@/lib/period/dag-periode";
import { monthsAgo } from "@/lib/reporting-date";
import type { GeoDagKanaal, GeoKanaalTelling } from "@/lib/geo/geo-dag";
import type { GeoLevel } from "@/lib/geo/geo-source";
import type { GeoPeriodeResultaat } from "@/lib/geo/geo-periode";

type Metriek = "impressions" | "clicks" | "cost" | "conversions" | "conversionsValue";
const METRIEKEN: readonly Metriek[] = ["impressions", "clicks", "cost", "conversions", "conversionsValue"];
type Totaal = Omit<GeoAgg, "code">;

/**
 * Verdeelt een totaal over gewichten; de som van de delen is exact het totaal. Een geheel getal
 * met de grootste rest (splitInt, zoals de rest van de demo); een bedrag naar verhouding, met het
 * afrondingsverschil bij het grootste deel. Zonder gewichten (alles nul) de reservegewichten.
 */
function verdeel(totaal: number, gewichten: readonly number[], reserve: readonly number[]): number[] {
  const g = gewichten.some((w) => w > 0) ? gewichten : reserve;
  if (!g.length || !g.some((w) => w > 0)) return g.map(() => 0);
  if (Number.isInteger(totaal)) return splitInt(totaal, [...g]);
  const som = g.reduce((s, w) => s + w, 0);
  const delen = g.map((w) => (totaal * w) / som);
  const grootste = g.indexOf(Math.max(...g));
  delen[grootste] += totaal - delen.reduce((s, x) => s + x, 0);
  return delen;
}

/** Een totaal over de codes van een profiel, per metriek met de aandelen van dat profiel. */
export function verdeelOverProfiel(totaal: Totaal, profiel: readonly GeoAgg[]): GeoAgg[] {
  const reserve = profiel.map((p) => p.cost);
  const perMetriek = Object.fromEntries(METRIEKEN.map((m) => [m, verdeel(totaal[m], profiel.map((p) => p[m]), reserve)])) as Record<Metriek, number[]>;
  return profiel.map((p, i) => ({
    code: p.code,
    impressions: perMetriek.impressions[i], clicks: perMetriek.clicks[i], cost: perMetriek.cost[i],
    conversions: perMetriek.conversions[i], conversionsValue: perMetriek.conversionsValue[i],
  }));
}

/**
 * Wat één kanaal in de demo op de kaart telt: zijn telling uit de kerncijfers, verdeeld over de
 * landen (of over de staten binnen het deel van de VS). Zuiver, zodat de test het ziet.
 */
export function demoGeoUitTelling(kanaal: GeoDagKanaal, t: KanaalTelling | null, niveau: GeoLevel): GeoKanaalTelling {
  const naam = KANAAL_NAAM[kanaal];
  const leeg = (opmerking: string): GeoKanaalTelling => ({ kanaal, rows: [], label: null, exact: true, opmerking });
  if (kanaal === "microsoft" || !t) return leeg(`${naam} heeft geen landdata.`);
  const niet = nogNietGelopen(t);
  if (niet) return leeg(niet);
  const niets = !t.totalen.conversions && !t.totalen.revenue && !t.totalen.adSpend && !t.tellers?.impressions && !t.tellers?.clicks;
  if (!t.bronStart && niets) return leeg(`${naam} heeft geen landdata.`);
  // Zonder vertoningen en klikken (de maandtellers van de blended route ontbreken) geen landcijfers:
  // een 0 op de kaart leest als een gemeten nul, en de kaart telt de kanalen per land op.
  if (t.tellers === null) {
    return leeg(`De vertoningen en klikken van ${naam} zijn voor deze periode niet bekend; ${naam} staat daarom niet op de kaart.`);
  }

  const totaal: Totaal = {
    impressions: t.tellers.impressions, clicks: t.tellers.clicks,
    cost: t.totalen.adSpend, conversions: t.totalen.conversions, conversionsValue: t.totalen.revenue,
  };
  const landen = verdeelOverProfiel(totaal, demoGeoCountries(kanaal));
  const vs = landen.find((l) => l.code === "US");
  const rows = niveau === "country" ? landen : vs ? verdeelOverProfiel(vs, demoGeoStates(kanaal)) : [];

  const label = t.venster
    ?? (t.wijktAf && t.geteld && t.fijnheid === "week" ? `per week geteld, ${formatDagPeriode(t.geteld)}` : null);
  const opmerkingen: string[] = [];
  if (!label && t.wijktAf && t.uitleg) opmerkingen.push(t.uitleg);
  return { kanaal, rows, label, exact: t.exact !== false, opmerking: opmerkingen.length ? opmerkingen.join(" ") : null };
}

const NIVEAUS: GeoLevel[] = ["country", "region"];

/**
 * De kaart per dag in de demo, uit dezelfde invoer als de kerncijfers. Zelfde vorm als
 * telGeoPeriode (lib/geo/geo-periode.ts), dus dezelfde regels en dezelfde vergelijking per land.
 */
export function demoGeoPeriode(
  kanalen: readonly GeoDagKanaal[],
  periode: DagPeriode,
  vergelijking: DagPeriode | null,
  invoer: DagTelInvoer,
): GeoPeriodeResultaat {
  const nu = telDagPeriode(periode, invoer);
  const toen = vergelijking ? telDagPeriode(vergelijking, invoer) : null;
  const perNiveau = (telling: DagTelling, k: GeoDagKanaal) => {
    const t = telling.perKanaal.find((x) => x.kanaal === k) ?? null;
    return Object.fromEntries(NIVEAUS.map((n) => [n, demoGeoUitTelling(k, t, n)])) as Record<GeoLevel, GeoKanaalTelling>;
  };
  return {
    periode, vergelijking,
    kanalen: kanalen.map((kanaal) => ({ kanaal, nu: perNiveau(nu, kanaal), toen: toen ? perNiveau(toen, kanaal) : null })),
  };
}

// ── De lezer: dezelfde rijen als de pagina ───────────────────────────────────

/** De klant-id zoals de rijen hem hebben: zonder het voorvoegsel "gads-". */
const demoId = (clientId: string): string => clientId.replace(/^gads-/, "");

/** Een lezing die mislukt (een tabel die ontbreekt), is een bron zonder rijen: null, geen throw. */
async function ofNull<T>(lezing: () => Promise<T>): Promise<T | null> {
  try { return await lezing(); } catch { return null; }
}

/**
 * De invoer van de kerncijfers zoals de pagina hem leest (lib/period/use-dag-telling.ts):
 * - de dagrijen van Meta, LinkedIn en Microsoft vanaf MAANDEN_TERUG maanden terug (fetchKanaalRijen);
 * - van Google de dagrijen (ads_account_daily; null als de tabel er niet is), de weekrijen (de
 *   nieuwste 1000, zoals laadWeken), de maandreeks uit /api/google-ads/client-data voor de demo
 *   (seededDemoClientData, googleDataUitAntwoord) en de vertoningen en klikken per maand uit de
 *   blended route (fetchBlendedHistoricalData, tellersPerMaand);
 * - de conversieselectie uit client_settings.
 *
 * De id zonder het voorvoegsel "gads-" (dat isDemoClientValue ook accepteert), zoals
 * seededDemoClientData hem leest: anders kreeg de kaart wel de Google-maanden maar geen dag- of
 * weekrijen, en week hij af van de kerncijfers.
 */
export async function laadDemoGeoInvoer(sb: SupabaseClient, ruweId: string): Promise<DagTelInvoer> {
  const clientId = demoId(ruweId);
  const vanaf = monthsAgo(MAANDEN_TERUG);
  const [instelling, dagkanalen, weken, dagen, maanden, blended] = await Promise.all([
    ofNull(async () => {
      const { data, error } = await sb.from("client_settings").select("channel_conversion_config").eq("client_id", clientId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { channel_conversion_config?: unknown } | null)?.channel_conversion_config ?? null;
    }),
    Promise.all(NIET_GOOGLE.map((k) => ofNull(async () => {
      const bron = kanaalDagbron(k);
      const { rijen } = await alleRijen<Record<string, unknown>>((van, tot) => sb.from(bron.table)
        .select(bron.select).eq("client_id", clientId).gte("date", vanaf)
        .order("date").range(van, tot) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
      `${bron.table} (kaart demo)`);
      return rijen;
    }))),
    ofNull(async () => {
      const { data, error } = await sb.from("ads_account_weekly")
        .select("week_start,impressions,clicks,cost,conversions,conversions_value").eq("client_id", clientId)
        .order("week_start", { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as GoogleWeekRij[];
    }),
    ofNull(async () => (await alleRijen<GoogleDagRij>((van, tot) => sb.from("ads_account_daily")
      .select("date,impressions,clicks,cost,conversions,conversions_value").eq("client_id", clientId)
      .order("date").range(van, tot) as unknown as PromiseLike<{ data: GoogleDagRij[] | null; error: { message: string } | null }>,
    "ads_account_daily (kaart demo)")).rijen),
    ofNull(async () => googleDataUitAntwoord(clientId, await seededDemoClientData(sb, clientId))),
    ofNull(() => fetchBlendedHistoricalData(sb, clientId)),
  ]);
  const google = blended?.perKanaal.find((r) => r.kanaal === "google");
  const convConfig: ChannelConversionConfig = resolveChannelConversionConfig((instelling ?? null) as Partial<ChannelConversionConfig> | null);
  return {
    google: maanden || weken || dagen ? { maanden, weken, dagen, maandTellers: tellersPerMaand(google?.maanden) } : null,
    dagkanalen: Object.fromEntries(NIET_GOOGLE.map((k, i) => [k, dagkanalen[i]]).filter(([, r]) => r !== null)),
    convConfig,
  };
}

// Eén lezing per klant per minuut: een andere periode of vergelijking is rekenwerk, geen verzoek.
const BEWAAR_MS = 60_000;
const bewaard = new Map<string, { tijd: number; invoer: Promise<DagTelInvoer> }>();

/** laadDemoGeoInvoer met een korte bewaring per klant. Een mislukte lezing wordt niet bewaard. */
export function demoGeoInvoer(sb: SupabaseClient, ruweId: string): Promise<DagTelInvoer> {
  const clientId = demoId(ruweId);
  const er = bewaard.get(clientId);
  if (er && Date.now() - er.tijd < BEWAAR_MS) return er.invoer;
  const invoer = laadDemoGeoInvoer(sb, clientId);
  invoer.catch(() => bewaard.delete(clientId));
  bewaard.set(clientId, { tijd: Date.now(), invoer });
  return invoer;
}
