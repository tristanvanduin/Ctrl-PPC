// De cronplanning: stalest-first, tijdbudget, werkpool.
// Draaien: npx tsx lib/sync/__cron_planning_test.ts

import { sorteerOpStaleness, verdeelTijdbudget, draaiMetPool, GOOGLE_GELIJKTIJDIG } from "./cron-planning";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const slaap = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("sorteerOpStaleness");
  {
    const klanten = [{ clientId: "c" }, { clientId: "a" }, { clientId: "b" }, { clientId: "d" }];
    const sync = new Map<string, string | null>([["a", "2026-04-17T15:00:00Z"], ["b", null], ["c", "2026-04-16T10:00:00Z"]]);
    const uit = sorteerOpStaleness(klanten, sync).map((k) => k.clientId);
    check("nooit gesynct eerst (b, d op naam), dan oudste sync (c), dan a", uit.join(",") === "b,d,c,a", uit.join(","));
    check("invoer niet gemuteerd", klanten[0].clientId === "c");
    const stabiel = sorteerOpStaleness([{ clientId: "y" }, { clientId: "x" }], new Map([["x", "2026-01-01"], ["y", "2026-01-01"]])).map((k) => k.clientId);
    check("gelijke stand: op clientId", stabiel.join(",") === "x,y");
  }

  console.log("verdeelTijdbudget");
  {
    const zonder = verdeelTijdbudget({ maxDurationMs: 600_000, kanaalParen: 0 });
    check("zonder kanaalparen: Google tot de eindmarge", zonder.googleStopMs === 510_000 && zonder.kanaalStopMs === 510_000, JSON.stringify(zonder));
    const met = verdeelTijdbudget({ maxDurationMs: 600_000, kanaalParen: 4 });
    check("met kanaalparen: Google 55%, kanalen tot de eindmarge", met.googleStopMs === 330_000 && met.kanaalStopMs === 510_000, JSON.stringify(met));
    check("Google stopt vóór de kanalen, en beide vóór maxDuration", met.googleStopMs < met.kanaalStopMs && met.kanaalStopMs < 600_000);
  }

  console.log("draaiMetPool");
  {
    let bezig = 0, piek = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];
    const { uitkomsten, doorgeschoven } = await draaiMetPool(items, 3, () => true, async (n) => {
      bezig++; piek = Math.max(piek, bezig);
      await slaap(5 + (n % 3) * 3);
      bezig--;
      return n * 10;
    });
    check("alles gedraaid, uitkomsten op de index van hun item", uitkomsten.join(",") === "10,20,30,40,50,60,70" && doorgeschoven.length === 0, uitkomsten.join(","));
    check(`hooguit ${GOOGLE_GELIJKTIJDIG} tegelijk, en echt parallel`, piek === 3, String(piek));

    let gestart = 0;
    const budget = await draaiMetPool(items, 2, () => gestart < 3, async (n) => { gestart++; await slaap(2); return n; });
    check("budget op na drie starts: de rest doorgeschoven, in volgorde", budget.uitkomsten.length === 3 && budget.doorgeschoven.join(",") === "4,5,6,7", JSON.stringify(budget));

    const leeg = await draaiMetPool([] as number[], 3, () => true, async (n) => n);
    check("lege lijst: niets gedraaid, niets doorgeschoven", leeg.uitkomsten.length === 0 && leeg.doorgeschoven.length === 0);

    const nooit = await draaiMetPool(items, 3, () => false, async (n) => n);
    check("budget al op: alles doorgeschoven", nooit.uitkomsten.length === 0 && nooit.doorgeschoven.length === 7);

    const volgorde: number[] = [];
    await draaiMetPool([1, 2, 3, 4], 1, () => true, async (n) => { volgorde.push(n); return n; });
    check("gelijktijdig 1 is strikt sequentieel in volgorde", volgorde.join(",") === "1,2,3,4");
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
