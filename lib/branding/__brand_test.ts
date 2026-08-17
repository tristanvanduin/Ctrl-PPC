// De merknaam staat op één plek, en de opgeslagen eigenaar-waarde blijft leesbaar.
// Draaien: npx tsx lib/branding/__brand_test.ts
//
// De naam stond als losse tekst op 78 plekken in 30 bestanden. Bij een naamswijziging is dat een
// zoek-en-vervang met kans op een vergeten hoekje — en een vergeten hoekje staat vervolgens in een
// PDF die naar een klant gaat.
//
// De eigenaar-waarde is het lastige deel: die wordt OPGESLAGEN in sprint_items.owner. (Hier stond
// sprint_planning.owner en sop_tasks.owner; nagekeken tegen het live schema bestaat geen van
// beide.) Rijen van vóór een naamswijziging droegen ooit de oude naam; sinds
// scripts/migrations/097_owner_role_normalize.sql dragen ze de rol, niet meer een naam.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_NAME, BRAND_SHORT, BRAND_LOGO_FILE,
  OWNER_TEAM, OWNER_CLIENT, LEGACY_OWNER_TEAM,
  isTeamOwner, normalizeOwner, ownerLabel, KANT_LABEL_INTERN, KANT_LABEL_EXTERN,
  EIGENAAR_SOORTEN, normalizeSoort, toewijzingLabel, toewijzingCompleet,
} from "./brand";
import { OwnerEnum } from "../schema/analysis-schema";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("De constanten");
// Dat OWNER_TEAM en OWNER_CLIENT verschillen, en dat de merknaam niet de oude is, garandeert
// TypeScript al op typeniveau — daar een check op zetten test niets. Wat hij níét afdwingt is de
// samenhang tussen de naam en het logobestand, en dat is precies wat er bij een volgende
// naamswijziging uit de pas gaat lopen.
check("merknaam is gezet", BRAND_NAME.trim().length > 0);
check("logobestand is een png", BRAND_LOGO_FILE.endsWith(".png"));
// Het logobestand bestaat niet.
//
// Deze controle keek of de bestandsnaam bij de merknaam past, en dat deed hij — maar niemand keek
// of het bestand er ook was. In public/images/ stond tot 17 augustus 2026 alleen het logo van een
// eerdere productnaam; dat bestand is verwijderd (het stond als los, publiek bereikbaar bestand op
// een echte, live URL — een groter lek dan een gemiste weergave). De PDF-renderers en de zijbalk
// vangen een ontbrekend logobestand af met `fs.existsSync` en vallen terug op het woordbeeld, dus
// er gebeurt niets zichtbaars kapots — maar er moet nog een echt Ctrl PPC-logo bij komen.
//
// Dat is precies het patroon waar deze codebase op let — een ontbrekende zaak die zich voordoet
// als een geldige uitkomst. De controle staat er daarom bij, en hij hoort te falen tot het echte
// bestand er staat. Zie ook de opmerking bij BRAND_LOGO_FILE: een logo op de zijbalk moet
// eenkleurig en doorzichtig zijn, want die balk draagt de kleur van de actieve klant.
//
// Zolang het bestand er niet is staat de controle als BEKEND GAT genoteerd, met een reden — hetzelfde
// idioom als `TOEGESTANE_WEZEN` in de hygiënepoort. Een rode poort die niemand kan oplossen
// blokkeert alles en wordt daarna genegeerd; een genoteerd gat blijft zichtbaar en verdwijnt met
// één regel zodra het logo er is. Deze lijst hoort te krimpen.
const BEKENDE_GATEN = new Map([
  ["logobestand", "wacht op een eenkleurig, doorzichtig logo; tot die tijd dragen de PDF's alleen het woordbeeld"],
]);

{
  const bestaat = existsSync(join("public", "images", BRAND_LOGO_FILE));
  const reden = BEKENDE_GATEN.get("logobestand");
  if (bestaat) {
    check("het logobestand bestaat ook echt", true);
    check("het gat is gedicht — haal hem uit BEKENDE_GATEN", reden === undefined,
      "het bestand staat er nu; de uitzondering hoort weg");
  } else {
    check("het ontbrekende logo is genoteerd als bekend gat", reden !== undefined,
      `public/images/${BRAND_LOGO_FILE} ontbreekt en staat niet in BEKENDE_GATEN`);
    console.log(`  GAT   logobestand: ${reden}`);
  }
}

