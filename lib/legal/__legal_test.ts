// Test voor de juridische documenten en de conceptpoort eromheen.
// Draaien: npx tsx lib/legal/__legal_test.ts
//
// De inzet hier is niet "rendert de pagina". Het is dat een juridisch document nooit stilzwijgend
// als definitief kan gaan gelden terwijl er nog een gat in zit, en dat er geen gat op de pagina
// kan komen die niemand ziet. Twee kanten van dezelfde fout, allebei duur.

import {
  BEDRIJFSGEGEVENS, VELDLABELS, VERPLICHTE_VELDEN,
  isDefinitief, ontbrekendeVelden, type Bedrijfsgegevens,
} from "./bedrijfsgegevens";
import {
  ALGEMENE_VOORWAARDEN, JURIDISCHE_DOCUMENTEN, PRIVACY_STATEMENT, parseInline,
  type Blok, type JuridischDocument,
} from "./documenten";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

/** Een volledig ingevulde set, zoals het eruitziet als de eigenaar de gegevens heeft aangeleverd. */
const COMPLEET: Bedrijfsgegevens = {
  handelsnaam: "Ctrl PPC B.V.",
  vestigingsplaats: "Amsterdam",
  vestigingsadres: "Voorbeeldstraat 1, 1000 AA Amsterdam",
  kvkNummer: "12345678",
  btwNummer: "NL001234567B01",
  contactEmail: "privacy@ctrlppc.com",
  arrondissement: "Amsterdam",
  betalingstermijnDagen: 14,
  opzegtermijn: "één kalendermaand",
  aansprakelijkheidscapMaanden: 6,
  aansprakelijkheidscapMaximum: null,
  wijzigingstermijnDagen: 30,
  overmachtstermijnDagen: 60,
  cookiegebruik: "functionele en analytische",
  cookieInstellingen: "de cookiebanner onderaan elke pagina",
  supabaseRegio: "EU (Frankfurt)",
  vercelRegio: "EU (Frankfurt)",
  versie: "1.0",
  laatstGewijzigd: "2026-08-24",
};

// ── De conceptpoort ────────────────────────────────────────────────────────

assert(!isDefinitief(BEDRIJFSGEGEVENS), "de huidige, lege gegevens leveren een concept op");
assert(isDefinitief(COMPLEET), "een volledig ingevulde set is definitief");

assert(
  ontbrekendeVelden(BEDRIJFSGEGEVENS).length === VERPLICHTE_VELDEN.length,
  "met niets ingevuld ontbreekt elk verplicht veld"
);
// De cast is nodig omdat TypeScript het uitgesloten veld al uit het type van VERPLICHTE_VELDEN
// heeft weggefilterd (het leidt het type-predicaat uit de filter-callback zelf af). Dat is precies
// wat we willen, maar het maakt de controle op waarde-niveau anders onmogelijk om op te schrijven.
assert(
  !(VERPLICHTE_VELDEN as readonly string[]).includes("aansprakelijkheidscapMaximum"),
  "het optionele aansprakelijkheidsmaximum telt niet mee voor 'definitief'"
);

// Eén veld leeg is genoeg om het concept te houden. Dit is de kern van de poort: hij mag niet
// "bijna af" als af behandelen, en niet op één specifiek veld hangen dat iemand ooit koos.
for (const veld of VERPLICHTE_VELDEN) {
  const bijnaCompleet = { ...COMPLEET, [veld]: null };
  assert(!isDefinitief(bijnaCompleet), `een leeg ${veld} houdt het document een concept`);
}

// Witruimte is geen waarde: " " in een KvK-veld is een vergissing, geen ingevuld nummer.
assert(!isDefinitief({ ...COMPLEET, kvkNummer: "   " }), "witruimte telt niet als ingevuld");

assert(
  VERPLICHTE_VELDEN.every((v) => typeof VELDLABELS[v] === "string" && VELDLABELS[v].length > 0),
  "elk verplicht veld heeft een leesbaar label voor de bezoeker"
);

// ── De inline-parser ───────────────────────────────────────────────────────

assert(
  JSON.stringify(parseInline("gewone tekst", COMPLEET)) ===
    JSON.stringify([{ soort: "tekst", tekst: "gewone tekst" }]),
  "tekst zonder tokens blijft één tekstnode"
);

const nadruk = parseInline("een **vet** stuk", COMPLEET);
assert(nadruk.length === 3 && nadruk[1].soort === "nadruk", "**...** wordt een nadruk-node");

const gevuld = parseInline("KvK {{kvkNummer}}", COMPLEET);
assert(
  gevuld.some((n) => n.soort === "waarde" && n.tekst === "12345678"),
  "een gevuld veld komt als waarde in de tekst"
);

const leeg = parseInline("KvK {{kvkNummer}}", BEDRIJFSGEGEVENS);
assert(
  leeg.some((n) => n.soort === "ontbreekt" && n.label === "KvK-nummer"),
  "een leeg veld wordt een zichtbare ontbreekt-markering met het leesbare label"
);
assert(
  !leeg.some((n) => n.soort === "tekst" && n.tekst.includes("kvkNummer")),
  "de veldnaam uit de code lekt niet naar de pagina"
);

const getal = parseInline("binnen {{betalingstermijnDagen}} dagen", COMPLEET);
assert(
  getal.some((n) => n.soort === "waarde" && n.tekst === "14"),
  "een getal wordt als tekst weergegeven, zonder eenheid erbij te verzinnen"
);

