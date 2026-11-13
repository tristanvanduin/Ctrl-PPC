"use client";

// De rijen en de instelling voor de conversiestappen na de klik op het Overzicht in de nieuwe
// weergave (lib/overzicht/conversiestappen.ts rekent, dit haalt op).
//
// WAT ER OPGEHAALD WORDT, EN WANNEER. Eén keer per klant en kanalenset, en dan bewaard: een wissel
// van periode of kanaal is rekenwerk, geen verzoek (fase 1). Per dagkanaal de stapkolommen van de
// accountdagtabel over de laatste LEESDAGEN dagen (genoeg voor een jaar terug vergelijken), en voor
// Google zowel google_ads_checkout_funnel_daily als de maandtabel google_ads_checkout_funnel. Welke
// van de twee een periode telt, beslist telKanaalStappen per periode: de dagtabel kan ontbreken
// (migratie 111 niet gedraaid), leeg zijn, of pas vanaf de eerste sync gevuld. Niets van dit alles
// breekt de pagina: een bron die niet laadt is een kanaal zonder stapdata, met een regel waarom.
//
// De instellingen (conversie-trechter-settings.tsx) lezen via dezelfde laadConversiestappen, met
// dezelfde termijn: anders herkent de instelling iets anders dan het Overzicht telt.

import { useEffect, useState } from "react";
import { dbSelect } from "@/lib/data-access/client-read";
import type { ReadFilter } from "@/lib/data-access/read-policy";
import { loadClientSettingsRij } from "@/lib/client-settings";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";
import { addDays, today } from "@/lib/reporting-date";
import {
  beschikbareBronnen, geldendeTrechter, KANAAL_STAPVELDEN, KLIKVELD, META_LANDINGSPAGINA,
  type DagKanaal, type GeldendeTrechter, type StapBron, type StapRijen,
} from "./conversiestappen";

/** Twee jaar en een maand: een periode van een jaar tegen hetzelfde jaar ervoor past erin. */
const LEESDAGEN = 760;
const PAGINA = 1000;

const DAGTABEL: Record<DagKanaal, string> = {
  meta: "meta_account_daily",
  linkedin: "linkedin_account_daily",
  microsoft: "microsoft_account_daily",
};

const GOOGLE_KOLOMMEN = "date, add_to_cart_count, begin_checkout_count, purchase_count";

function dagSelect(k: DagKanaal): string {
  const velden = ["date", KLIKVELD[k], ...(k === "meta" ? [META_LANDINGSPAGINA.sleutel] : []), ...KANAAL_STAPVELDEN[k].map((v) => v.sleutel)];
  return [...new Set(velden)].join(", ");
}

/**
 * Alle rijen vanaf `vanaf`, nieuwste eerst, per pagina. Een tabel met veel rijen per dag (Google
 * per campagne en apparaat) past niet in één pagina. Een fout: null, de aanroeper beslist.
 */
async function leesAlles(tabel: string, select: string, clientId: string, vanaf: string): Promise<Record<string, unknown>[] | null> {
  const uit: Record<string, unknown>[] = [];
  let tot: string | null = null;
  for (;;) {
    const filters: ReadFilter[] = [{ op: "gte", column: "date", value: vanaf }];
    if (tot) filters.push({ op: "lte", column: "date", value: tot });
    const { data, error } = await dbSelect<Record<string, unknown>>(tabel, {
      select, clientId, filters, order: { column: "date", ascending: false }, limit: PAGINA,
    });
    if (error) return uit.length ? uit : null;
    // Wat buiten het gevraagde bereik valt niet meenemen: een bron die gte/lte negeert (de
    // demo-mock doet dat) gaf anders elke pagina dezelfde rijen opnieuw.
    const grens: string | null = tot;
    const pagina: Record<string, unknown>[] = grens ? data.filter((r) => String(r.date ?? "").slice(0, 10) <= grens) : data;
    if (data.length < PAGINA) { uit.push(...pagina); return uit; }
    const oudste: string = String(pagina[pagina.length - 1]?.date ?? "").slice(0, 10);
    // Meer dan een pagina op een dag: verder komen kan alleen met een tweede sorteersleutel. Liever
    // een te laag aantal dan een lus.
    if (!oudste || oudste === tot) { uit.push(...pagina); return uit; }
    // De dag van de laatste rij is misschien maar half binnen: die dag komt met de volgende pagina.
    uit.push(...pagina.filter((r) => String(r.date ?? "").slice(0, 10) !== oudste));
    tot = oudste;
  }
}

