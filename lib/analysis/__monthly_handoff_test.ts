// De overdracht van de maandanalyse naar weekly en bi-weekly.
// Draaien: npx tsx lib/analysis/__monthly_handoff_test.ts
//
// De bi-weekly kreeg het narratieve deliverable-document ongetruncateerd in de system prompt van
// alle vier zijn stappen, terwijl structured_monthly_v2 de hypotheses al als velden draagt. De
// weekly kreeg helemaal niets. Deze test bewaakt de drie dingen die daarbij mis kunnen gaan:
// dat de gestructureerde bron wordt gebruikt als hij er is, dat de terugval eerlijk gelabeld is,
// en dat "geen maandanalyse" niet stilzwijgend als "geen bijzonderheden" leest.

import { buildMonthlyHandoff, buildOpenPointsBlock } from "./monthly-handoff";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const STRUCTURED = JSON.stringify({
  final_sop: {
    primary_thread: "Non-brand search verliest efficiëntie",
    root_cause: "Zoektermen verbreed na de match-type-wijziging in juni",
    recommendations: [{ title: "Uitsluitingslijst aanscherpen op generieke termen" }, { title: "tROAS terug naar 380%" }],
  },
  operating_detail: {
    hypotheses_and_next_month_proof: [
      {
        hypothesis_number: 1, route: "containment",
        hypothesis: "Met een strakkere uitsluitingslijst verwachten we de CPA met 15% te zien dalen",
        why_we_think_this: "38% van de spend ging naar termen zonder enige conversie",
        success_next_month: "CPA onder €60 en wasted spend onder €400",
      },
      {
        hypothesis_number: 2, route: "scale",
        hypothesis: "Met tROAS op 380% verwachten we het volume te behouden bij een betere marge",
        why_we_think_this: "De huidige 300% laat conversies binnen die onder de marge liggen",
        success_next_month: "ROAS boven 3,8 bij gelijk conversievolume",
      },
    ],
  },
});

console.log("De gestructureerde bron wordt gebruikt als hij er is");
{
  const h = buildMonthlyHandoff({ structured: STRUCTURED, analysisDate: "2026-08-01", cadans: "biweekly" });
  check("bron is structured", h.bron === "structured", h.bron);
  check("beide hypotheses zijn meegenomen", h.aantalHypotheses === 2, String(h.aantalHypotheses));
  check("de hoofdlijn staat erin", h.tekst.includes("Non-brand search verliest efficiëntie"));
  check("de oorzaak staat erin", h.tekst.includes("match-type-wijziging"));
  check("de datum van de maandanalyse staat erin", h.tekst.includes("2026-08-01"));
  check("het succescriterium staat erin", h.tekst.includes("CPA onder €60"));
  check("de aanbevelingen staan erin", h.tekst.includes("tROAS terug naar 380%"));
  // Zonder deze regel leest de overdracht als een lijst nieuwe bevindingen in plaats van als
  // materiaal om tegen te toetsen -- precies de verwarring die de bi-weekly moet vermijden.
  check("het is expliciet geen nieuwe bevinding", h.tekst.includes("geen nieuwe bevindingen"));
}

console.log("\nDe weekly krijgt een kortere vorm dan de bi-weekly");
{
  const bi = buildMonthlyHandoff({ structured: STRUCTURED, analysisDate: "2026-08-01", cadans: "biweekly" });
  const wk = buildMonthlyHandoff({ structured: STRUCTURED, analysisDate: "2026-08-01", cadans: "weekly" });
  check("de weekly-vorm is korter", wk.tekst.length < bi.tekst.length, `${wk.tekst.length} vs ${bi.tekst.length}`);
  check("de weekly krijgt de hoofdlijn wel", wk.tekst.includes("Non-brand search verliest efficiëntie"));
  // De weekly is expliciet "geen diepe analyse". Kreeg hij de onderbouwing en de succescriteria,
  // dan gaat hij de maandanalyse overdoen -- wat zijn eigen preambule verbiedt.
  check("de weekly krijgt de onderbouwing niet", !wk.tekst.includes("38% van de spend"));
  check("de weekly krijgt de succescriteria niet", !wk.tekst.includes("CPA onder €60"));
  check("de weekly krijgt de aanbevelingen niet", !wk.tekst.includes("tROAS terug naar 380%"));
  check("de weekly wordt afgeremd", wk.tekst.includes("laat het dan met rust"));
}

