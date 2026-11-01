// Regressietest: "Pacing — alle kanalen" (components/dashboard/blended-pacing.tsx), de rekenkern en
// wat er op het scherm komt. Draaien: tsx lib/api/__blended_pacing_test.ts
//
// Wat er misging (stap 0, items H en E): het percentage telde elke rij van het jaar op, zonder naar
// het kanaal te kijken. Bij de demo liepen Meta en LinkedIn vorig jaar nog niet, dus stond er
// "+73% spend, +158% conversies" voor iets dat gelijk-voor-gelijk (alleen Google) +8,1% en -6,5%
// was. En het venster eindigde op "de laatste maand vóór vandaag" (augustus), terwijl de data op
// 25/26 augustus stopte.
//
// De kern rekent nu via gepaardeTotalen (dezelfde regel als de KPI-band) over de kanaalreeksen uit
// /api/blended/client-data, t/m dataStand.laatsteVolleMaand. Dezelfde fixture als het voorstel in
// de diagnose: de demo-greentech-vorm.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pacing from "../../components/dashboard/blended-pacing";
import type { BlendedKanaalReeks } from "./blended-historical";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const dicht = (a: number | null | undefined, b: number, eps = 1e-4) => a != null && Math.abs(a - b) < eps;

// Op de oude code bestaan deze exports niet; dan per geval falen in plaats van op de import.
const { blendedPacingCijfers, blendedPacingVoetregel, BlendedPacing } = pacing as unknown as {
  blendedPacingCijfers?: typeof pacing.blendedPacingCijfers;
  blendedPacingVoetregel?: typeof pacing.blendedPacingVoetregel;
  BlendedPacing: typeof pacing.BlendedPacing;
};

const mm = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
function reeks(jaar: number, vanMaand: number, spend: number[], conv: number[]): BlendedKanaalReeks["maanden"] {
  return spend.map((s, i) => ({ month: mm(jaar, vanMaand + i), adSpend: s, conversions: conv[i], revenue: 0 }));
}

// De demo-greentech-vorm: Google beide jaren jan-aug, Meta en LinkedIn alleen dit jaar (feb-aug).
const G25 = reeks(2025, 1, [11100, 11050, 11150, 11100, 11050, 11150, 11100, 11050], [88, 92, 103, 113, 127, 143, 138, 134]);
const G26 = reeks(2026, 1, [12000, 11950, 12050, 12000, 11950, 12050, 12000, 11950], [90, 91, 97, 104, 115, 128, 126, 126]);
const M26 = reeks(2026, 2, [2850, 2850, 4500, 4650, 4500, 4650, 3900], [114, 114, 180, 186, 180, 186, 156]);
const L26 = reeks(2026, 2, [1900, 1900, 3000, 3100, 3000, 9300, 7800], [38, 33, 53, 54, 53, 106, 88]);
const demo: BlendedKanaalReeks[] = [
  { kanaal: "google", vanaf: null, maanden: [...G25, ...G26] },
  { kanaal: "meta", vanaf: null, maanden: M26 },
  { kanaal: "linkedin", vanaf: null, maanden: L26 },
];

function render(perKanaal: BlendedKanaalReeks[] | null, dataStand: Parameters<typeof pacing.BlendedPacing>[0]["dataStand"]): string {
  return renderToStaticMarkup(createElement(BlendedPacing, { perKanaal, dataStand }));
}
const tekst = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

