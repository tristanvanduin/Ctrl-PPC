// Stelt merkgroepen voor in client_groups, op basis van de accountnamen.
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
// ── HET SCHRIJFT IN client_groups, NIET IN EEN EIGEN TABEL ──────────────────
//
// Een eerdere versie schreef in een aparte `merken`-tabel. Die is met migratie 052 weer weg: het
// niveau bestond al, inclusief beheerscherm, en twee van de vier groepen die dit script voorstelt
// had iemand met de hand al precies zo gemaakt. Een tweede tabel ernaast levert alleen twee
// plekken op waar iets "MPC" heet.
//
// ── WAT HET NOOIT AANRAAKT ──────────────────────────────────────────────────
//
// Een bestaande groep. Niet de leden, niet de naam, niet de soort. Handmatige groepen staan op
// bevestigd = true en dat betekent: een mens heeft dit bedacht. Het enige wat dit script bij zo'n
// groep doet is een `reden` invullen wanneer het algoritme op dezelfde indeling uitkomt — dat is
// informatie voor het beheerscherm, geen wijziging aan de groep.
//
// Nieuwe groepen komen erbij als soort 'merk' met bevestigd = false. Zolang die vlag false is,
// hoort een vergelijking zichtbaar te maken dat de indeling geraden is.

import { sql } from "./supabase-sql.mjs";
import { stelMerkgroepenVoor } from "../lib/branding/merkgroepen";

const SCHRIJVEN = process.argv.includes("--schrijf");

interface AccountRij { client_id: string; agency_id: string; name: string }
interface GroepRij { id: string; name: string; soort: string | null; bevestigd: boolean; reden: string | null; leden: string[] }

/** Enkele quotes verdubbelen; namen als "Sabé's" mogen de query niet openbreken. */
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Twee ledenlijsten zijn gelijk ongeacht volgorde.
 *
 * Samenvoegen met \u0000 als scheidingsteken, geschreven als ESCAPE en niet als losse byte. Een
 * letterlijke NUL maakt het bestand binair voor grep en elk ander tekstgereedschap; de
 * hygienepoort ving hem hier op positie 2788 -- precies waarvoor die controle bestaat.
 *
 * En NUL is hier het juiste teken: een client_id kan een spatie of een komma bevatten, en dan
 * zouden ["a b","c"] en ["a","b c"] als gelijk gelden.
 */
const zelfdeLeden = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

// Alles in een async functie: tsx compileert dit bestand naar CommonJS en daar bestaat
// top-level await niet.
async function main(): Promise<void> {
  const accounts = (await sql(
    "select client_id, agency_id, name from accounts order by name"
  )) as AccountRij[];

  const groepen = (await sql(`
    select g.id, g.name, g.soort, g.bevestigd, g.reden,
           coalesce(array_agg(m.client_id) filter (where m.client_id is not null), '{}') as leden
    from client_groups g left join client_group_members m on m.group_id = g.id
    group by g.id, g.name, g.soort, g.bevestigd, g.reden order by g.name`)) as GroepRij[];

  const perNaam = new Map(accounts.map((a) => [a.name, a]));
  const voorstellen = stelMerkgroepenVoor(accounts.map((a) => a.name));

  console.log(`${accounts.length} accounts, ${groepen.length} bestaande groep(en), ${voorstellen.length} voorstel(len)\n`);

  let nieuw = 0, herkend = 0, geblokkeerd = 0;

  for (const v of voorstellen) {
    const leden = v.accounts.map((n) => perNaam.get(n)!).filter(Boolean);
    const clientIds = leden.map((a) => a.client_id);

    // Een groep hoort bij één bureau. Anders zou één vergelijkend rapport data van twee tenants
    // naast elkaar zetten -- precies het lek dat het bureaus-model moet uitsluiten.
    const bureaus = [...new Set(leden.map((a) => a.agency_id))];
    if (bureaus.length > 1) {
      console.log(`  OVERGESLAGEN  ${v.stam}: accounts van ${bureaus.length} verschillende bureaus`);
      geblokkeerd += 1;
      continue;
    }

    // Bestaat hij al? Op LEDEN en niet op naam: "Labels Edwin" heeft dezelfde drie accounts als
    // het voorstel "GoedeInnovaties". Dat is dezelfde indeling onder een andere naam, en er een
    // tweede groep naast zetten zou die accounts in twee groepen laten zitten.
    const bestaand = groepen.find((g) => zelfdeLeden(g.leden, clientIds))
      ?? groepen.find((g) => g.name.toLowerCase() === v.stam.toLowerCase());

    if (bestaand) {
      const notitie = `het naamalgoritme komt op dezelfde indeling uit (${v.regels.join("+")})`;
      const zelfdeNaam = bestaand.name.toLowerCase() === v.stam.toLowerCase();
      console.log(`  ${v.stam}  →  bestaande groep "${bestaand.name}"${zelfdeNaam ? "" : "  (andere naam, zelfde leden)"}`);
      console.log(`      ${bestaand.bevestigd ? "bevestigd" : "voorstel"}, soort ${bestaand.soort ?? "nog niet ingedeeld"} — blijft ongemoeid`);
      herkend += 1;
      if (SCHRIJVEN && !bestaand.reden) {
        await sql(`update client_groups set reden = ${q(notitie)} where id = ${q(bestaand.id)} and reden is null`);
        console.log("      aantekening toegevoegd");
      }
      console.log("");
      continue;
    }

    console.log(`  ${v.stam}  (${v.regels.join(" + ")})  NIEUW`);
    for (const a of leden) console.log(`      ${a.name}`);

    if (SCHRIJVEN) {
      await sql(`insert into client_groups (name, sort_order, agency_id, soort, bevestigd, reden)
        values (${q(v.stam)}, coalesce((select max(sort_order) from client_groups), 0) + 1,
                ${q(bureaus[0])}, 'merk', false, ${q(v.regels.join("+"))})`);
      const [{ id }] = (await sql(`select id from client_groups where name = ${q(v.stam)} limit 1`)) as { id: string }[];
      await sql(`insert into client_group_members (group_id, client_id)
        values ${clientIds.map((c) => `(${q(id)}, ${q(c)})`).join(", ")} on conflict do nothing`);
    }
    nieuw += 1;
    console.log("");
  }

  console.log(SCHRIJVEN
    ? `Geschreven: ${nieuw} nieuwe groep(en), ${herkend} bestaande herkend, ${geblokkeerd} geblokkeerd.`
    : `Droogloop: ${nieuw} nieuwe groep(en), ${herkend} bestaande herkend, ${geblokkeerd} geblokkeerd.
Draai opnieuw met --schrijf om het uit te voeren.`);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