console.log("\nDe narratieve terugval is als terugval herkenbaar");
{
  const h = buildMonthlyHandoff({ structured: null, narratief: "# Maandanalyse\nVan alles.", analysisDate: "2026-07-01", cadans: "biweekly" });
  check("bron is narratief", h.bron === "narratief", h.bron);
  check("het label staat er hardop bij", h.tekst.includes("NARRATIEVE TERUGVAL"));
  check("geen hypotheses geteld", h.aantalHypotheses === 0);
  check("de tekst zelf gaat mee", h.tekst.includes("Van alles."));
}
{
  // Kapotte JSON telt als afwezig, niet als leeg blok.
  const h = buildMonthlyHandoff({ structured: "{niet eens json", narratief: "iets", cadans: "biweekly" });
  check("kapotte JSON valt terug", h.bron === "narratief", h.bron);
}
{
  // Een structured-rij zonder diagnose én zonder hypotheses draagt niets om tegen te toetsen;
  // dan is het verhaal eerlijker dan een blok met lege kopjes.
  const leeg = JSON.stringify({ final_sop: {}, operating_detail: { hypotheses_and_next_month_proof: [] } });
  const h = buildMonthlyHandoff({ structured: leeg, narratief: "de lopende tekst", cadans: "biweekly" });
  check("lege structured valt terug op narratief", h.bron === "narratief", h.bron);
}

console.log("\nEen heel lang narratief wordt begrensd");
{
  const lang = "x".repeat(20000);
  const h = buildMonthlyHandoff({ structured: null, narratief: lang, cadans: "biweekly" });
  check("afgekapt", h.tekst.length < 9000, String(h.tekst.length));
  check("en dat wordt gemeld", h.tekst.includes("afgekapt"));
}

console.log("\nGeen maandanalyse leest niet als geen bijzonderheden");
{
  const h = buildMonthlyHandoff({ structured: null, narratief: null, cadans: "biweekly" });
  check("bron is geen", h.bron === "geen", h.bron);
  check("de vergelijking wordt expliciet verboden", h.tekst.includes("die vergelijking bestaat niet"));
  // Het oude gedrag was: "Voer de analyse uit op basis van de data zonder referentie aan eerdere
  // bevindingen" -- een uitnodiging om de maandanalyse over te doen.
  check("er staat geen uitnodiging om het zelf maar te doen", !h.tekst.toLowerCase().includes("zonder referentie"));
}

console.log("\nOpenstaande punten van de vorige runs");
{
  const rijen = [
    { hypothesis: "Zoekterm 'gratis' uitsluiten", measurement_metric: "wasted spend", expected_result: "-€200/week", analysis_date: "2026-08-10", status: "open" },
    { hypothesis: "Afgerond punt", status: "done" },
    { hypothesis: "Nog een open punt", analysis_date: "2026-08-17", status: null },
  ];
  const blok = buildOpenPointsBlock(rijen);
  check("alleen open punten", blok.includes("Zoekterm 'gratis'") && blok.includes("Nog een open punt") && !blok.includes("Afgerond punt"));
  check("met datum", blok.includes("[2026-08-10]"));
  check("met meetlat", blok.includes("meet op wasted spend"));
  // Dit is het hele punt van het blok: herhaling moet als herhaling worden gemeld.
  check("de instructie vraagt om 'aanhoudend'", blok.includes("AANHOUDEND"));
  check("geen open punten geeft geen blok", buildOpenPointsBlock([{ hypothesis: "x", status: "done" }]) === "");
  check("lege lijst geeft geen blok", buildOpenPointsBlock([]) === "");
}
{
  const veel = Array.from({ length: 20 }, (_, i) => ({ hypothesis: `punt ${i}`, status: "open" }));
  const blok = buildOpenPointsBlock(veel, 5);
  check("begrensd op het maximum", (blok.match(/^- /gm) ?? []).length === 5);
  check("de rest wordt geteld, niet verzwegen", blok.includes("nog 15 andere"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
