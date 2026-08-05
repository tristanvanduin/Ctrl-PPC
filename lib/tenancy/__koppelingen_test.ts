// De platformkoppeling per bureau.
//
// Wat hier vastligt zijn de twee regels waar deze koppeling stil op kan sneuvelen: een leeg
// refresh token dat het bestaande overschrijft, en een verlopen token dat niemand ziet aankomen.

import {
  geheimNaam, beoordeelVerval, bewaarKoppeling, leesKoppeling, trekKoppelingIn,
  VERLOOPWAARSCHUWING_DAGEN, PROVIDERS,
} from "./koppelingen";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const BUREAU = "d825eab8-ec2c-4898-a309-a45addcbda03";

console.log("geheimNaam");
check("naam bevat platform en bureau", geheimNaam(BUREAU, "google_ads") === `oauth_google_ads_${BUREAU}`);
check("twee platforms geven twee namen", geheimNaam(BUREAU, "meta") !== geheimNaam(BUREAU, "google_ads"));
// De SQL-functies in migratie 063 eisen dit patroon; wijkt de naam af, dan werpen ze. Die twee
// moeten dus bij elkaar blijven, en dat is precies wat hier bewaakt wordt.
const PATROON = /^oauth_[a-z_]+_[0-9a-fA-F-]{36}$/;
check("elke provider levert een naam die de SQL-begrenzing accepteert",
  PROVIDERS.every((p) => PATROON.test(geheimNaam(BUREAU, p))),
  PROVIDERS.map((p) => geheimNaam(BUREAU, p)).join(" | "));

console.log("\nbeoordeelVerval");
const nu = new Date("2026-08-05T12:00:00Z");
const overDagen = (d: number) => new Date(nu.getTime() + d * 86_400_000).toISOString();

// Geen datum is niet "in orde" maar "kent geen verval". Google's refresh token verloopt niet;
// een Meta-koppeling zonder datum is juist verdacht, en die twee moeten niet hetzelfde heten.
check("zonder datum: geen verval", beoordeelVerval(null, nu).toestand === "geen_verval");
check("onleesbare datum telt als geen verval", beoordeelVerval("morgen", nu).toestand === "geen_verval");

check("ruim op tijd is ruim", beoordeelVerval(overDagen(90), nu).toestand === "ruim");
const grens = beoordeelVerval(overDagen(VERLOOPWAARSCHUWING_DAGEN), nu);
check("precies op de waarschuwingsgrens waarschuwt hij al", grens.toestand === "binnenkort", grens.toestand);
check("een dag erbuiten nog niet",
  beoordeelVerval(overDagen(VERLOOPWAARSCHUWING_DAGEN + 1), nu).toestand === "ruim");

const bijna = beoordeelVerval(overDagen(3), nu);
check("binnenkort noemt het aantal dagen", bijna.toestand === "binnenkort" && bijna.tekst.includes("3 dagen"),
  bijna.toestand === "binnenkort" ? bijna.tekst : bijna.toestand);
const morgen = beoordeelVerval(overDagen(1), nu);
check("één dag is enkelvoud", morgen.toestand === "binnenkort" && /1 dag\b/.test(morgen.tekst),
  morgen.toestand === "binnenkort" ? morgen.tekst : "");

const weg = beoordeelVerval(overDagen(-5), nu);
check("verlopen wordt verlopen genoemd", weg.toestand === "verlopen", weg.toestand);
check("en zegt hoe lang geleden", weg.toestand === "verlopen" && weg.tekst.includes("5 dagen"),
  weg.toestand === "verlopen" ? weg.tekst : "");

// ── De databasekant, nagebootst ─────────────────────────────────────────────

interface Rij { [k: string]: unknown }

