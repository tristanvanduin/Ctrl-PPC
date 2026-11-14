// Optellen per dagperiode per kanaal (lib/period/dag-telling.ts), en het bewijs dat hele maanden
// EXACT dezelfde cijfers geven als het bestaande pad.
// Draaien: tsx --tsconfig ./tsconfig.json lib/period/__dag_telling_test.ts
//
// WAT HET BESTAANDE PAD IS
//
// Google: demo-rijen -> seededDemoClientData -> buildClientDataFromApi (wat lib/use-client-data.ts
// met het antwoord van de route doet) -> slicePeriod. Meta, LinkedIn, Microsoft: de dagrijen ->
// kanaalStandUitDagen (wat de KPI-band doet, lib/use-channel-period-data.ts) -> slicePeriod. Dat
// wordt hieronder voor elke preset en elke vergelijking naast het nieuwe pad gezet, met === en
// niet "ongeveer": een optelling in een andere volgorde mag hier al opvallen.

import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData } from "../demo/geoclone-demo-data";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { demoRows } from "../demo/demo-rows";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import { resolveChannelConversionConfig } from "../analysis/channel-conversion-config";
import type { ClientHistoricalData } from "../types";
import { alsBronReeks, comparePeriods, slicePeriod, type BronReeks, type PeriodDelta, type Totalen } from "./apply-period";
import { kanaalStandUitDagen, NIET_GOOGLE, samenvoegen, type NietGoogleKanaal } from "./kanaal-maanden";
import { addMonths, COMPARISON_MODES, PERIOD_PRESETS, resolveComparison, resolvePeriod, vensterEindMaand } from "./period-range";
import { uitMaandKeuze, uitMaandPeriode, resolveDagVergelijking, type DagPeriode } from "./dag-periode";
import { telDagPeriode, telDagVergelijking, telGoogleWeken, type GoogleWeekRij, type TelKanaal } from "./dag-telling";
import { today, addDays, opDag } from "../reporting-date";
import { maandagVanWeek } from "../api/google-weekvensters";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const gelijk = (a: Totalen, b: Totalen) => a.conversions === b.conversions && a.revenue === b.revenue && a.adSpend === b.adSpend;

