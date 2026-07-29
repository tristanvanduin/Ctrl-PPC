"use client";

import { useState, useMemo } from "react";
import { Search, Globe } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";
import type { AccountStructureData } from "@/lib/use-client-data";
import { detectCountryFromName, countryLabel } from "@/lib/countries";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import {
  Tabel, Kop, KolomKop, SorteerKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel, TotaalRij, TotaalCel,
} from "./data-table";

interface CampaignRow {
  name: string;
  type: string;
  purpose: string;
  bucketLabel: string | null;
  biddingStrategy: string;
  spend: number;
  conversions: number;
  cpa: number;
  roas: number;
  impressions: number;
  adGroupCount: number;
  assetGroupCount: number;
  country: string | null;
  countryShares: Record<string, number> | null;
}

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

const PURPOSE_COLORS: Record<string, string> = {
  brand: "bg-blue-100 text-blue-700",
  generic: "bg-green-100 text-green-700",
  category: "bg-emerald-100 text-emerald-700",
  shopping: "bg-teal-100 text-teal-700",
  pmax: "bg-violet-100 text-violet-700",
  remarketing: "bg-orange-100 text-orange-700",
  awareness: "bg-cyan-100 text-cyan-700",
  competitor: "bg-red-100 text-red-700",
  dsa: "bg-amber-100 text-amber-700",
  display: "bg-pink-100 text-pink-700",
};

const PURPOSE_LABELS: Record<string, string> = {
  brand: "Brand",
  generic: "Generic",
  category: "Categorie",
  shopping: "Shopping",
  pmax: "PMax",
  remarketing: "Remarketing",
  awareness: "Awareness",
  competitor: "Concurrent",
  dsa: "DSA",
  display: "Display",
};

const BIDDING_LABELS: Record<string, string> = {
  TARGET_CPA: "tCPA",
  TARGET_ROAS: "tROAS",
  MAXIMIZE_CONVERSIONS: "Max Conv.",
  MAXIMIZE_CONVERSION_VALUE: "Max Value",
  MANUAL_CPC: "Manual CPC",
  ENHANCED_CPC: "eCPC",
  TARGET_SPEND: "Max Clicks",
  UNKNOWN: "—",
};

/**
 * Een enumwaarde waar geen vertaling voor is, leesbaar maken. Zonder dit stond er letterlijk
 * "DEMAND_CAPTURE" in een badge en "demand_capture" op een filterknop: rauwe database-inhoud in
 * de interface. Een onbekend doel hoort er niet anders uit te zien dan een bekend doel.
 */
function leesbaar(sleutel: string): string {
  const woorden = sleutel.replace(/_/g, " ").trim().toLowerCase();
  return woorden ? woorden.charAt(0).toUpperCase() + woorden.slice(1) : sleutel;
}

type SortKey = "name" | "spend" | "conversions" | "cpa" | "roas" | "impressions";

interface CampaignTableProps {
  clientId: string;
  geoClone?: string | null;
  countryFilter?: string | null;
  onCountryFilterChange?: (country: string | null) => void;
}