console.log("De rekenkern: gelijk-voor-gelijk, het tempo over alle kanalen");
if (typeof blendedPacingCijfers !== "function") {
  check("blendedPacingCijfers bestaat", false);
} else {
  const r = blendedPacingCijfers(demo, "2026-08")!;
  check("venster januari t/m augustus, acht maanden", r.totMaand === "2026-08" && r.maanden === 8
    && r.periode.start === "2026-01" && r.vergelijking.start === "2025-01" && r.vergelijking.end === "2025-08", JSON.stringify([r.periode, r.vergelijking, r.maanden]));
  check("het tempo telt alle kanalen van dit jaar (153.850 / 2.418)", r.spend === 153850 && r.conv === 2418, `${r.spend} / ${r.conv}`);
  check("alleen Google is vergeleken", JSON.stringify(r.vergeleken) === JSON.stringify(["google"]), JSON.stringify(r.vergeleken));
  check("Meta en LinkedIn staan buiten de vergelijking (geen enkel maandpaar)",
    JSON.stringify(r.buiten.map((b) => b.naam)) === JSON.stringify(["meta", "linkedin"]) && r.deels.length === 0, JSON.stringify(r.buiten));
  check("de gepaarde getallen: 95.950 tegen 88.750, 877 tegen 938",
    r.gepaard.huidig.adSpend === 95950 && r.gepaard.vorig.adSpend === 88750 && r.gepaard.huidig.conversions === 877 && r.gepaard.vorig.conversions === 938,
    JSON.stringify(r.gepaard));
  check("spend +8,1%, niet +73%", dicht(r.spendRatio, 95950 / 88750), String(r.spendRatio));
  check("conversies -6,5%, niet +158%", dicht(r.convRatio, 877 / 938), String(r.convRatio));

  const nieuw = blendedPacingCijfers(demo.filter((k) => k.kanaal !== "google"), "2026-08")!;
  check("geen kanaal in beide jaren: geen percentage (null, niet 0 en niet oneindig)",
    nieuw.spendRatio === null && nieuw.convRatio === null && nieuw.vergeleken.length === 0 && nieuw.buiten.length === 2, JSON.stringify(nieuw));

  // Microsoft vanaf 23 juli 2025, zoals bij de demo. Hier stond eerst een VOLLE juli 2025 (1.000 /
  // 80), en dan klopte het percentage met de regel "vanaf de eerste maand met een rij". Maar zo'n
  // juli heeft de demo nooit gehad: het waren negen dagen (297 / 23,5) tegen een volle juli 2026, en
  // op het scherm stond "Conversies +0%" waar gelijk-voor-gelijk -7% hoort. De route geeft nu de
  // eerste VOLLE maand mee (vanaf), en pas vanaf daar paart een kanaal.
  const ms: BlendedKanaalReeks = { kanaal: "microsoft", vanaf: "2025-08", maanden: [
    { month: "2025-07", adSpend: 297, conversions: 23.5, revenue: 0 },
    ...reeks(2025, 8, [1000], [80]),
    ...reeks(2026, 1, Array(8).fill(1000), Array(8).fill(80)),
  ] };
  const metMs = blendedPacingCijfers([...demo, ms], "2026-08")!;
  check("t/m augustus: Microsoft deels vergeleken, met zijn start en zijn eerste volle maand",
    metMs.deels.length === 1 && metMs.deels[0].naam === "microsoft" && metMs.deels[0].start === "2025-07"
      && metMs.deels[0].vanaf === "2025-08" && metMs.vergeleken.includes("microsoft"), JSON.stringify(metMs.deels));
  check("en dan alleen augustus van Microsoft in het percentage, niet de negen dagen juli",
    dicht(metMs.spendRatio, (95950 + 1000) / (88750 + 1000)), String(metMs.spendRatio));
  check("het tempo telt Microsoft wel helemaal (8 x 1.000 erbij)", metMs.spend === 153850 + 8000, String(metMs.spend));

  // Het venster van de demo zelf: t/m juli 2026. Dan heeft Microsoft geen enkel vol maandpaar.
  const juliMs = blendedPacingCijfers([...demo, ms], "2026-07")!;
  check("t/m juli: Microsoft staat buiten de vergelijking (de partiële juli 2025 paart niet)",
    juliMs.buiten.some((b) => b.naam === "microsoft") && !juliMs.vergeleken.includes("microsoft"), JSON.stringify(juliMs.buiten));
  // Oud: 85.000 tegen 77.997 (+9,0%) en 831 tegen 827,5 (+0,4%).
  check("en de percentages zijn alleen Google: spend +8,1%, conversies -6,6%",
    dicht(juliMs.spendRatio, 84000 / 77700) && dicht(juliMs.convRatio, 751 / 804), `${juliMs.spendRatio} / ${juliMs.convRatio}`);
  check("het tempo telt de zeven Microsoft-maanden van dit jaar wel", juliMs.spend === 130200 + 7000, String(juliMs.spend));

  // Alle kanalen in beide jaren: de volle som, niemand buiten (geen gedragswijziging voor eerlijke gevallen).
  const beide = blendedPacingCijfers([
    demo[0],
    { kanaal: "meta", vanaf: null, maanden: [...reeks(2025, 1, Array(8).fill(3000), Array(8).fill(100)), ...reeks(2026, 1, Array(8).fill(3000), Array(8).fill(100))] },
  ], "2026-08")!;
  check("alle kanalen vergelijkbaar: de volle som, niemand buiten",
    dicht(beide.spendRatio, (95950 + 24000) / (88750 + 24000)) && beide.buiten.length === 0 && beide.deels.length === 0, JSON.stringify([beide.spendRatio, beide.buiten]));

  // Het venster volgt de datastand: t/m juli als augustus partieel is.
  const juli = blendedPacingCijfers(demo, "2026-07")!;
  check("t/m juli: zeven maanden, augustus telt aan geen van beide kanten",
    juli.maanden === 7 && juli.gepaard.huidig.adSpend === 95950 - 11950 && juli.gepaard.vorig.adSpend === 88750 - 11050, JSON.stringify(juli.gepaard));
  check("geen data in het jaar van totMaand: null", blendedPacingCijfers([{ kanaal: "google", vanaf: null, maanden: G25 }], "2026-08") === null);
}

