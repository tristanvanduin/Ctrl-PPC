import { NextRequest } from "next/server";
import {
  getAllSearchTermsWithClicks,
  getProductGroupPerformance,
  getAccountStructure,
  getAdGroupKeywords,
  getCampaignLocationTargets,
  getAdGroupAdCopy,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { buildSearchTermAnalysisPrompt } from "@/lib/prompts/search-term-prompts";
import { toPromptTable } from "@/lib/analysis/prompt-table";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import {
  getSupabase,
  getOpenRouterKey,
  fetchClientContext,
  fmt,
} from "@/lib/analysis/helpers";
import {
  parseSearchTermBatch,
  findMissingTerms,
  type SearchTermVerdict,
  type BatchResult,
  type RunCoverage,
} from "@/lib/schema/search-term-schema";
import { fixMojibake } from "@/lib/analysis/sanitize";
import { applySearchTermGuardrails } from "@/lib/analysis/search-term-guardrails";
import { saveSearchTermVerdictsAsHypotheses } from "@/lib/analysis/search-terms-to-hypotheses";
import {
  applyProductContextDecisioning,
  buildProductContext,
  summarizeProductContext,
} from "@/lib/analysis/product-context";
import { fetchStrategicContext } from "@/lib/analysis/expert-layers";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import { logger } from "@/lib/logger";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";

export const maxDuration = 300; // 5 minutes for full analysis with many batches

// Label voor de search_term_analysis-rij (model_used). callRouted() (regel 332) kiest het
// werkelijke model per batch via MODEL_CATALOG, met een fallback-keten bij een storing -- dit is
// dus de VERWACHTE waarde, niet gegarandeerd de exacte per batch. Zelfde constante als
// MODEL_CATALOG.strong in lib/analysis/llm-router.ts; daar niet vandaan geimporteerd om dit
// bestand niet te koppelen aan de interne vorm van de router voor één labelveld.
const OPENROUTER_MODEL = "google/gemini-3.7-flash";
const BATCH_SIZE = 100; // Smaller batches = less token overflow risk with enhanced schema


interface AiVerdict {
  searchTerm: string;
  relevanceScore: number;
  verdict: string;
  recommendedAction: string;
  reason: string;
}

type VerdictWithData = SearchTermVerdict & {
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

// ── GET: Fetch cached analysis results ─────────────────────────────────────

export async function GET(request: NextRequest) {
  // De invoer eerst, dan de omgeving. Andersom kreeg een verzoek zonder client_id een 500
  // ("server stuk") terwijl het antwoord een 400 hoort te zijn ("je verzoek klopt niet"), en
  // kon de demo-check niet werken omdat de route al was afgehaakt.
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  // Find the most recent analysis date for this client
  const { data: latest } = await supabase
    .from("search_term_analysis")
    .select("analysis_date")
    .eq("client_id", clientId)
    .order("analysis_date", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) {
    return Response.json({ results: [], analysisDate: null });
  }

  const analysisDate = latest[0].analysis_date;

  // De periode staat al vast: analysis_date is één dag, de meest recente. Wat hier nog te winnen
  // viel waren de kolommen — de mapper hieronder leest er elf, select("*") haalde ook model_used,
  // created_at en id op om ze weg te gooien. Dit antwoord gaat naar de browser, dus dat zijn
  // bytes over de lijn per bezoek.
  const { data: results } = await supabase
    .from("search_term_analysis")
    .select("search_term, campaign_name, ad_group_name, clicks, cost, conversions, conversions_value, relevance_score, verdict, recommended_action, reason")
    .eq("client_id", clientId)
    .eq("analysis_date", analysisDate)
    .order("cost", { ascending: false });

  return Response.json({
    results: (results ?? []).map((r: Record<string, unknown>) => ({
      searchTerm: r.search_term,
      campaignName: r.campaign_name,
      adGroupName: r.ad_group_name,
      clicks: r.clicks,
      cost: r.cost,
      conversions: r.conversions,
      conversionsValue: r.conversions_value,
      relevanceScore: r.relevance_score,
      verdict: r.verdict,
      recommendedAction: r.recommended_action,
      reason: r.reason,
    })),
    analysisDate,
    totalResults: (results ?? []).length,
  });
}

// ── POST: Trigger new analysis ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const credentials = credentialsUitOmgeving();
  if (!credentials) return Response.json({ error: "Google Ads API niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let customerId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    customerId = body.customerId;
    if (!clientId || !customerId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id, customerId }" }, { status: 400 });
  }

  try {
    const analysisDate = fmt(new Date());

    const creditOordeel = await controleerSaldo(supabase, { clientId, label: "search_terms" });
    if (creditOordeel.blokkeert) {
      return Response.json({ error: creditOordeel.tekst }, { status: 402 });
    }

    // Phase 1: Fetch all data in parallel
    const [searchTerms, productPerformance, accountStructure, clientCtx, keywords, locationTargets, adCopy, strategicContext] = await Promise.all([
      getAllSearchTermsWithClicks(credentials, customerId),
      getProductGroupPerformance(credentials, customerId),
      getAccountStructure(credentials, customerId),
      fetchClientContext(supabase, clientId),
      getAdGroupKeywords(credentials, customerId),
      getCampaignLocationTargets(credentials, customerId),
      getAdGroupAdCopy(credentials, customerId),
      fetchStrategicContext(supabase, clientId, analysisDate),
    ]);
    const merchantSync = await syncMerchantProductSnapshots({
      supabase,
      clientId,
      credentials,
    });

    if (searchTerms.length === 0) {
      return Response.json({ error: "Geen zoektermen met clicks gevonden" }, { status: 404 });
    }

    // Build context block (sent with every batch)
    const campaignList = accountStructure.campaigns
      .map((c: { name: string; type: string }) => `- ${c.name} (${c.type})`)
      .join("\n");

    const productTitles = productPerformance
      .slice(0, 200)
      .map((p) => p.productTitle)
      .filter((t) => t && t !== "(onbekend)" && t !== "(asset group)");
    const productList = productTitles.join(", ");

    // Group keywords by campaign > ad group
    const keywordsByAdGroup = new Map<string, string[]>();
    for (const kw of keywords) {
      const key = `${kw.campaignName} > ${kw.adGroupName}`;
      if (!keywordsByAdGroup.has(key)) keywordsByAdGroup.set(key, []);
      keywordsByAdGroup.get(key)!.push(`[${kw.matchType}] ${kw.keyword}`);
    }
    const keywordsText = Array.from(keywordsByAdGroup.entries())
      .map(([group, kws]) => `${group}:\n  ${kws.join(", ")}`)
      .join("\n");

    // Group location targets by campaign
    const locationsByCampaign = new Map<string, string[]>();
    for (const loc of locationTargets) {
      if (!locationsByCampaign.has(loc.campaignName)) locationsByCampaign.set(loc.campaignName, []);
      locationsByCampaign.get(loc.campaignName)!.push(`${loc.locationName} (${loc.locationType})`);
    }
    const locationsText = Array.from(locationsByCampaign.entries())
      .map(([campaign, locs]) => `${campaign}: ${locs.join(", ")}`)
      .join("\n");

    // Group ad copy by campaign > ad group (deduplicate, keep first per ad group)
    const adCopyByAdGroup = new Map<string, { headlines: string[]; descriptions: string[]; urls: string[] }>();
    for (const ad of adCopy) {
      const key = `${ad.campaignName} > ${ad.adGroupName}`;
      if (!adCopyByAdGroup.has(key)) {
        adCopyByAdGroup.set(key, {
          headlines: ad.headlines,
          descriptions: ad.descriptions,
          urls: ad.finalUrls,
        });
      }
    }
    const adCopyText = Array.from(adCopyByAdGroup.entries())
      .map(([group, data]) => {
        const h = data.headlines.length > 0 ? `Headlines: ${data.headlines.join(" | ")}` : "";
        const d = data.descriptions.length > 0 ? `Descriptions: ${data.descriptions.join(" | ")}` : "";
        const u = data.urls.length > 0 ? `URL: ${data.urls[0]}` : "";
        return `${group}:\n  ${[h, d, u].filter(Boolean).join("\n  ")}`;
      })
      .join("\n");

    const targetedCountries = Array.from(new Set(
      locationTargets
        .map((loc) => String(loc.locationType || "").toUpperCase() === "COUNTRY" ? String(loc.locationName || "") : "")
        .filter(Boolean)
        .flatMap((name) => {
          const upper = name.toUpperCase();
          if (upper.includes("NETHERLAND") || upper.includes("NEDERLAND")) return ["NL"];
          if (upper.includes("BELGI") || upper === "BELGIUM") return ["BE"];
          if (upper.includes("GERMAN") || upper.includes("DUITSLAND")) return ["DE"];
          if (upper.includes("FRANCE") || upper.includes("FRANKRIJK")) return ["FR"];
          return [];
        })
    ));

    const productContext = buildProductContext({
      productTitles,
      productTypes: merchantSync.products.flatMap((product) => [
        product.product_type,
        product.product_type_l1,
        product.product_type_l2,
        product.product_type_l3,
        product.product_type_l4,
        product.product_type_l5,
      ].filter(Boolean) as string[]),
      productBrands: merchantSync.products.map((product) => product.brand).filter(Boolean) as string[],
      customLabels: merchantSync.products.flatMap((product) => [
        product.custom_label_0,
        product.custom_label_1,
        product.custom_label_2,
        product.custom_label_3,
        product.custom_label_4,
      ].filter(Boolean) as string[]),
      customAttributes: merchantSync.products.flatMap((product) =>
        Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string")
      ),
      merchantProducts: merchantSync.products.map((product) => ({
        offerId: product.offer_id,
        title: product.title,
        brand: product.brand,
        productType: product.product_type,
        customLabels: [
          product.custom_label_0,
          product.custom_label_1,
          product.custom_label_2,
          product.custom_label_3,
          product.custom_label_4,
        ].filter(Boolean) as string[],
        customAttributes: Object.values(product.custom_attributes_jsonb ?? {}).filter((value): value is string => typeof value === "string"),
        link: product.link,
      })),
      keywords: keywords.map((kw) => kw.keyword),
      adCopyPhrases: adCopy.flatMap((ad) => [...ad.headlines, ...ad.descriptions, ...ad.finalUrls]),
      strategicContextText: `${clientCtx.goalsSection}\n${strategicContext}`,
      targetedCountries,
    });

    const contextBlock = `## Bedrijfscontext
${clientCtx.goalsSection}

${summarizeProductContext(productContext)}

## Merchant snapshot status
${merchantSync.message}

## Campagnestructuur
${campaignList || "Geen campagnedata beschikbaar"}

## Geografische targeting per campagne
${locationsText || "Geen locatiedata beschikbaar"}

## Keywords per ad group
${keywordsText || "Geen keyword data beschikbaar"}

## Ad copy & landing pages per ad group
${adCopyText || "Geen ad copy data beschikbaar"}

## Producten/diensten (top 30)
${productList || "Geen productdata beschikbaar"}`;

    const systemPrompt = buildSearchTermAnalysisPrompt();

    // Phase 2: Process in parallel batches (3 concurrent)
    const CONCURRENCY = 3;
    const MAX_RETRIES = 1;

    const batchResults: BatchResult[] = [];

    async function processBatch(batch: typeof searchTerms, batchNum: number, isRetry: boolean = false): Promise<VerdictWithData[]> {
      const inputTermNames = batch.map((t) => t.searchTerm);
      const termsJson = batch.map((t) => ({
        searchTerm: t.searchTerm,
        campaignName: t.campaignName,
        adGroupName: t.adGroupName,
        clicks: t.clicks,
        cost: Math.round(t.cost * 100) / 100,
        conversions: t.conversions,
        conversionsValue: Math.round(t.conversionsValue * 100) / 100,
      }));

      const userMessage = `${contextBlock}

## Zoektermen om te beoordelen (batch ${batchNum})
${toPromptTable(termsJson)}`;

      try {
        const response = await callRouted({
          apiKey: apiKey!,
          systemPrompt,
          userMessage,
          maxTokens: 8192,
          label: `search-terms-batch-${batchNum}`,
        });

        // W1.1(f): O2-kostenregistratie per batch-call. Elke callRouted is een echte kost
        // (ook een retry), dus registreren we hier per call. Synthetische run-sleutel, want
        // een losse analyse heeft geen jobId. Nooit brekend: recordUsage slikt fouten zelf.
        if (supabase) {
          void recordUsage(supabase, {
            runKey: `search-terms-${clientId}-${analysisDate}`,
            clientId,
            channel: "google_ads",
            sopType: "search_terms",
            stepLabel: `Search terms batch ${batchNum}`,
            model: response.model,
            promptTokens: response.promptTokens ?? 0,
            cachedPromptTokens: response.cachedPromptTokens ?? 0,
            completionTokens: response.completionTokens ?? 0,
          });
        }

        const rawOutput = fixMojibake(response.output);

        // Parse with Zod validation (partial recovery)
        const parseResult = parseSearchTermBatch(rawOutput);

        if (!parseResult.success && !isRetry) {
          // Retry once on complete parse failure
          logger.warn(`[search-terms] Batch ${batchNum} parse failed, retrying...`);
          return processBatch(batch, batchNum, true);
        }

        if (parseResult.errors.length > 0) {
          logger.warn(`[search-terms] Batch ${batchNum}: ${parseResult.errors.length} validation errors, ${parseResult.verdicts.length} valid`);
        }

        // Detect missing terms
        const missing = findMissingTerms(inputTermNames, parseResult.verdicts);
        if (missing.length > 0 && !isRetry) {
          logger.warn(`[search-terms] Batch ${batchNum}: ${missing.length} terms missing from LLM output`);
        }

        // Merge verdicts with original performance data
        const results: VerdictWithData[] = [];
        for (const verdict of parseResult.verdicts) {
          const original = batch.find((t) => t.searchTerm === verdict.searchTerm);
          if (!original) continue;
          results.push({
            searchTerm: verdict.searchTerm,
            relevanceScore: verdict.relevanceScore,
            verdict: verdict.verdict,
            recommendedAction: verdict.recommendedAction,
            reason: verdict.reason,
            campaignName: original.campaignName,
            adGroupName: original.adGroupName,
            clicks: original.clicks,
            cost: original.cost,
            conversions: original.conversions,
            conversionsValue: original.conversionsValue,
          });
        }

        batchResults.push({
          batchNum,
          inputCount: batch.length,
          outputCount: results.length,
          failedCount: batch.length - results.length,
          retried: isRetry,
          success: results.length > 0,
        });

        return results;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[search-terms] Batch ${batchNum} error: ${msg}`);

        if (!isRetry) {
          logger.warn(`[search-terms] Batch ${batchNum} failed, retrying...`);
          return processBatch(batch, batchNum, true);
        }

        batchResults.push({ batchNum, inputCount: batch.length, outputCount: 0, failedCount: batch.length, retried: true, success: false });
        return [];
      }
    }

    // Build batches
    const batches: { batch: typeof searchTerms; num: number }[] = [];
    for (let i = 0; i < searchTerms.length; i += BATCH_SIZE) {
      batches.push({ batch: searchTerms.slice(i, i + BATCH_SIZE), num: Math.floor(i / BATCH_SIZE) + 1 });
    }

    // Process in waves of CONCURRENCY
    const allVerdicts: VerdictWithData[] = [];
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      const waveResults = await Promise.all(wave.map((b) => processBatch(b.batch, b.num)));
      for (const results of waveResults) {
        allVerdicts.push(...results);
      }
    }

    // Apply deterministic guardrails (corrects unsafe LLM recommendations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applySearchTermGuardrails(allVerdicts as any);
    applyProductContextDecisioning(allVerdicts as any, productContext);

    // Compute run coverage
    const totalFailed = batchResults.reduce((s, b) => s + b.failedCount, 0);
    const totalRetried = batchResults.filter((b) => b.retried).length;
    const coverage: RunCoverage = {
      totalInput: searchTerms.length,
      totalAnalyzed: allVerdicts.length,
      totalFailed,
      totalRetried,
      totalMissing: searchTerms.length - allVerdicts.length,
      coveragePct: searchTerms.length > 0 ? Math.round((allVerdicts.length / searchTerms.length) * 100) : 0,
      batchResults,
    };

    // Phase 3: Delete old results for today and save new ones
    await supabase
      .from("search_term_analysis")
      .delete()
      .eq("client_id", clientId)
      .eq("analysis_date", analysisDate);

    if (allVerdicts.length > 0) {
      const rows = allVerdicts.map((v) => ({
        client_id: clientId,
        analysis_date: analysisDate,
        search_term: v.searchTerm,
        campaign_name: v.campaignName,
        ad_group_name: v.adGroupName,
        clicks: v.clicks,
        cost: Math.round(v.cost * 100) / 100,
        conversions: v.conversions,
        conversions_value: Math.round(v.conversionsValue * 100) / 100,
        relevance_score: v.relevanceScore,
        verdict: v.verdict,
        recommended_action: v.recommendedAction,
        reason: v.reason,
        model_used: OPENROUTER_MODEL,
      }));

      // Insert in chunks of 100 (Supabase limit)
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from("search_term_analysis").insert(rows.slice(i, i + 100));
      }

      // Aggregeer de geadviseerde negatives als voorstel in de goedkeuringswachtrij.
      await saveSearchTermVerdictsAsHypotheses(supabase, allVerdicts, { clientId, analysisId: null });
    }

    await verbruikCredit(supabase, { clientId, label: "search_terms", runKey: `search-terms-${clientId}-${analysisDate}` });

    return Response.json({
      results: allVerdicts.map((v) => ({
        searchTerm: v.searchTerm,
        campaignName: v.campaignName,
        adGroupName: v.adGroupName,
        clicks: v.clicks,
        cost: v.cost,
        conversions: v.conversions,
        conversionsValue: v.conversionsValue,
        relevanceScore: v.relevanceScore,
        verdict: v.verdict,
        recommendedAction: v.recommendedAction,
        reason: v.reason,
        productClassification: v.productClassification,
        soldByClient: v.soldByClient,
        evidenceSource: v.evidenceSource,
        recommendedScope: v.recommendedScope,
        exclusionSafety: v.exclusionSafety,
        matchedContext: v.matchedContext,
      })),
      analysisDate,
      totalTerms: searchTerms.length,
      analyzedTerms: allVerdicts.length,
      coverage,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Onbekende fout" },
      { status: 500 }
    );
  }
}
