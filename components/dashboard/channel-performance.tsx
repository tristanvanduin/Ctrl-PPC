"use client";

import { useState, useEffect, useMemo } from "react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Calendar, TrendingUp, BarChart3 } from "lucide-react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { resolveChannelConversionConfig, sumSelectedConversions, selectedConversionLabels, type ChannelConversionConfig, type ChannelConversionChannel } from "@/lib/analysis/channel-conversion-config";
import { today as vandaag } from "@/lib/reporting-date";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useVorige } from "@/lib/use-vorige";
import { Kerncijfer } from "@/components/ui/kerncijfer";

// Volwaardige prestatie-view voor Meta en LinkedIn: dezelfde bouwstenen als Google
// (KPI-kaarten, pacing, maandtabel, grafiek, campagnetabel), gevoed uit de dag-tabellen van
// het kanaal. Ratio's UIT TOTALEN (venster/maand), nooit uit dag-gemiddelden. Pacing is
// maand-tot-nu tegen dezelfde dag-telling van de vorige maand: geen doel nodig, wel eerlijk
// tempo-inzicht. De analyses draaien elders (Analyses-tab); dit is de data-weergave.

// De maandtabel is de enige plek in dit bestand die de maand als eigen kolom toont (de
// mini-grafiek en de kaartenrij ernaast gebruiken de korte vorm uit chart-chrome.tsx, waar
// ruimte wél schaars is) -- hier is ruimte geen probleem en "2026-07" onvertaald is geen label.
const VOLLEDIGE_MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];
function maandVoluit(isoMaand: string): string {
  const [jaar, maand] = isoMaand.split("-");
  const naam = VOLLEDIGE_MAANDEN[Number(maand) - 1];
  return naam ? `${naam} ${jaar}` : isoMaand;
}

export type ChannelKind = "meta" | "linkedin";

export interface DailyRow {
  date: string;
  entity: string;
  impressions: number;
  clicks: number;
  spend: number;
  // Ruwe conversievelden per naam; welke meetellen bepaalt de conversie-selectie per kanaal.
  convFields: Record<string, number>;
  /** conversion_value -- toegevoegd 23 augustus 2026 voor channel-forecast-data.ts (Jaaroverzicht
   *  op Meta/LinkedIn), dat een omzetcijfer nodig heeft naast de conversie-telling. Bestaande
   *  lezers negeren dit veld gewoon. */
  revenue: number;
}

interface ChannelConfig {
  accountTable: string;
  campaignTable: string;
  nameTable: string;
  nameId: string;
  entityField: string;
  channelKey: ChannelConversionChannel;
  select: string;
  map: (r: Record<string, unknown>) => Omit<DailyRow, "entity"> & { entity: string };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Geëxporteerd (22 augustus 2026) zodat channel-campaign-table.tsx dezelfde tabelnamen/mapping
// gebruikt -- de campagnetabel verhuisde naar de Campagnes-tab (feedback: "structuur exact
// hetzelfde" tussen kanalen, en de campagnetabel hoort bij "wat draait er", niet bij "hoe loopt
// het", zelfde tabsplitsing als deze view zelf al documenteert). Eén bron voor de kolomnamen
// voorkomt dat de twee views ooit een ander veld voor dezelfde kolom lezen.
export const CONFIG: Record<ChannelKind, ChannelConfig> = {
  meta: {
    accountTable: "meta_account_daily",
    campaignTable: "meta_campaign_daily",
    nameTable: "meta_campaigns",
    nameId: "campaign_id",
    entityField: "entity_id",
    channelKey: "meta_ads",
    select: "date, entity_id, impressions, link_clicks, spend, conversions, leads, conversion_value",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_id), impressions: num(r.impressions), clicks: num(r.link_clicks), spend: num(r.spend), convFields: { conversions: num(r.conversions), leads: num(r.leads) }, revenue: num(r.conversion_value) }),
  },
  linkedin: {
    accountTable: "linkedin_account_daily",
    campaignTable: "linkedin_campaign_daily",
    nameTable: "linkedin_campaigns",
    nameId: "campaign_urn",
    entityField: "entity_urn",
    channelKey: "linkedin_ads",
    select: "date, entity_urn, impressions, clicks, spend, one_click_leads, external_website_conversions, post_click_conversions, conversion_value",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_urn), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), convFields: { one_click_leads: num(r.one_click_leads), external_website_conversions: num(r.external_website_conversions), post_click_conversions: num(r.post_click_conversions) }, revenue: num(r.conversion_value) }),
  },
};

