"use client";

import { useState, useMemo } from "react";
import { Search, Globe } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import type { AccountStructureData } from "@/lib/use-client-data";
import { detectCountryFromName, countryLabel } from "@/lib/countries";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import {
  Tabel, Kop, KolomKop, SorteerKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel, TotaalRij, TotaalCel,
} from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { usePeriod } from "@/lib/period/period-context";
import { uitMaandPeriode, type DagPeriode } from "@/lib/period/dag-periode";
import { telCampagnes, vergelijkCampagnes, type CampagneRegel } from "@/lib/campagnes/campagne-periode";
import { useCampagnePeriode } from "@/lib/campagnes/use-campagne-periode";
import { CampagneStatusCel } from "./campagne-verandering";

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

/**
 * "Wat er draait" op het tabblad Google. Met de schakelaar uit (`nieuw` false) precies de tabel van
 * altijd, over de laatste 30 dagen uit de accountstructuur (CampaignTableVast, ongewijzigd). In de
 * nieuwe weergave over de gekozen periode per dag uit ads_campaign_daily (CampaignTablePeriode), met
 * dezelfde regels als de campagnetabellen van de andere kanalen (lib/campagnes/).
 */
export function CampaignTable(props: CampaignTableProps & { nieuw?: boolean }) {
  const { nieuw = false, ...rest } = props;
  return nieuw ? <CampaignTablePeriode {...rest} /> : <CampaignTableVast {...rest} />;
}

