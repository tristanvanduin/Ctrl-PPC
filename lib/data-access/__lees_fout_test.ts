// Een ontbrekende tabel via /api/data: geen 500 (dat keurt de rookproef af en vult de serverlogs),
// maar een herkenbare code; de browser ziet een gewone fout met die code, en de dagrijen van Google
// worden dan één keer per bezoek gevraagd, niet bij elke keuze opnieuw.
// Draaien: tsx --tsconfig ./tsconfig.json lib/data-access/__lees_fout_test.ts

import { leesFoutAntwoord } from "./lees-fout";
import { dbSelect, TABEL_ONTBREEKT } from "./client-read";
import { laadGoogleDagen } from "../period/use-dag-telling";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("Het antwoord van de route");
{
  const weg = leesFoutAntwoord({ code: "42P01", message: 'relation "ads_account_daily" does not exist' });
  check("een ontbrekende tabel: status onder de 400, met de code", weg.status === 200 && weg.body.code === TABEL_ONTBREEKT && weg.body.ok === false, JSON.stringify(weg));
  const schema = leesFoutAntwoord({ code: "PGRST205", message: "Could not find the table 'public.ads_account_daily' in the schema cache" });
  check("ook in de vorm van PostgREST", schema.body.code === TABEL_ONTBREEKT);
  const echt = leesFoutAntwoord({ code: "57014", message: "canceling statement due to statement timeout" });
  check("een echte databasefout blijft een 500", echt.status === 500 && echt.body.code === undefined);
}

async function browserkant(): Promise<void> {
  console.log("De browserkant");
  const verzoeken: string[] = [];
  let antwoord: { status: number; body: unknown } = { status: 200, body: { ok: false, code: TABEL_ONTBREEKT, error: "weg" } };
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    verzoeken.push(url);
    return { ok: antwoord.status < 400, status: antwoord.status, json: async () => antwoord.body } as unknown as Response;
  };
  const { data, error } = await dbSelect("ads_account_daily", { select: "date", clientId: "k1" });
  check("een ontbrekende tabel is voor de lezer een fout met de code", data.length === 0 && error?.code === TABEL_ONTBREEKT, JSON.stringify(error));

  verzoeken.length = 0;
  check("zonder dagtabel: geen dagrijen", (await laadGoogleDagen("k-weg")) === null);
  await laadGoogleDagen("k-weg");
  await laadGoogleDagen("k-weg");
  check("een ontbrekende tabel wordt één keer per bezoek gevraagd", verzoeken.length === 1, String(verzoeken.length));

  verzoeken.length = 0;
  antwoord = { status: 500, body: { error: "timeout" } };
  await laadGoogleDagen("k-fout");
  await new Promise((r) => setTimeout(r, 0));
  await laadGoogleDagen("k-fout");
  check("een andere fout wordt niet onthouden: de volgende keuze vraagt opnieuw", verzoeken.length === 2, String(verzoeken.length));
}

void browserkant().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
});
