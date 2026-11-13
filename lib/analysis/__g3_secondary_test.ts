// Verificatie van G3 Pad A (eerlijke waardering van afgewezen-maar-materiele threads), pure logica.
// Getoetst op nietProbleemRegel, de regel die createThreads (monthly-structured.ts) gebruikt; hier
// stond eerst een kopie. Met contrast oud versus nieuw. Draaien: npx tsx lib/analysis/__g3_secondary_test.ts

import { nietProbleemRegel } from "./monthly-structured";

type Cluster = {
  display_label: string;
  evidence_summary: string;
  action_required: boolean;
  dominant_severity: "critical" | "high" | "medium" | "low" | "positive";
  businessImpactText: string; // wat businessImpact(cluster) zou opleveren
};

// Oud: altijd de kale regel (alleen als contrast). Nieuw: de echte nietProbleemRegel.
const renderOld = (c: Cluster) => `${c.display_label}: ${c.evidence_summary}`;
const renderNew = (c: Cluster) => nietProbleemRegel(c, () => c.businessImpactText);
// Materieel is wat de echte regel als secundaire kans schrijft.
const isMaterialSecondary = (c: Cluster) => /Secundair/.test(renderNew(c));

const branded: Cluster = {
  display_label: "Branded",
  evidence_summary: "Branded campagne met budgetbeperking",
  action_required: true,
  dominant_severity: "high",
  businessImpactText: "Branded wordt geraakt via Budget Lost IS +22%, ROAS 4.66x.",
};

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. Het kernprobleem: Branded (materieel) werd kaal weggeschreven, nu eerlijk gewaardeerd");
{
  const oud = renderOld(branded);
  const nieuw = renderNew(branded);
  check("OUD schreef Branded weg als kale niet-probleem-regel", oud === "Branded: Branded campagne met budgetbeperking");
  check("NIEUW waardeert Branded als secundair", /Secundair/.test(nieuw) && /gemiste kans/.test(nieuw) && /geen non-issue/.test(nieuw));
  check("NIEUW toont de business-impact (budget IS, ROAS)", /Budget Lost IS \+22%/.test(nieuw) && /ROAS 4\.66x/.test(nieuw));
  console.log("     OUD:   " + oud);
  console.log("     NIEUW: " + nieuw);
}

console.log("\n2. De drempel: alleen action_required EN severity critical of high is materieel");
{
  check("critical + action_required -> secundair", isMaterialSecondary({ ...branded, dominant_severity: "critical" }));
  check("high + action_required -> secundair", isMaterialSecondary({ ...branded, dominant_severity: "high" }));
  check("medium -> NIET secundair (kale regel)", !isMaterialSecondary({ ...branded, dominant_severity: "medium" }));
  check("high maar GEEN action_required -> NIET secundair", !isMaterialSecondary({ ...branded, action_required: false }));
  check("positive -> NIET secundair", !isMaterialSecondary({ ...branded, dominant_severity: "positive" }));
}

console.log("\n3. Een immaterieel cluster blijft de kale niet-probleem-regel (geen valse promotie)");
{
  const immaterieel: Cluster = { display_label: "Display Prospecting", evidence_summary: "stabiel, geen druk", action_required: false, dominant_severity: "low", businessImpactText: "x" };
  check("immaterieel -> kale regel", renderNew(immaterieel) === "Display Prospecting: stabiel, geen druk");
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);