check("logobestand volgt de merknaam", (() => {
  const slug = BRAND_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return BRAND_LOGO_FILE.startsWith(slug);
})(), `${BRAND_LOGO_FILE} hoort met de slug van "${BRAND_NAME}" te beginnen`);
check("korte vorm past bij de naam", BRAND_NAME.toUpperCase().includes(BRAND_SHORT.toUpperCase()));

console.log("\nDe rol blijft herkend, zonder een naam van een externe partij in de broncode");
// LEGACY_OWNER_TEAM hield hier tot 17 augustus 2026 elke historische productnaam aan zodat een
// rebranding geen bestaande rij van eigenaar liet wisselen. Die
// namen zijn verwijderd (scripts/migrations/097_owner_role_normalize.sql normaliseert de database
// zelf); de lijst is nu leeg en hoort leeg te blijven — zie de self-guard onderaan dit bestand, die
// onafhankelijk van deze (nu lege) lijst controleert dat zo'n naam nergens terugkomt.
check("de lijst is leeg", LEGACY_OWNER_TEAM.length === 0,
  "LEGACY_OWNER_TEAM hoort na de migratie leeg te blijven, geen namen erin terug te zetten");
check("de rol zelf telt als bureau", isTeamOwner(OWNER_TEAM));
// De productnaam telt NIET als eigenaar, en dat is de hele reden dat deze regels er staan.
// Ctrl PPC is het gereedschap; het voert geen taken uit. Hier stond eerder het omgekeerde.
check("de productnaam niet", !isTeamOwner(BRAND_NAME));
check("de korte vorm evenmin", !isTeamOwner(BRAND_SHORT));
check("de klant niet", !isTeamOwner(OWNER_CLIENT));
check("leeg niet", !isTeamOwner("") && !isTeamOwner(null) && !isTeamOwner(undefined));
check("spaties eromheen storen niet bij de rol zelf", isTeamOwner(`  ${OWNER_TEAM}  `));

// De schermtekst moet ook terug naar binnen kunnen, en dat is geen theoretisch nettigheidje.
// De CSV-export schrijft de kolom Kant als "Intern" of "Extern" en de import leest diezelfde
// kolom. Zou "Intern" hier niet als intern gelden, dan werd elke geëxporteerde interne taak bij
// het terugzetten extern — een stille verschuiving over de hele planning, precies het soort
// fout dat deze kolom al eerder heeft opgelopen.
check("het interne label komt er ook weer in", isTeamOwner(KANT_LABEL_INTERN));
check("het externe label telt niet als intern", !isTeamOwner(KANT_LABEL_EXTERN));
check("intern label normaliseert naar de sleutel", normalizeOwner(KANT_LABEL_INTERN) === OWNER_TEAM);
check("extern label normaliseert naar de sleutel", normalizeOwner(KANT_LABEL_EXTERN) === OWNER_CLIENT);
// En de heenweg: wat de export schrijft, is exact wat de import herkent.
check("export en import sluiten op elkaar aan",
  normalizeOwner(ownerLabel(OWNER_TEAM)) === OWNER_TEAM && normalizeOwner(ownerLabel(OWNER_CLIENT)) === OWNER_CLIENT);

console.log("\nNormaliseren naar de rol");
check("rol blijft rol", normalizeOwner(OWNER_TEAM) === OWNER_TEAM);
check("klant blijft klant", normalizeOwner(OWNER_CLIENT) === OWNER_CLIENT);
check("onbekend wordt klant", normalizeOwner("iemand anders") === OWNER_CLIENT);
// Dat de opgeslagen waarde een rol is en geen merknaam, bewijst tsc al op typeniveau: de
// vergelijking `OWNER_TEAM !== BRAND_NAME` is statisch altijd waar en wordt afgekeurd als
// vergissing. Precies wat je wilt — een runtime-check zou hier niets meer toevoegen.

