// De campagnetabellen op Campagnes over de gekozen periode, per dag (nieuwe weergave).
// Draaien: tsx --tsconfig ./tsconfig.json lib/campagnes/__campagne_periode_test.ts
//
// Waarom hij er is. Op Campagnes volgden de kanaaltotalen de periodekiezer, maar de tabellen per
// campagne eronder hadden een vast venster (90 dagen; Google hele maanden sinds 90 dagen terug).
// Twee totalen voor hetzelfde kanaal op één pagina, over andere dagen, en de cijfercontrole kon ze
// niet naast elkaar leggen. Deze test legt vast:
//   1. een periode per dag telt per campagne op tot het kanaaltotaal van dezelfde periode (de
//      maandrijen waar de kanaaltotalen uit komen), ook met campagnes die niets kostten;
//   2. Google vóór de dagopslag valt terug op hele maanden, zonder dubbel te tellen, met het label
//      van splitsOpDagOpslag;
//   3. een campagne die alleen nu liep is "nieuw", alleen toen "gestopt", zonder percentage;
//   4. bij een ongelijke korrel (per dag tegen deels per maand) of een hele maand voor een halve
//      staat er geen percentage, met de reden;
//   5. de tabel draagt de merktekens voor de cijfercontrole, en de totaalrij is het kanaaltotaal;
//   6. de lading rekent een kleinere periode uit wat er al is (geen verzoek per wissel), en de
//      paginering telt een dag op de grens van twee pagina's heel;
//   7. met de schakelaar uit rendert "Wat er draait" en de kanaaltabel precies als in de basis;
//   9. de kanaalrij zoals de kanaaltotalen hem per dag tellen (kanaalTotalenUitDagTelling op de
//      telling van de kerncijfers) is de totaalrij van de campagnetabel, ook midden in een maand,
//      en Google over hele maanden telt uit de maandrijen, zoals het kanaaltotaal;
//  10. een vergelijking met een periode van vóór de eerste campagnerij geeft geen percentage en
//      geen "nieuw" of "gestopt" (Microsoft met 21 dagen, LinkedIn zonder één rij), en de lading
//      leest die eerste dag voor elk kanaal;
//  11. met een beurs dragen de totaalrijen geen merkteken;
//  12. de Google-tabel op het tabblad Google volgt de periode met dezelfde merktekens, en is met de
//      schakelaar uit byte voor byte de basis.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  liep, telCampagnes, vergelijkCampagnes, ongelijkeKorrel, formatCampagneVerandering,
  type CampagneRij, type CampagneBron,
} from "./campagne-periode";
import {
  allePaginas, CAMPAGNE_DAGTABEL, campagneDagkolommen, campagneRijenUit, laadMetCache, vergeetCampagneCache,
  type Lees, type KanaalLading,
} from "./use-campagne-periode";
import { splitsOpDagOpslag } from "../period/dag-opslag";
import { addDays } from "../reporting-date";
import { kanaalMaandenUitDagen } from "../analysis/channel-report-blend";
import { resolveChannelConversionConfig } from "../analysis/channel-conversion-config";
import { bouwPeriodeBlokken, CampagneTabellenPeriode, CampaignsPerChannel } from "../../components/dashboard/campaigns-per-channel";
import { ChannelCampaignTable } from "../../components/dashboard/channel-campaign-table";
import { CampaignTable, CampagneTabelGoogle, campagnesMetStructuur } from "../../components/dashboard/campaign-table";
import { telDagPeriode } from "../period/dag-telling";
import { kanaalTotalenUitDagTelling } from "../cross-channel/kanaal-maandrijen";
import { laadKanaal } from "./use-campagne-periode";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const dicht = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Alle dagen van `van` t/m `tot`. */
function dagen(van: string, tot: string): string[] {
  const uit: string[] = [];
  for (let d = van; d <= tot; d = addDays(d, 1)) uit.push(d);
  return uit;
}

