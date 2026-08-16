export {};
// Verificatie van de vijf Search Console-detectoren (signals.ts) tegen de drempels uit
// MASTERPLAN sectie 5.6.2: elk triggert alleen bij genoeg bewijs en blijft stil eronder.
// Draaien: npx tsx lib/search-console/__gsc_signals_test.ts

import {
  buildBrandCannibalizationSignals, buildCtrAnomalySignals, buildPositionDropSignals,
  buildNonBrandOverlapSignals, buildRisingQuerySignals,
} from "./signals";
import type { GscQueryRow } from "./types";

const NOW = Date.parse("2026-08-16T12:00:00Z");
const day = (ageDays: number): string => new Date(NOW - ageDays * 86_400_000).toISOString().slice(0, 10);

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log("\n1. buildBrandCannibalizationSignals");
{
  // Sterke, aanhoudende merkdominantie: elke week van de laatste 12, ruim boven de drempel.
  const rows: GscQueryRow[] = [];
  for (let w = 0; w < 12; w++) {
    for (let d = 0; d < 3; d++) rows.push({ date: day(w * 7 + d), query: "greentech", page: "/", clicks: 30, impressions: 100, ctr: 0.3, position: 1.2 });
  }
  const r = buildBrandCannibalizationSignals(rows, ["greentech"], { now: NOW });
  check("triggert bij sterke aanhoudende dominantie", r.triggered.length === 1, `triggered=${r.triggered.length}`);

  const teWeinigImpr = buildBrandCannibalizationSignals(
    [{ date: day(0), query: "greentech", page: "/", clicks: 5, impressions: 50, ctr: 0.1, position: 1.2 }],
    ["greentech"], { now: NOW }
  );
  check("stil bij te weinig vertoningen", teWeinigImpr.triggered.length === 0);

  const teWeinigWeken = buildBrandCannibalizationSignals(
    Array.from({ length: 30 }, (_, i) => ({ date: day(i), query: "greentech", page: "/", clicks: 40, impressions: 100, ctr: 0.4, position: 1.1 })),
    ["greentech"], { now: NOW }
  ); // 30 dagen = 5 weken, onder de 8-van-12-drempel
  check("stil bij te weinig weekbuckets (alle volume in <8 weken)", teWeinigWeken.triggered.length === 0);

  const zwakkePositie = buildBrandCannibalizationSignals(
    Array.from({ length: 84 }, (_, i) => ({ date: day(i), query: "greentech", page: "/", clicks: 10, impressions: 50, ctr: 0.2, position: 6 })),
    ["greentech"], { now: NOW }
  );
  check("stil bij zwakke positie (rankt niet al bovenaan)", zwakkePositie.triggered.length === 0);

  const geenMerktermen = buildBrandCannibalizationSignals(rows, [], { now: NOW });
  check("stil zonder geconfigureerde merktermen", geenMerktermen.triggered.length === 0);
}

console.log("\n2. buildCtrAnomalySignals");
{
  const rows: GscQueryRow[] = [];
  // Baseline op positiebucket 3: 40 gezonde rijen, CTR ~15%.
  for (let i = 0; i < 40; i++) rows.push({ date: day(i), query: `ref ${i}`, page: `/ref/${i}`, clicks: 15, impressions: 100, ctr: 0.15, position: 3 });
  // Eén afwijkende combinatie: zelfde bucket, CTR ver onder de baseline, genoeg volume.
  for (let i = 0; i < 10; i++) rows.push({ date: day(i), query: "afwijkend", page: "/afwijkend", clicks: 5, impressions: 100, ctr: 0.05, position: 3 });
  const r = buildCtrAnomalySignals(rows, { now: NOW });
  check("triggert bij CTR ver onder de eigen-baseline", r.triggered.some((s) => s.scope.includes("afwijkend")), JSON.stringify(r.triggered.map((s) => s.scope)));

  const teWeinigVolume = buildCtrAnomalySignals([
    ...Array.from({ length: 40 }, (_, i) => ({ date: day(i), query: `ref ${i}`, page: `/ref/${i}`, clicks: 15, impressions: 100, ctr: 0.15, position: 3 } as GscQueryRow)),
    { date: day(0), query: "te klein", page: "/te-klein", clicks: 2, impressions: 50, ctr: 0.04, position: 3 },
  ], { now: NOW });
  check("stil onder de flag-impressiedrempel", !teWeinigVolume.triggered.some((s) => s.scope.includes("te klein")));

  const teDunneBaseline = buildCtrAnomalySignals([
    { date: day(0), query: "enige", page: "/enige", clicks: 5, impressions: 600, ctr: 0.008, position: 7 },
  ], { now: NOW }); // maar 1 rij in bucket 7 — geen betrouwbare baseline
  check("stil bij te dunne baseline in de positiebucket", teDunneBaseline.triggered.length === 0);
}

