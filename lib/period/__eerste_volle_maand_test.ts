// Test voor de eerste VOLLE maand van een kanaal (stap 0, review [0] en [35]).
// Draaien: tsx lib/period/__eerste_volle_maand_test.ts
//
// Wat er misging. gepaardeTotalen nam als start van een bron de eerste maand met een rij. Microsoft
// heeft bij de demo rijen vanaf 23 juli 2025: juli 2025 is negen dagen gemeten, en die maand werd
// tegen een volle juli 2026 gezet. Het dagtempo was vlak (297 / 9 = 33 per dag, 1.023 / 31 = 33 per
// dag), maar de Microsoft-tab toonde "Advertentiekosten +244,4%" over de laatste twaalf maanden.
// Hetzelfde voor Meta en LinkedIn (rijen vanaf 13 maart 2026) zodra die een jaar lopen.
//
// De regel nu: een dagkanaal waarvan de eerste rij niet op de 1e valt, paart pas vanaf de maand
// erna. De partiële eerste maand blijft in de totalen staan; hij telt alleen niet als paar.

import {
  comparePeriods, gepaardeTotalen, alsBronReeks, type BronReeks, type Totalen,
} from "./apply-period";
import * as km from "./kanaal-maanden";
import { DEFAULT_CHANNEL_CONVERSION_CONFIG } from "../analysis/channel-conversion-config";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Op de oude code bestaat eersteVolleMaand niet; dan per geval falen in plaats van op de import.
const { eersteVolleMaand } = km as unknown as { eersteVolleMaand?: (dag: string | null | undefined) => string | null };

console.log("eersteVolleMaand");
if (typeof eersteVolleMaand !== "function") {
  check("eersteVolleMaand bestaat", false);
} else {
  check("eerste rij op de 23e: de maand erna", eersteVolleMaand("2025-07-23") === "2025-08", String(eersteVolleMaand("2025-07-23")));
  check("eerste rij op de 1e: die maand zelf", eersteVolleMaand("2025-07-01") === "2025-07", String(eersteVolleMaand("2025-07-01")));
  check("over de jaargrens", eersteVolleMaand("2025-12-15") === "2026-01", String(eersteVolleMaand("2025-12-15")));
  check("geen rij: null", eersteVolleMaand(null) === null && eersteVolleMaand(undefined) === null && eersteVolleMaand("") === null);
  check("geen datum: null", eersteVolleMaand("2025-07") === null && eersteVolleMaand("onzin") === null);
}

// ── De kale regel in gepaardeTotalen ─────────────────────────────────────────────────────────
console.log("gepaardeTotalen met vanaf");
const t = (adSpend: number, conversions = 0): Totalen => ({ conversions, revenue: 0, adSpend });
// De demovorm van Microsoft: negen dagen juli 2025, daarna volle maanden van 33 per dag.
const ms: BronReeks & { vanaf?: string } = {
  naam: "microsoft",
  vanaf: "2025-08",
  maanden: new Map([
    ["2025-07", t(297, 23.49)],
    ["2025-08", t(1023, 81)],
    ["2026-07", t(1023, 72.975)],
    ["2026-08", t(1023, 80)],
  ]),
};
{
  const r = gepaardeTotalen([ms], { start: "2026-07", end: "2026-07" }, { start: "2025-07", end: "2025-07" });
  const b = r.perBron[0] as typeof r.perBron[0] & { vanaf?: string | null };
  // Oud: 1.023 tegen 297, +244%.
  check("juli 2026 tegen de partiële juli 2025: geen paar", b.gepaard === 0 && r.huidig.adSpend === 0 && r.vorig.adSpend === 0, JSON.stringify(r));
  check("beide maanden tellen als ongepaard", b.ongepaardHuidig === 1 && b.ongepaardVorig === 1, JSON.stringify(b));
  check("start blijft de eerste maand met data, vanaf is de eerste volle", b.start === "2025-07" && b.vanaf === "2025-08", JSON.stringify(b));
}
{
  const r = gepaardeTotalen([ms], { start: "2026-07", end: "2026-08" }, { start: "2025-07", end: "2025-08" });
  check("augustus tegen augustus telt wel: 1.023 tegen 1.023", r.huidig.adSpend === 1023 && r.vorig.adSpend === 1023 && r.perBron[0].gepaard === 1, JSON.stringify(r));
}
{
  // Een vanaf vóór de eerste data verandert niets: de start is dan gewoon de eerste maand met data.
  const vroeg = { ...ms, vanaf: "2024-01" };
  const r = gepaardeTotalen([vroeg], { start: "2026-07", end: "2026-07" }, { start: "2025-07", end: "2025-07" });
  const b = r.perBron[0] as typeof r.perBron[0] & { vanaf?: string | null };
  check("vanaf vóór de data: de eerste maand met data telt", b.gepaard === 1 && b.vanaf === "2025-07", JSON.stringify(b));
  // Zonder vanaf: precies het oude gedrag (de Google-maandbron kent geen dagen).
  const zonder: BronReeks = { naam: "google", maanden: ms.maanden };
  const z = gepaardeTotalen([zonder], { start: "2026-07", end: "2026-07" }, { start: "2025-07", end: "2025-07" });
  check("zonder vanaf: start = eerste maand met data, zoals voorheen", z.perBron[0].gepaard === 1 && z.vorig.adSpend === 297, JSON.stringify(z));
}
{
  // geladenVanaf gaat door naar het paar, zodat de band "niet geladen" kan zeggen in plaats van
  // "de data begint in".
  const geladen = { ...ms, geladenVanaf: "2025-07" };
  const r = gepaardeTotalen([geladen], { start: "2026-07", end: "2026-07" }, { start: "2025-07", end: "2025-07" });
  const b = r.perBron[0] as typeof r.perBron[0] & { geladenVanaf?: string | null };
  check("geladenVanaf komt in het paar", b.geladenVanaf === "2025-07", JSON.stringify(b));
}