function CampaignTableVast({ clientId, geoClone, countryFilter: externalCountryFilter, onCountryFilterChange }: CampaignTableProps) {
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
  //
  // De waarde staat bewust buiten de memo. Binnenin stond `dataState?.detectedCountries` terwijl de
  // dependency-lijst dat pad ook noemde; de React-compiler leidde daaruit `dataState` af — breder
  // dan wat er stond — en sloeg het optimaliseren van dit hele component daarom over. Dat is de
  // grootste tabel van de pagina. Eén const ervoor en de afgeleide en de opgegeven afhankelijkheid
  // zijn weer dezelfde.
  const gedetecteerdeLanden = dataState?.detectedCountries;
  const countries = useMemo(() => {
    // If API provides detected countries from geo data, use those
    if (gedetecteerdeLanden && gedetecteerdeLanden.length > 0) {
      return gedetecteerdeLanden;
    }
    // Fallback: extract from campaign data
    const counts = new Map<string, number>();
    for (const c of campaigns) {
      if (c.country) counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);
  }, [campaigns, gedetecteerdeLanden]);

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
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm text-center">
        <p className="text-muted-foreground">Campagne data wordt geladen...</p>
      </div>
    );
  }

  // Bewust een functie die JSX oplevert en geen component: een component dat tijdens de render
  // wordt gedefinieerd, is elke render een nieuw type, en dan hangt React de hele kop opnieuw op.
  const sorteerKop = (col: SortKey, label: string, opties: { getal?: boolean; breed?: boolean } = {}) => (
    <SorteerKop
      key={col}
      getal={opties.getal}
      breed={opties.breed}
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
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        {/* flex-wrap + min-w-0: de samenvattingsregel plus land-/doelfilters pasten niet altijd
            naast elkaar op een telefoonbreed scherm en duwden de hele pagina breder i.p.v. zelf
            te breken. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            {/* De kaarttitel "Campagnes" is vervallen: die stond twee regels onder de sectiekop
                die hetzelfde zegt. De samenvattingsregel blijft — die draagt cijfers. */}
            <p className="text-meta text-muted-foreground">
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
                    countryFilter === null ? "bg-brand-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-brand-gray"
                  }`}
                >
                  Alle landen
                </button>
                {countries.map((code) => (
                  <button
                    key={code}
                    onClick={() => setCountryFilter(countryFilter === code ? null : code)}
                    className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                      countryFilter === code ? "bg-brand-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-brand-gray"
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
                  purposeFilter === null ? "bg-brand-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-brand-gray"
                }`}
              >
                Alle
              </button>
              {purposes.map((p) => (
                <button
                  key={p}
                  onClick={() => setPurposeFilter(purposeFilter === p ? null : p)}
                  className={`px-2 py-1 text-micro font-medium rounded-md transition-colors ${
                    purposeFilter === p ? "bg-brand-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-brand-gray"
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
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg w-40 focus:outline-none focus:border-brand-blue"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <Tabel>
        <Kop>
          {sorteerKop("name", "Campagne", { breed: true })}
          <KolomKop>Type</KolomKop>
          <KolomKop>Bidding</KolomKop>
          {sorteerKop("impressions", "Impressies", { getal: true })}
          {sorteerKop("spend", "Spend", { getal: true })}
          {sorteerKop("conversions", "Conv.", { getal: true })}
          {sorteerKop("cpa", "CPA", { getal: true })}
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

// ── De nieuwe weergave: over de gekozen periode, per dag ─────────────────────────────────────────
//
// De cijfers per campagne komen uit lib/campagnes (ads_campaign_daily, met voor hele maanden en het
// deel vóór de dagopslag ads_campaign_monthly, en het label van splitsOpDagOpslag), niet uit de
// 30-dagenvelden van de accountstructuur. De structuur levert alleen wat er per campagne vast staat:
// type, biedstrategie, doel, land en de advertentiegroepen, gekoppeld op het campagne-id (en op de
// naam als het id niet bekend is). Een campagne die in de periode liep maar niet in de structuur
// staat, staat er ook, met een streep voor wat de structuur zou zeggen: anders telt de tabel niet
// meer op tot het kanaal.
//
// De totaalrij draagt dezelfde merktekens als de andere campagnetabellen (data-cijfer
// "campagnes-totaal-*", data-kanaal="google"), maar alleen zonder filter: met een zoekterm, een doel,
// een land of een beurs is het de som van wat er staat en niet van het kanaal.

export interface PeriodeCampagne extends CampaignRow {
  regel: CampagneRegel;
}

type Structuur = AccountStructureData["campaigns"][number];

/** De regels van de periode met wat de structuur per campagne weet. Zuiver, voor de tests. */
export function campagnesMetStructuur(
  regels: readonly CampagneRegel[],
  structuur: readonly Structuur[],
  geoMap: Record<string, string> = {},
  sharesMap: Record<string, Record<string, number>> = {},
): PeriodeCampagne[] {
  const perId = new Map(structuur.map((c) => [String(c.id), c]));
  const perNaam = new Map(structuur.map((c) => [c.name, c]));
  return regels.map((r) => {
    const c = perId.get(r.sleutel) ?? perNaam.get(r.naam) ?? null;
    return {
      name: r.naam,
      type: c?.type ?? "",
      purpose: c?.purpose ?? "onbekend",
      bucketLabel: c?.bucketLabel ?? null,
      biddingStrategy: c?.biddingStrategy ?? "UNKNOWN",
      spend: r.spend,
      conversions: r.conversions,
      cpa: r.conversions > 0 ? r.spend / r.conversions : r.spend > 0 ? Infinity : 0,
      roas: 0,
      impressions: r.impressions,
      adGroupCount: c?.adGroupCount ?? 0,
      assetGroupCount: c?.assetGroupCount ?? 0,
      country: geoMap[r.naam] ?? detectCountryFromName(r.naam),
      countryShares: sharesMap[r.naam] ?? null,
      regel: r,
    };
  });
}

const GOOGLE: readonly ["google"] = ["google"];

/** De knopstijl van de filters, zoals in de vertrouwde tabel. */
function filterKnop(actief: boolean, kleur: "blauw" | "oranje"): string {
  const aan = kleur === "blauw" ? "bg-brand-blue text-white" : "bg-brand-orange text-white";
  const uit = kleur === "blauw" ? "bg-gray-100 text-muted-foreground hover:text-brand-gray" : "bg-orange-50 text-muted-foreground hover:text-brand-gray";
  return `px-2 py-1 text-micro font-medium rounded-md transition-colors ${actief ? aan : uit}`;
}

/** De tabel zelf, los van het laden, zodat hij te toetsen is. */
export function CampagneTabelGoogle({ campagnes, nu, metVergelijking, reden, vergelijkLabel, geoClone = null, countryFilter = null, onCountryFilterChange, landen = [] }: {
  campagnes: readonly PeriodeCampagne[];
  /** De telling van de periode: het kanaaltotaal (zonder filter) en het venster. */
  nu: { totaal: { spend: number; conversions: number; impressions: number }; label: string | null };
  metVergelijking: boolean;
  reden: string | null;
  vergelijkLabel: string;
  geoClone?: string | null;
  countryFilter?: string | null;
  onCountryFilterChange?: (country: string | null) => void;
  landen?: readonly string[];
}) {
  const [search, setSearch] = useState("");
  const [purposeFilter, setPurposeFilter] = useState<string | null>(null);
  const [localCountryFilter, setLocalCountryFilter] = useState<string | null>(null);
  const landFilter = onCountryFilterChange ? countryFilter : localCountryFilter;
  const setLandFilter = onCountryFilterChange ?? setLocalCountryFilter;
  const purposes = [...new Set(campagnes.map((x) => x.purpose))].sort();
  const gefilterd = !!(search || purposeFilter || landFilter || geoClone);
  const filtered = campagnes.filter((x) => {
    if (search && !x.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (purposeFilter && x.purpose !== purposeFilter) return false;
    if (landFilter && !((x.countryShares?.[landFilter] ?? 0) > 0 || x.country === landFilter)) return false;
    if (geoClone && matchGeoCloneByCampaignName(x.name)?.abbreviation !== geoClone) return false;
    return true;
  });
  // Zonder filter het kanaaltotaal over ALLE campagnerijen van de periode (ook die met alleen
  // vertoningen); met een filter de som van wat er staat.
  const som = gefilterd
    ? filtered.reduce((t, x) => ({ spend: t.spend + x.spend, conversions: t.conversions + x.conversions, impressions: t.impressions + x.impressions }), { spend: 0, conversions: 0, impressions: 0 })
    : nu.totaal;
  const grootsteSpend = Math.max(0, ...filtered.map((x) => x.spend));
  const grootsteConv = Math.max(0, ...filtered.map((x) => x.conversions));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 text-meta text-muted-foreground">
            {filtered.length} campagnes · {num(som.conversions)} conversies · {fmt(som.spend)} spend
          </p>
          <Vensterlabel
            soort="periode"
            perDag
            toevoeging={nu.label ? "deels per maand" : undefined}
            toevoegingUitleg={nu.label ?? undefined}
            className="ml-auto"
          />
        </div>
        {/* Het venster voluit als Google een deel per maand telde: de toevoeging in het label staat
            verder alleen in `title`, en die ziet niemand op een telefoon. */}
        {nu.label && <p data-campagne-venster className="text-meta text-muted-foreground">Google Ads: {nu.label}.</p>}
        {metVergelijking && reden && <p className="text-meta text-muted-foreground">{reden}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          {landen.length > 1 && (
            <div className="flex gap-1 items-center flex-wrap" role="group" aria-label="Land">
              <Globe className="w-3.5 h-3.5 text-muted-foreground mr-0.5" aria-hidden />
              <button type="button" aria-pressed={landFilter === null} onClick={() => setLandFilter(null)} className={filterKnop(landFilter === null, "oranje")}>Alle landen</button>
              {landen.map((code) => (
                <button type="button" key={code} aria-pressed={landFilter === code} onClick={() => setLandFilter(landFilter === code ? null : code)} className={filterKnop(landFilter === code, "oranje")}>
                  {countryLabel(code)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 flex-wrap" role="group" aria-label="Doel">
            <button type="button" aria-pressed={purposeFilter === null} onClick={() => setPurposeFilter(null)} className={filterKnop(purposeFilter === null, "blauw")}>Alle</button>
            {purposes.map((x) => (
              <button type="button" key={x} aria-pressed={purposeFilter === x} onClick={() => setPurposeFilter(purposeFilter === x ? null : x)} className={filterKnop(purposeFilter === x, "blauw")}>
                {PURPOSE_LABELS[x] ?? leesbaar(x)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            <input
              type="search"
              aria-label="Zoek een campagne"
              placeholder="Zoek..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg w-40 focus:outline-none focus:border-brand-blue"
            />
          </div>
        </div>
      </div>
      <Tabel>
        <Kop>
          <KolomKop breed>Campagne</KolomKop>
          <KolomKop>Type</KolomKop>
          <KolomKop>Bidding</KolomKop>
          <KolomKop getal>Impressies</KolomKop>
          <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
          <KolomKop getal bijschrift="aandeel">Conv.</KolomKop>
          <KolomKop getal>CPA</KolomKop>
          {metVergelijking && <KolomKop getal bijschrift={`t.o.v. ${vergelijkLabel.toLowerCase()}`}>Verandering</KolomKop>}
        </Kop>
        <Body>
          {filtered.map((x) => (
            <Rij key={x.regel.sleutel}>
              <NaamCel>
                <span className="inline-flex items-center gap-2 min-w-0" title={x.name}>
                  <span className="truncate">{x.name}</span>
                  {x.bucketLabel && <span className="text-micro font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">{x.bucketLabel}</span>}
                </span>
              </NaamCel>
              <Cel nowrap>
                {x.type
                  ? <span className={`text-micro font-semibold uppercase px-1.5 py-0.5 rounded ${PURPOSE_COLORS[x.purpose] ?? "bg-gray-100 text-gray-600"}`}>{PURPOSE_LABELS[x.purpose] ?? leesbaar(x.purpose)}</span>
                  : <span className="text-muted-foreground" title="Niet in de accountstructuur">—<span className="sr-only">niet in de accountstructuur</span></span>}
              </Cel>
              <Cel zacht nowrap>{x.type ? (BIDDING_LABELS[x.biddingStrategy] ?? leesbaar(x.biddingStrategy)) : "—"}</Cel>
              <GetalCel zacht>{num(x.impressions)}</GetalCel>
              <AandeelCel waarde={fmt(x.spend)} aandeel={grootsteSpend > 0 ? x.spend / grootsteSpend : 0} />
              <AandeelCel waarde={num(x.conversions)} aandeel={grootsteConv > 0 ? x.conversions / grootsteConv : 0} kleur={CHART_CATEGORICAL[2]} />
              <GetalCel>{x.cpa === 0 ? "—" : x.cpa === Infinity ? "∞" : fmt(x.cpa)}</GetalCel>
              {metVergelijking && <CampagneStatusCel r={x.regel} />}
            </Rij>
          ))}
        </Body>
        <TotaalRij>
          <TotaalCel>Totaal ({filtered.length})</TotaalCel>
          <TotaalCel>{""}</TotaalCel>
          <TotaalCel>{""}</TotaalCel>
          <TotaalCel getal>{num(som.impressions)}</TotaalCel>
          {/* data-cijfer alleen zonder filter: dan is dit het kanaaltotaal, zoals bij de andere
              campagnetabellen (campaigns-per-channel.tsx). */}
          <TotaalCel getal>{gefilterd ? fmt(som.spend) : <span data-cijfer="campagnes-totaal-kosten" data-kanaal="google">{fmt(som.spend)}</span>}</TotaalCel>
          <TotaalCel getal>{gefilterd ? num(som.conversions) : <span data-cijfer="campagnes-totaal-conversies" data-kanaal="google">{num(som.conversions)}</span>}</TotaalCel>
          <TotaalCel getal>{som.conversions > 0 ? fmt(som.spend / som.conversions) : "—"}</TotaalCel>
          {metVergelijking && <TotaalCel getal><span className="sr-only">geen verandering voor het totaal</span></TotaalCel>}
        </TotaalRij>
      </Tabel>
    </div>
  );
}

function CampaignTablePeriode({ clientId, geoClone, countryFilter, onCountryFilterChange }: CampaignTableProps) {
  const dataState = useClientDataState();
  const periode = usePeriod();
  const p: DagPeriode = periode.dag?.periode ?? uitMaandPeriode(periode.range);
  const c: DagPeriode | null = periode.dag
    ? (periode.dag.keuze.vergelijk === "none" ? null : periode.dag.vergelijking.periode)
    : (periode.compareRange ? uitMaandPeriode(periode.compareRange) : null);
  const vergelijkLabel = periode.dag ? periode.dag.vergelijking.label : "de vergelijkingsperiode";
  const staat = useCampagnePeriode({ clientId, kanalen: GOOGLE, periode: p, vergelijking: c, actief: true });

  const telling = useMemo(() => {
    const r = staat.rijen?.google;
    if (!r) return null;
    const bron = { kanaal: "google" as const, dagen: r.dagen, maanden: r.maanden, eersteDag: r.eersteDag, bronStart: r.bronStart };
    const nu = telCampagnes(p, bron);
    const toen = c ? telCampagnes(c, bron) : null;
    return { nu, toen, vergelijking: vergelijkCampagnes(nu, toen) };
    // De periodes op hun datums: een nieuw object met dezelfde datums rekent niet opnieuw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staat.rijen, p.start, p.eind, c?.start, c?.eind]);

  const structuur = dataState?.accountStructure?.campaigns;
  const geoMap = dataState?.campaignCountryMap;
  const sharesMap = dataState?.campaignCountryShares;
  const campagnes = useMemo(
    () => (telling ? campagnesMetStructuur(telling.vergelijking.regels, structuur ?? [], geoMap ?? {}, sharesMap ?? {}) : []),
    [telling, structuur, geoMap, sharesMap],
  );
  const gedetecteerdeLanden = dataState?.detectedCountries;
  const landen = useMemo(() => {
    if (gedetecteerdeLanden && gedetecteerdeLanden.length > 0) return gedetecteerdeLanden;
    const counts = new Map<string, number>();
    for (const x of campagnes) if (x.country) counts.set(x.country, (counts.get(x.country) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  }, [campagnes, gedetecteerdeLanden]);

  if (staat.fouten.length > 0) return <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{staat.fouten.join(" · ")}</div>;
  // Een laadvlak zolang de rijen de periode niet dekken: zie useCampagnePeriode.
  if (staat.laden || !telling) return <Laadvlak vorm="tabel" regels={6} />;
  if (campagnes.length === 0) return <p className="py-6 text-center text-body text-muted-foreground">Geen campagne die in deze periode liep.</p>;
  return (
    <CampagneTabelGoogle
      campagnes={campagnes}
      nu={telling.nu}
      metVergelijking={telling.toen !== null}
      reden={telling.vergelijking.reden}
      vergelijkLabel={vergelijkLabel}
      geoClone={geoClone}
      countryFilter={countryFilter ?? null}
      onCountryFilterChange={onCountryFilterChange}
      landen={landen}
    />
  );
}
