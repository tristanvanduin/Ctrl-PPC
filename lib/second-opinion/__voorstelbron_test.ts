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
import { ALLE_SOP_CHANNELS, ALLE_SOP_TYPES, CHANNEL_CONFIG } from "@/lib/analysis/sop-channel-config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// ALLE niet-maandvarianten, afgeleid uit CHANNEL_CONFIG: de waarden waarmee de weekly- en
// biweekly-routes extractStructuredData aanroepen. Groeit vanzelf mee met een nieuw kanaal.
const VARIANTEN = ALLE_SOP_CHANNELS.flatMap((kanaal) =>
  ALLE_SOP_TYPES.filter((c) => c !== "monthly").map((c) => CHANNEL_CONFIG[kanaal].sopTypeKey[c])
);

console.log("De zes varianten delen geen bron meer");
{
  const bronnen = VARIANTEN.map(proposalSourceForSopType);
  check(`${VARIANTEN.length} varianten, ${VARIANTEN.length} verschillende bronnen`,
    new Set(bronnen).size === VARIANTEN.length, bronnen.join(", "));
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
    microsoft_weekly: "microsoft", microsoft_biweekly: "microsoft",
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

console.log("\nDe opruimmigratie noemt dezelfde zes varianten");
{
  // Migratie 105 zet voorstellen die vóór de splitsing onder "analysis" zijn weggeschreven terug
  // naar hun eigen bron. Hij leidt die bron af uit sop_recommendations.sop_type, maar accepteert
  // alleen de zes bekende varianten -- een onverwachte waarde blijft liever staan dan stil een
  // onbekende bron te worden.
  //
  // Die lijst staat in SQL en kan dus niet meeveranderen met CHANNEL_CONFIG. Voegt iemand een
  // vierde kanaal toe, dan laat de migratie zijn weekly en bi-weekly stilzwijgend onder "analysis"
  // liggen -- onzichtbaar in de wachtrij, precies de fout die hij hoort op te lossen. Deze check
  // vergelijkt de twee, zodat dat opvalt in plaats van te gebeuren.
  const sql = readFileSync(join(process.cwd(), "scripts/migrations/105_wees_voorstellen_terug_naar_eigen_bron.sql"), "utf8");
  const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  // BEVROREN, niet afgeleid -- en dat is hier een principekwestie. Migratie 105 repareert een
  // HISTORISCHE toestand: voorstellen die vóór de bronsplitsing onder "analysis" zijn
  // weggeschreven. Alleen de zes varianten die toen bestonden kunnen daar wezen hebben; een
  // kanaal dat ná de splitsing geboren is (microsoft, 25 aug 2026) heeft nooit onder "analysis"
  // geschreven en hoort dus juist NIET in die migratie -- hem daar alsnog aan toevoegen zou
  // suggereren dat er iets te herstellen valt. De levende eis voor nieuwe kanalen staat hierboven:
  // proposalSourceForSopType mag voor geen enkele variant "analysis" teruggeven.
  const HISTORISCHE_ZES = ["weekly", "biweekly", "meta_weekly", "meta_biweekly", "linkedin_weekly", "linkedin_biweekly"];
  for (const variant of HISTORISCHE_ZES) {
    check(`105 noemt ${variant}`, inSql.includes(variant), inSql.join(", "));
  }
  check("en geen enkele latere variant", !inSql.some((w) => w.startsWith("microsoft_")), inSql.join(", "));
  // En andersom: de migratie mag geen maandbron aanraken. Die rijen staan terecht onder
  // "analysis" -- 84 van de 85 pending rijen in deze database zijn dat.
  for (const maand of ALLE_SOP_CHANNELS.map((k) => CHANNEL_CONFIG[k].sopTypeKey.monthly)) {
    check(`105 raakt ${maand} niet aan`, !inSql.includes(maand), inSql.join(", "));
  }
  // De rem op de status staat er ook echt: accepted, rejected en completed zijn genomen
  // beslissingen en mogen nooit herlabeld worden.
  check("105 werkt alleen op pending", /status\s*=\s*'pending'/.test(sql));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
