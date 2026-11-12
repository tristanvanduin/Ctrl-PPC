"use client";

import { useState, useEffect, useMemo } from "react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Calendar, BarChart3 } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import type { ChannelConversionChannel } from "@/lib/analysis/channel-conversion-config";
import { KANAAL_DAGBRON, dagbronSelect } from "@/lib/analysis/channel-report-blend";
import type { BlendedKanaalMaand } from "@/lib/api/blended-historical";
import { today as vandaag } from "@/lib/reporting-date";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Kerncijfer } from "@/components/ui/kerncijfer";
import { useKanaalData } from "./channel-data-provider";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { usePeriod } from "@/lib/period/period-context";
import type { PeriodRange } from "@/lib/period/period-range";

// Volwaardige prestatie-view voor Meta, LinkedIn en Microsoft: dezelfde bouwstenen als Google
// (KPI-kaarten, pacing, maandtabel, grafiek, campagnetabel), gevoed uit de dag-tabellen van
// het kanaal. Ratio's UIT TOTALEN (venster/maand), nooit uit dag-gemiddelden. Pacing is
// maand-tot-nu tegen dezelfde dag-telling van de vorige maand: geen doel nodig, wel eerlijk
// tempo-inzicht. De analyses draaien elders (Analyses-tab); dit is de data-weergave.
//
// De data komt uit ChannelDataProvider (fase 1, stap 5): de dagrijen van de laatste weken voor de
// 28-dagenvensters, en de maanden met tellers voor de maandtabel -- beide uit het ene antwoord van
// /api/blended/client-data dat de band bij het laden al had. Hier stonden vier eigen lezingen
// (200 dagen account, 200 dagen campagnes, de campagnenamen en client_settings), waarvan de
// campagnedagrijen (het grootste verzoek van de tab, 57 kB) zonder gekozen beurs nooit gelezen
// werden. Die twee komen nu alleen nog als er een beurs gekozen is.

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

export type ChannelKind = "meta" | "linkedin" | "microsoft";

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
  campaignTable: string;
  nameTable: string;
  nameId: string;
  entityField: string;
  channelKey: ChannelConversionChannel;
  select: string;
  map: (r: Record<string, unknown>) => Omit<DailyRow, "entity"> & { entity: string };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Dezelfde kolommen als elke andere lezer van de dagtabel (dagbronSelect: de tellers plus ALLE
 * selecteerbare conversievelden), plus de entiteit voor de campagnetabellen. Hier stond per kanaal
 * een eigen lijst met dezelfde kolommen in een andere volgorde; twee lijsten voor dezelfde tabel
 * lopen bij de eerste wijziging uit elkaar. De kolommen staan in scripts/schema-snapshot.json
 * (de account- en campagnetabellen van een kanaal dragen dezelfde namen).
 */
const selectMet = (channelKey: ChannelConversionChannel): string =>
  `${dagbronSelect(channelKey)}, ${KANAAL_DAGBRON[channelKey].entityField}`;

// Geëxporteerd (22 augustus 2026) zodat channel-campaign-table.tsx dezelfde tabelnamen/mapping
// gebruikt -- de campagnetabel verhuisde naar de Campagnes-tab (feedback: "structuur exact
// hetzelfde" tussen kanalen, en de campagnetabel hoort bij "wat draait er", niet bij "hoe loopt
// het", zelfde tabsplitsing als deze view zelf al documenteert). Eén bron voor de kolomnamen
// voorkomt dat de twee views ooit een ander veld voor dezelfde kolom lezen.
//
// `map` verdraagt een rij zonder entiteit: de recente dagen van de blended route komen zonder
// (de accountrijen hebben hem op de tab niet nodig). De accounttabel zelf staat hier niet meer:
// geen component leest hem nog rechtstreeks, de route doet dat (KANAAL_DAGBRON).
export const CONFIG: Record<ChannelKind, ChannelConfig> = {
  meta: {
    campaignTable: "meta_campaign_daily",
    nameTable: "meta_campaigns",
    nameId: "campaign_id",
    entityField: "entity_id",
    channelKey: "meta_ads",
    select: selectMet("meta_ads"),
    map: (r) => ({ date: String(r.date), entity: String(r.entity_id ?? ""), impressions: num(r.impressions), clicks: num(r.link_clicks), spend: num(r.spend), convFields: { conversions: num(r.conversions), leads: num(r.leads) }, revenue: num(r.conversion_value) }),
  },
  linkedin: {
    campaignTable: "linkedin_campaign_daily",
    nameTable: "linkedin_campaigns",
    nameId: "campaign_urn",
    entityField: "entity_urn",
    channelKey: "linkedin_ads",
    select: selectMet("linkedin_ads"),
    map: (r) => ({ date: String(r.date), entity: String(r.entity_urn ?? ""), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), convFields: { one_click_leads: num(r.one_click_leads), external_website_conversions: num(r.external_website_conversions), post_click_conversions: num(r.post_click_conversions) }, revenue: num(r.conversion_value) }),
  },
  microsoft: {
    campaignTable: "microsoft_campaign_daily",
    nameTable: "microsoft_campaigns",
    nameId: "campaign_id",
    entityField: "entity_id",
    channelKey: "microsoft_ads",
    select: selectMet("microsoft_ads"),
    map: (r) => ({ date: String(r.date), entity: String(r.entity_id ?? ""), impressions: num(r.impressions), clicks: num(r.clicks), spend: num(r.spend), convFields: { conversions: num(r.conversions) }, revenue: num(r.conversion_value) }),
  },
};

const KANAAL_LABEL: Record<ChannelKind, string> = { meta: "Meta", linkedin: "LinkedIn", microsoft: "Microsoft" };

export const eur = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
export const fmt = (v: number | null, d = 0): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v));
export const pctS = (v: number | null): string => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(v));
// Het percentage als getal en niet als tekst. Als tekst moest de weergave de richting uit het
// plusteken afleiden (`startsWith("+") ? groen : rood`), en dat is fout zodra lager beter is: een
// CPL die met twaalf procent stijgt kleurde groen. Wie hoort te stijgen zegt de aanroeper.
const deltaPct = (cur: number | null, prev: number | null): number | null =>
  cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;

export interface Agg { impressions: number; clicks: number; spend: number; conv: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, spend: 0, conv: 0 });

/**
 * De rijen van de maandtabel uit de maanden van de route: alleen VOLLE maanden (vóór `dezeMaand`),
 * oplopend. De tellers komen één op één uit perKanaal[kanaal].maanden -- dezelfde cijfers die
 * "Alle kanalen" voor dit kanaal telt (lib/__kanaaltab_gelijk_alle_kanalen_test.ts).
 *
 * Met `periode`: de volle maanden van de gekozen periode (bouwplan fase 2), zodat de totaalregel
 * van de tabel het totaal van de band is. Zonder: de laatste zes, zoals het was; dat is het
 * venster van de beurs-scope, waar de maanden uit campagnedagrijen komen en niet verder reiken.
 */
export function volleMaandenUitTellers(
  maanden: readonly BlendedKanaalMaand[],
  dezeMaand: string,
  periode?: PeriodRange,
): [string, Agg][] {
  const rijen = maanden
    .filter((m) => m.month < dezeMaand)
    .filter((m) => !periode || (m.month.slice(0, 7) >= periode.start && m.month.slice(0, 7) <= periode.end))
    .map((m): [string, Agg] => [m.month, { impressions: m.impressions ?? 0, clicks: m.clicks ?? 0, spend: m.adSpend, conv: m.conversions }])
    .sort(([a], [b]) => a.localeCompare(b));
  return periode ? rijen : rijen.slice(-6);
}

