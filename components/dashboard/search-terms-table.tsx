"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useClientDataState } from "@/lib/client-data-provider";
import { matchGeoCloneByCampaignName } from "@/lib/rai/geo-clone-catalog";
import { detectSearchTermCountries } from "@/lib/countries";
import { SearchTermAnalysisTab } from "./search-term-analysis-tab";
import {
  Tabel, Kop, KolomKop, SorteerKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel, TotaalRij, TotaalCel,
} from "./data-table";

/**
 * De kleur van de aandeelstreep in deze drie tabellen. Rood en niet de merkkleur: alles wat hier
 * staat is geld dat niets opleverde, en een streep in de huiskleur zou dat als prestatie lezen.
 */
const VERSPIL_KLEUR = "#ef4444";

// Hele euro's, zoals overal elders in het dashboard. Met centen erbij las "€ 119,00" naast
// "€ 9.321" als een ander soort getal, terwijl het dezelfde grootheid is — en bij verspilling
// voegen twee decimalen niets toe aan de beslissing.
function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

type SortKey = "cost" | "clicks" | "term";

export function SearchTermsTable({ clientId, countryFilter, geoClone }: { clientId?: string; countryFilter?: string | null; geoClone?: string | null }) {
  const dataState = useClientDataState();
  const countryShares = dataState?.campaignCountryShares ?? {};
  const countryMap = dataState?.campaignCountryMap ?? {};

  // Check if a campaign has any spend in the selected country
  // Uses campaignCountryShares for multi-country attribution (>0% spend = included)
  // Falls back to dominant country map if shares unavailable
  const campaignMatchesCountry = (campaignName: string, country: string): boolean => {
    const shares = countryShares[campaignName];
    if (shares) return (shares[country] ?? 0) > 0;
    return countryMap[campaignName] === country;
  };

  // For search terms: also check the language of the search term itself.
  // This handles multi-country campaigns where all countries are in 1 campaign.
  // German terms → DE, French terms → FR, Dutch/neutral → NL + BE
  const termMatchesCountry = (searchTerm: string, campaignName: string, country: string): boolean => {
    // First: campaign-level geo attribution
    if (campaignMatchesCountry(campaignName, country)) {
      // If the campaign targets multiple countries, use language to narrow down
      const shares = countryShares[campaignName];
      const countryCount = shares ? Object.keys(shares).filter((k) => (shares[k] ?? 0) > 0).length : 1;
      if (countryCount <= 1) return true; // Single-country campaign, no need for language filter
      // Multi-country campaign: check if the search term language matches
      const termCountries = detectSearchTermCountries(searchTerm);
      return termCountries.includes(country);
    }
    return false;
  };

  // Filter all data by country if a country filter is active
  const allTerms = dataState?.wastefulSearchTerms ?? [];
  const allBleeders = dataState?.adGroupBleeders ?? [];
  const allProductBleeders = dataState?.productBleeders ?? [];

  const geoOk = (campaignName: string): boolean =>
    !geoClone || matchGeoCloneByCampaignName(campaignName)?.abbreviation === geoClone;

  const terms = allTerms.filter(
    (t) => geoOk(t.campaignName) && (!countryFilter || termMatchesCountry(t.searchTerm, t.campaignName, countryFilter))
  );
  const bleeders = allBleeders.filter(
    (b) => geoOk(b.campaignName) && (!countryFilter || campaignMatchesCountry(b.campaignName, countryFilter))
  );
  const productBleeders = allProductBleeders.filter(
    (p) => geoOk(p.campaignName) && (!countryFilter || campaignMatchesCountry(p.campaignName, countryFilter))
  );
  const resolvedClientId = clientId || (dataState?.googleAdsCustomerId ? `gads-${dataState.googleAdsCustomerId}` : "");
  const [subtab, setSubtab] = useState<"terms" | "adgroups" | "products" | "ai">("terms");
  const [sortBy, setSortBy] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  }

  const sortedTerms = useMemo(() => {
    return [...terms].sort((a, b) => {
      if (sortBy === "term") return sortDir === "asc" ? a.searchTerm.localeCompare(b.searchTerm) : b.searchTerm.localeCompare(a.searchTerm);
      if (sortBy === "clicks") return sortDir === "asc" ? a.clicks - b.clicks : b.clicks - a.clicks;
      return sortDir === "asc" ? a.cost - b.cost : b.cost - a.cost;
    });
  }, [terms, sortBy, sortDir]);

  const totalWaste = terms.reduce((s, t) => s + t.cost, 0);
  const totalBleederCost = bleeders.reduce((s, b) => s + b.cost, 0);
  const totalProductBleederCost = productBleeders.reduce((s, p) => s + p.cost, 0);

  // Zie campaign-table: een functie die JSX oplevert, geen component dat tijdens de render ontstaat.
  const sorteerKop = (col: SortKey, label: string, opties: { getal?: boolean; breed?: boolean; bijschrift?: string } = {}) => (
    <SorteerKop
      key={col}
      getal={opties.getal}
      breed={opties.breed}
      bijschrift={opties.bijschrift}
      actief={sortBy === col}
      richting={sortDir}
      onSorteer={() => handleSort(col)}
    >
      {label}
    </SorteerKop>
  );

  // Elke streep staat tegen de duurste regel in zijn eigen tabel: de vraag is welke term, ad group
  // of product het meeste weglekt, niet welk aandeel van de verspilling het is.
  const duursteTerm = Math.max(0, ...sortedTerms.map((t) => t.cost));
  const duursteBleeder = Math.max(0, ...bleeders.map((b) => b.cost));
  const duursteProduct = Math.max(0, ...productBleeders.map((p) => p.cost));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with subtabs */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setSubtab("terms")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "terms" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Verspilde zoektermen
            {terms.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-100 text-red-600">
                {terms.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("adgroups")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "adgroups" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Ad group bleeders
            {bleeders.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-100 text-red-600">
                {bleeders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("products")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "products" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            Product bleeders
            {productBleeders.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-micro font-bold rounded-full bg-red-100 text-red-600">
                {productBleeders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubtab("ai")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subtab === "ai" ? "bg-white text-rm-blue shadow-sm" : "text-muted-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              AI Analyse
            </span>
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {subtab === "terms"
            ? `${fmt(totalWaste)} verspild aan 0-conversie zoektermen (30d)`
            : subtab === "adgroups"
            ? `${fmt(totalBleederCost)} in ad groups met 0 conversies (30d)`
            : subtab === "products"
            ? `${fmt(totalProductBleederCost)} in producten met ROAS < 1 (30d)`
            : "AI-beoordeling van alle zoektermen"}
        </span>
      </div>

      {/* Search terms table */}
      {subtab === "terms" && (
        terms.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen verspilde zoektermen gevonden. Goed bezig!
          </div>
        ) : (
          <Tabel>
            <Kop>
              {sorteerKop("term", "Zoekterm", { breed: true })}
              <KolomKop>Campagne</KolomKop>
              <KolomKop>Ad Group</KolomKop>
              {sorteerKop("clicks", "Clicks", { getal: true })}
              {sorteerKop("cost", "Kosten", { getal: true, bijschrift: "aandeel" })}
              <KolomKop getal>Conv.</KolomKop>
            </Kop>
            <Body>
              {sortedTerms.map((term, i) => (
                <Rij key={i}>
                  <NaamCel>
                    <span className="inline-flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate">{term.searchTerm}</span>
                    </span>
                  </NaamCel>
                  <Cel zacht nowrap className="text-micro">{term.campaignName}</Cel>
                  <Cel zacht nowrap className="text-micro">{term.adGroupName}</Cel>
                  <GetalCel>{term.clicks}</GetalCel>
                  {/* De streep op kosten: deze tabel bestaat om te zien wáár het weglekt, en dan
                      is de vraag welke termen het meeste kosten — niet of ze samen honderd
                      procent zijn. Vandaar tegen de duurste term en niet tegen de som. */}
                  <AandeelCel
                    waarde={<span className="text-red-500">{fmt(term.cost)}</span>}
                    aandeel={duursteTerm > 0 ? term.cost / duursteTerm : 0}
                    kleur={VERSPIL_KLEUR}
                  />
                  <GetalCel className="text-red-500 font-semibold">0</GetalCel>
                </Rij>
              ))}
            </Body>
            <TotaalRij>
              <TotaalCel>Totaal verspild ({sortedTerms.length})</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
              <TotaalCel getal>{sortedTerms.reduce((s, t) => s + t.clicks, 0)}</TotaalCel>
              <TotaalCel getal><span className="text-red-600">{fmt(totalWaste)}</span></TotaalCel>
              <TotaalCel getal>0</TotaalCel>
            </TotaalRij>
          </Tabel>
        )
      )}

      {/* Ad group bleeders table */}
      {subtab === "adgroups" && (
        bleeders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen ad group bleeders gevonden.
          </div>
        ) : (
          <Tabel>
            <Kop>
              <KolomKop breed>Ad Group</KolomKop>
              <KolomKop>Campagne</KolomKop>
              <KolomKop getal>Impressies</KolomKop>
              <KolomKop getal>Clicks</KolomKop>
              <KolomKop getal bijschrift="aandeel">Kosten</KolomKop>
              <KolomKop getal>Conv.</KolomKop>
            </Kop>
            <Body>
              {bleeders.map((ag, i) => (
                <Rij key={i}>
                  <NaamCel>
                    <span className="inline-flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate">{ag.adGroupName}</span>
                    </span>
                  </NaamCel>
                  <Cel zacht nowrap className="text-micro">{ag.campaignName}</Cel>
                  <GetalCel zacht>{ag.impressions.toLocaleString("nl-NL")}</GetalCel>
                  <GetalCel>{ag.clicks}</GetalCel>
                  <AandeelCel
                    waarde={<span className="text-red-500">{fmt(ag.cost)}</span>}
                    aandeel={duursteBleeder > 0 ? ag.cost / duursteBleeder : 0}
                    kleur={VERSPIL_KLEUR}
                  />
                  <GetalCel className="text-red-500 font-semibold">0</GetalCel>
                </Rij>
              ))}
            </Body>
            <TotaalRij>
              <TotaalCel>Totaal verspild ({bleeders.length})</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
              <TotaalCel getal>{bleeders.reduce((s, b) => s + b.impressions, 0).toLocaleString("nl-NL")}</TotaalCel>
              <TotaalCel getal>{bleeders.reduce((s, b) => s + b.clicks, 0)}</TotaalCel>
              <TotaalCel getal><span className="text-red-600">{fmt(totalBleederCost)}</span></TotaalCel>
              <TotaalCel getal>0</TotaalCel>
            </TotaalRij>
          </Tabel>
        )
      )}

      {/* Product bleeders table */}
      {subtab === "products" && (
        productBleeders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Geen product bleeders gevonden.
          </div>
        ) : (
          <Tabel>
            <Kop>
              <KolomKop breed>Product</KolomKop>
              <KolomKop>Campagne</KolomKop>
              <KolomKop getal>Impressies</KolomKop>
              <KolomKop getal>Clicks</KolomKop>
              <KolomKop getal bijschrift="aandeel">Kosten</KolomKop>
              <KolomKop getal>Conv.</KolomKop>
            </Kop>
            <Body>
              {productBleeders.map((p, i) => (
                <Rij key={i}>
                  <NaamCel sub={p.productId || undefined}>
                    <span className="inline-flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate">{p.productTitle}</span>
                    </span>
                  </NaamCel>
                  <Cel zacht nowrap className="text-micro">{p.campaignName}</Cel>
                  <GetalCel zacht>{p.impressions.toLocaleString("nl-NL")}</GetalCel>
                  <GetalCel>{p.clicks}</GetalCel>
                  <AandeelCel
                    waarde={<span className="text-red-500">{fmt(p.cost)}</span>}
                    aandeel={duursteProduct > 0 ? p.cost / duursteProduct : 0}
                    kleur={VERSPIL_KLEUR}
                  />
                  <GetalCel className="text-red-500 font-semibold">0</GetalCel>
                </Rij>
              ))}
            </Body>
            <TotaalRij>
              <TotaalCel>Totaal verspild ({productBleeders.length})</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
              <TotaalCel getal>{productBleeders.reduce((s, p) => s + p.impressions, 0).toLocaleString("nl-NL")}</TotaalCel>
              <TotaalCel getal>{productBleeders.reduce((s, p) => s + p.clicks, 0)}</TotaalCel>
              <TotaalCel getal><span className="text-red-600">{fmt(totalProductBleederCost)}</span></TotaalCel>
              <TotaalCel getal>0</TotaalCel>
            </TotaalRij>
          </Tabel>
        )
      )}
      {/* AI Analysis tab */}
      {subtab === "ai" && resolvedClientId && (
        <SearchTermAnalysisTab clientId={resolvedClientId} />
      )}

      {subtab === "ai" && !resolvedClientId && (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Geen client ID beschikbaar voor AI-analyse.
        </div>
      )}
    </div>
  );
}
