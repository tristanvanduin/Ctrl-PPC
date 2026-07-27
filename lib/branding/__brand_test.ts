// De merknaam staat op één plek, en de opgeslagen eigenaar-waarde blijft leesbaar.
// Draaien: npx tsx lib/branding/__brand_test.ts
//
// De naam stond als losse tekst op 78 plekken in 30 bestanden. Bij een naamswijziging is dat een
// zoek-en-vervang met kans op een vergeten hoekje — en een vergeten hoekje staat vervolgens in een
// PDF die naar een klant gaat.
//
// De eigenaar-waarde is het lastige deel: die wordt OPGESLAGEN in sprint_planning.owner en
// sop_tasks.owner. Rijen van vóór de wijziging dragen de oude naam en mogen niet ineens ongeldig
// worden of als klant-taken gaan tellen.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_NAME, BRAND_SHORT, BRAND_LOGO_FILE,
  OWNER_TEAM, OWNER_CLIENT, LEGACY_OWNER_TEAM,
  isTeamOwner, normalizeOwner,
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
check("logobestand volgt de merknaam", (() => {
  const slug = BRAND_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return BRAND_LOGO_FILE.startsWith(slug);
})(), `${BRAND_LOGO_FILE} hoort met de slug van "${BRAND_NAME}" te beginnen`);
check("korte vorm past bij de naam", BRAND_NAME.toUpperCase().includes(BRAND_SHORT.toUpperCase()));

console.log("\nOude opgeslagen waarden blijven herkend");
check("de oude naam telt als eigen team", isTeamOwner(LEGACY_OWNER_TEAM));
check("de nieuwe naam ook", isTeamOwner(OWNER_TEAM));
check("de korte vorm ook", isTeamOwner(BRAND_SHORT) && isTeamOwner("RM"));
check("de klant niet", !isTeamOwner(OWNER_CLIENT));
check("leeg niet", !isTeamOwner("") && !isTeamOwner(null) && !isTeamOwner(undefined));
check("spaties eromheen storen niet", isTeamOwner(`  ${LEGACY_OWNER_TEAM}  `));

console.log("\nNormaliseren naar de huidige schrijfwijze");
check("oud wordt nieuw", normalizeOwner(LEGACY_OWNER_TEAM) === OWNER_TEAM);
check("nieuw blijft nieuw", normalizeOwner(OWNER_TEAM) === OWNER_TEAM);
check("klant blijft klant", normalizeOwner(OWNER_CLIENT) === OWNER_CLIENT);
check("onbekend wordt klant", normalizeOwner("iemand anders") === OWNER_CLIENT);

console.log("\nHet schema accepteert beide en levert één waarde");
{
  const oud = OwnerEnum.safeParse(LEGACY_OWNER_TEAM);
  check("de oude waarde wordt geaccepteerd", oud.success, JSON.stringify(oud));
  check("en komt er als de nieuwe uit", oud.success && oud.data === OWNER_TEAM, oud.success ? oud.data : "");
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
  ];
  const overtreders: string[] = [];
  for (const f of [...walk("lib"), ...walk("app"), ...walk("components"), ...walk("scripts")]) {
    if (toegestaan.some((t) => f.includes(t))) continue;
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((r, i) => {
      if (r.includes(LEGACY_OWNER_TEAM)) overtreders.push(`${f}:${i + 1}`);
    });
  }
  check("geen losse vermelding meer", overtreders.length === 0, overtreders.slice(0, 5).join(", "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
