// Test voor de cross-channel-context die de hypotheses-stap van elke kanaal-SOP voedt
// (masterplan 16.4/16.5). Deterministisch; supabase is gemockt.
// Draaien: npx tsx lib/analysis/__cross_channel_context_test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { crossChannelContext } from "./cross-channel-context";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function mockSupabase(row: { output: string; analysis_date: string } | null): SupabaseClient {
  const from = () => ({
    select() {
      const b = {
        eq() { return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
      };
      return b;
    },
  });
  return { from } as unknown as SupabaseClient;
}

async function main() {
  // ── Nog nooit gedraaid: nul promptwijziging, geen valse zekerheid ──
  console.log("crossChannelContext: nog geen eerdere run");
  {
    const result = await crossChannelContext(mockSupabase(null), "demo-greentech", "meta_ads");
    check("available is false", result.available === false);
    check("promptContext is leeg", result.promptContext === "", result.promptContext);
    check("analysisDate is null", result.analysisDate === null);
  }

  // ── Wel gedraaid: analysedatum expliciet, geen stille versheid-claim ──
  console.log("crossChannelContext: eerdere run aanwezig");
  {
    const result = await crossChannelContext(
      mockSupabase({ output: "## Cross-channel-signalen\n\nDubbele warme pool gedetecteerd.", analysis_date: "2026-07-15" }),
      "demo-greentech",
      "meta_ads",
    );
    check("available is true", result.available === true);
    check("analysisDate komt uit de rij, niet 'vandaag'", result.analysisDate === "2026-07-15", result.analysisDate ?? "null");
    check("promptContext bevat de datum expliciet", result.promptContext.includes("2026-07-15"));
    check("promptContext bevat de opgeslagen bevinding", result.promptContext.includes("Dubbele warme pool"));
    check("promptContext waarschuwt tegen het herschrijven van kanaalcijfers", result.promptContext.includes("Verzin geen cross-channel-cijfers"));
  }

  // ── Kanaalscope expliciet in de instructie (masterplan 16.8): een live testrun liet Meta een
  // Google Ads-budgetactie aanbevelen; de instructie moet nu letterlijk zeggen voor welk kanaal
  // acties wel/niet mogen, met een concreet verboden-voorbeeld. ──
  console.log("crossChannelContext: kanaalscope expliciet per kanaal");
  {
    const metaResult = await crossChannelContext(
      mockSupabase({ output: "## Cross-channel-signalen\n\ngoogle_ads presteert zwak.", analysis_date: "2026-07-15" }),
      "demo-greentech",
      "meta_ads",
    );
    check("noemt het eigen kanaal (Meta Ads) expliciet als scope", metaResult.promptContext.includes("Meta Ads"), metaResult.promptContext);
    check("waarschuwt letterlijk tegen een Google Ads-budgetactie", metaResult.promptContext.includes("Google Ads") && metaResult.promptContext.toLowerCase().includes("budget"));

    const linkedinResult = await crossChannelContext(
      mockSupabase({ output: "## Cross-channel-signalen\n\ngoogle_ads presteert zwak.", analysis_date: "2026-07-15" }),
      "demo-greentech",
      "linkedin_ads",
    );
    check("hetzelfde blok noemt LinkedIn Ads als scope voor dat kanaal", linkedinResult.promptContext.includes("LinkedIn Ads"), linkedinResult.promptContext);
    check("Meta- en LinkedIn-promptteksten verschillen (kanaal-specifiek, geen kopie)", metaResult.promptContext !== linkedinResult.promptContext);
  }

  // ── Uitzonderlijk lange output wordt afgekapt, niet integraal doorgegeven ──
  console.log("crossChannelContext: afkappen bij overschrijding");
  {
    const langeOutput = "x".repeat(10_000);
    const result = await crossChannelContext(
      mockSupabase({ output: langeOutput, analysis_date: "2026-08-01" }),
      "demo-greentech",
      "meta_ads",
    );
    check("promptContext is korter dan de ruwe output", result.promptContext.length < langeOutput.length);
    check("promptContext meldt de afkapping", result.promptContext.includes("afgekapt"));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main();