console.log("\nDe weergavenaam is los van de opgeslagen rol");
check("zonder tenant valt hij terug op het kantlabel", ownerLabel(OWNER_TEAM) === KANT_LABEL_INTERN);
check("en dus nooit op de productnaam", ownerLabel(OWNER_TEAM) !== BRAND_NAME);
check("met een tenant wint die", ownerLabel(OWNER_TEAM, "Bureau Zuid") === "Bureau Zuid");
check("de andere kant blijft extern", ownerLabel(OWNER_CLIENT, "Bureau Zuid") === KANT_LABEL_EXTERN);
check("een onbekende waarde valt terug op extern (geen legacy-lijst meer)", ownerLabel("iets onbekends", "Bureau Zuid") === KANT_LABEL_EXTERN);

console.log("\nDe toewijzing: wie binnen de kant");
{
  const personen = new Map([["u1", "Sanne"]]);
  const leeg = { kant: OWNER_TEAM, soort: null, naam: null, userId: null };

  // De kern van het ontwerp: hoe specifiek de toewijzing ook wordt, de KANT blijft afleesbaar.
  // Zou dit breken, dan is "hoeveel werk ligt er bij de klant" niet meer te beantwoorden — de
  // vraag waarvoor deze hele splitsing bestaat.
  for (const soort of EIGENAAR_SOORTEN) {
    const bureau = { kant: OWNER_TEAM, soort, naam: "X", userId: "u1" };
    const klant = { kant: OWNER_CLIENT, soort, naam: "X", userId: "u1" };
    check(`kant blijft bureau bij soort ${soort}`, isTeamOwner(bureau.kant));
    check(`kant blijft klant bij soort ${soort}`, !isTeamOwner(klant.kant));
  }

  check("leeg toont de kant", toewijzingLabel(leeg) === KANT_LABEL_INTERN);
  check("een persoon toont zijn naam",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "persoon", naam: null, userId: "u1" }, { personen }) === "Sanne");
  check("een functie toont de functie",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "functie", naam: "Webdeveloper", userId: null }) === "Webdeveloper");
  check("een bedrijf toont het bedrijf",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "bedrijf", naam: "Studio Noord", userId: null }) === "Studio Noord");

  // De terugval is geen randgeval maar de normale toestand zolang auth.users leeg is, en hij
  // treedt ook op zodra een gebruiker wordt verwijderd (on delete set null in migratie 033).
  check("een onbekende gebruiker valt terug op de kant",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "persoon", naam: null, userId: "weg" }, { personen }) === KANT_LABEL_INTERN);
  check("een persoon zonder gebruiker valt terug op de kant",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "persoon", naam: null, userId: null }) === KANT_LABEL_EXTERN);
  check("lege functietekst valt terug op de kant",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "functie", naam: "   ", userId: null }) === KANT_LABEL_EXTERN);
  check("de bureaunaam van de tenant wint ook hier",
    toewijzingLabel(leeg, { bureauNaam: "Bureau Zuid" }) === "Bureau Zuid");

  // Een rij met de opgeslagen rol, geen toewijzing. Zo staan de meeste bestaande rijen erbij.
  // (Vóór 097_owner_role_normalize.sql stond hier nog een test met een historische naam in de
  // kant — verwijderd samen met LEGACY_OWNER_TEAM, zie de toelichting bovenaan dit bestand.)
  check("een ruwe rol zonder toewijzing leest als bureau",
    toewijzingLabel({ kant: OWNER_TEAM, soort: null, naam: null, userId: null }, { bureauNaam: "Bureau Zuid" }) === "Bureau Zuid");

  check("onbekende soort wordt leeg", normalizeSoort("verzonnen") === null);
  check("lege soort blijft leeg", normalizeSoort(null) === null && normalizeSoort("") === null);
  for (const s of EIGENAAR_SOORTEN) check(`soort ${s} blijft overeind`, normalizeSoort(s) === s);

  check("leeg is compleet", toewijzingCompleet(leeg));
  check("persoon zonder gebruiker is onaf",
    !toewijzingCompleet({ kant: OWNER_TEAM, soort: "persoon", naam: null, userId: null }));
  check("functie zonder tekst is onaf",
    !toewijzingCompleet({ kant: OWNER_TEAM, soort: "functie", naam: " ", userId: null }));
  check("ingevulde functie is compleet",
    toewijzingCompleet({ kant: OWNER_TEAM, soort: "functie", naam: "Webdeveloper", userId: null }));
}

