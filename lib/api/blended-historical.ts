import type { SupabaseClient } from "@supabase/supabase-js";
import { klantVanId } from "../tenancy/klanten";
import { today } from "../reporting-date";
import type { ApiMonthlyData, YearDataInput } from "./adapter";
import type { ClientAnnualData } from "../types";
import type { Kanaal } from "../kanalen/beschikbaar";
import { standaardJaardoel } from "@/lib/analysis/standaard-jaardoel";
import {
  resolveChannelConversionConfig,
  type ChannelConversionChannel,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { KANAAL_DAGBRON, dagbronSelect, kanaalMaandenUitDagen } from "@/lib/analysis/channel-report-blend";
import { alleRijen, eis, DataLaagFout } from "@/lib/analysis/db-veilig";
import { eersteDagUitRijen, eersteVolleMaand, startLaatsteLoopUitRijen } from "@/lib/period/kanaal-maanden";
import {
  datastandVoorKlant,
  dagstandVoorKlant,
  dataTotVanDagbron,
  dataTotVanMaandbron,
  gezamenlijkeDataTot,
  remtNietBijAchterstand,
  volleMaand,
  type DataStandSamen,
  type Dagkanaal,
} from "@/lib/sync/datastand";

/**
 * Blended (Google + Meta + LinkedIn + Microsoft) equivalent van app/api/google-ads/client-data/
 * route.ts's jaren-historie -- voor het Jaaroverzicht, de Prognose-tabel en de Pacing op "Alle
 * kanalen" (feedback 22 augustus: "ik wil daadwerkelijk alle kanalen ook die tabel krijgt met
 * gecombineerde data"). Meta/LinkedIn hebben geen meerjarige historie om een seizoenscorrectie op
 * te baseren, maar dat blokkeert alleen de INTERPRETATIE van vroege maanden, niet de DATA:
 * computeMonthlyExpected in lib/forecast.ts negeert een jaar/maand toch al zodra de waarde 0 is
 * (mv > 0), dus een periode voordat Meta/LinkedIn liepen levert gewoon Google's eigen totaal op.
 *
 * BRONNEN (sinds 1 november 2026)
 *
 * - Google: fact_core, level='account', grain='month'. Daar is de conversieselectie van de klant
 *   al bij de sync toegepast (client_settings.conversion_actions).
 * - Meta, LinkedIn en Microsoft: de dagtabellen, via kanaalMaandenUitDagen met de opgeslagen
 *   conversieselectie van de klant -- dezelfde functie als de KPI-band in de browser.
 *
 * Dit las eerder ook Meta en LinkedIn uit fact_core-maand. Dat gaf drie verschillen met de
 * KPI-band erboven: fact_core bakt de STANDAARDselectie in (migratie 054/078), dus een klant die
 * in Instellingen iets anders koos zag twee conversietellingen; er stonden maandrollups zonder
 * dagrijen eronder (de demo-februari 2026: 152 conversies en € 4.750 die nergens anders bestonden);
 * en Microsoft heeft geen fact_core-projectie (migratie 106), dus telde hier nooit mee.
 *
 * TOT WELKE MAAND
 *
 * realizedThroughMonth en `dataStand` komen uit volleMaand over de vroegste dataTot van de
 * kanalen (gezamenlijkeDataTot): een maand telt pas als gerealiseerd als ELK kanaal hem volledig
 * gemeten heeft. Eerder was dat "de hoogste maand met een rij vóór de lopende UTC-maand", en dan
 * telde een sync die op 26 augustus stopte augustus als volle maand, terwijl september en oktober
 * als toekomst werden geprojecteerd.
 */

interface FactCoreMaandRij {
  period_start: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  conversions: number | null;
  conv_value: number | null;
}

interface MaandTotaal {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  convValue: number;
}

/** Eén maand van één kanaal, "YYYY-MM". Onafgerond: de afronding hoort bij de weergave. */
export interface BlendedKanaalMaand {
  month: string;
  conversions: number;
  revenue: number;
  adSpend: number;
}

/**
 * Eén kanaal als maandreeks. ALLE maanden met data, ook een partiële laatste maand: welk venster
 * telt, zegt `dataStand`, en dat bepaalt de lezer (de Pacing vergelijkt t/m
 * dataStand.laatsteVolleMaand). Zo kan een lezer per kanaal paren (gepaardeTotalen) in plaats van
 * op de optelling, waar een kanaal dat vorig jaar nog niet liep als groei leest.
 */
export interface BlendedKanaalReeks {
  kanaal: Kanaal;
  /**
   * De eerste VOLLE maand (eersteVolleMaand in lib/period/kanaal-maanden.ts) voor een dagkanaal
   * waarvan de eerste rij niet op de 1e valt; null voor Google, een maandbron zonder dagen (de
   * eerste maand met data is dan de start, zoals gepaardeTotalen die zelf bepaalt). De partiële
   * maand staat gewoon in `maanden`: hij telt in de totalen, alleen niet als paar.
   */
  vanaf: string | null;
  /**
   * De eerste dag van de huidige loop van een dagkanaal (startLaatsteLoopUitRijen: na een pauze van
   * een hele maand de dag waarop het terugkwam, anders de eerste dag ooit); null voor Google. Voor
   * het tempo zonder jaardoel als die partiële maand de laatste gerealiseerde is (forecastCoreMetric).
   * Optioneel: een antwoord van vóór dit veld werkt als voorheen.
   */
  eersteDag?: string | null;
  maanden: BlendedKanaalMaand[];
}

export interface BlendedHistoricalData {
  currentYear: number;
  realizedThroughMonth: number;
  targetCurrentYear: ClientAnnualData;
  historicalYears: YearDataInput[];
  /** Alleen de maanden t/m realizedThroughMonth: een partiële maand telt niet als gerealiseerd. */
  currentYearMonthly: ApiMonthlyData[];
  /** Tot waar de data over alle kanalen samen vol is; null als geen enkel kanaal een datum heeft. */
  dataStand: DataStandSamen | null;
  perKanaal: BlendedKanaalReeks[];
}

const DAGKANALEN: { kanaal: Dagkanaal; channel: ChannelConversionChannel }[] = [
  { kanaal: "meta", channel: "meta_ads" },
  { kanaal: "linkedin", channel: "linkedin_ads" },
  { kanaal: "microsoft", channel: "microsoft_ads" },
];

function naarApiMonthlyData(maand: number, t: MaandTotaal): ApiMonthlyData {
  return {
    month: maand,
    conversions: Math.round(t.conversions),
    revenue: Math.round(t.convValue),
    adSpend: Math.round(t.cost),
    impressions: t.impressions,
    clicks: t.clicks,
    ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
    avgCpc: t.clicks > 0 ? t.cost / t.clicks : 0,
    conversionRate: t.clicks > 0 ? t.conversions / t.clicks : 0,
  };
}

type DagUitkomst = { data: Record<string, unknown>[] | null; error: { message: string } | null };

/** Rij-vorm die beide bronnen delen: Google uit fact_core, de rest uit kanaalMaandenUitDagen. */
interface KanaalMaandRij {
  kanaal: Kanaal;
  month: string; // "YYYY-MM"
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

/**
 * Haalt de blended jaren-/maandhistorie op voor "Alle kanalen". Null als de klant geen account
 * heeft of op geen enkel kanaal data draagt. Een databasefout gooit DataLaagFout (de route maakt
 * er een 500 van die de bron noemt) in plaats van als "geen data" te lezen.
 *
 * @param nu vandaag als "YYYY-MM-DD", standaard today() (Amsterdam); alleen tests zetten hem.
 */
export async function fetchBlendedHistoricalData(
  supabase: SupabaseClient,
  clientId: string,
  nu: string = today(),
): Promise<BlendedHistoricalData | null> {
  const klant = await klantVanId(supabase, clientId);
  if (!klant) return null;

  const [googleRes, settingsRes, dagRes] = await Promise.all([
    supabase.from("fact_core")
      .select("period_start, impressions, clicks, cost, conversions, conv_value")
      .eq("account_id", klant.id)
      .eq("channel", "google")
      .eq("level", "account")
      .eq("grain", "month")
      .order("period_start"),
    supabase.from("client_settings").select("channel_conversion_config").eq("client_id", clientId).maybeSingle(),
    Promise.all(DAGKANALEN.map(({ channel }) => alleRijen<Record<string, unknown>>(
      // De select-lijst komt uit een functie, dus de clienttypes kunnen de rijvorm niet afleiden;
      // alleen een typecast, de rijen zelf gaan ongewijzigd door.
      (van, tot) => supabase.from(KANAAL_DAGBRON[channel].table)
        .select(dagbronSelect(channel))
        .eq("client_id", clientId)
        .order("date")
        // Tweede sorteersleutel: anders ligt de volgorde bij gelijke datums niet vast (KANAAL_DAGBRON).
        .order(KANAAL_DAGBRON[channel].entityField)
        .range(van, tot) as unknown as PromiseLike<DagUitkomst>,
      `${KANAAL_DAGBRON[channel].table} (blended)`,
    ))),
  ]);

  // Zonder de opgeslagen selectie zou hier stil de standaard gelden, en dan telt het Jaaroverzicht
  // andere conversies dan de KPI-band: precies het verschil dat deze bron moet wegnemen.
  if (settingsRes.error) throw new DataLaagFout("client_settings (blended)", settingsRes.error.message);
  const opgeslagen = (settingsRes.data as { channel_conversion_config?: unknown } | null)?.channel_conversion_config ?? null;
  const convConfig: ChannelConversionConfig = resolveChannelConversionConfig(opgeslagen as Partial<ChannelConversionConfig> | null);

  const googleRijen = eis(googleRes, "fact_core google (blended)") as FactCoreMaandRij[];
  const rows: KanaalMaandRij[] = googleRijen.map((r) => ({
    kanaal: "google",
    month: String(r.period_start).slice(0, 7),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversionsValue: Number(r.conv_value ?? 0),
  }));
  const laatsteDagUitRijen: Partial<Record<Dagkanaal, string>> = {};
  const vanafPerKanaal: Partial<Record<Dagkanaal, string | null>> = {};
  const eersteDagPerKanaal: Partial<Record<Dagkanaal, string | null>> = {};
  DAGKANALEN.forEach(({ kanaal, channel }, i) => {
    const { rijen, afgekapt } = dagRes[i];
    if (afgekapt) {
      // Liever een totaal dat te laag is mét een spoor dan een stil afgekapt totaal.
      console.warn(`[blended-historical] ${KANAAL_DAGBRON[channel].table} voor ${clientId} afgekapt op ${rijen.length} rijen`);
    }
    for (const m of kanaalMaandenUitDagen(rijen, channel, convConfig)) {
      rows.push({
        kanaal,
        month: String(m.month).slice(0, 7),
        impressions: m.impressions,
        clicks: m.clicks,
        cost: m.cost,
        conversions: m.conversions,
        conversionsValue: m.conversions_value,
      });
    }
    const laatste = rijen.map((r) => String(r.date ?? "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
    if (laatste) laatsteDagUitRijen[kanaal] = laatste;
    // Alle rijen van het kanaal (alleRijen, vanaf het begin), dus de eerste rij is echt de start.
    // `vanaf` blijft op die start (anders valt de historie van vóór een pauze weg); de eerste dag
    // voor het tempo is die van de huidige loop, na een pauze van een hele maand (startLaatsteLoop).
    vanafPerKanaal[kanaal] = eersteVolleMaand(eersteDagUitRijen(rijen, channel));
    eersteDagPerKanaal[kanaal] = startLaatsteLoopUitRijen(rijen, channel);
  });
  if (rows.length === 0) return null;

  // Optellen per (jaar, maand) -- meerdere kanalen kunnen dezelfde maand dragen.
  const perJaarMaand = new Map<number, Map<number, MaandTotaal>>();
  for (const r of rows) {
    const jaar = parseInt(r.month.slice(0, 4), 10);
    const maand = parseInt(r.month.slice(5, 7), 10);
    if (!perJaarMaand.has(jaar)) perJaarMaand.set(jaar, new Map());
    const maanden = perJaarMaand.get(jaar)!;
    const b = maanden.get(maand) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 };
    maanden.set(maand, {
      impressions: b.impressions + r.impressions,
      clicks: b.clicks + r.clicks,
      cost: b.cost + r.cost,
      conversions: b.conversions + r.conversions,
      convValue: b.convValue + r.conversionsValue,
    });
  }

  const perKanaal: BlendedKanaalReeks[] = [];
  for (const kanaal of ["google", "meta", "linkedin", "microsoft"] as const) {
    const maanden = new Map<string, BlendedKanaalMaand>();
    for (const r of rows) {
      if (r.kanaal !== kanaal) continue;
      const b = maanden.get(r.month) ?? { month: r.month, conversions: 0, revenue: 0, adSpend: 0 };
      b.conversions += r.conversions;
      b.revenue += r.conversionsValue;
      b.adSpend += r.cost;
      maanden.set(r.month, b);
    }
    if (maanden.size === 0) continue;
    perKanaal.push({
      kanaal,
      vanaf: kanaal === "google" ? null : vanafPerKanaal[kanaal] ?? null,
      eersteDag: kanaal === "google" ? null : eersteDagPerKanaal[kanaal] ?? null,
      maanden: [...maanden.values()].sort((a, b) => a.month.localeCompare(b.month)),
    });
  }

  // Amsterdams jaar (zelfde reden als in de Google-route: new Date().getFullYear() draait in
  // UTC op de server, en zou op oudejaarsavond na 23:00 lokale tijd een jaar mis grijpen).
  const currentYear = Number(nu.slice(0, 4));

  const historicalYears: YearDataInput[] = [];
  for (const [jaar, maanden] of perJaarMaand) {
    if (jaar >= currentYear) continue;
    const monthly = Array.from(maanden.entries())
      .map(([m, t]) => naarApiMonthlyData(m, t))
      .filter((m) => m.conversions > 0 || m.adSpend > 0);
    if (monthly.length > 0) historicalYears.push({ year: jaar, monthly, weekly: [] });
  }
  historicalYears.sort((a, b) => a.year - b.year);

  const dataStand = await blendedDataStand(supabase, clientId, nu, perKanaal, laatsteDagUitRijen);
  const vol = dataStand?.laatsteVolleMaand ?? null;
  const realizedThroughMonth = vol === null || Number(vol.slice(0, 4)) < currentYear ? 0 : Number(vol.slice(5, 7));

  const huidigeMaanden = perJaarMaand.get(currentYear) ?? new Map<number, MaandTotaal>();
  // Gefilterd, zodat de forecast (laatste niet-lege maand) dezelfde grens ziet als hier staat.
  const currentYearMonthly = Array.from(huidigeMaanden.entries())
    .map(([m, t]) => naarApiMonthlyData(m, t))
    .filter((m) => m.month <= realizedThroughMonth)
    .sort((a, b) => a.month - b.month);

  // De gedeelde terugval (lib/analysis/standaard-jaardoel.ts): vorig jaar plus groei zolang er geen
  // doel is ingevoerd. De echte klant-KPI-doelen (Instellingen) overschrijven dit toch via
  // lib/kpi-target-merge.ts.
  //
  // Wat dit standaarddoel nu dekt: de optelling van ALLE kanalen over het laatste historische jaar,
  // ook een kanaal dat dat jaar maar deels liep, en geen kanaal dat pas dit jaar begon. Bij de demo
  // is dat Google over heel 2025 plus Microsoft vanaf 23 juli 2025 (een deeljaar dat met een
  // partiële maand begint), zonder Meta en LinkedIn. Sinds Microsoft uit de dagtabel meetelt, ligt
  // het daardoor zo'n 30% hoger dan het Google-only doel van eerder (omzet € 282.062 -> € 365.334).
  // De regel zelf is niet veranderd; zijn invoer wel. "Het laatst volledige jaar" uit
  // standaard-jaardoel.ts is het dus per kanaal niet.
  //
  // Welke regel er hoort bij een vorig jaar met een andere kanaalmix (alleen kanalen met een vol
  // vorig jaar, elk nieuw kanaal op zijn eigen prognose erbij, of geen standaarddoel) is een open
  // beslissing voor de eigenaar; tot die valt blijft deze staan. De blended prognose hangt er niet
  // van af: die is de som van de prognoses per kanaal (lib/forecast-som.ts), en een doel schaalt
  // alleen de verwachtingslijn.
  const laatsteJaar = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1] : null;

  return {
    currentYear,
    realizedThroughMonth,
    targetCurrentYear: standaardJaardoel(laatsteJaar === null ? null : {
      conversions: laatsteJaar.monthly.reduce((s, m) => s + m.conversions, 0),
      revenue: laatsteJaar.monthly.reduce((s, m) => s + m.revenue, 0),
      adSpend: laatsteJaar.monthly.reduce((s, m) => s + m.adSpend, 0),
    }),
    historicalYears,
    currentYearMonthly,
    dataStand,
    perKanaal,
  };
}

/**
 * De gezamenlijke datastand van de kanalen die hier data hebben. Per kanaal de bestaande lezer
 * (datastandVoorKlant voor Google, dagstandVoorKlant voor de dagkanalen), omdat die ook weten of
 * de sync draait: een gepauzeerd account met een gezonde sync heeft echte nullen en mag de rest
 * niet afremmen.
 *
 * "Mag niet remmen" geldt alleen voor een kanaal dat ACHTERloopt terwijl de sync draait. De
 * lezers zetten syncDraait ook bij een kanaal dat gewoon actueel is (recente sync, recente data),
 * en gezamenlijkeDataTot laat alle bronnen weer remmen zodra ze allemaal "stil" zijn. Een actuele
 * Google naast een gepauzeerde LinkedIn gaf dan het venster van LinkedIn: maart in plaats van
 * oktober. Een actueel kanaal remt daarom gewoon mee; het staat toch al op de nieuwste dag.
 *
 * Faalt zo'n lezer, dan valt het kanaal terug op zijn eigen rijen (de nieuwste dag, of voor
 * Google het eind van de nieuwste maand) in plaats van uit de rem te verdwijnen: een kanaal dat
 * niet meetelt voor de stand, laat zijn ontbrekende maanden als nul lezen.
 *
 * Twee aanvullingen voor de dagkanalen (review [9], [10], [36]):
 * - dataTot is dataTotVanDagbron: na een geslaagde sync is de dag vóór die sync gemeten, ook zonder
 *   rij, en dat blijft zo als die sync ouder wordt. Een Microsoft zonder levering op zaterdag 31 oktober maakte oktober anders partieel.
 *   De rij van de syncdag zelf telt niet: de nachtcron haalt t/m zijn eigen dag op, dus die rij is een deel van die dag.
 * - Een kanaal zonder koppeling (geen rij, of uitgezet via Instellingen) remt niet: het synct nooit
 *   meer, dus de rem zou wachten op data die niet komt, zolang de oude rijen er staan. Het staat dan
 *   in `uitgesloten`, en de band noemt het.
 *
 * De lezers krijgen `nu` mee, zodat de syncbeoordeling dezelfde peildag heeft als volleMaand.
 */
async function blendedDataStand(
  supabase: SupabaseClient,
  clientId: string,
  nu: string,
  perKanaal: BlendedKanaalReeks[],
  laatsteDagUitRijen: Partial<Record<Dagkanaal, string>>,
): Promise<DataStandSamen | null> {
  const metData = new Set(perKanaal.map((k) => k.kanaal));
  const googleMaanden = perKanaal.find((k) => k.kanaal === "google")?.maanden ?? [];
  const laatsteGoogleMaand = googleMaanden.length > 0 ? googleMaanden[googleMaanden.length - 1].month : null;

  const bronnen = await Promise.all([
    ...(metData.has("google")
      ? [datastandVoorKlant(supabase, clientId, nu).then(
          (s) => ({
            bron: "google",
            dataTot: dataTotVanMaandbron(s.laatsteMaand ?? laatsteGoogleMaand, s.laatsteGeslaagdeSync),
            syncDraait: remtNietBijAchterstand(s),
          }),
          () => ({ bron: "google", dataTot: dataTotVanMaandbron(laatsteGoogleMaand, null), syncDraait: false }),
        )]
      : []),
    ...DAGKANALEN.filter(({ kanaal }) => metData.has(kanaal)).map(({ kanaal }) =>
      dagstandVoorKlant(supabase, clientId, kanaal, nu).then(
        (s) => ({
          bron: kanaal,
          dataTot: dataTotVanDagbron(s) ?? laatsteDagUitRijen[kanaal] ?? null,
          syncDraait: remtNietBijAchterstand(s) || !s.gekoppeld,
          // Voor de zin over een uitgesloten kanaal (uitgeslotenMetDag), niet voor het venster.
          laatsteRij: s.laatsteDag ?? laatsteDagUitRijen[kanaal] ?? null,
        }),
        () => ({ bron: kanaal, dataTot: laatsteDagUitRijen[kanaal] ?? null, syncDraait: false, laatsteRij: laatsteDagUitRijen[kanaal] ?? null }),
      )),
  ]);

  const samen = gezamenlijkeDataTot(bronnen);
  if (samen.dataTot === null) return null;
  return { ...volleMaand({ dataTot: samen.dataTot, nu }), dataTot: samen.dataTot, uitgesloten: samen.uitgesloten, bronnen };
}
