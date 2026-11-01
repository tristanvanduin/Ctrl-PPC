// De totalen van het portfolio-scorebord (components/portfolio/portfolio-scoreboard.tsx). Geen IO.
// Draaien: tsx lib/__portfolio_totalen_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// In demomodus staat de demo-cel op het venster van zijn eigen datastand (data t/m 26 augustus,
// dus aug 2025 - jul 2026), en de echte klanten op de kalender (nov 2025 - okt 2026). Elke rij
// zegt dat goed: de demo heeft een regel "cijfers over ...". Maar de totaalrij "Alle klanten met
// spend" en de hero telden beide vensters bij elkaar op, onder een kop "Cijfers over nov 2025 -
// okt 2026" die maar voor één ervan klopt, en telden de demo mee in "groeiend" en "vragen aandacht".

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as bord from "../components/portfolio/portfolio-scoreboard";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = {
  customerId: string;
  ytd?: { conversions: number; revenue: number; adSpend: number; roas: number; cpa: number };
  yoy?: { convChange: number | null; revChange: number | null; spendChange: number | null };
  periodeNoot?: string;
};
type Totalen = {
  rijen: Rij[]; conversions: number; revenue: number; adSpend: number; roas: number;
  groeiend: number; aandacht: number; noot?: string; buitenTotaal: number;
};
const rij = (customerId: string, conversions: number, revenue: number, adSpend: number, convChange: number | null, periodeNoot?: string): Rij => ({
  customerId,
  ytd: { conversions, revenue, adSpend, roas: adSpend > 0 ? revenue / adSpend : 0, cpa: conversions > 0 ? adSpend / conversions : 0 },
  yoy: { convChange, revChange: null, spendChange: null },
  periodeNoot,
});
const NOOT = "Data t/m 26 aug 2026; cijfers over aug 2025 – jul 2026";

console.log("portfolioTotalen (portfolio-scoreboard.tsx)");
const portfolioTotalen = (bord as { portfolioTotalen?: (o: Rij[]) => Totalen }).portfolioTotalen;
check("portfolioTotalen bestaat", typeof portfolioTotalen === "function");
if (portfolioTotalen) {
  // Demomodus met echte klanten zichtbaar: de demo heeft een ander venster.
  const demo = rij("demo-greentech", 1000, 90000, 30000, -7, NOOT);
  const a = rij("111", 200, 20000, 5000, 15);
  const b = rij("222", 50, 4000, 2000, -20);
  const leeg = rij("333", 0, 0, 0, null);
  const t = portfolioTotalen([demo, a, b, leeg]);
  check("de som gaat alleen over het venster van de kop: 250 conversies, niet 1.250", t.conversions === 250, String(t.conversions));
  check("omzet en spend idem (24.000 / 7.000)", t.revenue === 24000 && t.adSpend === 7000, `${t.revenue} / ${t.adSpend}`);
  check("de ROAS uit die sommen", Math.abs(t.roas - 24000 / 7000) < 1e-9, String(t.roas));
  check("twee klanten met spend in de som, de demo erbuiten", t.rijen.length === 2 && t.buitenTotaal === 1, `${t.rijen.length} / ${t.buitenTotaal}`);
  check("groeiend en aandacht zonder de demo", t.groeiend === 1 && t.aandacht === 1, `${t.groeiend} / ${t.aandacht}`);
  check("geen noot: de som gaat over het venster van de kop", t.noot === undefined, String(t.noot));

  // Alleen de demo zichtbaar: dan is er niets anders om op te tellen, en zegt het totaal welk venster.
  const alleen = portfolioTotalen([demo, leeg]);
  check("alleen de demo: zijn eigen cijfers", alleen.conversions === 1000 && alleen.rijen.length === 1 && alleen.buitenTotaal === 0,
    JSON.stringify({ c: alleen.conversions, n: alleen.rijen.length }));
  check("alleen de demo: het totaal draagt zijn periodenoot", alleen.noot === NOOT, String(alleen.noot));

  // Zonder demo: niets verandert.
  const gewoon = portfolioTotalen([a, b, leeg]);
  check("zonder demo: de gewone som", gewoon.conversions === 250 && gewoon.rijen.length === 2 && gewoon.buitenTotaal === 0 && gewoon.noot === undefined);
}

// ── De bedrading: hero en totaalrij lezen deze totalen ─────────────────────────────────────────
console.log("De bedrading");
{
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const bron = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "components/portfolio/portfolio-scoreboard.tsx"), "utf8"));
  check("het bord rekent zijn totalen met portfolioTotalen", /portfolioTotalen\(Array\.from\(overviews\.values\(\)\)\)/.test(bron));
  check("geen eigen som over alle overviews meer", !/allOverviews\.reduce/.test(bron));
  check("de totaalrij noemt wat er buiten de som valt", /buitenTotaal/.test(bron) && /totalen\.noot/.test(bron));
  check("het antwoord van de overview gaat door overviewAccounts", /\.then\(overviewAccounts\)/.test(bron));
}

// ── Een falende overview: de vorige cijfers blijven staan ──────────────────────────────────────
// Asynchroon (het antwoord is een Promise), en dit bestand kent geen top-level await.
const overviewFout = (async () => {
  console.log("Een HTTP-fout van de overview");
  // De overview geeft sinds de conversieselectie een 500 als client_settings niet te lezen is. Het
  // bord deed r.json() zonder naar de status te kijken: { error } werd [] en niet null, en dan
  // verdwenen de cijfers van alle echte klanten (een streepje), terwijl het commentaar ernaast
  // belooft dat ze bij een falende overview blijven staan.
  const lees = (bord as { overviewAccounts?: (r: { ok: boolean; status: number; json: () => Promise<unknown> }) => Promise<unknown> }).overviewAccounts;
  check("portfolio-scoreboard.tsx exporteert overviewAccounts", typeof lees === "function");
  if (typeof lees === "function") {
    const antwoord = (ok: boolean, body: unknown) => ({ ok, status: ok ? 200 : 500, json: async () => body });
    check("500 met een foutmelding: null (de vorige cijfers blijven)", (await lees(antwoord(false, { error: "client_settings onleesbaar" }))) === null);
    const accounts = [{ customerId: "1" }];
    check("200 met accounts: de accounts", (await lees(antwoord(true, { accounts }))) === accounts);
    check("200 zonder accounts: een lege lijst, zoals voorheen", JSON.stringify(await lees(antwoord(true, {}))) === "[]");
    check("onleesbaar antwoord: null", (await lees({ ok: true, status: 200, json: async () => { throw new Error("geen json"); } })) === null);
  }
})();

overviewFout.then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
});