// ── 1. Per dag telt op tot het kanaaltotaal ───────────────────────────────────────────────────
console.log("1. Een periode per dag telt per campagne op tot het kanaaltotaal");
{
  // Meta: drie campagnes, een met alleen vertoningen. De klant telt alleen leads.
  const cfg = resolveChannelConversionConfig({ meta_ads: ["leads"] });
  const ruw: Record<string, unknown>[] = [];
  for (const d of dagen("2026-01-01", "2026-06-30")) {
    const dag = Number(d.slice(8, 10));
    ruw.push({ date: d, entity_id: "m1", impressions: 100, link_clicks: 5, spend: 10 + dag, conversions: 3, leads: dag % 3 });
    ruw.push({ date: d, entity_id: "m2", impressions: 50, link_clicks: 2, spend: 4, conversions: 1, leads: 1 });
    ruw.push({ date: d, entity_id: "m3", impressions: 20, link_clicks: 0, spend: 0, conversions: 0, leads: 0 });
  }
  const lading: KanaalLading = {
    kanaal: "meta", span: { start: "2026-01-01", eind: "2026-06-30" }, dagen: ruw, maanden: [], eersteDag: null, bronStart: "2026-01-01",
    namen: new Map([["m1", "GRT | Leads"], ["m2", "GRA | Retarget"], ["m3", "Alleen bereik"]]),
  };
  const { dagen: rijen } = campagneRijenUit(lading, cfg);
  const p = { start: "2026-02-01", eind: "2026-04-30" };
  const nu = telCampagnes(p, { kanaal: "meta", dagen: rijen });
  // Het kanaaltotaal zoals de kanaaltotalen het tellen: de dagrijen per maand, met de selectie.
  const accountDagen = dagen("2026-01-01", "2026-06-30").map((d) => {
    const vanDag = ruw.filter((r) => r.date === d);
    const som = (f: string) => vanDag.reduce((s, r) => s + Number(r[f] ?? 0), 0);
    return { date: d, impressions: som("impressions"), link_clicks: som("link_clicks"), spend: som("spend"), conversions: som("conversions"), leads: som("leads"), conversion_value: 0 };
  });
  const maanden = kanaalMaandenUitDagen(accountDagen, "meta_ads", cfg).filter((m) => m.month >= "2026-02" && m.month <= "2026-04-31");
  const kanaalKosten = maanden.reduce((s, m) => s + m.cost, 0);
  const kanaalConv = maanden.reduce((s, m) => s + m.conversions, 0);
  check("drie maanden kanaaltotaal", maanden.length === 3, String(maanden.length));
  check("kosten: de campagnes tellen op tot het kanaal", dicht(nu.totaal.spend, kanaalKosten), `${nu.totaal.spend} tegen ${kanaalKosten}`);
  check("conversies met de selectie van de klant (alleen leads)", dicht(nu.totaal.conversions, kanaalConv), `${nu.totaal.conversions} tegen ${kanaalConv}`);
  check("en niet met de standaardselectie (conversies + leads)", !dicht(nu.totaal.conversions, kanaalConv + 89 * 4));
  check("de campagne met alleen vertoningen telt in de totalen, niet als regel",
    nu.campagnes.some((c) => c.sleutel === "m3") && !vergelijkCampagnes(nu, null).regels.some((r) => r.sleutel === "m3"));
  check("vertoningen van die campagne tellen mee in het totaal", nu.totaal.impressions === 170 * 89, String(nu.totaal.impressions));
  check("per dag geteld, exact, zonder label", nu.korrel === "dag" && nu.exact && nu.label === null);
  // Een losse dagperiode: precies die dagen.
  const kort = telCampagnes({ start: "2026-03-10", eind: "2026-03-12" }, { kanaal: "meta", dagen: rijen });
  check("10 t/m 12 maart: drie dagen", dicht(kort.totaal.spend, (20 + 21 + 22) + 3 * 4), String(kort.totaal.spend));

  // De tabel: de totaalrij is het kanaaltotaal, gemerkt per kanaal.
  const blokken = bouwPeriodeBlokken({ meta: { dagen: rijen, maanden: [], eersteDag: null, bronStart: "2026-01-01" } }, p, null, { telt: () => "Leads" });
  const html = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken }));
  const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const fmt1 = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(v);
  check("merkteken kosten met data-kanaal, waarde = kanaaltotaal",
    html.includes(`<span data-cijfer="campagnes-totaal-kosten" data-kanaal="meta">${eur(kanaalKosten)}</span>`), html.slice(html.indexOf("<tfoot"), html.indexOf("</tfoot>")));
  check("merkteken conversies met data-kanaal, waarde = kanaaltotaal",
    html.includes(`<span data-cijfer="campagnes-totaal-conversies" data-kanaal="meta">${fmt1(kanaalConv)}</span>`));
  check("het venster: volgt periode per dag", /data-venster="periode"/.test(html));
  check("zonder vergelijking geen kolom Verandering", !/Verandering/.test(html));
  check("de kop van de tabel heet het kanaal, en de sectie is ermee gelabeld", /<section aria-labelledby="campagnes-meta"/.test(html) && /<h3 id="campagnes-meta"/.test(html));
}

// ── 2. Google: terugval op hele maanden vóór de dagopslag, met label ─────────────────────────
console.log("2. Google vóór de dagopslag: hele maanden, niet dubbel, met het label");
{
  const eersteDag = "2026-03-15";
  const dagrijen: CampagneRij[] = dagen(eersteDag, "2026-04-30").map((d) => ({
    sleutel: "g1", naam: "GRT | Search", date: d, spend: 10, conversions: 1, impressions: 100, clicks: 4,
  }));
  // Maandrijen: januari t/m april, elke maand de hele maand (maart dus OOK de dagen vanaf de 15e).
  const maandrijen: CampagneRij[] = ["2026-01", "2026-02", "2026-03", "2026-04"].map((m) => ({
    sleutel: "g1", naam: "GRT | Search", date: `${m}-01`, spend: 300, conversions: 30, impressions: 3000, clicks: 120,
  }));
  const bron: CampagneBron = { kanaal: "google", dagen: dagrijen, maanden: maandrijen, eersteDag, bronStart: "2026-01-01" };
  // Tot en met 29 april: geen hele maanden, dus de dagopslag met de terugval ervoor.
  const p = { start: "2026-01-01", eind: "2026-04-29" };
  const t = telCampagnes(p, bron);
  const split = splitsOpDagOpslag(p, eersteDag);
  check("het label is dat van splitsOpDagOpslag", t.label === split.label && !!t.label, String(t.label));
  check("het label noemt de maanden en de dagopslag", /per maand, voor de dagopslag begon/.test(t.label ?? ""), String(t.label));
  check("jan-mrt per maand (900), 1 t/m 29 april per dag (290): maart niet dubbel", t.totaal.spend === 900 + 290, String(t.totaal.spend));
  check("korrel dag+maand, exact (hele maanden vóór de dagopslag)", t.korrel === "dag+maand" && t.exact);
  // Precies hele maanden: uit de maandrijen, zoals het kanaaltotaal (zie 9).
  const heel = telCampagnes({ start: "2026-01-01", eind: "2026-04-30" }, bron);
  check("jan t/m apr als hele maanden: de maandrijen (4 x 300), geen label", heel.totaal.spend === 1200 && heel.korrel === "maand" && heel.exact && heel.label === null, `${heel.totaal.spend} ${heel.korrel}`);
  const half = telCampagnes({ start: "2026-01-10", eind: "2026-04-30" }, bron);
  check("begint de periode midden in een maand vóór de dagopslag: niet exact", !half.exact && half.korrel === "dag+maand");
  const binnen = telCampagnes({ start: "2026-03-20", eind: "2026-04-10" }, bron);
  check("een periode in de dagopslag: per dag, geen label", binnen.korrel === "dag" && binnen.label === null && binnen.totaal.spend === 22 * 10, String(binnen.totaal.spend));
  const zonder = telCampagnes({ start: "2026-01-01", eind: "2026-02-27" }, { ...bron, eersteDag: null, dagen: [] });
  check("zonder dagopslag: alles per maand, met label", zonder.korrel === "maand" && /er is nog geen dagopslag/.test(zonder.label ?? "") && zonder.totaal.spend === 600 && !zonder.exact);

  // Het label staat zichtbaar in de tabel (een title alleen ziet niemand op een telefoon).
  const blokken = bouwPeriodeBlokken({ google: { dagen: dagrijen, maanden: maandrijen, eersteDag, bronStart: "2026-01-01" } }, p, null);
  const html = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken }));
  check("het venster voluit, zichtbaar", html.includes(`Google Ads: ${t.label}.`), html.slice(0, 600));
  check("en in het vensterlabel als toevoeging", /deels per maand/.test(html));
}

