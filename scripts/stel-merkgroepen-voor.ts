// Zet merkgroepen klaar als VOORSTEL, op basis van de accountnamen.
//
// Gebruik:
//   npx tsx scripts/stel-merkgroepen-voor.ts            toont wat er zou gebeuren (droogloop)
//   npx tsx scripts/stel-merkgroepen-voor.ts --schrijf   voert het uit
//
// ── WAAROM DROOGLOOP DE STANDAARD IS ────────────────────────────────────────
//
// Dit script leidt uit NAMEN af welke accounts bij elkaar horen. Dat is een aanwijzing, geen
// bewijs. De eerste versie van het algoritme zette "Easy Living" bij "Easy-Ergonomics" omdat ze
// allebei met "Easy" beginnen — twee verschillende klanten. Zou dat ongezien zijn weggeschreven,
// dan telde het budget van de één bij de omzet van de ander, in een rapport dat er correct uitziet.
//
// Draaien zonder vlag laat dus alleen zien wat het zou doen. Wie het uitvoert heeft het gezien.
//
// ── WAT HET NOOIT AANRAAKT ──────────────────────────────────────────────────
//
// Een account met merk_bevestigd = true is door een mens beoordeeld. Dat besluit is hier
// onaantastbaar, in beide richtingen: een bevestigde koppeling wordt niet verlegd, en een bewust
// losgemaakt account (merk_id leeg, bevestigd true) krijgt niet opnieuw een voorstel. Zonder die
// tweede regel zou elke afwijzing bij de volgende run terugkomen en werd "afwijzen" een knop die
// niets doet.

import { sql } from "./supabase-sql.mjs";
import { stelMerkgroepenVoor } from "../lib/branding/merkgroepen";

const SCHRIJVEN = process.argv.includes("--schrijf");

interface AccountRij {
  id: string;
  agency_id: string;
  name: string;
  merk_id: string | null;
  merk_bevestigd: boolean;
}

/** Enkele quotes verdubbelen; namen als "Sabé's" mogen de query niet openbreken. */
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

/** Een slug die stabiel is bij dezelfde stam: kleine letters, alles wat geen letter of cijfer is wordt een streep. */
function slugVan(stam: string): string {
  return stam.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// Alles in een async functie: tsx compileert dit bestand naar CommonJS en daar bestaat
// top-level await niet.
async function main(): Promise<void> {
  const accounts = (await sql(
    "select id, agency_id, name, merk_id, merk_bevestigd from accounts order by name"
  )) as AccountRij[];

  const perNaam = new Map(accounts.map((a) => [a.name, a]));
  const groepen = stelMerkgroepenVoor(accounts.map((a) => a.name));

  console.log(`${accounts.length} accounts, ${groepen.length} groep(en) voorgesteld\n`);

  let gekoppeld = 0, overgeslagen = 0, geblokkeerd = 0;

  for (const groep of groepen) {
    const leden = groep.accounts.map((n) => perNaam.get(n)!).filter(Boolean);

    // Een merk hoort bij één bureau. De samengestelde vreemde sleutel uit migratie 051 zou dit ook
    // tegenhouden, maar dan als databasefout halverwege het script. Beter hier, met een uitleg.
    const bureaus = [...new Set(leden.map((a) => a.agency_id))];
    if (bureaus.length > 1) {
      console.log(`  OVERGESLAGEN  ${groep.stam}: accounts van ${bureaus.length} verschillende bureaus`);
      geblokkeerd += 1;
      continue;
    }

    const teKoppelen = leden.filter((a) => !a.merk_bevestigd);
    const vast = leden.length - teKoppelen.length;

    console.log(`  ${groep.stam}  (${groep.regels.join(" + ")})`);
    for (const a of leden) {
      const stand = a.merk_bevestigd ? "bevestigd, blijft" : a.merk_id ? "voorstel, bijgewerkt" : "nieuw voorstel";
      console.log(`      ${a.name.padEnd(42)} ${stand}`);
    }
    if (vast > 0) console.log(`      → ${vast} account(s) blijven ongemoeid`);

    if (teKoppelen.length < 2) {
      console.log("      → minder dan twee vrije accounts, geen groep gemaakt\n");
      overgeslagen += 1;
      continue;
    }

    if (SCHRIJVEN) {
      const slug = slugVan(groep.stam);
      const agency = bureaus[0];
      await sql(`insert into merken (agency_id, slug, name) values (${q(agency)}, ${q(slug)}, ${q(groep.stam)})
                 on conflict (agency_id, slug) do update set name = excluded.name`);
      const [{ id: merkId }] = (await sql(
        `select id from merken where agency_id = ${q(agency)} and slug = ${q(slug)}`
      )) as { id: string }[];

      await sql(`update accounts set merk_id = ${q(merkId)}, merk_reden = ${q(groep.regels.join("+"))}
                 where merk_bevestigd = false and id in (${teKoppelen.map((a) => q(a.id)).join(", ")})`);
      gekoppeld += teKoppelen.length;
    } else {
      gekoppeld += teKoppelen.length;
    }
    console.log("");
  }

  console.log(SCHRIJVEN
    ? `Geschreven: ${gekoppeld} account(s) gekoppeld, ${overgeslagen} groep(en) overgeslagen, ${geblokkeerd} geblokkeerd.`
    : `Droogloop: ${gekoppeld} account(s) zouden gekoppeld worden, ${overgeslagen} groep(en) overgeslagen, ${geblokkeerd} geblokkeerd.
  Draai opnieuw met --schrijf om het uit te voeren.`);

  // Alles wat hier uitkomt is een VOORSTEL. Zolang merk_bevestigd false is, hoort een vergelijking
  // die op merk groepeert dat zichtbaar te maken — anders is een geraden koppeling op het scherm
  // niet te onderscheiden van een bevestigde.
  if (SCHRIJVEN) {
    const [telling] = (await sql(`
      select count(*) filter (where merk_id is not null and merk_bevestigd = false) as voorstellen,
             count(*) filter (where merk_id is not null and merk_bevestigd) as bevestigd,
             count(*) filter (where merk_id is null and merk_bevestigd) as bewust_los
      from accounts`)) as Record<string, number>[];
    console.log(`\nStand: ${telling.voorstellen} voorstel(len), ${telling.bevestigd} bevestigd, ${telling.bewust_los} bewust losstaand.`);
  }
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
