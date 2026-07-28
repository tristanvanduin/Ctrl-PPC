// SQL uitvoeren tegen Supabase via de Management API.
//
// Waarom dit bestaat: de service_role-sleutel praat met PostgREST en kan dus alleen dingen
// doen die als tabel-endpoint bestaan — selecteren, invoegen, bijwerken. DDL niet. Een
// migratie draaien, een trigger herstellen, een index toevoegen: dat gaat alleen via de
// Management API, en die wil een personal access token (SUPABASE_ACCESS_TOKEN), niet de
// service_role-sleutel. Dat onderscheid heeft eerder tijd gekost, vandaar dit briefje.
//
// Gebruik:
//   node -e 'import("./scripts/supabase-sql.mjs").then(m => m.sql("select 1").then(console.log))'
//   node scripts/supabase-sql.mjs "select count(*) from clients"
//   node scripts/supabase-sql.mjs --file scripts/024_rai_events.sql
//
// Het project komt uit NEXT_PUBLIC_SUPABASE_URL, niet uit een hardgecodeerde ref: anders wijst
// dit script na een projectmigratie stilletjes naar de oude database.

import { readFileSync } from "node:fs";

function laadEnv() {
  let inhoud;
  try {
    inhoud = readFileSync(".env.local", "utf8");
  } catch {
    return; // Draait er al een omgeving met de variabelen, dan is dat prima.
  }
  for (const regel of inhoud.split("\n")) {
    const i = regel.indexOf("=");
    if (i <= 0 || regel.trimStart().startsWith("#")) continue;
    const naam = regel.slice(0, i).trim();
    if (process.env[naam] === undefined) process.env[naam] = regel.slice(i + 1).trim();
  }
}

laadEnv();

function projectRef() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
  if (!m) throw new Error("Geen project-ref af te leiden uit SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL");
  return m[1];
}

export async function sql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN ontbreekt — DDL gaat niet met de service_role-sleutel");

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${tekst.slice(0, 400)}`);
  try {
    return JSON.parse(tekst);
  } catch {
    return tekst;
  }
}

// Rechtstreeks aangeroepen: het argument is de query, of --file <pad>.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=scripts\/)/, ""))) {
  const args = process.argv.slice(2);
  const query = args[0] === "--file" ? readFileSync(args[1], "utf8") : args.join(" ");
  if (!query.trim()) {
    console.error("Geef een query mee, of --file <pad>.");
    process.exit(1);
  }
  sql(query).then(
    (r) => console.log(typeof r === "string" ? r : JSON.stringify(r, null, 2)),
    (e) => { console.error(String(e.message ?? e)); process.exit(1); }
  );
}
