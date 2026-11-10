// Compositietest voor de KPI-band van Meta, LinkedIn en Microsoft (fase 1, stap 3):
// kanaalStandUitDagen(rijen) == kanaalStandUitMaanden(maandTotalenUitKanaalRijen(kanaalMaandenUitDagen(rijen)),
// laatsteDagUitRijen(rijen), eersteVolleMaand(eersteDagUitRijen(rijen))) -- op de dagrijen van
// lib/__channel_period_data_test.ts en op een paar reeksen met een partiële eerste maand, een
// pauze en een afwijkende selectie. Draaien: tsx lib/period/__kanaal_stand_compositie_test.ts
//
// Waarom: de band uit de dagrijen (de hook in de browser) en de band uit de maandreeks van de
// blended route (perKanaal, met laatsteDag en vanaf) moeten dezelfde functie zijn. Die wortel is
// kanaalStandUitMaanden; deze test houdt vast dat de dagrij-ingang er niets naast doet. Daarnaast:
// de maandreeks zoals de route hem bouwt (month "YYYY-MM", conversions/revenue/adSpend uit dezelfde
// kanaalMaandenUitDagen) geeft via kanaalStandUitMaanden dezelfde band -- de weg die de hook in de
// volgende stap gaat nemen.

import {
  CONVERSIE_KANAAL, NIET_GOOGLE, eersteDagUitRijen, eersteVolleMaand, kanaalStandUitDagen, kanaalStandUitMaanden,
  laatsteDagUitRijen, maandTotalenUitKanaalRijen, type MaandTotaal, type NietGoogleKanaal,
} from "./kanaal-maanden";
import { kanaalMaandenUitDagen } from "../analysis/channel-report-blend";
import { resolveChannelConversionConfig, type ChannelConversionConfig } from "../analysis/channel-conversion-config";
import { addDays } from "../reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Record<string, unknown>;
const json = (v: unknown) => JSON.stringify(v);

function dagen(van: string, tot: string, maak: (d: string) => Rij): Rij[] {
  const uit: Rij[] = [];
  for (let d = van; d <= tot; d = addDays(d, 1)) uit.push(maak(d));
  return uit;
}

// De dagrijen van lib/__channel_period_data_test.ts (RIJEN), letterlijk.
const PERIODE_TEST: Record<NietGoogleKanaal, Rij[]> = {
  meta: [
    { date: "2026-08-01", impressions: 1000, link_clicks: 40, spend: 100, conversions: 10, leads: 5, conversion_value: 500 },
    { date: "2026-08-26", impressions: 100, link_clicks: 4, spend: 10, conversions: 0, leads: 0, conversion_value: 0 },
  ],
  // Standaardselectie: one_click_leads + external_website_conversions = 27. Alleen lead-formulieren: 20.
  linkedin: [{ date: "2026-08-01", impressions: 500, clicks: 20, spend: 200, one_click_leads: 20, external_website_conversions: 7, post_click_conversions: 3, conversion_value: 0 }],
  microsoft: [{ date: "2026-07-31", impressions: 300, clicks: 10, spend: 50, conversions: 4, conversion_value: 80 }],
};

// Reeksen die de randen raken: een partiële eerste maand (Microsoft vanaf 23 juli 2025, zoals de
// demo), een pauze van hele maanden, vorig jaar én dit jaar, en een nulrij op de 1e.
const RANDEN: Record<NietGoogleKanaal, Rij[]> = {
  meta: [
    { date: "2026-03-01", impressions: 0, link_clicks: 0, spend: 0, conversions: 0, leads: 0, conversion_value: 0 },
    ...dagen("2026-03-13", "2026-08-26", (d) => ({ date: d, impressions: 10, link_clicks: 1, spend: 10.25, conversions: 1, leads: 0.5, conversion_value: 3.3 })),
  ],
  linkedin: [
    ...dagen("2025-11-01", "2026-01-31", (d) => ({ date: d, impressions: 5, clicks: 1, spend: 20, one_click_leads: 1, external_website_conversions: 2, post_click_conversions: 1, conversion_value: 0 })),
    ...dagen("2026-05-20", "2026-06-30", (d) => ({ date: d, impressions: 5, clicks: 1, spend: 20, one_click_leads: 0, external_website_conversions: 1, post_click_conversions: 0, conversion_value: 0 })),
  ],
  microsoft: dagen("2025-07-23", "2026-06-15", (d) => ({ date: d, impressions: 3, clicks: 1, spend: 5, conversions: 0.5, conversion_value: 12.5 })),
};

const SELECTIES: { naam: string; cfg: ChannelConversionConfig }[] = [
  { naam: "standaard", cfg: resolveChannelConversionConfig(null) },
  { naam: "eigen", cfg: resolveChannelConversionConfig({ meta_ads: ["leads"], linkedin_ads: ["one_click_leads"], microsoft_ads: ["conversions"] }) },
];

