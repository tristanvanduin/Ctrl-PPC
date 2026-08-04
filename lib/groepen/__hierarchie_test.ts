// De twee groeperingsassen. Deterministisch, geen IO.
// Draaien: npx tsx lib/groepen/__hierarchie_test.ts
//
// Twee dingen worden hier vastgehouden. Ten eerste dat elk account precies ÉÉN keer in de boom
// staat -- dat is de hele reden dat deze functie bestaat, want de zijbalk zette de groepen plat
// naast elkaar en toonde een account dat zowel een merk als een specialist heeft twee keer.
//
// Ten tweede de schaal die de aanleiding was: veertig specialisten en achthonderd accounts. Niet
// omdat een timing-test in een suite thuishoort, maar omdat de vorige opzet daar kwadratisch werd
// en dat pas zichtbaar is als je die aantallen echt doorrekent.

import { bouwHierarchie, beschikbareAssen, REST, type GroepInvoer } from "./hierarchie";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const klanten = [
  { id: "mpc-be", name: "MPC - BE" }, { id: "mpc-de", name: "MPC - DE" },
  { id: "mpc-fr", name: "MPC - FR" }, { id: "los", name: "Losse klant" },
];

const groepen: GroepInvoer[] = [
  { id: "g-mpc", name: "MPC", soort: "merk", bevestigd: true, clientIds: ["mpc-be", "mpc-de", "mpc-fr"] },
  { id: "g-edwin", name: "Edwin", soort: "specialist", bevestigd: true, clientIds: ["mpc-be", "mpc-de"] },
  { id: "g-sara", name: "Sara", soort: "specialist", bevestigd: true, clientIds: ["mpc-fr", "los"] },
  { id: "g-voorstel", name: "Nieuw merk", soort: "merk", bevestigd: false, clientIds: [] },
];

// ── Eén as ────────────────────────────────────────────────────────────────

{
  const boom = bouwHierarchie(klanten, groepen, "merk");
  check("twee takken: MPC en de restbak", boom.length === 2, boom.map((t) => t.naam).join(", "));
  check("MPC heeft er drie", boom[0].naam === "MPC" && boom[0].klanten.length === 3);
  check("de losse klant valt in de restbak", boom[1].naam === REST && boom[1].klanten[0].id === "los");
  // Een lege groep hoort niet als lege tak in de zijbalk te staan.
  check("een groep zonder leden verschijnt niet", !boom.some((t) => t.naam === "Nieuw merk"));
}

// ── Twee assen ────────────────────────────────────────────────────────────

{
  const boom = bouwHierarchie(klanten, groepen, "merk", "specialist");
  const mpc = boom.find((t) => t.naam === "MPC")!;
  check("MPC valt uiteen in twee specialisten", mpc.takken.length === 2, mpc.takken.map((t) => t.naam).join(", "));
  check("Edwin heeft BE en DE", mpc.takken[0].naam === "Edwin" && mpc.takken[0].klanten.length === 2);
  check("Sara heeft FR", mpc.takken[1].naam === "Sara" && mpc.takken[1].klanten.length === 1);
  check("het aantal op de hoofdtak telt de subtakken", mpc.aantal === 3, String(mpc.aantal));
  check("klanten hangen onder de subtak, niet dubbel erboven", mpc.klanten.length === 0);
}

// ── DE FOUT DIE DEZE FUNCTIE MOET VOORKOMEN ───────────────────────────────
//
// Plat naast elkaar zou mpc-be onder "MPC" én onder "Edwin" staan. In de boom staat elk account
// precies één keer, op elk niveau geteld.

for (const [primair, secundair] of [["merk", null], ["merk", "specialist"], ["specialist", "merk"]] as const) {
  const boom = bouwHierarchie(klanten, groepen, primair, secundair);
  const alle: string[] = [];
  const loop = (takken: typeof boom) => {
    for (const t of takken) { alle.push(...t.klanten.map((k) => k.id)); loop(t.takken); }
  };
  loop(boom);
  const uniek = new Set(alle);
  check(`${primair}/${secundair ?? "-"}: elk account precies één keer`,
    alle.length === uniek.size && uniek.size === klanten.length,
    `${alle.length} plaatsingen, ${uniek.size} unieke, ${klanten.length} klanten`);
}

