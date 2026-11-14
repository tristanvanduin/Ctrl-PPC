"use client";

// De campagnerijen voor de gekozen periode (en de vergelijkingsperiode), per kanaal, één keer per
// stuk geladen. Het rekenwerk staat in campagne-periode.ts.
//
// GEEN VERZOEK PER WISSEL ALS DE RIJEN AL BINNEN ZIJN. Per klant en kanaal wordt onthouden welke
// dagen er geladen zijn. Een periode (met zijn vergelijking) die daarbinnen valt, rekent op wat er
// al is: van 12 naar 3 maanden, of de vergelijking uit, kost niets. Pas een periode die ergens
// buiten valt, laadt opnieuw, en dan meteen de omhullende van oud en nieuw, zodat terugschakelen
// weer niets kost.
//
// PAGINA VOOR PAGINA. De database geeft hooguit 1000 rijen per antwoord, en een campagnetabel heeft
// er per dag één per campagne: twaalf maanden van tien campagnes is al 3650. De rijen komen van nieuw
// naar oud; de oudste dag van een volle pagina kan half binnen zijn, dus die gaat mee met de
// volgende pagina in plaats van met deze. Zonder dat telde een dag op de grens half.

import { useEffect, useMemo, useState } from "react";
import { dbSelect, TABEL_ONTBREEKT, type LeesFout, type ReadOptions } from "@/lib/data-access/client-read";
import { loadClientSettingsRij } from "@/lib/client-settings";
import {
  conversionSourcesFor, resolveChannelConversionConfig, sumSelectedConversions,
  type ChannelConversionChannel, type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { KANAAL_DAGBRON } from "@/lib/analysis/channel-report-blend";
import type { Dag, DagPeriode } from "@/lib/period/dag-periode";
import type { CampagneKanaal, CampagneRij } from "./campagne-periode";

/** Eén lezing, zoals dbSelect: in de tests een nep die telt hoe vaak hij gevraagd wordt. */
export type Lees = (tabel: string, opts: ReadOptions) => Promise<{ data: Record<string, unknown>[]; error: LeesFout | null }>;

const PAGINA = 1000;

/** De campagne-dagtabel, de entiteitkolom en de namentabel per niet-Google-kanaal. */
export const CAMPAGNE_DAGTABEL: Record<Exclude<CampagneKanaal, "google">, { tabel: string; entiteit: string; namen: string; id: string; kanaal: ChannelConversionChannel }> = {
  meta: { tabel: "meta_campaign_daily", entiteit: "entity_id", namen: "meta_campaigns", id: "campaign_id", kanaal: "meta_ads" },
  linkedin: { tabel: "linkedin_campaign_daily", entiteit: "entity_urn", namen: "linkedin_campaigns", id: "campaign_urn", kanaal: "linkedin_ads" },
  microsoft: { tabel: "microsoft_campaign_daily", entiteit: "entity_id", namen: "microsoft_campaigns", id: "campaign_id", kanaal: "microsoft_ads" },
};

/** De select op de campagne-dagtabel van een niet-Google-kanaal: dag, entiteit, tellers en ALLE
 *  selecteerbare conversievelden (de selectie van de klant bepaalt wat meetelt, niet de query). */
export function campagneDagkolommen(kanaal: Exclude<CampagneKanaal, "google">): string {
  const b = CAMPAGNE_DAGTABEL[kanaal];
  return [...new Set(["date", b.entiteit, "impressions", KANAAL_DAGBRON[b.kanaal].clicksField, "spend",
    ...conversionSourcesFor(b.kanaal).map((s) => s.field)])].join(", ");
}

/** Wat er voor één kanaal geladen is. Ruwe rijen: de conversieselectie telt pas bij het rekenen. */
export interface KanaalLading {
  kanaal: CampagneKanaal;
  /** De dagen die deze lading dekt. */
  span: DagPeriode;
  dagen: Record<string, unknown>[];
  /** Alleen Google: maandrijen voor het deel vóór de dagopslag. */
  maanden: Record<string, unknown>[];
  /** Alleen Google: de eerste dag in ads_campaign_daily, null zonder dagopslag. */
  eersteDag: Dag | null;
  /** De eerste dag met een campagnerij in deze bron, over ALLE rijen; null zonder rijen
   *  (CampagneBron.bronStart). */
  bronStart: Dag | null;
  /** Niet-Google: entiteit -> naam. */
  namen: Map<string, string>;
}

/** Alle rijen van een tabel tussen twee datums, van nieuw naar oud, pagina voor pagina. */
export async function allePaginas(
  lees: Lees, tabel: string, select: string, clientId: string, kolom: string, van: string, tot: string,
): Promise<Record<string, unknown>[]> {
  const uit: Record<string, unknown>[] = [];
  let bovengrens = tot;
  for (;;) {
    const { data, error } = await lees(tabel, {
      select, clientId,
      filters: [{ op: "gte", column: kolom, value: van }, { op: "lte", column: kolom, value: bovengrens }],
      order: { column: kolom, ascending: false }, limit: PAGINA,
    });
    if (error) throw Object.assign(new Error(`${tabel}: ${error.message}`), { code: error.code });
    if (data.length < PAGINA) { uit.push(...data); return uit; }
    // De oudste dag van een volle pagina kan half binnen zijn: die komt helemaal mee met de volgende.
    const oudste = String(data[data.length - 1][kolom]);
    const heel = data.filter((r) => String(r[kolom]) !== oudste);
    if (heel.length === 0) throw new Error(`${tabel}: meer dan ${PAGINA} campagnerijen op ${oudste}; die zijn niet in één keer te lezen.`);
    uit.push(...heel);
    bovengrens = oudste;
  }
}

/** De eerste waarde van `kolom` in een tabel (oud naar nieuw, één rij), als dag; null zonder rijen. */
async function eersteRij(lees: Lees, tabel: string, kolom: string, clientId: string, magOntbreken = false): Promise<Dag | null> {
  const { data, error } = await lees(tabel, { select: kolom, clientId, order: { column: kolom, ascending: true }, limit: 1 });
  if (error) {
    if (magOntbreken && error.code === TABEL_ONTBREEKT) return null;
    throw Object.assign(new Error(`${tabel}: ${error.message}`), { code: error.code });
  }
  return data[0] ? String(data[0][kolom]).slice(0, 10) : null;
}

/**
 * Laadt één kanaal over `span`, met de eerste dag van de bron (over ALLE rijen): zonder die dag telde
 * een vergelijking met een periode van vóór de eerste campagnerij als "nieuw" of als +1.638%.
 */
export async function laadKanaal(clientId: string, kanaal: CampagneKanaal, span: DagPeriode, lees: Lees = dbSelect as Lees): Promise<KanaalLading> {
  if (kanaal !== "google") {
    const b = CAMPAGNE_DAGTABEL[kanaal];
    const [namen, dagen, bronStart] = await Promise.all([
      lees(b.namen, { select: `${b.id}, name`, clientId }),
      allePaginas(lees, b.tabel, campagneDagkolommen(kanaal), clientId, "date", span.start, span.eind),
      eersteRij(lees, b.tabel, "date", clientId),
    ]);
    return {
      kanaal, span, dagen, maanden: [], eersteDag: null, bronStart,
      namen: new Map((namen.data ?? []).map((r) => [String(r[b.id]), String(r.name ?? r[b.id])])),
    };
  }
  // Google: waar de dagopslag begint (de eerste rij van ALLE rijen) en waar de maandrijen beginnen.
  // Dan de dagen vanaf de dagopslag, en de maandrijen van ALLE maanden die de span raakt: hele
  // maanden tellen uit de maandrijen (zoals het kanaaltotaal), het deel vóór de dagopslag ook.
  // Ontbreekt de dagtabel, dan alles per maand.
  const [eersteDag, eersteMaand] = await Promise.all([
    eersteRij(lees, "ads_campaign_daily", "date", clientId, true),
    eersteRij(lees, "ads_campaign_monthly", "month", clientId),
  ]);
  const dagVan = eersteDag && eersteDag > span.start ? eersteDag : span.start;
  const [dagen, maanden] = await Promise.all([
    eersteDag && dagVan <= span.eind
      ? allePaginas(lees, "ads_campaign_daily", "date, campaign_id, campaign_name, impressions, clicks, cost, conversions", clientId, "date", dagVan, span.eind)
      : Promise.resolve([]),
    allePaginas(lees, "ads_campaign_monthly", "month, campaign_id, campaign_name, impressions, clicks, cost, conversions", clientId, "month", `${span.start.slice(0, 7)}-01`, `${span.eind.slice(0, 7)}-01`),
  ]);
  const bronStart = eersteDag && eersteMaand ? (eersteDag < eersteMaand ? eersteDag : eersteMaand) : eersteDag ?? eersteMaand;
  return { kanaal, span, dagen, maanden, eersteDag, bronStart, namen: new Map() };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

/** De geladen rijen als campagnerijen, met de conversieselectie van de klant. */
export function campagneRijenUit(l: KanaalLading, convConfig: ChannelConversionConfig): { dagen: CampagneRij[]; maanden: CampagneRij[] } {
  if (l.kanaal === "google") {
    const google = (r: Record<string, unknown>, datum: string): CampagneRij => ({
      sleutel: String(r.campaign_id ?? r.campaign_name ?? ""), naam: String(r.campaign_name ?? r.campaign_id ?? ""),
      date: String(r[datum]).slice(0, 10), spend: num(r.cost), conversions: num(r.conversions),
      impressions: num(r.impressions), clicks: num(r.clicks),
    });
    return {
      dagen: l.dagen.map((r) => google(r, "date")).filter((r) => r.sleutel),
      maanden: l.maanden.map((r) => google(r, "month")).filter((r) => r.sleutel),
    };
  }
  const b = CAMPAGNE_DAGTABEL[l.kanaal];
  const klik = KANAAL_DAGBRON[b.kanaal].clicksField;
  return {
    dagen: l.dagen.map((r) => {
      const e = String(r[b.entiteit] ?? "");
      return {
        sleutel: e, naam: l.namen.get(e) ?? e, date: String(r.date).slice(0, 10),
        spend: num(r.spend), conversions: sumSelectedConversions(r, b.kanaal, convConfig),
        impressions: num(r.impressions), clicks: num(r[klik]),
      };
    }).filter((r) => r.sleutel),
    maanden: [],
  };
}

/** Dekt `span` de periode `nodig`? */
export function dekt(span: DagPeriode, nodig: DagPeriode): boolean {
  return span.start <= nodig.start && span.eind >= nodig.eind;
}

/** De omhullende van twee periodes. */
export function omhullende(a: DagPeriode, b: DagPeriode | null): DagPeriode {
  if (!b) return a;
  return { start: a.start < b.start ? a.start : b.start, eind: a.eind > b.eind ? a.eind : b.eind };
}

// Per klant en kanaal: wat er geladen is (of wordt). Een mislukte lading wordt vergeten, zodat een
// volgende keuze het opnieuw probeert.
const cache = new Map<string, { span: DagPeriode; belofte: Promise<KanaalLading> }>();

/** Het kanaal over `nodig`: uit wat er al is als dat het dekt, anders een nieuwe lading. */
export function laadMetCache(clientId: string, kanaal: CampagneKanaal, nodig: DagPeriode, lees: Lees = dbSelect as Lees): Promise<KanaalLading> {
  const sleutel = `${clientId}|${kanaal}`;
  const er = cache.get(sleutel);
  if (er && dekt(er.span, nodig)) return er.belofte;
  const span = er ? omhullende(er.span, nodig) : nodig;
  const belofte = laadKanaal(clientId, kanaal, span, lees);
  cache.set(sleutel, { span, belofte });
  belofte.catch(() => { if (cache.get(sleutel)?.belofte === belofte) cache.delete(sleutel); });
  return belofte;
}

/** Alleen voor de tests: begin met een lege cache. */
export function vergeetCampagneCache(): void {
  cache.clear();
}

export interface CampagnePeriodeStaat {
  /** Per kanaal de rijen (met de selectie van de klant), of null zolang er niets is. */
  rijen: Partial<Record<CampagneKanaal, { dagen: CampagneRij[]; maanden: CampagneRij[]; eersteDag: Dag | null; bronStart: Dag | null }>> | null;
  /** Per kanaal dat niet te laden was, waarom. */
  fouten: string[];
  /** De conversieselectie van de klant, waarmee de rijen geteld zijn; null zolang er niets is. */
  convConfig: ChannelConversionConfig | null;
  laden: boolean;
}

/**
 * De campagnerijen van `kanalen` over de periode en de vergelijkingsperiode. Uit (`actief` false):
 * geen enkel verzoek. `laden` is waar zolang wat er geladen is de gevraagde dagen niet dekt; dan
 * tonen de tabellen een laadvlak en niet de vorige rijen, want een totaalrij over rijen die de nieuwe
 * periode maar half dekken, is een verkeerd getal met een merkteken erop. Een wissel binnen wat er al
 * is (de cache dekt hem), laadt niet en toont dus ook geen laadvlak.
 */
export function useCampagnePeriode({ clientId, kanalen, periode, vergelijking, actief }: {
  clientId: string;
  kanalen: readonly CampagneKanaal[];
  periode: DagPeriode;
  vergelijking: DagPeriode | null;
  actief: boolean;
}): CampagnePeriodeStaat {
  const span = omhullende(periode, vergelijking);
  const kanalenSleutel = kanalen.join(",");
  const [geladen, setGeladen] = useState<{ clientId: string; ladingen: KanaalLading[]; fouten: string[]; convConfig: ChannelConversionConfig; span: DagPeriode } | null>(null);

  useEffect(() => {
    if (!actief) return;
    let weg = false;
    const welke = kanalenSleutel ? (kanalenSleutel.split(",") as CampagneKanaal[]) : [];
    Promise.all([
      Promise.all(welke.map((k) => laadMetCache(clientId, k, { start: span.start, eind: span.eind }).then(
        (l) => ({ l, fout: null as string | null }),
        (e: unknown) => ({ l: null, fout: `${k}: ${e instanceof Error ? e.message : String(e)}` }),
      ))),
      loadClientSettingsRij(clientId),
    ]).then(([uit, settings]) => {
      if (weg) return;
      setGeladen({
        clientId,
        ladingen: uit.flatMap((u) => (u.l ? [u.l] : [])),
        fouten: uit.flatMap((u) => (u.fout ? [u.fout] : [])),
        convConfig: resolveChannelConversionConfig((settings.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null),
        // Wat de ladingen samen dekken (de cache kan meer hebben dan er nu gevraagd werd): een
        // terugwissel binnen dat stuk toont geen laadvlak.
        span: uit.reduce<DagPeriode>((d, u) => (u.l ? { start: u.l.span.start > d.start ? u.l.span.start : d.start, eind: u.l.span.eind < d.eind ? u.l.span.eind : d.eind } : d),
          { start: "0000-01-01", eind: "9999-12-31" }),
      });
    });
    return () => { weg = true; };
  }, [actief, clientId, kanalenSleutel, span.start, span.eind]);

  const huidig = geladen && geladen.clientId === clientId ? geladen : null;
  const rijen = useMemo(() => {
    if (!huidig) return null;
    const uit: NonNullable<CampagnePeriodeStaat["rijen"]> = {};
    for (const l of huidig.ladingen) uit[l.kanaal] = { ...campagneRijenUit(l, huidig.convConfig), eersteDag: l.eersteDag, bronStart: l.bronStart };
    return uit;
  }, [huidig]);
  return {
    rijen,
    fouten: huidig?.fouten ?? [],
    convConfig: huidig?.convConfig ?? null,
    laden: actief && (!huidig || !dekt(huidig.span, span)),
  };
}
