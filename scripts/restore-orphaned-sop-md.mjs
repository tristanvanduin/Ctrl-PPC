import { createClient } from "@supabase/supabase-js";

// Herstelt de .md-varianten van de weeswijzende client_files-rijen (zie
// cleanup-orphaned-sop-files.mjs) door de exacte, oorspronkelijke tekst terug te uploaden naar
// het al opgeslagen storage_path. De tekst zelf ging nooit verloren -- die staat verbatim in
// sop_analysis_output.output (section "full") -- alleen de storage-upload faalde destijds
// stilzwijgend (bug al gefixt in 17.47-17.50). Dit is dus geen reconstructie op basis van een
// gok, maar een letterlijke herhaling van dezelfde upload die destijds had moeten slagen.
//
// Alleen .md-rijen: de PDF-varianten hebben een aparte aanpak nodig (zie sessie-overleg 22
// augustus) omdat de renderer voor maand-PDF's kanaaloverstijgende context live opnieuw ophaalt,
// wat een PDF zou opleveren die niet meer overeenkomt met wat er destijds echt stond.

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!url || !key) {
  console.error("Gebruik: SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-orphaned-sop-md.mjs [--dry-run]");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: rijen, error } = await admin
  .from("client_files")
  .select("id, client_id, file_name, storage_path")
  .eq("folder", "SOP's")
  .like("file_name", "%.md");

if (error) {
  console.error("Ophalen client_files faalde:", error.message);
  process.exit(1);
}

console.log(`${rijen.length} .md-bestandsrijen gevonden.`);

// Bestandsnaam volgt het patroon YYYY-MM-DD-{monthly|weekly|biweekly}-analyse.md.
function parseFileName(naam) {
  const m = naam.match(/^(\d{4}-\d{2}-\d{2})-(monthly|weekly|biweekly)-analyse\.md$/);
  if (!m) return null;
  return { analysisDate: m[1], sopType: m[2] };
}

let hersteld = 0;
let overgeslagen = 0;
let mislukt = 0;

for (const rij of rijen) {
  if (!rij.storage_path) { overgeslagen++; continue; }
  const parsed = parseFileName(rij.file_name);
  if (!parsed) {
    console.log(`  overgeslagen (bestandsnaam wijkt af): ${rij.client_id} / ${rij.file_name}`);
    overgeslagen++;
    continue;
  }

  // Object bestaat al? Dan is deze rij geen wees (meer) -- niets te doen.
  const { error: downloadError } = await admin.storage.from("client-files").download(rij.storage_path);
  if (!downloadError) { overgeslagen++; continue; }

  const { data: output, error: outputError } = await admin
    .from("sop_analysis_output")
    .select("output")
    .eq("client_id", rij.client_id)
    .eq("sop_type", parsed.sopType)
    .eq("analysis_date", parsed.analysisDate)
    .eq("section", "full")
    .maybeSingle();

  if (outputError || !output?.output) {
    console.log(`  GEEN bronoutput gevonden: ${rij.client_id} / ${rij.file_name} -- kan niet hersteld worden`);
    mislukt++;
    continue;
  }

  const tekst = typeof output.output === "string" ? output.output : JSON.stringify(output.output);

  if (dryRun) {
    console.log(`  zou herstellen: ${rij.client_id} / ${rij.file_name} (${tekst.length} tekens)`);
    hersteld++;
    continue;
  }

  const { error: uploadError } = await admin.storage.from("client-files").upload(
    rij.storage_path,
    new Blob([tekst], { type: "text/markdown" }),
    { contentType: "text/markdown", upsert: true },
  );

  if (uploadError) {
    console.log(`  UPLOAD MISLUKT: ${rij.client_id} / ${rij.file_name} -- ${uploadError.message}`);
    mislukt++;
    continue;
  }

  console.log(`  hersteld: ${rij.client_id} / ${rij.file_name} (${tekst.length} tekens)`);
  hersteld++;
}

console.log(`\n${hersteld} ${dryRun ? "zouden hersteld worden" : "hersteld"}, ${overgeslagen} overgeslagen (al goed of onherkenbaar), ${mislukt} zonder bronoutput.`);
if (dryRun) console.log("--dry-run: niets geüpload. Draai zonder die vlag om echt te herstellen.");