export function CampaignTable({ clientId, geoClone, countryFilter: externalCountryFilter, onCountryFilterChange }: CampaignTableProps) {
  const dataState = useClientDataState();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [purposeFilter, setPurposeFilter] = useState<string | null>(null);

  // Use external filter if provided, otherwise local state
  const [localCountryFilter, setLocalCountryFilter] = useState<string | null>(null);
  const countryFilter = externalCountryFilter !== undefined ? externalCountryFilter : localCountryFilter;
  const setCountryFilter = onCountryFilterChange ?? setLocalCountryFilter;

  const campaigns = useMemo((): CampaignRow[] => {
    const structure = dataState?.accountStructure;
    if (!structure) return [];

    const geoMap = dataState?.campaignCountryMap ?? {};
    const sharesMap = dataState?.campaignCountryShares ?? {};

    return structure.campaigns.map((c) => ({
      name: c.name,
      type: c.type,
      purpose: c.purpose,
      bucketLabel: c.bucketLabel,
      biddingStrategy: c.biddingStrategy,
      spend: c.cost30d,
      conversions: c.conversions30d,
      cpa: c.conversions30d > 0 ? c.cost30d / c.conversions30d : c.cost30d > 0 ? Infinity : 0,
      roas: 0,
      impressions: c.impressions30d,
      adGroupCount: c.adGroupCount,
      assetGroupCount: c.assetGroupCount,
      // Primary: geo data (real country from Google Ads). Fallback: campaign name parsing.
      country: geoMap[c.name] ?? detectCountryFromName(c.name),
      // All countries this campaign targets with spend shares
      countryShares: sharesMap[c.name] ?? null,
    }));
  }, [dataState?.accountStructure, dataState?.campaignCountryMap, dataState?.campaignCountryShares]);

  // Get unique purposes for filter
  const purposes = useMemo(() => {
    const set = new Set(campaigns.map((c) => c.purpose));
    return Array.from(set).sort();
  }, [campaigns]);

  // Get unique countries for filter — prefer API-detected countries (from geo data), fallback to campaign-derived
  const countries = useMemo(() => {
    // If API provides detected countries from geo data, use those
    if (dataState?.detectedCountries && dataState.detectedCountries.length > 0) {
      return dataState.detectedCountries;
    }
    // Fallback: extract from campaign data
    const counts = new Map<string, number>();
    for (const c of campaigns) {
      if (c.country) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);
  }, [campaigns, dataState?.detectedCountries]);

  const showCountryFilter = countries.length > 1;

  // Filter and sort
  const filtered = useMemo(() => {
    let result = campaigns;

    if (search) {
      const s = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(s));
    }
    if (purposeFilter) {
      result = result.filter((c) => c.purpose === purposeFilter);
    }
    if (countryFilter) {
      result = result.filter((c) => {
        // Show campaign if it has ANY spend in the selected country
        if (c.countryShares && (c.countryShares[countryFilter] ?? 0) > 0) return true;
        return c.country === countryFilter;
      });
    }
    if (geoClone) {
      result = result.filter((c) => matchGeoCloneByCampaignName(c.name)?.abbreviation === geoClone);
    }

    // Een kopie: zonder filters is `result` nog de array uit de campaigns-memo, en `sort` sorteert
    // in plaats. Dan schrijft deze memo in de uitvoer van een andere.
    result = [...result].sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortBy) {
        case "name": va = a.name; vb = b.name;
          return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        case "spend": va = a.spend; vb = b.spend; break;
        case "conversions": va = a.conversions; vb = b.conversions; break;
        case "cpa": va = a.cpa === Infinity ? 999999 : a.cpa; vb = b.cpa === Infinity ? 999999 : b.cpa; break;
        case "roas": va = a.roas; vb = b.roas; break;
        case "impressions": va = a.impressions; vb = b.impressions; break;
        default: return 0;
      }
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

    return result;
  }, [campaigns, search, purposeFilter, countryFilter, geoClone, sortBy, sortDir]);

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  // Totals
  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalConv = filtered.reduce((s, c) => s + c.conversions, 0);
  const avgCpa = totalConv > 0 ? totalSpend / totalConv : 0;

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm text-center">
        <p className="text-muted-foreground">Campagne data wordt geladen...</p>
      </div>
    );
  }

  const SortTh = ({ col, label, align, breed }: { col: SortKey; label: string; align?: string; breed?: boolean }) => (
    <SorteerKop
      getal={align === "right"}
      breed={breed}
      actief={sortBy === col}
      richting={sortDir}
      onSorteer={() => handleSort(col)}
    >
      {label}
    </SorteerKop>
  );

  // De strepen staan tegen de koploper en niet tegen de som: bij dertig campagnes is elk
  // aandeel-van-het-totaal klein, en dan zijn alle streepjes even kort.
  const grootsteSpend = Math.max(0, ...filtered.map((c) => c.spend));
  const grootsteConv = Math.max(0, ...filtered.map((c) => c.conversions));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">
              Campagnes
            </h3>
            <p className="text-meta text-muted-foreground mt-0.5">
              {filtered.length} campagnes · {num(totalConv)} conversies · {fmt(totalSpend)} spend · CPA {fmt(avgCpa)} (30 dagen)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Country filter pills (only if multi-country) */}
            {showCountryFilter && (
              <div className="flex gap-1 items-center">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mr-0.5" />
                <button
                  onClick={() => setCountryFilter(null)}
                  className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                    countryFilter === null ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                  }`}
                >
                  Alle landen
                </button>
                {countries.map((code) => (
                  <button
                    key={code}
                    onClick={() => setCountryFilter(countryFilter === code ? null : code)}
                    className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                      countryFilter === code ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                    }`}
                  >
                    {countryLabel(code)}
                  </button>
                ))}
              </div>
            )}
            {/* Purpose filter pills */}
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setPurposeFilter(null)}
                className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                  purposeFilter === null ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
                }`}
              >
                Alle
              </button>
              {purposes.map((p) => (
                <button
                  key={p}
                  onClick={() => setPurposeFilter(purposeFilter === p ? null : p)}
                  className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                    purposeFilter === p ? "bg-rm-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-rm-gray"
                  }`}
                >
                  {PURPOSE_LABELS[p] ?? leesbaar(p)}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Zoek..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg w-40 focus:outline-none focus:border-rm-blue"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <Tabel>
        <Kop>
          <SortTh col="name" label="Campagne" breed />
          <KolomKop>Type</KolomKop>
          <KolomKop>Bidding</KolomKop>
          <SortTh col="impressions" label="Impressies" align="right" />
          <SortTh col="spend" label="Spend" align="right" />
          <SortTh col="conversions" label="Conv." align="right" />
          <SortTh col="cpa" label="CPA" align="right" />
          <KolomKop getal>Structuur</KolomKop>
        </Kop>
        <Body>
          {filtered.map((campaign, i) => {
            const purposeColor = PURPOSE_COLORS[campaign.purpose] ?? "bg-gray-100 text-gray-600";
            const isZeroConv = campaign.conversions === 0 && campaign.spend > 0;
            const highCpa = campaign.cpa > avgCpa * 2 && campaign.cpa !== Infinity;

            return (
              <Rij key={i} className={isZeroConv ? "bg-red-50/30" : ""}>
                <NaamCel>
                  <span className="inline-flex items-center gap-2 min-w-0" title={campaign.name}>
                    <span className="truncate">{campaign.name}</span>
                    {campaign.bucketLabel && (
                      <span className="text-micro font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                        {campaign.bucketLabel}
                      </span>
                    )}
                  </span>
                </NaamCel>
                <Cel nowrap>
                  <span className={`text-micro font-semibold uppercase px-1.5 py-0.5 rounded ${purposeColor}`}>
                    {PURPOSE_LABELS[campaign.purpose] ?? leesbaar(campaign.purpose)}
                  </span>
                </Cel>
                <Cel zacht nowrap>{BIDDING_LABELS[campaign.biddingStrategy] ?? leesbaar(campaign.biddingStrategy)}</Cel>
                <GetalCel zacht>{num(campaign.impressions)}</GetalCel>
                {/* Strepen op spend en conversies — de twee optelbare kolommen. Ze staan naast
                    elkaar zodat je in één blik ziet welke campagne meer budget krijgt dan ze
                    oplevert; dat is de vraag die deze tabel beantwoordt. Op CPA staat er geen:
                    een verhouding heeft geen geheel, en laag is daar juist beter. */}
                <AandeelCel
                  waarde={fmt(campaign.spend)}
                  aandeel={grootsteSpend > 0 ? campaign.spend / grootsteSpend : 0}
                />
                <AandeelCel
                  waarde={
                    <span className={isZeroConv ? "text-red-500" : ""}>
                      {num(campaign.conversions)}
                      {isZeroConv && <span className="text-micro text-red-400 ml-1">⚠</span>}
                    </span>
                  }
                  aandeel={grootsteConv > 0 ? campaign.conversions / grootsteConv : 0}
                  kleur={CHART_CATEGORICAL[2]}
                />
                <GetalCel
                  className={
                    campaign.cpa === 0 ? "text-gray-300" :
                    campaign.cpa === Infinity ? "text-red-500 font-semibold" :
                    highCpa ? "text-red-500" : ""
                  }
                >
                  {campaign.cpa === 0 ? "—" : campaign.cpa === Infinity ? "∞" : fmt(campaign.cpa)}
                </GetalCel>
                <GetalCel zacht className="text-micro">
                  {campaign.adGroupCount > 0 && `${campaign.adGroupCount} AG`}
                  {campaign.assetGroupCount > 0 && `${campaign.assetGroupCount} ASG`}
                  {campaign.adGroupCount === 0 && campaign.assetGroupCount === 0 && "—"}
                </GetalCel>
              </Rij>
            );
          })}
        </Body>
        {/* De totaalrij volgt de filters. De regel in de kaartkop doet dat ook, maar staat ver van
            de kolommen af; hier sluit de som aan op de cijfers waar hij bij hoort. De CPA komt uit
            de totalen — een gemiddelde van campagne-CPA's weegt een campagne met één conversie
            even zwaar als een met tweehonderd. */}
        <TotaalRij>
          <TotaalCel>Totaal ({filtered.length})</TotaalCel>
          <TotaalCel>{""}</TotaalCel>
          <TotaalCel>{""}</TotaalCel>
          <TotaalCel getal>{num(filtered.reduce((s, c) => s + c.impressions, 0))}</TotaalCel>
          <TotaalCel getal>{fmt(totalSpend)}</TotaalCel>
          <TotaalCel getal>{num(totalConv)}</TotaalCel>
          <TotaalCel getal>{totalConv > 0 ? fmt(avgCpa) : "—"}</TotaalCel>
          <TotaalCel getal>{""}</TotaalCel>
        </TotaalRij>
      </Tabel>
    </div>
  );
}
