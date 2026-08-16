export {};
// Verificatie van de GA4 Data API-responsparsing: datumconversie (YYYYMMDD → YYYY-MM-DD),
// sampling-detectie, en dat een niet-ok-response een leesbare fout gooit i.p.v. een crash met een
// onduidelijke oorzaak. Mockt global fetch — geen echte netwerkaanroep of credentials nodig.
// Draaien: npx tsx lib/ga4/__api-client_test.ts

import { fetchGa4SessionReport, fetchGa4EventReport } from "./api-client";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const origFetch = global.fetch;
function mockFetch(response: unknown, ok = true, status = 200) {
  global.fetch = (async () => ({
    ok, status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  })) as unknown as typeof fetch;
}

async function run() {
  console.log("\n1. Sessierapport — datumconversie en veldvolgorde");
  {
    mockFetch({
      rows: [{ dimensionValues: [{ value: "20260801" }, { value: "google" }, { value: "cpc" }, { value: "desktop" }, { value: "/lp" }], metricValues: [{ value: "100" }, { value: "60" }] }],
      metadata: {},
    });
    const result = await fetchGa4SessionReport("properties/1", "token", "2026-07-01", "2026-08-01");
    check("één rij", result.rows.length === 1);
    check("datum omgezet naar YYYY-MM-DD", result.rows[0]?.dimensionValues[0] === "2026-08-01", result.rows[0]?.dimensionValues[0]);
    check("geen sampling gemeld zonder samplingMetadatas", result.sampled === false);
    check("metricValues numeriek", result.rows[0]?.metricValues[0] === 100 && result.rows[0]?.metricValues[1] === 60);
  }

  console.log("\n2. Sampling-detectie");
  {
    mockFetch({ rows: [], metadata: { samplingMetadatas: [{ samplesReadCount: "1000", samplingSpaceSize: "50000" }] } });
    const result = await fetchGa4EventReport("properties/1", "token", "2026-07-01", "2026-08-01");
    check("sampled=true als samplingMetadatas gezet is", result.sampled === true);
  }

  console.log("\n3. Foutafhandeling");
  {
    mockFetch({ error: { message: "PERMISSION_DENIED" } }, false, 403);
    let threw = false;
    let message = "";
    try {
      await fetchGa4SessionReport("properties/1", "token", "2026-07-01", "2026-08-01");
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    check("gooit een fout bij een niet-ok response", threw);
    check("de foutmelding bevat de statuscode", message.includes("403"), message);
  }

  console.log("\n4. Lege rows-array crasht niet");
  {
    mockFetch({ metadata: {} }); // geen 'rows'-veld — GA4 doet dit bij nul resultaten
    const result = await fetchGa4SessionReport("properties/1", "token", "2026-07-01", "2026-08-01");
    check("lege lijst i.p.v. crash", Array.isArray(result.rows) && result.rows.length === 0);
  }

  global.fetch = origFetch;
  console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
  if (failed > 0) process.exit(1);
}

run();