// `edition` is hier weg: die diende alleen het pacing-blok ("nog N weken tot de beurs"),
// en dat staat nu in channel-pacing.tsx.
export function ChannelPerformance({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
  const cfg = CONFIG[channel];
  const { rijen: account, maanden, convVan, convLabel, fout } = useKanaalData();
  // De maandtabel volgt de gekozen periode (zonder beurs-scope); de kerncijfers erboven houden hun
  // 28 dagen, want die komen uit dagrijen en de periode is op maandkorrel. Beide zeggen in hun kop
  // welk venster ze gebruiken.
  const periode = usePeriod();
  const periodeStart = periode.range.start;
  const periodeEind = periode.range.end;
  // Alleen met een gekozen beurs: de account-tabel draagt geen campagnenaam en kan dus niet per
  // beurs gesplitst worden, dan her-aggregeren we uit de campagne-dagdata (die wél namen draagt).
  // Zonder beurs werden deze twee lezingen gedaan en nooit gebruikt. null = (nog) niet gelezen.
  const [campaign, setCampaign] = useState<DailyRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Zonder beurs komen de cijfers uit de provider; een campagnefout van een eerder gekozen beurs
    // hoort dan niet te blijven staan.
    if (!geoClone) { setError(null); return; }
    let cancelled = false;
    setCampaign(null); setError(null);
    const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.campaignTable, { select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      dbSelect<Record<string, unknown>>(cfg.nameTable, { select: `${cfg.nameId}, name`, clientId }),
    ]).then(([campRes, nameRes]) => {
      if (cancelled) return;
      if (campRes.error) { setError(campRes.error.message); setCampaign([]); return; }
      setCampaign(((campRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setNames(new Map(((nameRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[cfg.nameId]), String(r.name ?? r[cfg.nameId])])));
    });
    return () => { cancelled = true; };
  }, [clientId, cfg, geoClone]);

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
    if (!account || !maanden) return null;
    if (geoClone && campaign === null) return null;
    if (geoClone && matchedEntities && matchedEntities.size === 0) return { empty: true } as const;
    const today = vandaag();
    const curMonth = today.slice(0, 7);

    // Zonder beurs: de 28-dagenvensters uit de recente dagen, de maandtabel uit de tellers van de
    // route (de recente dagen dekken hooguit één volle maand). Met beurs: beide uit de
    // campagnedagrijen van 200 dagen, de enige bron die per beurs te splitsen is.
    const source: DailyRow[] = geoClone ? (campaign ?? []).filter((r) => matchedEntities?.has(r.entity)) : account;
    let fullMonths: [string, Agg][];
    if (geoClone) {
      const byMonth = new Map<string, Agg>();
      for (const r of source) {
        const m = r.date.slice(0, 7);
        const a = byMonth.get(m) ?? emptyAgg();
        a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convVan(r);
        byMonth.set(m, a);
      }
      fullMonths = [...byMonth.entries()].filter(([m]) => m < curMonth).sort().slice(-6);
    } else {
      fullMonths = volleMaandenUitTellers(maanden, curMonth, { start: periodeStart, end: periodeEind });
    }
    // Op ALLE volle maanden en niet op die van de periode: een lege periode is geen lege kaart.
    // Anders verdween het hele blok, kerncijfers incluis, zodra je een periode koos van vóór de
    // data van dit kanaal.
    if (source.length === 0 && (geoClone ? fullMonths.length === 0 : volleMaandenUitTellers(maanden, curMonth).length === 0)) return null;

    // KPI-vensters: laatste 28 dagen vs de 28 ervoor.
    const win = (from: number, to: number): Agg => {
      const a = emptyAgg();
      for (const r of source) {
        const age = (new Date(today).getTime() - new Date(r.date).getTime()) / 86_400_000;
        if (age >= from && age < to) { a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convVan(r); }
      }
      return a;
    };
    const recent = win(0, 28);
    const prior = win(28, 56);

    return { empty: false as const, fullMonths, recent, prior };
  }, [account, maanden, campaign, convVan, geoClone, matchedEntities, periodeStart, periodeEind]);

  if (fout || error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{fout ?? error}</div>;
  if (account === null || maanden === null || (geoClone && campaign === null)) {
    return <Laadvlak vorm="grafiek" hoogte={220} />;
  }
  if (derived?.empty) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
        Geen {KANAAL_LABEL[channel]}-campagnes die bij de gekozen beurs ({geoClone}) horen. De account-cijfers dragen geen campagnenaam en kunnen niet per beurs gesplitst worden.
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
    <div className="space-y-6">
      {geoClone && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-meta text-blue-800">
          Beurs-scope <strong>{geoClone}</strong> actief: alle cijfers hieronder zijn her-geaggregeerd uit de
          campagnes die bij deze beurs horen (op basis van de campagnenaam).
        </div>
      )}
      {/* KPI-kaarten — in een getitelde kaart, zodat de opbouw rijmt met het Google-beursoverzicht. */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <BarChart3 className="w-4.5 h-4.5 text-brand-blue-ink" />
          <h3 className="text-title font-semibold text-brand-gray">Kerncijfers (laatste 28 dagen)</h3>
          <Vensterlabel soort="vast" venster="laatste 28 dagen" />
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
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <Calendar className="w-4.5 h-4.5 text-brand-blue-ink" />
          <h3 className="text-title font-semibold text-brand-gray">Per maand</h3>
          {/* Zonder beurs-scope de gekozen periode; met beurs-scope de laatste zes volle maanden uit
              de campagnedagrijen, de enige bron die per beurs te splitsen is. */}
          {geoClone ? <Vensterlabel soort="vast" venster="laatste 6 maanden" /> : <Vensterlabel soort="periode" />}
        </div>
        {fullMonths.length === 0 && (
          <p className="px-5 py-8 text-center text-body text-muted-foreground">
            {geoClone ? "Nog geen volle maand met cijfers voor deze beurs." : "Dit kanaal heeft geen volle maand met cijfers in de gekozen periode."}
          </p>
        )}
        {/* De gedeelde tabelcomponenten: zelfde ritme, sorteerbare opmaak, aandeelstrepen en een
            totaalregel als bij de dertien andere schermen. Handgeschreven <table> stond hier met
            een eigen kopstijl en zonder som.

            Aandeelstrepen alleen op wat optelt — spend, vertoningen, klikken, conversies. CTR en
            CPA zijn verhoudingen: daar bestaat geen geheel om een aandeel van te zijn, en bij CPA
            zou een lange streep "veel" zeggen waar het "duur" betekent. Zie data-table.tsx. */}
        {fullMonths.length > 0 && (() => {
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
