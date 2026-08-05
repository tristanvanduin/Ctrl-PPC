/**
 * PMAX Expert Layer — deterministic PMAX intelligence signals.
 *
 * Computes structured PMAX insights from Supabase-resident data.
 * Used by SOP analysis and Second Opinion.
 *
 * Signals computed:
 * 1. Network mix quality (Search vs Display/Video drift)
 * 2. Asset group concentration / inefficiency
 * 3. Asset weakness / creative drag
 * 4. Placement waste risk
 * 5. Search category dilution
 * 6. Product inefficiency inside PMAX
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNetworkSplit, isBrowseNetwork } from "@/lib/pmax/network-split";

// ── Maandrijen samenvoegen per entiteit ────────────────────────────────────
// De PMax-tabellen dragen één rij per entiteit PER MAAND. Wie daar direct overheen filtert telt
// bij vier maanden data alles vier keer: "16 zoekcategorieën zonder conversies" waar het er vier
// zijn. En dat is nog de onschuldige helft — een categorie die in één maand niets opleverde maar
// in de andere drie wél, kwam er als verspilling uit, terwijl hij gewoon werkt.
//
// Drempels horen daarom op het totaal over het venster te liggen, niet op een losse maand. Dat is
// ook hoe de omliggende sommen (totale kosten, aandeel) al werkten; alleen de filters en de
// tellingen keken naar rijen.

// ── Het venster ────────────────────────────────────────────────────────────
// De drempels hieronder staan op een TOTAAL over meerdere maanden: "€20+ spend en 0 conversies",
// ">€10", ">5000 impressies". Tot nu toe was dat totaal de HELE historie, want geen van de
// queries had een ondergrens. Dat kost twee dingen.
//
// Het leest onbegrensd. Elke maand die een klant ooit had gaat mee, en die stapel groeit alleen
// maar. Bij twintig bureaus met twintig accounts is dat het verschil tussen een vaste leeslast
// en een die met de tijd meegroeit.
//
// En, minder zichtbaar maar erger: een drempel op een levenslang totaal dooft nooit uit. Een
// plaatsing die twee jaar geleden €25 verbrandde en sindsdien niet meer draait, blijft "€25
// verspild" melden zolang de rij bestaat. Het signaal wordt daarmee een archief in plaats van
// een waarneming. Dat gold ook voor de netwerkmix: die telde de kosten over alle jaren op, dus
// "40% van de spend gaat naar Display" ging over een gemiddelde dat niemand kan bijsturen.
//
// Vandaar één venster voor alle PMax-queries. Twaalf maanden: lang genoeg voor seizoen, kort
// genoeg om een vast plafond te zijn. Signaal 7 verderop houdt zijn eigen 90 dagen — een
// maand-op-maand vergelijking heeft er maar twee nodig.
//
// De .limit() op plaatsingen en zoekcategorieën betekende hiervoor trouwens weinig: "de 100
// duurste rijen" over vijf jaar heen kan uit vijf willekeurige maanden komen, en dan telt
// aggregateByEntity per entiteit een ander stuk geschiedenis op. Binnen een venster is die
// afkapping wél een afkapping van iets.
const VENSTER_MAANDEN = 12;

/** Eerste van de maand, VENSTER_MAANDEN terug. */
function vensterStart(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - VENSTER_MAANDEN, 1);
  return d.toISOString().slice(0, 10);
}