export const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
export const fmt = (v: number | null, d = 0): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v));
export const pctS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
// Het percentage als getal en niet als tekst. Als tekst moest de weergave de richting uit het
// plusteken afleiden (`startsWith("+") ? groen : rood`), en dat is fout zodra lager beter is: een
// CPL die met twaalf procent stijgt kleurde groen. Wie hoort te stijgen zegt de aanroeper.
const deltaPct = (cur: number | null, prev: number | null): number | null =>
  cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;

interface Agg { impressions: number; clicks: number; spend: number; conv: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, spend: 0, conv: 0 });

// `edition` is hier weg: die diende alleen het pacing-blok ("nog N weken tot de beurs"),
// en dat staat nu in channel-pacing.tsx.
export function ChannelPerformance({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
  const cfg = CONFIG[channel];
  const [accountRuw, setAccount] = useState<DailyRow[] | null>(null);
  // De vorige inhoud blijft staan terwijl de nieuwe binnenkomt: bij een kanaalwissel klapte deze
  // kaart eerst terug naar een skelet en daarna weer vol. Zie lib/use-vorige.ts.
  const account = useVorige(accountRuw);
  const ververst = accountRuw === null && account !== null;
  const [campaign, setCampaign] = useState<DailyRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAccount(null); setError(null);
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.accountTable, { select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      // Campagne-dagdata over het volle venster: nodig zodra een beurs gekozen is, want de
      // account-tabel draagt geen campagnenaam en kan dus niet per beurs gesplitst worden.
      dbSelect<Record<string, unknown>>(cfg.campaignTable, { select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      dbSelect<Record<string, unknown>>(cfg.nameTable, { select: `${cfg.nameId}, name`, clientId }),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId }),
    ]).then(([accRes, campRes, nameRes, settingsRes]) => {
      if (cancelled) return;
      if (accRes.error) { setError(accRes.error.message); setAccount([]); return; }
      setAccount(((accRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setCampaign(((campRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setNames(new Map(((nameRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[cfg.nameId]), String(r.name ?? r[cfg.nameId])])));
      setConvConfig(resolveChannelConversionConfig((settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
    });
    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  // De conversie is de som van de geselecteerde velden voor dit kanaal (conversie-selectie).
  const convOf = (r: DailyRow) => sumSelectedConversions(r.convFields, cfg.channelKey, convConfig);
  const selectedLabels = selectedConversionLabels(cfg.channelKey, convConfig);
  const convLabel = selectedLabels.join(" + ");
  const useLeadsLabel = cfg.channelKey === "linkedin_ads"; // CPL vs CPA-naamgeving

  // Beurs-scope: de entiteiten waarvan de campagnenaam bij de gekozen geo-clone hoort. Zonder
  // scope is de bron de account-dagdata; mét scope her-aggregeren we uit de campagne-dagdata
  // (die wél namen draagt) — zelfde eerlijke aanpak als de Google-beursoverzichten.
  const matchedEntities = useMemo(() => {
    if (!geoClone) return null;
    const set = new Set<string>();
    for (const [entity, name] of names) {
      if (matchGeoCloneByCampaignName(name)?.abbreviation === geoClone) set.add(entity);
    }
    return set;
  }, [geoClone, names]);

  const derived = useMemo(() => {
    if (!account) return null;
    const source: DailyRow[] = geoClone
      ? campaign.filter((r) => matchedEntities?.has(r.entity))
      : account;
    if (geoClone && matchedEntities && matchedEntities.size === 0) return { empty: true } as const;
    if (source.length === 0) return null;
    const today = vandaag();
    const curMonth = today.slice(0, 7);

    // Maand-aggregatie (volle maanden, laatste 6).
    const byMonth = new Map<string, Agg>();
    for (const r of source) {
      const m = r.date.slice(0, 7);
      const a = byMonth.get(m) ?? emptyAgg();
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byMonth.set(m, a);
    }
    const fullMonths = [...byMonth.entries()].filter(([m]) => m < curMonth).sort().slice(-6);

    // KPI-vensters: laatste 28 dagen vs de 28 ervoor.
    const win = (from: number, to: number): Agg => {
      const a = emptyAgg();
      for (const r of source) {
        const age = (new Date(today).getTime() - new Date(r.date).getTime()) / 86_400_000;
        if (age >= from && age < to) { a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r); }
      }
      return a;
    };
    const recent = win(0, 28);
    const prior = win(28, 56);

    return { empty: false as const, fullMonths, recent, prior };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, campaign, convConfig, geoClone, matchedEntities]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (account === null) {
    return <Laadvlak vorm="grafiek" hoogte={220} />;
  }
  if (derived?.empty) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
        Geen {channel === "meta" ? "Meta" : "LinkedIn"}-campagnes die bij de gekozen beurs ({geoClone}) horen. De account-cijfers dragen geen campagnenaam en kunnen niet per beurs gesplitst worden.
      </div>
    );
  }
  if (!derived) return null; // geen data: de kanaaltab toont al de eerlijke lege staat

  const { fullMonths, recent, prior } = derived;
  const cpa = (a: Agg): number | null => (a.conv > 0 ? a.spend / a.conv : null);
  const ctr = (a: Agg): number | null => (a.impressions > 0 ? a.clicks / a.impressions : null);

  const kpis: { label: string; value: string; delta: number | null; hogerIsBeter: boolean }[] = [
    { label: "Spend (28d)", value: eur(recent.spend), delta: deltaPct(recent.spend, prior.spend), hogerIsBeter: false },
    { label: `${convLabel} (28d)`, value: fmt(recent.conv, 1), delta: deltaPct(recent.conv, prior.conv), hogerIsBeter: true },
    { label: useLeadsLabel ? "CPL (28d)" : "CPA (28d)", value: eur(cpa(recent)), delta: deltaPct(cpa(recent), cpa(prior)), hogerIsBeter: false },
    { label: "CTR (28d)", value: pctS(ctr(recent)), delta: deltaPct(ctr(recent), ctr(prior)), hogerIsBeter: true },
  ];

  return (
    <div className="space-y-6 transition-opacity duration-200" style={{ opacity: ververst ? 0.55 : 1 }} aria-busy={ververst}>
      {geoClone && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-meta text-blue-800">
          Beurs-scope <strong>{geoClone}</strong> actief: alle cijfers hieronder zijn her-geaggregeerd uit de
          campagnes die bij deze beurs horen (op basis van de campagnenaam).
        </div>
      )}
      {/* KPI-kaarten — in een getitelde kaart, zodat de opbouw rijmt met het Google-beursoverzicht. */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <BarChart3 className="w-4.5 h-4.5 text-brand-blue-ink" />
          <h3 className="text-title font-semibold text-brand-gray">Kerncijfers (laatste 28 dagen)</h3>
        </div>
        <div className="px-4 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card px-4 py-3 h-full">
              <Kerncijfer
                label={k.label}
                waarde={k.value}
                formaat="compact"
                // "Lead-formulieren + website-conversies (28d)" breekt over twee regels; met de
                // reservering blijven de vier getallen op één lijn.
                labelRegels={2}
                delta={k.delta != null ? { pct: k.delta, hogerIsBeter: k.hogerIsBeter, waartegen: "vs vorige 28d" } : undefined}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Het pacing-blok stond hier. Verhuisd naar components/dashboard/channel-pacing.tsx en
          naar de HERO van Meta en LinkedIn, direct onder Account Health -- dezelfde plek als
          Google's PacingMonitor, en dezelfde ringen. Het stond hier onderaan een lange sectie
          terwijl het de vraag beantwoordt die je bovenaan stelt. De rekenkern zit nu in
          lib/kanalen/maand-pacing.ts, zodat er niet twee definities van "vorige maand tot dezelfde
          dag" naast elkaar leven. */}

      {/* De maandverloop-grafiek stond hier. Verhuisd naar channel-monthly-chart.tsx en naar de
          rij naast de landencijfers: middenin deze sectie kon hij alleen over de volle breedte
          staan, terwijl zes maanden staven daar niet beter van worden en de kaart ernaast wél
          gezelschap kreeg. */}

      {/* Maandtabel */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />
          <h3 className="text-title font-semibold text-brand-gray">Per maand</h3>
        </div>
        {/* De gedeelde tabelcomponenten: zelfde ritme, sorteerbare opmaak, aandeelstrepen en een
            totaalregel als bij de dertien andere schermen. Handgeschreven <table> stond hier met
            een eigen kopstijl en zonder som.

            Aandeelstrepen alleen op wat optelt — spend, vertoningen, klikken, conversies. CTR en
            CPA zijn verhoudingen: daar bestaat geen geheel om een aandeel van te zijn, en bij CPA
            zou een lange streep "veel" zeggen waar het "duur" betekent. Zie data-table.tsx. */}
        {(() => {
          const rijen = [...fullMonths].reverse();
          const som = rijen.reduce((t, [, a]) => ({
            spend: t.spend + a.spend, impressions: t.impressions + a.impressions,
            clicks: t.clicks + a.clicks, conv: t.conv + a.conv,
          }), { spend: 0, impressions: 0, clicks: 0, conv: 0 });
          // De noemer is de GROOTSTE rij en niet de som — zo doen de dertien andere schermen het
          // ook (campaign-table, geo-breakdown, portfolio-scoreboard). Eerst deelde ik door het
          // totaal, en bij vijf ongeveer gelijke maanden is dat vijf keer ~20%: vijf stompjes van
          // een pixel of vijftien op een baan van 72, waar niets aan af te lezen valt. Tegen de
          // grootste rij krijgt de koploper een volle baan en zijn de verhoudingen zichtbaar.
          const grootste = rijen.reduce((t, [, a]) => ({
            spend: Math.max(t.spend, a.spend), impressions: Math.max(t.impressions, a.impressions),
            clicks: Math.max(t.clicks, a.clicks), conv: Math.max(t.conv, a.conv),
          }), { spend: 0, impressions: 0, clicks: 0, conv: 0 });
          const deel = (v: number, max: number) => (max > 0 ? v / max : 0);
          return (
            <Tabel>
              <Kop>
                <KolomKop breed>Maand</KolomKop>
                <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
                <KolomKop getal>Vertoningen</KolomKop>
                <KolomKop getal>Klikken</KolomKop>
                <KolomKop getal>CTR</KolomKop>
                <KolomKop getal>{convLabel}</KolomKop>
                <KolomKop getal>{useLeadsLabel ? "CPL" : "CPA"}</KolomKop>
              </Kop>
              <Body>
                {rijen.map(([m, a]) => (
                  <Rij key={m}>
                    <NaamCel>{maandVoluit(m)}</NaamCel>
                    <AandeelCel waarde={eur(a.spend)} aandeel={deel(a.spend, grootste.spend)} />
                    <AandeelCel waarde={fmt(a.impressions)} aandeel={deel(a.impressions, grootste.impressions)} />
                    <AandeelCel waarde={fmt(a.clicks)} aandeel={deel(a.clicks, grootste.clicks)} />
                    <GetalCel>{pctS(ctr(a))}</GetalCel>
                    <AandeelCel waarde={fmt(a.conv, 1)} aandeel={deel(a.conv, grootste.conv)} />
                    <GetalCel>{eur(cpa(a))}</GetalCel>
                  </Rij>
                ))}
              </Body>
              <TotaalRij>
                <TotaalCel>Totaal</TotaalCel>
                <TotaalCel getal>{eur(som.spend)}</TotaalCel>
                <TotaalCel getal>{fmt(som.impressions)}</TotaalCel>
                <TotaalCel getal>{fmt(som.clicks)}</TotaalCel>
                <TotaalCel getal>{pctS(ctr(som))}</TotaalCel>
                <TotaalCel getal>{fmt(som.conv, 1)}</TotaalCel>
                <TotaalCel getal>{eur(cpa(som))}</TotaalCel>
              </TotaalRij>
            </Tabel>
          );
        })()}
      </div>

      {/* De campagnetabel stond hier tot 22 augustus 2026 -- verhuisd naar de Campagnes-tab
          (channel-campaign-table.tsx), want deze view beantwoordt zelf al "hoe loopt het en waar
          komt het vandaan" en niet "wat draait er" (zie de toelichting bovenaan meta-view.tsx).
          Google's campagnetabel stond al op Campagnes; dit bracht Meta/LinkedIn op dezelfde
          indeling ("structuur exact hetzelfde" over de kanalen, feedback 22 augustus). */}
    </div>
  );
}
