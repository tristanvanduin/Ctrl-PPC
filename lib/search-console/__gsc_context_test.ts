export {};
// Verificatie van de driewegs-beslistabel (beoordeelMerkCannibalisatie, MASTERPLAN 5.6.0) en de
// kanaal-gating in buildSearchConsoleContextBlock (alleen zinvol naast Google Ads).
// Draaien: npx tsx lib/search-console/__gsc_context_test.ts

import { beoordeelMerkCannibalisatie, buildSearchConsoleContextBlock } from "./context";
import type { SignalStory } from "@/lib/signals/types";
import type { GscDataset } from "./types";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
};

const dummyStory: SignalStory = {
  id: "gsc_brand_dominance", category: "cross_channel", scope: "test", story: "test",
  actionDirection: "test", certainty: "indicatie", evidence: [],
};

console.log("\n1. beoordeelMerkCannibalisatie — de driewegs-beslistabel");
{
  const eens = beoordeelMerkCannibalisatie(dummyStory, true);
  check("bronnen eens → bewezen_binnen_platform", eens.uitkomst === "bewezen_binnen_platform");

  const oneens = beoordeelMerkCannibalisatie(dummyStory, false);
  check("GSC wel, naamgeving niet → datakwaliteitssignaal", oneens.uitkomst === "datakwaliteitssignaal");

  const teWeinigBewijs = beoordeelMerkCannibalisatie(null, true);
  check("geen GSC-bewijs, naamgeving wel → geen_wijziging (geen stille op- of afwaardering)", teWeinigBewijs.uitkomst === "geen_wijziging");

  const geenVanBeide = beoordeelMerkCannibalisatie(null, false);
  check("geen GSC-bewijs en geen merkcampagne → geen_wijziging", geenVanBeide.uitkomst === "geen_wijziging");
}

console.log("\n2. buildSearchConsoleContextBlock — kanaal-gating");
{
  const liveDataset: GscDataset = { availability: "live", config: { siteUrl: "https://x.nl/", brandTerms: ["x"] }, rows: [], limitations: [] };
  const forGoogle = buildSearchConsoleContextBlock(liveDataset, "google_ads");
  check("Google Ads krijgt een promptContext bij live data", forGoogle.promptContext.length > 0);

  const forMeta = buildSearchConsoleContextBlock(liveDataset, "meta_ads");
  check("Meta krijgt GEEN promptContext (organisch zoeken zegt niets over Meta)", forMeta.promptContext === "");

  const forLinkedIn = buildSearchConsoleContextBlock(liveDataset, "linkedin_ads");
  check("LinkedIn krijgt GEEN promptContext", forLinkedIn.promptContext === "");

  const absentDataset: GscDataset = { availability: "absent", config: null, rows: [], limitations: ["geen config"] };
  const absentGoogle = buildSearchConsoleContextBlock(absentDataset, "google_ads");
  check("absent → lege promptContext ook voor Google Ads (nul promptwijziging)", absentGoogle.promptContext === "");
  check("absent geeft de beperking door", absentGoogle.limitations.includes("geen config"));
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald\n`);
if (failed > 0) process.exit(1);
