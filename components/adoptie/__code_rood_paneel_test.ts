// Test: wat het Code Rood-paneel zegt als er geen open meldingen zijn (code-rood-paneel.tsx).
// Draaien: tsx components/adoptie/__code_rood_paneel_test.ts
//
// Eerst gaf een lege lijst niets: geen paneel, geen regel. De detectie staat niet ingepland en legt
// niet vast wanneer hij draaide, dus "geen risico" en "nooit gekeken" zagen er hetzelfde uit
// (doorlichting 13 november). Een lege lijst moet nu zeggen dat er niet gecontroleerd is; met een
// open melding staat de melding er gewoon, zonder die regel.

import { createRequire } from "node:module";
import { CodeRoodLijst } from "./code-rood-paneel";
import type { CodeRoodMelding } from "@/lib/adoptie/use-code-rood";

const req = createRequire(__filename);
const React = req("react") as typeof import("react");
const { renderToStaticMarkup } = req("react-dom/server") as typeof import("react-dom/server");

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const reageer = async () => {};
const render = (meldingen: CodeRoodMelding[]) =>
  renderToStaticMarkup(React.createElement(CodeRoodLijst, { meldingen, magReageren: false, reageer }));

const leeg = render([]);
check("lege lijst rendert iets (niet null)", leeg.length > 0);
check("lege lijst zegt: niet gecontroleerd", /Niet gecontroleerd/.test(leeg), leeg);
check("lege lijst zegt niet dat alles in orde is", !/in orde|geen risico\b/i.test(leeg), leeg);

// Een afgehandelde melding is geen open melding: ook dan de regel.
const afgehandeld = render([{ id: "1", clientId: "demo-greentech", clientNaam: "GreenTech (demo)", licht: "rood",
  redenen: ["forecast 30% onder doel"], gedetecteerdOp: "2026-11-01", status: "afgewezen", gereageerdOp: "2026-11-02" }]);
check("alleen afgehandelde meldingen: ook niet gecontroleerd", /Niet gecontroleerd/.test(afgehandeld));

const open = render([{ id: "2", clientId: "demo-greentech", clientNaam: "GreenTech (demo)", licht: "rood",
  redenen: ["forecast 30% onder doel"], gedetecteerdOp: "2026-11-01", status: "open", gereageerdOp: null }]);
check("open melding: de klant en de reden staan er", open.includes("GreenTech (demo)") && open.includes("forecast 30% onder doel"));
check("open melding: geen niet-gecontroleerd-regel", !/Niet gecontroleerd/.test(open));

console.log(`code-rood-paneel: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