console.log("De voetregel: wat er vergeleken is, wat niet, en de partiële maand");
if (typeof blendedPacingCijfers !== "function" || typeof blendedPacingVoetregel !== "function") {
  check("blendedPacingVoetregel bestaat", false);
} else {
  const r = blendedPacingCijfers(demo, "2026-07")!;
  const v = blendedPacingVoetregel(r, { maand: "2026-08", tmDag: 25, dagenInMaand: 31 });
  check("noemt het vergeleken kanaal", v.includes("gelijk-voor-gelijk: Google Ads."), v);
  check("noemt de uitgesloten kanalen met hun start", v.includes("Meta (sinds februari 2026) en LinkedIn (sinds februari 2026) liepen in januari 2025 t/m juli 2025 nog niet en tellen alleen mee in het tempo."), v);
  check("en de partiële maand", v.includes("Augustus telt nog niet mee: de data loopt t/m 25 augustus."), v);
  const zonderPartieel = blendedPacingVoetregel(blendedPacingCijfers([demo[0]], "2026-07")!, null);
  check("alles vergelijkbaar en geen partiële maand: de oude uitleg, geen kanaalnamen",
    zonderPartieel.startsWith("Tegen vorig jaar en niet tegen een doel") && !zonderPartieel.includes("Google Ads") && !zonderPartieel.includes("telt nog niet mee"), zonderPartieel);
  const geen = blendedPacingVoetregel(blendedPacingCijfers(demo.slice(1), "2026-07")!, null);
  check("niets te paren: 'Geen vergelijking' in de voetregel", geen.startsWith("Geen vergelijking: geen van de kanalen liep in januari 2025 t/m juli 2025 al."), geen);

  // Microsoft liep in juli 2025 wel, alleen geen volle maand. "Liep nog niet" zou dan onwaar zijn,
  // en "telt alleen mee over de maanden waarin het in beide jaren liep" (de oude tekst) ook: juli
  // liep in beide jaren en telde toch niet.
  const ms: BlendedKanaalReeks = { kanaal: "microsoft", vanaf: "2025-08", maanden: [
    { month: "2025-07", adSpend: 297, conversions: 23.5, revenue: 0 },
    ...reeks(2026, 1, Array(7).fill(1000), Array(7).fill(80)),
  ] };
  const metMs = blendedPacingVoetregel(blendedPacingCijfers([...demo, ms], "2026-07")!, null);
  check("de partiële eerste maand: 'sinds juli 2025, volledig vanaf augustus 2025'",
    metMs.includes("Microsoft Ads (sinds juli 2025, volledig vanaf augustus 2025)"), metMs);
  check("en 'nog geen volle maand' in plaats van 'nog niet'",
    metMs.includes("liepen in januari 2025 t/m juli 2025 nog geen volle maand en tellen alleen mee in het tempo."), metMs);
  check("geen 'in beide jaren liep' voor een maand die niet telde", !metMs.includes("in beide jaren liep"), metMs);
}

