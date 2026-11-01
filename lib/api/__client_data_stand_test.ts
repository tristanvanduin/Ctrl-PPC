// Tot waar de Google client-data-route de cijfers definitief noemt, en welke maanden daardoor
// als gerealiseerd tellen. Draaien: npx tsx lib/api/__client_data_stand_test.ts
//
// Waarom: de route rekende "gerealiseerd" met new Date().getMonth() (de UTC-maand van de server),
// en de geseede demo deed hetzelfde op de kalender terwijl zijn data op 26 augustus stopt. Op
// 1 november telde augustus daardoor als volle maand, en liep de KPI-band door tot in september
// en oktober, die in de database niet bestaan. Hier liggen de grenzen vast.

import { liveDataStand, maandbronDataStand, gerealiseerdTotMaand } from "./client-data-stand";
import { buildClientDataFromApi, type ApiMonthlyData } from "./adapter";
import { computeForecast } from "../forecast";
import { zonderData } from "../forecast-format";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const ALLE_MAANDEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

console.log("liveDataStand: de live API levert t/m gisteren");
{
  const eerste = liveDataStand("2026-11-01");
  check("op 1 november is oktober vol (data t/m 31 oktober)",
    eerste.laatsteVolleMaand === "2026-10" && eerste.partieel === null && eerste.dataTot === "2026-10-31", JSON.stringify(eerste));
  const midden = liveDataStand("2026-11-14");
  check("op 14 november: oktober vol, november t/m de 13e",
    midden.laatsteVolleMaand === "2026-10" && midden.partieel?.maand === "2026-11" && midden.partieel.tmDag === 13 && midden.dataTot === "2026-11-13",
    JSON.stringify(midden));
  check("één bron: niets uitgesloten, niets achter", midden.uitgesloten.length === 0 && midden.maandenAchter === 0);
  const nieuwjaar = liveDataStand("2027-01-01");
  check("op nieuwjaarsdag is december van vorig jaar de laatste volle maand", nieuwjaar.laatsteVolleMaand === "2026-12", JSON.stringify(nieuwjaar));
  check("en telt er van het nieuwe jaar nog niets als gerealiseerd", gerealiseerdTotMaand(nieuwjaar, 2027, [1]) === 0);
  check("in maart: t/m februari, ook als de API al een maartrij heeft", gerealiseerdTotMaand(liveDataStand("2026-03-10"), 2026, [1, 2, 3]) === 2);
}

console.log("maandbronDataStand: de geseede demo (data t/m 26 augustus, sync 26 aug 06:44 UTC)");
{
  const demo = maandbronDataStand("2026-08-01", "2026-08-26T06:44:34.346+00:00", "2026-11-01");
  check("augustus loopt t/m de 25e en is dus niet vol",
    demo.laatsteVolleMaand === "2026-07" && demo.partieel?.maand === "2026-08" && demo.partieel.tmDag === 25 && demo.partieel.dagenInMaand === 31,
    JSON.stringify(demo));
  check("data t/m 25 augustus", demo.dataTot === "2026-08-25", String(demo.dataTot));
  check("drie maanden achter op de kalender (oktober verwacht)", demo.verwachteMaand === "2026-10" && demo.maandenAchter === 3, JSON.stringify(demo));
  // Op de kalender gaf dit 8 (augustus "afgesloten"), en via de fixture zelfs 10.
  check("gerealiseerd t/m juli, niet augustus", gerealiseerdTotMaand(demo, 2026, [1, 2, 3, 4, 5, 6, 7, 8]) === 7);

  const vol = maandbronDataStand("2026-08-01", "2026-09-02T05:00:00Z", "2026-11-01");
  check("een sync in september maakt augustus vol", vol.laatsteVolleMaand === "2026-08" && vol.partieel === null && vol.dataTot === "2026-08-31", JSON.stringify(vol));

  // De demo-mock rekent vanaf vandaag en heeft een rij in de lopende maand, zonder synctijdstip.
  const mock = maandbronDataStand("2026-11-01", null, "2026-11-01");
  check("een rij in de lopende maand zonder sync: data t/m gisteren, niet t/m 30 november",
    mock.dataTot === "2026-10-31" && mock.laatsteVolleMaand === "2026-10", JSON.stringify(mock));
  const mockMidden = maandbronDataStand("2026-11-01", null, "2026-11-14");
  check("en midden in de maand ook gisteren", mockMidden.dataTot === "2026-11-13" && mockMidden.laatsteVolleMaand === "2026-10", JSON.stringify(mockMidden));

  const leeg = maandbronDataStand(null, null, "2026-11-01");
  check("zonder rijen geen stand", leeg.laatsteVolleMaand === null && leeg.dataTot === null && leeg.maandenAchter === null, JSON.stringify(leeg));
  check("en dus niets gerealiseerd", gerealiseerdTotMaand(leeg, 2026, ALLE_MAANDEN) === 0);
}

