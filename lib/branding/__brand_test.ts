// De merknaam staat op één plek, en de opgeslagen eigenaar-waarde blijft leesbaar.
// Draaien: npx tsx lib/branding/__brand_test.ts
//
// De naam stond als losse tekst op 78 plekken in 30 bestanden. Bij een naamswijziging is dat een
// zoek-en-vervang met kans op een vergeten hoekje — en een vergeten hoekje staat vervolgens in een
// PDF die naar een klant gaat.
//
// De eigenaar-waarde is het lastige deel: die wordt OPGESLAGEN in sprint_items.owner. (Hier stond
// sprint_planning.owner en sop_tasks.owner; nagekeken tegen het live schema bestaat geen van beide
// — dezelfde fout die scripts/rename-owner-to-rai.sql bijna liet afbreken.) Rijen van vóór de
// wijziging dragen de oude naam en mogen niet ineens ongeldig worden of als klant-taken tellen.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_NAME, BRAND_SHORT, BRAND_LOGO_FILE,
  OWNER_TEAM, OWNER_CLIENT, LEGACY_OWNER_TEAM,
  isTeamOwner, normalizeOwner, ownerLabel,
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
// of het bestand er ook was. In public/images/ staat alleen `ranking-masters-logo.png`, van twee
// naamswijzigingen geleden. Sinds de vorige rebranding verwijzen de PDF-renderers dus naar een
// bestand dat er niet is, en omdat ze dat afvangen met `fs.existsSync` gebeurt er niets zichtbaars:
// de klant krijgt een PDF met alleen het woordbeeld en niemand merkt het.
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

console.log("\nElke ooit opgeslagen schrijfwijze blijft herkend");
// Dit is de kern van het loskoppelen van naam en rol: een rebranding mag geen enkele bestaande
// rij van eigenaar laten wisselen. Zou "RAI Amsterdam" hier niet meer als team gelden, dan telde
// elke taak van vóór de naamswijziging ineens als klant-taak.
for (const oud of LEGACY_OWNER_TEAM) {
  check(`"${oud}" telt als bureau`, isTeamOwner(oud));
  check(`"${oud}" normaliseert naar de rol`, normalizeOwner(oud) === OWNER_TEAM);
}
check("de rol zelf ook", isTeamOwner(OWNER_TEAM));
// De productnaam telt NIET als eigenaar, en dat is de hele reden dat deze regels er staan.
// Ctrl PPC is het gereedschap; het voert geen taken uit. Hier stond eerder het omgekeerde.
check("de productnaam niet", !isTeamOwner(BRAND_NAME));
check("de korte vorm evenmin", !isTeamOwner(BRAND_SHORT));
check("de klant niet", !isTeamOwner(OWNER_CLIENT));
check("leeg niet", !isTeamOwner("") && !isTeamOwner(null) && !isTeamOwner(undefined));
check("spaties eromheen storen niet", isTeamOwner(`  ${LEGACY_OWNER_TEAM[0]}  `));

console.log("\nNormaliseren naar de rol");
check("rol blijft rol", normalizeOwner(OWNER_TEAM) === OWNER_TEAM);
check("klant blijft klant", normalizeOwner(OWNER_CLIENT) === OWNER_CLIENT);
check("onbekend wordt klant", normalizeOwner("iemand anders") === OWNER_CLIENT);
// Dat de opgeslagen waarde een rol is en geen merknaam, bewijst tsc al op typeniveau: de
// vergelijking `OWNER_TEAM !== BRAND_NAME` is statisch altijd waar en wordt afgekeurd als
// vergissing. Precies wat je wilt — een runtime-check zou hier niets meer toevoegen.

