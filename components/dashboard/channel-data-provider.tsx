"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { kijkClientSettingsRij, loadClientSettingsRij } from "@/lib/client-settings";
import { useBlendedClientData, type KanaalTab } from "@/lib/use-blended-client-data";
import type { BlendedKanaalMaand } from "@/lib/api/blended-historical";
import {
  resolveChannelConversionConfig,
  sumSelectedConversions,
  selectedConversionLabels,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { CONFIG, type ChannelKind, type DailyRow } from "./channel-performance";

// EEN bron per kanaaltabblad, voor alle kaarten samen.
//
// Waarom dit er is, en het is een reparatie van mijn eigen werk. Toen pacing, het maandverloop en
// de beurs-sectie losse kaarten werden, kreeg elk van die kaarten zijn eigen ophaalcode. Gemeten op
// het Meta-tabblad: 54 data-verzoeken per paginabezoek, waarvan meta_account_daily elf keer en
// client_targets vier keer -- allemaal dezelfde rijen. Zichtbaar gevolg: de beurs-sectie stond na
// twintig seconden nog op zijn skelet, en dat is precies wat de eigenaar in beeld kreeg.
//
// Google lost dit al zo op (ClientDataProvider + ForecastContext); dit is de tegenhanger voor Meta,
// LinkedIn en Microsoft. Sinds fase 1, stap 5 haalt deze provider NIETS meer zelf op: alles komt
// uit /api/blended/client-data, dat de KPI-band bij het laden al vroeg en dat de hook
// (useBlendedClientData) vijf minuten bewaart. Per kanaal draagt dat antwoord de maanden met
// tellers, de maand- en weekemmers voor de prognose, de dagrijen van de laatste weken en het
// jaardoel uit client_targets; de hook bouwt daar één keer per ophaalronde het tab-object van
// (KanaalTab: historie, prognose, health). Daarvoor las elke Meta-mount de hele meta_account_daily
// (tot 1000 rijen), client_targets en client_settings opnieuw, en de health-badge haalde daarnaast
// nog een TWEEDE prognose uit fact_core via /api/analysis/channel-forecast -- twee cijfers voor
// hetzelfde kanaal, met een andere conversieselectie en een andere gerealiseerd-grens.
//
// Alleen de conversieselectie (convVan, convLabel) komt nog van de gedeelde client_settings-rij
// (lib/client-settings.ts, gecachet): de route past diezelfde selectie al toe op de emmers en de
// maanden, maar de dagrijen reizen ruw, en de pacing en de kerncijfers tellen ze hier op.

export interface KanaalData {
  /**
   * De dagrijen van de laatste weken (recenteDagen van de route: vanaf de 1e van vorige maand of
   * 56 dagen terug, wat het vroegst is), voor de pacing en de 28-dagenvensters; null zolang er
   * geladen wordt. Niet de hele historie: die zit in `maanden` en in `forecast`.
   */
  rijen: DailyRow[] | null;
  /**
   * Alle maanden van dit kanaal met tellers (impressions, clicks, spend, conversies, omzet), met
   * de conversieselectie van de klant al toegepast; null zolang er geladen wordt. Voor het
   * maandverloop en de maandtabel: recenteDagen bevat hooguit één volle maand.
   */
  maanden: BlendedKanaalMaand[] | null;
  /** De som van de geselecteerde conversievelden voor dit kanaal. */
  convVan: (r: DailyRow) => number;
  /** Hoe die conversie op het scherm heet ("Aankopen / conversies + Leads"). */
  convLabel: string;
  /** null = laden, "leeg" = geen dagcijfers gesynced, anders historie + prognose + health. */
  forecast: KanaalTab | null | "leeg";
  /** De foutmelding van de route als die faalde; de kaarten tonen dan geen cijfers maar de fout. */
  fout?: string | null;
}

const LEEG: KanaalData = { rijen: null, maanden: null, convVan: () => 0, convLabel: "", forecast: null, fout: null };
/** Geëxporteerd voor de invariant-test (lib/__kanaaltab_gelijk_alle_kanalen_test.ts), die de
 *  kaarten met een vaste KanaalData rendert; productiecode gebruikt ChannelDataProvider. */
export const KanaalDataContext = createContext<KanaalData>(LEEG);

/**
 * Buiten een provider valt dit terug op "nog aan het laden" in plaats van te crashen. Dat is
 * bewust: de kaarten hieronder staan ook los op andere schermen, en een ontbrekende provider hoort
 * daar geen wit scherm te geven maar gewoon niets te tonen.
 */
export function useKanaalData(): KanaalData {
  return useContext(KanaalDataContext);
}

export function ChannelDataProvider({ clientId, channel, children }: {
  clientId: string;
  channel: ChannelKind;
  children: ReactNode;
}) {
  const cfg = CONFIG[channel];
  // De selectie hoort bij één klant. Staat hier nog die van een andere klant (of nog niets), dan
  // wachten de rijen: anders telde de pacing één render met de verkeerde of de standaardselectie
  // en sprong hij daarna. De rij is bij het laden al gelezen (de band), dus dit is een microtaak.
  //
  // De beginstaat uit de cache van de rij (kijkClientSettingsRij): hier stond `null`, bij elke
  // mount. Het hele kanaaltabblad renderde en commitde dan eerst in zijn laadstaat, en na het
  // effect hieronder (de rij kwam uit de cache terug) nog een keer met de echte kaarten: elke
  // wissel naar Meta, LinkedIn of Microsoft bouwde het tabblad twee keer op, ook bij het tweede
  // bezoek. Dezelfde rij en dezelfde selectie, alleen een render eerder; bij een lege cache (een
  // koude start) verandert er niets.
  const [selectie, setSelectie] = useState<{ clientId: string; config: ChannelConversionConfig } | null>(() => {
    const rij = kijkClientSettingsRij(clientId);
    if (rij === undefined) return null;
    return { clientId, config: resolveChannelConversionConfig((rij?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null) };
  });
  const selectieKlaar = selectie?.clientId === clientId;
  const convConfig = useMemo(
    () => (selectie?.clientId === clientId ? selectie.config : resolveChannelConversionConfig(null)),
    [selectie, clientId],
  );
  // Hetzelfde verzoek als de KPI-band erboven (de hook deelt het): per kanaal de maanden, de
  // emmers, de recente dagen en het tab-object, met de syncdag en de stop van de route erin
  // (tabStandUitRoute in de hook). Een kanaal dat de route in `uitgesloten` zet (ontkoppeld, of
  // zijn data komt niet meer), krijgt zo de gezamenlijke dag en de stop van de som mee: met zijn
  // eigen, oude dag projecteerde de tab maanden die al voorbij zijn.
  const route = useBlendedClientData(clientId);

  // Opnieuw bij elke ophaalronde van de route (route.perKanaal is dan een nieuw object): de route
  // telt zijn maanden en emmers met de selectie van dát moment, en de dagrijen hier horen met
  // dezelfde te tellen. De rij is gecachet en wordt bij opslaan vergeten (lib/client-settings.ts),
  // dus binnen een ronde kost dit geen verzoek. De vorige selectie blijft staan tot de nieuwe er is.
  useEffect(() => {
    let cancelled = false;
    const zet = (opgeslagen: unknown) => {
      if (cancelled) return;
      setSelectie({ clientId, config: resolveChannelConversionConfig(opgeslagen as Partial<ChannelConversionConfig> | null) });
    };
    loadClientSettingsRij(clientId).then((res) => zet(res.data?.channel_conversion_config ?? null), () => zet(null));
    return () => { cancelled = true; };
  }, [clientId, route.perKanaal]);

  const waarde = useMemo<KanaalData>(() => {
    const convVan = (r: DailyRow) => sumSelectedConversions(r.convFields, cfg.channelKey, convConfig);
    const convLabel = selectedConversionLabels(cfg.channelKey, convConfig).join(" + ");
    if (!selectieKlaar || route.loading) return { rijen: null, maanden: null, convVan, convLabel, forecast: null, fout: null };
    // De route faalde: geen cijfers, en geen eigen lezing als vangnet. Eerder las de provider de
    // dagtabel zelf en toonde hij bij een fout de lege staat; nu staat de fout erbij.
    if (route.error) return { rijen: [], maanden: [], convVan, convLabel, forecast: "leeg", fout: route.error };
    const reeks = route.perKanaal?.find((k) => k.kanaal === channel);
    return {
      rijen: (reeks?.recenteDagen ?? []).map(cfg.map),
      maanden: reeks?.maanden ?? [],
      convVan,
      convLabel,
      // Hetzelfde object dat de ranking op "Alle kanalen" voor dit kanaal leest.
      forecast: route.perKanaalTab?.[channel] ?? "leeg",
      fout: null,
    };
  }, [cfg, channel, convConfig, selectieKlaar, route.loading, route.error, route.perKanaal, route.perKanaalTab]);

  return <KanaalDataContext.Provider value={waarde}>{children}</KanaalDataContext.Provider>;
}
