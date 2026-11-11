// Het venster van de verdeelring (components/dashboard/campaign-type-split.tsx). Geen IO.
// Draaien: tsx lib/__campagnetype_venster_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De ring leest maandrijen, en de `month`-kolom is een maandBEGIN (een DATE, "2026-08-01"). Het
// kanaaltabblad filterde op het maandbegin van 90 dagen terug, de tabbladen type en campagne op
// de kale datum van 90 dagen terug. Op 1 november is dat 3 augustus, en dan valt de rij van
// augustus ("2026-08-01" < "2026-08-03") eruit: het ene tabblad liet aug-nov zien, het andere
// sep-nov. Bij de demo, waarvan de data in augustus stopt, bleef er voor type niets over en
// verdween de kaart "Spend per campagnetype" helemaal van het Google-tabblad.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as ring from "../components/dashboard/campaign-type-split";
import { kanaalMaandRijen } from "./cross-channel/kanaal-maandrijen";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("vensterVanaf (campaign-type-split.tsx)");
const vensterVanaf = (ring as { vensterVanaf?: (vandaag: string) => string }).vensterVanaf;
check("vensterVanaf bestaat", typeof vensterVanaf === "function");
if (vensterVanaf) {
  check("1 november: vanaf 1 augustus, niet vanaf 3 augustus", vensterVanaf("2026-11-01") === "2026-08-01", vensterVanaf("2026-11-01"));
  check("altijd een maandbegin, ook over de jaargrens", vensterVanaf("2027-01-15") === "2026-10-01", vensterVanaf("2027-01-15"));

  // Wat de database met het filter doet: `month >= vanaf` op maandbegin-datums.
  const maandrijen = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"];
  const vanaf = vensterVanaf("2026-11-01");
  const gezien = maandrijen.filter((m) => m >= vanaf);
  check("de ring ziet augustus t/m november", gezien.join(",") === "2026-08-01,2026-09-01,2026-10-01,2026-11-01", gezien.join(","));
  const demo = ["2026-06-01", "2026-07-01", "2026-08-01"].filter((m) => m >= vanaf);
  check("de demo (data t/m augustus) houdt augustus in de ring", demo.join(",") === "2026-08-01", demo.join(","));
}

// ── Het kanaaltabblad: hetzelfde venster, op rijen die al binnen zijn ──────────────────────────
//
// Sinds fase 1, stap 6 leest het kanaaltabblad niet meer zelf blended_account_monthly maar krijgt
// het de maandrijen per kanaal uit de blended historie (kanaalMaandRijen over perKanaal). Het
// venster is dan geen databasefilter meer maar een filter in de browser, en dat werkt alleen als
// die rijen het maandBEGIN dragen: "2026-08" is als tekst kleiner dan "2026-08-01", en dan viel
// augustus er opnieuw uit -- dezelfde fout als hierboven, langs een andere weg.
console.log("Het kanaaltabblad (kanaalMaandRijen)");
if (vensterVanaf) {
  const perKanaal = [
    { kanaal: "google" as const, vanaf: null, maanden: [
      { month: "2026-07", conversions: 10, revenue: 100, adSpend: 50, impressions: 1000, clicks: 40 },
      { month: "2026-08", conversions: 12, revenue: 120, adSpend: 60, impressions: 1100, clicks: 44 },
    ] },
    { kanaal: "microsoft" as const, vanaf: "2026-08", maanden: [
      { month: "2026-08", conversions: 3, revenue: 0, adSpend: 20, impressions: 300, clicks: 9 },
    ] },
  ];
  const rijen = kanaalMaandRijen(perKanaal);
  check("elke rij draagt het maandbegin", rijen.every((r) => /^\d{4}-\d{2}-01$/.test(r.month)), rijen.map((r) => r.month).join(","));
  const vanaf = vensterVanaf("2026-11-01");
  const inVenster = rijen.filter((r) => r.month >= vanaf);
  check("op 1 november blijft augustus in de ring, juli niet",
    inVenster.map((r) => `${r.month}:${r.channel}`).join(",") === "2026-08-01:google_ads,2026-08-01:microsoft_ads",
    inVenster.map((r) => `${r.month}:${r.channel}`).join(","));
  check("Microsoft staat erbij, met zijn eigen tellers",
    inVenster.some((r) => r.channel === "microsoft_ads" && r.spend === 20 && r.conversions === 3 && r.clicks === 9 && r.impressions === 300));
}

// ── De bedrading: alle drie de tabbladen op hetzelfde maandbegin ───────────────────────────────
//
// Bewust aangepast in fase 1, stap 6. Hier stond "twee maandfilters": een databasefilter voor
// het kanaaltabblad (blended_account_monthly) en een voor type en campagne. Het kanaaltabblad
// leest niet meer zelf; wat overblijft is één databasefilter en één filter op de meegegeven rijen,
// en de eis is dezelfde gebleven: allebei op dezelfde vanaf-maand.
console.log("De bedrading");
{
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const bron = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "components/dashboard/campaign-type-split.tsx"), "utf8"));
  const filters = bron.match(/\{\s*op:\s*"gte",\s*column:\s*"month",\s*value:\s*([^}]+?)\s*\}/g) ?? [];
  check("één databasefilter op de maand (type en campagne)", filters.length === 1, String(filters.length));
  check("op de vanaf-maand", filters.every((f) => /value:\s*vanaf\s*\}/.test(f)), filters.join(" | "));
  const inBrowser = bron.match(/\.filter\(\(r\) => r\.month >= ([A-Za-z_]+)\)/g) ?? [];
  check("één filter op de kanaalrijen, op dezelfde vanaf-maand", inBrowser.length === 1 && /r\.month >= vanaf\)/.test(inBrowser[0]), inBrowser.join(" | "));
  const bepaald = bron.match(/const vanaf = [^;]+;/g) ?? [];
  check("vanaf wordt één keer bepaald, uit vensterVanaf(today())", bepaald.length === 1 && /const vanaf = vensterVanaf\(today\(\)\);/.test(bepaald[0]), bepaald.join(" | "));
  check("het kanaaltabblad leest niet meer zelf de view met de standaardselectie", !/blended_account_monthly/.test(bron));
  check("maar krijgt de rijen mee, of leest de gedeelde historie", /kanaalRijen/.test(bron) && /useBlendedClientData\(clientId, zelfLezen\)/.test(bron));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
