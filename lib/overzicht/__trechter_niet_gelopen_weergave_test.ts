// De bedrading van F3 (een kanaal dat in de periode nog niet liep): de zuivere functies staan getoetst
// in lib/period/__google_terugval_test.ts, maar de regel moet ook op het scherm komen.
//
// 1. KanaalTrechter (components/dashboard/overzicht-trechter.tsx) wordt echt gerenderd
//    (react-dom/server): met `nietGelopen` staat de regel er (data-trechter-niet-gelopen) en geen
//    balken, geen tabel en geen "kosten per 1.000 vertoningen".
// 2. overzicht-bovenkant.tsx geeft `nietGelopen` door in BEIDE wegen (per dag en over hele maanden), en
//    geeft de klikken van Google per maand door aan telKanaalStappen (Na de klik). Een bronscan: de
//    component heeft een provider-boom nodig die hier niet te bouwen is.
//
// Draaien: tsx --tsconfig ./tsconfig.json lib/overzicht/__trechter_niet_gelopen_weergave_test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KanaalTrechter } from "../../components/dashboard/overzicht-trechter";
import { trechter } from "./trechter";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const venster = { over: "21 nov t/m 1 dec 2025", tegen: null };
const nul = { conversions: 0, revenue: 0, adSpend: 0 };
const regel = "Meta liep in deze periode nog niet; eerste dag met data: 7 jun 2026.";

console.log("KanaalTrechter met een kanaal dat nog niet liep");
{
  const html = renderToStaticMarkup(createElement(KanaalTrechter, {
    kanaal: "meta", trechter: trechter({ totalen: nul, tellers: { impressions: 0, clicks: 0 }, nietGelopen: regel }, null), uitleg: null, venster,
  }));
  check("de regel staat er", html.includes("data-trechter-niet-gelopen") && html.includes(regel), html.slice(0, 300));
  check("geen balken en geen tabel met nullen", !html.includes("<table") && !html.includes("Vertoningen") && !html.includes("1.000"), html);
}

console.log("KanaalTrechter met een kanaal dat liep met nul");
{
  const html = renderToStaticMarkup(createElement(KanaalTrechter, {
    kanaal: "meta", trechter: trechter({ totalen: nul, tellers: { impressions: 0, clicks: 0 }, nietGelopen: null }, null), uitleg: null, venster,
  }));
  check("de stappen staan er, met de nullen", !html.includes("data-trechter-niet-gelopen") && html.includes("<table") && html.includes("Vertoningen"));
}

console.log("overzicht-bovenkant geeft nietGelopen door in beide wegen");
{
  const bron = readFileSync(join(__dirname, "../../components/dashboard/overzicht-bovenkant.tsx"), "utf8");
  check("per dag: nogNietGelopen op de telling van het kanaal", /nietGelopen:\s*nogNietGelopen\(t\)/.test(bron));
  check("over hele maanden: nietGelopenInMaanden op de bron van de band",
    /nietGelopen:\s*nietGelopenInMaanden\(trechterKanaal,\s*bron,\s*periode\.range\)/.test(bron));
  check("Na de klik krijgt de klikken van Google per maand, aan beide kanten",
    (bron.match(/telKanaalStappen\([^)]*googleKlikken\([pv]\),\s*perMaand\)/g) ?? []).length === 2);
  check("de uitkomst gaat naar KanaalTrechter", /<KanaalTrechter[^>]*trechter=\{trechterUitkomst\}/.test(bron));
}

console.log("De periodekiezer krijgt de eerste weekrij en de maandreeks (herstel 1)");
{
  const kiezer = readFileSync(join(__dirname, "../../components/dashboard/periode-kiezer.tsx"), "utf8");
  const dashboard = readFileSync(join(__dirname, "../../components/dashboard/client-dashboard.tsx"), "utf8");
  check("googleWeekNoot krijgt de weekbron mee", /googleWeekNoot\([^;]*eersteWeek:\s*googleWeekStart\.eersteWeek,\s*heeftMaanden/.test(kiezer));
  check("het dashboard geeft de maandreeks van Google aan de kiezer", /<PeriodeKiezer[^>]*googleData=\{googleData\}/.test(dashboard));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
