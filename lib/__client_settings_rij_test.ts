// Regressietest: de client_settings-rij wordt per klant één keer gelezen (loadClientSettingsRij,
// loadClientSettings en vergeetClientSettingsRij in lib/client-settings.ts).
// Draaien: tsx lib/__client_settings_rij_test.ts
//
// Wat er misging. Bij het laden van het Overzicht lazen vijf lezers dezelfde rij: ClientDataProvider
// en useBlendedClientData (allebei select * via loadClientSettings, zonder dedupe), de KPI-band
// (channel_conversion_config), de huisstijl (brand_guide) en de beurs-editie (rai_events); op de
// wissel naar Meta kwamen er twee bij (ChannelDataProvider en ChannelPerformance). Gemeten: vijf
// verzoeken om 3,4 kB die één keer volstaat. settingsCache hielp daar niet tegen: die wordt pas NA
// het antwoord gevuld, en de provider roept loadClientSettings toch aan.
//
// Wat hier vastligt:
// - vijf gelijktijdige lezers (twee loadClientSettings, drie loadClientSettingsRij) doen ÉÉN verzoek,
//   en krijgen allemaal dezelfde rij, met de jsonb-kolommen van de andere lezers erin;
// - een latere lezer binnen de cachetijd doet geen verzoek; na de cachetijd wel;
// - na saveClientSettings (dbUpsert) leest de volgende lezer opnieuw, ook na een mislukte opslag;
// - een lezing die vóór het vergeten vertrok, zet haar oude rij niet in de cache;
// - de bestaande semantiek blijft: een mislukte lezing komt NIET in de cache (de volgende lezer
//   probeert opnieuw, en loadClientSettings geeft de terugval zonder hem te onthouden); een klant
//   ZONDER rij krijgt de terugval wél gecachet (geen rij is een antwoord), niet in localStorage;
// - de lezers in de componenten gaan via de gedeelde rij, en elke schrijver vergeet hem (brontoets).
//
// Geen React hier: het gedrag zit in de module zelf. De vijf lezers zijn de functies die de
// componenten aanroepen; wat de componenten ermee doen, toetsen hun eigen tests
// (lib/__provider_kpi_doelen_test.ts, lib/__channel_period_data_test.ts,
// lib/api/__blended_client_data_hook_test.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// loadClientSettings vraagt de database alleen als er een browser-Supabase is; die komt uit de
// omgeving, en leest bij het opstarten document.cookie.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
const opslag = new Map<string, string>();
const doc = { cookie: "" };
Object.assign(globalThis, {
  window: { document: doc },
  document: doc,
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
});

// ── Nep-fetch: telt de lezingen per klant, en de test bepaalt wanneer er geantwoord wordt ─────
const KPI_2600 = { conversionsMode: "absolute", conversionsAbsolute: 2600, revenueMode: "absolute", revenueAbsolute: 0, conversionsGrowthPct: 0, revenueGrowthPct: 0, cpaTarget: 45, roasTarget: 0 };
const RIJ = {
  kpi_targets: KPI_2600,
  brand_guide: { brandName: "GreenTech", visual: { primaryColor: "#1f7a3a" } },
  rai_events: { events: [{ abbreviation: "GRA", name: "GreenTech Amsterdam" }] },
  channel_conversion_config: { linkedin_ads: ["one_click_leads"] },
  full_branding_enabled: true,
};
const rijen = new Map<string, Record<string, unknown> | null>();
const gelezen: Record<string, number> = {};
const geschreven: string[] = [];
const wachtend = new Map<string, Array<(ok: boolean) => void>>();
const antwoord = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
globalThis.fetch = (async (url: string, init?: { method?: string }) => {
  const u = String(url);
  if (init?.method && init.method !== "GET") { geschreven.push(u); return antwoord({ data: [] }); }
  if (!u.startsWith("/api/data/client_settings")) return antwoord({ data: [] });
  const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as { clientId?: string; select?: string };
  const id = vraag.clientId ?? "";
  gelezen[id] = (gelezen[id] ?? 0) + 1;
  check(`het verzoek voor ${id} leest de hele rij (select *)`, vraag.select === "*", String(vraag.select));
  return new Promise<Response>((klaar) => {
    const lijst = wachtend.get(id) ?? [];
    lijst.push((ok) => klaar(ok ? antwoord({ data: rijen.get(id) ?? null }) : antwoord({ error: "kapot" }, false)));
    wachtend.set(id, lijst);
  });
}) as typeof fetch;
const rust = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** Wacht tot er iets te beantwoorden is (hooguit een seconde), en laat het dan los. */
async function laatLos(id: string, ok = true): Promise<number> {
  const eind = Date.now() + 1000;
  while ((wachtend.get(id) ?? []).length === 0 && Date.now() < eind) await rust(5);
  const l = wachtend.get(id) ?? []; wachtend.delete(id);
  for (const f of l) f(ok);
  await rust();
  return l.length;
}
const loopt = (id: string) => (wachtend.get(id) ?? []).length;