console.log("Google per week, met een verzonnen weekreeks");
{
  // Maandagen in november en december 2025, elke week 100 kosten en de weekindex als conversies.
  const weken: GoogleWeekRij[] = [];
  for (let m = "2025-11-03", i = 1; m <= "2026-01-05"; m = addDays(m, 7), i += 1) {
    weken.push({ week_start: m, cost: 100, conversions: i, conversions_value: 10 * i });
  }
  // Woensdag 26 t/m zondag 30 november: één week, 24-30 november.
  const midden = telGoogleWeken({ start: "2025-11-26", eind: "2025-11-30" }, weken);
  check("een periode midden in een week telt de hele week", midden.geteld?.start === "2025-11-24" && midden.geteld?.eind === "2025-11-30", JSON.stringify(midden.geteld));
  check("op weekniveau", midden.fijnheid === "week");
  check("en zegt dat hij afwijkt", midden.wijktAf && !!midden.uitleg && midden.uitleg.includes("per week") && midden.uitleg.includes("24 t/m 30 nov 2025"), String(midden.uitleg));
  check("met de getelde weekdatum", midden.eenheden.join(",") === "2025-11-24");
  check("de hele week, niet naar rato", midden.totalen.adSpend === 100 && midden.totalen.conversions === 4, JSON.stringify(midden.totalen));

  // Black Friday-week, vrijdag t/m maandag: raakt twee weken.
  const bf = telGoogleWeken({ start: "2025-11-28", eind: "2025-12-01" }, weken);
  check("vrijdag t/m maandag raakt twee weken", bf.eenheden.join(",") === "2025-11-24,2025-12-01" && bf.geteld?.eind === "2025-12-07", JSON.stringify(bf));
  check("en telt ze allebei", bf.totalen.adSpend === 200 && bf.totalen.revenue === 90, JSON.stringify(bf.totalen));

  // Precies maandag t/m zondag: wijkt niet af.
  const precies = telGoogleWeken({ start: "2025-11-10", eind: "2025-11-23" }, weken);
  check("precies hele weken wijkt niet af", !precies.wijktAf && precies.uitleg === null, String(precies.uitleg));

  // Over de jaargrens: de week van 29 december loopt t/m 4 januari.
  const jg = telGoogleWeken({ start: "2025-12-24", eind: "2026-01-02" }, weken);
  check("over de jaargrens", jg.eenheden.join(",") === "2025-12-22,2025-12-29" && jg.geteld?.eind === "2026-01-04", JSON.stringify(jg.geteld));

  // Een ontbrekende week wordt genoemd, niet stil als nul gelezen.
  const gat = telGoogleWeken({ start: "2025-11-12", eind: "2025-11-20" }, weken.filter((w) => w.week_start !== "2025-11-17"));
  check("een ontbrekende week wordt genoemd", gat.ontbrekend.join(",") === "2025-11-17" && !!gat.uitleg?.includes("17 nov 2025"), String(gat.uitleg));
  const niets = telGoogleWeken({ start: "2024-01-10", eind: "2024-01-12" }, weken);
  check("zonder weekdata: niets geteld, en dat wordt gezegd", niets.geteld === null && niets.wijktAf && niets.ontbrekend.length === 1 && !!niets.uitleg);

  // Rijen die niet kloppen: een week twee keer (twee klanten, een dubbele sync) en een week_start op
  // een zondag. Die tellen niet stil mee.
  const vuil = [...weken, { week_start: "2025-11-24", cost: 100, conversions: 4, conversions_value: 40 }, { week_start: "2025-11-23", cost: 999 }];
  const vw = telGoogleWeken({ start: "2025-11-26", eind: "2025-11-30" }, vuil);
  check("een dubbele week telt één keer", vw.totalen.adSpend === 100 && vw.eenheden.join(",") === "2025-11-24", JSON.stringify(vw.totalen));
  check("en wordt gemeld", !!vw.uitleg?.includes("meer dan één rij"), String(vw.uitleg));
  check("een week_start die geen maandag is wordt overgeslagen en gemeld", !!vw.uitleg?.includes("niet op een maandag") && vw.uitleg.includes("23 nov 2025"), String(vw.uitleg));
  check("een week_start met een tijd telt op zijn datum", telGoogleWeken({ start: "2025-11-24", eind: "2025-11-30" }, [{ week_start: "2025-11-24T00:00:00Z", cost: 5 }]).totalen.adSpend === 5);

  // De lopende week: vandaag is woensdag 3 december 2025. De week van 1 december is nog niet af.
  opDag("2025-12-03", () => {
    const lw = telGoogleWeken({ start: "2025-12-01", eind: "2025-12-07" }, weken);
    check("de lopende week telt t/m gisteren", lw.geteld?.start === "2025-12-01" && lw.geteld?.eind === "2025-12-02" && lw.wijktAf, JSON.stringify(lw.geteld));
    check("en zegt dat", !!lw.uitleg?.includes("nog niet af"), String(lw.uitleg));
    check("dataTot is gisteren", lw.dataTot === "2025-12-02", String(lw.dataTot));
    const toekomst = telGoogleWeken({ start: "2025-12-15", eind: "2025-12-20" }, weken);
    check("een week die nog moet komen ontbreekt niet, en dat staat erbij", toekomst.ontbrekend.length === 0 && toekomst.geteld === null && !!toekomst.uitleg?.includes("na gisteren"), String(toekomst.uitleg));
  });
  check("de start van Google per week is de eerste week met data", telGoogleWeken({ start: "2025-11-26", eind: "2025-11-30" }, [{ week_start: "2025-10-27", cost: 0 }, ...weken]).bronStart === "2025-11-03");
}