console.log("gerealiseerdTotMaand: t/m de laatste volle maand van de stand, zodra er een rij is");
{
  const juli = { laatsteVolleMaand: "2026-07" };
  // Hier stond 5 ("de laatste maand met een rij"). Juni en juli zijn door de API gemeten: zonder
  // rij is dat een maand zonder uitgaven, geen maand die nog moet komen. Met 5 kregen juni en juli
  // een prognose, en zei de jaarkaart van een account dat na mei stilviel "op doel".
  check("met een gat en een stille staart: t/m de volle maand", gerealiseerdTotMaand(juli, 2026, [1, 2, 3, 5]) === 7,
    String(gerealiseerdTotMaand(juli, 2026, [1, 2, 3, 5])));
  check("rijen t/m mei, live stand t/m oktober: 10", gerealiseerdTotMaand(liveDataStand("2026-11-01"), 2026, [1, 2, 3, 4, 5]) === 10);
  check("geen enkele rij: 0", gerealiseerdTotMaand(juli, 2026, []) === 0);
  check("alleen een rij na de grens (de lopende maand): 0", gerealiseerdTotMaand(juli, 2026, [8]) === 0);
  check("de stand van een vorig jaar: 0 in het lopende jaar", gerealiseerdTotMaand({ laatsteVolleMaand: "2025-12" }, 2026, ALLE_MAANDEN) === 0);
  check("een stand voorbij het jaar: het hele jaar", gerealiseerdTotMaand({ laatsteVolleMaand: "2027-02" }, 2026, ALLE_MAANDEN) === 12);
  check("geen stand: 0", gerealiseerdTotMaand({ laatsteVolleMaand: null }, 2026, ALLE_MAANDEN) === 0);
  check("onzinmaanden tellen niet", gerealiseerdTotMaand(juli, 2026, [0, 13, -1]) === 0);
}

console.log("De keten: route-grens, adapter en forecast (een account dat na mei stilviel)");
{
  // De live API levert t/m 31 oktober, maar alleen rijen voor maart t/m mei (en een gat in april):
  // een beursklant die na de beurs niets meer uitgaf. De API vult niets aan met nullen.
  const stand = liveDataStand("2026-11-01");
  const maanden = [3, 5];
  const rtm = gerealiseerdTotMaand(stand, 2026, maanden);
  const m = (month: number): ApiMonthlyData => ({
    month, conversions: 50, revenue: 5000, adSpend: 2000, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0,
  });
  const data = buildClientDataFromApi(
    "t", [{ year: 2025, monthly: ALLE_MAANDEN.map(m), weekly: [] }], maanden.map(m), [],
    { conversions: 600, revenue: 60000, adSpend: 24000 }, 2026, rtm,
  );
  const cy = data.currentYearData;
  check("januari en februari (vóór de eerste rij) blijven leeg", cy[0] === null && cy[1] === null);
  check("april (een gat) is een gemeten nul", cy[3] !== null && cy[3].conversions === 0 && cy[3].adSpend === 0, JSON.stringify(cy[3]));
  check("juni t/m oktober zijn gemeten nullen", cy.slice(5, 10).every((r) => r !== null && r.conversions === 0), JSON.stringify(cy.slice(5, 10).map((r) => r?.conversions ?? null)));
  check("november en december blijven toekomst", cy[10] === null && cy[11] === null);
  check("een nulmaand heeft weken, zodat de weekweergave hem als gemeten toont",
    cy.slice(5, 10).every((r) => r !== null && r.weeks.length > 0 && r.weeks.every((w) => w.conversions === 0)));

  const f = computeForecast(data);
  const c = f.conversions;
  check("de forecast telt t/m oktober", c.kpi.realizedThroughMonth === 10, String(c.kpi.realizedThroughMonth));
  check("juni t/m oktober: geen prognose, gerealiseerd 0",
    c.points.slice(5, 10).every((p) => p.forecast === null && p.realized === 0),
    c.points.slice(5, 10).map((p) => `${p.realized}/${p.forecast}`).join(","));
  check("de jaarprognose staat niet meer op doel", c.kpi.adjustedAnnual < 600 && c.kpi.diffPct < 0, `${c.kpi.adjustedAnnual} ${c.kpi.diffPct}`);
  // Of april als lege rij of als nulrij binnenkomt maakt voor het oordeel niets uit (gepauzeerd =
  // echt nul): de verwachting t/m oktober telt alle tien maanden.
  check("ytdExpected telt januari t/m oktober", c.kpi.ytdExpected === 500, String(c.kpi.ytdExpected));
  // Voor de verhoudingen is een nulmaand geen meting: 0 / 0 is geen CPA van € 0 (dat kleurde groen,
  // "topprestatie") en geen ROAS van 0 (rood). Ze horen "geen data" te zijn, zoals een maand
  // zonder rij dat vóór de nulrecords ook was. Hetzelfde voor de weken in zo'n maand.
  const gaten = [4, 6, 7, 8, 9, 10];
  for (const k of ["cpa", "roas"] as const) {
    check(`${k}: april en juni t/m oktober zonder data, niet 0`, gaten.every((mnd) => zonderData(f[k].points[mnd - 1])),
      gaten.map((mnd) => `${f[k].points[mnd - 1].realized}/${f[k].points[mnd - 1].forecast}`).join(","));
    check(`${k}: de weken van oktober ook`, f[k].weeklyPoints.filter((w) => w.month === 10).every((w) => w.realized === null),
      f[k].weeklyPoints.filter((w) => w.month === 10).map((w) => String(w.realized)).join(","));
    check(`${k}: maart en mei (wel gemeten) houden hun verhouding`, f[k].points[2].realized !== null && f[k].points[4].realized !== null && f[k].points[2].realized! > 0);
  }
  check("conversies: de nulmaand blijft wel een gemeten 0", c.points[3].realized === 0);

  // Historische jaren en een account dat bij is veranderen niet.
  check("historisch jaar: twaalf maanden zoals voorheen", data.historicalYears[2025].length === 12 && data.historicalYears[2025].every((r) => r.conversions === 50));
  const bij = buildClientDataFromApi("t", [], ALLE_MAANDEN.slice(0, 10).map(m), [], { conversions: 0, revenue: 0, adSpend: 0 }, 2026, 10);
  check("geen gaten: dezelfde maanden als de rijen", bij.currentYearData.slice(0, 10).every((r) => r !== null && r.conversions === 50) && bij.currentYearData[10] === null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