export interface ConversiestappenBron {
  trechter: GeldendeTrechter;
  rijen: StapRijen;
  /** De bronnen die bij deze klant voorkomen, om uit te kiezen in de instellingen. */
  bronnen: StapBron[];
  /** De kaart zoals hij nu bewaard is: de posities die een nieuwe keuze niet dekt, blijven staan. */
  checkoutActionMap: unknown;
}

const bronnen = new Map<string, Promise<ConversiestappenBron>>();

/** Na het opslaan van de instelling: de volgende lezer haalt opnieuw op. */
export function vergeetConversiestappen(clientId: string): void {
  for (const k of [...bronnen.keys()]) if (k.startsWith(`${clientId}|`)) bronnen.delete(k);
}

/** Eén lezing per klant en kanalenset, bewaard tot vergeetConversiestappen. */
export function laadConversiestappen(clientId: string, kanalen: readonly Kanaal[]): Promise<ConversiestappenBron> {
  const sleutel = `${clientId}|${[...kanalen].sort().join(",")}`;
  const er = bronnen.get(sleutel);
  if (er) return er;
  const belofte = (async (): Promise<ConversiestappenBron> => {
    const vanaf = addDays(today(), -LEESDAGEN);
    const dag = (["meta", "linkedin", "microsoft"] as const).filter((k) => kanalen.includes(k));
    const [instelling, google, ...dagRijen] = await Promise.all([
      loadClientSettingsRij(clientId).then((r) => r.data).catch(() => null),
      kanalen.includes("google")
        ? Promise.all([
          leesAlles("google_ads_checkout_funnel_daily", GOOGLE_KOLOMMEN, clientId, vanaf),
          leesAlles("google_ads_checkout_funnel", GOOGLE_KOLOMMEN, clientId, `${vanaf.slice(0, 7)}-01`),
        ]).then(([dag, maand]) => ({ dag, maand }))
        : Promise.resolve(null),
      ...dag.map((k) => leesAlles(DAGTABEL[k], dagSelect(k), clientId, vanaf)),
    ]);
    const rijen: StapRijen = { google };
    dag.forEach((k, i) => { rijen[k] = dagRijen[i]; });
    const checkoutActionMap = instelling?.checkout_action_map ?? null;
    const bronnen = beschikbareBronnen({ conversionActions: instelling?.conversion_actions ?? null, rijen });
    const trechter = geldendeTrechter({ checkoutActionMap, bedrijfsmodel: instelling?.bedrijfsmodel ?? null, bronnen });
    return { trechter, rijen, bronnen, checkoutActionMap };
  })();
  belofte.catch(() => bronnen.delete(sleutel));
  bronnen.set(sleutel, belofte);
  return belofte;
}

/** De instelling en de rijen van deze klant; null zolang ze laden of als `aan` uit staat. */
export function useConversiestappen({ clientId, kanalen, aan }: {
  clientId: string;
  kanalen: readonly Kanaal[];
  aan: boolean;
}): ConversiestappenBron | null {
  const kanaalSleutel = kanalen.join(",");
  const sleutel = `${clientId}|${kanaalSleutel}`;
  const [geladen, setGeladen] = useState<{ sleutel: string; bron: ConversiestappenBron } | null>(null);
  useEffect(() => {
    if (!aan || !kanaalSleutel) return;
    let weg = false;
    laadConversiestappen(clientId, kanaalSleutel.split(",") as Kanaal[])
      .then((bron) => { if (!weg) setGeladen({ sleutel, bron }); })
      .catch(() => { /* geen stapdata: de blokken zeggen dat zelf */ });
    return () => { weg = true; };
  }, [aan, clientId, kanaalSleutel, sleutel]);
  return aan && geladen?.sleutel === sleutel ? geladen.bron : null;
}
