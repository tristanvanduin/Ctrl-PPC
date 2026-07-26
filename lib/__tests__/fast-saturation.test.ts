export {};
// Verificatie van de snelle verzadigingsdetectie. De kern die dit moet waarmaken: bij campagnes van
// hooguit vier maanden moet een oordeel er binnen weken zijn, niet na een kwartaal. Het venster
// wordt daarom op VOLUME gekozen, niet op tijd — veel volume betekent snel een uitspraak, weinig
// volume betekent langer wachten op dezelfde bewijslast.
// Draaien: npx tsx lib/__tests__/fast-saturation.test.ts

import {
  buildFastSaturationSignals, chooseWindow, MIN_IMPRESSIONS_PER_WINDOW,
  CPM_RISE_THRESHOLD, type SaturationPoint,
} from "../signals/fast-saturation";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const DAY = 86_400_000;
const ANCHOR = Date.parse("2026-06-30T00:00:00Z");
const dateAt = (daysAgo: number) => new Date(ANCHOR - daysAgo * DAY).toISOString().slice(0, 10);

/** Bouwt dagrijen vanuit vertoningen/CPM/CTR zodat de tests in die termen leesbaar blijven. */
function days(
  channel: string, from: number, to: number,
  impPerDay: number, cpm: number, ctr: number, frequency?: number,
): SaturationPoint[] {
  const out: SaturationPoint[] = [];
  for (let d = from; d >= to; d--) {
    out.push({
      channel, date: dateAt(d),
      impressions: impPerDay,
      clicks: Math.round(impPerDay * ctr),
      spend: (impPerDay / 1000) * cpm,
      frequency,
    });
  }
  return out;
}

console.log("\n1. Veel volume → oordeel al na 7 dagen (niet wachten op maanden)");
{
  // 20k vertoningen per dag: één week haalt de volume-eis ruim.
  const rows = [
    ...days("meta_ads", 13, 7, 20_000, 6.0, 0.020),   // vorige week
    ...days("meta_ads", 6, 0, 20_000, 7.5, 0.016),    // deze week: CPM +25%, CTR -20%
  ];
  const w = chooseWindow(rows, ANCHOR);
  check("kortste venster gekozen (7 dagen)", w?.days === 7, String(w?.days));
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("verzadiging gedetecteerd", r.triggered[0]?.id === "snelle_verzadiging_meta_ads", r.triggered[0]?.id);
  check("venster staat in het verhaal", /7 dagen/.test(r.triggered[0]?.story ?? ""));
}

console.log("\n2. Weinig volume → langer venster, zelfde bewijslast (geen oordeel op ruis)");
{
  // 800 vertoningen per dag: pas over ~28 dagen per helft is de volume-eis gehaald.
  const rows = [
    ...days("linkedin_ads", 55, 28, 800, 40, 0.010),
    ...days("linkedin_ads", 27, 0, 800, 50, 0.008),
  ];
  const w = chooseWindow(rows, ANCHOR);
  check("langer venster gekozen", (w?.days ?? 0) >= 14, String(w?.days));
  check("beide helften halen de volume-eis", (w?.recent.impressions ?? 0) >= MIN_IMPRESSIONS_PER_WINDOW && (w?.prior.impressions ?? 0) >= MIN_IMPRESSIONS_PER_WINDOW);
  check("er komt wél een oordeel", buildFastSaturationSignals(rows, ANCHOR).triggered.length === 1);
}

console.log("\n3. Te weinig data → geen venster, geen uitspraak");
{
  const rows = days("meta_ads", 6, 0, 300, 6, 0.02); // één week, nauwelijks volume
  check("geen venster", chooseWindow(rows, ANCHOR) === null);
  check("stil", buildFastSaturationSignals(rows, ANCHOR).triggered.length === 0);
}

console.log("\n4. Het scenario dat de maandversie miste: 4-weekse campagne die verzadigt");
{
  // Precies waar het om gaat — een campagne die pas 4 weken loopt. De maandvariant had hier
  // nog niets kunnen zeggen; deze wel, met nog ~3 maanden om bij te sturen.
  const rows = [
    ...days("meta_ads", 27, 14, 25_000, 5.5, 0.021),
    ...days("meta_ads", 13, 0, 25_000, 7.0, 0.017),
  ];
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("signaal binnen 4 weken", r.triggered.length === 1, JSON.stringify(r.triggered.map((t) => t.id)));
  check("actie benoemt de urgentie van een korte campagne", /campagne/i.test(r.triggered[0]?.actionDirection ?? ""));
}

