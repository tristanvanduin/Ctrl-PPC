// Bewaakt dat er precies één Meta API-versie in de codebase staat.
// Draaien: npx tsx lib/meta/__api_version_test.ts
//
// Aanleiding: lib/api/meta-ads.ts stond op v21.0 terwijl lib/meta/sync.ts al op v25.0 zat. Meta
// zette per 9 juni 2026 alles onder v24.0 uit, dus het koppelscherm praatte tegen een versie die
// niet meer bestond terwijl de sync in orde was. Twee constanten die uit de pas lopen merkt
// niemand op — tot een klant geen account meer kan koppelen.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { META_API_VERSION, META_GRAPH_BASE } from "./api-version";
import { fieldsFor } from "./sync";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("De constante zelf");
check("versie heeft de vorm vNN.N", /^v\d+\.\d+$/.test(META_API_VERSION), META_API_VERSION);
check("basis-URL is erop gebouwd", META_GRAPH_BASE === `https://graph.facebook.com/${META_API_VERSION}`);

// Meta zet oude Marketing API-versies hard uit; sinds 9 juni 2026 is v24.0 de oudste die werkt.
const major = Number(META_API_VERSION.slice(1).split(".")[0]);
check("versie is minstens v24 (de oudste die Meta nog ondersteunt)", major >= 24, META_API_VERSION);

console.log("\nGeen tweede versie elders in de codebase");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "scripts"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const files = [...walk("lib"), ...walk("app"), ...walk("components")];
const offenders: string[] = [];
for (const f of files) {
  if (f.endsWith("lib/meta/api-version.ts") || f.endsWith(__filename.split("/").pop()!)) continue;
  const src = readFileSync(f, "utf8");
  // Een hardgecodeerde graph-URL mét versie, of een eigen versieconstante.
  if (/graph\.facebook\.com\/v\d+\.\d+/.test(src)) offenders.push(`${f} (harde graph-URL)`);
  if (/(API_VERSION|META_API_VERSION)\s*=\s*["']v\d+\.\d+["']/.test(src)) offenders.push(`${f} (eigen versieconstante)`);
}
check("niemand pint zijn eigen Meta-versie", offenders.length === 0, offenders.join("; "));


console.log("\nBereik en frequentie bij uur-uitsplitsing");
// Meta geeft reach en frequency terug als 0 zodra er per uur wordt uitgesplitst, zonder fout.
// Die nul leest de verzadigingsdetector als "niemand bereikt" — het tegenovergestelde van wat er
// speelt. Niet opvragen levert null op, en dat is eerlijk.
check("normaal worden ze wel gevraagd", fieldsFor().includes("reach") && fieldsFor().includes("frequency"));
check("bij uur-uitsplitsing niet", (() => {
  const f = fieldsFor("hourly_stats_aggregated_by_advertiser_time_zone");
  return !f.split(",").includes("reach") && !f.split(",").includes("frequency");
})(), fieldsFor("hourly_stats_aggregated_by_advertiser_time_zone"));
check("andere uitsplitsingen raken ze niet", fieldsFor("publisher_platform").includes("reach"));
check("de rest van de velden blijft staan", fieldsFor("hourly_stats_aggregated_by_advertiser_time_zone").includes("impressions"));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
