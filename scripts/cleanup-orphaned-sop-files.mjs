// Eenmalig opruimscript: client_files-rijen voor SOP-PDF's die naar een storage-object wijzen
// dat niet (meer) bestaat.
//
// Waarom dit nog nodig is na de fix in app/api/analysis/pdf/route.ts (die voorkomt dat een
// mislukte upload alsnog een client_files-rij aanmaakt): die fix voorkomt alleen NIEUWE kapotte
// rijen. Rijen die vóór die fix zijn aangemaakt -- of van vóór de storage-bucket bestond -- staan
// er nog steeds, en geven bij een klik op "Download" nog steeds "bestand bestaat niet". Dat is
// exact de klacht "ik kan oude SOP's nog steeds niet downloaden" uit de feedbackronde van 21
// augustus: dezelfde bug, nooit met terugwerkende kracht opgeruimd.
//
// Regenereren kan niet zomaar: de PDF-render leest op dit moment uit sop_analysis_output, en
// die rij kan inmiddels ook zijn opgeruimd. Verwijderen van de kapotte verwijzing is dus het
// eerlijke antwoord -- het bestand bestaat niet, dus de rij die dat beweert hoort ook niet meer
// te bestaan. Wie een oude SOP echt terug wil, kan die opnieuw laten genereren via de gewone
// "Download PDF"-knop; dat schrijft een verse, correcte rij.
//
// Gebruik: SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphaned-sop-files.mjs [--dry-run]

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!url || !key) {
  console.error("Gebruik: SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphaned-sop-files.mjs [--dry-run]");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: rijen, error } = await admin
  .from("client_files")
  .select("id, client_id, file_name, storage_path")
  .eq("folder", "SOP's");

if (error) {
  console.error("Ophalen client_files faalde:", error.message);
  process.exit(1);
}

console.log(`${rijen.length} SOP-bestandsrijen gevonden. Elk object in storage controleren...`);

const wees = [];
for (const rij of rijen) {
  if (!rij.storage_path) {
    wees.push(rij);
    continue;
  }
  // .download() is de enige betrouwbare "bestaat dit object echt" check -- .list() op de
  // bovenliggende map kan met veel bestanden onvolledig terugkomen zonder paginering, en een
  // aparte HEAD-achtige call bestaat niet in de supabase-js storage-client.
  const { error: downloadError } = await admin.storage.from("client-files").download(rij.storage_path);
  if (downloadError) wees.push(rij);
}

console.log(`${wees.length} van ${rijen.length} rijen wijzen naar een niet-bestaand object.`);

if (wees.length === 0) {
  console.log("Niets op te ruimen.");
  process.exit(0);
}

for (const rij of wees) {
  console.log(`  wees: ${rij.client_id} / ${rij.file_name} (${rij.storage_path ?? "geen storage_path"})`);
}

if (dryRun) {
  console.log("\n--dry-run: geen rijen verwijderd. Draai zonder die vlag om daadwerkelijk op te ruimen.");
  process.exit(0);
}

const { error: deleteError } = await admin
  .from("client_files")
  .delete()
  .in("id", wees.map((r) => r.id));

if (deleteError) {
  console.error("Verwijderen faalde:", deleteError.message);
  process.exit(1);
}

console.log(`${wees.length} weesrijen verwijderd.`);
