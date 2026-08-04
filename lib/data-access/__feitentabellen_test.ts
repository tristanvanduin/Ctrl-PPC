// Bewaakt dat de acht feitentabellen maar op één plek bij naam worden genoemd als SCHRIJFdoel.
// Draaien: npx tsx lib/data-access/__feitentabellen_test.ts
//
// De inzet: fase 3 hernoemt die acht naar `<naam>_legacy` en zet views met de oude naam erover.
// Een view is niet schrijfbaar. Blijft er ergens een `.from("ads_campaign_monthly").upsert(...)`
// staan, dan krijgt de sync `cannot insert into view` — en dat merkt niemand meteen, want
// syncDataset vangt fouten per dataset af en gaat door met de volgende. De data loopt dan stil
// achter terwijl het dashboard gewoon getallen laat zien.
//
// Deze test leest de bronbestanden zelf. Dat is bewust: een test op de module zou alleen bevestigen
// dat de module doet wat hij zegt, en dat is niet waar het risico zit. Het risico is de negende
// plek die iemand er over drie maanden bij zet.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FEITENTABELLEN, schrijftabel, type Feitentabel } from "./feitentabellen";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De module zelf ─────────────────────────────────────────────────────────

check("acht tabellen", Object.keys(FEITENTABELLEN).length === 8, String(Object.keys(FEITENTABELLEN).length));
for (const naam of Object.keys(FEITENTABELLEN) as Feitentabel[]) {
  check(`${naam} levert een niet-lege naam`, schrijftabel(naam).length > 0);
}

// ── De bron doorzoeken ─────────────────────────────────────────────────────

const WORTELS = ["app", "components", "lib", "scripts"];
const OVERSLAAN = new Set(["node_modules", ".next", "migrations"]);

/**
 * Bestanden waar de oude naam als schrijfdoel MAG staan, met de reden erbij.
 *
 * Deze lijst hoort te krimpen, niet te groeien. Elke regel erbij is een plek die bij de hernoeming
 * met de hand moet mee.
 */
const TOEGESTAAN: Record<string, string> = {
  "lib/data-access/feitentabellen.ts": "de module zelf; hier staan de namen per definitie",
  "lib/data-access/__feitentabellen_test.ts": "deze test zelf; hij moet de namen kunnen noemen om ernaar te zoeken",
  "scripts/demo/seed-demo-client.ts": "vult de demoklant, draait niet in productie en niet via de sync",
  "scripts/demo/teardown-demo-client.ts": "ruimt de demoklant op, idem",
  "lib/demo/demo-rows.ts": "de rijen van de mock-Supabase; raakt de database niet",
};

function bestanden(map: string): string[] {
  const uit: string[] = [];
  let inhoud: string[];
  try { inhoud = readdirSync(map); } catch { return uit; }
  for (const naam of inhoud) {
    if (OVERSLAAN.has(naam)) continue;
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) uit.push(...bestanden(pad));
    else if (/\.tsx?$/.test(naam)) uit.push(pad);
  }
  return uit;
}

// Een SCHRIJFaanroep, niet zomaar de naam: `.from("x").upsert(` / `.insert(` / `.delete(` /
// `.update(`, en de drie batch-hulpjes die de sync gebruikt. Lezers noemen dezelfde naam en die
// horen hier juist NIET uit te komen -- die moeten na fase 3 op de view uitkomen.
const SCHRIJFVORMEN = (tabel: string) => [
  new RegExp(`from\\(\\s*["'\`]${tabel}["'\`]\\s*\\)\\s*\\.(upsert|insert|delete|update)\\b`),
  new RegExp(`(upsertBatch|replaceBatch|appendBatch)\\([^)]*["'\`]${tabel}["'\`]`),
];

/**
 * De gesanctioneerde vorm eerst weghalen, dan pas zoeken.
 *
 * Zonder dit vindt de test zichzelf: `upsertBatch(supabase, schrijftabel("ads_account_monthly"), …)`
 * bevat allebei de patronen, want tussen `upsertBatch(` en de tekst staat geen sluithaakje. De
 * eerste versie meldde daardoor precies de vier aanroepen die net waren omgezet — een controle die
 * rood blijft na de reparatie leert mensen om hem te negeren.
 */
function zonderModuleAanroepen(bron: string): string {
  return bron.replace(/schrijftabel\(\s*["'`][a-z_]+["'`]\s*\)/g, "SCHRIJFTABEL");
}

const gevonden: string[] = [];
for (const pad of WORTELS.flatMap(bestanden)) {
  const relatief = pad.replace(/\\/g, "/");
  if (relatief in TOEGESTAAN) continue;
  const bron = zonderModuleAanroepen(readFileSync(pad, "utf8"));
  for (const tabel of Object.keys(FEITENTABELLEN)) {
    for (const vorm of SCHRIJFVORMEN(tabel)) {
      if (vorm.test(bron)) gevonden.push(`${relatief} → ${tabel}`);
    }
  }
}

check(
  "geen schrijfaanroep op een letterlijke tabelnaam buiten de module",
  gevonden.length === 0,
  gevonden.join("; ")
);

// De uitzonderingslijst mag niet stilletjes groeien: elke regel heeft een reden, en een reden
// zonder tekst is over drie maanden niet van een vergissing te onderscheiden.
for (const [pad, reden] of Object.entries(TOEGESTAAN)) {
  check(`${pad} heeft een reden`, reden.trim().length > 10, reden);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