console.log("Een dagkanaal met een verzonnen reeks");
{
  // Microsoft vanaf woensdag 1 oktober 2025, elke dag 10 kosten, t/m 10 oktober.
  const rijen: Record<string, unknown>[] = [];
  for (let d = "2025-10-01"; d <= "2025-10-10"; d = addDays(d, 1)) rijen.push({ date: d, spend: 10, conversions: 1, conversion_value: 5 });
  const cfg = resolveChannelConversionConfig(null as never);
  const invoer = { dagkanalen: { microsoft: rijen }, convConfig: cfg };
  const t = telDagPeriode({ start: "2025-10-05", eind: "2025-10-15" }, invoer).perKanaal[0];
  check("de start komt uit alle rijen, niet uit de periode", t.bronStart === "2025-10-01", String(t.bronStart));
  check("een periode na de laatste rij is korter geteld", t.geteld?.start === "2025-10-05" && t.geteld?.eind === "2025-10-10" && t.wijktAf, JSON.stringify(t.geteld));
  check("en zegt t/m wanneer er data is", !!t.uitleg?.includes("data t/m 10 okt 2025"), String(t.uitleg));
  check("met de totalen van de getelde dagen", t.totalen.adSpend === 60, String(t.totalen.adSpend));
  const voor = telDagPeriode({ start: "2025-09-01", eind: "2025-09-10" }, invoer).perKanaal[0];
  check("een periode vóór de eerste rij: niets geteld, en dat staat erbij", voor.geteld === null && voor.wijktAf && !!voor.uitleg?.includes("geen data"), String(voor.uitleg));
  const binnen = telDagPeriode({ start: "2025-10-02", eind: "2025-10-08" }, invoer).perKanaal[0];
  check("binnen de rijen: precies gevraagd", !binnen.wijktAf && binnen.uitleg === null);

  // Vergelijken: de vergelijkingsperiode ligt deels vóór de start. Niet als 0 (of half) tellen.
  const v = telDagVergelijking({ start: "2025-10-04", eind: "2025-10-06" }, { start: "2025-09-30", eind: "2025-10-02" }, invoer);
  const mv = v.perKanaal.find((x) => x.kanaal === "microsoft")!;
  check("deels vóór de start: ongepaard", mv.gepaard === null && v.ongepaard.includes("microsoft"), JSON.stringify(mv.gepaard));
  check("met de reden", !!mv.uitleg?.includes("liep pas vanaf 1 okt 2025") && mv.uitleg.includes("vergelijkingsperiode"), String(mv.uitleg));
  check("en geen percentage uit het niets", v.deltas.adSpend.pct === null && v.deltas.adSpend.vorig === 0 && v.deltas.adSpend.huidig === 0, JSON.stringify(v.deltas.adSpend));
  check("de totalen in beeld blijven staan", v.huidig.totaal.adSpend === 30 && v.vorig.totaal.adSpend === 20);
  const ok = telDagVergelijking({ start: "2025-10-06", eind: "2025-10-08" }, { start: "2025-10-01", eind: "2025-10-03" }, invoer);
  check("na de start: gepaard", ok.ongepaard.length === 0 && ok.deltas.adSpend.huidig === 30 && ok.deltas.adSpend.vorig === 30 && ok.deltas.adSpend.pct === 0, JSON.stringify(ok.deltas.adSpend));
}

