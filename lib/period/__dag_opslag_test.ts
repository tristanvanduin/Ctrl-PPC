// Google per dag: de splitsing op de dagopslag (lib/period/dag-opslag.ts), de telling in de
// kerncijfers (telGoogleDagen in dag-telling.ts), en de demo-dagen die exact optellen tot de maanden
// (lib/demo/google-dag-demo.ts).
// Draaien: tsx --tsconfig ./tsconfig.json lib/period/__dag_opslag_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData } from "../demo/geoclone-demo-data";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { demoRows } from "../demo/demo-rows";
import { googleDagRijen } from "../demo/google-dag-demo";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import type { ClientHistoricalData } from "../types";
import { slicePeriod } from "./apply-period";
import { addMonths } from "./period-range";
import { laatsteDagVanMaand } from "./dag-periode";
import { splitsOpDagOpslag, dagStart } from "./dag-opslag";
import { telDagPeriode, telDagVergelijking, telGoogle, type GoogleDagRij, type GoogleWeekRij } from "./dag-telling";
import { addDays } from "../reporting-date";
import { kaartDagRegel } from "../overzicht/bovenkant";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("De splitsing op de dagopslag");
{
  const p = { start: "2026-09-01", eind: "2026-11-30" };
  const s = splitsOpDagOpslag(p, "2026-11-01");
  check("alleen het deel vóór de dagopslag valt terug op maanden",
    s.dagDeel?.start === "2026-11-01" && s.dagDeel.eind === "2026-11-30" && s.maanden?.start === "2026-09" && s.maanden.end === "2026-10", JSON.stringify(s));
  check("en het label zegt dat precies", s.label === "1 t/m 30 nov 2026 per dag; sep–okt 2026 per maand, voor de dagopslag begon", String(s.label));

  const midden = splitsOpDagOpslag(p, "2026-10-15");
  check("begint de dagopslag midden in een maand, dan telt die maand nog per maand (geen dubbele dagen)",
    dagStart("2026-10-15") === "2026-11-01" && midden.dagDeel?.start === "2026-11-01" && midden.maanden?.end === "2026-10" && !midden.maandenRuimer, JSON.stringify(midden));

  const ruim = splitsOpDagOpslag({ start: "2026-09-10", eind: "2026-11-20" }, "2026-11-01");
  check("een halve maand vóór de dagopslag telt als hele maand, en dat staat erbij",
    ruim.maandenRuimer && !!ruim.label?.includes("hele maanden") && ruim.label.startsWith("1 t/m 20 nov 2026 per dag; sep–okt 2026 per maand"), String(ruim.label));

  const geen = splitsOpDagOpslag({ start: "2026-11-02", eind: "2026-11-12" }, "2026-01-01");
  check("geen terugval, geen label", geen.label === null && geen.maandDeel === null && geen.dagDeel?.start === "2026-11-02");

  const zonder = splitsOpDagOpslag(p, null);
  check("zonder dagopslag: alles per maand, met de reden", zonder.dagDeel === null && zonder.label === "sep–nov 2026 per maand, er is nog geen dagopslag", String(zonder.label));

  // De eerste dagrij midden in een maand, de periode erna: de dagrijen dekken hem helemaal.
  const jong = splitsOpDagOpslag({ start: "2026-08-20", eind: "2026-09-05" }, "2026-08-17");
  check("begint de periode na de eerste dagrij (ook midden in een maand), dan alles per dag, zonder label",
    jong.dagDeel?.start === "2026-08-20" && jong.maandDeel === null && jong.maanden === null && jong.label === null && !jong.maandenRuimer, JSON.stringify(jong));
  const opDeDag = splitsOpDagOpslag({ start: "2026-08-17", eind: "2026-08-31" }, "2026-08-17");
  check("begint de periode op de eerste dagrij: ook alles per dag", opDeDag.maandDeel === null && opDeDag.label === null);

  const allesErvoor = splitsOpDagOpslag({ start: "2026-05-01", eind: "2026-05-31" }, "2026-11-01");
  check("een periode helemaal vóór de dagopslag: alleen maanden", allesErvoor.dagDeel === null && allesErvoor.label === "mei 2026 per maand, voor de dagopslag begon", String(allesErvoor.label));
}

