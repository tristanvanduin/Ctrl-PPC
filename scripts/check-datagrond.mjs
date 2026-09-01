// Elke databasequery in de code tegen het echte schema leggen.
//
// Waarom dit bestaat: een Supabase-query met een verkeerde tabel- of kolomnaam is geen
// compilefout en geen testfout — hij is een runtime-404 of, erger, een stil lege uitkomst
// die als "geen data" gelezen wordt. De deep-dive-analyses zijn precies zo gebouwd: los,
// zonder live run, dus een kolom die nooit bestaan heeft valt pas op als een klant ernaar
// kijkt. Dit script leest alle `.from("...")`-ketens uit de bron en controleert elke
// selectie-, filter- en sorteerkolom tegen scripts/schema-snapshot.json — een vastgelegde
// foto van information_schema van de echte database.
//
// De snapshot verversen (vereist SUPABASE_ACCESS_TOKEN):
//   node scripts/check-datagrond.mjs --vernieuw
// Controleren (offline, seconden):
//   node scripts/check-datagrond.mjs
//
// Wat hij bewust NIET doet: query's waarvan de tabelnaam pas at runtime bekend is (een
// variabele, een template literal) hard afkeuren. Die staan in het rapport als
// "onherleidbaar" zodat ze zichtbaar blijven, maar ze laten de check niet falen — anders
// went iedereen aan een rode uitkomst en is de check dood.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WORTEL = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SNAPSHOT_PAD = join(WORTEL, "scripts", "schema-snapshot.json");

// ── Snapshot verversen ─────────────────────────────────────────────────────

if (process.argv.includes("--vernieuw")) {
  const { sql } = await import("./supabase-sql.mjs");
  const rows = await sql(`
    select table_name, json_agg(column_name order by ordinal_position) as kolommen
    from information_schema.columns
    where table_schema='public'
    group by table_name
  `);
  const snap = {};
  for (const r of rows.sort((a, b) => a.table_name.localeCompare(b.table_name))) {
    snap[r.table_name] = r.kolommen;
  }
  writeFileSync(SNAPSHOT_PAD, JSON.stringify(snap, null, 0));
  console.log(`Snapshot ververst: ${Object.keys(snap).length} tabellen/views.`);
  process.exit(0);
}

const SCHEMA = JSON.parse(readFileSync(SNAPSHOT_PAD, "utf8"));

// ── Bronbestanden verzamelen ───────────────────────────────────────────────

function loop(dir, uit = []) {
  for (const naam of readdirSync(dir)) {
    if (naam === "node_modules" || naam === ".next" || naam.startsWith(".")) continue;
    const pad = join(dir, naam);
    const st = statSync(pad);
    if (st.isDirectory()) loop(pad, uit);
    else if (/\.(ts|tsx|mjs)$/.test(naam) && !/__.*_test\.|\.test\./.test(naam)) uit.push(pad);
  }
  return uit;
}

const bestanden = [...loop(join(WORTEL, "app")), ...loop(join(WORTEL, "lib"))];

// ── De ketens lezen ────────────────────────────────────────────────────────
//
// Een keten begint bij .from("tabel") en loopt door tot het einde van het statement. We
// pakken een ruime snede en lezen daaruit de kolomdragende aanroepen. Dat is bewust een
// tekstuele lezing, geen AST: de query-bouwstijl in deze codebase is kettingvormig genoeg
// dat dit klopt, en de uitzonderingen komen in "onherleidbaar" terecht.

