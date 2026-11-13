"use client";

// De cijfers van een periode per dag, voor de kerncijfertegels en de kanaalkaarten van de nieuwe
// weergave (stap 3 van het periodemodel). Alleen als de keuze NIET als maandkeuze kan
// (DagStaat.maandPad false): hele maanden met een maandvergelijking lopen over het bestaande pad
// van de band, en dus over exact dezelfde cijfers.
//
// GEEN TWEEDE REKENWEG. Dit haalt de rijen op en geeft ze aan telDagVergelijking (of telDagPeriode
// bij "niets"), lib/period/dag-telling.ts. Wat die telt en hoe eerlijk per kanaal (Google per week,
// een kanaal dat nog niet liep buiten het percentage), staat daar.
//
// WAT ER OPGEHAALD WORDT, EN WANNEER. De blended route geeft de browser alleen maandreeksen; voor een
// periode per dag zijn de dagrijen van Meta, LinkedIn en Microsoft nodig (dezelfde lezer als de
// terugvalweg van de band, fetchKanaalRijen, 36 maanden), de dagrijen van Google (ads_account_daily,
// migratie 111) en zijn weekrijen (ads_account_weekly) voor als er nog geen dagrijen zijn. Eén keer per klant, bij de eerste keuze die ze nodig heeft, en dan
// bewaard: een volgende periode of vergelijking is rekenwerk, geen verzoek (fase 1). Met de
// conversieselectie uit de gedeelde client_settings-rij, zoals de band.

