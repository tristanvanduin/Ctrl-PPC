// Het adoptie-stoplicht. Deterministisch, geen IO.
// Draaien: npx tsx lib/adoptie/__stoplicht_test.ts
//
// Een vast "nu", want anders verandert de uitkomst met de dag waarop de suite draait -- en een
// test die in november faalt omdat het november is, leert mensen om rood te negeren.

import {
  beoordeel, dagenGeleden, zwaarste,
  ADOPTIE_GOED, ADOPTIE_ZWAK, STIL_DAGEN_GOED, STIL_DAGEN_ZWAK,
  type BureauAdoptie,
} from "./stoplicht";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = new Date("2026-08-04T12:00:00Z");
const dagenTerug = (n: number) => new Date(NU.getTime() - n * 86_400_000).toISOString();

const bureau = (o: Partial<BureauAdoptie>): BureauAdoptie => ({
  bureau: "Test", gekoppeld: 10, actief: 8, adoptie: 80, laatstGezien: dagenTerug(1), ...o,
});

// ── dagenGeleden ──────────────────────────────────────────────────────────

check("nooit gezien geeft null", dagenGeleden(null, NU) === null);
check("onzin geeft null", dagenGeleden("geen datum", NU) === null);
check("vandaag is nul dagen", dagenGeleden(dagenTerug(0), NU) === 0);
check("zeven dagen terug", dagenGeleden(dagenTerug(7), NU) === 7);

// ── De drie lichten ───────────────────────────────────────────────────────

check("gezond bureau is groen", beoordeel(bureau({}), NU).licht === "groen");
check("halve bezetting is amber",
  beoordeel(bureau({ actief: 4, adoptie: 40 }), NU).licht === "amber");
check("bijna niemand actief is rood",
  beoordeel(bureau({ actief: 1, adoptie: 10 }), NU).licht === "rood");

// ── Geen gebruikers is GRIJS en niet rood ─────────────────────────────────
//
// Het onderscheid waar dit stoplicht op staat of valt. Een bureau zonder gekoppelde gebruikers is
// meestal nog niet ingericht; dat rood maken zet een verkoopgesprek in gang over een klant die
// nog niets heeft kunnen gebruiken. Dezelfde vorm als een leegte die zich voordoet als een meting.

{
  const o = beoordeel(bureau({ gekoppeld: 0, actief: 0, adoptie: null, laatstGezien: null }), NU);
  check("geen gebruikers is onbekend", o.licht === "onbekend", o.licht);
  check("en zegt waarom", /geen gebruikers gekoppeld/.test(o.reden), o.reden);
}

// Wél gekoppeld maar nooit ingelogd is een ANDER geval, en dat is wel rood.
{
  const o = beoordeel(bureau({ gekoppeld: 5, actief: 0, adoptie: 0, laatstGezien: null }), NU);
  check("gekoppeld maar nooit ingelogd is rood", o.licht === "rood", o.licht);
  check("en noemt het aantal", /5 gebruiker/.test(o.reden), o.reden);
}

// ── Stilte overrulet een mooi percentage ──────────────────────────────────
//
// Een bureau met één gebruiker die zes weken weg is heeft 100 % adoptie zolang je alleen naar de
// verhouding kijkt. Zonder deze voorrang zou dat groen zijn.

{
  const o = beoordeel(bureau({ gekoppeld: 1, actief: 1, adoptie: 100, laatstGezien: dagenTerug(42) }), NU);
  check("zes weken stil is rood ondanks 100 %", o.licht === "rood", `${o.licht} — ${o.reden}`);
  check("de reden noemt de stilte", /42 dagen/.test(o.reden), o.reden);
}
{
  const o = beoordeel(bureau({ adoptie: 100, actief: 10, laatstGezien: dagenTerug(20) }), NU);
  check("drie weken stil is amber ondanks 100 %", o.licht === "amber", `${o.licht} — ${o.reden}`);
}

// ── Precies op de drempels ────────────────────────────────────────────────
//
// Randen expliciet, want "meer dan" en "vanaf" schelen één dag en dat verschil verdwijnt in een
// herschrijving zonder dat een test het merkt.

check(`adoptie precies ${ADOPTIE_GOED} is groen`,
  beoordeel(bureau({ adoptie: ADOPTIE_GOED }), NU).licht === "groen");
check(`adoptie net onder ${ADOPTIE_GOED} is amber`,
  beoordeel(bureau({ adoptie: ADOPTIE_GOED - 1 }), NU).licht === "amber");
check(`adoptie precies ${ADOPTIE_ZWAK} is amber`,
  beoordeel(bureau({ adoptie: ADOPTIE_ZWAK }), NU).licht === "amber");
check(`adoptie net onder ${ADOPTIE_ZWAK} is rood`,
  beoordeel(bureau({ adoptie: ADOPTIE_ZWAK - 1 }), NU).licht === "rood");
check(`precies ${STIL_DAGEN_GOED} dagen stil telt nog niet als stil`,
  beoordeel(bureau({ laatstGezien: dagenTerug(STIL_DAGEN_GOED) }), NU).licht === "groen");
check(`${STIL_DAGEN_GOED + 1} dagen stil is amber`,
  beoordeel(bureau({ laatstGezien: dagenTerug(STIL_DAGEN_GOED + 1) }), NU).licht === "amber");
check(`precies ${STIL_DAGEN_ZWAK} dagen stil is nog amber`,
  beoordeel(bureau({ laatstGezien: dagenTerug(STIL_DAGEN_ZWAK) }), NU).licht === "amber");
check(`${STIL_DAGEN_ZWAK + 1} dagen stil is rood`,
  beoordeel(bureau({ laatstGezien: dagenTerug(STIL_DAGEN_ZWAK + 1) }), NU).licht === "rood");

// ── Elke uitkomst draagt een reden ────────────────────────────────────────

for (const geval of [
  bureau({}), bureau({ adoptie: 40, actief: 4 }), bureau({ adoptie: 5, actief: 1 }),
  bureau({ gekoppeld: 0, actief: 0, adoptie: null, laatstGezien: null }),
  bureau({ laatstGezien: dagenTerug(99) }),
]) {
  const o = beoordeel(geval, NU);
  check(`${o.licht} draagt een reden`, o.reden.trim().length > 5, JSON.stringify(o));
}

// ── Zwaarste ──────────────────────────────────────────────────────────────

check("rood wint", zwaarste(["groen", "amber", "rood"]) === "rood");
check("amber wint van groen", zwaarste(["groen", "amber"]) === "amber");
check("alleen onbekend blijft onbekend", zwaarste(["onbekend", "onbekend"]) === "onbekend");
check("groen wint van onbekend", zwaarste(["onbekend", "groen"]) === "groen");
check("leeg is onbekend", zwaarste([]) === "onbekend");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