// ── Van dagrijen naar de band: de Microsoft-tab ─────────────────────────────────────────────
console.log("Van dagrijen: de Microsoft-tab, laatste twaalf maanden tegen vorig jaar");
const dagen = (maand: string, van: number, tot: number) =>
  Array.from({ length: tot - van + 1 }, (_, i) => ({
    date: `${maand}-${String(van + i).padStart(2, "0")}`,
    impressions: 100, clicks: 10, spend: 33, conversions: 2.61, conversion_value: 50,
  }));
const maanden12 = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const rijen = [
  ...dagen("2025-07", 23, 31),
  ...maanden12.flatMap((m) => dagen(m, 1, 28)),
  ...dagen("2026-07", 1, 31),
];
const stand = km.kanaalStandUitDagen("demo", rijen, "microsoft", DEFAULT_CHANNEL_CONVERSION_CONFIG, 2026) as km.KanaalStand & { vanaf?: string | null };
check("de stand draagt de eerste volle maand", stand.vanaf === "2025-08", String(stand.vanaf));
{
  // Zo bouwt de hook de bron voor een kanaaltab: één reeks, met vanaf erbij.
  const bron: BronReeks & { vanaf?: string | null } = { ...alsBronReeks("totaal", stand.data), vanaf: stand.vanaf };
  const r = comparePeriods(stand.data, { start: "2025-08", end: "2026-07" }, { start: "2024-08", end: "2025-07" }, [bron]);
  // Oud: alleen juli tegen juli telde, 1.023 tegen 297 = +244,4%.
  check("geen percentage: er is geen vol maandpaar", r.deltas?.adSpend.pct === null && r.deltas?.conversions.pct === null,
    JSON.stringify(r.deltas));
  check("en de partiële juli 2025 staat wel in het totaal van de vergelijkingsperiode", r.previous?.totals.adSpend === 297,
    String(r.previous?.totals.adSpend));
  const huidig = comparePeriods(stand.data, { start: "2025-07", end: "2026-07" }, null, [bron]);
  check("en in de gekozen periode (juli 2025 t/m juli 2026) telt hij gewoon mee", huidig.current.totals.adSpend === 297 + 11 * 28 * 33 + 1023,
    String(huidig.current.totals.adSpend));
}
{
  // Een nulrij vóór de eerste besteding (een sync die een dag zonder iets toch schrijft). De start
  // (bronStart) slaat zo'n rij al over; de eerste dag nam hem wel, en dan was vanaf juli 2025 en
  // telde de partiële juli weer als paar: +244,4% kosten terug op de Microsoft-tab.
  const nulrij = { date: "2025-07-01", impressions: 0, clicks: 0, spend: 0, conversions: 0, conversion_value: 0 };
  const metNul = km.kanaalStandUitDagen("demo", [nulrij, ...rijen], "microsoft", DEFAULT_CHANNEL_CONVERSION_CONFIG, 2026);
  check("een nulrij op de 1e maakt die maand niet vol", metNul.vanaf === "2025-08", String(metNul.vanaf));
  const r = comparePeriods(metNul.data, { start: "2025-08", end: "2026-07" }, { start: "2024-08", end: "2025-07" }, [{ ...alsBronReeks("totaal", metNul.data), vanaf: metNul.vanaf }]);
  check("en dan nog steeds geen percentage", r.deltas?.adSpend.pct === null, JSON.stringify(r.deltas?.adSpend));
  // Dezelfde helper zet vanaf in de blended route (lib/api/blended-historical.ts).
  check("eersteDagUitRijen slaat rijen zonder besteding, conversie of waarde over",
    km.eersteDagUitRijen([nulrij, ...rijen], "microsoft_ads") === "2025-07-23", String(km.eersteDagUitRijen([nulrij, ...rijen], "microsoft_ads")));
  // Een rij met alleen een conversie (zonder besteding) is wel data, ook in een niet-standaardveld.
  check("een rij met alleen leads telt wel",
    km.eersteDagUitRijen([{ date: "2026-03-01", spend: 0, leads: 2, conversions: 0, conversion_value: 0 }, { date: "2026-03-13", spend: 5 }], "meta_ads") === "2026-03-01");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