interface EntityTotals {
  label: string;
  cost: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

/**
 * Voegt maandrijen samen tot één rij per entiteit, op de opgegeven sleutelkolom.
 *
 * ── WAAROM DE SORTERING TWEE SLEUTELS HEEFT ─────────────────────────────────
 *
 * Hier stond alleen `b.cost - a.cost`. Voor plaatsingen en assetgroepen klopt dat, maar
 * zoekcategorieën komen van campaign_search_term_insight en dáár levert Google geen kosten
 * (zie de kop van getPmaxSearchCategoriesByMonth). Elke rij had dus cost 0, de vergelijking gaf
 * overal 0 terug, en de volgorde was de volgorde waarin de rijen toevallig binnenkwamen.
 *
 * Dat is geen cosmetisch verschil: de meldingen hieronder tonen `slice(0, 3)` en noemen dat de
 * grootste categorieën. Zonder tweede sleutel noemden ze de eerste drie. Impressies als
 * tiebreak maakt de volgorde weer een rangschikking op omvang.
 */
export function aggregateByEntity(rows: Array<Record<string, unknown>>, keyColumn: string): EntityTotals[] {
  const byKey = new Map<string, EntityTotals>();
  for (const r of rows) {
    const label = String(r[keyColumn] ?? "").trim();
    if (!label) continue;
    const acc = byKey.get(label) ?? { label, cost: 0, clicks: 0, conversions: 0, impressions: 0 };
    acc.cost += Number(r.cost) || 0;
    acc.clicks += Number(r.clicks) || 0;
    acc.conversions += Number(r.conversions) || 0;
    acc.impressions += Number(r.impressions) || 0;
    byKey.set(label, acc);
  }
  return [...byKey.values()].sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PmaxSignal {
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  confidence: "high" | "medium" | "low";
  affectedEntity?: string;
}

export interface PmaxInsights {
  hasPmaxCampaigns: boolean;
  campaignCount: number;
  signals: PmaxSignal[];
  networkMix: { network: string; costPct: number; convPct: number }[];
  assetGroupSummary: { name: string; cost: number; conversions: number; roas: number }[];
  /** Formatted text block for SOP prompt injection */
  promptContext: string;
}

// ── Main function ──────────────────────────────────────────────────────────

export async function computePmaxInsights(
  supabase: SupabaseClient,
  clientId: string
): Promise<PmaxInsights> {
  const signals: PmaxSignal[] = [];

  // Check if PMAX campaigns exist
  const { data: pmaxMeta } = await supabase
    .from("ads_campaign_metadata")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("campaign_type", "PERFORMANCE_MAX");

  const pmaxCampaigns = pmaxMeta ?? [];
  if (pmaxCampaigns.length === 0) {
    return {
      hasPmaxCampaigns: false, campaignCount: 0, signals: [],
      networkMix: [], assetGroupSummary: [], promptContext: "",
    };
  }

  // Fetch PMAX data in parallel.
  //
  // Kolommen bij naam, niet select("*"). Deze vijf tabellen dragen samen een kleine veertig
  // kolommen waarvan er hieronder tien gebruikt worden; de rest reisde mee over de lijn om
  // ongelezen weggegooid te worden. Bij naam noemen maakt bovendien zichtbaar wat een signaal
  // werkelijk nodig heeft — een kolom die verdwijnt geeft nu een fout in plaats van een stille
  // undefined.
  const vanaf = vensterStart();
  const [networkData, assetGroupData, assetData, placementData, searchCatData] = await Promise.all([
    supabase.from("ads_pmax_network_breakdown")
      .select("network_type, cost, conversions, conversions_value, impressions, clicks")
      .eq("client_id", clientId).gte("month", vanaf).order("cost", { ascending: false }),
    supabase.from("ads_asset_group_performance_monthly")
      .select("month, asset_group_name, cost, conversions, conversions_value")
      .eq("client_id", clientId).gte("month", vanaf).order("cost", { ascending: false }),
    supabase.from("ads_pmax_asset_performance")
      .select("month, asset_type, performance_label")
      .eq("client_id", clientId).gte("month", vanaf),
    // placement_type en conversions_value staan hier niet voor de signalen maar voor
    // buildPmaxPromptContext onderaan: die schrijft het plaatsingstype in de prompt en rekent er
    // de ROAS per zoekthema uit. Zonder die twee blijft alles draaien -- het type wordt een lege
    // string, de ROAS wordt "0" -- en dat is precies het soort stille schade dat select("*")
    // toedekt. Vandaar dat ze hier apart genoemd staan met de reden erbij.
    supabase.from("ads_pmax_placements")
      .select("placement, placement_type, cost, conversions, impressions")
      .eq("client_id", clientId).gte("month", vanaf).order("cost", { ascending: false }).limit(100),
    supabase.from("ads_pmax_search_categories")
      .select("category_label, cost, conversions, conversions_value, impressions")
      .eq("client_id", clientId).gte("month", vanaf).order("cost", { ascending: false }).limit(50),
  ]);

  const networks = (networkData.data ?? []) as Array<Record<string, unknown>>;
  const assetGroups = (assetGroupData.data ?? []) as Array<Record<string, unknown>>;
  const assets = (assetData.data ?? []) as Array<Record<string, unknown>>;
  const placements = (placementData.data ?? []) as Array<Record<string, unknown>>;
  const searchCats = (searchCatData.data ?? []) as Array<Record<string, unknown>>;

  // ── Signal 1: Network Mix Quality ──

  const networkMix: PmaxInsights["networkMix"] = [];
  // Dezelfde aggregatie als de donut op het scherm, niet een eigen kopie ernaast. Er stond hier
  // een losse optelling, en zodra buildNetworkSplit iets anders ging doen -- kanalen zonder enige
  // activiteit weglaten -- vertelde de prompt een ander verhaal dan de kaart. Eén bron.
  const slices = buildNetworkSplit(networks.map((n) => ({
    networkType: String(n.network_type ?? "UNKNOWN"),
    cost: Number(n.cost) || 0,
    conversions: Number(n.conversions) || 0,
    conversionsValue: Number(n.conversions_value) || 0,
    impressions: Number(n.impressions) || 0,
    clicks: Number(n.clicks) || 0,
  })));
  if (slices.length > 0) {
    const totalCost = slices.reduce((s, n) => s + n.cost, 0);
    const totalConv = slices.reduce((s, n) => s + n.conversions, 0);

    for (const s of slices) {
      networkMix.push({
        network: s.networkType,
        costPct: totalCost > 0 ? Math.round((s.cost / totalCost) * 100) : 0,
        convPct: totalConv > 0 ? Math.round((s.conversions / totalConv) * 100) : 0,
      });
    }

    // Alle bereikinventaris, niet alleen Display en YouTube: sinds API v23 splitst PMax ook
    // Maps, Discover en Gmail apart uit, en die stonden hier niet in. Een account waar een derde
    // van het budget naar Maps gaat kwam zo op nul procent uit.
    const browse = slices.filter((s) => isBrowseNetwork(s.networkType));
    const displayCost = browse.reduce((s, n) => s + n.cost, 0);
    const displayConv = browse.reduce((s, n) => s + n.conversions, 0);
    const displayCostPct = totalCost > 0 ? displayCost / totalCost : 0;
    const displayConvPct = totalConv > 0 ? displayConv / totalConv : 0;

    if (displayCostPct > 0.4 && displayConvPct < 0.15) {
      signals.push({
        type: "network_mix",
        severity: "high",
        title: "Display/Video domineert PMAX spend zonder evenredige conversies",
        description: `${Math.round(displayCostPct * 100)}% van PMAX spend gaat naar Display/Video, maar slechts ${Math.round(displayConvPct * 100)}% van conversies komt daaruit. PMAX groeit mogelijk via lage-kwaliteit inventory.`,
        confidence: "high",
      });
    }

    const searchCost = slices.find((s) => s.networkType === "SEARCH")?.cost ?? 0;
    const searchCostPct = totalCost > 0 ? searchCost / totalCost : 0;
    if (searchCostPct < 0.2 && totalCost > 100) {
      signals.push({
        type: "network_mix",
        severity: "medium",
        title: "Lage Search-aandeel in PMAX",
        description: `Slechts ${Math.round(searchCostPct * 100)}% van PMAX spend gaat naar Search. De campagne leunt zwaar op Display/Video/Shopping.`,
        confidence: "medium",
      });
    }
  }

  // ── Signal 2: Asset Group Concentration ──

  const assetGroupSummary: PmaxInsights["assetGroupSummary"] = [];
  if (assetGroups.length > 0) {
    // Get latest month data
    const months = [...new Set(assetGroups.map((a) => String(a.month)))].sort();
    const latestMonth = months[months.length - 1];
    const latestAG = assetGroups.filter((a) => String(a.month) === latestMonth);

    const totalCost = latestAG.reduce((s, a) => s + (Number(a.cost) || 0), 0);

    for (const ag of latestAG) {
      const cost = Number(ag.cost) || 0;
      const conv = Number(ag.conversions) || 0;
      const value = Number(ag.conversions_value) || 0;
      assetGroupSummary.push({
        name: String(ag.asset_group_name),
        cost,
        conversions: conv,
        roas: cost > 0 ? Math.round((value / cost) * 100) / 100 : 0,
      });
    }

    // Concentration check
    if (latestAG.length > 1) {
      const topAG = latestAG[0];
      const topCostPct = totalCost > 0 ? (Number(topAG.cost) || 0) / totalCost : 0;
      if (topCostPct > 0.7) {
        signals.push({
          type: "asset_group_concentration",
          severity: "medium",
          title: "Asset group concentratierisico",
          description: `${String(topAG.asset_group_name)} neemt ${Math.round(topCostPct * 100)}% van het PMAX budget. Spreiding over meerdere asset groups kan risico verlagen.`,
          confidence: "high",
          affectedEntity: String(topAG.asset_group_name),
        });
      }
    }

    // Zero-conversion asset groups
    const zeroConvAGs = latestAG.filter((a) => (Number(a.conversions) || 0) === 0 && (Number(a.cost) || 0) > 10);
    if (zeroConvAGs.length > 0) {
      const wasteCost = zeroConvAGs.reduce((s, a) => s + (Number(a.cost) || 0), 0);
      signals.push({
        type: "asset_group_waste",
        severity: "high",
        title: `${zeroConvAGs.length} asset group(s) zonder conversies`,
        description: `€${Math.round(wasteCost)} spend over ${zeroConvAGs.length} asset groups met 0 conversies: ${zeroConvAGs.map((a) => String(a.asset_group_name)).slice(0, 3).join(", ")}.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 3: Asset Weakness ──

  // Ook deze tabel draagt een rij per asset PER MAAND. De telling ging daar overheen, en dat is
  // hier gevaarlijker dan bij de categorieën: de drempel `>= 3` is niet schaal-invariant. Met vier
  // maanden data werd één zwakke asset er vier, dus een klant met precies één zwakke asset en geen
  // enkele sterke kreeg de melding "veel laag-presterende assets". Vals alarm, met een aanbeveling
  // eraan vast.
  //
  // We nemen de laatste maand, niet een optelling: een performance-label is een momentopname die
  // Google bijstelt, dus het meest recente label is het ware label. Zelfde aanpak als signaal 2.
  const laatsteAssetMaand = [...new Set(assets.map((a) => String(a.month)))].sort().pop();
  const huidigeAssets = assets.filter((a) => String(a.month) === laatsteAssetMaand);

  if (huidigeAssets.length > 0) {
    const lowPerf = huidigeAssets.filter((a) => String(a.performance_label) === "LOW");
    const bestPerf = huidigeAssets.filter((a) => String(a.performance_label) === "BEST");

    if (lowPerf.length > bestPerf.length * 2 && lowPerf.length >= 3) {
      signals.push({
        type: "asset_weakness",
        severity: "medium",
        title: "Veel laag-presterende assets",
        description: `${lowPerf.length} assets met label LOW vs ${bestPerf.length} met BEST. Creative vernieuwing kan performance verbeteren.`,
        confidence: "medium",
      });
    }

    // Check asset type coverage
    const types = new Set(huidigeAssets.map((a) => String(a.asset_type)));
    const hasImages = types.has("IMAGE") || types.has("MEDIA_BUNDLE");
    const hasVideo = types.has("YOUTUBE_VIDEO");
    if (!hasVideo && huidigeAssets.length > 5) {
      signals.push({
        type: "asset_coverage",
        severity: "low",
        title: "Geen video-assets in PMAX",
        description: "Toevoegen van YouTube video-assets kan YouTube en Display performance verbeteren.",
        confidence: "medium",
      });
    }
  }

  // ── Signal 4: Placement Waste ──

  if (placements.length > 0) {
    const wasteThreshold = 20; // €20+ over het hele venster
    const byPlacement = aggregateByEntity(placements, "placement");
    const wastePlacements = byPlacement.filter((p) => p.cost > wasteThreshold && p.conversions === 0);
    const totalWaste = wastePlacements.reduce((s, p) => s + p.cost, 0);

    if (wastePlacements.length > 0 && totalWaste > 50) {
      signals.push({
        type: "placement_waste",
        severity: "high",
        title: `€${Math.round(totalWaste)} verspild op plaatsingen zonder conversies`,
        description: `${wastePlacements.length} plaatsing(en) met >€${wasteThreshold} spend en 0 conversies. Top: ${wastePlacements.slice(0, 3).map((p) => p.label).join(", ")}.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 5: Search Category Dilution ──

  if (searchCats.length > 0) {
    // ── DEZE MELDING STOND OP EEN KOLOM DIE ALTIJD LEEG IS ────────────────────
    //
    // De drempel was `c.cost > 10` en het percentage was een aandeel van de search-spend.
    // campaign_search_term_insight levert geen kosten, dus cost was overal 0: geen enkele
    // categorie haalde de drempel en dit signaal is nooit één keer afgegaan. Een detector die
    // stilzwijgend niets doet is erger dan een detector die er niet is -- je denkt dat er
    // gekeken is.
    //
    // Impressies levert Google wél. Dezelfde vraag ("hoeveel bereik gaat naar thema's die niet
    // converteren"), gesteld in de eenheid die er is.
    const byCategory = aggregateByEntity(searchCats, "category_label");
    const totalImpr = byCategory.reduce((s, c) => s + c.impressions, 0);
    const zeroConvCats = byCategory.filter((c) => c.conversions === 0 && c.impressions > 500);
    const wasteImpr = zeroConvCats.reduce((s, c) => s + c.impressions, 0);

    if (zeroConvCats.length > 3 && totalImpr > 0 && wasteImpr > totalImpr * 0.2) {
      signals.push({
        type: "search_dilution",
        severity: "medium",
        title: "PMAX zoekt breed zonder conversies in meerdere categorieën",
        description: `${zeroConvCats.length} zoekcategorieën zonder conversies zijn samen goed voor ${Math.round((wasteImpr / totalImpr) * 100)}% van de zoekvertoningen. PMAX breidt mogelijk uit naar irrelevante zoekthema's. Wat dat kost is niet te zien: Google levert geen kosten per zoekcategorie.`,
        confidence: "medium",
      });
    }
  }

  // ── Signal 6: Search Category Quality & Language Leakage ──

  if (searchCats.length > 0) {
    // Detect foreign language search terms (PMAX expanding to non-targeted markets)
    const foreignPatterns = /[\u0600-\u06FF]|[\u0400-\u04FF]|[\u4E00-\u9FFF]|[\u3040-\u309F]|[\u30A0-\u30FF]/; // Arabic, Cyrillic, Chinese, Japanese
    const nonTargetLanguages = ["civciv", "makinesi", "kuluçka", "yumurta", "csirke", "keltetö", "wylegarnia", "chocadeira", "couveuse"]; // Common non-NL/DE/FR terms
    const categories = aggregateByEntity(searchCats, "category_label");
    const foreignTerms = categories.filter((c) => {
      const label = c.label.toLowerCase();
      return foreignPatterns.test(label) || nonTargetLanguages.some((t) => label.includes(t));
    });
    // GEEN EURO'S MEER IN DEZE MELDING.
    //
    // Hier stond "€X spend op termen in buitenlandse talen", met de severity gedrempeld op dat
    // bedrag. Google levert op campaign_search_term_insight helemaal geen kosten (zie de kop van
    // getPmaxSearchCategoriesByMonth); dat bedrag werd opgeteld uit een veld dat altijd leeg is.
    // Een euro-bedrag dat nergens vandaan komt is erger dan geen bedrag: er wordt op gestuurd.
    //
    // Impressies en klikken levert hij wél, en die dragen het verhaal net zo goed: waar PMax
    // vertoont in een taal die je niet target, adverteer je in een markt die je niet wilde.
    const foreignImpr = foreignTerms.reduce((s, c) => s + c.impressions, 0);
    const foreignClicks = foreignTerms.reduce((s, c) => s + c.clicks, 0);

    if (foreignTerms.length > 0 && foreignImpr > 500) {
      signals.push({
        type: "search_language_leakage",
        severity: foreignClicks > 100 ? "high" : "medium",
        title: `PMAX taal-lekkage: ${foreignTerms.length} zoekcategorieën in niet-getargete talen`,
        description: `${foreignImpr.toLocaleString("nl-NL")} impressies en ${foreignClicks.toLocaleString("nl-NL")} klikken op termen in buitenlandse talen (o.a. ${foreignTerms.slice(0, 3).map((c) => `"${c.label}"`).join(", ")}). PMAX breidt uit naar markten die niet getarget worden. Controleer taalinstellingen en voeg negatieve zoekwoorden toe. Kosten per zoekcategorie levert Google niet, dus wat dit kost is hier niet te zien.`,
        confidence: "high",
      });
    }

    // Analyze search category quality: high-impr zero-conv categories
    const highImprZeroConv = categories.filter((c) => c.impressions > 5000 && c.conversions === 0);
    if (highImprZeroConv.length > 0) {
      const wastedImpr = highImprZeroConv.reduce((s, c) => s + c.impressions, 0);
      signals.push({
        type: "search_category_waste",
        severity: "medium",
        title: `${highImprZeroConv.length} zoekcategorieën met >5K impressies maar 0 conversies`,
        description: `Categorieën zoals ${highImprZeroConv.slice(0, 3).map((c) => `"${c.label}"`).join(", ")} genereren samen ${wastedImpr.toLocaleString()} impressies zonder conversies. PMAX verspilt bereik op irrelevante zoekthema's.`,
        confidence: "high",
      });
    }
  }

  // ── Signal 7: PMAX vs Search/Shopping Cannibalization ──

  // Fetch campaign monthly data to detect PMAX growth vs Search/Shopping decline
  const { data: campMonthly } = await supabase
    .from("ads_campaign_monthly")
    .select("campaign_name, month, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .gte("month", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("month");

  if (campMonthly && campMonthly.length > 0) {
    const months = [...new Set(campMonthly.map((r) => String(r.month).slice(0, 7)))].sort();
    if (months.length >= 2) {
      const latestMonth = months[months.length - 1];
      const prevMonth = months[months.length - 2];

      const pmaxNames = new Set(pmaxCampaigns.map((c) => String(c.campaign_name)));
      let pmaxCostCur = 0, pmaxCostPrev = 0, pmaxConvCur = 0, pmaxConvPrev = 0;
      let otherCostCur = 0, otherCostPrev = 0, otherConvCur = 0, otherConvPrev = 0;

      for (const r of campMonthly) {
        const m = String(r.month).slice(0, 7);
        const isPmax = pmaxNames.has(String(r.campaign_name));
        const cost = Number(r.cost) || 0;
        const conv = Number(r.conversions) || 0;

        if (m === latestMonth) {
          if (isPmax) { pmaxCostCur += cost; pmaxConvCur += conv; }
          else { otherCostCur += cost; otherConvCur += conv; }
        } else if (m === prevMonth) {
          if (isPmax) { pmaxCostPrev += cost; pmaxConvPrev += conv; }
          else { otherCostPrev += cost; otherConvPrev += conv; }
        }
      }

      // Detect cannibalization: PMAX grows, others shrink, TOTAL doesn't grow proportionally
      const pmaxConvGrowth = pmaxConvPrev > 0 ? ((pmaxConvCur - pmaxConvPrev) / pmaxConvPrev) : 0;
      const otherConvGrowth = otherConvPrev > 0 ? ((otherConvCur - otherConvPrev) / otherConvPrev) : 0;
      const totalConvCur = pmaxConvCur + otherConvCur;
      const totalConvPrev = pmaxConvPrev + otherConvPrev;
      const totalGrowth = totalConvPrev > 0 ? ((totalConvCur - totalConvPrev) / totalConvPrev) : 0;

      if (pmaxConvGrowth > 0.2 && otherConvGrowth < -0.15) {
        const cannibalPct = totalGrowth < pmaxConvGrowth * 0.5 ? "hoog" : "mogelijk";
        signals.push({
          type: "pmax_cannibalization",
          severity: cannibalPct === "hoog" ? "critical" : "high",
          title: `PMAX cannibalisatie ${cannibalPct}: Search/Shopping conversies dalen terwijl PMAX groeit`,
          description: `PMAX conv. ${pmaxConvGrowth > 0 ? "+" : ""}${Math.round(pmaxConvGrowth * 100)}% MoM, Search/Shopping conv. ${Math.round(otherConvGrowth * 100)}% MoM. Totaal account groeit slechts ${Math.round(totalGrowth * 100)}%. PMAX lijkt conversies van bestaande campagnes over te nemen i.p.v. incrementeel te groeien.`,
          confidence: cannibalPct === "hoog" ? "high" : "medium",
        });
      }
    }
  }

  // ── Build prompt context ──

  const promptContext = buildPmaxPromptContext(pmaxCampaigns.length, signals, networkMix, assetGroupSummary, placements, searchCats);

  return {
    hasPmaxCampaigns: true,
    campaignCount: pmaxCampaigns.length,
    signals,
    networkMix,
    assetGroupSummary,
    promptContext,
  };
}

// ── Prompt context builder ─────────────────────────────────────────────────

function buildPmaxPromptContext(
  campaignCount: number,
  signals: PmaxSignal[],
  networkMix: PmaxInsights["networkMix"],
  assetGroupSummary: PmaxInsights["assetGroupSummary"],
  placements?: Array<Record<string, unknown>>,
  searchCats?: Array<Record<string, unknown>>
): string {
  if (campaignCount === 0) return "";

  const lines: string[] = [];
  lines.push(`\n\n## PMAX Intelligence (${campaignCount} campagne(s))`);

  if (networkMix.length > 0) {
    lines.push("\n### Network verdeling (waar gaat het PMAX budget naartoe?)");
    // Calculate efficiency ratio per network
    for (const n of networkMix) {
      const efficiency = n.costPct > 0 ? (n.convPct / n.costPct).toFixed(2) : "0";
      const label = Number(efficiency) > 1.2 ? "EFFICIËNT" : Number(efficiency) < 0.5 ? "INEFFICIËNT" : "NEUTRAAL";
      lines.push(`- ${n.network}: ${n.costPct}% spend → ${n.convPct}% conversies (efficiency ratio: ${efficiency} = ${label})`);
    }
  }

  if (assetGroupSummary.length > 0) {
    lines.push("\n### Asset group overzicht");
    const totalCost = assetGroupSummary.reduce((s, ag) => s + ag.cost, 0);
    for (const ag of assetGroupSummary.slice(0, 8)) {
      const share = totalCost > 0 ? Math.round((ag.cost / totalCost) * 100) : 0;
      lines.push(`- ${ag.name}: €${Math.round(ag.cost)} (${share}% van PMAX spend), ${Math.round(ag.conversions)} conv, ROAS ${ag.roas}x`);
    }
  }

  // Top search themes (what queries trigger PMAX?)
  if (searchCats && searchCats.length > 0) {
    lines.push("\n### PMAX Search Themes (welke zoekthema's triggeren PMAX?)");
    const topCats = searchCats.slice(0, 10);
    for (const cat of topCats) {
      const cost = Number(cat.cost) || 0;
      const conv = Number(cat.conversions) || 0;
      const label = String(cat.category_label || "Onbekend");
      const roas = cost > 0 ? ((Number(cat.conversions_value) || 0) / cost).toFixed(2) : "0";
      lines.push(`- "${label}": €${Math.round(cost)} spend, ${Math.round(conv)} conv, ROAS ${roas}x${conv === 0 && cost > 10 ? " ⚠️ GEEN CONVERSIES" : ""}`);
    }
  }

  // Top waste placements (where is budget leaking?)
  if (placements && placements.length > 0) {
    const wastePlacements = placements.filter((p) => (Number(p.cost) || 0) > 5 && (Number(p.conversions) || 0) === 0);
    if (wastePlacements.length > 0) {
      const totalWaste = wastePlacements.reduce((s, p) => s + (Number(p.cost) || 0), 0);
      lines.push(`\n### Placement waste (€${Math.round(totalWaste)} op plaatsingen zonder conversies)`);
      for (const p of wastePlacements.slice(0, 5)) {
        const placement = String(p.placement || "onbekend");
        const type = String(p.placement_type || "");
        lines.push(`- ${placement} (${type}): €${Math.round(Number(p.cost))} spend, ${Number(p.impressions)} impr, 0 conv`);
      }
    }
  }

  if (signals.length > 0) {
    lines.push("\n### PMAX signalen (voorberekend — gebruik deze conclusies)");
    for (const s of signals) {
      const icon = s.severity === "critical" ? "🔴" : s.severity === "high" ? "🟠" : s.severity === "medium" ? "🟡" : "🔵";
      lines.push(`- ${icon} [${s.severity.toUpperCase()}] ${s.title}`);
      lines.push(`  ${s.description}`);
    }
  }

  return lines.join("\n");
}
