// De gedeelde teksthulpjes.

import { opsomming, metriekLabel } from "./tekst";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("opsomming");
check("leeg geeft een lege tekst", opsomming([]) === "");
check("één deel staat er alleen", opsomming(["a"]) === "a");
check("twee delen krijgen 'en'", opsomming(["a", "b"]) === "a en b");
check("drie delen: komma's en dan 'en'", opsomming(["a", "b", "c"]) === "a, b en c");
check("geen Oxford-komma", !opsomming(["a", "b", "c"]).includes(", en"));

console.log("\nmetriekLabel");
// De vijf die in de demo en de detectoren echt voorkomen. Deze stonden onbewerkt in beeld.
check("one_click_leads wordt Nederlands", metriekLabel("one_click_leads") === "lead-formulieren");
check("conversion_rate wordt Nederlands", metriekLabel("conversion_rate") === "conversieratio");
check("conversions wordt Nederlands", metriekLabel("conversions") === "conversies");
check("cost wordt Nederlands", metriekLabel("cost") === "kosten");
check("ctr blijft een afkorting in kapitalen", metriekLabel("ctr") === "CTR");

// De belangrijkste eigenschap: onbekend gaat ONGEWIJZIGD door. Het model schrijft hier hele
// zinnen in; een vertaling die die zinnen zou aanraken is erger dan een technische naam.
check("een zin van het model blijft heel", metriekLabel("ROAS per land") === "ROAS per land");
check(
  "ook een lange zin blijft heel",
  metriekLabel("Herbeoordeling van dit controlepunt in de second opinion.") ===
    "Herbeoordeling van dit controlepunt in de second opinion."
);
check("een onbekende veldnaam blijft staan", metriekLabel("video_quartile_p25") === "video_quartile_p25");

// Leeg is geen metriek, en dat is iets anders dan een lege tekst: de aanroeper toont dan zijn
// eigen streepje in plaats van een lege cel.
check("null geeft null", metriekLabel(null) === null);
check("undefined geeft null", metriekLabel(undefined) === null);
check("lege tekst geeft null", metriekLabel("") === null);
check("alleen spaties geeft null", metriekLabel("   ") === null);

// Hoofdletters mogen de vertaling niet missen; de bronnen schrijven niet allemaal hetzelfde.
check("hoofdletters worden herkend", metriekLabel("CONVERSION_RATE") === "conversieratio");
check("spaties eromheen storen niet", metriekLabel("  ctr  ") === "CTR");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
