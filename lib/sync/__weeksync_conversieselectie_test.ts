// De sync geeft de weekvraag dezelfde conversieselectie als de maandvraag, en ads_account_weekly
// bevat daardoor dezelfde conversies als ads_account_monthly uit dezelfde run. Geen netwerk: fetch
// is vervangen door een nagebootste Google Ads-API, Supabase door FakeSupabase.
// Draaien: tsx lib/sync/__weeksync_conversieselectie_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// getAccountMetricsByWeek kreeg een conversieselectie (zie __google_week_conversieselectie_test),
// en de client-data-route gaf hem die ook. De orchestrator niet: die gaf convActionIds aan
// getAccountMetricsByMonth en liet de weekaanroep ongefilterd. Een klant met "Aankoop"
// (aangevinkt) en "Nieuwsbrief" (niet aangevinkt) kreeg zo een maandtabel met alleen aankopen en
// een weektabel met beide, uit een en dezelfde run. De weekroutes (weekly, biweekly, monthly), de
// Google-weekrecords van de forecast en de funnel lezen die weektabel, en telden dus meer dan de
// maand waar de weken in liggen. De test van de losse functie zag dat niet: die roept de functie
// zelf met de selectie aan. Hier draait de echte syncClient.

import { FakeSupabase } from "../decision/__fake_supabase";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const vragen: string[] = [];
// Venster 1 januari t/m 18 januari 2026: de sync vraagt de weken vanaf de maandag ervoor
// (29 december), de maand gewoon vanaf de 1e.
const WEKEN = ["2025-12-29", "2026-01-05", "2026-01-12"];
const MAANDEN = ["2026-01-01"];
const ACTIE_AANKOOP = "111";
const ACTIE_NIEUWSBRIEF = "222";

// Per periode: Aankoop 10 conversies (waarde 1000), Nieuwsbrief 8 (waarde 0). Ongesegmenteerd telt
// de API ze samen: 18. Alle andere vragen (campagnes, zoektermen, apparaten, ...) krijgen niets
// terug.
const accountVraag = (q: string) => /FROM customer/.test(q) && !/segments\.device/.test(q);
function antwoord(vraag: string): unknown {
  if (!accountVraag(vraag)) return [];
  const segment = /segments\.week/.test(vraag) ? "week" : /segments\.month/.test(vraag) ? "month" : null;
  if (!segment) return [];
  const perioden = segment === "week" ? WEKEN : MAANDEN;
  if (/segments\.conversion_action/.test(vraag)) {
    return [{ results: perioden.flatMap((p) => [
      { segments: { [segment]: p, conversionAction: `customers/1/conversionActions/${ACTIE_AANKOOP}` }, metrics: { conversions: 10, conversionsValue: 1000 } },
      { segments: { [segment]: p, conversionAction: `customers/1/conversionActions/${ACTIE_NIEUWSBRIEF}` }, metrics: { conversions: 8, conversionsValue: 0 } },
    ]) }];
  }
  return [{ results: perioden.map((p) => ({
    segments: { [segment]: p },
    metrics: { impressions: 500, clicks: 50, costMicros: 100_000_000, conversions: 18, conversionsValue: 1000, ctr: 0.1, averageCpc: 2_000_000 },
  })) }];
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("oauth2") || url.includes("/token")) return json({ access_token: "a", expires_in: 3600 });
  if (!url.includes("googleAds:searchStream")) return json([]);
  const vraag = String(JSON.parse(String(init?.body ?? "{}")).query ?? "").replace(/\s+/g, " ").trim();
  vragen.push(vraag);
  return json(antwoord(vraag));
}) as typeof fetch;