// ── 3. Nieuw en gestopt ──────────────────────────────────────────────────────────────────────
console.log("3. Een campagne die alleen nu of alleen toen liep: nieuw of gestopt, geen percentage");
{
  const rij = (sleutel: string, date: string, spend: number, conversions = 1): CampagneRij =>
    ({ sleutel, naam: sleutel.toUpperCase(), date, spend, conversions, impressions: 10, clicks: 1 });
  const rijen = [
    rij("blijft", "2025-11-05", 100, 4), rij("blijft", "2026-11-05", 150, 6),
    rij("nieuw", "2026-11-06", 80),
    rij("gestopt", "2025-11-07", 60),
    // Nu alleen een nulrij: liep niet, dus gestopt.
    rij("stil", "2025-11-08", 30), rij("stil", "2026-11-08", 0, 0),
  ];
  const nu = telCampagnes({ start: "2026-11-01", eind: "2026-11-10" }, { kanaal: "meta", dagen: rijen, bronStart: "2025-11-01" });
  const toen = telCampagnes({ start: "2025-11-01", eind: "2025-11-10" }, { kanaal: "meta", dagen: rijen, bronStart: "2025-11-01" });
  const v = vergelijkCampagnes(nu, toen);
  const r = (s: string) => v.regels.find((x) => x.sleutel === s);
  check("blijft: beide, +50% kosten, +50% conversies",
    r("blijft")?.status === "beide" && dicht(r("blijft")?.kosten?.pct ?? NaN, 0.5) && dicht(r("blijft")?.conversies?.pct ?? NaN, 0.5));
  check("nieuw: status nieuw, geen percentage", r("nieuw")?.status === "nieuw" && r("nieuw")?.kosten === null);
  check("gestopt: staat er, met nul kosten", r("gestopt")?.status === "gestopt" && r("gestopt")?.spend === 0);
  check("een nulrij nu is niet lopen: gestopt", r("stil")?.status === "gestopt");
  check("het totaal blijft dat van nu (gestopte campagnes tellen nul)", nu.totaal.spend === 150 + 80);
  check("geen reden op tabelniveau bij gelijke korrel", v.reden === null);
  check("liep: alleen vertoningen is niet lopen", !liep({ spend: 0, conversions: 0, impressions: 50, clicks: 3 }));
  // Nul in de vergelijkingsperiode: geen percentage, met reden.
  const nulToen = vergelijkCampagnes(
    telCampagnes({ start: "2026-11-01", eind: "2026-11-10" }, { kanaal: "meta", dagen: [rij("x", "2026-11-02", 10, 2)] }),
    telCampagnes({ start: "2025-11-01", eind: "2025-11-10" }, { kanaal: "meta", dagen: [rij("x", "2025-11-02", 10, 0)] }),
  );
  check("conversies van nul naar twee: geen percentage, reden", nulToen.regels[0].conversies?.pct === null && /nul in de vergelijkingsperiode/.test(nulToen.regels[0].conversies?.reden ?? ""));
  check("formatCampagneVerandering: +50,0% en −12,5%", formatCampagneVerandering(0.5) === "+50,0%" && formatCampagneVerandering(-0.125) === "−12,5%");

  const blokken = bouwPeriodeBlokken({ meta: { dagen: rijen, maanden: [], eersteDag: null, bronStart: "2025-11-01" } },
    { start: "2026-11-01", eind: "2026-11-10" }, { start: "2025-11-01", eind: "2025-11-10" });
  const html = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken, vergelijkLabel: "Dezelfde datums vorig jaar" }));
  check("kolom Verandering t.o.v. de vergelijking", /Verandering/.test(html) && /t\.o\.v\. dezelfde datums vorig jaar/.test(html));
  check("nieuw en gestopt als label, met de reden voor een schermlezer",
    /data-campagne-status="nieuw"/.test(html) && /data-campagne-status="gestopt"/.test(html) && /liep in de vergelijkingsperiode niet, dus geen percentage/.test(html));
  check("de verandering van een campagne die bleef", html.includes("conv. +50,0%") && html.includes("kosten +50,0%"));
}