const KOLOM_METHODEN = /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|textSearch|order|not)\(\s*["']([^"']+)["']/g;

function topniveauDelen(s) {
  // Splitst een selectstring op komma's, maar niet binnen haakjes: "a, rel(b, c), d".
  const delen = [];
  let diepte = 0, huidig = "";
  for (const ch of s) {
    if (ch === "(") diepte += 1;
    if (ch === ")") diepte -= 1;
    if (ch === "," && diepte === 0) { delen.push(huidig); huidig = ""; }
    else huidig += ch;
  }
  if (huidig.trim()) delen.push(huidig);
  return delen.map((d) => d.trim()).filter(Boolean);
}

function controleerSelect(tabel, selectie, meld) {
  for (const deelRuw of topniveauDelen(selectie)) {
    let deel = deelRuw.replace(/\s+/g, "");
    if (deel === "*" || deel === "") continue;
    // alias:kolom of alias:relatie(...) — de alias is vrij, het deel erna telt.
    const dubbelepunt = deel.indexOf(":");
    if (dubbelepunt > 0 && !deel.slice(0, dubbelepunt).includes("(")) deel = deel.slice(dubbelepunt + 1);
    const haakje = deel.indexOf("(");
    if (haakje > 0) {
      // relatie(kolommen) — ook met !inner of !fk_naam er tussenin.
      const relatie = deel.slice(0, haakje).split("!")[0];
      const binnen = deel.slice(haakje + 1, deel.lastIndexOf(")"));
      if (!SCHEMA[relatie]) meld(`relatie "${relatie}" bestaat niet (in select op ${tabel})`);
      else controleerSelect(relatie, binnen, meld);
      continue;
    }
    const kolom = deel.split("::")[0].split("->")[0]; // cast en json-pad afknippen
    if (!/^[a-z_][a-z0-9_]*$/i.test(kolom)) continue; // expressies laten we voor het oog
    if (!SCHEMA[tabel].includes(kolom)) meld(`kolom "${kolom}" bestaat niet in ${tabel}`);
  }
}

const fouten = [];   // { bestand, regel, melding }
const onherleidbaar = []; // { bestand, regel, reden }

for (const pad of bestanden) {
  const bron = readFileSync(pad, "utf8");
  const rel = relative(WORTEL, pad);
  const vanRe = /\.from\(([^)]*)\)/g;
  let m;
  while ((m = vanRe.exec(bron)) !== null) {
    const regel = bron.slice(0, m.index).split("\n").length;
    const arg = m[1].trim();
    // Array.from, Buffer.from en soortgenoten zijn geen query's.
    const ervoor = bron.slice(Math.max(0, m.index - 24), m.index);
    if (/(Array|Buffer|Uint8Array|Int8Array|Int32Array|Float64Array)$/.test(ervoor)) continue;
    const str = /^["'`]([^"'`$]+)["'`]$/.exec(arg);
    if (!str) {
      // .from(variabele) of template met interpolatie: niet te herleiden zonder runtime.
      if (arg) onherleidbaar.push({ bestand: rel, regel, reden: `.from(${arg.slice(0, 40)})` });
      continue;
    }
    const tabel = str[1];
    // Storage-buckets en andere niet-tabel-froms overslaan: die staan niet in het schema
    // en horen er ook niet in.
    if (bron.slice(Math.max(0, m.index - 60), m.index).includes(".storage")) continue;
    if (!SCHEMA[tabel]) {
      fouten.push({ bestand: rel, regel, melding: `tabel "${tabel}" bestaat niet` });
      continue;
    }
    // De keten: vanaf hier tot het einde van het statement — of tot de vólgende .from(),
    // want in een Promise.all staan meerdere query's in één statement en anders worden de
    // kolommen van query twee aan de tabel van query één toegeschreven.
    const snede = bron.slice(m.index, m.index + 2400);
    const grenzen = [snede.search(/;\n|\n\n/), snede.indexOf(".from(", 6)].filter((i) => i > 0);
    const keten = grenzen.length ? snede.slice(0, Math.min(...grenzen) + 1) : snede;

    const selectRe = /\.select\(\s*(["'`])([\s\S]*?)\1/g;
    let s;
    while ((s = selectRe.exec(keten)) !== null) {
      if (s[2].includes("${")) { onherleidbaar.push({ bestand: rel, regel, reden: `select met interpolatie op ${tabel}` }); continue; }
      controleerSelect(tabel, s[2], (melding) => fouten.push({ bestand: rel, regel, melding }));
    }
    let k;
    KOLOM_METHODEN.lastIndex = 0;
    while ((k = KOLOM_METHODEN.exec(keten)) !== null) {
      const kolom = k[2].split(".")[0].split("->")[0];
      // .order("kolom", ...) op een relatie ("rel.kolom") slaan we over: de relatie is
      // hierboven al gecontroleerd en de kolom hoort bij die relatie.
      if (k[2].includes(".")) continue;
      if (!/^[a-z_][a-z0-9_]*$/i.test(kolom)) continue;
      if (!SCHEMA[tabel].includes(kolom)) {
        fouten.push({ bestand: rel, regel, melding: `${k[1]}("${kolom}") — kolom bestaat niet in ${tabel}` });
      }
    }
  }
}

// ── Rapport ────────────────────────────────────────────────────────────────

if (fouten.length) {
  console.error(`\n${fouten.length} kolom/tabel-fouten:\n`);
  for (const f of fouten) console.error(`  ${f.bestand}:${f.regel}  ${f.melding}`);
}
if (process.argv.includes("--alles") && onherleidbaar.length) {
  console.log(`\n${onherleidbaar.length} onherleidbaar (ter info, geen fout):`);
  for (const o of onherleidbaar) console.log(`  ${o.bestand}:${o.regel}  ${o.reden}`);
}
console.log(`\n${bestanden.length} bestanden gelezen; ${fouten.length} fouten, ${onherleidbaar.length} onherleidbare froms.`);
if (fouten.length) process.exit(1);