async function main() {
  const rijen = demoRows();
  const sb = new FakeSupabase();
  for (const [tabel, r] of Object.entries(rijen)) sb.seed(tabel, r);
  const api = await seededDemoClientData(sb as never, DEMO_GREENTECH_ID);
  const google: ClientHistoricalData = buildClientDataFromApi(
    DEMO_GREENTECH_ID,
    api.historicalYears as YearDataInput[],
    api.currentYearMonthly as ApiMonthlyData[],
    api.currentYearWeekly as ApiWeeklyData[],
    api.targetCurrentYear,
    api.currentYear,
    api.realizedThroughMonth,
  );
  const cs = rijen.client_settings.find((r) => r.client_id === DEMO_GREENTECH_ID)!;
  const cfg = resolveChannelConversionConfig(cs.channel_conversion_config as never);
  const tabel: Record<NietGoogleKanaal, string> = { meta: "meta_account_daily", linkedin: "linkedin_account_daily", microsoft: "microsoft_account_daily" };
  const dag: Record<NietGoogleKanaal, Record<string, unknown>[]> = {
    meta: rijen[tabel.meta].filter((r) => r.client_id === DEMO_GREENTECH_ID),
    linkedin: rijen[tabel.linkedin].filter((r) => r.client_id === DEMO_GREENTECH_ID),
    microsoft: rijen[tabel.microsoft].filter((r) => r.client_id === DEMO_GREENTECH_ID),
  };
  // Alleen de rijen van de demo-klant: telGoogleWeken telt per week één rij en meldt de rest.
  const weken = (rijen.ads_account_weekly ?? []).filter((r) => r.client_id === DEMO_GREENTECH_ID) as unknown as GoogleWeekRij[];
  const oudeStand = Object.fromEntries(NIET_GOOGLE.map((k) => [k, kanaalStandUitDagen(DEMO_GREENTECH_ID, dag[k], k, cfg)])) as Record<NietGoogleKanaal, ReturnType<typeof kanaalStandUitDagen>>;

  console.log("De demo heeft alle vier de kanalen");
  for (const k of NIET_GOOGLE) check(`${k} heeft dagrijen`, dag[k].length > 100, String(dag[k].length));
  check("Google heeft weekrijen", weken.length > 4, String(weken.length));

  console.log("Hele maanden: EXACT dezelfde cijfers als het bestaande pad");
  {
    const nu = today().slice(0, 7);
    const eind = vensterEindMaand(null, nu);
    const eigen = { start: addMonths(eind, -8), end: addMonths(eind, -2) };
    let paren = 0;
    for (const preset of PERIOD_PRESETS) {
      const p = resolvePeriod(preset, eigen, addMonths(eind, 1));
      for (const mode of COMPARISON_MODES) {
        const c = resolveComparison(p, mode);
        const { periode, vergelijking } = uitMaandKeuze(p, mode);
        const kanten: [string, typeof p, DagPeriode | null][] = [["periode", p, periode]];
        if (c) kanten.push(["vergelijking", c, vergelijking.periode]);
        for (const [kant, maand, dagp] of kanten) {
          if (!dagp) { check(`${preset}/${mode} ${kant}: heeft een dagperiode`, false); continue; }
          const nieuw = telDagPeriode(dagp, { google: { maanden: google, weken }, dagkanalen: dag, convConfig: cfg });
          const g = nieuw.perKanaal.find((t) => t.kanaal === "google")!;
          const oudG = slicePeriod(google, maand);
          check(`${preset}/${mode} ${kant} google`, gelijk(g.totalen, oudG.totals), `${JSON.stringify(g.totalen)} vs ${JSON.stringify(oudG.totals)}`);
          check(`${preset}/${mode} ${kant} google per maand`, g.fijnheid === "maand" && !g.wijktAf && g.ontbrekend.join() === oudG.missing.join());
          for (const k of NIET_GOOGLE) {
            const t = nieuw.perKanaal.find((x) => x.kanaal === k)!;
            const oud = slicePeriod(oudeStand[k].data, maand).totals;
            check(`${preset}/${mode} ${kant} ${k}`, gelijk(t.totalen, oud), `${JSON.stringify(t.totalen)} vs ${JSON.stringify(oud)}`);
            // Geteld is de periode, begrensd door de eerste en de laatste rij van het kanaal.
            const ds = dag[k].map((r) => String(r.date).slice(0, 10)).sort();
            const van = ds[0] > dagp.start ? ds[0] : dagp.start;
            const tot = ds[ds.length - 1] < dagp.eind ? ds[ds.length - 1] : dagp.eind;
            const verwacht = van <= tot ? { start: van, eind: tot } : null;
            check(`${preset}/${mode} ${kant} ${k} per dag, geteld ${JSON.stringify(verwacht)}`,
              t.fijnheid === "dag" && JSON.stringify(t.geteld) === JSON.stringify(verwacht)
              && t.wijktAf === (JSON.stringify(verwacht) !== JSON.stringify(dagp)) && (t.wijktAf === !!t.uitleg),
              `${JSON.stringify(t.geteld)} ${t.uitleg}`);
          }
          check(`${preset}/${mode} ${kant}: gemengd precies als een kanaal afwijkt`, nieuw.gemengd === nieuw.perKanaal.some((x) => x.wijktAf));
          paren += 1;
        }
      }
    }
    // Zes presets, drie vergelijkingen, waarvan twee met een vergelijkingsperiode: 6 x (3 + 2).
    check("alle combinaties zijn gedraaid", paren === PERIOD_PRESETS.length * 5, String(paren));
    // De vergelijking moet echt cijfers hebben, anders bewijst gelijkheid niets.
    const p = resolvePeriod("last_12m", null, addMonths(eind, 1));
    const t = telDagPeriode(uitMaandPeriode(p), { google: { maanden: google }, dagkanalen: dag, convConfig: cfg });
    check("de demo heeft over twaalf maanden in elk kanaal besteding", t.perKanaal.length === 4 && t.perKanaal.every((x) => x.totalen.adSpend > 0), JSON.stringify(t.perKanaal.map((x) => [x.kanaal, x.totalen.adSpend])));
  }

  console.log("Hele maanden: dezelfde GEPAARDE vergelijking als de band (comparePeriods)");
  {
    // De bronnen zoals bandPerKanaal (lib/use-channel-period-data.ts) ze maakt: Google zonder
    // vanaf, een dagkanaal met zijn eerste volle maand. De laadgrens telt alleen in de uitleg.
    const bron: Record<TelKanaal, BronReeks> = {
      google: alsBronReeks("google", google),
      meta: alsBronReeks("meta", oudeStand.meta.data, oudeStand.meta.vanaf),
      linkedin: alsBronReeks("linkedin", oudeStand.linkedin.data, oudeStand.linkedin.vanaf),
      microsoft: alsBronReeks("microsoft", oudeStand.microsoft.data, oudeStand.microsoft.vanaf),
    };
    const reeks: Record<TelKanaal, ClientHistoricalData> = { google, meta: oudeStand.meta.data, linkedin: oudeStand.linkedin.data, microsoft: oudeStand.microsoft.data };
    const alle = samenvoegen(DEMO_GREENTECH_ID, [google, oudeStand.meta.data, oudeStand.linkedin.data, oudeStand.microsoft.data]);
    const zelfdeDelta = (a: PeriodDelta, b: PeriodDelta) => a.huidig === b.huidig && a.vorig === b.vorig && a.pct === b.pct;
    const drie = ["conversions", "revenue", "adSpend"] as const;
    const nu = today().slice(0, 7);
    const eind = vensterEindMaand(null, nu);
    const eigen = { start: addMonths(eind, -8), end: addMonths(eind, -2) };
    let paren = 0;
    let ongepaardGezien = 0;
    for (const preset of PERIOD_PRESETS) {
      const p = resolvePeriod(preset, eigen, addMonths(eind, 1));
      for (const mode of COMPARISON_MODES) {
        const c = resolveComparison(p, mode);
        if (!c) continue;
        const { periode, vergelijking } = uitMaandKeuze(p, mode);
        const v = telDagVergelijking(periode, vergelijking.periode!, { google: { maanden: google, weken }, dagkanalen: dag, convConfig: cfg });
        // Per kanaal: wat de kanaaltab van de band zegt.
        for (const k of ["google", ...NIET_GOOGLE] as TelKanaal[]) {
          const oud = comparePeriods(reeks[k], p, c, [bron[k]]);
          const x = v.perKanaal.find((y) => y.kanaal === k)!;
          const gepaardOud = oud.perBron[0].bereik !== null;
          check(`${preset}/${mode} ${k}: gepaard precies als de band`, (x.gepaard !== null) === gepaardOud, `${JSON.stringify(x.gepaard)} ${x.uitleg}`);
          if (!gepaardOud) {
            ongepaardGezien += 1;
            check(`${preset}/${mode} ${k}: ongepaard met reden`, !!x.uitleg, String(x.uitleg));
            continue;
          }
          for (const m of drie) {
            const nieuw = { huidig: x.gepaard!.huidig[m], vorig: x.gepaard!.vorig[m] };
            check(`${preset}/${mode} ${k} ${m}`, nieuw.huidig === oud.deltas![m].huidig && nieuw.vorig === oud.deltas![m].vorig,
              `${JSON.stringify(nieuw)} vs ${JSON.stringify(oud.deltas![m])}`);
          }
        }
        // Alle kanalen: de deltas van de band op "Alle kanalen".
        const oud = comparePeriods(alle, p, c, [bron.google, bron.meta, bron.linkedin, bron.microsoft]);
        for (const m of drie) {
          check(`${preset}/${mode} alle kanalen ${m}`, zelfdeDelta(v.deltas[m], oud.deltas![m]), `${JSON.stringify(v.deltas[m])} vs ${JSON.stringify(oud.deltas![m])}`);
        }
        paren += 1;
      }
    }
    check("alle presets met een vergelijking zijn gedraaid", paren === PERIOD_PRESETS.length * 2, String(paren));
    // Op de demo loopt Microsoft pas sinds oktober 2025: minstens één combinatie moet hem buiten het
    // percentage laten, anders toetst deze test de regel niet.
    check("de demo heeft een kanaal dat in de vergelijkingsperiode nog niet liep", ongepaardGezien > 0, String(ongepaardGezien));
  }

  console.log("Een dagperiode op de demo");
  {
    // Een week van woensdag t/m dinsdag, vier weken terug: de dagkanalen tellen precies die dagen,
    // Google de twee weken die hij raakt.
    const woensdag = addDays(maandagVanWeek(today()), -26);
    const p = { start: woensdag, eind: addDays(woensdag, 6) };
    const t = telDagPeriode(p, { google: { maanden: google, weken }, dagkanalen: dag, convConfig: cfg });
    const g = t.perKanaal.find((x) => x.kanaal === "google")!;
    check("Google telt per week", g.fijnheid === "week" && g.eenheden.length === 2, JSON.stringify(g.eenheden));
    check("en zegt dat", g.wijktAf && !!g.uitleg, String(g.uitleg));
    check("de som zegt dat hij gemengd is", t.gemengd);
    for (const k of NIET_GOOGLE) {
      const x = t.perKanaal.find((y) => y.kanaal === k)!;
      // Nagerekend op de rijen zelf, met dezelfde selectie: alleen de besteding, die geen selectie kent.
      const kosten = dag[k].filter((r) => String(r.date) >= p.start && String(r.date) <= p.eind).reduce((s, r) => s + Number(r.spend ?? 0), 0);
      check(`${k} telt precies de zeven dagen`, x.fijnheid === "dag" && !x.wijktAf && x.totalen.adSpend === kosten, `${x.totalen.adSpend} vs ${kosten}`);
    }
    // Vorig jaar, 364 dagen terug: dezelfde weekdagen, en Google raakt weer twee hele weken.
    const v = resolveDagVergelijking(p, "same_dates_last_year");
    check("de vergelijking is 364 dagen terug", v.uitlijning === "weekdag" && v.periode?.start === addDays(p.start, -364));

    // Een dagperiode waarin Microsoft in de vergelijkingsperiode nog niet (helemaal) liep: een week
    // die een jaar later begint dan drie dagen vóór zijn start, tegen dezelfde weekdagen vorig jaar.
    // Microsoft valt buiten het percentage, de kanalen die toen al liepen niet.
    const msStart = dag.microsoft.filter((r) => Number(r.spend ?? 0) > 0).map((r) => String(r.date).slice(0, 10)).sort()[0];
    const pm = { start: addDays(msStart, 364 - 3), eind: addDays(msStart, 364 + 3) };
    const vm = resolveDagVergelijking(pm, "same_dates_last_year");
    check("de vergelijking begint vóór de start van Microsoft", vm.uitlijning === "weekdag" && vm.periode!.start < msStart && vm.periode!.eind >= msStart, JSON.stringify(vm.periode));
    const vv = telDagVergelijking(pm, vm.periode!, { google: { maanden: google, weken }, dagkanalen: dag, convConfig: cfg });
    const ms = vv.perKanaal.find((x) => x.kanaal === "microsoft")!;
    check("Microsoft liep toen deels nog niet: ongepaard", ms.gepaard === null && !!ms.uitleg?.includes("liep pas vanaf"), String(ms.uitleg));
    check("de start van Microsoft komt uit alle rijen, niet uit de periode", ms.huidig?.bronStart === msStart && ms.vorig?.bronStart === msStart, `${ms.huidig?.bronStart} vs ${msStart}`);
    const msHuidig = ms.huidig!.totalen.adSpend;
    check("Microsoft staat wel in de totalen", msHuidig > 0 && vv.huidig.totaal.adSpend >= msHuidig);
    const gepaardeSom = vv.perKanaal.filter((x) => x.gepaard).reduce((s, x) => s + x.gepaard!.huidig.adSpend, 0);
    check("maar niet in het percentage", vv.deltas.adSpend.huidig === gepaardeSom && vv.huidig.totaal.adSpend - gepaardeSom >= msHuidig - 1e-6,
      `${vv.deltas.adSpend.huidig} vs ${gepaardeSom}, ongepaard ${vv.ongepaard.join(",")}`);
    // De regel voor elk kanaal: gepaard precies als beide periodes op of na zijn start beginnen, en
    // beide even veel dagen tellen. (De weekrijen van de demo beginnen pas in mei 2026: het deel van
    // Google daarvóór telt per hele maand, en hele maanden tegen weken valt buiten het percentage.)
    for (const x of vv.perKanaal) {
      const moet = !!x.huidig?.bronStart && !!x.vorig?.bronStart && pm.start >= x.huidig.bronStart && vm.periode!.start >= x.vorig.bronStart
        && x.huidig.exact !== false && x.vorig.exact !== false;
      check(`${x.kanaal}: gepaard precies als beide periodes na de start beginnen`, (x.gepaard !== null) === moet && (moet || !!x.uitleg), `${x.huidig?.bronStart} ${x.uitleg}`);
    }

    // Een periode die doorloopt na vandaag: de dagkanalen zeggen tot wanneer ze data hebben.
    const lopend = telDagPeriode({ start: addDays(today(), -3), eind: addDays(today(), 10) }, { dagkanalen: dag, convConfig: cfg });
    for (const x of lopend.perKanaal) {
      check(`${x.kanaal}: een periode in de toekomst is korter geteld`, x.wijktAf && x.geteld?.eind === x.dataTot && !!x.uitleg?.includes("data t/m"), `${JSON.stringify(x.geteld)} ${x.uitleg}`);
    }
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