// ── 4. Ongelijke korrel: geen percentage, met de reden ───────────────────────────────────────
console.log("4. Per dag tegen deels per maand: geen percentage, met de reden");
{
  const eersteDag = "2025-12-01";
  const dag = (d: string, spend: number): CampagneRij => ({ sleutel: "g1", naam: "GRT | Search", date: d, spend, conversions: 2, impressions: 10, clicks: 1 });
  const bron: CampagneBron = {
    kanaal: "google",
    dagen: dagen(eersteDag, "2026-11-30").map((d) => dag(d, 10)),
    // Een maandrij voor november 2025 (vóór de dagopslag) en een voor november 2026 met een ander
    // getal dan de dertig dagrijen samen (300): twee syncmomenten, zoals op de demo.
    maanden: [
      { sleutel: "g1", naam: "GRT | Search", date: "2025-11-01", spend: 280, conversions: 50, impressions: 300, clicks: 30 },
      { sleutel: "g1", naam: "GRT | Search", date: "2026-11-01", spend: 297.5, conversions: 58, impressions: 300, clicks: 30 },
    ],
    eersteDag,
    bronStart: "2025-11-01",
  };
  // Nu: 20 t/m 30 nov 2026 per dag. Toen: dezelfde dagen vorig jaar, vóór de dagopslag: hele maand.
  const nu = telCampagnes({ start: "2026-11-20", eind: "2026-11-30" }, bron);
  const toen = telCampagnes({ start: "2025-11-20", eind: "2025-11-30" }, bron);
  check("nu per dag, toen per maand en niet exact", nu.korrel === "dag" && toen.korrel === "maand" && !toen.exact);
  const v = vergelijkCampagnes(nu, toen);
  check("de campagne liep in beide: beide, maar zonder percentage", v.regels[0].status === "beide" && v.regels[0].kosten?.pct === null && v.regels[0].conversies?.pct === null);
  check("de reden noemt de hele maanden", /hele maanden in plaats van de gevraagde dagen/.test(v.reden ?? ""), String(v.reden));
  // Hele maanden aan beide kanten: allebei uit de maandrijen, dus wel een percentage.
  const nuHeel = telCampagnes({ start: "2026-11-01", eind: "2026-11-30" }, bron);
  const toenHeel = telCampagnes({ start: "2025-11-01", eind: "2025-11-30" }, bron);
  check("hele maand tegen hele maand: beide per maand, exact, gelijke korrel", nuHeel.korrel === "maand" && toenHeel.korrel === "maand" && ongelijkeKorrel(nuHeel, toenHeel) === null);
  check("november 2026 als hele maand: de maandrij (297,5), niet de dagen (300)", nuHeel.totaal.spend === 297.5, String(nuHeel.totaal.spend));
  check("en dan een percentage: 297,5 tegen 280", dicht(vergelijkCampagnes(nuHeel, toenHeel).regels[0].kosten?.pct ?? NaN, 297.5 / 280 - 1));
  // Exact maar een andere korrel: een hele maand (per maand) tegen dertig dagen (per dag).
  const dertig = telCampagnes({ start: "2026-10-02", eind: "2026-10-31" }, bron);
  check("hele maand per maand tegen dertig dagen per dag: exact, andere korrel", nuHeel.exact && dertig.exact && /de ene periode telt per maand, de andere per dag/.test(ongelijkeKorrel(nuHeel, dertig) ?? ""), String(ongelijkeKorrel(nuHeel, dertig)));
  check("dan ook geen percentage", vergelijkCampagnes(nuHeel, dertig).regels[0].kosten?.pct === null);
  // Gelijke korrel (beide per dag) geeft wel een percentage.
  const p1 = telCampagnes({ start: "2026-10-05", eind: "2026-10-25" }, bron);
  const p0 = telCampagnes({ start: "2026-09-05", eind: "2026-09-25" }, bron);
  check("per dag tegen per dag: wel een percentage", p1.korrel === "dag" && p0.korrel === "dag" && vergelijkCampagnes(p1, p0).regels[0].kosten?.pct !== null);

  const blokken = bouwPeriodeBlokken({ google: { dagen: bron.dagen as CampagneRij[], maanden: bron.maanden as CampagneRij[], eersteDag, bronStart: "2025-11-01" } },
    { start: "2026-11-20", eind: "2026-11-30" }, { start: "2025-11-20", eind: "2025-11-30" });
  const html = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken, vergelijkLabel: "Dezelfde datums vorig jaar" }));
  check("de reden staat zichtbaar boven de tabel", /Geen verandering per campagne: in een van beide periodes telde Google hele maanden/.test(html));
  check("de cel zegt het voor een schermlezer", /<span class="sr-only">conv\.: geen percentage, andere korrel in de vergelijkingsperiode<\/span>/.test(html));
}

// ── 5. Een beurs filtert vóór het tellen ─────────────────────────────────────────────────────
console.log("5. Een beurs: alleen haar campagnes, en het totaal van die campagnes");
{
  const rijen: CampagneRij[] = [
    { sleutel: "a", naam: "GRA | Search | US", date: "2026-10-02", spend: 100, conversions: 2, impressions: 10, clicks: 1 },
    { sleutel: "b", naam: "Zomaar iets", date: "2026-10-02", spend: 50, conversions: 1, impressions: 10, clicks: 1 },
  ];
  const zonder = bouwPeriodeBlokken({ google: { dagen: rijen, maanden: [], eersteDag: "2026-01-01", bronStart: "2026-01-01" } }, { start: "2026-10-01", eind: "2026-10-30" }, null);
  check("zonder beurs: beide", zonder[0]?.nu.totaal.spend === 150);
  const met = bouwPeriodeBlokken({ google: { dagen: rijen, maanden: [], eersteDag: "2026-01-01", bronStart: "2026-01-01" } }, { start: "2026-10-01", eind: "2026-10-30" }, null, { geoClone: "GRA" });
  check("met beurs GRA: alleen die campagne", met[0]?.nu.totaal.spend === 100 && met[0]?.vergelijking.regels.length === 1, JSON.stringify(met[0]?.nu.totaal));
  // 11. Met een beurs is de totaalrij die van de beurs, niet van het kanaal: geen merkteken, anders
  // meldt de cijfercontrole een verschil met de kanaalrij dat er per ontwerp is.
  const metHtml = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken: met, geoClone: "GRA" }));
  const zonderHtml = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken: zonder }));
  check("met beurs: geen campagnes-totaal-merkteken, wel het bedrag", !/data-cijfer="campagnes-totaal-/.test(metHtml) && /€\s?100/.test(metHtml.slice(metHtml.indexOf("<tfoot"))));
  check("zonder beurs: wel de merktekens", /data-cijfer="campagnes-totaal-kosten" data-kanaal="google"/.test(zonderHtml));
}

