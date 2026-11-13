// Test: wat de foutmelding van het dashboard zegt (app/(app)/foutgrens.tsx).
// Draaien: tsx "app/(app)/__foutgrens_test.ts"
//
// Of de grens een fout ook echt VANGT, is gedrag van React en Next en zonder browser niet na te
// spelen (een servrender gooit de fout gewoon door). Dat toetst de zelftest van
// scripts/rookproef.mjs in een echte browser. Hier staat wat de melding moet zeggen: wat er
// misging, waar, de foutcode voor de logs, een knop, en het kenmerk waarop de rookproef zoekt.

import { createRequire } from "node:module";
import { Foutmelding, OnderdeelGrens } from "./foutgrens";

const req = createRequire(__filename);
const React = req("react") as typeof import("react");
const { renderToStaticMarkup } = req("react-dom/server") as typeof import("react-dom/server");

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const fout = Object.assign(new Error("Kan eigenschap 'conversies' van undefined niet lezen"), { digest: "123456789" });
const html = renderToStaticMarkup(React.createElement(Foutmelding, { error: fout, opnieuw: () => {}, waar: "het onderdeel Prognose" }));

check("noemt wat er misging", html.includes("Kan eigenschap &#x27;conversies&#x27; van undefined niet lezen"), html);
check("noemt waar", html.includes("het onderdeel Prognose"));
check("noemt de foutcode voor de serverlogs", html.includes("Foutcode 123456789"));
check("heeft een knop om opnieuw te proberen", /<button[^>]*>[\s\S]*Opnieuw proberen<\/button>/.test(html));
check("is een alert voor schermlezers", html.includes('role="alert"'));
check("draagt data-foutgrens voor de rookproef", html.includes('data-foutgrens="het onderdeel Prognose"'));
check("zegt dat de rest nog werkt", html.includes("De rest van het dashboard werkt nog"));

const zonderTekst = renderToStaticMarkup(React.createElement(Foutmelding, { error: new Error(""), opnieuw: () => {}, waar: "deze pagina" }));
check("zonder melding: zegt dat er geen melding was, niet een lege regel", zonderTekst.includes("Onbekende fout zonder melding."));
check("zonder digest: geen foutcoderegel", !zonderTekst.includes("Foutcode"));

// Zonder fout rendert de grens gewoon zijn inhoud.
const goed = renderToStaticMarkup(React.createElement(OnderdeelGrens, { onderdeel: "Overzicht" }, React.createElement("p", null, "kerncijfer 1.246")));
check("zonder fout: de inhoud staat er, zonder melding", goed.includes("kerncijfer 1.246") && !goed.includes("data-foutgrens"), goed);

console.log(`foutgrens: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