async function main() {
  const rijen = demoRows();
  const sb = new FakeSupabase();
  for (const [tabel, r] of Object.entries(rijen)) sb.seed(tabel, r);
  const api = await seededDemoClientData(sb as never, DEMO_GREENTECH_ID);
  const maanden: ClientHistoricalData = buildClientDataFromApi(
    DEMO_GREENTECH_ID,
    api.historicalYears as YearDataInput[],
    api.currentYearMonthly as ApiMonthlyData[],
    api.currentYearWeekly as ApiWeeklyData[],
    api.targetCurrentYear,
    api.currentYear,
    api.realizedThroughMonth,
  );
  const dagen = (rijen.ads_account_daily ?? []) as unknown as (GoogleDagRij & { client_id: string })[];
  const maandRijen = (rijen.ads_account_monthly ?? []) as Record<string, number | string>[];

  console.log("De demo: Google per dag telt per maand EXACT op tot de maandcijfers");
  {
    check("de demo heeft dagrijen voor Google", dagen.length > 600, String(dagen.length));
    let maandenGelijk = 0;
    for (const m of maandRijen) {
      const maand = String(m.month).slice(0, 7);
      const inMaand = dagen.filter((d) => d.date.startsWith(maand));
      const som = (k: keyof GoogleDagRij) => inMaand.reduce((s, d) => s + Number(d[k] ?? 0), 0);
      const gelijk = (["impressions", "clicks", "cost", "conversions", "conversions_value"] as const).every((k) => som(k) === Number(m[k]));
      check(`${maand}: de dagen zijn de maand`, gelijk, JSON.stringify({ kosten: som("cost"), maand: m.cost }));
      if (gelijk) maandenGelijk += 1;
    }
    check("alle maanden", maandenGelijk === maandRijen.length && maandRijen.length >= 24, `${maandenGelijk}/${maandRijen.length}`);
    const vandaag = new Date().toISOString().slice(0, 10);
    check("geen dag in de toekomst", dagen.every((d) => d.date <= vandaag));

    // Per campagne: dezelfde eigenschap, en de events zijn terug te zien.
    const campagneMaanden = (rijen.ads_campaign_monthly ?? []) as Record<string, unknown>[];
    const { campagnes } = googleDagRijen(DEMO_GREENTECH_ID, campagneMaanden);
    const fout = campagneMaanden.filter((m) => {
      const som = campagnes.filter((c) => c.campaign_id === m.campaign_id && String(c.date).startsWith(String(m.month).slice(0, 7)))
        .reduce((s, c) => s + Number(c.cost), 0);
      return som !== Number(m.cost);
    });
    check("per campagne tellen de dagen op tot de campagnemaand", fout.length === 0, `${fout.length} afwijkend`);

    // Weekdagpatroon: een weekenddag kost gemiddeld minder dan een werkdag.
    const gem = (f: (d: string) => boolean) => {
      const x = dagen.filter((d) => f(d.date));
      return x.reduce((s, d) => s + Number(d.cost), 0) / Math.max(1, x.length);
    };
    const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    check("het weekend is lichter dan doordeweeks", gem(weekend) < gem((d) => !weekend(d)), `${gem(weekend)} tegen ${gem((d) => !weekend(d))}`);

    // Black Friday: de Shopping-campagne kost in 21 nov t/m 1 dec per dag meer dan in de rest van november.
    const bfJaar = ["2024", "2025", "2026"].find((j) => campagnes.some((c) => c.date === `${j}-11-30`));
    if (bfJaar) {
      const shop = campagnes.filter((c) => String(c.campaign_name).includes("Shopping") && String(c.date).startsWith(`${bfJaar}-11`));
      const bf = shop.filter((c) => String(c.date) >= `${bfJaar}-11-21`);
      const rest = shop.filter((c) => String(c.date) < `${bfJaar}-11-21`);
      const g = (x: typeof shop) => x.reduce((s, c) => s + Number(c.cost), 0) / Math.max(1, x.length);
      check(`Black Friday ${bfJaar} is zichtbaar bij Shopping`, g(bf) > 1.5 * g(rest), `${g(bf)} tegen ${g(rest)}`);
    } else check("er ligt een Black Friday in de demo", false);
  }

  console.log("Google per dag in de kerncijfers (telGoogleDagen)");
  {
    // De dagopslag begint (in deze proef) op de eerste van de maand twee maanden terug.
    const nu = new Date().toISOString().slice(0, 7);
    const begin = `${addMonths(nu, -2)}-01`;
    const metOpslag = dagen.filter((d) => d.date >= begin);
    const periode = { start: `${addMonths(nu, -3)}-01`, eind: `${addMonths(nu, -1)}-15` };
    const t = telGoogle(periode, { maanden, dagen: metOpslag })!;
    const dagDeel = metOpslag.filter((d) => d.date >= begin && d.date <= periode.eind).reduce((s, d) => s + Number(d.cost), 0);
    const maandDeel = slicePeriod(maanden, { start: addMonths(nu, -3), end: addMonths(nu, -3) }).totals.adSpend;
    check("het deel vóór de dagopslag per maand, de rest per dag", t.totalen.adSpend === maandDeel + dagDeel, `${t.totalen.adSpend} tegen ${maandDeel} + ${dagDeel}`);
    check("fijnheid: per dag en maand", t.fijnheid === "dag+maand" && kaartDagRegel(t, null, false)?.fijnheid === "per dag en maand");
    check("het venster zegt precies welk deel hoe telde", !!t.venster?.includes("per dag;") && t.venster.includes("per maand, voor de dagopslag begon") && !!t.uitleg?.startsWith("Google Ads: "), String(t.uitleg));

    // Een event binnen de dagopslag: per dag, zonder label.
    const event = { start: `${addMonths(nu, -2)}-03`, eind: `${addMonths(nu, -2)}-12` };
    const e = telDagPeriode(event, { google: { maanden, dagen: metOpslag } }).perKanaal[0];
    const verwacht = metOpslag.filter((d) => d.date >= event.start && d.date <= event.eind).reduce((s, d) => s + Number(d.conversions), 0);
    check("een event binnen de dagopslag telt per dag, exact", e.fijnheid === "dag" && e.totalen.conversions === verwacht && !e.wijktAf, `${e.totalen.conversions} tegen ${verwacht}`);
    check("geen terugval = geen extra label", e.venster === null && e.uitleg === null, String(e.uitleg));
    check("met de vertoningen en klikken van dezelfde dagen", e.tellers?.clicks === metOpslag.filter((d) => d.date >= event.start && d.date <= event.eind).reduce((s, d) => s + Number(d.clicks), 0));

    // Hele maanden: het bestaande pad, en dus exact de band.
    const heel = { start: `${addMonths(nu, -3)}-01`, eind: laatsteDagVanMaand(addMonths(nu, -2)) };
    const h = telGoogle(heel, { maanden, dagen: metOpslag })!;
    check("hele maanden blijven op de maandreeks", h.fijnheid === "maand" && h.totalen.adSpend === slicePeriod(maanden, { start: addMonths(nu, -3), end: addMonths(nu, -2) }).totals.adSpend);

    // Zonder dagrijen (de tabel bestaat nog niet): per week, zoals voorheen.
    const weken = (rijen.ads_account_weekly ?? []).filter((r) => r.client_id === DEMO_GREENTECH_ID) as unknown as GoogleWeekRij[];
    for (const leeg of [null, []]) {
      const w = telGoogle(event, { maanden, weken, dagen: leeg })!;
      check(`zonder dagrijen (${leeg === null ? "null" : "leeg"}) telt Google per week, ongewijzigd`, w.fijnheid === "week" && w.venster === undefined);
    }

    // Een vergelijking waarin een kant een deel als hele maand telt: geen percentage voor Google.
    // Het voorbeeld uit de review: dagopslag vanaf 1 nov 2025; 10 sep t/m 10 nov 2026 telt per dag,
    // 10 sep t/m 10 nov 2025 telt sep en okt 2025 als hele maanden (71 dagen in plaats van 62).
    {
      const synth: GoogleDagRij[] = [];
      for (let d = "2025-11-01"; d <= "2026-11-12"; d = addDays(d, 1)) synth.push({ date: d, impressions: 100, clicks: 10, cost: 10, conversions: 1, conversions_value: 40 });
      const v = telDagVergelijking({ start: "2026-09-10", eind: "2026-11-10" }, { start: "2025-09-10", eind: "2025-11-10" }, { google: { maanden, dagen: synth } });
      const g = v.perKanaal.find((k) => k.kanaal === "google")!;
      check("de huidige kant telt exact per dag, de vorige niet", g.huidig?.exact === true && g.vorig?.exact === false, JSON.stringify({ h: g.huidig?.exact, v: g.vorig?.exact }));
      check("dan geen percentage voor Google, met de reden", g.gepaard === null && !!g.uitleg?.includes("valt buiten het percentage") && !!g.uitleg.includes("hele maand"), String(g.uitleg));

      // Allebei binnen de dagopslag: gewoon gepaard.
      const binnen = telDagVergelijking({ start: "2026-10-10", eind: "2026-11-10" }, { start: "2026-09-08", eind: "2026-10-09" }, { google: { maanden, dagen: synth } });
      const b = binnen.perKanaal.find((k) => k.kanaal === "google")!;
      check("twee periodes per dag worden gepaard", !!b.gepaard && b.gepaard.huidig.adSpend === 320 && b.gepaard.vorig.adSpend === 320, JSON.stringify(b.gepaard));
    }

    // Een dubbele dagrij telt niet dubbel.
    const dubbel = telGoogle(event, { maanden, dagen: [...metOpslag, { ...metOpslag.find((d) => d.date === event.start)! }] })!;
    check("een dubbele dagrij telt één keer en staat in de uitleg", dubbel.totalen.conversions === verwacht && !!dubbel.uitleg?.includes("meer dan één dagrij"), String(dubbel.uitleg));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
