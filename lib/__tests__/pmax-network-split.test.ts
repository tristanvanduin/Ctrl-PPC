export {};
// Verificatie van de PMax-netwerkverdeling. Het gaat hier niet om het tekenen van een donut maar
// om wat die donut beweert: aandelen die uit de totalen komen, en een scheefheid-signaal dat
// zwijgt waar het niets kan weten (geen conversies) of niets betekent (piepklein netwerk).
// Draaien: npx tsx lib/__tests__/pmax-network-split.test.ts

import {
  buildNetworkSplit, findImbalances, networkTotals, networkLabel, isIntentNetwork, isBrowseNetwork,
  MIN_COST_SHARE_TO_FLAG, SHARE_GAP_THRESHOLD, type NetworkRow,
} from "../pmax/network-split";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const near = (a: number | null, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

function n(networkType: string, cost: number, conversions: number, over: Partial<NetworkRow> = {}): NetworkRow {
  return { networkType, cost, conversions, conversionsValue: conversions * 100, impressions: 10_000, clicks: 200, ...over };
}

console.log("\n1. Aandelen komen uit de totalen, gesorteerd op kosten");
{
  const s = buildNetworkSplit([n("SEARCH", 600, 30), n("CONTENT", 300, 5), n("YOUTUBE_WATCH", 100, 5)]);
  check("grootste kostenpost eerst", s.map((x) => x.networkType).join(",") === "SEARCH,CONTENT,YOUTUBE_WATCH", s.map((x) => x.networkType).join(","));
  check("kostenaandeel Zoeken = 60%", near(s[0].costShare, 0.6));
  check("conversie-aandeel Zoeken = 75%", near(s[0].conversionShare, 0.75));
  check("aandelen tellen op tot 1", near(s.reduce((a, x) => a + x.costShare, 0), 1));
  check("CPA uit de eigen totalen", near(s[0].cpa, 20));
  check("labels vertaald", s.map((x) => x.label).join(",") === "Zoeken,Display,YouTube", s.map((x) => x.label).join(","));
}

console.log("\n2. Scheefheid: kost meer dan het oplevert");
{
  // Display: 30% van de kosten, 12,5% van de conversies -> gat van 17,5 punt.
  const s = buildNetworkSplit([n("SEARCH", 600, 30), n("CONTENT", 300, 5), n("YOUTUBE_WATCH", 100, 5)]);
  const display = s.find((x) => x.networkType === "CONTENT")!;
  check("shareGap positief", (display.shareGap ?? 0) > 0);
  const imb = findImbalances(s);
  check("Display gemarkeerd als duur", imb.some((i) => i.slice.networkType === "CONTENT" && i.kind === "duur"));
  check("Zoeken gemarkeerd als efficiënt", imb.some((i) => i.slice.networkType === "SEARCH" && i.kind === "efficient"));
  check("sterkste scheefheid eerst", Math.abs(imb[0].slice.shareGap!) >= Math.abs(imb[imb.length - 1].slice.shareGap!));
}

console.log("\n3. Klein netwerk met grote scheefheid → geen bevinding");
{
  // 3% van de kosten, nul conversies: procentueel dramatisch, in euro's verwaarloosbaar.
  const s = buildNetworkSplit([n("SEARCH", 970, 40), n("CONTENT", 30, 0)]);
  const display = s.find((x) => x.networkType === "CONTENT")!;
  check("kostenaandeel onder de drempel", display.costShare < MIN_COST_SHARE_TO_FLAG);
  check("niet gemarkeerd", !findImbalances(s).some((i) => i.slice.networkType === "CONTENT"));
}

console.log("\n4. Geen conversies → geen aandeel en geen oordeel");
{
  const s = buildNetworkSplit([n("SEARCH", 600, 0), n("CONTENT", 400, 0)]);
  check("conversie-aandeel is null, niet 0", s.every((x) => x.conversionShare === null));
  check("shareGap is null", s.every((x) => x.shareGap === null));
  check("geen scheefheid gemeld", findImbalances(s).length === 0);
  check("kostenaandeel wordt wél berekend", near(s[0].costShare, 0.6));
  check("totalen weten dat er geen conversies zijn", networkTotals(s).hasConversions === false);
}

console.log("\n5. Net onder de drempel blijft stil");
{
  // Gat van precies iets minder dan de drempel bij een ruim netwerk.
  const gap = SHARE_GAP_THRESHOLD - 0.02;
  // kosten 50/50; conversies zo gekozen dat het gat net onder de drempel blijft
  const convA = 50 + gap * 100, convB = 100 - convA;
  const s = buildNetworkSplit([n("SEARCH", 500, convB), n("CONTENT", 500, convA)]);
  check("net onder de drempel → stil", findImbalances(s).length === 0, JSON.stringify(s.map((x) => x.shareGap)));
}

console.log("\n6. Rijen van hetzelfde netwerk (meerdere maanden/asset groups) worden opgeteld");
{
  const s = buildNetworkSplit([
    n("SEARCH", 300, 10), n("SEARCH", 300, 20),
    n("CONTENT", 400, 5),
  ]);
  check("twee netwerken", s.length === 2);
  const search = s.find((x) => x.networkType === "SEARCH")!;
  check("kosten opgeteld", search.cost === 600);
  check("conversies opgeteld", search.conversions === 30);
  check("CPA uit het totaal, niet gemiddeld", near(search.cpa, 20));
}

console.log("\n7. Onbekend netwerktype blijft zichtbaar onder eigen naam");
{
  const s = buildNetworkSplit([n("SEARCH", 500, 10), n("NIEUW_NETWERK", 500, 10)]);
  check("blijft als eigen segment bestaan", s.some((x) => x.networkType === "NIEUW_NETWERK"));
  check("label valt terug op de ruwe waarde", networkLabel("NIEUW_NETWERK") === "NIEUW_NETWERK");
  check("verdwijnt niet onder 'overig'", s.length === 2);
}

console.log("\n8. Leeg en nul-kosten: geen deling door nul");
{
  check("lege invoer", buildNetworkSplit([]).length === 0);
  const zero = buildNetworkSplit([n("SEARCH", 0, 0)]);
  check("nul kosten geeft aandeel 0, geen NaN", zero[0].costShare === 0);
  check("geen CPA", zero[0].cpa === null);
  const t = networkTotals(zero);
  check("totalen kloppen", t.cost === 0 && t.conversions === 0);
}


// ── v23-kanalen ────────────────────────────────────────────────────────────
// Sinds API v23 splitst PMax uit naar Maps, Discover, Gmail en Google TV in plaats van alles op
// MIXED te gooien. Zonder label verschijnt de grootste taartpunt als kale enum-naam, en Maps is
// in echte accounts regelmatig juist de grootste kostenpost.
console.log("\nAlle v23-netwerktypes hebben een label");
for (const t of ["SEARCH", "SEARCH_PARTNERS", "CONTENT", "MIXED", "YOUTUBE", "GOOGLE_TV", "DISCOVER", "GMAIL", "MAPS", "GOOGLE_OWNED_CHANNELS"]) {
  const label = networkLabel(t);
  check(`${t} vertaald`, label !== t && label.length > 0, `kreeg "${label}"`);
}
check("onbekende toekomstige waarde valt terug op zichzelf", networkLabel("IETS_NIEUWS") === "IETS_NIEUWS");


// De tweedeling intentie/bereik zat op drie plekken uitgeschreven als CONTENT + YOUTUBE_WATCH.
// Sinds v23 is dat stil fout: een account waar een derde van het budget naar Maps gaat kwam zo
// op nul procent bereikinventaris uit, en het signaal over lage-kwaliteitsinventaris zweeg.
console.log("\nIntentie versus bereik");
for (const t of ["SEARCH", "SEARCH_PARTNERS"]) {
  check(`${t} is intentie`, isIntentNetwork(t) && !isBrowseNetwork(t));
}
for (const t of ["CONTENT", "YOUTUBE", "MAPS", "DISCOVER", "GMAIL", "GOOGLE_TV", "YOUTUBE_WATCH"]) {
  check(`${t} is bereik`, isBrowseNetwork(t) && !isIntentNetwork(t));
}
for (const t of ["MIXED", "UNSPECIFIED", "UNKNOWN", "GOOGLE_OWNED_CHANNELS"]) {
  check(`${t} telt aan geen van beide kanten`, !isBrowseNetwork(t) && !isIntentNetwork(t));
}
check("lege waarde valt buiten beide", !isBrowseNetwork("") && !isIntentNetwork(""));
check("hoofdletterongevoelig", isIntentNetwork("search") && isBrowseNetwork("maps"));


console.log("\nLege netwerken vallen af");
{
  // Sinds v23 rapporteert Google ook kanalen waar niets gebeurde; die horen niet in de ring.
  const met = buildNetworkSplit([
    { networkType: "SEARCH", cost: 100, conversions: 10, conversionsValue: 1000, impressions: 5000, clicks: 200 },
    { networkType: "GMAIL", cost: 0, conversions: 0, conversionsValue: 0, impressions: 0, clicks: 0 },
  ]);
  check("een volledig leeg netwerk verdwijnt", met.length === 1 && met[0].networkType === "SEARCH", met.map((x) => x.networkType).join(","));
  const gratis = buildNetworkSplit([
    { networkType: "SEARCH", cost: 100, conversions: 10, conversionsValue: 1000, impressions: 5000, clicks: 200 },
    { networkType: "DISCOVER", cost: 0, conversions: 0, conversionsValue: 0, impressions: 4000, clicks: 12 },
  ]);
  check("nul kosten maar wel bereik blijft staan", gratis.length === 2, gratis.map((x) => x.networkType).join(","));
  check("aandelen tellen nog steeds op tot een", Math.abs(met.reduce((s, x) => s + x.costShare, 0) - 1) < 1e-9);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