console.log("\nDe weergavenaam is los van de opgeslagen rol");
check("zonder tenant valt hij terug op de rol", ownerLabel(OWNER_TEAM) === OWNER_TEAM);
check("en dus nooit op de productnaam", ownerLabel(OWNER_TEAM) !== BRAND_NAME);
check("met een tenant wint die", ownerLabel(OWNER_TEAM, "Bureau Zuid") === "Bureau Zuid");
check("een klant-taak blijft de klant", ownerLabel(OWNER_CLIENT, "Bureau Zuid") === OWNER_CLIENT);
check("een oude naam krijgt de huidige weergave", ownerLabel("Ranking Masters", "Bureau Zuid") === "Bureau Zuid");

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

  check("leeg toont de kant", toewijzingLabel(leeg) === OWNER_TEAM);
  check("een persoon toont zijn naam",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "persoon", naam: null, userId: "u1" }, { personen }) === "Sanne");
  check("een functie toont de functie",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "functie", naam: "Webdeveloper", userId: null }) === "Webdeveloper");
  check("een bedrijf toont het bedrijf",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "bedrijf", naam: "Studio Noord", userId: null }) === "Studio Noord");

  // De terugval is geen randgeval maar de normale toestand zolang auth.users leeg is, en hij
  // treedt ook op zodra een gebruiker wordt verwijderd (on delete set null in migratie 033).
  check("een onbekende gebruiker valt terug op de kant",
    toewijzingLabel({ kant: OWNER_TEAM, soort: "persoon", naam: null, userId: "weg" }, { personen }) === OWNER_TEAM);
  check("een persoon zonder gebruiker valt terug op de kant",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "persoon", naam: null, userId: null }) === OWNER_CLIENT);
  check("lege functietekst valt terug op de kant",
    toewijzingLabel({ kant: OWNER_CLIENT, soort: "functie", naam: "   ", userId: null }) === OWNER_CLIENT);
  check("de bureaunaam van de tenant wint ook hier",
    toewijzingLabel(leeg, { bureauNaam: "Bureau Zuid" }) === "Bureau Zuid");

  // Een historische rij: ruwe naam in de kant, geen toewijzing. Zo staan alle 49 bestaande rijen
  // erbij, en die moeten zonder migratie meteen goed lezen.
  check("een oude bureaunaam leest nog als bureau",
    toewijzingLabel({ kant: "RAI Amsterdam", soort: null, naam: null, userId: null }, { bureauNaam: "Bureau Zuid" }) === "Bureau Zuid");

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

console.log("\nHet schema accepteert beide en levert één waarde");
{
  for (const oudeNaam of LEGACY_OWNER_TEAM) {
    const oud = OwnerEnum.safeParse(oudeNaam);
    check(`"${oudeNaam}" wordt geaccepteerd`, oud.success, JSON.stringify(oud));
    check(`"${oudeNaam}" komt er als de rol uit`, oud.success && oud.data === OWNER_TEAM, oud.success ? oud.data : "");
  }
  const nieuw = OwnerEnum.safeParse(OWNER_TEAM);
  check("de nieuwe waarde ook", nieuw.success && nieuw.data === OWNER_TEAM);
  const klant = OwnerEnum.safeParse(OWNER_CLIENT);
  check("klant blijft klant", klant.success && klant.data === OWNER_CLIENT);
  check("onzin wordt geweigerd", !OwnerEnum.safeParse("Iets Anders").success);
}

console.log("\nDe oude naam staat nergens meer als weergavetekst");
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
  // Toegestaan: de legacy-constante zelf, de comments die hem uitleggen, het migratiescript en
  // de tests die de terugwaartse compatibiliteit bewijzen.
  const toegestaan = [
    "lib/branding/brand.ts", "lib/branding/__brand_test.ts",
    "lib/schema/analysis-schema.ts", "scripts/rename-owner-to-rai.sql",
    "lib/__tests__/", "__tests__/",
    // RAI Amsterdam is hier geen productnaam maar een KLANT in de demolijst. Na de rebranding is
    // dat juist correct: het bureau heet Ctrl PPC, RAI Amsterdam is een van zijn klanten.
    "lib/clients.ts",
  ];
  const overtreders: string[] = [];
  for (const f of [...walk("lib"), ...walk("app"), ...walk("components"), ...walk("scripts")]) {
    if (toegestaan.some((t) => f.includes(t))) continue;
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((r, i) => {
      // Alleen de volledige namen, niet de korte vormen. "RM" en "RAI" zijn twee tot drie letters
      // en zitten in gewone woorden: LOG_FORMAT_SKELETONS bevat "RM", en die meldde deze controle
      // als een losse merkvermelding. Waar het om gaat is de naam als weergavetekst, en die is
      // altijd meerdelig.
      const volledigeNamen = LEGACY_OWNER_TEAM.filter((n) => n.includes(" "));
      if (volledigeNamen.some((oud) => r.includes(oud))) overtreders.push(`${f}:${i + 1}`);
    });
  }
  check("geen losse vermelding meer", overtreders.length === 0, overtreders.slice(0, 5).join(", "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
