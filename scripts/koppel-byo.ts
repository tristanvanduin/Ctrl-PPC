// Legt bring-your-own-sleutels van een bureau vast in de kluis, voor kanalen waarvan het
// product (nog) geen goedgekeurde eigen app heeft: meta, linkedin, microsoft_ads.
//
// Waarom een script en geen scherm: de pilotklant levert zijn sleutels één keer aan, buiten
// de app om (de eigen OAuth-flow vergt juist de goedgekeurde app die er nog niet is). Het
// script gebruikt exact dezelfde schrijfweg als de OAuth-callback (bewaarKoppeling), dus wat
// hier wordt vastgelegd is voor de rest van de code onzichtbaar anders dan een echte koppeling.
//
// Gebruik:
//   tsx scripts/koppel-byo.ts --agency <agency-uuid> --provider microsoft_ads --bestand keys.json
//
// Het JSON-bestand draagt de velden uit lib/tenancy/kanaal-credentials.ts:
//   { "refreshToken": "...", "clientId": "...", "clientSecret": "...",
//     "developerToken": "...", "customerId": "..." }        (developerToken/customerId: alleen microsoft)
//   Optioneel "externalId" (business-id/organisatie-URN/customer-id) voor de koppelingsrij.
//
// Het bestand hoort NIET in git en kan na afloop weg: de waarheid staat daarna in de kluis.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { bewaarKoppeling, leesKoppeling, PROVIDERS, type Provider } from "../lib/tenancy/koppelingen";

function arg(naam: string): string | null {
  const i = process.argv.indexOf(`--${naam}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const agencyId = arg("agency");
  const provider = arg("provider") as Provider | null;
  const bestand = arg("bestand");
  if (!agencyId || !provider || !bestand || !PROVIDERS.includes(provider)) {
    console.error(`Gebruik: tsx scripts/koppel-byo.ts --agency <uuid> --provider <${PROVIDERS.join("|")}> --bestand <keys.json>`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn vereist.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const inhoud = JSON.parse(readFileSync(bestand, "utf8")) as Record<string, unknown>;
  const externalId = typeof inhoud.externalId === "string" ? inhoud.externalId : null;
  // De payload gaat als JSON-string de kluis in; externalId hoort in de tabelrij, niet in het
  // geheim, dus die gaat eruit voordat de rest wordt opgeslagen.
  const { externalId: _weg, ...geheim } = inhoud;

  const uitkomst = await bewaarKoppeling(supabase, {
    agencyId,
    provider,
    refreshToken: JSON.stringify(geheim),
    externalId,
  });
  if (!uitkomst.ok) {
    console.error(`Vastleggen mislukt: ${uitkomst.fout}`);
    process.exit(1);
  }

  // Terugleescontrole: niet het geheim zelf (dat hoort niet op een scherm), wel dat de
  // koppeling actief is en een token draagt.
  const koppeling = await leesKoppeling(supabase, agencyId, provider);
  if (!koppeling || koppeling.status !== "actief" || !koppeling.heeftToken) {
    console.error("Vastgelegd, maar de terugleescontrole faalde — koppeling niet actief of zonder token.");
    process.exit(1);
  }
  console.log(`OK: ${provider}-koppeling voor bureau ${agencyId} actief (externalId: ${koppeling.externalId ?? "geen"}).`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
