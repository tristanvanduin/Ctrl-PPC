export {};
// Verificatie van de CPM/verzadigingsdetector. De kern die stil fout kan gaan: het onderscheid
// tussen verzadiging (CPM omhoog + CTR omlaag → creative/publiek) en veilingdruk (CPM omhoog,
// CTR stabiel → markt). Die twee vragen om tegengestelde acties, dus een verwisseling stuurt je
// de verkeerde kant op. Daarnaast: zwijgen bij dunne volumes, want een CPM-sprong op een paar
// honderd vertoningen is ruis.
// Draaien: npx tsx lib/__tests__/blended-cpm.test.ts

import {
  buildBlendedCpmSignals, CPM_MIN_IMPRESSIONS, CPM_RISE_THRESHOLD,
} from "../signals/blended-cpm";
import type { ChannelMonthlyInput } from "../signals/cross-channel";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

// Bouwt een maandrij vanuit vertoningen + CPM + CTR, zodat de tests in die termen leesbaar blijven.
function m(channel: string, month: string, impressions: number, cpm: number, ctr: number): ChannelMonthlyInput {
  return {
    channel, month,
    impressions,
    clicks: Math.round(impressions * ctr),
    spend: (impressions / 1000) * cpm,
    conversions: 0, leads: 0,
  };
}

const IMP = 100_000;

console.log("\n1. CPM omhoog + CTR omlaag → verzadiging (creative/publiek)");
{
  const rows = [
    m("meta_ads", "2026-04-01", IMP, 6.0, 0.020),
    m("meta_ads", "2026-05-01", IMP, 7.0, 0.017),
    m("meta_ads", "2026-06-01", IMP, 8.4, 0.014), // +40% CPM, -30% CTR
  ];
  const r = buildBlendedCpmSignals(rows);
  const s = r.triggered[0];
  check("één signaal", r.triggered.length === 1, String(r.triggered.length));
  check("id is verzadiging", s?.id === "blended_cpm_verzadiging_meta_ads", s?.id);
  check("categorie creative", s?.category === "creative");
  check("actie wijst naar creatives/publiek", /creative|publiek/i.test(s?.actionDirection ?? ""));
  check("waarschuwt dat meer budget hier niet helpt", /budget/i.test(s?.actionDirection ?? ""));
}

console.log("\n2. CPM omhoog + CTR stabiel → veilingdruk (markt, geen creative-ingreep)");
{
  const rows = [
    m("google_ads", "2026-04-01", IMP, 6.0, 0.020),
    m("google_ads", "2026-05-01", IMP, 7.0, 0.020),
    m("google_ads", "2026-06-01", IMP, 8.0, 0.0205), // +33% CPM, CTR vlak
  ];
  const r = buildBlendedCpmSignals(rows);
  const s = r.triggered[0];
  check("id is veilingdruk", s?.id === "blended_cpm_veilingdruk_google_ads", s?.id);
  check("categorie veiling_concurrentie", s?.category === "veiling_concurrentie");
  check("zegt expliciet dat creative-ingreep niet nodig is", /geen creative/i.test(s?.actionDirection ?? ""));
}

console.log("\n3. Stabiele CPM → geen signaal (niet elk kanaal hoeft iets te melden)");
{
  const rows = [
    m("meta_ads", "2026-04-01", IMP, 6.0, 0.020),
    m("meta_ads", "2026-05-01", IMP, 6.1, 0.020),
    m("meta_ads", "2026-06-01", IMP, 6.2, 0.019), // +3%, ruim onder de drempel
  ];
  const r = buildBlendedCpmSignals(rows);
  check("niets getriggerd", r.triggered.length === 0);
  check("wel gerapporteerd wat onderzocht is", r.checked.length === 2);
}

