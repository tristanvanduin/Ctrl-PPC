"use client";

import { useState, useEffect, useMemo } from "react";
import { Calendar, TrendingUp, Gauge, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";
import { resolveChannelConversionConfig, sumSelectedConversions, selectedConversionLabels, type ChannelConversionConfig, type ChannelConversionChannel } from "@/lib/analysis/channel-conversion-config";
import { today as vandaag } from "@/lib/reporting-date";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { weeksToFair, type UpcomingEdition } from "@/lib/rai/fair-weeks";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useVorige } from "@/lib/use-vorige";
import { Kerncijfer } from "@/components/ui/kerncijfer";

// Volwaardige prestatie-view voor Meta en LinkedIn: dezelfde bouwstenen als Google
// (KPI-kaarten, pacing, maandtabel, grafiek, campagnetabel), gevoed uit de dag-tabellen van
// het kanaal. Ratio's UIT TOTALEN (venster/maand), nooit uit dag-gemiddelden. Pacing is
// maand-tot-nu tegen dezelfde dag-telling van de vorige maand: geen doel nodig, wel eerlijk
// tempo-inzicht. De analyses draaien elders (Analyses-tab); dit is de data-weergave.

type ChannelKind = "meta" | "linkedin";

interface DailyRow {
  date: string;
  entity: string;
  impressions: number;
  clicks: number;
  spend: number;
  // Ruwe conversievelden per naam; welke meetellen bepaalt de conversie-selectie per kanaal.
  convFields: Record<string, number>;
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

const CONFIG: Record<ChannelKind, ChannelConfig> = {
  meta: {
    accountTable: "meta_account_daily",
    campaignTable: "meta_campaign_daily",
    nameTable: "meta_campaigns",
    nameId: "campaign_id",
    entityField: "entity_id",
    channelKey: "meta_ads",
    select: "date, entity_id, impressions, link_clicks, spend, conversions, leads",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_id), impressions: num(r.impressions), clicks: num(r.link_clicks), spend: num(r.spend), convFields: { conversions: num(r.conversions), leads: num(r.leads) } }),
  },
  linkedin: {
    accountTable: "linkedin_account_daily",
    campaignTable: "linkedin_campaign_daily",
    nameTable: "linkedin_campaigns",
    nameId: "campaign_urn",
    entityField: "entity_urn",
    channelKey: "linkedin_ads",
    select: "date, entity_urn, impressions, clicks, spend, one_click_leads, external_website_conversions, post_click_conversions",
    map: (r) => ({ date: String(r.date), entity: String(r.entity_urn), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), convFields: { one_click_leads: num(r.one_click_leads), external_website_conversions: num(r.external_website_conversions), post_click_conversions: num(r.post_click_conversions) } }),
  },
};

const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const fmt = (v: number | null, d = 0): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v));
const pctS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
// Het percentage als getal en niet als tekst. Als tekst moest de weergave de richting uit het
// plusteken afleiden (`startsWith("+") ? groen : rood`), en dat is fout zodra lager beter is: een
// CPL die met twaalf procent stijgt kleurde groen. Wie hoort te stijgen zegt de aanroeper.
const deltaPct = (cur: number | null, prev: number | null): number | null =>
  cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;

interface Agg { impressions: number; clicks: number; spend: number; conv: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, spend: 0, conv: 0 });

