// Regressietest: saveClientSettings en loadClientSettings zonder Supabase-configuratie (lokaal:
// supabase is null in lib/supabase.ts), zie lib/client-settings.ts.
// Draaien: tsx lib/__instellingen_opslag_lokaal_test.ts
//
// Waarom apart. saveClientSettings vult cache en localStorage sinds de reparatie van de mislukte
// opslag pas NA een geslaagde schrijfactie. Zonder database is er geen schrijfactie, en dan zijn
// cache en localStorage de opslag zelf: die moeten dus nog steeds gevuld worden. Of er een database
// is, staat vast bij het importeren van lib/supabase.ts, dus dit kan niet in dezelfde run als de
// tests met een nep-database (lib/__instellingen_opslag_mislukt_test.ts).

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const opslag = new Map<string, string>();
let gevraagd = 0;
Object.assign(globalThis, {
  window: {},
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
});
globalThis.fetch = (async () => { gevraagd += 1; return { ok: true, status: 200, json: async () => ({ data: null }) } as Response; }) as typeof fetch;

async function main() {
  const { supabase } = await import("./supabase");
  check("voorwaarde: zonder omgevingsvariabelen is er geen Supabase-client", supabase === null);
  const cs = await import("./client-settings");

  const ID = "lokaal";
  const gelezen = await cs.loadClientSettings(ID);
  check("lezen zonder database: de standaard, zonder verzoek", gelezen.kpiDoelenOpgeslagen === false && gevraagd === 0, String(gevraagd));

  const { error } = await cs.saveClientSettings({ ...cs.getClientSettings(ID), kpiTargets: { ...cs.getClientSettings(ID).kpiTargets, conversionsMode: "absolute", conversionsAbsolute: 2500 } });
  check("opslaan zonder database: geen fout", error === null, String(error));
  check("opslaan zonder database: geen verzoek", gevraagd === 0, String(gevraagd));
  const cache = cs.getClientSettings(ID);
  check("de cache heeft het doel, als opgeslagen", cache.kpiTargets.conversionsAbsolute === 2500 && cache.kpiDoelenOpgeslagen === true, JSON.stringify(cache.kpiTargets));
  const lokaal = JSON.parse(opslag.get("rm-dashboard-settings-" + ID) ?? "{}");
  check("localStorage ook", lokaal.kpiTargets?.conversionsAbsolute === 2500 && lokaal.kpiDoelenOpgeslagen === true, JSON.stringify(lokaal));

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