/** De maandreeks zoals de blended route hem per kanaal bouwt (perKanaal[].maanden), uit dezelfde kanaalMaandenUitDagen. */
function alsRouteReeks(rijen: Rij[], kanaal: NietGoogleKanaal, cfg: ChannelConversionConfig): { month: string; conversions: number; revenue: number; adSpend: number }[] {
  return kanaalMaandenUitDagen(rijen, CONVERSIE_KANAAL[kanaal], cfg)
    .map((m) => ({ month: String(m.month).slice(0, 7), conversions: m.conversions, revenue: m.conversions_value, adSpend: m.cost }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
/** Wat de hook straks doet: de routereeks naar maandtotalen. */
const alsMaandTotalen = (maanden: { month: string; conversions: number; revenue: number; adSpend: number }[]): MaandTotaal[] =>
  maanden.map((m) => ({ year: Number(m.month.slice(0, 4)), month: Number(m.month.slice(5, 7)), conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend }));

for (const [bron, RIJEN] of [["__channel_period_data_test", PERIODE_TEST], ["randen", RANDEN]] as const) {
  for (const { naam, cfg } of SELECTIES) {
    for (const kanaal of NIET_GOOGLE) {
      const rijen = RIJEN[kanaal];
      const ck = CONVERSIE_KANAAL[kanaal];
      const uitDagen = kanaalStandUitDagen("klant", rijen, kanaal, cfg, 2026);
      const compositie = kanaalStandUitMaanden(
        "klant",
        maandTotalenUitKanaalRijen(kanaalMaandenUitDagen(rijen, ck, cfg)),
        laatsteDagUitRijen(rijen),
        eersteVolleMaand(eersteDagUitRijen(rijen, ck)),
        2026,
      );
      check(`${bron} / ${naam} / ${kanaal}: kanaalStandUitDagen == de compositie`, json(uitDagen) === json(compositie), `${json(uitDagen)} vs ${json(compositie)}`);

      // De weg van de route: de maandreeks in routevorm, plus de twee dagscalairen die de route al
      // meegeeft (laatsteDag, vanaf), door dezelfde wortel.
      const viaRoute = kanaalStandUitMaanden("klant", alsMaandTotalen(alsRouteReeks(rijen, kanaal, cfg)), laatsteDagUitRijen(rijen), eersteVolleMaand(eersteDagUitRijen(rijen, ck)), 2026);
      check(`${bron} / ${naam} / ${kanaal}: de band uit de routereeks == de band uit de dagrijen`, json(viaRoute) === json(uitDagen), `${json(viaRoute)} vs ${json(uitDagen)}`);
      // Ook na een JSON-rondreis van de routereeks (zo komt hij in de browser aan).
      const naReis = JSON.parse(json({ maanden: alsRouteReeks(rijen, kanaal, cfg), laatsteDag: laatsteDagUitRijen(rijen), vanaf: eersteVolleMaand(eersteDagUitRijen(rijen, ck)) })) as
        { maanden: { month: string; conversions: number; revenue: number; adSpend: number }[]; laatsteDag: string | null; vanaf: string | null };
      check(`${bron} / ${naam} / ${kanaal}: ook na JSON`, json(kanaalStandUitMaanden("klant", alsMaandTotalen(naReis.maanden), naReis.laatsteDag, naReis.vanaf, 2026)) === json(uitDagen));
    }
  }
}

// De compositie is niet leeg-tegen-leeg: de eigen selectie telt anders dan de standaard
// (LinkedIn 20 tegen 27 in de reeks van de periodetest), en de randen dragen vorig jaar.
{
  const std = kanaalStandUitDagen("klant", PERIODE_TEST.linkedin, "linkedin", SELECTIES[0].cfg, 2026);
  const eigen = kanaalStandUitDagen("klant", PERIODE_TEST.linkedin, "linkedin", SELECTIES[1].cfg, 2026);
  check("LinkedIn augustus: standaard 27, eigen selectie 20", std.data.currentYearData[7]?.conversions === 27 && eigen.data.currentYearData[7]?.conversions === 20,
    `${std.data.currentYearData[7]?.conversions} / ${eigen.data.currentYearData[7]?.conversions}`);
  const ms = kanaalStandUitDagen("klant", RANDEN.microsoft, "microsoft", SELECTIES[0].cfg, 2026);
  check("Microsoft vanaf 23 juli 2025: de eerste volle maand is augustus 2025, de laatste dag 15 juni 2026",
    ms.vanaf === "2025-08" && ms.laatsteDag === "2026-06-15" && (ms.data.historicalYears[2025]?.length ?? 0) === 6, json([ms.vanaf, ms.laatsteDag, ms.data.historicalYears[2025]?.length]));
  const li = kanaalStandUitDagen("klant", RANDEN.linkedin, "linkedin", SELECTIES[0].cfg, 2026);
  check("LinkedIn met een pauze: vanaf blijft november 2025 (de historie van vóór de pauze telt)", li.vanaf === "2025-11", String(li.vanaf));
}

// Zonder rijen: lege data, geen dag, geen vanaf -- en de compositie zegt hetzelfde.
{
  const leeg = kanaalStandUitDagen("klant", [], "meta", SELECTIES[0].cfg, 2026);
  check("zonder rijen: laatsteDag null, vanaf null, twaalf lege maanden", leeg.laatsteDag === null && leeg.vanaf === null && leeg.data.currentYearData.every((m) => m === null));
  check("zonder rijen: gelijk aan kanaalStandUitMaanden([])", json(leeg) === json(kanaalStandUitMaanden("klant", [], null, null, 2026)));
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
