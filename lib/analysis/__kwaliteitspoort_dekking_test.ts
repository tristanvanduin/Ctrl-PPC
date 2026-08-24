// Dekt de kwaliteitspoort alle drie de kanalen, bij opslaan én bij export?
// Draaien: npx tsx lib/analysis/__kwaliteitspoort_dekking_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// De poort werd voor Meta en LinkedIn berekend, opgeslagen en daarna genegeerd: `full`,
// `structured_monthly_v2` en de insights/recommendations/tasks gingen er onvoorwaardelijk
// achteraan. Een run met een ongeldige stap leverde dus een deliverable op die er precies zo uitzag
// als een geldige -- de gevaarlijkste soort fout, want hij ziet er goed uit.
//
// De export had dezelfde blinde vlek vanuit een andere hoek: de PDF-route hing zijn poort op aan de
// letterlijke vergelijking `sopType === "monthly"`. Dat is de sleutel van Google. Meta en LinkedIn
// draaien onder meta_monthly en linkedin_monthly, dus een geblokkeerde Meta-analyse kon gewoon als
// PDF de deur uit.
//
// Beide fouten hebben dezelfde vorm: de Google-variant is stilzwijgend de norm. Deze test bewaakt
// de eigenschap in plaats van de plek -- hij leidt de maandsleutels af uit dezelfde tabel als de
// productiecode en controleert dat er geen kanaal buiten valt.

import { MONTHLY_SOP_TYPES, isMonthlySopType, ALLE_SOP_CHANNELS, CHANNEL_CONFIG } from "./sop-channel-config";
import { buildMonthlyQualityGate } from "./monthly-acceptance";
// De twee vormen worden uit de signatuur van buildMonthlyQualityGate zelf afgeleid in plaats van
// apart geimporteerd: AcceptanceReport is in monthly-acceptance.ts niet geexporteerd, en een
// tweede, eigen definitie zou stil uit de pas gaan lopen met de echte.
type GateArg = Parameters<typeof buildMonthlyQualityGate>[0];
type StepValidationResult = GateArg["stepValidations"][number];
type AcceptanceReport = GateArg["acceptance"];

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("De exportpoort kent alle drie de maandkanalen");
{
  check("er zijn er precies drie", MONTHLY_SOP_TYPES.length === 3, MONTHLY_SOP_TYPES.join(", "));
  for (const kanaal of ALLE_SOP_CHANNELS) {
    const sleutel = CHANNEL_CONFIG[kanaal].sopTypeKey.monthly;
    check(`${kanaal} (${sleutel}) valt onder de poort`, isMonthlySopType(sleutel));
  }
  // De oude vergelijking, expliciet uitgeschreven: `sopType === "monthly"` dekt precies één van de
  // drie. Deze twee checks falen zodra iemand daarnaar terugvalt.
  const oudeCheck = (t: string): boolean => t === "monthly";
  for (const ontsnapt of ["meta_monthly", "linkedin_monthly"]) {
    check(`${ontsnapt} ontsnapte aan de oude check en valt nu wel onder de poort`,
      !oudeCheck(ontsnapt) && isMonthlySopType(ontsnapt));
  }

  check("weekly en biweekly vallen er buiten", !isMonthlySopType("weekly") && !isMonthlySopType("meta_weekly") && !isMonthlySopType("biweekly"));
  check("onbekend valt er buiten", !isMonthlySopType("iets_anders"));
}

console.log("\nDe poort blokkeert op een ongeldige stap, ook bij zes pijlers");
{
  const geslaagd: AcceptanceReport = { passed: true, criteria: [] } as unknown as AcceptanceReport;
  const stap = (stepNumber: number, valid: boolean): StepValidationResult =>
    ({ stepNumber, valid, errors: valid ? [] : ["verzonnen getal"], warnings: [] }) as unknown as StepValidationResult;

  // Meta en LinkedIn draaien 1..6 (F5 fase3), Google 1..13. buildMonthlyQualityGate filtert op
  // 1..13, dus zes pijlers vallen daar netjes binnen -- maar dat was nooit getoetst.
  const zesGeldig = buildMonthlyQualityGate({ stepValidations: [1, 2, 3, 4, 5, 6].map((n) => stap(n, true)), acceptance: geslaagd });
  check("zes geldige pijlers komen door", zesGeldig.passed, zesGeldig.state);

  const zesMetFout = buildMonthlyQualityGate({ stepValidations: [1, 2, 3, 4, 5, 6].map((n) => stap(n, n !== 4)), acceptance: geslaagd });
  check("een ongeldige pijler blokkeert", !zesMetFout.passed, zesMetFout.state);
  check("de blokkerende stap wordt benoemd", zesMetFout.invalid_steps.includes(4), zesMetFout.invalid_steps.join(","));
  check("er staat een leesbare reden bij", zesMetFout.blocking_reasons.some((r) => r.includes("4")), zesMetFout.blocking_reasons.join(" | "));

  // Een lege lijst mag niet als "alles goed" lezen. Vóór deze ronde gaven Meta en LinkedIn hun
  // validaties wél door, maar het structured_monthly_v2-veld stond hardgecodeerd op [] -- twee
  // secties van dezelfde run die verschillende dingen beweerden.
  const leeg = buildMonthlyQualityGate({ stepValidations: [], acceptance: geslaagd });
  check("zonder stap-validaties blokkeert de stap-tak niet (acceptance beslist dan)", leeg.passed, leeg.state);

  const acceptanceGefaald: AcceptanceReport = {
    passed: false,
    criteria: [{ id: "c1", label: "dekking", detail: "te weinig dimensies", passed: false }],
  } as unknown as AcceptanceReport;
  const viaAcceptance = buildMonthlyQualityGate({ stepValidations: [1, 2, 3, 4, 5, 6].map((n) => stap(n, true)), acceptance: acceptanceGefaald });
  check("een gefaalde acceptance blokkeert ook zonder ongeldige stap", !viaAcceptance.passed, viaAcceptance.state);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