console.log("\n4. Drempel: net onder blijft stil, net boven triggert");
{
  const under = buildBlendedCpmSignals([
    m("meta_ads", "2026-04-01", IMP, 10, 0.02),
    m("meta_ads", "2026-05-01", IMP, 10.5, 0.02),
    m("meta_ads", "2026-06-01", IMP, 10 * (1 + CPM_RISE_THRESHOLD - 0.02), 0.02),
  ]);
  check("net onder de drempel → stil", under.triggered.length === 0);

  const over = buildBlendedCpmSignals([
    m("meta_ads", "2026-04-01", IMP, 10, 0.02),
    m("meta_ads", "2026-05-01", IMP, 10.5, 0.02),
    m("meta_ads", "2026-06-01", IMP, 10 * (1 + CPM_RISE_THRESHOLD + 0.02), 0.02),
  ]);
  check("net boven de drempel → signaal", over.triggered.length === 1);
}

console.log("\n5. Dunne volumes: geen oordeel (een CPM-sprong op weinig vertoningen is ruis)");
{
  const thin = CPM_MIN_IMPRESSIONS - 1;
  const rows = [
    m("linkedin_ads", "2026-04-01", thin, 20, 0.010),
    m("linkedin_ads", "2026-05-01", thin, 40, 0.006),
    m("linkedin_ads", "2026-06-01", thin, 80, 0.004), // dramatisch, maar op niks gebaseerd
  ];
  check("stil ondanks +300% CPM", buildBlendedCpmSignals(rows).triggered.length === 0);

  // Eén dunne maand in het venster is al genoeg om te zwijgen.
  const oneThin = [
    m("linkedin_ads", "2026-04-01", IMP, 20, 0.010),
    m("linkedin_ads", "2026-05-01", thin, 30, 0.008),
    m("linkedin_ads", "2026-06-01", IMP, 40, 0.006),
  ];
  check("één dunne maand in het venster → stil", buildBlendedCpmSignals(oneThin).triggered.length === 0);
}

console.log("\n6. Te weinig historie → geen trendclaim");
{
  const rows = [
    m("meta_ads", "2026-05-01", IMP, 6, 0.02),
    m("meta_ads", "2026-06-01", IMP, 12, 0.01), // verdubbeling, maar slechts 2 maanden
  ];
  check("twee maanden → stil", buildBlendedCpmSignals(rows).triggered.length === 0);
}

console.log("\n7. Kanalen worden apart beoordeeld en krijgen elkaars CPM als context mee");
{
  const rows = [
    // Meta verzadigt.
    m("meta_ads", "2026-04-01", IMP, 6.0, 0.020),
    m("meta_ads", "2026-05-01", IMP, 7.0, 0.017),
    m("meta_ads", "2026-06-01", IMP, 8.4, 0.014),
    // LinkedIn blijft rustig.
    m("linkedin_ads", "2026-04-01", IMP, 30, 0.010),
    m("linkedin_ads", "2026-05-01", IMP, 30.5, 0.010),
    m("linkedin_ads", "2026-06-01", IMP, 31, 0.010),
  ];
  const r = buildBlendedCpmSignals(rows);
  check("alleen Meta triggert", r.triggered.length === 1 && r.triggered[0].id.includes("meta_ads"));
  const metrics = r.triggered[0].evidence.map((e) => e.metric).join(" | ");
  check("LinkedIn-CPM zit als context in het bewijs", /LinkedIn CPM/.test(metrics), metrics);
  check("de hoge LinkedIn-CPM leidt niet tot een eigen verwijt", !r.triggered.some((t) => t.id.includes("linkedin")));
}

console.log("\n8. Maandsleutel werkt met en zonder dagdeel");
{
  const withDay = buildBlendedCpmSignals([
    m("meta_ads", "2026-04-01", IMP, 6.0, 0.020),
    m("meta_ads", "2026-05-01", IMP, 7.0, 0.017),
    m("meta_ads", "2026-06-01", IMP, 8.4, 0.014),
  ]);
  const withoutDay = buildBlendedCpmSignals([
    m("meta_ads", "2026-04", IMP, 6.0, 0.020),
    m("meta_ads", "2026-05", IMP, 7.0, 0.017),
    m("meta_ads", "2026-06", IMP, 8.4, 0.014),
  ]);
  check("beide vormen geven hetzelfde resultaat", withDay.triggered.length === withoutDay.triggered.length && withDay.triggered.length === 1);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