import { useEffect, useMemo, useState } from "react";
import { dbSelect, TABEL_ONTBREEKT, type LeesFout } from "@/lib/data-access/client-read";
import { loadClientSettingsRij } from "@/lib/client-settings";
import { resolveChannelConversionConfig, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { fetchKanaalRijen } from "@/lib/use-channel-period-data";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import type { ClientHistoricalData } from "@/lib/types";
import { NIET_GOOGLE, type NietGoogleKanaal } from "./kanaal-maanden";
import {
  telDagPeriode, telDagVergelijking,
  type DagTelInvoer, type DagTelling, type DagVergelijkingTelling, type GoogleDagRij, type GoogleWeekRij, type Tellers,
} from "./dag-telling";
import type { Month } from "./period-range";
import type { DagStaat } from "./dag-keuze";
import type { Dag } from "./dag-periode";

/** Wat er voor een klant opgehaald is. Een bron die niet te laden was, staat in `fouten`. */
interface DagBronnen {
  dagkanalen: Partial<Record<NietGoogleKanaal, Record<string, unknown>[]>>;
  weken: GoogleWeekRij[] | null;
  /** De dagrijen van Google; null als de tabel er (nog) niet is of niet te lezen was. */
  dagen: GoogleDagRij[] | null;
  convConfig: ChannelConversionConfig;
  fouten: string[];
}

// Per klant en kanalenset één lezing, ook als twee blokken tegelijk vragen.
const bronnen = new Map<string, Promise<DagBronnen>>();

async function laadWeken(clientId: string): Promise<GoogleWeekRij[]> {
  const { data, error } = await dbSelect<GoogleWeekRij>("ads_account_weekly", {
    select: "week_start,impressions,clicks,cost,conversions,conversions_value", clientId,
    order: { column: "week_start", ascending: false }, limit: 1000,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Een pagina per verzoek: de database geeft er niet meer dan dit in een antwoord.
const DAG_PAGINA = 1000;

/**
 * De dagrijen van Google, ALLE (de eerste rij zegt waar de dagopslag begint), pagina voor pagina
 * van nieuw naar oud. Een fout geeft null: dan telt Google per week of maand, zoals voor migratie
 * 111, en geen half geladen reeks die een latere start van de dagopslag zou suggereren.
 * `ontbreekt`: de tabel bestaat (nog) niet; dat verandert niet binnen een bezoek.
 */
async function laadDagen(clientId: string): Promise<{ rijen: GoogleDagRij[] | null; ontbreekt: boolean }> {
  const rijen: GoogleDagRij[] = [];
  let tot: string | null = null;
  for (;;) {
    const { data, error }: { data: GoogleDagRij[]; error: LeesFout | null } = await dbSelect<GoogleDagRij>("ads_account_daily", {
      select: "date,impressions,clicks,cost,conversions,conversions_value", clientId,
      filters: tot ? [{ op: "lte", column: "date", value: tot }] : undefined,
      order: { column: "date", ascending: false }, limit: DAG_PAGINA,
    });
    if (error) return { rijen: null, ontbreekt: error.code === TABEL_ONTBREEKT };
    // De grensdag kwam al mee op de vorige pagina: niet dubbel.
    rijen.push(...data.filter((r: GoogleDagRij) => r.date !== tot));
    if (data.length < DAG_PAGINA) return { rijen, ontbreekt: false };
    const oudste: string = data[data.length - 1].date;
    if (oudste === tot) return { rijen, ontbreekt: false };
    tot = oudste;
  }
}

// De dagrijen van Google per klant één keer: de telling en de regel in de periodekiezer lezen dezelfde.
// Ontbreekt de tabel (migratie 111 niet gedraaid), dan wordt dat onthouden voor de rest van het
// bezoek: niet bij elke keuze opnieuw vragen. Een andere fout wordt niet bewaard: een volgende keuze
// probeert het opnieuw.
const googleDagen = new Map<string, Promise<GoogleDagRij[] | null>>();
export function laadGoogleDagen(clientId: string): Promise<GoogleDagRij[] | null> {
  const er = googleDagen.get(clientId);
  if (er) return er;
  const lading = laadDagen(clientId).catch(() => ({ rijen: null, ontbreekt: false }));
  lading.then((r) => { if (!r.rijen && !r.ontbreekt) googleDagen.delete(clientId); });
  const belofte = lading.then((r) => r.rijen);
  googleDagen.set(clientId, belofte);
  return belofte;
}

/**
 * Waar de dagopslag van Google begint, voor de regel in de periodekiezer (googleWeekNoot): de eerste
 * dagrij, null zonder dagopslag (dan telt Google per week), undefined zolang het laadt.
 */
export function useGoogleDagStart(clientId: string | null, actief: boolean): Dag | null | undefined {
  const [stand, setStand] = useState<{ clientId: string; eerste: Dag | null } | null>(null);
  useEffect(() => {
    if (!actief || !clientId) return;
    let weg = false;
    laadGoogleDagen(clientId).then((r) => {
      // Nieuw naar oud geladen: de laatste rij is de eerste dag.
      if (!weg) setStand({ clientId, eerste: r && r.length ? r[r.length - 1].date : null });
    });
    return () => { weg = true; };
  }, [clientId, actief]);
  return stand && stand.clientId === clientId ? stand.eerste : undefined;
}

function laadBronnen(clientId: string, kanalen: readonly Kanaal[]): Promise<DagBronnen> {
  const sleutel = `${clientId}|${[...kanalen].sort().join(",")}`;
  const er = bronnen.get(sleutel);
  if (er) return er;
  const belofte = (async (): Promise<DagBronnen> => {
    const fouten: string[] = [];
    const config = loadClientSettingsRij(clientId)
      .then(({ data }) => resolveChannelConversionConfig((data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
    const dag = NIET_GOOGLE.filter((k) => kanalen.includes(k));
    let weekFout = false;
    const [convConfig, weken, dagen, ...rijen] = await Promise.all([
      config,
      kanalen.includes("google")
        ? laadWeken(clientId).catch(() => { weekFout = true; return null; })
        : Promise.resolve(null),
      kanalen.includes("google") ? laadGoogleDagen(clientId) : Promise.resolve(null),
      ...dag.map((k) => fetchKanaalRijen(clientId, k).then((r) => r.rijen)),
    ]);
    // Alleen een melding als Google daardoor niets heeft: met dagrijen zijn de weken niet nodig.
    if (weekFout && !dagen) fouten.push(`${KANAAL_NAAM.google}: de weekcijfers konden niet geladen worden; Google telt hieronder niet mee.`);
    const dagkanalen: DagBronnen["dagkanalen"] = {};
    dag.forEach((k, i) => { dagkanalen[k] = rijen[i] as Record<string, unknown>[]; });
    return { dagkanalen, weken: weken as GoogleWeekRij[] | null, dagen: dagen as GoogleDagRij[] | null, convConfig, fouten };
  })();
  // Een mislukte lezing niet bewaren: een volgende keuze probeert het opnieuw.
  belofte.catch(() => bronnen.delete(sleutel));
  bronnen.set(sleutel, belofte);
  return belofte;
}

export interface DagCijfers {
  /** Met een vergelijking: de telling van beide periodes, per kanaal gepaard. */
  vergelijking: DagVergelijkingTelling | null;
  /** Zonder vergelijking ("niets", of niets te vergelijken): alleen de periode. */
  alleen: DagTelling | null;
  /** Wat niet geladen kon worden, in zinnen. */
  fouten: string[];
}

/**
 * De cijfers van de gekozen dagperiode: over alle kanalen van de klant (de kanaalkaarten; hun
 * aandelen gaan altijd over alle kanalen) en over wat de tegels tonen (alle kanalen, of het ene
 * gekozen). Null zolang er niets te tellen valt: geen dagstaat, de maandweg (dan rekent de band),
 * of de rijen laden nog.
 */
export function useDagTelling({ clientId, staat, kanalen, gekozen, googleData, googleTellers = null }: {
  clientId: string;
  /** De keuze per dag van de provider (usePeriod().dag). */
  staat: DagStaat | null;
  /** De kanalen van de klant. */
  kanalen: readonly Kanaal[];
  /** Het gekozen kanaal, of null voor alle kanalen. */
  gekozen: Kanaal | null;
  /** De maandreeks van Google, zoals de band hem heeft. */
  googleData: ClientHistoricalData | null;
  /** De vertoningen en klikken van Google per maand (de blended route), voor de trechter. */
  googleTellers?: ReadonlyMap<Month, Tellers> | null;
}): { alle: DagCijfers | null; getoond: DagCijfers | null; laden: boolean } {
  const nodig = !!staat && !staat.maandPad && kanalen.length > 0;
  const kanaalSleutel = kanalen.join(",");
  const [geladen, setGeladen] = useState<{ sleutel: string; bronnen: DagBronnen } | null>(null);
  const sleutel = `${clientId}|${kanaalSleutel}`;
  useEffect(() => {
    if (!nodig) return;
    let weg = false;
    laadBronnen(clientId, kanaalSleutel.split(",") as Kanaal[])
      .then((b) => { if (!weg) setGeladen({ sleutel, bronnen: b }); })
      .catch(() => {
        if (!weg) setGeladen({ sleutel, bronnen: { dagkanalen: {}, weken: null, dagen: null, convConfig: resolveChannelConversionConfig(null), fouten: ["De cijfers per dag konden niet geladen worden."] } });
      });
    return () => { weg = true; };
  }, [nodig, clientId, kanaalSleutel, sleutel]);

  const b = geladen?.sleutel === sleutel ? geladen.bronnen : null;
  const googleNodig = kanalen.includes("google");
  const uit = useMemo(() => {
    if (!nodig || !staat || !b || (googleNodig && !googleData)) return { alle: null, getoond: null };
    const tel = (welke: readonly Kanaal[]): DagCijfers => {
      const dagkanalen: DagTelInvoer["dagkanalen"] = {};
      for (const k of NIET_GOOGLE) if (welke.includes(k) && b.dagkanalen[k]) dagkanalen[k] = b.dagkanalen[k];
      const invoer: DagTelInvoer = {
        google: welke.includes("google") ? { maanden: googleData, weken: b.weken, dagen: b.dagen, maandTellers: googleTellers } : null,
        dagkanalen,
        convConfig: b.convConfig,
      };
      const c = staat.keuze.vergelijk === "none" ? null : staat.vergelijking.periode;
      return c
        ? { vergelijking: telDagVergelijking(staat.periode, c, invoer), alleen: null, fouten: b.fouten }
        : { vergelijking: null, alleen: telDagPeriode(staat.periode, invoer), fouten: b.fouten };
    };
    const alle = tel(kanalen);
    return { alle, getoond: gekozen && kanalen.includes(gekozen) ? tel([gekozen]) : alle };
  }, [nodig, staat, b, googleNodig, googleData, googleTellers, kanalen, gekozen]);
  return { ...uit, laden: nodig && uit.alle === null };
}
