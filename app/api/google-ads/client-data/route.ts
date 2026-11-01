import { NextRequest } from "next/server";
import { isSeededDemo, seededDemoClientData } from "@/lib/demo/geoclone-demo-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { eis } from "@/lib/analysis/db-veilig";
import { dashboardConversionActionIds } from "@/lib/analysis/channel-conversion-config";
import { liveDataStand, gerealiseerdTotMaand } from "@/lib/api/client-data-stand";
import { HISTORIE_JAREN } from "@/lib/api/google-vergelijking";
import { googleWeekVensters } from "@/lib/api/google-weekvensters";
import { today, addDays } from "@/lib/reporting-date";
import {
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getCampaignImpressionShare,
  getConversionActions,
  getAccountStructure,
  getWastefulSearchTerms,
  getAdGroupPerformance,
  getProductGroupPerformance,
  getChangeHistory,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import {
  googleAdsMonthlyToApiData,
  googleAdsWeeklyByYear,
  type YearDataInput,
} from "@/lib/api/adapter";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";
import { standaardJaardoel } from "@/lib/analysis/standaard-jaardoel";


/**
 * Fetch all dashboard data for a single Google Ads client account.
 * Returns monthly + weekly data for 2024, 2025, and 2026 (YTD),
 * plus campaign-level data for the current year.
 *
 * Query params:
 *   customerId - Google Ads customer ID (no dashes)
 */
export async function GET(request: NextRequest) {
  const demoCid = request.nextUrl.searchParams.get("customerId");
  // Ontbreekt de parameter, dan is dat een fout van de aanroeper. Zonder deze regel viel de
  // route door naar de credentials-controle en kwam er een 500 uit: "de server is stuk",
  // terwijl het verzoek zelf niet klopte.
  if (!demoCid) return Response.json({ error: "customerId is verplicht" }, { status: 400 });
  // Demoklanten (GreenTech en de geo-clones): Google uit de geseede database, zonder Google Ads te
  // bellen. Dezelfde database waaruit Meta, LinkedIn en Microsoft in de KPI-band komen (/api/data,
  // service role) -- niet de demo-mock van supabaseForClient, want dan telde de band weer twee
  // werelden op. GreenTech kreeg hier eerst een JS-fixture; zie seededDemoClientData.
  if (isSeededDemo(demoCid)) {
    const sb = getSupabaseAdmin();
    if (!sb) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
    try {
      return Response.json(await seededDemoClientData(sb, demoCid));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Onbekende fout" }, { status: 500 });
    }
  }

  const credentials = credentialsUitOmgeving();
  if (!credentials) {
    return Response.json({ error: "Google Ads API not configured" }, { status: 500 });
  }

  const customerId = request.nextUrl.searchParams.get("customerId");
  if (!customerId) {
    return Response.json({ error: "customerId is required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  try {
    // Welke conversieacties meetellen, uit client_settings.conversion_actions: dezelfde lijst
    // waarmee de sync ads_account_monthly vult (orchestrator). Dit kwam eerst als queryparameter
    // uit een localStorage-kopie in de browser, en die is pas gevuld nadat het dashboard één keer
    // geladen is: een eerste bezoek vroeg ongefilterd, een tweede gefilterd. Een leesfout wordt een
    // 500 en geen stille terugval op "alles": ongefilterde cijfers zien er net zo geloofwaardig uit.
    // Zonder Supabase-configuratie (lokaal zonder database) is er geen selectie om te lezen.
    let convActionIds: string[] | undefined;
    if (sb) {
      const instellingen = eis(
        await sb.from("client_settings").select("conversion_actions").eq("client_id", `gads-${customerId}`).limit(1),
        "client_settings (conversieacties)",
      ) as { conversion_actions?: unknown }[];
      convActionIds = dashboardConversionActionIds(instellingen[0]?.conversion_actions);
    }

    // ── Determine year range dynamically ──────────────────────────────
    // Het Amsterdamse jaar: new Date().getFullYear() is het lokale jaar van het serverproces,
    // en dat draait in UTC. Op oudejaarsavond na 23:00 Amsterdamse tijd zou dat het vorige jaar
    // opleveren en het historievenster een jaar mis laten lopen.
    const currentYear = Number(today().slice(0, 4));
    // Gedeeld met het portfolio-scorebord: dat zoekt de start van een account even ver terug.
    const firstHistoricalYear = currentYear - HISTORIE_JAREN;
    // De weken gesplitst op een maandag in plaats van op 1 januari: anders valt de week over de
    // jaarwisseling in twee stukken en verdwijnt het januari-stuk (zie googleWeekVensters).
    const weekVensters = googleWeekVensters(currentYear, firstHistoricalYear);

    // Fetch ALL historical data in 2 bulk calls (one date range) instead of per-year.
    // This reduces API calls from 10+ to just 2 for all history.
    const [
      allHistoricalMonthlyRaw,
      allHistoricalWeeklyRaw,
      currentYearMonthlyRaw,
      currentYearWeeklyRaw,
      campaignsPrevYearRaw,
      campaignsCurrentYearRaw,
      impressionShareRaw,
      conversionActionsRaw,
      accountStructureRaw,
      wastefulSearchTermsRaw,
      adGroupPerformanceRaw,
      productGroupPerformanceRaw,
      changeHistoryRaw,
    ] = await Promise.all([
      getAccountMetricsByMonth(credentials, customerId, `${firstHistoricalYear}-01-01`, `${currentYear - 1}-12-31`, convActionIds),
      getAccountMetricsByWeek(credentials, customerId, weekVensters.historie.van, weekVensters.historie.tot, convActionIds),
      getAccountMetricsByMonth(credentials, customerId, `${currentYear}-01-01`, `${currentYear}-12-31`, convActionIds),
      getAccountMetricsByWeek(credentials, customerId, weekVensters.lopend.van, weekVensters.lopend.tot, convActionIds),
      getCampaignMetricsByMonth(credentials, customerId, `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`, convActionIds),
      getCampaignMetricsByMonth(credentials, customerId, `${currentYear}-01-01`, `${currentYear}-12-31`, convActionIds),
      getCampaignImpressionShare(credentials, customerId, addDays(today(), -90), today()),
      getConversionActions(credentials, customerId),
      getAccountStructure(credentials, customerId),
      getWastefulSearchTerms(credentials, customerId),
      getAdGroupPerformance(credentials, customerId),
      getProductGroupPerformance(credentials, customerId),
      getChangeHistory(credentials, customerId),
    ]);

    // Split bulk historical data into per-year buckets
    const allHistoricalMonthly = googleAdsMonthlyToApiData(allHistoricalMonthlyRaw);

    // Google Ads returns segments.month as "YYYY-MM-01", parseMonth extracts month number.
    // We need year info too — extract from the raw date strings.
    const parseYear = (dateStr: string): number => parseInt(dateStr.split("-")[0], 10);

    // Group monthly data by year
    const monthlyByYear = new Map<number, typeof allHistoricalMonthly>();
    for (let i = 0; i < allHistoricalMonthlyRaw.length; i++) {
      const year = parseYear(allHistoricalMonthlyRaw[i].date);
      if (!monthlyByYear.has(year)) monthlyByYear.set(year, []);
      monthlyByYear.get(year)!.push(allHistoricalMonthly[i]);
    }

    // Weekrijen per jaar, gesplitst op de ruwe rij vóór de omzetting. Hier stond een koppeling op
    // index (raw[i] bij mapped[i]), maar de omzetting groepeerde per maand en husselde de volgorde:
    // weken kwamen in het verkeerde jaar terecht. De maandomzetting hierboven is wel één-op-één
    // (een map), dus daar mag de index blijven.
    const weeklyByYear = googleAdsWeeklyByYear(allHistoricalWeeklyRaw);

    // Build per-year data, filter out empty years
    const historicalYearsData: YearDataInput[] = [];
    for (let y = firstHistoricalYear; y < currentYear; y++) {
      const monthly = monthlyByYear.get(y) ?? [];
      const weekly = weeklyByYear.get(y) ?? [];
      if (monthly.some((m) => m.conversions > 0 || m.adSpend > 0)) {
        historicalYearsData.push({ year: y, monthly, weekly });
      }
    }

    const currentYearMonthly = googleAdsMonthlyToApiData(currentYearMonthlyRaw);
    const currentYearWeekly = googleAdsWeeklyByYear(currentYearWeeklyRaw).get(currentYear) ?? [];

    // Gerealiseerd is t/m de laatste VOLLE maand: de live API levert t/m gisteren. Hier stond
    // `new Date().getMonth()`, de UTC-maand van de server naast een Amsterdams jaar; op de eerste
    // van de maand tussen 00:00 en 02:00 viel de net afgesloten maand daardoor weg. dataStand gaat
    // mee in het antwoord: het venster van de KPI-band eindigt erop (PeriodProvider).
    const dataStand = liveDataStand();
    const realizedThroughMonth = gerealiseerdTotMaand(dataStand, currentYear, currentYearMonthly.map((m) => m.month));

    // De gedeelde terugval (lib/analysis/standaard-jaardoel.ts) zolang er geen doel is ingevoerd.
    const lastFullYear = historicalYearsData.length > 0
      ? historicalYearsData[historicalYearsData.length - 1]
      : null;

    const targetCurrentYear = standaardJaardoel(lastFullYear === null ? null : {
      conversions: lastFullYear.monthly.reduce((s, m) => s + m.conversions, 0),
      revenue: lastFullYear.monthly.reduce((s, m) => s + m.revenue, 0),
      adSpend: lastFullYear.monthly.reduce((s, m) => s + m.adSpend, 0),
    });

    // Campaign data — includes all statuses (ENABLED, PAUSED, REMOVED)
    // so historical performance of paused/removed campaigns is preserved
    const mapCampaign = (c: (typeof campaignsCurrentYearRaw)[number]) => ({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      campaignStatus: c.campaignStatus,
      month: c.date,
      conversions: Math.round(c.conversions),
      revenue: Math.round(c.conversionsValue),
      adSpend: Math.round(c.cost),
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      avgCpc: c.avgCpc,
      conversionRate: c.conversionRate,
    });

    const campaigns = campaignsCurrentYearRaw.map(mapCampaign);
    const campaignsHistorical = campaignsPrevYearRaw.map(mapCampaign);

    // Impression share data for budget expansion analysis
    const impressionShare = impressionShareRaw.map((is) => ({
      campaignId: is.campaignId,
      campaignName: is.campaignName,
      campaignType: is.campaignType,
      cost: Math.round(is.cost),
      conversions: Math.round(is.conversions),
      searchImpressionShare: is.searchImpressionShare,
      searchBudgetLostIS: is.searchBudgetLostIS,
      searchRankLostIS: is.searchRankLostIS,
      dailyBudget: Math.round(is.dailyBudget),
      budgetUtilization: parseFloat(is.budgetUtilization.toFixed(2)),
    }));

    // Conversion actions for the settings panel
    const conversionActions = conversionActionsRaw
      .filter((ca) => ca.status !== "REMOVED")
      .map((ca) => ({
        id: ca.id,
        name: ca.name,
        category: ca.category,
        status: ca.status,
        type: ca.type,
        primaryForGoal: ca.primaryForGoal,
      }));

    // ── Country data from pre-aggregated Supabase tables (with fallbacks) ──
    let campaignCountryMap: Record<string, string> = {};
    /** Per campaign: all countries with their spend share (e.g., { "NL": 0.8, "BE": 0.2 }) */
    let campaignCountryShares: Record<string, Record<string, number>> = {};
    let detectedCountries: string[] = [];
    let countryMonthlyData: Array<{
      countryCode: string; month: string;
      impressions: number; clicks: number; cost: number;
      conversions: number; conversionsValue: number;
      ctr: number; avgCpc: number; costPerConversion: number;
      conversionRate: number; roas: number;
      campaignCount: number; spendShare: number;
    }> = [];
    if (sb) {
      try {
        const clientId = `gads-${customerId}`;
        const sixMonthsAgo = addDays(today(), -180);

        // Try pre-aggregated country tables first
        const [{ data: dominantData }, { data: cmData }] = await Promise.all([
          sb.from("ads_campaign_country_monthly")
            .select("campaign_name, country_code, cost")
            .eq("client_id", clientId)
            .gte("month", sixMonthsAgo)
            .gt("cost", 0),
          sb.from("ads_country_monthly")
            .select("country_code, month, impressions, clicks, cost, conversions, conversions_value, ctr, avg_cpc, cost_per_conversion, conversion_rate, roas, campaign_count, spend_share")
            .eq("client_id", clientId)
            .order("month", { ascending: true }),
        ]);

        // Helper: build campaignCountryMap + campaignCountryShares from rows
        function buildCountryMaps(rows: Array<{ campaign_name: unknown; country_code: unknown; cost: unknown }>) {
          const campSpend = new Map<string, Map<string, number>>();
          for (const row of rows) {
            const camp = row.campaign_name as string;
            const cc = (row.country_code as string ?? "").toUpperCase();
            if (!camp || !cc) continue;
            if (!campSpend.has(camp)) campSpend.set(camp, new Map());
            const cm = campSpend.get(camp)!;
            cm.set(cc, (cm.get(cc) ?? 0) + Number(row.cost ?? 0));
          }
          for (const [camp, cm] of campSpend) {
            const totalSpend = Array.from(cm.values()).reduce((s, v) => s + v, 0);
            let maxCode = "";
            let maxSpend = 0;
            const shares: Record<string, number> = {};
            for (const [cc, spend] of cm) {
              shares[cc] = totalSpend > 0 ? parseFloat((spend / totalSpend).toFixed(4)) : 0;
              if (spend > maxSpend) { maxCode = cc; maxSpend = spend; }
            }
            if (maxCode) campaignCountryMap[camp] = maxCode;
            campaignCountryShares[camp] = shares;
          }
        }

        // Build from pre-aggregated data
        if (dominantData && dominantData.length > 0) {
          buildCountryMaps(dominantData);
        }

        // Fallback: if pre-aggregated tables are empty, try raw geo data
        if (Object.keys(campaignCountryMap).length === 0) {
          const { data: geoData } = await sb
            .from("ads_geo_performance_monthly")
            .select("campaign_name, country_code, cost")
            .eq("client_id", clientId)
            .gte("month", sixMonthsAgo)
            .gt("cost", 0);

          if (geoData && geoData.length > 0) {
            buildCountryMaps(geoData);
          }
        }

        // Debug: log what data was found
        console.log(`[country-data] client=${clientId} dominantRows=${dominantData?.length ?? 0} countryMonthlyRows=${cmData?.length ?? 0} campaignCountryMapSize=${Object.keys(campaignCountryMap).length}`);

        // Build country monthly data + detected countries
        if (cmData && cmData.length > 0) {
          countryMonthlyData = cmData.map((r) => ({
            countryCode: r.country_code as string,
            month: r.month as string,
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            cost: Number(r.cost ?? 0),
            conversions: Number(r.conversions ?? 0),
            conversionsValue: Number(r.conversions_value ?? 0),
            ctr: Number(r.ctr ?? 0),
            avgCpc: Number(r.avg_cpc ?? 0),
            costPerConversion: Number(r.cost_per_conversion ?? 0),
            conversionRate: Number(r.conversion_rate ?? 0),
            roas: Number(r.roas ?? 0),
            campaignCount: Number(r.campaign_count ?? 0),
            spendShare: Number(r.spend_share ?? 0),
          }));

          const countryTotals = new Map<string, number>();
          for (const r of countryMonthlyData) {
            countryTotals.set(r.countryCode, (countryTotals.get(r.countryCode) ?? 0) + r.cost);
          }
          detectedCountries = Array.from(countryTotals.entries())
            .filter(([, spend]) => spend > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([cc]) => cc);
        }

        // Final fallback for detectedCountries: derive from campaignCountryMap
        if (detectedCountries.length === 0 && Object.keys(campaignCountryMap).length > 0) {
          const countryTotals = new Map<string, number>();
          for (const cc of Object.values(campaignCountryMap)) {
            countryTotals.set(cc, (countryTotals.get(cc) ?? 0) + 1);
          }
          detectedCountries = Array.from(countryTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([cc]) => cc);
        }
      } catch { /* country data optional */ }
    }

    // Last resort: detect countries from campaign names if still empty
    if (detectedCountries.length === 0) {
      const { detectCountriesFromCampaigns } = await import("@/lib/countries");
      const allCampaignNames = [
        ...campaignsCurrentYearRaw.map((c) => c.campaignName),
        ...campaignsPrevYearRaw.map((c) => c.campaignName),
      ];
      const fromNames = detectCountriesFromCampaigns(allCampaignNames);
      if (fromNames.length > 0) {
        detectedCountries = fromNames;
        // Also build campaignCountryMap from names if still empty
        if (Object.keys(campaignCountryMap).length === 0) {
          const { detectCountryFromName } = await import("@/lib/countries");
          for (const name of new Set(allCampaignNames)) {
            const cc = detectCountryFromName(name);
            if (cc) {
              campaignCountryMap[name] = cc;
              campaignCountryShares[name] = { [cc]: 1 };
            }
          }
        }
      }
    }

    return Response.json({
      customerId,
      currentYear,
      realizedThroughMonth,
      dataStand,
      targetCurrentYear,
      historicalYears: historicalYearsData,
      currentYearMonthly,
      currentYearWeekly,
      campaigns,
      campaignsHistorical,
      impressionShare,
      conversionActions,
      accountStructure: accountStructureRaw,
      wastefulSearchTerms: wastefulSearchTermsRaw,
      campaignCountryMap,
      campaignCountryShares,
      detectedCountries,
      countryMonthlyData,
      adGroupBleeders: adGroupPerformanceRaw.filter((ag) => ag.conversions === 0 && ag.cost > 10),
      adGroupPerformance: adGroupPerformanceRaw.slice(0, 50),
      productBleeders: productGroupPerformanceRaw.filter((p) => p.cost > 10 && (p.conversions === 0 || p.conversionsValue < p.cost)),
      productPerformance: productGroupPerformanceRaw.slice(0, 50),
      changeHistory: changeHistoryRaw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