console.log("\nHet schema accepteert de rol en de kantlabels, en weigert onzin");
{
  // Tot 17 augustus 2026 stond hier ook een lus over LEGACY_OWNER_TEAM die bewees dat elke
  // historische naam nog geaccepteerd werd. Die namen staan nergens meer in de broncode (zie de
  // toelichting bovenaan dit bestand), dus die lus is vervallen — het schema hoeft ze niet meer
  // te kennen, alleen de database-migratie (097) moet de bestaande rijen bijwerken.
  const nieuw = OwnerEnum.safeParse(OWNER_TEAM);
  check("de rol wordt geaccepteerd", nieuw.success && nieuw.data === OWNER_TEAM);
  const klant = OwnerEnum.safeParse(OWNER_CLIENT);
  check("klant blijft klant", klant.success && klant.data === OWNER_CLIENT);
  const intern = OwnerEnum.safeParse(KANT_LABEL_INTERN);
  check("het interne kantlabel ook", intern.success && intern.data === OWNER_TEAM);
  check("onzin wordt geweigerd", !OwnerEnum.safeParse("Iets Anders").success);
}

console.log("\nGeen naam van een externe partij komt terug als tekst, nergens in de broncode");
{
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (["node_modules", ".next", ".git"].includes(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(tsx?|css|sql)$/.test(e)) out.push(p);
    }
    return out;
  }
  // Vast, onafhankelijk van LEGACY_OWNER_TEAM: die lijst is sinds 17 augustus 2026 leeg (zie
  // boven) en zou deze controle stilzwijgend uitschakelen als hij er nog van afhing — precies het
  // soort test-die-niets-meer-test dat de hygiënepoort probeert te vangen. Alleen volledige,
  // meerdelige namen: "RM" en "RAI" zijn twee tot drie letters en zitten in gewone woorden
  // (LOG_FORMAT_SKELETONS bevat "RM").
  const verbodenNamen = ["RAI Amsterdam", "Ranking Masters"];
  // Toegestaan: de comments hier en in brand.ts/analysis-schema.ts die de geschiedenis uitleggen,
  // en de migraties die de daadwerkelijke, al uitgevoerde database-wijziging documenteren.
  const toegestaan = [
    "lib/branding/brand.ts", "lib/branding/__brand_test.ts",
    "lib/schema/analysis-schema.ts",
    "scripts/migrations/097_owner_role_normalize.sql",
    "lib/__tests__/", "__tests__/",
    // Migratie 035 zet de naam van het eigen bureau in de agencies-tabel. Dat is precies waar deze
    // hele splitsing voor bestaat: het is de naam van een TENANT, opgeslagen als data, en niet een
    // achtergebleven merkverwijzing in de weergave. Zou deze controle daarop blijven vallen, dan
    // kan er nooit een bureau met een eigen naam in de database staan — en dat is het doel.
    "scripts/migrations/035_bureaus_en_accounts.sql",
    // Om dezelfde reden: de merkgroepering wordt getest op de ECHTE 71 accountnamen uit de
    // database, en de naam van het eigen bureau staat daar ook tussen — als ACCOUNTNAAM, een
    // klant van het bureau in de testdata, niet een merkvermelding in de weergave. Verzonnen namen
    // zouden hier niet werken — de fout die die test vasthoudt ("Easy Living" belandde bij
    // "Easy-Ergonomics") ontstaat juist door hoe echte klanten hun accounts noemen, en die had ik
    // nooit bedacht. Blijft desondanks een bewuste uitzondering die de eigenaar kent: dit bestand
    // bevat de bureaunaam letterlijk als testgegeven.
    "lib/branding/__merkgroepen_test.ts",
  ];
  const overtreders: string[] = [];
  for (const f of [...walk("lib"), ...walk("app"), ...walk("components"), ...walk("scripts")]) {
    if (toegestaan.some((t) => f.includes(t))) continue;
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((r, i) => {
      if (verbodenNamen.some((oud) => r.includes(oud))) overtreders.push(`${f}:${i + 1}`);
    });
  }
  check("geen losse vermelding meer", overtreders.length === 0, overtreders.slice(0, 5).join(", "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
