// Twee fouten uit de browser (demo-greentech, nieuwe weergave, de geseede database zonder Google-dagrijen):
//
// F1 GOOGLE VALT NIET TERUG OP MAANDEN. Met kanaal Google en 21 nov t/m 1 dec 2025 stonden de
//    kerncijfers en de trechter op 0 en zei de vergelijking "Google Ads liep pas vanaf 18 mei 2026",
//    terwijl de grafiek ernaast voor nov-dec 2025 de maandcijfers toonde. Zonder dagrijen telde
//    Google alleen per week, en de weekrijen beginnen in mei 2026. Nu telt het deel vóór de eerste
//    weekrij per hele maand, met het eerlijke label, en is het begin van Google het vroegste van dag-,
//    week- en maanddata. Ook Na de klik krijgt de klikken over diezelfde maanden.
// F3 EEN KANAAL DAT NOG NIET LIEP IN DE TRECHTER. Meta voor 21 nov t/m 1 dec 2025 toonde "Vertoningen
//    0, kosten per 1.000 vertoningen niet te berekenen". Nu een regel; een kanaal dat liep met nul
//    toont wel de nullen.
//
// Draaien: tsx --tsconfig ./tsconfig.json lib/period/__google_terugval_test.ts

import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData } from "../demo/geoclone-demo-data";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { demoRows } from "../demo/demo-rows";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import { resolveChannelConversionConfig } from "../analysis/channel-conversion-config";
import type { ClientHistoricalData } from "../types";
import { alsBronReeks, slicePeriod } from "./apply-period";
import { kanaalStandUitDagen } from "./kanaal-maanden";
import { nogNietGelopen, telDagPeriode, telDagVergelijking, type GoogleWeekRij, type Tellers } from "./dag-telling";
import { kaartDagRegel } from "../overzicht/bovenkant";
import { nietGelopenInMaanden, trechter } from "../overzicht/trechter";
import { telKanaalStappen, type GeldendeTrechter } from "../overzicht/conversiestappen";
import { googleWeekNoot } from "./dag-keuze";
import { eersteWeekRij, type GoogleDagRij } from "./dag-telling";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  const rijen = demoRows() as unknown as Record<string, Record<string, unknown>[]>;
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
  const weken = (rijen.ads_account_weekly ?? []) as unknown as GoogleWeekRij[];
  const maandTellers = new Map<string, Tellers>((rijen.ads_account_monthly ?? []).map((r) =>
    [String(r.month).slice(0, 7), { impressions: Number(r.impressions), clicks: Number(r.clicks) }]));
  const eersteWeek = weken.map((w) => w.week_start).sort()[0];
  const convConfig = resolveChannelConversionConfig(null);
  // De demo zonder Google-dagrijen: migratie 111 niet gedraaid.
  const google = { maanden, weken, dagen: null, maandTellers };

  console.log("F1: een periode vóór de eerste weekrij telt per hele maand");
  {
    check("de demo heeft weekrijen pas vanaf mei 2026, maanden al eerder", eersteWeek >= "2026-05-01" && Object.keys(maanden.historicalYears).length > 0, eersteWeek);
    const p = { start: "2025-11-21", eind: "2025-12-01" };
    const c = { start: "2025-11-10", eind: "2025-11-20" };
    const v = telDagVergelijking(p, c, { google, dagkanalen: {}, convConfig });
    const g = v.huidig.perKanaal.find((t) => t.kanaal === "google")!;
    const verwacht = slicePeriod(maanden, { start: "2025-11", end: "2025-12" }).totals;
    check("de kerncijfers zijn de maandcijfers van nov en dec 2025, geen nul",
      verwacht.conversions > 0 && g.totalen.conversions === verwacht.conversions && g.totalen.adSpend === verwacht.adSpend, `${g.totalen.conversions} tegen ${verwacht.conversions}`);
    check("per maand, met het eerlijke label",
      g.fijnheid === "maand" && g.venster === "nov–dec 2025 per maand, voor de weekcijfers begonnen (hele maanden: een maand wordt niet naar rato verdeeld)", String(g.venster));
    check("het begin van Google is de eerste maand met data, niet de eerste week", g.bronStart !== null && g.bronStart < p.start, String(g.bronStart));
    const klikken = (maandTellers.get("2025-11")?.clicks ?? 0) + (maandTellers.get("2025-12")?.clicks ?? 0);
    check("de trechter krijgt de vertoningen en klikken over dezelfde maanden", g.tellers?.clicks === klikken && klikken > 0, JSON.stringify(g.tellers));
    const tr = trechter({ totalen: g.totalen, tellers: g.tellers }, null);
    check("de trechter toont de conversies van de maanden", tr.stappen[2].waarde === verwacht.conversions && tr.nietGelopen === null);
    const pk = v.perKanaal.find((x) => x.kanaal === "google")!;
    check("de vergelijking zegt niet meer dat Google pas in mei 2026 begon", !pk.uitleg?.includes("liep pas vanaf"), String(pk.uitleg));
    check("en geeft geen percentage tegen een ongelijke kant (hele maanden tegen dagen)",
      pk.gepaard === null && v.ongepaard.includes("google") && !!pk.uitleg?.includes("hele maand"), String(pk.uitleg));
    check("de kaart zegt per maand", kaartDagRegel(g, pk, true)?.fijnheid === "per maand");
  }

  console.log("F1: over de eerste weekrij heen: maanden en dan weken");
  {
    const p = { start: "2026-04-20", eind: "2026-06-14" };
    const g = telDagPeriode(p, { google, convConfig }).perKanaal[0];
    const m = slicePeriod(maanden, { start: "2026-04", end: "2026-05" }).totals;
    const w = weken.filter((x) => x.week_start === "2026-06-01" || x.week_start === "2026-06-08");
    const wSom = w.reduce((s, x) => s + Number(x.conversions ?? 0), 0);
    check("april en mei per maand, juni per week", g.fijnheid === "week+maand" && w.length === 2 && Math.abs(g.totalen.conversions - (m.conversions + wSom)) < 1e-9,
      `${g.totalen.conversions} tegen ${m.conversions} + ${wSom}`);
    check("een halve april telt als hele maand: niet exact", g.exact === false && !!g.venster?.startsWith("1 t/m 14 jun 2026 per week; apr–mei 2026 per maand"), String(g.venster));
    check("de kaart zegt per week en maand", kaartDagRegel(g, null, false)?.fijnheid === "per week en maand");

    // Een eerste weekrij midden in juli: augustus begint op een zaterdag; die twee dagen vallen in een
    // week die in juli begint (al in de julirij) en tellen niet, en dat staat erbij.
    const laat = weken.filter((x) => x.week_start >= "2026-07-13");
    const g2 = telDagPeriode({ start: "2026-07-01", eind: "2026-08-16" }, { google: { ...google, weken: laat }, convConfig }).perKanaal[0];
    check("de dagen tussen de maand en de eerste maandag tellen niet, en dat staat erbij",
      g2.exact === false && !!g2.uitleg?.includes("1 t/m 2 aug 2026 telt niet mee") && g2.eenheden.includes("2026-08-03") && !g2.eenheden.includes("2026-07-27"), String(g2.uitleg));
  }

  console.log("F1: na de eerste weekrij per week, met het begin uit de maanden");
  {
    const g = telDagPeriode({ start: "2026-06-03", eind: "2026-06-20" }, { google, convConfig }).perKanaal[0];
    check("per week, zoals voorheen", g.fijnheid === "week" && g.venster === undefined);
    check("het begin van Google is het vroegste van week- en maanddata", g.bronStart !== null && g.bronStart < eersteWeek, String(g.bronStart));
  }

  console.log("F1: Na de klik krijgt de klikken over dezelfde maanden");
  {
    const leeg: GeldendeTrechter = { sjabloon: "eigen", stappen: [], eigen: true, googlePosities: [] } as unknown as GeldendeTrechter;
    const perMaand = new Map([["2025-11", { clicks: 100 }], ["2025-12", { clicks: 50 }], ["2026-01", { clicks: 7 }]]);
    const s = telKanaalStappen("google", { start: "2025-11-21", eind: "2025-12-01" }, leeg,
      { google: { dag: null, maand: [{ date: "2025-11-01", purchases: 3 }, { date: "2025-12-01", purchases: 4 }] } }, null, perMaand);
    check("per maand geteld, met de klikken van nov en dec", s.fijnheid === "maand" && s.klikken === 150, `${s.fijnheid} ${s.klikken}`);
  }

  console.log("F3: een kanaal dat in de periode nog niet liep");
  {
    const meta = (rijen.meta_account_daily ?? []).filter((r) => String(r.date) >= "2026-06-07");
    const p = { start: "2025-11-21", eind: "2025-12-01" };
    const t = telDagPeriode(p, { dagkanalen: { meta }, convConfig }).perKanaal[0];
    const regel = nogNietGelopen(t);
    check("een regel met de eerste dag met data", regel === "Meta liep in deze periode nog niet; eerste dag met data: 7 jun 2026.", String(regel));
    const tr = trechter({ totalen: t.totalen, tellers: t.tellers, nietGelopen: regel }, null);
    check("de trechter toont die regel, geen opmerkingen over nullen", tr.nietGelopen === regel && tr.opmerkingen.length === 0, JSON.stringify(tr.opmerkingen));

    // Wel gelopen, maar nul: rijen met nullen in de periode, de eerste uitgave later.
    const nul = [{ date: "2025-11-25", impressions: 0, link_clicks: 0, spend: 0, conversions: 0, conversion_value: 0 }, ...meta];
    const t0 = telDagPeriode(p, { dagkanalen: { meta: nul }, convConfig }).perKanaal[0];
    check("een kanaal dat liep met nul toont de nullen", nogNietGelopen(t0) === null && trechter({ totalen: t0.totalen, tellers: t0.tellers, nietGelopen: nogNietGelopen(t0) }, null).nietGelopen === null);
    check("een kanaal met data in de periode krijgt geen regel",
      nogNietGelopen(telDagPeriode({ start: "2026-07-01", eind: "2026-07-10" }, { dagkanalen: { meta }, convConfig }).perKanaal[0]) === null);

    const g = telDagPeriode({ start: "2024-09-01", eind: "2024-09-30" }, { google, convConfig }).perKanaal[0];
    check("Google vóór zijn eerste maand: ook een regel", nogNietGelopen(g)?.startsWith("Google Ads liep in deze periode nog niet; eerste dag met data: 1 nov 2024") === true, String(nogNietGelopen(g)));

    const bron = alsBronReeks("meta", kanaalStandUitDagen("", meta, "meta", convConfig).data);
    const mr = nietGelopenInMaanden("meta", bron, { start: "2025-11", end: "2025-12" });
    check("over hele maanden dezelfde regel, met de eerste maand", !!mr?.startsWith("Meta liep in deze periode nog niet; eerste maand met data:") && mr.includes("2026"), String(mr));
    check("over hele maanden waarin het liep geen regel", nietGelopenInMaanden("meta", bron, { start: "2026-06", end: "2026-07" }) === null);
  }

  console.log("Herstel 1: de regel in de periodekiezer zegt hetzelfde als de kerncijfers");
  {
    const p = { start: "2025-11-21", eind: "2025-12-01" };
    const eerste = eersteWeekRij(weken);
    check("de eerste weekrij uit dezelfde regel als de telling", eerste === eersteWeek, String(eerste));
    const noot = googleWeekNoot(p, ["google", "meta"], null, { eersteWeek: eerste, heeftMaanden: true });
    const g = telDagPeriode(p, { google, convConfig }).perKanaal[0];
    check("vóór de eerste weekrij: per maand, niet weekniveau",
      !!noot?.includes("per maand") && !noot.includes("weekniveau") && !!g.venster && noot.includes(g.venster), String(noot));
    const zonder = googleWeekNoot(p, ["google"], null, { eersteWeek: "2026-05-11", heeftMaanden: true });
    check("met eerste weekrij 11 mei 2026: per maand", !!zonder?.includes("per maand") && !zonder.includes("weekniveau"), String(zonder));
    const na = googleWeekNoot({ start: "2026-06-03", eind: "2026-06-20" }, ["google"], null, { eersteWeek, heeftMaanden: true });
    check("na de eerste weekrij: weekniveau, zoals de telling", !!na?.startsWith("Google telt op weekniveau"), String(na));
    const geenMaanden = googleWeekNoot(p, ["google"], null, { eersteWeek, heeftMaanden: false });
    check("zonder maanddata geen terugval: weekniveau", !!geenMaanden?.startsWith("Google telt op weekniveau"), String(geenMaanden));
  }

  console.log("Herstel 2: Google met nulrijen in de periode liep wel");
  {
    const nulWeek = (ws: string): GoogleWeekRij => ({ week_start: ws, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 });
    const actiefWeek: GoogleWeekRij = { week_start: "2026-05-25", impressions: 100, clicks: 5, cost: 10, conversions: 1, conversions_value: 20 };
    const p = { start: "2026-05-12", eind: "2026-05-24" };
    const gw = telDagPeriode(p, { google: { maanden: null, weken: [nulWeek("2026-05-11"), nulWeek("2026-05-18"), actiefWeek], dagen: null }, convConfig }).perKanaal[0];
    check("nulweken in de periode: geen regel 'liep nog niet', de nullen staan er",
      gw.bronStart === "2026-05-25" && nogNietGelopen(gw) === null, String(nogNietGelopen(gw)));
    const gzonder = telDagPeriode(p, { google: { maanden: null, weken: [actiefWeek], dagen: null }, convConfig }).perKanaal[0];
    check("zonder enige weekrij in de periode wel de regel", !!nogNietGelopen(gzonder)?.startsWith("Google Ads liep in deze periode nog niet"), String(nogNietGelopen(gzonder)));

    const dag = (date: string, cost: number): GoogleDagRij => ({ date, impressions: 0, clicks: 0, cost, conversions: 0, conversions_value: 0 });
    const gd = telDagPeriode(p, { google: { maanden: null, weken: null, dagen: [dag("2026-05-15", 0), dag("2026-05-26", 10)] }, convConfig }).perKanaal[0];
    check("een nuldagrij in de periode: geen regel", gd.bronStart === "2026-05-26" && nogNietGelopen(gd) === null, String(nogNietGelopen(gd)));
    const gd0 = telDagPeriode(p, { google: { maanden: null, weken: null, dagen: [dag("2026-05-26", 10)] }, convConfig }).perKanaal[0];
    check("zonder dagrij in de periode wel de regel", !!nogNietGelopen(gd0), String(nogNietGelopen(gd0)));

    const nulMaand = { conversions: 0, revenue: 0, adSpend: 0 };
    const bron = { naam: "meta", maanden: new Map([["2025-11", nulMaand], ["2026-06", { conversions: 4, revenue: 40, adSpend: 30 }]]) };
    check("een expliciete nulmaand over hele maanden: geen regel", nietGelopenInMaanden("meta", bron, { start: "2025-11", end: "2025-12" }) === null);
    check("zonder maandrij in de periode wel", !!nietGelopenInMaanden("meta", bron, { start: "2025-09", end: "2025-10" }));
    // Google niet: zijn maandreeks is per jaar aangevuld met nulmaanden, dus een nulmaand zegt niets.
    const gBron = alsBronReeks("google", maanden);
    check("Google over hele maanden vóór zijn start: wel de regel, ondanks de aangevulde nulmaanden",
      gBron.maanden.has("2024-09") && !!nietGelopenInMaanden("google", gBron, { start: "2024-09", end: "2024-09" }));
  }

  console.log("Herstel 3: geen percentage tussen kanten die op een andere fijnheid tellen");
  {
    const v = telDagVergelijking({ start: "2026-06-15", eind: "2026-07-29" }, { start: "2026-05-01", eind: "2026-06-14" }, { google, dagkanalen: {}, convConfig });
    const pk = v.perKanaal.find((x) => x.kanaal === "google")!;
    check("per week tegen week+maand: buiten het percentage",
      v.huidig.perKanaal[0].fijnheid === "week" && v.vorig.perKanaal[0].fijnheid === "week+maand" && v.vorig.perKanaal[0].exact === true
      && pk.gepaard === null && v.ongepaard.includes("google") && !!pk.uitleg?.includes("verschillende bronnen"), String(pk.uitleg));
    const v2 = telDagVergelijking({ start: "2026-07-01", eind: "2026-07-30" }, { start: "2026-06-01", eind: "2026-06-30" }, { google, dagkanalen: {}, convConfig });
    const pk2 = v2.perKanaal.find((x) => x.kanaal === "google")!;
    check("weken tegen een hele maand: buiten het percentage", pk2.gepaard === null && !!pk2.uitleg?.includes("per maand"), String(pk2.uitleg));
    const v3 = telDagVergelijking({ start: "2026-07-06", eind: "2026-07-19" }, { start: "2026-06-22", eind: "2026-07-05" }, { google, dagkanalen: {}, convConfig });
    check("week tegen week blijft gepaard", v3.perKanaal[0].gepaard !== null, String(v3.perKanaal[0].uitleg));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
