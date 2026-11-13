"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart3, Megaphone, Briefcase, Layers, Search } from "lucide-react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import {
  conversionSourcesFor, resolveChannelConversionConfig, selectedConversionLabels, sumSelectedConversions,
  type ChannelConversionChannel, type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Sectie } from "@/components/ui/sectie";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Laadvlak } from "@/components/ui/laadvlak";
import { addDays, today } from "@/lib/reporting-date";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { formatMonth } from "@/lib/period/period-range";

/** De vensters van dit blok, in één functie zodat kop en query hetzelfde zeggen. */
export function campagneVensters(vandaag: string): { sinceDay: string; sinceMonth: string; dagLabel: string; maandLabel: string } {
  const sinceDay = addDays(vandaag, -89);
  // Google heeft alleen maandrijen per campagne. Dezelfde 90 dagen, afgerond op hele maanden: vanaf
  // de maand waarin het dagvenster begint. Hier stonden 200 dagen naast 90 voor de andere kanalen,
  // zonder label, en dan leest Google € 83.950 naast Meta € 35.305 als een verdeling over één periode.
  const sinceMonth = `${sinceDay.slice(0, 7)}-01`;
  return { sinceDay, sinceMonth, dagLabel: "laatste 90 dagen", maandLabel: `${formatMonth(sinceMonth.slice(0, 7), true)} t/m nu, hele maanden` };
}

// Campagne-overzicht over alle kanalen: op welke kanalen zijn we actief en welke campagnes
// draaien er per kanaal (beurs-gescoped op de afkorting in de campagnenaam). Leest de campagne-
// dagdata/maanddata direct uit Supabase en aggregeert per campagne over het recente venster.
// Vult het gat dat de blended-maandgrafiek liet: die toont spend-per-maand, niet de campagnes.

type ChannelKey = "google_ads" | "meta_ads" | "linkedin_ads" | "microsoft_ads";
export interface CampaignAgg { name: string; spend: number; conversions: number }
interface ChannelBlock { channel: ChannelKey; label: string; convLabel: string; telt: string | null; campaigns: CampaignAgg[] }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));
const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmt = (v: number, d = 0): string => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);

// LinkedIn heette hier "Leads": de tabel telde alleen de lead-formulieren. Nu telt hij de selectie
// van de klant (standaard lead-formulieren plus website-conversies), dus heet de kolom overal
// Conversies en staat bij het kanaal wat er meetelt.
const CHANNEL_META: Record<ChannelKey, { label: string; convLabel: string; icon: React.ReactNode }> = {
  google_ads: { label: "Google Ads", convLabel: "Conversies", icon: <BarChart3 className="w-4 h-4 text-brand-blue-ink" /> },
  meta_ads: { label: "Meta", convLabel: "Conversies", icon: <Megaphone className="w-4 h-4 text-brand-blue-ink" /> },
  linkedin_ads: { label: "LinkedIn", convLabel: "Conversies", icon: <Briefcase className="w-4 h-4 text-brand-blue-ink" /> },
  microsoft_ads: { label: "Microsoft Ads", convLabel: "Conversies", icon: <Search className="w-4 h-4 text-brand-blue-ink" /> },
};

// ── Campagne-dagdata van Meta, LinkedIn en Microsoft, met de conversieselectie van de klant ──
//
// Deze tabel had een eigen, vaste selectie: Meta telde alleen "conversions", LinkedIn alleen
// one_click_leads. Elders op het dashboard telt dezelfde campagne via sumSelectedConversions met
// wat de klant in Instellingen koos (standaard Meta aankopen + leads, LinkedIn lead-formulieren +
// website-conversies), dus kwam een campagne hier lager uit dan op het kanaaltabblad. Nu leest de
// query ALLE selecteerbare velden en bepaalt de selectie wat meetelt.

/** De campagne-dagtabel, de entiteitkolom en de namentabel per niet-Google-kanaal. */
export const CAMPAGNE_DAGBRON: Record<ChannelConversionChannel, { tabel: string; entiteit: string; namen: string; id: string }> = {
  meta_ads: { tabel: "meta_campaign_daily", entiteit: "entity_id", namen: "meta_campaigns", id: "campaign_id" },
  linkedin_ads: { tabel: "linkedin_campaign_daily", entiteit: "entity_urn", namen: "linkedin_campaigns", id: "campaign_urn" },
  microsoft_ads: { tabel: "microsoft_campaign_daily", entiteit: "entity_id", namen: "microsoft_campaigns", id: "campaign_id" },
};

/** De select op de campagne-dagtabel: entiteit, spend en alle selecteerbare conversievelden. */
export function campagneDagSelect(channel: ChannelConversionChannel): string {
  return [CAMPAGNE_DAGBRON[channel].entiteit, "spend", ...conversionSourcesFor(channel).map((s) => s.field)].join(", ");
}