async function main() {
  const cs = await import("./client-settings");
  const { loadClientSettings, loadClientSettingsRij, vergeetClientSettingsRij, saveClientSettings, getClientSettings, heeftGecachteInstellingen } = cs;

  console.log("Vijf gelijktijdige lezers: één verzoek, allemaal dezelfde rij");
  {
    const ID = "gads-vijf";
    rijen.set(ID, RIJ);
    // Zoals bij het laden van het Overzicht: de provider en de blended hook (loadClientSettings),
    // de band, de huisstijl en de beurs-editie (loadClientSettingsRij), allemaal tegelijk.
    const lezers = [loadClientSettings(ID), loadClientSettings(ID), loadClientSettingsRij(ID), loadClientSettingsRij(ID), loadClientSettingsRij(ID)] as const;
    await rust();
    check("één verzoek onderweg voor vijf lezers", gelezen[ID] === 1 && loopt(ID) === 1, `${gelezen[ID]} verzoeken, ${loopt(ID)} onderweg`);
    await laatLos(ID);
    const [provider, hook, band, huisstijl, editie] = await Promise.all(lezers);
    check("na het antwoord nog steeds één verzoek", gelezen[ID] === 1, String(gelezen[ID]));
    check("de provider en de hook krijgen het opgeslagen doel", provider.kpiTargets.conversionsAbsolute === 2600 && hook.kpiTargets.conversionsAbsolute === 2600 && provider.kpiDoelenOpgeslagen === true);
    check("de band krijgt de conversieselectie", JSON.stringify(band.data?.channel_conversion_config) === JSON.stringify(RIJ.channel_conversion_config), JSON.stringify(band.data));
    check("de huisstijl krijgt de brand guide", JSON.stringify(huisstijl.data?.brand_guide) === JSON.stringify(RIJ.brand_guide));
    check("de beurs-editie krijgt de beurzen", JSON.stringify(editie.data?.rai_events) === JSON.stringify(RIJ.rai_events));
    check("de drie rij-lezers krijgen hetzelfde object", band.data === huisstijl.data && huisstijl.data === editie.data);
    check("geen fout", [band, huisstijl, editie].every((r) => r.error === null));
    check("settingsCache is gevuld (getClientSettings geeft 2.600)", getClientSettings(ID).kpiTargets.conversionsAbsolute === 2600 && heeftGecachteInstellingen(ID));

    console.log("Een latere lezer binnen de cachetijd: geen verzoek");
    const later = await loadClientSettingsRij(ID);
    const laterSettings = await loadClientSettings(ID);
    check("de rij uit de cache, zonder verzoek", gelezen[ID] === 1 && later.data?.brand_guide != null && laterSettings.kpiTargets.conversionsAbsolute === 2600, String(gelezen[ID]));

    console.log("Na de cachetijd: opnieuw lezen");
    const echteNow = Date.now;
    Date.now = () => echteNow() + 5 * 60 * 1000 + 1;
    try {
      const naTtl = loadClientSettingsRij(ID);
      await rust();
      check("na vijf minuten een nieuw verzoek", gelezen[ID] === 2, String(gelezen[ID]));
      await laatLos(ID);
      check("met de rij", (await naTtl).data?.brand_guide != null);
    } finally { Date.now = echteNow; }
  }

  console.log("Na saveClientSettings (dbUpsert) leest de volgende lezer opnieuw");
  {
    const ID = "gads-opslag";
    rijen.set(ID, RIJ);
    const eerste = loadClientSettingsRij(ID);
    await laatLos(ID);
    await eerste;
    check("voorwaarde: de rij staat in de cache", gelezen[ID] === 1 && (await loadClientSettingsRij(ID)).data != null && gelezen[ID] === 1);

    rijen.set(ID, { ...RIJ, kpi_targets: { ...KPI_2600, conversionsAbsolute: 2500 } });
    const { error } = await saveClientSettings({ ...getClientSettings(ID), kpiTargets: { ...getClientSettings(ID).kpiTargets, conversionsMode: "absolute", conversionsAbsolute: 2500 } });
    check("voorwaarde: de opslag slaagt en schrijft client_settings", error === null && geschreven.some((u) => u.includes("client_settings")));
    check("settingsCache heeft meteen het nieuwe doel (de bestaande bijwerking)", getClientSettings(ID).kpiTargets.conversionsAbsolute === 2500 && getClientSettings(ID).kpiDoelenOpgeslagen === true);
    const naOpslag = loadClientSettingsRij(ID);
    await rust();
    check("de volgende lezer doet een nieuw verzoek", gelezen[ID] === 2 && loopt(ID) === 1, `${gelezen[ID]} verzoeken, ${loopt(ID)} onderweg`);
    await laatLos(ID);
    check("en krijgt de nieuwe rij", ((await naOpslag).data?.kpi_targets as { conversionsAbsolute?: number } | undefined)?.conversionsAbsolute === 2500);

    console.log("Ook na een mislukte opslag: de rij is niet meer te vertrouwen");
    // Een netwerkfout kan ná een geslaagde schrijfactie komen; dan weet de browser niet wat er staat.
    const echteFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { method?: string }) => (init?.method === "POST" ? antwoord({ error: "db kapot" }, false) : echteFetch(url, init))) as typeof fetch;
    const mislukt = await saveClientSettings({ ...getClientSettings(ID), kpiTargets: { ...getClientSettings(ID).kpiTargets, conversionsAbsolute: 2400 } });
    globalThis.fetch = echteFetch;
    check("voorwaarde: de opslag mislukt", mislukt.error !== null);
    check("settingsCache houdt het opgeslagen doel (2.500), niet het mislukte", getClientSettings(ID).kpiTargets.conversionsAbsolute === 2500);
    const naMislukt = loadClientSettingsRij(ID);
    await rust();
    check("de volgende lezer leest opnieuw", gelezen[ID] === 3, String(gelezen[ID]));
    await laatLos(ID);
    await naMislukt;

    console.log("vergeetClientSettingsRij los: een lezing die vóór het vergeten vertrok, komt niet in de cache");
    vergeetClientSettingsRij(ID);
    const oud = loadClientSettingsRij(ID);
    await rust();
    check("voorwaarde: het verzoek loopt (de cache is net geleegd)", gelezen[ID] === 4 && loopt(ID) === 1, `${gelezen[ID]} / ${loopt(ID)}`);
    vergeetClientSettingsRij(ID);
    await laatLos(ID);
    check("de oude lezing krijgt haar antwoord nog wel", (await oud).data != null);
    const nieuw = loadClientSettingsRij(ID);
    await rust();
    check("maar de volgende lezer leest opnieuw: het oude antwoord staat niet in de cache", gelezen[ID] === 5, String(gelezen[ID]));
    await laatLos(ID);
    await nieuw;
  }

  console.log("Een mislukte lezing komt niet in de cache");
  {
    const ID = "gads-fout";
    rijen.set(ID, RIJ);
    const eerste = loadClientSettings(ID);
    await laatLos(ID, false);
    const uit = await eerste;
    check("loadClientSettings geeft de terugval", uit.kpiDoelenOpgeslagen === false);
    check("en onthoudt hem niet: na een fout is er niets bekend", !heeftGecachteInstellingen(ID));
    const tweede = loadClientSettingsRij(ID);
    await rust();
    check("de volgende lezer probeert opnieuw", gelezen[ID] === 2 && loopt(ID) === 1, `${gelezen[ID]} / ${loopt(ID)}`);
    await laatLos(ID);
    check("en slaagt", (await tweede).data?.brand_guide != null);
    check("nu wel gecachet: een derde lezer doet geen verzoek", (await loadClientSettingsRij(ID)).data != null && gelezen[ID] === 2, String(gelezen[ID]));
  }

  console.log("Een klant zonder rij: de terugval wordt gecachet, niet in localStorage");
  {
    const ID = "gads-zonder-rij";
    rijen.set(ID, null);
    const eerste = loadClientSettings(ID);
    await laatLos(ID);
    const uit = await eerste;
    check("de terugval, niet als ingevoerd doel", uit.kpiDoelenOpgeslagen === false && !cs.kpiDoelenIngevoerd(uit));
    check("in het geheugen: een klantwissel A -> B -> A sluit het dashboard niet opnieuw", heeftGecachteInstellingen(ID));
    check("niet in localStorage: daar hoort wat echt gelezen of opgeslagen is", opslag.get("rm-dashboard-settings-" + ID) === undefined);
    const rij = await loadClientSettingsRij(ID);
    check("\"geen rij\" is een antwoord: een tweede lezer doet geen verzoek", rij.data === null && rij.error === null && gelezen[ID] === 1, String(gelezen[ID]));
  }

  // ── Brontoets: de lezers gaan via de gedeelde rij, en elke schrijver vergeet hem ────────────
  // Een toets op de brontekst, bewust: welke component wat leest, is niet uit de module zelf af te
  // leiden, en een nieuwe eigen select op client_settings is precies de fout die hier begon.
  console.log("De lezers en de schrijvers in de componenten");
  {
    const bron = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const LEZERS = [
      "lib/client-data-provider.tsx", "lib/use-blended-client-data.ts", "lib/use-channel-period-data.ts",
      "components/branding/brand-theme-provider.tsx", "lib/fair/use-upcoming-edition.ts",
      "components/dashboard/channel-data-provider.tsx", "components/dashboard/channel-performance.tsx",
    ];
    for (const f of LEZERS) {
      const b = bron(f);
      check(`${f} leest via de gedeelde rij`, /loadClientSettings(Rij)?\(clientId\)/.test(b));
      check(`${f} heeft geen eigen select op client_settings meer`, !/dbSelectOne<[^>]*>\(\s*"client_settings"/.test(b));
    }
    const SCHRIJVERS = [
      "lib/client-settings.ts", "components/dashboard/channel-conversion-settings.tsx", "components/dashboard/ga4-settings.tsx",
      "components/dashboard/search-console-settings.tsx", "components/dashboard/event-settings.tsx", "components/dashboard/branding-view.tsx",
      "lib/migrate-to-supabase.ts",
    ];
    for (const f of SCHRIJVERS) {
      const b = bron(f);
      const upsert = b.indexOf('dbUpsert("client_settings"');
      const vergeet = b.indexOf("vergeetClientSettingsRij(", upsert);
      check(`${f} vergeet de rij na dbUpsert op client_settings`, upsert > 0 && vergeet > upsert, `${upsert} / ${vergeet}`);
    }
    // De band leest zijn selectie uit de rijcache; het seintje na het opslaan moet hem dus eerst
    // vergeten, anders kreeg hij vijf minuten de oude terug (lib/__channel_period_data_test.ts eist
    // een tweede lezing na het opslaan).
    const band = bron("lib/use-channel-period-data.ts");
    const meld = band.indexOf("export function meldKanaalselectieOpgeslagen(");
    check("meldKanaalselectieOpgeslagen vergeet de rij", meld > 0 && band.indexOf("vergeetClientSettingsRij(clientId)", meld) > meld);
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
