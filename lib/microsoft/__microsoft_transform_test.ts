// Test voor de Microsoft-rapporttransform: CSV-parse, getalnormalisatie, de labelvertalingen
// en de rijmappers. Deterministisch, geen IO. Draaien: npx tsx lib/microsoft/__microsoft_transform_test.ts

import {
  parseReportCsv, parseGetal, parseFractie, normaliseerNetwerk, normaliseerApparaat,
  normaliseerMatchType, naarDagRij, naarBreakdownRij, naarKeywordMaandRij, naarZoektermMaandRij,
  naarImpressieAandeelRij, naarProfielRij, naarCampagneRij, naarAdGroupRij, dagenInMaandTot,
} from "./transform";
import { bouwReportRequest, unzipEersteBestand } from "./api";
import { deflateRawSync } from "node:zlib";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function approx(a: unknown, b: number, label: string): void {
  assert(typeof a === "number" && Math.abs(a - b) < 1e-6, `${label} (kreeg ${a}, verwacht ${b})`);
}

// ── CSV-parse ───────────────────────────────────────────────────────────────

const csv = [
  "TimePeriod,CampaignId,CampaignName,Impressions,Clicks,Spend,Conversions,Revenue",
  '2026-08-14,101,"Camp, met ""quote""","1,234",56,78.90,3.5,420.00',
  "2026-08-15,101,Gewoon,200,10,12.34,0,0",
  "voetregel die niet meetelt",
].join("\r\n");
const rijen = parseReportCsv(csv);
assert(rijen.length === 2, "voetregel met afwijkend veldental overgeslagen");
assert(rijen[0].CampaignName === 'Camp, met "quote"', "quotes en komma's in veld geparseerd");
assert(rijen[0].Impressions === "1,234", "duizendtal blijft string tot parseGetal");

// ── Getallen ────────────────────────────────────────────────────────────────

approx(parseGetal("1,234"), 1234, "duizendtal-komma gestript");
approx(parseGetal("4.56%"), 4.56, "percent-teken gestript");
assert(parseGetal("--") === null, "-- is null, geen nul");
assert(parseGetal("") === null, "leeg is null");
approx(parseFractie("46.5%"), 0.465, "percent naar fractie");

// ── Labelvertalingen ────────────────────────────────────────────────────────

assert(normaliseerNetwerk("Microsoft sites and select traffic") === "Search", "netwerk: eigen sites → Search");
assert(normaliseerNetwerk("Audience") === "Audience Network", "netwerk: Audience → Audience Network");
assert(normaliseerNetwerk("Syndicated search partners") === "Syndicated search partners", "netwerk: partners blijven");
assert(normaliseerApparaat("Computer") === "Desktop", "apparaat: Computer → Desktop");
assert(normaliseerApparaat("Smartphone") === "Mobile", "apparaat: Smartphone → Mobile");
assert(normaliseerMatchType("Exact") === "exact", "matchtype kleingeschreven");

// ── Dagrij ──────────────────────────────────────────────────────────────────

const dag = naarDagRij(rijen[0], "klant", "101");
assert(dag !== null, "dagrij gemapt");
assert(dag?.date === "2026-08-14" && dag?.entity_id === "101", "datum en entiteit");
approx(dag?.ctr, 0.0454, "ctr afgeleid uit de eigen kolommen (4 decimalen)");
approx(dag?.avg_cpc, Math.round((78.9 / 56) * 100) / 100, "avg_cpc afgeleid");
assert(naarDagRij({ TimePeriod: "onzin" }, "klant", "101") === null, "onparseerbare datum → geen rij");

// ── Breakdown-rij ───────────────────────────────────────────────────────────

const bd = naarBreakdownRij(rijen[0], "klant", "acc-1", "network", "Search");
assert(bd?.level === "account" && bd?.breakdown_type === "network" && bd?.breakdown_value === "Search", "breakdown op level account");
assert(naarBreakdownRij(rijen[0], "klant", "acc-1", "network", "") === null, "lege segmentwaarde → geen rij");

// ── Keyword-maandrij ────────────────────────────────────────────────────────

const kwRij = naarKeywordMaandRij({
  TimePeriod: "2026-08-01", CampaignId: "101", CampaignName: "C", AdGroupId: "9", AdGroupName: "AG",
  KeywordId: "555", Keyword: "kas kopen", BidMatchType: "Phrase", QualityScore: "8",
  Impressions: "400", Clicks: "28", Spend: "38", Conversions: "4", Revenue: "800",
}, "klant");
assert(kwRij?.month === "2026-08-01" && kwRij?.match_type === "phrase", "maand en matchtype");
assert(kwRij?.quality_score === 8, "quality score als geheel getal");
approx(kwRij?.conversion_rate, 0.1429, "conversion_rate afgeleid (4 decimalen)");
approx(kwRij?.cost_per_conversion, 9.5, "cost_per_conversion afgeleid");

// ── Zoekterm-maandrij ───────────────────────────────────────────────────────

const st = naarZoektermMaandRij({
  TimePeriod: "2026-08-14", CampaignId: "101", CampaignName: "C", AdGroupId: "9", AdGroupName: "AG",
  SearchQuery: "kweekkas bedrijf", BidMatchType: "Broad", Impressions: "300", Clicks: "15", Spend: "20", Conversions: "2", Revenue: "300",
}, "klant");
assert(st?.month === "2026-08-01", "dag-datum genormaliseerd naar maandstart");
assert(st?.search_term === "kweekkas bedrijf", "zoekterm overgenomen");

