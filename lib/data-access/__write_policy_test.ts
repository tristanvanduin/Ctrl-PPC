// Test voor het schrijfbeleid. Deterministisch, geen IO.
// Draaien: npx tsx lib/data-access/__write_policy_test.ts
//
// De inzet: dit is straks de enige weg waarlangs de browser nog schrijft. Een gat hier is een
// gat in de beurs-scheiding. De tests gaan daarom vooral over de manieren waarop een client
// zou kunnen proberen buiten zijn beurs te schrijven, en over de bewerkingen die per ongeluk
// een hele tabel raken.

import {
  WRITABLE_TABLES, isWritableTable, isWriteOperation, policyFor, validateWrite,
} from "./write-policy";
import { ROLE_CAPABILITIES, ROLES, can } from "../auth/roles";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De tabel zelf ──────────────────────────────────────────────────────────

check("bekende tabel", isWritableTable("sprint_items"));
check("onbekende tabel", !isWritableTable("user_roles"));
check("rolbeheer staat er niet in", !isWritableTable("user_roles") && !isWritableTable("user_clients"));
check("policyFor levert null bij onbekend", policyFor("bestaat_niet") === null);

// Elk recht in de tabel moet een bestaand recht zijn dat ook echt aan iemand is toegekend,
// anders is de tabel onbereikbaar en valt het op als een lege pagina in plaats van een fout.
for (const [tabel, policy] of Object.entries(WRITABLE_TABLES)) {
  const dragers = ROLES.filter((r) => can(r, policy.capability));
  check(`${tabel}: het recht bestaat en iemand heeft het`, dragers.length > 0, policy.capability);
  check(`${tabel}: minstens een bewerking`, policy.operations.length > 0);
  const upsert = policy.operations.includes("upsert");
  check(`${tabel}: upsert heeft een conflictdoel`, !upsert || Boolean(policy.conflictTarget));
}

// Een beurs_manager mag zijn eigen sprint sturen maar geen instellingen of meetdata raken.
check("beurs_manager mag sprint_items", can("beurs_manager", WRITABLE_TABLES.sprint_items.capability));
check("beurs_manager mag geen client_settings", !can("beurs_manager", WRITABLE_TABLES.client_settings.capability));
check("brand_strateeg schrijft niets", Object.values(WRITABLE_TABLES).every((p) => !can("brand_strateeg", p.capability)));
check("viewer schrijft niets", Object.values(WRITABLE_TABLES).every((p) => !can("viewer", p.capability)));
check("IT muteert geen sprint", !can("it", WRITABLE_TABLES.sprint_items.capability));
// De gesynchroniseerde meetdata hoort niet vanuit de browser schrijfbaar te zijn.
check("geen ads_-tabel is schrijfbaar", Object.keys(WRITABLE_TABLES).every((t) => !t.startsWith("ads_")));
check("admin mag alles wat hier staat", Object.values(WRITABLE_TABLES).every((p) => ROLE_CAPABILITIES.admin.includes(p.capability)));

// ── Bewerkingen ────────────────────────────────────────────────────────────

check("op-herkenning", isWriteOperation("insert") && isWriteOperation("delete"));
check("select is geen schrijfbewerking", !isWriteOperation("select") && !isWriteOperation(""));

{
  const r = validateWrite({ table: "sop_tasks", op: "delete", clientId: "greentech", match: { id: 1 } }, true);
  check("een verboden bewerking wordt geweigerd", !r.ok && r.status === 400);
}
{
  const r = validateWrite({ table: "nergens", op: "insert", rows: [{}] }, true);
  check("een onbekende tabel wordt geweigerd", !r.ok && r.status === 400);
}

// ── De beurs-grens ─────────────────────────────────────────────────────────

{
  const r = validateWrite({ table: "sprint_items", op: "insert", clientId: "greentech", rows: [{ titel: "x" }] }, false);
  check("buiten de scope levert 403", !r.ok && r.status === 403);
}
{
  const r = validateWrite({ table: "sprint_items", op: "insert", rows: [{ titel: "x" }] }, true);
  check("een beurs-tabel zonder beurs wordt geweigerd", !r.ok && r.status === 400);
}