console.log("Wat er op het scherm komt");
{
  const html = tekst(render(demo, { laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 } }));
  check("kop: t/m juli 2026, zeven maanden", html.includes("Jaar tot en met juli 2026 · 7 maanden"), html.slice(0, 200));
  // Over alle rijen was het t/m juli +68% en +155%, t/m augustus (de oude grens) +73% en +158%.
  check("spend +8% (gepaard), niet +68% of +73%", html.includes("+8%") && !html.includes("+68%") && !html.includes("+73%"), html);
  check("conversies -7% (gepaard), niet +155% of +158%", html.includes("-7%") && !html.includes("+155%") && !html.includes("+158%"), html);
  check("de gepaarde getallen staan eronder (€ 84.000 tegen € 77.700)", /84\.000\s*tegen\s*€\s*77\.700/.test(html.replace(/ /g, " ")), html);
  check("het tempo over alle kanalen: € 130.200 / 7 = € 18.600 per maand", /18\.600/.test(html), html);
  check("de voetregel noemt Meta en LinkedIn en de partiële augustus", html.includes("Meta (sinds februari 2026) en LinkedIn") && html.includes("Augustus telt nog niet mee"), html);

  // Met de demo-Microsoft erbij (negen dagen juli 2025): het blok blijft gelijk-voor-gelijk.
  const ms: BlendedKanaalReeks = { kanaal: "microsoft", vanaf: "2025-08", maanden: [
    { month: "2025-07", adSpend: 297, conversions: 23.5, revenue: 0 },
    ...reeks(2026, 1, Array(7).fill(1000), Array(7).fill(80)),
  ] };
  const metMs = tekst(render([...demo, ms], { laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 } }));
  // Oud: "+9%" spend en "+0%" conversies (824 tegen 827 in de demo).
  check("met Microsoft: spend +8% en conversies -7%, niet +9% en +0%",
    metMs.includes("+8%") && metMs.includes("-7%") && !metMs.includes("+9%") && !metMs.includes("+0%"), metMs);

  const geen = tekst(render(demo.slice(1), { laatsteVolleMaand: "2026-07", partieel: null }));
  check("niets te paren: 'Geen vergelijking' en streepjes, geen '€ 0 tegen € 0'",
    geen.includes("Geen vergelijking") && !geen.includes("Geen vorig jaar") && !/€\s*0\s*tegen/.test(geen.replace(/ /g, " ")), geen);
  check("zonder datastand: niets (geen venster op de kalender)", render(demo, null) === "");
  check("zonder kanalen: niets", render(null, { laatsteVolleMaand: "2026-07", partieel: null }) === "");
}

// Een ontkoppeld of al maanden stil kanaal remt het venster niet meer (review [9]/[36]): na zijn
// laatste dag telt het als nul. De KPI-band zei dat al; de pacing niet, en daar las een LinkedIn
// die sinds 15 mei niets meer levert als "lager dan vorig jaar" zonder dat er stond waarom.
console.log("Een kanaal dat het venster niet tegenhoudt");
{
  const stand = {
    laatsteVolleMaand: "2026-07", partieel: null,
    uitgesloten: ["linkedin"],
    bronnen: [
      { bron: "google", dataTot: "2026-07-31", syncDraait: false },
      { bron: "linkedin", dataTot: "2026-05-15", syncDraait: true },
    ],
  };
  const html = tekst(render(demo, stand));
  check("de voetregel noemt LinkedIn met zijn laatste dag",
    html.includes("LinkedIn (geen data na 15 mei 2026) houdt het venster niet tegen; vanaf die dag telt het als nul."), html);
  const zonder = tekst(render(demo, { ...stand, uitgesloten: [] }));
  check("zonder uitgesloten bron: geen zin", !zonder.includes("houdt het venster niet tegen"), zonder);
  // Stopt hij pas in de partiële maand ná het venster, dan is hij t/m juli volledig.
  const laat = tekst(render(demo, { ...stand, bronnen: [{ bron: "linkedin", dataTot: "2026-08-10", syncDraait: true }] }));
  check("stopt hij na het venster: geen zin", !laat.includes("houdt het venster niet tegen"), laat);
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