console.log("\n5. Frequency (Meta): de vroegste waarschuwing, met eigen diagnose");
{
  const rows = [
    ...days("meta_ads", 13, 7, 20_000, 6.0, 0.020, 2.0),
    ...days("meta_ads", 6, 0, 20_000, 6.2, 0.016, 2.6), // freq +30%, CTR -20%, CPM nauwelijks
  ];
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("frequency-signaal", r.triggered[0]?.id === "snelle_frequency_uitputting_meta_ads", r.triggered[0]?.id);
  check("noemt herhaling i.p.v. bereik", /herhaling|dezelfde mensen/i.test(r.triggered[0]?.story ?? ""));
  check("eerlijk over benadering: certainty = indicatie", r.triggered[0]?.certainty === "indicatie");
  check("geen dubbelmelding met het CPM-verhaal", r.triggered.length === 1);
}

console.log("\n6. CPM omhoog met CTR overeind → veilingdruk, expliciet geen creative-ingreep");
{
  const rows = [
    ...days("google_ads", 13, 7, 30_000, 6.0, 0.020),
    ...days("google_ads", 6, 0, 30_000, 7.5, 0.0205),
  ];
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("veilingdruk", r.triggered[0]?.id === "snelle_bereikkosten_google_ads", r.triggered[0]?.id);
  check("zegt dat creative-ingreep niet nodig is", /geen creative/i.test(r.triggered[0]?.actionDirection ?? ""));
}

console.log("\n7. Weekbuckets (Google) tellen net zo goed mee als dagrijen");
{
  // Google levert weekdata: één bucket per 7 dagen met het weektotaal.
  const wk = (daysAgo: number, imp: number, cpm: number, ctr: number): SaturationPoint => ({
    channel: "google_ads", date: dateAt(daysAgo),
    impressions: imp, clicks: Math.round(imp * ctr), spend: (imp / 1000) * cpm,
  });
  const rows = [wk(21, 80_000, 6.0, 0.020), wk(14, 80_000, 6.1, 0.020), wk(7, 80_000, 7.4, 0.016), wk(0, 80_000, 7.6, 0.0155)];
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("weekbuckets geven een oordeel", r.triggered.length === 1, JSON.stringify(r.triggered.map((t) => t.id)));
  check("het is verzadiging", r.triggered[0]?.id.startsWith("snelle_verzadiging"), r.triggered[0]?.id);
}

console.log("\n8. Stabiel kanaal blijft stil, en kanalen worden apart beoordeeld");
{
  const rows = [
    ...days("meta_ads", 13, 7, 20_000, 6.0, 0.020),
    ...days("meta_ads", 6, 0, 20_000, 7.5, 0.016),   // verzadigt
    ...days("linkedin_ads", 13, 7, 20_000, 40, 0.010),
    ...days("linkedin_ads", 6, 0, 20_000, 40.2, 0.0101), // vlak
  ];
  const r = buildFastSaturationSignals(rows, ANCHOR);
  check("alleen Meta meldt", r.triggered.length === 1 && r.triggered[0].id.includes("meta_ads"), JSON.stringify(r.triggered.map((t) => t.id)));
}

console.log("\n9. Drempel: net onder blijft stil");
{
  const rows = [
    ...days("meta_ads", 13, 7, 20_000, 10, 0.02),
    ...days("meta_ads", 6, 0, 20_000, 10 * (1 + CPM_RISE_THRESHOLD - 0.03), 0.02),
  ];
  check("net onder de drempel → stil", buildFastSaturationSignals(rows, ANCHOR).triggered.length === 0);
}

console.log("\n10. Anker op de laatste meetdag, niet op vandaag (advertentiedata loopt achter)");
{
  // Alle data is 5 dagen oud; zonder anker-op-laatste-dag zou het recente venster leeg zijn.
  const rows = [
    ...days("meta_ads", 18, 12, 20_000, 6.0, 0.020),
    ...days("meta_ads", 11, 5, 20_000, 7.5, 0.016),
  ];
  const r = buildFastSaturationSignals(rows); // geen expliciet anker
  check("detecteert ondanks vertraagde data", r.triggered.length === 1, JSON.stringify(r.triggered.map((t) => t.id)));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