// Het belangrijkste geval: een client die een ANDERE beurs in de rij meestuurt. De waarde
// moet worden overschreven, niet gecontroleerd — controleren laat de vraag open wat er
// gebeurt bij een rij zonder de kolom.
{
  const r = validateWrite(
    { table: "sprint_items", op: "insert", clientId: "greentech", rows: [{ titel: "x", client_id: "aquatech" }] },
    true,
  );
  check("een meegestuurde vreemde beurs wordt overschreven", r.ok && r.rows[0].client_id === "greentech",
    r.ok ? String(r.rows[0].client_id) : "");
}
{
  const r = validateWrite(
    { table: "sprint_items", op: "insert", clientId: "greentech", rows: [{ a: 1 }, { b: 2 }, { c: 3 }] },
    true,
  );
  check("elke rij krijgt de beurs", r.ok && r.rows.every((row) => row.client_id === "greentech"));
}
// Bij een update mag de beurs-kolom niet in de te zetten waarden blijven staan: dat zou een
// rij naar een andere beurs verplaatsen.
{
  const r = validateWrite(
    { table: "client_notes", op: "update", clientId: "greentech", values: { tekst: "x", client_id: "aquatech" }, match: { id: 7 } },
    true,
  );
  check("de beurs-kolom kan niet via update worden verzet", r.ok && !("client_id" in r.values));
  check("het filter krijgt de eigen beurs erbij", r.ok && r.match.client_id === "greentech" && r.match.id === 7);
}
// En een filter dat een andere beurs noemt wordt teruggezet naar de eigen.
{
  const r = validateWrite(
    { table: "client_notes", op: "delete", clientId: "greentech", match: { id: 7, client_id: "aquatech" } },
    true,
  );
  check("een vreemde beurs in het filter wordt overschreven", r.ok && r.match.client_id === "greentech");
}

// ── Bewerkingen die de hele tabel kunnen raken ─────────────────────────────

{
  const r = validateWrite({ table: "scripts", op: "delete", match: {} }, true);
  check("delete zonder filter op een gedeelde tabel wordt geweigerd", !r.ok && r.status === 400);
}
{
  const r = validateWrite({ table: "scripts", op: "update", values: { naam: "x" }, match: {} }, true);
  check("update zonder filter op een gedeelde tabel wordt geweigerd", !r.ok && r.status === 400);
}
{
  const r = validateWrite({ table: "scripts", op: "delete", match: { id: 3 } }, true);
  check("delete met filter mag wel", r.ok);
}
// Bij een beurs-tabel is de beurs zelf een geldig filter: "wis de data van deze beurs" is een
// bestaande knop. Dat kan per definitie niet buiten de eigen beurs komen.
{
  const r = validateWrite({ table: "client_files", op: "delete", clientId: "greentech", match: {} }, true);
  check("een beurs-brede delete mag, begrensd tot die beurs", r.ok && r.match.client_id === "greentech");
  check("en raakt niets anders", r.ok && Object.keys(r.match).length === 1);
}

// ── Lege invoer ────────────────────────────────────────────────────────────

{
  const r = validateWrite({ table: "sprint_items", op: "insert", clientId: "greentech", rows: [] }, true);
  check("insert zonder rijen wordt geweigerd", !r.ok && r.status === 400);
}
{
  const r = validateWrite({ table: "client_notes", op: "update", clientId: "greentech", values: {}, match: { id: 1 } }, true);
  check("update zonder waarden wordt geweigerd", !r.ok && r.status === 400);
}
{
  const r = validateWrite({ table: "client_settings", op: "upsert", clientId: "greentech", rows: [{ a: 1 }] }, true);
  check("upsert vult de beurs in", r.ok && r.rows[0].client_id === "greentech");
}

// De gedeelde tabel heeft geen beurs-kolom en hoort er ook geen te krijgen.
{
  const r = validateWrite({ table: "scripts", op: "insert", clientId: "greentech", rows: [{ naam: "x" }] }, true);
  check("een gedeelde tabel krijgt geen beurs-kolom", r.ok && !("client_id" in r.rows[0]));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