/** Dagrijen per campagne -> totaal per campagnenaam. Conversies via de selectie van de klant. */
export function campagnesUitDagen(
  namen: Array<Record<string, unknown>>,
  dagen: Array<Record<string, unknown>>,
  channel: ChannelConversionChannel,
  convConfig: ChannelConversionConfig,
): CampaignAgg[] {
  const { entiteit, id } = CAMPAGNE_DAGBRON[channel];
  const naamVan = new Map(namen.map((c) => [String(c[id]), String(c.name ?? c[id])]));
  const per = new Map<string, CampaignAgg>();
  for (const r of dagen) {
    const e = String(r[entiteit]);
    const name = naamVan.get(e) ?? e;
    const a = per.get(name) ?? { name, spend: 0, conversions: 0 };
    a.spend += num(r.spend);
    a.conversions += sumSelectedConversions(r, channel, convConfig);
    per.set(name, a);
  }
  return [...per.values()];
}

export function CampaignsPerChannel({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const [blocks, setBlocks] = useState<ChannelBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlocks(null); setError(null);
    // Vanaf de Amsterdamse kalenderdag, niet de UTC-datum van de browserklok.
    const { sinceMonth, sinceDay } = campagneVensters(today());

    // Eén niet-Google-kanaal: de namen en de dagrijen van het venster, met alle conversievelden.
    const kanaal = (channel: ChannelConversionChannel) => {
      const bron = CAMPAGNE_DAGBRON[channel];
      return Promise.all([
        dbSelect<Record<string, unknown>>(bron.namen, { select: `${bron.id}, name`, clientId }),
        dbSelect<Record<string, unknown>>(bron.tabel, {
          select: campagneDagSelect(channel), clientId, filters: [{ op: "gte", column: "date", value: sinceDay }],
        }),
      ]);
    };

    async function load() {
      // De selectie van de klant laadt in dezelfde Promise.all als de rijen, zodat er nooit eerst een
      // telling met de standaardselectie staat die daarna verspringt.
      const [gRes, [mNamesRes, mDailyRes], [lNamesRes, lDailyRes], [msNamesRes, msDailyRes], settingsRes] = await Promise.all([
        dbSelect<{ campaign_name: string | null; month: string; cost: number | null; conversions: number | null }>("ads_campaign_monthly", {
          select: "campaign_name, month, cost, conversions", clientId, filters: [{ op: "gte", column: "month", value: sinceMonth }],
        }),
        kanaal("meta_ads"),
        kanaal("linkedin_ads"),
        kanaal("microsoft_ads"),
        dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId }),
      ]);
      if (cancelled) return;
      const convConfig = resolveChannelConversionConfig(
        (settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null,
      );

      // Google: uit ads_campaign_monthly (draagt campaign_name), aggregeer per campagne.
      const gMap = new Map<string, CampaignAgg>();
      for (const r of gRes.data ?? []) {
        const name = String(r.campaign_name ?? "");
        if (!name) continue;
        const a = gMap.get(name) ?? { name, spend: 0, conversions: 0 };
        a.spend += num(r.cost); a.conversions += num(r.conversions);
        gMap.set(name, a);
      }

      // Meta / LinkedIn / Microsoft: namen + dagdata per entiteit, geteld met de selectie.
      const mCampagnes = campagnesUitDagen(mNamesRes.data, mDailyRes.data, "meta_ads", convConfig);
      const lCampagnes = campagnesUitDagen(lNamesRes.data, lDailyRes.data, "linkedin_ads", convConfig);
      const msCampagnes = campagnesUitDagen(msNamesRes.data, msDailyRes.data, "microsoft_ads", convConfig);

      const scope = (rows: CampaignAgg[]) => rows
        .filter((c) => c.spend > 0 || c.conversions > 0)
        .filter((c) => !geoClone || matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone)
        .sort((a, b) => b.spend - a.spend);

      // Google telt de conversieacties die de sync al toepaste; bij de andere drie staat wat er telt.
      const built: ChannelBlock[] = ([
        { channel: "google_ads" as const, campagnes: [...gMap.values()] },
        { channel: "meta_ads" as const, campagnes: mCampagnes },
        { channel: "linkedin_ads" as const, campagnes: lCampagnes },
        { channel: "microsoft_ads" as const, campagnes: msCampagnes },
      ]).map(({ channel, campagnes }) => ({
        channel, label: CHANNEL_META[channel].label, convLabel: CHANNEL_META[channel].convLabel,
        telt: channel === "google_ads" ? null : selectedConversionLabels(channel, convConfig).join(" + "),
        campaigns: scope(campagnes),
      }));
      setBlocks(built);
    }
    load().catch((e) => { if (!cancelled) { setError(String(e)); setBlocks([]); } });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  const activeChannels = useMemo(() => (blocks ?? []).filter((b) => b.campaigns.length > 0), [blocks]);
  const vensters = campagneVensters(today());

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (blocks === null) return <Laadvlak vorm="tabel" regels={4} titel="Actieve kanalen &amp; campagnes" />;

  // De losse kaart bovenaan met titel en samenvatting is een Sectie geworden. Hij zei precies wat
  // een sectiekop zegt — wat je hier ziet en waarover — maar dan als kaart, waardoor dit het enige
  // tabblad was zonder de structuur die Google, Meta en LinkedIn wel hebben.
  return (
    <div className="space-y-4">
      <Sectie
        eerste
        icoon={<Layers className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel={`Wat er draait${geoClone ? ` — beurs ${geoClone}` : ""}`}
        bijschrift={
          activeChannels.length === 0
            ? "Geen actieve campagnes gevonden voor deze scope."
            : `Actief op ${activeChannels.length} ${activeChannels.length === 1 ? "kanaal" : "kanalen"}: ${activeChannels.map((b) => `${b.label} (${b.campaigns.length})`).join(" · ")}. Volgt de gekozen periode niet: elk kanaal noemt zijn eigen venster.`
        }
      >

      {activeChannels.map((block) => (
        <div key={block.channel} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            {CHANNEL_META[block.channel].icon}
            <h3 className="text-title font-semibold text-brand-gray">{block.label}</h3>
            <span className="text-micro text-muted-foreground">{block.campaigns.length} campagne{block.campaigns.length === 1 ? "" : "s"}</span>
            {block.telt && <span className="text-micro text-muted-foreground">· telt: {block.telt}</span>}
            <Vensterlabel soort="vast" venster={block.channel === "google_ads" ? vensters.maandLabel : vensters.dagLabel} className="ml-auto" />
          </div>
          {(() => {
            // Het aandeel wordt tegen de grootste campagne gezet en niet tegen de som: bij zeven
            // campagnes is elk aandeel-van-het-totaal klein, en dan zijn alle balkjes even kort.
            // Tegen de koploper afzetten laat de verhoudingen zien waar het om gaat.
            const grootsteSpend = Math.max(0, ...block.campaigns.map((c) => c.spend));
            const grootsteConv = Math.max(0, ...block.campaigns.map((c) => c.conversions));
            const totaalSpend = block.campaigns.reduce((s, c) => s + c.spend, 0);
            const totaalConv = block.campaigns.reduce((s, c) => s + c.conversions, 0);
            return (
              <Tabel>
                <Kop>
                  <KolomKop breed>Campagne</KolomKop>
                  <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
                  <KolomKop getal bijschrift="aandeel">{block.convLabel}</KolomKop>
                  <KolomKop getal>CPA</KolomKop>
                </Kop>
                <Body>
                  {block.campaigns.map((c) => (
                    <Rij key={c.name}>
                      <NaamCel>{c.name}</NaamCel>
                      {/* Twee strepen naast elkaar: kosten en opbrengst. Dát is de vraag die deze
                          tabel beantwoordt, en die vergelijking lieten we eerst aan het hoofd van
                          de lezer over. Nu zie je in één blik welke campagne meer budget krijgt
                          dan ze oplevert — dezelfde redenering waarom de PMax-ringen met twee
                          zijn en niet met één. */}
                      <AandeelCel waarde={eur(c.spend)} aandeel={grootsteSpend > 0 ? c.spend / grootsteSpend : 0} />
                      <AandeelCel
                        waarde={fmt(c.conversions, 1)}
                        aandeel={grootsteConv > 0 ? c.conversions / grootsteConv : 0}
                        kleur={CHART_CATEGORICAL[2]}
                      />
                      <GetalCel zacht>{c.conversions > 0 ? eur(c.spend / c.conversions) : "—"}</GetalCel>
                    </Rij>
                  ))}
                </Body>
                <TotaalRij>
                  <TotaalCel>Totaal</TotaalCel>
                  <TotaalCel getal>{eur(totaalSpend)}</TotaalCel>
                  <TotaalCel getal>{fmt(totaalConv, 1)}</TotaalCel>
                  <TotaalCel getal>{totaalConv > 0 ? eur(totaalSpend / totaalConv) : "—"}</TotaalCel>
                </TotaalRij>
              </Tabel>
            );
          })()}
        </div>
      ))}

      {/* De wereldkaart stond hier en is naar Overzicht verhuisd. "Waar komt het vandaan" is een
          overzichtsvraag, geen campagnevraag — en op de drie andere kanalen stond hij al op
          Overzicht. Zie cross-channel-view. */}
      </Sectie>
    </div>
  );
}
