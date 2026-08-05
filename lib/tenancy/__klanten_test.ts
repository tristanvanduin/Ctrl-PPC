// De klantenlijst per bureau.
//
// Waarom dit getest wordt: de vier serverplekken die deze vraag stelden, lazen hem uit één
// globaal JSON-blob zonder agency_id. Het gedrag dat hier vastligt is precies wat daar niet kon:
// een lijst afbakenen tot één bureau. Gaat dat stuk, dan synct bureau A de accounts van bureau B
// met zijn eigen credentials, en dat merk je pas als iemand het merkt.

import { klantVanId, externAccountId, synckandidaten, type Klant } from "./klanten";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

interface Rij {
  client_id: string; name: string | null; source: string | null;
  external_id: string | null; agency_id: string | null;
}

const RIJEN: Rij[] = [
  { client_id: "gads-1", name: "Klant A1", source: "google-ads", external_id: "1", agency_id: "bureau-a" },
  { client_id: "gads-2", name: "Klant A2", source: "google-ads", external_id: "2", agency_id: "bureau-a" },
  { client_id: "gads-3", name: "Klant B1", source: "google-ads", external_id: "3", agency_id: "bureau-b" },
  { client_id: "meta-1", name: "Meta B", source: "meta", external_id: "9", agency_id: "bureau-b" },
  // Gekoppeld aan niets: hoort nooit in een synclijst.
  { client_id: "gads-los", name: "Zonder id", source: "google-ads", external_id: null, agency_id: "bureau-a" },
  // Lege tekst is geen id. Google zou hierop een query zonder account doen.
  { client_id: "gads-leeg", name: "Leeg id", source: "google-ads", external_id: "   ", agency_id: "bureau-a" },
  { client_id: "demo-x", name: "Demo", source: "demo", external_id: null, agency_id: null },
];

/** Een Supabase-vorm die precies de filters ondersteunt die deze module gebruikt. */
function nepClient(rijen: Rij[], fout = false) {
  const gebruikt: string[] = [];
  const bouw = (filter: (r: Rij) => boolean) => ({
    eq(kolom: string, waarde: unknown) {
      gebruikt.push(`eq:${kolom}`);
      return bouw((r) => filter(r) && (r as unknown as Record<string, unknown>)[kolom] === waarde);
    },
    not(kolom: string, _op: string, _waarde: unknown) {
      gebruikt.push(`not-null:${kolom}`);
      return bouw((r) => filter(r) && (r as unknown as Record<string, unknown>)[kolom] != null);
    },
    maybeSingle() {
      const t = rijen.filter(filter);
      return Promise.resolve(fout ? { data: null, error: new Error("stuk") } : { data: t[0] ?? null, error: null });
    },
    then(res: (v: { data: unknown; error: unknown }) => void) {
      res(fout ? { data: null, error: new Error("stuk") } : { data: rijen.filter(filter), error: null });
    },
  });
  return { from: () => ({ select: () => bouw(() => true) }), gebruikt };
}

async function main() {
  console.log("klantVanId");
  const a1 = await klantVanId(nepClient(RIJEN) as never, "gads-1");
  check("vindt de klant", a1?.clientId === "gads-1", JSON.stringify(a1));
  check("neemt het bureau mee", a1?.agencyId === "bureau-a", String(a1?.agencyId));
  check("neemt het externe id mee", a1?.externId === "1", String(a1?.externId));
  check("onbekende klant geeft null", (await klantVanId(nepClient(RIJEN) as never, "bestaat-niet")) === null);
  // Een leesfout mag geen worp zijn: de aanroepers beslissen zelf of ze doorgaan zonder koppeling.
  check("een leesfout geeft null en geen uitzondering",
    (await klantVanId(nepClient(RIJEN, true) as never, "gads-1")) === null);

  console.log("\nexternAccountId");
  check("geeft het externe id", (await externAccountId(nepClient(RIJEN) as never, "gads-2")) === "2");
  check("null als er geen koppeling is", (await externAccountId(nepClient(RIJEN) as never, "gads-los")) === null);

  console.log("\nsynckandidaten");
  const alles = await synckandidaten(nepClient(RIJEN) as never, { bron: "google-ads" });
  check("filtert op bron", alles.every((k: Klant) => k.bron === "google-ads"), alles.map((k) => k.bron).join(","));
  check("laat klanten zonder extern id weg",
    !alles.some((k: Klant) => k.clientId === "gads-los"), alles.map((k) => k.clientId).join(","));
  check("een leeg extern id telt ook niet",
    !alles.some((k: Klant) => k.clientId === "gads-leeg"), alles.map((k) => k.clientId).join(","));
  check("zonder bureau alle bureaus", alles.length === 3, String(alles.length));

  // DE KERN: afbakenen tot één bureau.
  const client = nepClient(RIJEN);
  const vanA = await synckandidaten(client as never, { bron: "google-ads", agencyId: "bureau-a" });
  check("met bureau alleen dat bureau", vanA.map((k) => k.clientId).join(",") === "gads-1,gads-2",
    vanA.map((k) => k.clientId).join(","));
  check("het bureaufilter staat echt op de query", client.gebruikt.includes("eq:agency_id"),
    client.gebruikt.join(","));
  check("bureau B komt niet in de lijst van bureau A",
    !vanA.some((k: Klant) => k.agencyId === "bureau-b"));
  const vanB = await synckandidaten(nepClient(RIJEN) as never, { bron: "google-ads", agencyId: "bureau-b" });
  check("en andersom", vanB.map((k) => k.clientId).join(",") === "gads-3", vanB.map((k) => k.clientId).join(","));

  // Vaste volgorde: een cron die elke nacht anders sorteert, is bij een afgebroken run niet met
  // de vorige te vergelijken.
  const omgekeerd = await synckandidaten(nepClient([...RIJEN].reverse()) as never, { bron: "google-ads" });
  check("de volgorde ligt vast, ongeacht wat de database teruggeeft",
    omgekeerd.map((k) => k.clientId).join(",") === alles.map((k) => k.clientId).join(","),
    omgekeerd.map((k) => k.clientId).join(","));

  check("een leesfout geeft een lege lijst",
    (await synckandidaten(nepClient(RIJEN, true) as never, { bron: "google-ads" })).length === 0);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
