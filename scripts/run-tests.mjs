// Testrunner: draait alle tsx-script-tests onder lib/ en aggregeert.
// Slaag-signaal is de exit-code (de tests roepen process.exit(1) bij falen).
// Gebruik: npm test
//
// TWEE DINGEN DIE HIER TIJD SCHELEN, EN WAAROM DAT UITMAAKT
//
// De suite duurde ruim zeven minuten, en dat was vrijwel volledig opstarttijd. Gemeten op deze
// machine, met 201 testbestanden:
//
//   npx tsx op een LEEG bestand   2264 ms
//   het tsx-binary rechtstreeks     409 ms
//   een echt testbestand            573 ms   <- het rekenwerk zelf is dus ~11 ms
//
// De npx-wrapper kostte 1855 ms per aanroep: bij 201 bestanden ruim zes minuten die nergens
// heen gaan. npx zoekt bij elke aanroep opnieuw uit waar het pakket staat; dat hoeft één keer.
//
// Dat is geen luxe-optimalisatie. Een poortenrun die acht minuten duurt houdt de sessie open,
// en elke afronding wekt de assistent met de volledige gespreksgeschiedenis erbij — daar zitten
// de kosten, niet in de rekentijd. Zie ook AGENTS.md.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cpus } from "node:os";

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(__.*_test|\.test)\.ts$/.test(e) && !/_demo\.ts$/.test(e)) out.push(p);
  }
  return out;
}

// Het tsx-binary één keer opzoeken in plaats van npx het 201 keer te laten doen. Eerst lokaal,
// dan de npx-cache; lukt geen van beide, dan valt hij terug op npx zodat de runner blijft
// werken op een machine waar tsx nog niet is opgehaald.
function vindTsx() {
  const lokaal = join("node_modules", ".bin", "tsx");
  if (existsSync(lokaal)) return { cmd: lokaal, args: [] };

  const cache = process.env.npm_config_cache ?? join(process.env.HOME ?? "/root", ".npm");
  const npxDir = join(cache, "_npx");
  const uitCache = () => {
    if (!existsSync(npxDir)) return null;
    for (const d of readdirSync(npxDir)) {
      const p = join(npxDir, d, "node_modules", ".bin", "tsx");
      if (existsSync(p)) return p;
    }
    return null;
  };

  const gevonden = uitCache();
  if (gevonden) return { cmd: gevonden, args: [] };

  // Terugval: één keer npx aanroepen vult de cache, daarna vindt uitCache hem wel.
  spawnSync("npx", ["tsx", "--version"], { stdio: "ignore", timeout: 120000 });
  const naOphalen = uitCache();
  return naOphalen ? { cmd: naOphalen, args: [] } : { cmd: "npx", args: ["tsx"] };
}

const tests = walk("lib").sort();
const { cmd, args } = vindTsx();
// Zoveel processen naast elkaar als er kernen zijn. Meer levert niets op: elk testproces is
// kortstondig rekengebonden, en de tests raken geen gedeelde bestanden of poorten.
const PARALLEL = Math.max(1, Math.min(cpus().length, 8));

console.log(`${tests.length} testbestanden gevonden (${PARALLEL} tegelijk)\n`);

const start = Date.now();
let passed = 0, failed = 0;
const failures = [];
const uitvoer = new Map(); // pad -> stderr, alleen bewaard voor gefaalde tests

function draai(pad) {
  return new Promise((klaar) => {
    const p = spawn(cmd, [...args, pad]);
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.stdout.on("data", () => {}); // afvoeren, anders loopt de pipe vol en blokkeert het kind
    const timer = setTimeout(() => p.kill("SIGKILL"), 120000);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) { passed += 1; process.stdout.write("."); }
      else { failed += 1; failures.push(pad); uitvoer.set(pad, err.slice(-1500)); process.stdout.write("F"); }
      klaar();
    });
    p.on("error", () => {
      clearTimeout(timer);
      failed += 1; failures.push(pad); uitvoer.set(pad, "kon het testproces niet starten");
      process.stdout.write("F");
      klaar();
    });
  });
}

// Een eenvoudige werkwachtrij: PARALLEL lopers die de lijst leegtrekken.
const wachtrij = [...tests];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (;;) {
      const pad = wachtrij.shift();
      if (!pad) return;
      await draai(pad);
    }
  }),
);

const seconden = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n\n${passed} geslaagd, ${failed} gefaald van ${tests.length} in ${seconden}s`);
if (failures.length) {
  console.log("\nGefaald:");
  // De uitvoer van een gefaalde test erbij: eerder moest je hem daarna handmatig opnieuw
  // draaien om te zien wat er misging.
  for (const f of failures.sort()) {
    console.log("  " + f);
    const e = uitvoer.get(f);
    if (e && e.trim()) console.log(e.trim().split("\n").map((r) => "      " + r).join("\n"));
  }
  process.exit(1);
}
console.log("Alle tests groen.");
