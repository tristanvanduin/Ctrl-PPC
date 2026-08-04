// De merkgroepering tegen de ECHTE accountnamen. Deterministisch, geen IO.
// Draaien: npx tsx lib/branding/__merkgroepen_test.ts
//
// De namen hieronder zijn alle 71 accounts zoals ze in de database staan, letterlijk overgenomen.
// Dat is met opzet: een test op verzonnen namen bewijst dat het algoritme doet wat ik bedacht,
// niet dat het klopt op wat er werkelijk in staat. De fout die deze test moet vasthouden — "Easy
// Living" bij "Easy-Ergonomics" — was met verzonnen namen nooit gevonden, want ik zou nooit twee
// klanten hebben verzonnen die allebei met "Easy" beginnen.

import { stelMerkgroepenVoor, stamViaRegio, stamViaScheiding } from "./merkgroepen";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const ACCOUNTS = [
  "9altitudes België", "9altitudes Nederland bv", "Aicro.io", "Asadlie", "Basics & Trends",
  "Basim Veiligheidsgroep", "BotanicalGroup B.V.", "Broedservice", "Bruidsmode Haarlem",
  "Buitengevel.nl", "Crystalli HU", "Dachlux", "Daklichtshop", "De Barrenfabriek",
  "DEMO — GreenTech (fictief)", "Dermaparadise", "Docubird", "Doe het zelf veranda",
  "Easy Living (€2.000 p/m)", "Easy-Ergonomics BE", "Easy-Ergonomics DE", "Easy-Ergonomics NL",
  "Evensis Media BV", "Fit-fysiotherapie", "Garten Möbel Für Dich", "GC - General", "Germany",
  "GMU [Live] - Bella Fit NL (350% / €2000 | >350% Uncapped)",
  "GoedeInnovaties - Confidenceforal", "GoedeInnovaties - Wobblez",
  "GoedeInnovaties - Zeemeerminnenfeest", "Google Ads-account ByLebon", "Greencademy", "GSMweb",
  "Hijsfijn", "Huma Official", "Ikwiltuinmeubelen", "Islamitische Boekhandel",
  "Kinderkamerwebwinkel", "Koffie Ambulance", "Marketing Bureau Assistent", "Minismus",
  "Mobiliteitexpert", "Mobility Concept B.V.", "MPC - BE (new)", "MPC - DE", "MPC - FR",
  "MPC - General", "MPC - NL", "MPC - UK", "NOX Amsterdam", "OhOhDenHaag Kroegentocht",
  "Online Muziek Academie", "Perfolax", "Piramide Schrijven", "Piscinarobots", "Ranking Masters",
  "RioolNed Oud", "Sabé Verpakkingen", "Sanus Corpus Diagnostiek", "Schuldsanering Nederland",
  "Sharpevents", "SlaapTEQ", "Symbis", "Tomasso Tables (new)", "Travel Your Memories",
  "Van Den Broek Herenmode", "verlichtinggroothandel.nl", "Vlakkelichtkoepel.nl", "Wavevents",
  "WTR Ontharders",
];

// ── De twee regels apart ───────────────────────────────────────────────────

check("regiosuffix vindt het land", stamViaRegio("Easy-Ergonomics BE") === "Easy-Ergonomics");
check("regiosuffix door haakjes heen", stamViaRegio("MPC - BE (new)") === "MPC", String(stamViaRegio("MPC - BE (new)")));
check("regiosuffix door een rechtsvorm heen", stamViaRegio("9altitudes Nederland bv") === "9altitudes");
check("een naam die alleen maar een land IS levert niets", stamViaRegio("Germany") === null);
check("zonder regio geen stam", stamViaRegio("Easy Living (€2.000 p/m)") === null, String(stamViaRegio("Easy Living (€2.000 p/m)")));
check("scheidingsteken vindt het deel ervoor", stamViaScheiding("GoedeInnovaties - Wobblez") === "GoedeInnovaties");
check("zonder scheidingsteken geen stam", stamViaScheiding("Easy-Ergonomics BE") === null);
// "Easy-Ergonomics" heeft een koppelteken zónder spaties; dat is deel van de naam en geen
// scheidingsteken. Zou de regel ook op een kaal koppelteken matchen, dan werd de stam "Easy" en
// zou Easy Living er alsnog bij komen -- via de andere regel dan.
check("een koppelteken binnen een woord is geen scheiding", stamViaScheiding("Fit-fysiotherapie") === null);

// ── Op de echte 71 ─────────────────────────────────────────────────────────

const groepen = stelMerkgroepenVoor(ACCOUNTS);
const perStam = new Map(groepen.map((g) => [g.stam.toLowerCase(), g]));

check("vier groepen", groepen.length === 4, groepen.map((g) => `${g.stam}(${g.accounts.length})`).join(", "));

const mpc = perStam.get("mpc");
check("MPC heeft zes accounts", mpc?.accounts.length === 6, String(mpc?.accounts.length));
check("MPC komt uit beide regels", (mpc?.regels.length ?? 0) === 2, mpc?.regels.join(","));

const easy = perStam.get("easy-ergonomics");
check("Easy-Ergonomics heeft er drie", easy?.accounts.length === 3, easy?.accounts.join(", "));
// DE FOUT DIE DEZE TEST VASTHOUDT.
check(
  "Easy Living hoort er NIET bij",
  !(easy?.accounts ?? []).some((n) => n.startsWith("Easy Living")),
  easy?.accounts.join(", ")
);
check("Easy Living zit in geen enkele groep",
  !groepen.some((g) => g.accounts.some((n) => n.startsWith("Easy Living"))));

const negen = perStam.get("9altitudes");
check("9altitudes heeft er twee", negen?.accounts.length === 2, negen?.accounts.join(", "));

const goede = perStam.get("goedeinnovaties");
check("GoedeInnovaties heeft er drie", goede?.accounts.length === 3, goede?.accounts.join(", "));
check("GoedeInnovaties komt alleen van het scheidingsteken",
  goede?.regels.join(",") === "scheidingsteken", goede?.regels.join(","));

// ── Wat er juist NIET gegroepeerd mag worden ───────────────────────────────

check("GC - General blijft alleen", !perStam.has("gc"), JSON.stringify(perStam.get("gc")?.accounts));
check("Crystalli HU blijft alleen", !perStam.has("crystalli"));
check("Germany zit in geen enkele groep",
  !groepen.some((g) => g.accounts.includes("Germany")));

// Elke groep heeft minstens twee accounts en minstens één regel. Een groep zonder reden is
// precies wat dit bestand wil voorkomen.
for (const g of groepen) {
  check(`${g.stam} heeft ≥2 accounts`, g.accounts.length >= 2);
  check(`${g.stam} draagt een reden`, g.regels.length >= 1);
}

// Geen account in twee groepen: dan zou een vergelijking hem dubbel tellen.
{
  const gezien = new Map<string, string>();
  let dubbel = "";
  for (const g of groepen) for (const n of g.accounts) {
    if (gezien.has(n)) dubbel = `${n}: ${gezien.get(n)} én ${g.stam}`;
    gezien.set(n, g.stam);
  }
  check("geen account in twee groepen", dubbel === "", dubbel);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