// ── Beschikbare assen ─────────────────────────────────────────────────────

check("beide assen gevonden", beschikbareAssen(groepen).join(",") === "merk,specialist");
check("geen soort, geen as", beschikbareAssen([{ ...groepen[0], soort: null }]).length === 0);

// ── Schaal: 40 specialisten, 800 accounts ─────────────────────────────────

{
  const veel = Array.from({ length: 800 }, (_, i) => ({ id: `a${i}`, name: `Account ${i}` }));
  const merken: GroepInvoer[] = Array.from({ length: 80 }, (_, m) => ({
    id: `m${m}`, name: `Merk ${m}`, soort: "merk", bevestigd: true,
    clientIds: veel.slice(m * 10, m * 10 + 10).map((k) => k.id),
  }));
  const specialisten: GroepInvoer[] = Array.from({ length: 40 }, (_, s) => ({
    id: `s${s}`, name: `Specialist ${s}`, soort: "specialist", bevestigd: true,
    clientIds: veel.filter((_, i) => i % 40 === s).map((k) => k.id),
  }));

  const start = Date.now();
  const boom = bouwHierarchie(veel, [...merken, ...specialisten], "merk", "specialist");
  const duur = Date.now() - start;

  check("80 merktakken", boom.length === 80, String(boom.length));
  const totaal = boom.reduce((s, t) => s + t.aantal, 0);
  check("alle 800 accounts geplaatst", totaal === 800, String(totaal));

  const alle = new Set<string>();
  let dubbel = 0;
  for (const t of boom) for (const sub of t.takken) for (const k of sub.klanten) {
    if (alle.has(k.id)) dubbel += 1;
    alle.add(k.id);
  }
  check("geen enkel account dubbel bij 800", dubbel === 0, `${dubbel} dubbel`);
  check("alle 800 in de bladeren", alle.size === 800, String(alle.size));

  // Ruime grens: het gaat om de ORDE. Kwadratisch (800 × 120 groepen per account nalopen) loopt
  // hier ver overheen; lineair blijft ruim eronder, ook op een trage machine.
  check("blijft ruim onder 200ms", duur < 200, `${duur}ms`);
  console.log(`  (800 accounts, 120 groepen: ${duur}ms)`);
}


// ── Groepen zonder soort ──────────────────────────────────────────────────
//
// De regressie die dit vasthoudt: drie van de vier groepen in de echte database zijn gemaakt
// voordat `soort` bestond en staan op null. Zou de zijbalk alleen op soort groeperen, dan waren
// die mappen na een update spoorloos -- zonder foutmelding en zonder uitleg. De zijbalk vult ze
// daarom aan tot "vrij"; hier staat wat er gebeurt als dat NIET gebeurt, zodat de reden zichtbaar
// blijft als iemand die aanvulling ooit weghaalt.
{
  const zonderSoort: GroepInvoer[] = [
    { id: "g1", name: "Oude map", soort: null, bevestigd: true, clientIds: ["mpc-be", "mpc-de"] },
  ];
  check("een groep zonder soort levert geen as op", beschikbareAssen(zonderSoort).length === 0);

  const aangevuld = zonderSoort.map((g) => ({ ...g, soort: g.soort ?? ("vrij" as const) }));
  check("aangevuld tot vrij levert wel een as", beschikbareAssen(aangevuld).join(",") === "vrij");
  const boom = bouwHierarchie(klanten, aangevuld, "vrij");
  check("en de oude map staat er weer", boom[0].naam === "Oude map" && boom[0].klanten.length === 2,
    boom.map((t) => `${t.naam}(${t.aantal})`).join(", "));
  check("de rest valt in de restbak", boom[1].naam === REST && boom[1].aantal === 2);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