export function ChannelPerformance({ clientId, channel, geoClone, edition }: { clientId: string; channel: ChannelKind; geoClone?: string | null; edition?: UpcomingEdition | null }) {
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
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setAccount(null); setError(null);
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      sb.from(cfg.accountTable).select(cfg.select).eq("client_id", clientId).gte("date", since),
      // Campagne-dagdata over het volle venster: nodig zodra een beurs gekozen is, want de
      // account-tabel draagt geen campagnenaam en kan dus niet per beurs gesplitst worden.
      sb.from(cfg.campaignTable).select(cfg.select).eq("client_id", clientId).gte("date", since),
      sb.from(cfg.nameTable).select(`${cfg.nameId}, name`).eq("client_id", clientId),
      sb.from("client_settings").select("channel_conversion_config").eq("client_id", clientId).maybeSingle(),
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

    // Pacing: maand-tot-nu vs dezelfde dag-telling vorige maand.
    const dayOfMonth = Number(today.slice(8, 10));
    const prevMonthDate = new Date(today); prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonth = prevMonthDate.toISOString().slice(0, 7);
    const mtd = emptyAgg(); const prevMtd = emptyAgg();
    for (const r of source) {
      const day = Number(r.date.slice(8, 10));
      if (r.date.slice(0, 7) === curMonth) { mtd.spend += r.spend; mtd.conv += convOf(r); }
      if (r.date.slice(0, 7) === prevMonth && day <= dayOfMonth) { prevMtd.spend += r.spend; prevMtd.conv += convOf(r); }
    }

    // Campagnetabel: laatste 28 dagen per campagne (bij beurs-scope alleen de matchende).
    const campSource = geoClone ? campaign.filter((r) => matchedEntities?.has(r.entity)) : campaign;
    const byCampaign = new Map<string, Agg>();
    for (const r of campSource) {
      const age = (new Date(today).getTime() - new Date(r.date).getTime()) / 86_400_000;
      if (age >= 28) continue;
      const a = byCampaign.get(r.entity) ?? emptyAgg();
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byCampaign.set(r.entity, a);
    }
    const campaigns = [...byCampaign.entries()].map(([entity, a]) => ({ entity, ...a })).sort((a, b) => b.spend - a.spend);

    return { empty: false as const, fullMonths, recent, prior, mtd, prevMtd, campaigns, dayOfMonth };
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

  const { fullMonths, recent, prior, mtd, prevMtd, campaigns, dayOfMonth } = derived;
  const wekenTotBeurs = edition ? weeksToFair(edition.fairDate, vandaag()) : null;
  const cpa = (a: Agg): number | null => (a.conv > 0 ? a.spend / a.conv : null);
  const ctr = (a: Agg): number | null => (a.impressions > 0 ? a.clicks / a.impressions : null);
  const chartData = fullMonths.map(([m, a]) => ({ maand: m, spend: Math.round(a.spend), lijn: Math.round(a.conv) }));
  const paceP = deltaPct(mtd.spend, prevMtd.spend);
  const pace = paceP == null ? null : `${paceP >= 0 ? "+" : ""}${Math.round(paceP)}%`;
  const pacePct = mtd.spend > 0 && prevMtd.spend > 0 ? mtd.spend / prevMtd.spend : null;

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
          <BarChart3 className="w-4.5 h-4.5 text-rm-blue-ink" />
          <h3 className="text-sm font-semibold text-rm-gray">Kerncijfers (laatste 28 dagen)</h3>
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

      {/* Pacing */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Gauge className="w-4.5 h-4.5 text-rm-blue-ink" />
          <h3 className="text-sm font-semibold text-rm-gray">Pacing — maand tot nu (dag {dayOfMonth})</h3>
          {/* Google telt inmiddels naar de beursdag; hier stond nog alleen de kalendermaand, en
              dan vertellen twee kanaaltabbladen naast elkaar een ander verhaal over dezelfde
              week. De maandvergelijking blijft staan — die voedt de cijfers hieronder — maar de
              afstand die er echt toe doet staat er nu bij. */}
          {wekenTotBeurs != null && wekenTotBeurs >= 0 && (
            <span className="ml-auto text-meta font-medium text-rm-blue-ink">
              nog {wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"} tot {edition!.label}
            </span>
          )}
        </div>
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-lead">
          <div>
            <div className="text-meta text-muted-foreground">Spend deze maand</div>
            <div className="font-semibold text-rm-gray">{eur(mtd.spend)} <span className="text-meta text-muted-foreground font-normal">(vorige maand op dag {dayOfMonth}: {eur(prevMtd.spend)})</span></div>
          </div>
          <div>
            <div className="text-meta text-muted-foreground">{convLabel} deze maand</div>
            <div className="font-semibold text-rm-gray">{fmt(mtd.conv, 1)} <span className="text-meta text-muted-foreground font-normal">(was {fmt(prevMtd.conv, 1)})</span></div>
          </div>
          <div>
            <div className="text-meta text-muted-foreground">Tempo vs vorige maand</div>
            <div className={`font-semibold ${pacePct != null && pacePct > 1.15 ? "text-amber-600" : "text-rm-gray"}`}>{pace ?? "—"}{pacePct != null && pacePct > 1.15 ? " (loopt voor)" : ""}</div>
          </div>
        </div>
      </div>

      {/* Maandverloop. Stond hier als eigen ComposedChart met spend links en conversies rechts —
          dezelfde dubbele as en dezelfde opbouw als MonthlyTrendChart, dus twee kopieën van
          hetzelfde probleem. Nu één component, dat de twee metrieken onder elkaar zet. */}
      <MonthlyTrendChart
        title="Maandverloop"
        lineLabel={convLabel}
        data={chartData.map((d) => ({ maand: d.maand, spend: d.spend, lijn: d.lijn }))}
      />

      {/* Maandtabel */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Calendar className="w-4.5 h-4.5 text-rm-blue-ink" />
          <h3 className="text-sm font-semibold text-rm-gray">Maandprestaties</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-medium">Maand</th>
                <th className="px-3 py-2 font-medium text-right">Spend</th>
                <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
                <th className="px-3 py-2 font-medium text-right">Klikken</th>
                <th className="px-3 py-2 font-medium text-right">CTR</th>
                <th className="px-3 py-2 font-medium text-right">{convLabel}</th>
                <th className="px-5 py-2 font-medium text-right">{useLeadsLabel ? "CPL" : "CPA"}</th>
              </tr>
            </thead>
            <tbody>
              {[...fullMonths].reverse().map(([m, a]) => (
                <tr key={m} className="border-b border-border/50">
                  <td className="px-5 py-1.5 text-muted-foreground">{m}</td>
                  <td className="px-3 py-1.5 text-right">{eur(a.spend)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.impressions)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.clicks)}</td>
                  <td className="px-3 py-1.5 text-right">{pctS(ctr(a))}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(a.conv, 1)}</td>
                  <td className="px-5 py-1.5 text-right">{eur(cpa(a))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campagnetabel */}
      {campaigns.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <BarChart3 className="w-4.5 h-4.5 text-rm-blue-ink" />
            <h3 className="text-sm font-semibold text-rm-gray">Campagnes (laatste 28 dagen)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-5 py-2 font-medium">Campagne</th>
                  <th className="px-3 py-2 font-medium text-right">Spend</th>
                  <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
                  <th className="px-3 py-2 font-medium text-right">Klikken</th>
                  <th className="px-3 py-2 font-medium text-right">CTR</th>
                  <th className="px-3 py-2 font-medium text-right">{convLabel}</th>
                  <th className="px-5 py-2 font-medium text-right">{useLeadsLabel ? "CPL" : "CPA"}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.entity} className="border-b border-border/50">
                    <td className="px-5 py-1.5 text-rm-gray font-medium">{names.get(c.entity) ?? c.entity}</td>
                    <td className="px-3 py-1.5 text-right">{eur(c.spend)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.impressions)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.clicks)}</td>
                    <td className="px-3 py-1.5 text-right">{pctS(ctr(c))}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(c.conv, 1)}</td>
                    <td className="px-5 py-1.5 text-right">{eur(cpa(c))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
