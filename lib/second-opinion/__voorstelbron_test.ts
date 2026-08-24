// De voorstellenbron per SOP-variant.
// Draaien: npx tsx lib/second-opinion/__voorstelbron_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// Alle zes de weekly-/bi-weekly-varianten schreven hun voorstellen weg onder één bron:
// "analysis". saveProposalsReplacingPending verwijdert bij elke schrijfbeurt de bestaande
// pending-rijen van de opgegeven bron -- dus draaide de Meta-weekly ná de Google-weekly, dan waren
// Google's openstaande voorstellen weg. Van de zes hield alleen de laatst gedraaide iets over.
//
// Dat is geen degradatie maar dataverlies, en het is stil: er komt geen fout, de rijen zijn er
// gewoon niet meer. Een test die alleen "schrijft hij weg" controleert had dit nooit gezien. Deze
// test bewaakt de eigenschap die het probleem veroorzaakte: liggen de bronnen uit elkaar.
//
// De tweede helft bewaakt de kanaalafleiding. Die werkte met handmatig bijgehouden sleutellijsten
// waar meta_weekly en linkedin_biweekly niet in stonden, dus die zouden als Google gelabeld zijn
// in de wachtrij. Een verkeerde badge is erger dan geen badge: hij beweert iets.

import { proposalSourceForSopType } from "./findings-to-hypotheses";
import { channelOfSource } from "@/lib/insights/channel-of";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// Exact de zes waarden waarmee app/api/analysis/{weekly,biweekly}/route.ts
// extractStructuredData aanroepen.
const VARIANTEN = ["weekly", "meta_weekly", "linkedin_weekly", "biweekly", "meta_biweekly", "linkedin_biweekly"] as const;

console.log("De zes varianten delen geen bron meer");
{
  const bronnen = VARIANTEN.map(proposalSourceForSopType);
  check("zes varianten, zes verschillende bronnen", new Set(bronnen).size === 6, bronnen.join(", "));
  // Dit is de kern: zou ook maar één variant nog "analysis" schrijven, dan wist die bij elke run
  // de voorstellen van de maandpijplijn -- en die is in de wachtrij niet eens zichtbaar, dus
  // niemand zou het merken.
  check("geen enkele variant schrijft nog onder de maandbron", !bronnen.includes("analysis"), bronnen.join(", "));
}

console.log("\nDe maand houdt zijn eigen bron");
check('monthly blijft "analysis"', proposalSourceForSopType("monthly") === "analysis");

console.log("\nElke variant landt bij het juiste kanaal in de wachtrij");
{
  const verwacht: Record<string, string> = {
    weekly: "google", biweekly: "google",
    meta_weekly: "meta", meta_biweekly: "meta",
    linkedin_weekly: "linkedin", linkedin_biweekly: "linkedin",
  };
  for (const v of VARIANTEN) {
    const kanaal = channelOfSource(proposalSourceForSopType(v));
    check(`${v} → ${verwacht[v]}`, kanaal === verwacht[v], `kreeg ${kanaal}`);
  }
  // De maandbron hoort Google te blijven: dat is de bestaande afspraak in channel-of.ts, waar
  // alles wat niet expliciet Meta/LinkedIn/cross is als Google-pijplijn telt.
  check("analysis blijft Google", channelOfSource("analysis") === "google");
}

console.log("\nDe naamconventie geldt ook voor bronnen die nog niet bestaan");
{
  // De sleutellijsten in channel-of.ts werden met de hand bijgehouden en liepen daardoor achter.
  // Sinds de prefix-regel hoeft een nieuwe meta_*- of linkedin_*-bron niet meer apart geregistreerd
  // te worden; dat is precies de klasse fout die hier terug zou kunnen sluipen.
  check("een toekomstige meta_-bron wordt Meta", channelOfSource("meta_iets_nieuws") === "meta");
  check("een toekomstige linkedin_-bron wordt LinkedIn", channelOfSource("linkedin_iets_nieuws") === "linkedin");
  check("hoofdletters maken niet uit", channelOfSource("META_Weekly") === "meta");
  check("onbekend zonder prefix blijft Google", channelOfSource("iets_anders") === "google");
  check("leeg blijft Google", channelOfSource(null) === "google");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
