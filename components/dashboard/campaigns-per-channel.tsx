"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart3, Megaphone, Briefcase, Layers, Search } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Sectie } from "@/components/ui/sectie";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Laadvlak } from "@/components/ui/laadvlak";

// Campagne-overzicht over alle kanalen: op welke kanalen zijn we actief en welke campagnes
// draaien er per kanaal (beurs-gescoped op de afkorting in de campagnenaam). Leest de campagne-
// dagdata/maanddata direct uit Supabase en aggregeert per campagne over het recente venster.
// Vult het gat dat de blended-maandgrafiek liet: die toont spend-per-maand, niet de campagnes.

type ChannelKey = "google_ads" | "meta_ads" | "linkedin_ads" | "microsoft_ads";
interface CampaignAgg { name: string; spend: number; conversions: number }
interface ChannelBlock { channel: ChannelKey; label: string; convLabel: string; campaigns: CampaignAgg[] }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0));
const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmt = (v: number, d = 0): string => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);

const CHANNEL_META: Record<ChannelKey, { label: string; convLabel: string; icon: React.ReactNode }> = {
  google_ads: { label: "Google Ads", convLabel: "Conversies", icon: <BarChart3 className="w-4 h-4 text-brand-blue-ink" /> },
  meta_ads: { label: "Meta", convLabel: "Conversies", icon: <Megaphone className="w-4 h-4 text-brand-blue-ink" /> },
  linkedin_ads: { label: "LinkedIn", convLabel: "Leads", icon: <Briefcase className="w-4 h-4 text-brand-blue-ink" /> },
  microsoft_ads: { label: "Microsoft Ads", convLabel: "Conversies", icon: <Search className="w-4 h-4 text-brand-blue-ink" /> },
};

export function CampaignsPerChannel({ clientId, geoClone }: { clientId: string; geoClone?: string | null }) {
  const [blocks, setBlocks] = useState<ChannelBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlocks(null); setError(null);
    const sinceMonth = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const sinceDay = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

    async function load() {
      const [gRes, mNamesRes, mDailyRes, lNamesRes, lDailyRes, msNamesRes, msDailyRes] = await Promise.all([
        dbSelect<{ campaign_name: string | null; month: string; cost: number | null; conversions: number | null }>("ads_campaign_monthly", {
          select: "campaign_name, month, cost, conversions", clientId, filters: [{ op: "gte", column: "month", value: sinceMonth }],
        }),
        dbSelect<{ campaign_id: string; name: string | null }>("meta_campaigns", { select: "campaign_id, name", clientId }),
        dbSelect<{ entity_id: string; spend: number | null; conversions: number | null }>("meta_campaign_daily", {
          select: "entity_id, spend, conversions", clientId, filters: [{ op: "gte", column: "date", value: sinceDay }],
        }),
        dbSelect<{ campaign_urn: string; name: string | null }>("linkedin_campaigns", { select: "campaign_urn, name", clientId }),
        dbSelect<{ entity_urn: string; spend: number | null; one_click_leads: number | null }>("linkedin_campaign_daily", {
          select: "entity_urn, spend, one_click_leads", clientId, filters: [{ op: "gte", column: "date", value: sinceDay }],
        }),
        dbSelect<{ campaign_id: string; name: string | null }>("microsoft_campaigns", { select: "campaign_id, name", clientId }),
        dbSelect<{ entity_id: string; spend: number | null; conversions: number | null }>("microsoft_campaign_daily", {
          select: "entity_id, spend, conversions", clientId, filters: [{ op: "gte", column: "date", value: sinceDay }],
        }),
      ]);
      if (cancelled) return;

      // Google: uit ads_campaign_monthly (draagt campaign_name), aggregeer per campagne.
      const gMap = new Map<string, CampaignAgg>();
      for (const r of gRes.data ?? []) {
        const name = String(r.campaign_name ?? "");
        if (!name) continue;
        const a = gMap.get(name) ?? { name, spend: 0, conversions: 0 };
        a.spend += num(r.cost); a.conversions += num(r.conversions);
        gMap.set(name, a);
      }

      // Meta / LinkedIn: namen + dagdata per entiteit.
      const aggByEntity = (names: { id: string; name: string }[], daily: { entity: string; spend: number; conv: number }[]) => {
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        const map = new Map<string, CampaignAgg>();
        for (const d of daily) {
          const name = nameOf.get(d.entity) ?? d.entity;
          const a = map.get(name) ?? { name, spend: 0, conversions: 0 };
          a.spend += d.spend; a.conversions += d.conv;
          map.set(name, a);
        }
        return map;
      };
      const mMap = aggByEntity(
        mNamesRes.data.map((c) => ({ id: String(c.campaign_id), name: String(c.name ?? c.campaign_id) })),
        (mDailyRes.data ?? []).map((r) => ({ entity: String(r.entity_id), spend: num(r.spend), conv: num(r.conversions) })),
      );
      const lMap = aggByEntity(
        lNamesRes.data.map((c) => ({ id: String(c.campaign_urn), name: String(c.name ?? c.campaign_urn) })),
        (lDailyRes.data ?? []).map((r) => ({ entity: String(r.entity_urn), spend: num(r.spend), conv: num(r.one_click_leads) })),
      );
      const msMap = aggByEntity(
        msNamesRes.data.map((c) => ({ id: String(c.campaign_id), name: String(c.name ?? c.campaign_id) })),
        (msDailyRes.data ?? []).map((r) => ({ entity: String(r.entity_id), spend: num(r.spend), conv: num(r.conversions) })),
      );

      const scope = (rows: CampaignAgg[]) => rows
        .filter((c) => c.spend > 0 || c.conversions > 0)
        .filter((c) => !geoClone || matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone)
        .sort((a, b) => b.spend - a.spend);

      const built: ChannelBlock[] = ([
        { channel: "google_ads" as const, map: gMap },
        { channel: "meta_ads" as const, map: mMap },
        { channel: "linkedin_ads" as const, map: lMap },
        { channel: "microsoft_ads" as const, map: msMap },
      ]).map(({ channel, map }) => ({
        channel, label: CHANNEL_META[channel].label, convLabel: CHANNEL_META[channel].convLabel,
        campaigns: scope([...map.values()]),
      }));
      setBlocks(built);
    }
    load().catch((e) => { if (!cancelled) { setError(String(e)); setBlocks([]); } });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  const activeChannels = useMemo(() => (blocks ?? []).filter((b) => b.campaigns.length > 0), [blocks]);

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
            : `Actief op ${activeChannels.length} kanaal${activeChannels.length === 1 ? "" : "en"}: ${activeChannels.map((b) => `${b.label} (${b.campaigns.length})`).join(" · ")}.`
        }
      >

      {activeChannels.map((block) => (
        <div key={block.channel} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            {CHANNEL_META[block.channel].icon}
            <h3 className="text-title font-semibold text-brand-gray">{block.label}</h3>
            <span className="text-micro text-muted-foreground">{block.campaigns.length} campagne{block.campaigns.length === 1 ? "" : "s"}</span>
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