// ── Impressieaandeel: fracties en maand-tot-nu-budgetbenutting ──────────────

const budget = new Map([["101", 19]]);
const isRij = naarImpressieAandeelRij({
  TimePeriod: "2026-08-01", CampaignId: "101", CampaignName: "C", CampaignType: "Search",
  Impressions: "1000", Clicks: "50", Spend: "190", Conversions: "5",
  ImpressionSharePercent: "46%", ImpressionLostToBudgetPercent: "26%", ImpressionLostToRankAggPercent: "8%",
}, "klant", budget, "2026-08-10");
approx(isRij?.impression_share, 0.46, "IS als fractie");
approx(isRij?.budget_lost_is, 0.26, "budgetverlies als fractie");
assert(isRij?.campaign_type === "search", "campagnetype kleingeschreven");
// Venster eindigt op de 10e: benutting over 10 dagen, niet over de volle maand.
approx(isRij?.budget_utilization, 1, "maand-tot-nu benutting: 190 / (19 × 10)");
assert(dagenInMaandTot("2026-08-01", "2026-09-15") === 31, "afgesloten maand telt vol");
assert(dagenInMaandTot("2026-08-01", "2026-07-15") === 0, "toekomstige maand telt nul dagen");

// ── Profielrij ──────────────────────────────────────────────────────────────

const prof = naarProfielRij({ TimePeriod: "2026-08-01", IndustryName: "Tuinbouw & Agri", Impressions: "5200", Clicks: "210", Spend: "200", Conversions: "18" }, "klant", "industry", "IndustryName");
assert(prof?.pivot_type === "industry" && prof?.pivot_value === "Tuinbouw & Agri", "profielpivot gemapt");

// ── Entiteiten ──────────────────────────────────────────────────────────────

const camp = naarCampagneRij({ Id: 101, Name: "C", CampaignType: "Search", Status: "Active", DailyBudget: 19, BiddingScheme: { Type: "EnhancedCpc" } }, "klant");
assert(camp?.campaign_id === "101" && camp?.campaign_type === "search" && camp?.daily_budget === 19, "campagnerij");
assert(naarCampagneRij({}, "klant") === null, "campagne zonder Id → geen rij");
const ag = naarAdGroupRij({ Id: 9, Name: "AG", Status: "Active" }, "101", "klant");
assert(ag?.adgroup_id === "9" && ag?.campaign_id === "101", "adgroup-rij");

// ── Report-request-vorm ─────────────────────────────────────────────────────

const req = bouwReportRequest({ type: "CampaignPerformanceReportRequest", aggregation: "Daily", columns: ["TimePeriod"], accountId: "123", since: "2026-08-01", until: "2026-08-14" });
assert(req.Format === "Csv" && req.ExcludeReportHeader === true && req.ExcludeColumnHeaders === false, "CSV met kolomkoppen, zonder rapportkop");
const tijd = req.Time as { CustomDateRangeStart: { Day: number; Month: number; Year: number } };
assert(tijd.CustomDateRangeStart.Day === 1 && tijd.CustomDateRangeStart.Month === 8 && tijd.CustomDateRangeStart.Year === 2026, "datumdelen");
assert(Array.isArray((req.Scope as { AccountIds: number[] }).AccountIds) && (req.Scope as { AccountIds: number[] }).AccountIds[0] === 123, "account-scope numeriek");

// ── De zip-uitpak: zelfgebouwde fixture met deflate én stored ───────────────

function bouwZip(inhoud: Buffer, methode: 0 | 8): Buffer {
  const data = methode === 8 ? deflateRawSync(inhoud) : inhoud;
  const naam = Buffer.from("report.csv");
  const lokaal = Buffer.alloc(30);
  lokaal.writeUInt32LE(0x04034b50, 0);
  lokaal.writeUInt16LE(methode, 8);
  lokaal.writeUInt32LE(data.length, 18);
  lokaal.writeUInt32LE(inhoud.length, 22);
  lokaal.writeUInt16LE(naam.length, 26);

  const centraalOffset = 30 + naam.length + data.length;
  const centraal = Buffer.alloc(46);
  centraal.writeUInt32LE(0x02014b50, 0);
  centraal.writeUInt16LE(methode, 10);
  centraal.writeUInt32LE(data.length, 20);
  centraal.writeUInt32LE(inhoud.length, 24);
  centraal.writeUInt16LE(naam.length, 28);
  centraal.writeUInt32LE(0, 42); // lokaal header-offset

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centraal.length + naam.length, 12);
  eocd.writeUInt32LE(centraalOffset, 16);

  return Buffer.concat([lokaal, naam, data, centraal, naam, eocd]);
}

const csvInhoud = Buffer.from("TimePeriod,Impressions\n2026-08-14,100\n");
assert(unzipEersteBestand(bouwZip(csvInhoud, 8)) === csvInhoud.toString("utf8"), "deflate-zip uitgepakt");
assert(unzipEersteBestand(bouwZip(csvInhoud, 0)) === csvInhoud.toString("utf8"), "stored-zip uitgepakt");
const metBom = Buffer.from("\uFEFFTimePeriod,Impressions\n");
assert(unzipEersteBestand(bouwZip(metBom, 8)).startsWith("TimePeriod"), "BOM gestript");
let gooide = false;
try { unzipEersteBestand(Buffer.from("geen zip")); } catch { gooide = true; }
assert(gooide, "onherkenbare buffer gooit in plaats van stil leeg");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
