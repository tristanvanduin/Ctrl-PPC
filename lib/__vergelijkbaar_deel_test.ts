// Een percentage over een deel van de kanalen staat naast de waarden van dat deel, niet naast een
// totaal over alle kanalen (lib/period/vergelijkbaar-deel.ts, lib/overzicht/pacing-jaar.ts).
// Draaien: tsx lib/__vergelijkbaar_deel_test.ts
//
// Het tegenvoorbeeld uit de doorlichting van 13 november, demo-greentech, 12 maanden: de CPA-tegel
// zei "€ 57, +14% ongunstig, was € 96". € 57 is alle vier de kanalen (€ 194.495 / 3.416); +14% en
// € 96 zijn alleen Google (€ 139.500 / 1.277 = € 109 tegen € 96). De ROAS-tegel zei "2,89×, -11%,
// was 1,98×" (Google nu 1,75×). In de pacingtabel stond "Conversies 3.072 | −8%" met de −8% van
// 1.091 tegen 1.180, alleen Google.

import { somVergelijking, verhoudingVergelijking } from "./period/vergelijkbaar-deel";
import { vergelijkbaarDeelTekst } from "./overzicht/pacing-jaar";
import { delta } from "./period/apply-period";
import { wasTekst } from "../components/ui/kerncijfer";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Totaal over alle kanalen (wat de tegel groot toont).
const totaal = { conversions: 3416, revenue: 562317, adSpend: 194495 };
// Het gepaarde deel: Google nu, en Google een jaar eerder (CPA € 96, ROAS 1,98×).
const gepaardHuidig = { conversions: 1277, revenue: 244660, adSpend: 139500 };
const gepaardVorig = { conversions: 1180, revenue: 224294, adSpend: 113280 };

const cpa = verhoudingVergelijking({
  totaalTeller: totaal.adSpend, totaalNoemer: totaal.conversions,
  teller: delta(gepaardHuidig.adSpend, gepaardVorig.adSpend),
  noemer: delta(gepaardHuidig.conversions, gepaardVorig.conversions),
});
check("CPA: het percentage gaat over een deel", cpa.soort === "deel", JSON.stringify(cpa));
if (cpa.soort === "deel") {
  check("CPA: de huidige waarde van het deel is € 109, niet € 57", Math.round(cpa.huidig) === 109, String(cpa.huidig));
  check("CPA: de vorige waarde is € 96", Math.round(cpa.vorig) === 96, String(cpa.vorig));
  check("CPA: +14% hoort bij € 109 tegen € 96", Math.round(cpa.pct!) === 14, String(cpa.pct));
  // Het percentage moet uit de twee getonde getallen te herleiden zijn.
  check("CPA: percentage volgt uit de getoonde waarden", Math.abs((cpa.huidig / cpa.vorig - 1) * 100 - cpa.pct!) < 1e-9);
}

const roas = verhoudingVergelijking({
  totaalTeller: totaal.revenue, totaalNoemer: totaal.adSpend,
  teller: delta(gepaardHuidig.revenue, gepaardVorig.revenue),
  noemer: delta(gepaardHuidig.adSpend, gepaardVorig.adSpend),
});
check("ROAS: het percentage gaat over een deel", roas.soort === "deel");
if (roas.soort === "deel") {
  check("ROAS: deel nu 1,75×", Math.abs(roas.huidig - 1.754) < 0.01, String(roas.huidig));
  check("ROAS: deel was 1,98×", Math.abs(roas.vorig - 1.98) < 0.01, String(roas.vorig));
  check("ROAS: -11%", Math.round(roas.pct!) === -11, String(roas.pct));
}

// Alles gepaard: dan hoort het percentage bij het grote getal en volstaat "was".
const heel = verhoudingVergelijking({
  totaalTeller: 1000, totaalNoemer: 50,
  teller: delta(1000, 900), noemer: delta(50, 45),
});
check("verhouding over alles gepaard heet heel", heel.soort === "heel", JSON.stringify(heel));

// Zonder vergelijkingsperiode niets; zonder vorige noemer "leeg".
check("geen vergelijking", verhoudingVergelijking({ totaalTeller: 1, totaalNoemer: 1, teller: null, noemer: null }).soort === "geen");
check("vorige noemer nul is leeg", verhoudingVergelijking({ totaalTeller: 10, totaalNoemer: 5, teller: delta(10, 0), noemer: delta(5, 0) }).soort === "leeg");

// Somtegels: hetzelfde.
const conv = somVergelijking(totaal.conversions, delta(gepaardHuidig.conversions, gepaardVorig.conversions));
check("conversies: 3.416 met een percentage over 1.277 is een deel", conv.soort === "deel" && conv.huidig === 1277 && conv.vorig === 1180);
check("conversies: alles gepaard is heel", somVergelijking(1277, delta(1277, 1180)).soort === "heel");
check("som zonder vergelijking", somVergelijking(1, null).soort === "geen");

// De tekst bij de tegel noemt beide waarden van het deel.
check("tegeltekst noemt het deel nu en toen", wasTekst("€ 96", "€ 109") === "vergelijkbaar deel € 109, was € 96", wasTekst("€ 96", "€ 109"));
check("tegeltekst zonder deel blijft 'was'", wasTekst("€ 96") === "was € 96");

// Pacingtabel: de cel noemt 1.091 tegen 1.180 en over welke kanalen.
const fmt = (v: number) => v.toLocaleString("nl-NL");
const paar = {
  gepaard: { huidig: { conversions: 1091, adSpend: 117300 }, vorig: { conversions: 1180, adSpend: 110660 } },
  vergeleken: ["Google Ads"],
  nietVolledig: 3,
};
const cel = vergelijkbaarDeelTekst("conversions", paar, fmt);
check("pacingcel noemt de gepaarde getallen", cel !== null && cel.includes("1.091") && cel.includes("1.180"), String(cel));
check("pacingcel noemt het kanaal", cel !== null && cel.includes("Google Ads"), String(cel));
check("pacingcel leeg als alles gepaard is", vergelijkbaarDeelTekst("conversions", { ...paar, nietVolledig: 0 }, fmt) === null);
check("pacingcel leeg voor een verhouding", vergelijkbaarDeelTekst("cpa", paar, fmt) === null);

console.log(`vergelijkbaar deel: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
