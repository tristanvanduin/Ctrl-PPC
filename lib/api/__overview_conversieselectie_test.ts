// Het portfolio-overzicht (app/api/google-ads/overview/route.ts) telt dezelfde conversies als het
// klantdashboard. Geen netwerk: fetch is vervangen, Google Ads en Supabase worden nagebootst.
// Draaien: tsx lib/api/__overview_conversieselectie_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De client-data-route leest bij elk verzoek client_settings.conversion_actions en vraagt Google
// alleen de aangevinkte acties. Het overzicht vroeg alles. Een account met "Aankoop" (100 per
// maand, aangevinkt) en "Nieuwsbrief" (80 per maand, niet aangevinkt) stond in het portfolio op
// 540 conversies over januari-maart en op het dashboard op 300 -- dezelfde klant, dezelfde
// periode, twee getallen.

// Een module en geen los script: de route komt pas binnen (dynamisch) nadat fetch en de omgeving
// hieronder vervangen zijn, en zonder import of export deelt dit bestand voor tsc zijn
// bovenste namen met elk ander los testscript.
export {};

process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "t";
process.env.GOOGLE_ADS_CLIENT_ID = "c";
process.env.GOOGLE_ADS_CLIENT_SECRET = "s";
process.env.GOOGLE_ADS_REFRESH_TOKEN = "r";
delete process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb.invalid";
process.env.SUPABASE_URL = "http://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Account 123 heeft een selectie (alleen actie 1), account 456 heeft geen instellingenrij. */
const INSTELLINGEN = [
  { client_id: "gads-123", conversion_actions: [
    { id: "1", name: "Aankoop", includedInDashboard: true },
    { id: "2", name: "Nieuwsbrief", includedInDashboard: false },
  ] },
];
let instellingenFout = false;
const googleVragen: { klant: string; vraag: string }[] = [];
const supabaseVragen: string[] = [];

function maanden(van: string, tot: string): string[] {
  const uit: string[] = [];
  let [j, m] = van.slice(0, 7).split("-").map(Number);
  const [tj, tm] = tot.slice(0, 7).split("-").map(Number);
  while (j < tj || (j === tj && m <= tm)) {
    uit.push(`${j}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) { m = 1; j += 1; }
  }
  return uit;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("oauth2") || url.includes("/token")) return json({ access_token: "a", expires_in: 3600 });
  if (url.startsWith("http://sb.invalid")) {
    supabaseVragen.push(decodeURIComponent(url));
    if (url.includes("client_settings")) {
      if (instellingenFout) return json({ message: "verbinding weg", code: "XX000" }, 500);
      return json(INSTELLINGEN.filter((r) => decodeURIComponent(url).includes(r.client_id)));
    }
    return json([]);
  }
  if (url.includes("googleAds:searchStream")) {
    const klant = url.match(/customers\/(\d+)\//)?.[1] ?? "?";
    const vraag = String(JSON.parse(String(init?.body ?? "{}")).query ?? "").replace(/\s+/g, " ").trim();
    googleVragen.push({ klant, vraag });
    const w = vraag.match(/BETWEEN '(\d{4}-\d{2}-\d{2})' AND '(\d{4}-\d{2}-\d{2})'/);
    if (!w || !/FROM customer/.test(vraag) || !/segments\.month/.test(vraag)) return json([]);
    const ms = maanden(w[1], w[2]).filter((m) => m <= "2026-10-01");
    if (/segments\.conversion_action/.test(vraag)) {
      return json([{ results: ms.flatMap((m) => [
        { segments: { month: m, conversionAction: `customers/${klant}/conversionActions/1` }, metrics: { conversions: 100, conversionsValue: 10000 } },
        { segments: { month: m, conversionAction: `customers/${klant}/conversionActions/2` }, metrics: { conversions: 80, conversionsValue: 0 } },
      ]) }]);
    }
    return json([{ results: ms.map((m) => ({ segments: { month: m }, metrics: {
      impressions: 1000, clicks: 100, costMicros: 1_000_000_000, conversions: 180, conversionsValue: 10000, ctr: 0.1, averageCpc: 10_000_000,
    } })) }]);
  }
  return json([]);
}) as typeof fetch;

async function main() {
  const { NextRequest } = await import("next/server");
  const overview = await import("../../app/api/google-ads/overview/route");
  const vraag = () => new NextRequest("http://x/api/google-ads/overview?customerIds=123,456&start=2026-01&end=2026-03");

  console.log("De conversieselectie in het portfolio-overzicht");
  const r = await overview.GET(vraag());
  const body = await r.json() as { accounts: { customerId: string; ytd?: { conversions: number; cpa: number }; error?: string }[] };
  const a = (id: string) => body.accounts.find((x) => x.customerId === id);
  check("met selectie: januari-maart 300 conversies, zoals het dashboard (was 540)", a("123")?.ytd?.conversions === 300,
    JSON.stringify(a("123")));
  check("met selectie: de CPA uit die 300 (3.000 / 300 = 10)", a("123")?.ytd?.cpa === 10, String(a("123")?.ytd?.cpa));
  check("met selectie: Google wordt per conversieactie gevraagd",
    googleVragen.some((q) => q.klant === "123" && /segments\.conversion_action/.test(q.vraag)));
  check("zonder instellingenrij: niet gefilterd, alle 540", a("456")?.ytd?.conversions === 540, JSON.stringify(a("456")));
  check("zonder instellingenrij: geen vraag per conversieactie",
    !googleVragen.some((q) => q.klant === "456" && /segments\.conversion_action/.test(q.vraag)));
  const instellingen = supabaseVragen.filter((u) => u.includes("client_settings"));
  check("de selectie wordt één keer gelezen voor alle accounts", instellingen.length === 1 && /client_id=in\.\(.*gads-123.*gads-456.*\)/.test(instellingen[0] ?? ""),
    instellingen.join(" | "));

  // Een leesfout is geen "alles meetellen": ongefilterde cijfers zien er net zo geloofwaardig uit.
  instellingenFout = true;
  const fout = await overview.GET(vraag());
  check("een leesfout op client_settings wordt een 500, geen stille terugval op ongefilterd", fout.status === 500, String(fout.status));
  instellingenFout = false;

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
