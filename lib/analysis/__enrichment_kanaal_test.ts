// Raakt de verrijkingslaag voor Meta en LinkedIn nog Google-tabellen?
// Draaien: npx tsx lib/analysis/__enrichment_kanaal_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// buildEnrichmentContext heette kanaalneutraal omdat de ENRICHMENT_MATRIX op cadans is gesleuteld.
// Dat is de matrix ook -- maar zes van de acht lagen eronder bevragen `ads_*`-tabellen, en dat zijn
// Google Ads-tabellen. Ze voor Meta of LinkedIn aanroepen levert dus geen lege laag op maar een
// VERKEERDE: Google-data gepresenteerd als context van een ander kanaal.
//
// Het scherpste geval is sectorBenchmarks. Die tabel draagt "Bron: WordStream/LocaliQ/Triple Whale"
// -- Search-benchmarks. Een Meta-feed-CTR van 1,2% is gezond en zou daartegen als ver
// ondergemiddeld lezen, terwijl de preambule voor dat kanaal al META_BENCHMARKS injecteert. Twee
// elkaar tegensprekende benchmarkblokken in één prompt is erger dan één ontbrekend blok.
//
// Deze test bewaakt de eigenschap zelf en niet de lijst: hij registreert welke tabellen er
// daadwerkelijk worden bevraagd. Voegt iemand later een laag toe die stilletjes een ads_*-tabel
// leest, dan faalt hij -- ook als die laag netjes buiten ALLEEN_GOOGLE is vergeten.

import { buildEnrichmentContext } from "./enrichment";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Een supabase-dubbel dat niets teruggeeft en alleen onthoudt welke tabel is opgevraagd. Elke
// keten-methode geeft zichzelf terug; het geheel is awaitable en levert een leeg resultaat.
function recorder() {
  const tabellen: string[] = [];
  const bouwer = (): Record<string, unknown> => {
    const zelf: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lte", "gte", "lt", "gt", "is", "or", "in", "order", "limit", "maybeSingle", "single", "not", "neq"]) {
      zelf[m] = () => zelf;
    }
    zelf.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return zelf;
  };
  const client = {
    from(tabel: string) { tabellen.push(tabel); return bouwer(); },
  };
  return { client, tabellen };
}

const GOOGLE_TABEL = /^(ads_|google_ads_|benchmark_sectors$)/;

async function tabellenVoor(channel: "google_ads" | "meta_ads" | "linkedin_ads", sopType: "weekly" | "biweekly" | "monthly") {
  const { client, tabellen } = recorder();
  const ctx = await buildEnrichmentContext({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    clientId: "test-client",
    accountType: "leadgen_cpa",
    sopType,
    analysisDate: "2026-08-24",
    channel,
  });
  return { tabellen, ctx };
}

async function main() {
  for (const sopType of ["weekly", "biweekly", "monthly"] as const) {
    console.log(`\n${sopType}`);

    for (const channel of ["meta_ads", "linkedin_ads"] as const) {
      const { tabellen, ctx } = await tabellenVoor(channel, sopType);
      const google = tabellen.filter((t) => GOOGLE_TABEL.test(t));
      check(`${channel}: geen enkele Google-tabel bevraagd`, google.length === 0, google.join(", "));

      // De Google-only velden horen leeg te zijn -- niet omdat de query niets vond, maar omdat hij
      // niet gedraaid is. Beide zien er in het veld hetzelfde uit; de skippedLayers-melding is het
      // verschil dat de prompt te zien krijgt.
      check(`${channel}: sectorBenchmarks blijft leeg`, ctx.sectorBenchmarks === "");
      check(`${channel}: changeHistory blijft leeg`, ctx.changeHistory === "");
      check(`${channel}: geoContext blijft leeg`, ctx.geoContext === "");
      check(`${channel}: pmaxContext blijft leeg`, ctx.pmaxContext === "");

      check(`${channel}: de overgeslagen lagen worden gemeld`,
        ctx.skippedLayers.length > 0 && ctx.dimensionAvailability.includes("Niet van toepassing op dit kanaal"),
        `skipped=${ctx.skippedLayers.join(",")}`);
      // "Niet van toepassing" en "niet gecontroleerd" leiden tot verschillende conclusies; ze mogen
      // dus nooit in elkaar overlopen.
      check(`${channel}: overgeslagen is niet als mislukt gemeld`, ctx.failedLayers.length === 0, ctx.failedLayers.join(","));
    }

    const { tabellen: googleTabellen } = await tabellenVoor("google_ads", sopType);
    check("google_ads bevraagt zijn eigen tabellen nog wel",
      googleTabellen.some((t) => GOOGLE_TABEL.test(t)), googleTabellen.join(", "));
  }

  console.log("\nDe kanaalneutrale lagen draaien voor alle drie");
  {
    // sop_client_context en sop_hypothesis_tracking dragen geen kanaalkolom en horen dus overal te
    // draaien. Ze leveren vandaag nog niets op -- beide tabellen hebben geen enkele schrijver in de
    // codebase -- maar de bedrading hoort te kloppen zodat ze meteen meelopen zodra ze gevuld worden.
    for (const channel of ["google_ads", "meta_ads", "linkedin_ads"] as const) {
      const { tabellen } = await tabellenVoor(channel, "biweekly");
      check(`${channel}: leest sop_hypothesis_tracking`, tabellen.includes("sop_hypothesis_tracking"), tabellen.join(", "));
      check(`${channel}: leest sop_client_context`, tabellen.includes("sop_client_context"), tabellen.join(", "));
    }
  }

}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });
