export {};
// Verificatie van de Search Console API-responsparsing en foutafhandeling. Mockt global fetch —
// geen echte netwerkaanroep of credentials nodig.
// Draaien: npx tsx lib/search-console/__api-client_test.ts

import { runSearchAnalyticsQuery } from "./api-client";

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
  console.log("\n1. Responsparsing");
  {
    mockFetch({ rows: [{ keys: ["2026-08-01", "greentech", "/"], clicks: 9, impressions: 28, ctr: 0.32, position: 1.2 }] });
    const result = await runSearchAnalyticsQuery("https://x.nl/", "token", "2026-05-01", "2026-08-01");
    check("één rij", result.rows.length === 1);
    check("velden op de juiste plek", result.rows[0]?.query === "greentech" && result.rows[0]?.page === "/", JSON.stringify(result.rows[0]));
    check("geen afkapping gemeld onder de limiet", result.mogelijkAfgekapt === false);
  }

  console.log("\n2. Rijen zonder volledige keys worden overgeslagen (geen crash)");
  {
    mockFetch({ rows: [{ keys: ["2026-08-01", "q"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] }); // slechts 2 keys i.p.v. 3
    const result = await runSearchAnalyticsQuery("https://x.nl/", "token", "2026-05-01", "2026-08-01");
    check("onvolledige rij genegeerd", result.rows.length === 0);
  }

  console.log("\n3. Foutafhandeling");
  {
    mockFetch({ error: { message: "invalid site" } }, false, 403);
    let threw = false, message = "";
    try {
      await runSearchAnalyticsQuery("https://x.nl/", "token", "2026-05-01", "2026-08-01");
    } catch (e) {
      threw = true; message = e instanceof Error ? e.message : String(e);
    }
    check("gooit een fout bij een niet-ok response", threw);
    check("de foutmelding bevat de statuscode", message.includes("403"), message);
  }

  console.log("\n4. Site-URL wordt URL-encoded in het pad");
  {
    let gezienUrl = "";
    global.fetch = (async (url: string) => {
      gezienUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ rows: [] }), text: async () => "{}" };
    }) as unknown as typeof fetch;
    await runSearchAnalyticsQuery("https://www.klant.nl/", "token", "2026-05-01", "2026-08-01");
    check("de site-URL staat url-encoded in het pad", gezienUrl.includes(encodeURIComponent("https://www.klant.nl/")), gezienUrl);
  }

  global.fetch = origFetch;
  console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
  if (failed > 0) process.exit(1);
}

run();