const bereik = (q: string) => q.match(/segments\.date BETWEEN '([^']+)' AND '([^']+)'/)?.slice(1, 3).join("..") ?? "?";

async function main() {
  const { syncClient } = await import("./orchestrator");
  const sb = new FakeSupabase();
  sb.seed("client_settings", [{
    client_id: "gads-1",
    conversion_actions: [
      { id: ACTIE_AANKOOP, name: "Aankoop", includedInDashboard: true },
      { id: ACTIE_NIEUWSBRIEF, name: "Nieuwsbrief", includedInDashboard: false },
    ],
    checkout_action_map: null,
  }]);
  sb.seed("accounts", [{ client_id: "gads-1", name: "K", source: "google_ads", external_id: "1", agency_id: null }]);

  const resultaat = await syncClient({
    supabase: sb as never,
    credentials: { developerToken: "t", clientId: "c", clientSecret: "s", refreshToken: "r" },
    clientId: "gads-1",
    customerId: "1",
    syncType: "manual",
    startDate: "2026-01-01",
    endDate: "2026-01-18",
  });

  console.log("de vragen aan de API");
  const week = vragen.filter((q) => accountVraag(q) && /segments\.week/.test(q));
  const maand = vragen.filter((q) => accountVraag(q) && /segments\.month/.test(q));
  const weekGefilterd = week.filter((q) => /segments\.conversion_action/.test(q));
  const maandGefilterd = maand.filter((q) => /segments\.conversion_action/.test(q));
  check("de maandvraag is in tweeen gedeeld: basis plus per conversieactie", maand.length === 2 && maandGefilterd.length === 1, `${maand.length} maandvragen, ${maandGefilterd.length} per actie`);
  check("de weekvraag ook: basis plus per conversieactie, net als de maand", week.length === 2 && weekGefilterd.length === 1, `${week.length} weekvragen, ${weekGefilterd.length} per actie`);
  check("beide weekvragen op hetzelfde bereik, vanaf de maandag voor het venster",
    week.length === 2 && week.every((q) => bereik(q) === "2025-12-29..2026-01-18"), week.map(bereik).join(" | "));

  console.log("wat er in de database staat");
  const weekRijen = (sb.tables["ads_account_weekly"] ?? []) as Array<Record<string, unknown>>;
  const maandRijen = (sb.tables["ads_account_monthly_legacy"] ?? []) as Array<Record<string, unknown>>;
  const weekDataset = resultaat.datasetResults.find((d) => d.name === "ads_account_weekly");
  const maandDataset = resultaat.datasetResults.find((d) => d.name === "ads_account_monthly");
  check("ads_account_weekly is geschreven", weekDataset?.success === true && weekRijen.length === WEKEN.length, JSON.stringify(weekDataset));
  check("ads_account_monthly is geschreven", maandDataset?.success === true && maandRijen.length === MAANDEN.length, JSON.stringify(maandDataset));
  check("de maandrij telt alleen de aangevinkte actie: 10, niet 18", maandRijen.every((r) => r.conversions === 10), JSON.stringify(maandRijen.map((r) => r.conversions)));
  check("elke weekrij telt dezelfde selectie als de maand: 10, niet 18", weekRijen.every((r) => r.conversions === 10), JSON.stringify(weekRijen.map((r) => r.conversions)));
  check("de conversiewaarde van de weekrijen is ook alleen die van de aangevinkte actie", weekRijen.every((r) => r.conversions_value === 1000), JSON.stringify(weekRijen.map((r) => r.conversions_value)));
  check("kosten en klikken van de weekrijen blijven het hele account", weekRijen.every((r) => r.cost === 100 && r.clicks === 50), JSON.stringify(weekRijen[0]));
  check("CPA en conversieratio van de weekrijen over de geselecteerde conversies: 100 / 10 en 10 / 50",
    weekRijen.every((r) => r.cost_per_conversion === 10 && r.conversion_rate === 0.2), JSON.stringify(weekRijen.map((r) => [r.cost_per_conversion, r.conversion_rate])));
  check("de weekrijen staan op hun maandag, de eerste op 29 december", weekRijen.map((r) => r.week_start).join(",") === WEKEN.join(","), weekRijen.map((r) => r.week_start).join(","));

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