// ── 6. Laden: geen verzoek per wissel, en de grens van een pagina ────────────────────────────
console.log("6. De lading: een kleinere periode kost geen verzoek, en een grensdag telt heel");
const lading = (async () => {
  vergeetCampagneCache();
  // Een nep-database: 25 campagnes per dag, 60 dagen = 1500 rijen, meer dan een pagina.
  const tabel: Record<string, unknown>[] = [];
  for (const d of dagen("2026-08-01", "2026-09-29")) for (let i = 0; i < 25; i++) tabel.push({ date: d, entity_id: `c${i}`, spend: 1, impressions: 1, link_clicks: 0, conversions: 1, leads: 0 });
  let verzoeken = 0;
  const lees: Lees = async (t, o) => {
    verzoeken += 1;
    if (t === "meta_campaigns") return { data: [], error: null };
    const van = String(o.filters?.find((f) => f.op === "gte" && "value" in f)?.["value" as never] ?? "");
    const tot = String(o.filters?.find((f) => f.op === "lte" && "value" in f)?.["value" as never] ?? "");
    const rijen = tabel.filter((r) => String(r.date) >= van && String(r.date) <= tot)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { data: rijen.slice(0, o.limit ?? rijen.length), error: null };
  };
  const alle = await allePaginas(lees, "meta_campaign_daily", "x", "k", "date", "2026-08-01", "2026-09-29");
  check("alle 1500 rijen, geen dubbele en geen ontbrekende", alle.length === 1500, String(alle.length));
  const perDag = new Map<string, number>();
  for (const r of alle) perDag.set(String(r.date), (perDag.get(String(r.date)) ?? 0) + 1);
  check("elke dag precies 25 rijen (ook de dag op de paginagrens)", [...perDag.values()].every((n) => n === 25) && perDag.size === 60);

  verzoeken = 0;
  await laadMetCache("k", "meta", { start: "2026-08-01", eind: "2026-09-29" }, lees);
  const eerste = verzoeken;
  check("de eerste lading vraagt de database", eerste > 0, String(eerste));
  await laadMetCache("k", "meta", { start: "2026-09-01", eind: "2026-09-15" }, lees);
  check("een kleinere periode daarbinnen: geen enkel verzoek", verzoeken === eerste, `${verzoeken - eerste} extra`);
  await laadMetCache("k", "meta", { start: "2026-07-01", eind: "2026-09-29" }, lees);
  check("een periode die erbuiten valt: wel een nieuwe lading", verzoeken > eerste);
  const na = verzoeken;
  await laadMetCache("k", "meta", { start: "2026-08-01", eind: "2026-09-29" }, lees);
  check("terug naar de eerste periode: geen verzoek (de omhullende is geladen)", verzoeken === na);
  vergeetCampagneCache();

  // 10. De lading leest per kanaal waar de campagnerijen beginnen, over ALLE rijen.
  const gevraagd: { t: string; asc: boolean | undefined; limit: number | undefined }[] = [];
  const lees2: Lees = async (t, o) => {
    gevraagd.push({ t, asc: o.order?.ascending, limit: o.limit });
    if (t === "microsoft_campaigns") return { data: [], error: null };
    if (o.order?.ascending === true) return { data: [{ date: "2025-10-11" }], error: null };
    return { data: [], error: null };
  };
  const ms = await laadKanaal("k", "microsoft", { start: "2026-01-01", eind: "2026-03-31" }, lees2);
  check("Microsoft: de eerste dag van microsoft_campaign_daily (oud naar nieuw, een rij)",
    ms.bronStart === "2025-10-11" && gevraagd.some((g) => g.t === "microsoft_campaign_daily" && g.asc === true && g.limit === 1), JSON.stringify(gevraagd));
  const lees3: Lees = async (t, o) => {
    if (o.order?.ascending === true) return { data: t === "ads_campaign_monthly" ? [{ month: "2024-12-01" }] : [{ date: "2025-03-01" }], error: null };
    return { data: [], error: null };
  };
  const gl = await laadKanaal("k", "google", { start: "2026-01-01", eind: "2026-03-31" }, lees3);
  check("Google: de vroegste van de eerste maandrij en de eerste dagrij", gl.bronStart === "2024-12-01" && gl.eersteDag === "2025-03-01", `${gl.bronStart} ${gl.eersteDag}`);
})();