console.log("\n3. buildPositionDropSignals");
{
  const rows: GscQueryRow[] = [];
  // Baseline (dag 7-34): positie ~3, ruim boven de impressiedrempel.
  for (let i = 7; i < 35; i++) rows.push({ date: day(i), query: "q", page: "/pagina-a", clicks: 20, impressions: 60, ctr: 0.33, position: 3 });
  // Recent (dag 0-6): positie ~9 — een drop van 6, boven de drempel van 3.
  for (let i = 0; i < 7; i++) rows.push({ date: day(i), query: "q", page: "/pagina-a", clicks: 3, impressions: 60, ctr: 0.05, position: 9 });
  const r = buildPositionDropSignals(rows, { now: NOW });
  check("triggert bij een aanhoudende positie-drop", r.triggered.some((s) => s.scope === "/pagina-a"), JSON.stringify(r.triggered.map((s) => s.scope)));

  const kleineDrop: GscQueryRow[] = [
    ...Array.from({ length: 28 }, (_, i) => ({ date: day(7 + i), query: "q", page: "/stabiel", clicks: 20, impressions: 60, ctr: 0.33, position: 3 } as GscQueryRow)),
    ...Array.from({ length: 7 }, (_, i) => ({ date: day(i), query: "q", page: "/stabiel", clicks: 18, impressions: 60, ctr: 0.3, position: 4 } as GscQueryRow)),
  ];
  const rStabiel = buildPositionDropSignals(kleineDrop, { now: NOW });
  check("stil bij een drop onder de drempel (1 positie)", !rStabiel.triggered.some((s) => s.scope === "/stabiel"));
}

console.log("\n4. buildNonBrandOverlapSignals");
{
  const rows: GscQueryRow[] = Array.from({ length: 30 }, (_, i) => ({
    date: day(i), query: "zonnepanelen zakelijk", page: "/diensten", clicks: 50, impressions: 1200 / 30, ctr: 0.04, position: 3,
  }));
  const r = buildNonBrandOverlapSignals(rows, [], new Set(["zonnepanelen zakelijk"]), { now: NOW });
  check("triggert bij organisch sterke, ook betaald getargete non-brand term", r.triggered.length === 1, `triggered=${r.triggered.length}`);

  const nietInAds = buildNonBrandOverlapSignals(rows, [], new Set(["andere term"]), { now: NOW });
  check("stil als de term niet in de Ads-zoektermenlijst staat", nietInAds.triggered.length === 0);

  const merktermRows: GscQueryRow[] = Array.from({ length: 30 }, (_, i) => ({
    date: day(i), query: "greentech zonnepanelen", page: "/", clicks: 50, impressions: 1200 / 30, ctr: 0.04, position: 1,
  }));
  const merktermUitgesloten = buildNonBrandOverlapSignals(merktermRows, ["greentech"], new Set(["greentech zonnepanelen"]), { now: NOW });
  check("merktermen worden uitgesloten, ook al matchen ze verder alle criteria", merktermUitgesloten.triggered.length === 0);

  const geenAdsTermen = buildNonBrandOverlapSignals(rows, [], new Set(), { now: NOW });
  check("stil zonder Ads-zoektermenlijst om tegen te joinen", geenAdsTermen.triggered.length === 0);
}

console.log("\n5. buildRisingQuerySignals");
{
  const rows: GscQueryRow[] = [
    // Nieuw: alleen in de laatste 28 dagen, genoeg volume.
    { date: day(5), query: "nieuwe term", page: "/", clicks: 8, impressions: 60, ctr: 0.13, position: 6 },
    // Bestond al vóór het venster: mag niet als "nieuw" gelden.
    { date: day(5), query: "oude term", page: "/", clicks: 8, impressions: 60, ctr: 0.13, position: 6 },
    { date: day(60), query: "oude term", page: "/", clicks: 4, impressions: 30, ctr: 0.13, position: 8 },
  ];
  const r = buildRisingQuerySignals(rows, { now: NOW });
  check("triggert op een echt nieuwe zoekterm", r.triggered.some((s) => s.scope.includes("nieuwe term")), JSON.stringify(r.triggered.map((s) => s.scope)));
  check("negeert een term met voorgeschiedenis vóór het venster", !r.triggered.some((s) => s.scope.includes("oude term")));

  const teWeinigVolume = buildRisingQuerySignals([{ date: day(1), query: "te klein", page: "/", clicks: 1, impressions: 20, ctr: 0.05, position: 8 }], { now: NOW });
  check("stil onder de volumedrempel", teWeinigVolume.triggered.length === 0);
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
