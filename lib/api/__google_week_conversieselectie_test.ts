// De weekrijen van Google tellen dezelfde conversieacties als de maandrijen. Geen netwerk: fetch
// is vervangen en de Google Ads-API wordt nagebootst.
// Draaien: tsx lib/api/__google_week_conversieselectie_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De client-data-route geeft de selectie uit client_settings.conversion_actions mee aan de
// maand- en campagne-aanroepen, maar getAccountMetricsByWeek kende die parameter niet. Een account
// met "Aankoop" (aangevinkt) en "Nieuwsbrief" (niet aangevinkt) kreeg dan maanden met alleen
// aankopen en weken met beide: de beursstrook en de weekverdeling telden meer dan de maand waar
// ze in liggen.

export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const vragen: string[] = [];
const WEKEN = ["2026-01-05", "2026-01-12"];

// Per week: actie 1 (Aankoop) 10 conversies, actie 2 (Nieuwsbrief) 8. Ongesegmenteerd telt de API
// ze samen: 18.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("oauth2") || url.includes("/token")) return json({ access_token: "a", expires_in: 3600 });
  if (!url.includes("googleAds:searchStream")) return json([]);
  const vraag = String(JSON.parse(String(init?.body ?? "{}")).query ?? "").replace(/\s+/g, " ").trim();
  vragen.push(vraag);
  if (!/segments\.week/.test(vraag)) return json([]);
  if (/segments\.conversion_action/.test(vraag)) {
    return json([{ results: WEKEN.flatMap((week) => [
      { segments: { week, conversionAction: "customers/123/conversionActions/1" }, metrics: { conversions: 10, conversionsValue: 1000 } },
      { segments: { week, conversionAction: "customers/123/conversionActions/2" }, metrics: { conversions: 8, conversionsValue: 0 } },
    ]) }]);
  }
  return json([{ results: WEKEN.map((week) => ({
    segments: { week },
    metrics: { impressions: 500, clicks: 50, costMicros: 100_000_000, conversions: 18, conversionsValue: 1000, ctr: 0.1, averageCpc: 2_000_000 },
  })) }]);
}) as typeof fetch;

async function main() {
  const { getAccountMetricsByWeek } = await import("./google-ads");
  const cred = { developerToken: "t", clientId: "c", clientSecret: "s", refreshToken: "r" };
  // Als losse functie met vijf parameters: op de oude code negeerde hij de vijfde gewoon.
  const metSelectie = await (getAccountMetricsByWeek as (...a: unknown[]) => ReturnType<typeof getAccountMetricsByWeek>)(
    cred, "123", "2026-01-05", "2026-01-18", ["1"]);

  console.log("getAccountMetricsByWeek met een selectie");
  check("twee weken, op datum", metSelectie.map((r) => r.date).join(",") === WEKEN.join(","), JSON.stringify(metSelectie.map((r) => r.date)));
  check("alleen de aangevinkte actie: 10 per week, niet 18", metSelectie.every((r) => r.conversions === 10), JSON.stringify(metSelectie.map((r) => r.conversions)));
  check("de waarde ook alleen van die actie", metSelectie.every((r) => r.conversionsValue === 1000));
  check("kosten en klikken blijven het hele account", metSelectie.every((r) => r.cost === 100 && r.clicks === 50), JSON.stringify(metSelectie[0]));
  check("CPA over de geselecteerde conversies: 100 / 10", metSelectie.every((r) => r.costPerConversion === 10), JSON.stringify(metSelectie.map((r) => r.costPerConversion)));
  check("er is per conversieactie gevraagd", vragen.some((v) => /segments\.week/.test(v) && /segments\.conversion_action/.test(v)));

  vragen.length = 0;
  const zonder = await getAccountMetricsByWeek(cred, "123", "2026-01-05", "2026-01-18");
  check("zonder selectie: alles, zoals voorheen (18)", zonder.every((r) => r.conversions === 18), JSON.stringify(zonder.map((r) => r.conversions)));
  check("zonder selectie één ongesegmenteerde vraag", vragen.length === 1 && !/conversion_action/.test(vragen[0]));

  console.log("de client-data-route geeft de selectie aan beide weekaanroepen");
  const route = readFileSync(join(__dirname, "..", "..", "app/api/google-ads/client-data/route.ts"), "utf8");
  const weekAanroepen = route.match(/getAccountMetricsByWeek\([^)]*\)/g) ?? [];
  check("twee weekaanroepen, allebei met convActionIds", weekAanroepen.length === 2 && weekAanroepen.every((a) => /convActionIds\s*\)$/.test(a)), JSON.stringify(weekAanroepen));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