const link = parseInline("zie het [[Privacy Statement|/privacy]] hiervoor", COMPLEET);
assert(
  link.some((n) => n.soort === "link" && n.href === "/privacy" && n.tekst === "Privacy Statement"),
  "[[label|/pad]] wordt een link-node"
);

// Het optionele aansprakelijkheidsmaximum: niet ingevuld betekent hier "geldt niet", niet "weten
// we nog niet" -- de bijzin hoort dan spoorloos te verdwijnen, zonder markering.
const zonderMax = parseInline("...voortvloeit.{{capMaximumZin}}", COMPLEET);
assert(
  zonderMax.length === 1 && !JSON.stringify(zonderMax).includes("ontbreekt"),
  "zonder absoluut maximum verdwijnt de bijzin zonder een gat achter te laten"
);
const metMax = parseInline("...voortvloeit.{{capMaximumZin}}", {
  ...COMPLEET, aansprakelijkheidscapMaximum: "€ 25.000",
});
assert(
  JSON.stringify(metMax).includes("€ 25.000"),
  "met een absoluut maximum staat de bijzin er wel"
);

// ── De documenten zelf ─────────────────────────────────────────────────────

function alleTeksten(doc: JuridischDocument): string[] {
  const uit: string[] = [doc.inleiding, doc.slotnoot, doc.taalnoot];
  for (const par of doc.paragrafen) {
    uit.push(par.titel, par.korteTitel);
    for (const blok of par.blokken as Blok[]) {
      if (blok.soort === "alinea" || blok.soort === "subkop") uit.push(blok.tekst);
      else if (blok.soort === "lijst" || blok.soort === "genummerd") uit.push(...blok.items);
      else uit.push(...blok.koppen, ...blok.rijen.flat());
    }
  }
  return uit;
}

assert(PRIVACY_STATEMENT.paragrafen.length === 11, "het Privacy Statement heeft elf paragrafen");
assert(ALGEMENE_VOORWAARDEN.paragrafen.length === 17, "de Algemene Voorwaarden hebben zeventien artikelen");

for (const doc of JURIDISCHE_DOCUMENTEN) {
  const ids = doc.paragrafen.map((p) => p.id);
  assert(new Set(ids).size === ids.length, `${doc.slug}: elk anker is uniek`);
  assert(
    doc.paragrafen.every((p) => p.blokken.length > 0),
    `${doc.slug}: geen enkele paragraaf is leeg`
  );

  // Geen achtergebleven vierkante haken uit de brontekst. Dit is de fout die deze hele opzet moet
  // voorkomen: een "[KVK-NUMMER]" die letterlijk op een publieke pagina belandt.
  const haken = alleTeksten(doc).filter((t) => /\[[A-Z][A-Z_ /-]+\]/.test(t));
  assert(haken.length === 0, `${doc.slug}: geen onvervangen [PLACEHOLDER] uit de brontekst`);

  // Elk {{token}} moet oplosbaar zijn. Een typefout in een veldnaam zou anders als een
  // ontbrekend-veld-markering op de pagina komen te staan, en dus als een openstaande beslissing
  // lezen die er niet is.
  for (const tekst of alleTeksten(doc)) {
    for (const match of tekst.matchAll(/\{\{([a-zA-Z]+)\}\}/g)) {
      const naam = match[1];
      const bekend = naam in COMPLEET || naam === "capMaximumZin";
      assert(bekend, `${doc.slug}: {{${naam}}} verwijst naar een bestaand veld`);
    }
  }

  // Volledig ingevuld hoort er nergens meer een markering te staan.
  const restGaten = alleTeksten(doc)
    .flatMap((t) => parseInline(t, COMPLEET))
    .filter((n) => n.soort === "ontbreekt");
  assert(restGaten.length === 0, `${doc.slug}: met alles ingevuld resteert er geen enkel gat`);
}

// De leden binnen een artikel moeten doorlopend genummerd zijn. Artikel 7 valt uiteen in twee
// genummerde blokken met een bullet-opsomming ertussen; zonder een expliciet startnummer begint
// het tweede blok weer bij 1, en dan wijst een verwijzing als "art. 7 lid 4" naar de verkeerde
// bepaling. Deze controle geldt voor elk artikel, niet alleen voor de twee die het vandaag doen.
for (const doc of JURIDISCHE_DOCUMENTEN) {
  for (const par of doc.paragrafen) {
    let verwacht = 1;
    for (const blok of par.blokken as Blok[]) {
      if (blok.soort !== "genummerd") continue;
      const begint = blok.start ?? 1;
      assert(
        begint === verwacht,
        `${doc.slug} ${par.id}: genummerd blok begint bij ${begint}, verwacht ${verwacht}`
      );
      verwacht = begint + blok.items.length;
    }
  }
}

// De twee documenten verwijzen naar elkaar; die links moeten naar de echte routes wijzen, niet
// naar het markdown-bestand in docs/juridisch/ waar de brontekst vandaan komt.
const alleLinks = JURIDISCHE_DOCUMENTEN.flatMap((d) =>
  alleTeksten(d).flatMap((t) => parseInline(t, COMPLEET))
).filter((n) => n.soort === "link");
assert(alleLinks.length >= 2, "de documenten verwijzen naar elkaar");
assert(
  alleLinks.every((n) => n.soort === "link" && ["/privacy", "/terms"].includes(n.href)),
  "elke interne link wijst naar een bestaande route, niet naar een .md-bestand"
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
