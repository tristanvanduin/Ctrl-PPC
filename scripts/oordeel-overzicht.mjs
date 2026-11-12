// Legt een meting van het Overzicht naast de normen van het bouwplan en meldt per norm: gehaald,
// niet gehaald of niet gemeten. Hoort bij fase 6 (proef en uitrol).
//
// Gebruik:
//   node scripts/oordeel-overzicht.mjs                         de nieuwste meting in scripts/metingen
//   node scripts/oordeel-overzicht.mjs scripts/metingen/2026-11-12-4-5-nieuw.json
//   node scripts/oordeel-overzicht.mjs oud.json nieuw.json     twee metingen naast elkaar
//
// Geen server en geen browser: dit leest alleen het JSON-bestand dat scripts/meet-overzicht.mjs
// schreef. De normen zelf, en waarom er drie uitkomsten zijn en geen twee, staan in
// scripts/overzicht-normen.mjs.
//
// Afsluitcode: 0 als elke gemeten norm gehaald is, 1 als er minstens één niet gehaald is of de
// meting op een norm mislukte (een wissel of herlaad die fout ging), 2 als de zelftest faalt of een
// bestand niet te lezen is. "Niet gemeten" maakt de code niet 1, maar staat wel in de uitvoer en in
// de telling.
//
// DE ZELFTEST HOORT ERBIJ. Vóór het oordeel zet dit script per norm een waarde op de grens en een
// één stap erover in een verzonnen goede meting, en eist dat precies die norm omslaat. Slaat er
// een niet om, of slaat een andere mee om, dan zegt "gehaald" hieronder niets, en stopt het script
// met code 2 zonder een oordeel te geven.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beoordeel, oordeelTekst, zelftest } from "./overzicht-normen.mjs";

const proef = zelftest();
if (!proef.ok) {
  console.error("ZELFTEST GEFAALD: een norm slaat niet om op zijn grens, of leest de plek van een andere.");
  for (const f of proef.fouten) console.error(`  ${f}`);
  console.error("Er wordt geen oordeel gegeven: het zou niets zeggen.");
  process.exit(2);
}

const MAP = "scripts/metingen";
function nieuwste() {
  const bestanden = readdirSync(MAP).filter((f) => f.endsWith(".json")).map((f) => join(MAP, f));
  if (bestanden.length === 0) return null;
  return bestanden.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || b.localeCompare(a))[0];
}

const paden = process.argv.slice(2);
if (paden.length === 0) {
  const pad = nieuwste();
  if (!pad) { console.error(`Geen meting gevonden in ${MAP}. Draai eerst scripts/meet-overzicht.mjs.`); process.exit(2); }
  paden.push(pad);
}

let afgekeurd = 0;
const oordelen = [];
for (const pad of paden) {
  let meting;
  try { meting = JSON.parse(readFileSync(pad, "utf8")); } catch (e) {
    console.error(`${pad} is niet te lezen: ${e.message}`);
    process.exit(2);
  }
  const oordeel = beoordeel(meting);
  oordelen.push({ pad, oordeel });
  afgekeurd += oordeel.nietGehaald + oordeel.mislukt;
  console.log(`\n## ${pad}${meting.fase ? ` (fase ${meting.fase})` : ""}${meting.url ? `\n${meting.url}` : ""}\n`);
  console.log(oordeelTekst(oordeel));
}

// Twee metingen: wat veranderde er van uitkomst? Dat is de vraag van een proef "voor en na".
if (oordelen.length === 2) {
  const [voor, na] = oordelen.map((o) => new Map(o.oordeel.regels.map((r) => [r.id, r])));
  const verschil = [...na.values()].filter((r) => voor.get(r.id)?.uitkomst !== r.uitkomst);
  console.log(`\n## Verschil tussen de twee metingen\n`);
  if (verschil.length === 0) console.log("Geen norm veranderde van uitkomst.");
  for (const r of verschil) console.log(`${r.id.padEnd(3)} ${voor.get(r.id)?.uitkomst ?? "onbekend"} -> ${r.uitkomst}  ${r.norm}: ${voor.get(r.id)?.getoond ?? "—"} -> ${r.getoond}`);
}

console.log(`\nzelftest: ${proef.normen} normen slaan om op hun grens (gehaald op de grens, niet gehaald één stap erover), elk alleen op de eigen plek in de meting.`);
process.exit(afgekeurd > 0 ? 1 : 0);