// ── 7. Schakelaar uit: byte voor byte de basis ───────────────────────────────────────────────
console.log("7. Schakelaar uit: de vertrouwde tabellen zoals in de basis (de39600)");
{
  // De romp van de vertrouwde functie: tekst na de kopregel t/m de eerste "}" op een eigen regel.
  // De vingerafdrukken zijn die van CampaignsPerChannel en ChannelCampaignTable in de basis.
  const romp = (bestand: string, kop: string) => {
    const bron = readFileSync(join(process.cwd(), bestand), "utf8");
    const i = bron.indexOf(kop);
    if (i < 0) return "";
    const start = bron.indexOf("\n", i) + 1;
    return bron.slice(start, bron.indexOf("\n}\n", start));
  };
  const vinger = (s: string) => createHash("sha256").update(s).digest("hex");
  check("CampaignsVastVenster is de romp van de basis",
    vinger(romp("components/dashboard/campaigns-per-channel.tsx", "function CampaignsVastVenster(")) === "13b01c2b868b1b4ef39245e56aaf5f42bb3760f9465561fe189d18ecd8d4935c");
  check("ChannelCampaignTableVast is de romp van de basis",
    vinger(romp("components/dashboard/channel-campaign-table.tsx", "function ChannelCampaignTableVast(")) === "32c19305930364f0eb6538dc42a493b70cc41649862d875a146c9c2002e799be");
  // En de render (react-dom/server, dus vóór de data: het laadvlak). De vingerafdrukken zijn met
  // dezelfde aanroep op de basisversie van beide bestanden gemaakt.
  for (const [naam, el, basis] of [
    ["CampaignsPerChannel zonder nieuw", createElement(CampaignsPerChannel, { clientId: "k" }), "454a9991744fc02bdee890eccef096889bcc0de66437ff3a44d1c80975d12ab6"],
    ["CampaignsPerChannel nieuw={false}", createElement(CampaignsPerChannel, { clientId: "k", nieuw: false }), "454a9991744fc02bdee890eccef096889bcc0de66437ff3a44d1c80975d12ab6"],
    ["ChannelCampaignTable zonder nieuw", createElement(ChannelCampaignTable, { clientId: "k", channel: "meta" }), "4a90927ce3a1310cff900f83188e9f86cc18be80da28676e1ddb80a57975c113"],
  ] as const) {
    const html = renderToStaticMarkup(el);
    check(`${naam}: byte voor byte de basis`, vinger(html) === basis, vinger(html));
  }
  // 12. De Google-tabel: met de schakelaar uit de romp en de render van de basis (CampaignTable in
  // de39600; met dezelfde aanroep op het basisbestand gemaakt).
  check("CampaignTableVast is de romp van CampaignTable in de basis",
    vinger(romp("components/dashboard/campaign-table.tsx", "function CampaignTableVast(")) === "1aa4cf1dfe30a7cc8abc83288db8d597e13ffec4fd21d5d51a34d0d5c3a81e9b");
  for (const [naam, el] of [
    ["CampaignTable zonder nieuw", createElement(CampaignTable, { clientId: "k" })],
    ["CampaignTable nieuw={false}", createElement(CampaignTable, { clientId: "k", nieuw: false })],
  ] as const) {
    const html = renderToStaticMarkup(el);
    check(`${naam}: byte voor byte de basis`, vinger(html) === "90b358e1fff5a667fbc20f6d5b8aa245c56a84ba0ae6de0166aca622f9be27d0", vinger(html));
  }
  // De kanaaltotalen: de merktekens per kanaal alleen op Campagnes (alleenTabel); op het Overzicht
  // blijft de cel zoals hij was.
  const cross = readFileSync(join(process.cwd(), "components/dashboard/cross-channel-view.tsx"), "utf8");
  const merken = cross.match(/data-cijfer="kanaalrij-[a-z]+"/g) ?? [];
  check("twee kanaalrij-merktekens, elk alleen achter alleenTabel",
    merken.length === 2 && (cross.match(/alleenTabel \? <span data-cijfer="kanaalrij-/g) ?? []).length === 2);
}

// ── 8. De kolommen bestaan ───────────────────────────────────────────────────────────────────
// check-datagrond.mjs kan een select uit een functie niet lezen: hier tegen de schema-snapshot.
console.log("8. De selects op de campagnetabellen noemen bestaande kolommen");
{
  const snap = JSON.parse(readFileSync(join(process.cwd(), "scripts/schema-snapshot.json"), "utf8")) as Record<string, string[]>;
  for (const k of ["meta", "linkedin", "microsoft"] as const) {
    const t = CAMPAGNE_DAGTABEL[k].tabel;
    const mis = campagneDagkolommen(k).split(", ").filter((c) => !snap[t]?.includes(c));
    check(`${t}: alle kolommen bestaan`, mis.length === 0, mis.join(", "));
    const n = CAMPAGNE_DAGTABEL[k].namen;
    check(`${n}: id en naam bestaan`, [CAMPAGNE_DAGTABEL[k].id, "name"].every((c) => snap[n]?.includes(c)));
  }
  for (const [t, kolommen] of [["ads_campaign_daily", "date, campaign_id, campaign_name, impressions, clicks, cost, conversions"], ["ads_campaign_monthly", "month, campaign_id, campaign_name, impressions, clicks, cost, conversions"]] as const) {
    check(`${t}: alle kolommen bestaan`, kolommen.split(", ").every((c) => snap[t]?.includes(c)));
  }
}



// ── 9. De kanaalrij per dag is de totaalrij van de campagnetabel ─────────────────────────────
console.log("9. De kanaalrij zoals de kanaaltotalen hem tellen, naast de totaalrij: ook midden in een maand");
{
  // Meta: campagnerijen en accountrijen die bij elkaar horen (de accountrij is de som van de dag).
  const cfg = resolveChannelConversionConfig({ meta_ads: ["leads"] });
  const ruw: Record<string, unknown>[] = [];
  for (const d of dagen("2026-09-01", "2026-11-10")) {
    const dag = Number(d.slice(8, 10));
    ruw.push({ date: d, entity_id: "m1", impressions: 100, link_clicks: 5, spend: 10 + dag, conversions: 3, leads: dag % 4 });
    ruw.push({ date: d, entity_id: "m2", impressions: 40, link_clicks: 2, spend: 3, conversions: 1, leads: 1 });
  }
  const accountDagen = dagen("2026-09-01", "2026-11-10").map((d) => {
    const vanDag = ruw.filter((r) => r.date === d);
    const som = (f: string) => vanDag.reduce((s, r) => s + Number(r[f] ?? 0), 0);
    return { date: d, impressions: som("impressions"), link_clicks: som("link_clicks"), spend: som("spend"), conversions: som("conversions"), leads: som("leads"), conversion_value: 0 };
  });
  const lading: KanaalLading = {
    kanaal: "meta", span: { start: "2026-09-01", eind: "2026-11-10" }, dagen: ruw, maanden: [], eersteDag: null, bronStart: "2026-09-01",
    namen: new Map([["m1", "GRT | Leads"], ["m2", "GRA | Retarget"]]),
  };
  const { dagen: rijen } = campagneRijenUit(lading, cfg);
  // "Laatste 30 dagen" op 13 nov: 14 okt t/m 12 nov. Midden in twee maanden.
  const p = { start: "2026-10-14", eind: "2026-11-10" };
  const kanaalrij = kanaalTotalenUitDagTelling(telDagPeriode(p, { dagkanalen: { meta: accountDagen }, convConfig: cfg }).perKanaal);
  const meta = kanaalrij.find((k) => k.kanaal === "meta");
  const blokken = bouwPeriodeBlokken({ meta: { dagen: rijen, maanden: [], eersteDag: null, bronStart: "2026-09-01" } }, p, null);
  const tot = blokken[0]?.nu.totaal;
  check("de kanaalrij per dag: kosten gelijk aan de totaalrij", !!meta && !!tot && dicht(meta.spend, tot.spend), `${meta?.spend} tegen ${tot?.spend}`);
  check("de kanaalrij per dag: conversies (met de selectie) gelijk aan de totaalrij", !!meta && !!tot && dicht(meta.conversions, tot.conversions), `${meta?.conversions} tegen ${tot?.conversions}`);
  check("de klikken van de kanaalrij uit dezelfde dagen", meta?.clicks === 7 * 28, String(meta?.clicks));
  // De oude kanaalrij: de maandrijen van alle maanden die de periode raken. Die is hier groter, en
  // dat is precies het verschil dat deze ronde wegwerkt.
  const maanden = kanaalMaandenUitDagen(accountDagen, "meta_ads", cfg).filter((m) => m.month >= "2026-10" && m.month <= "2026-11");
  const oud = maanden.reduce((s, m) => s + m.cost, 0);
  check("(de maandrijen van okt+nov tellen meer dan de dagen: het verschil was echt)", oud > (tot?.spend ?? 0) + 50, `${oud} tegen ${tot?.spend}`);
  check("een kanaal dat niets deed staat niet in de kanaalrijen",
    kanaalTotalenUitDagTelling([{ kanaal: "linkedin", totalen: { conversions: 0, revenue: 0, adSpend: 0 }, tellers: { clicks: 0 }, uitleg: null }]).length === 0);

  // De kanaaltotalen op Campagnes gebruiken die telling bij een periode per dag. De component haalt
  // zijn data zelf op (useBlendedClientData, useDagTelling), dus hier de bron: per dag de telling,
  // en de merktekens per kanaal op dezelfde cellen.
  const cross = readFileSync(join(process.cwd(), "components/dashboard/cross-channel-view.tsx"), "utf8");
  check("CrossChannelView: per dag alleen op Campagnes, buiten de maandweg",
    /const perDag = alleenTabel && !!periode\.dag && !periode\.dag\.maandPad;/.test(cross));
  check("CrossChannelView: de kanaalrijen per dag uit kanaalTotalenUitDagTelling op de telling van de kerncijfers",
    /useDagTelling\(\{[\s\S]{0,120}staat: perDag \? periode\.dag : null/.test(cross) && /kanaalTotalenUitDagTelling\(t\.perKanaal\)/.test(cross));
  check("CrossChannelView: per dag geen tabel zolang de telling laadt (anders even de maandrijen met merkteken)",
    /const wachtOpDagen = perDag && dagTotalen === null;/.test(cross) && /!wachtOpDagen && \(dagTotalen \?\? rijenPeriode\)\.length > 0/.test(cross));
  const dash = readFileSync(join(process.cwd(), "components/dashboard/client-dashboard.tsx"), "utf8");
  check("client-dashboard geeft de Google-data mee aan de kanaaltotalen op Campagnes",
    /<CrossChannelView clientId=\{client\.id\} kanalen=\{kanalen \?\? \[\]\} alleenTabel googleData=\{clientData\.data\} \/>/.test(dash));
}

// ── 10. Een periode van vóór de eerste campagnerij ───────────────────────────────────────────
console.log("10. Vóór de eerste campagnerij: geen percentage, geen nieuw of gestopt, met de reden");
{
  const rij = (sleutel: string, date: string, spend: number): CampagneRij =>
    ({ sleutel, naam: sleutel.toUpperCase(), date, spend, conversions: 1, impressions: 10, clicks: 1 });
  // Microsoft: de campagnerijen beginnen op 11 okt 2025. Twaalf maanden tegen vorig jaar telde dan
  // 21 dagen tegen 365.
  const ms: CampagneRij[] = dagen("2025-10-11", "2026-10-31").map((d) => rij("ms1", d, 3));
  const bron: CampagneBron = { kanaal: "microsoft", dagen: ms, bronStart: "2025-10-11" };
  const nu = telCampagnes({ start: "2025-11-01", eind: "2026-10-31" }, bron);
  const toen = telCampagnes({ start: "2024-11-01", eind: "2025-10-31" }, bron);
  const v = vergelijkCampagnes(nu, toen);
  check("Microsoft: de campagne staat er, zonder percentage", v.regels.length === 1 && v.regels[0].kosten?.pct === null && v.regels[0].conversies?.pct === null, JSON.stringify(v.regels[0]?.kosten));
  check("Microsoft: geen status (niet nieuw, niet beide)", v.regels[0].status === null);
  check("Microsoft: de reden noemt de eerste dag", /geen campagnegegevens vóór 11 okt 2025/.test(v.reden ?? "") && /vergelijkingsperiode begint eerder/.test(v.reden ?? ""), String(v.reden));
  check("Microsoft: de cel noemt hem ook", v.regels[0].kosten?.reden === "geen campagnegegevens vóór 11 okt 2025");
  // Zonder bronStart (onbekend) zou dit +1.638% zijn: dat is wat er stond.
  const blind = vergelijkCampagnes(telCampagnes(nu.periode, { kanaal: "microsoft", dagen: ms }), telCampagnes(toen.periode, { kanaal: "microsoft", dagen: ms }));
  check("(zonder de start: een percentage van ruim +1.600%, de oneerlijke vergelijking)", (blind.regels[0].kosten?.pct ?? 0) > 16);

  // LinkedIn: geen enkele campagnerij in de vergelijkingsperiode.
  const li: CampagneRij[] = dagen("2026-07-13", "2026-10-31").map((d) => rij("li1", d, 5));
  const liNu = telCampagnes({ start: "2026-08-01", eind: "2026-10-31" }, { kanaal: "linkedin", dagen: li, bronStart: "2026-07-13" });
  const liToen = telCampagnes({ start: "2026-05-01", eind: "2026-07-31" }, { kanaal: "linkedin", dagen: li, bronStart: "2026-07-13" });
  const lv = vergelijkCampagnes(liNu, liToen);
  check("LinkedIn: niet 'nieuw', geen percentage", lv.regels[0].status === null && lv.regels[0].kosten?.pct === null);
  // Ook de vergelijkingsperiode helemaal vóór de eerste rij.
  const liVoor = vergelijkCampagnes(liNu, telCampagnes({ start: "2026-02-01", eind: "2026-04-30" }, { kanaal: "linkedin", dagen: li, bronStart: "2026-07-13" }));
  check("LinkedIn: vergelijkingsperiode helemaal ervoor ook niet 'nieuw'", liVoor.regels.every((r) => r.status === null));
  // Geen enkele rij in de bron: niets te vergelijken.
  const leeg = vergelijkCampagnes(telCampagnes({ start: "2026-08-01", eind: "2026-10-31" }, { kanaal: "linkedin", dagen: [], bronStart: null }),
    telCampagnes({ start: "2026-05-01", eind: "2026-07-31" }, { kanaal: "linkedin", dagen: [], bronStart: null }));
  check("zonder enige rij: geen regels, een reden", leeg.regels.length === 0 && /geen campagnegegevens/.test(leeg.reden ?? ""));
  // Allebei op of na de eerste rij: gewoon een vergelijking.
  const gedekt = vergelijkCampagnes(telCampagnes({ start: "2026-09-01", eind: "2026-10-31" }, { kanaal: "linkedin", dagen: li, bronStart: "2026-07-13" }),
    telCampagnes({ start: "2026-07-13", eind: "2026-08-31" }, { kanaal: "linkedin", dagen: li, bronStart: "2026-07-13" }));
  check("beide periodes gedekt: wel een percentage", gedekt.regels[0].status === "beide" && gedekt.regels[0].kosten?.pct !== null && gedekt.reden === null);

  // In de tabel: de reden boven de tabel, de cel voor een schermlezer, geen label nieuw.
  const blokken = bouwPeriodeBlokken({ linkedin: { dagen: li, maanden: [], eersteDag: null, bronStart: "2026-07-13" } },
    { start: "2026-08-01", eind: "2026-10-31" }, { start: "2026-05-01", eind: "2026-07-31" });
  const html = renderToStaticMarkup(createElement(CampagneTabellenPeriode, { blokken, vergelijkLabel: "De vorige periode" }));
  check("de tabel: de reden boven de tabel", /LinkedIn heeft geen campagnegegevens vóór 13 jul 2026/.test(html), html.slice(0, 400));
  check("de tabel: geen label nieuw", !/data-campagne-status=/.test(html));
  check("de tabel: de cel zegt het voor een schermlezer", /<span class="sr-only">kosten: geen percentage, geen campagnegegevens vóór 13 jul 2026<\/span>/.test(html));
}

// ── 12. De Google-tabel op het tabblad Google ────────────────────────────────────────────────
console.log("12. De Google-tabel: de periode per dag, de structuur erbij, dezelfde merktekens");
{
  const rij = (sleutel: string, naam: string, date: string, spend: number, conversions: number): CampagneRij =>
    ({ sleutel, naam, date, spend, conversions, impressions: 100, clicks: 5 });
  const dagrijen = [
    ...dagen("2026-10-05", "2026-10-25").map((d) => rij("111", "GRT | Search | NL", d, 20, 1)),
    ...dagen("2026-10-05", "2026-10-25").map((d) => rij("222", "Losse campagne", d, 5, 0)),
    rij("333", "Alleen vertoningen", "2026-10-06", 0, 0),
  ];
  const nu = telCampagnes({ start: "2026-10-05", eind: "2026-10-25" }, { kanaal: "google", dagen: dagrijen, maanden: [], eersteDag: "2026-01-01", bronStart: "2026-01-01" });
  const regels = vergelijkCampagnes(nu, null).regels;
  const structuur = [{
    id: "111", name: "GRT | Search | NL (oude naam)", type: "SEARCH", biddingStrategy: "TARGET_CPA", purpose: "brand", bucketLabel: null,
    adGroupCount: 3, assetGroupCount: 0, hasFeed: false, productGroupCount: 0, cost30d: 9999, conversions30d: 999, impressions30d: 99999,
  }];
  const campagnes = campagnesMetStructuur(regels, structuur);
  const g1 = campagnes.find((c) => c.regel.sleutel === "111");
  check("gekoppeld op het id, met de cijfers van de periode (niet de 30 dagen)", g1?.purpose === "brand" && g1.spend === 21 * 20 && g1.adGroupCount === 3, JSON.stringify(g1));
  check("een campagne buiten de structuur staat er ook", campagnes.some((c) => c.regel.sleutel === "222" && c.type === ""));
  const html = renderToStaticMarkup(createElement(CampagneTabelGoogle, { campagnes, nu, metVergelijking: false, reden: null, vergelijkLabel: "" }));
  const eur0 = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  check("de totaalrij is het kanaaltotaal, met het merkteken",
    html.includes(`<span data-cijfer="campagnes-totaal-kosten" data-kanaal="google">${eur0(nu.totaal.spend)}</span>`) && nu.totaal.spend === 21 * 25,
    html.slice(html.indexOf("<tfoot"), html.indexOf("</tfoot>")));
  check("conversies gemerkt", /<span data-cijfer="campagnes-totaal-conversies" data-kanaal="google">21<\/span>/.test(html));
  check("het venster: de gekozen periode per dag, niet '(30 dagen)'", /data-venster="periode"/.test(html) && !/30 dagen/.test(html));
  check("de zoekbalk heeft een naam voor een schermlezer", /aria-label="Zoek een campagne"/.test(html));
  const beurs = renderToStaticMarkup(createElement(CampagneTabelGoogle, { campagnes, nu, metVergelijking: false, reden: null, vergelijkLabel: "", geoClone: "GRT" }));
  check("met een beurs (een filter): geen merkteken", !/data-cijfer=/.test(beurs));
  // Met een vergelijking: de kolom Verandering en de cel per campagne.
  const toen = telCampagnes({ start: "2026-09-05", eind: "2026-09-25" }, { kanaal: "google", dagen: dagen("2026-09-05", "2026-09-25").map((d) => rij("111", "GRT | Search | NL", d, 10, 1)), maanden: [], eersteDag: "2026-01-01", bronStart: "2026-01-01" });
  const v = vergelijkCampagnes(nu, toen);
  const met = renderToStaticMarkup(createElement(CampagneTabelGoogle, { campagnes: campagnesMetStructuur(v.regels, structuur), nu, metVergelijking: true, reden: v.reden, vergelijkLabel: "De vorige periode" }));
  check("met vergelijking: kosten +100,0% en de nieuwe campagne als nieuw", met.includes("kosten +100,0%") && /data-campagne-status="nieuw"/.test(met));
  // Het Google-subtabblad geeft de schakelaar door.
  const gv = readFileSync(join(process.cwd(), "components/dashboard/google-view.tsx"), "utf8");
  check("GoogleCampagnes geeft nieuw door aan CampaignTable", /<CampaignTable [^>]*nieuw=\{nieuw\} \/>/.test(gv));
  const dash = readFileSync(join(process.cwd(), "components/dashboard/client-dashboard.tsx"), "utf8");
  check("client-dashboard geeft nieuweWeergave door aan GoogleCampagnes", /<GoogleCampagnes[\s\S]{0,260}nieuw=\{nieuweWeergave\}/.test(dash));
}

lading.then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}, (e) => { console.error(e); process.exit(1); });