function nepDb() {
  const tabel: Rij[] = [];
  const kluis = new Map<string, string>();
  const rpcs: string[] = [];
  return {
    tabel, kluis, rpcs,
    rpc(naam: string, args: Record<string, string>) {
      rpcs.push(naam);
      if (naam === "bewaar_oauth_geheim") {
        kluis.set(args.p_naam, args.p_waarde);
        return Promise.resolve({ data: `vault-${args.p_naam}`, error: null });
      }
      if (naam === "lees_oauth_geheim") {
        return Promise.resolve({ data: kluis.get(args.p_naam) ?? null, error: null });
      }
      if (naam === "wis_oauth_geheim") {
        const had = kluis.delete(args.p_naam);
        return Promise.resolve({ data: had, error: null });
      }
      return Promise.resolve({ data: null, error: new Error("onbekende rpc") });
    },
    from() {
      const zelf = this;
      return {
        select() {
          const f: Rij[] = [...zelf.tabel];
          const bouw = (rijen: Rij[]) => ({
            eq(k: string, v: unknown) { return bouw(rijen.filter((r) => r[k] === v)); },
            maybeSingle() { return Promise.resolve({ data: rijen[0] ?? null, error: null }); },
            then(res: (v: { data: unknown; error: null }) => void) { res({ data: rijen, error: null }); },
          });
          return bouw(f);
        },
        upsert(rij: Rij) {
          const i = zelf.tabel.findIndex(
            (r) => r.agency_id === rij.agency_id && r.provider === rij.provider);
          // Upsert vervangt de meegegeven velden en laat de rest staan -- net als een echte
          // upsert op de unieke sleutel. Precies dat gedrag is waar de token-regel op leunt.
          if (i >= 0) zelf.tabel[i] = { ...zelf.tabel[i], ...rij };
          else zelf.tabel.push(rij);
          return Promise.resolve({ error: null });
        },
        update(rij: Rij) {
          const bouw = (pred: (r: Rij) => boolean) => ({
            eq(k: string, v: unknown) { return bouw((r) => pred(r) && r[k] === v); },
            then(res: (v: { error: null }) => void) {
              for (const r of zelf.tabel) if (pred(r)) Object.assign(r, rij);
              res({ error: null });
            },
          });
          return bouw(() => true);
        },
      };
    },
  };
}

async function main() {
  console.log("\nbewaarKoppeling");
  const db = nepDb();
  const eerste = await bewaarKoppeling(db as never, {
    agencyId: BUREAU, provider: "google_ads", refreshToken: "token-1",
    externalId: "123-456-7890", scopes: ["adwords"],
  });
  check("koppelen lukt", eerste.ok, eerste.fout ?? "");
  check("het token gaat naar de kluis en niet in de tabel",
    db.kluis.get(geheimNaam(BUREAU, "google_ads")) === "token-1" &&
    !JSON.stringify(db.tabel).includes("token-1"),
    JSON.stringify(db.tabel));

  const k = await leesKoppeling(db as never, BUREAU, "google_ads");
  check("de koppeling is terug te lezen", k?.externalId === "123-456-7890", JSON.stringify(k));
  check("en meldt dát er een token is, zonder het te tonen", k?.heeftToken === true);
  check("de koppeling bevat het token nergens", !JSON.stringify(k).includes("token-1"), JSON.stringify(k));

  // DE KERNREGEL. Google geeft alleen bij `prompt=consent` een refresh token mee. Herkoppelt een
  // bureau zonder die parameter, dan komt er geen token terug -- en dan mag het bestaande NIET
  // overschreven worden, anders zegt de tabel "actief" terwijl de kluis leeg is en valt de sync
  // pas 's nachts om.
  await bewaarKoppeling(db as never, {
    agencyId: BUREAU, provider: "google_ads", refreshToken: "", externalId: "999-999-9999",
  });
  check("een leeg token laat het bestaande geheim staan",
    db.kluis.get(geheimNaam(BUREAU, "google_ads")) === "token-1",
    String(db.kluis.get(geheimNaam(BUREAU, "google_ads"))));
  check("maar de rest wordt wél bijgewerkt",
    (await leesKoppeling(db as never, BUREAU, "google_ads"))?.externalId === "999-999-9999");
  check("en de koppeling houdt zijn token_ref",
    (await leesKoppeling(db as never, BUREAU, "google_ads"))?.heeftToken === true);

  const alleenSpaties = nepDb();
  await bewaarKoppeling(alleenSpaties as never, { agencyId: BUREAU, provider: "meta", refreshToken: "   " });
  check("alleen spaties telt ook als geen token",
    !alleenSpaties.rpcs.includes("bewaar_oauth_geheim"), alleenSpaties.rpcs.join(","));

  const nieuw = await bewaarKoppeling(db as never, {
    agencyId: BUREAU, provider: "google_ads", refreshToken: "token-2",
  });
  check("een écht nieuw token vervangt wel", nieuw.ok && db.kluis.get(geheimNaam(BUREAU, "google_ads")) === "token-2");

  console.log("\ntrekKoppelingIn");
  const uit = await trekKoppelingIn(db as never, BUREAU, "google_ads");
  check("intrekken lukt", uit.ok, uit.fout ?? "");
  check("het geheim is weg uit de kluis", !db.kluis.has(geheimNaam(BUREAU, "google_ads")));
  const na = await leesKoppeling(db as never, BUREAU, "google_ads");
  // De rij blijft staan: "nooit gekoppeld" en "toegang ingetrokken" zijn twee verschillende
  // verhalen, en een verdwenen rij vertelt het eerste.
  check("de rij blijft bestaan", na !== null);
  check("met status ingetrokken", na?.status === "ingetrokken", String(na?.status));
  check("en zonder token", na?.heeftToken === false);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
