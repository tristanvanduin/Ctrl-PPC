// Wie welke klanten mag zien. Deterministisch, geen IO -- de database wordt nagebootst.
// Draaien: npx tsx lib/auth/__scope_test.ts
//
// Deze controles bestaan om één reden: de afleiding stond twee keer (server.ts en middleware.ts)
// en liep uit elkaar. In de middleware kreeg een organisatiebrede rol ALL_CLIENTS -- élke klant
// van élk bureau -- terwijl de routes erachter al wel op het eigen bureau waren begrensd. Een
// poortwachter die ruimer staat dan wat hij bewaakt is geen poortwachter.

import { bepaalScope } from "./scope";
import { ALL_CLIENTS } from "./roles";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Een database in vier regels: wat er per tabel voor deze gebruiker in staat. */
function nepDb(inhoud: {
  rol?: string;
  klanten?: string[];
  platform?: boolean;
  bureaus?: string[];
  accountsPerBureau?: Record<string, string[]>;
}) {
  const gezien: string[] = [];
  const client = {
    from: (tabel: string) => ({
      select: () => {
        const rijen = (): unknown[] => {
          if (tabel === "user_clients") return (inhoud.klanten ?? []).map((c) => ({ client_id: c }));
          if (tabel === "user_agencies") return (inhoud.bureaus ?? []).map((b) => ({ agency_id: b }));
          return [];
        };
        const bouw = (waarden?: string[]) => ({
          maybeSingle: async () => {
            if (tabel === "user_roles") return { data: inhoud.rol ? { role: inhoud.rol } : null };
            if (tabel === "platform_beheerders") return { data: inhoud.platform ? { user_id: "u" } : null };
            return { data: null };
          },
          then: (op: (v: { data: unknown[] | null }) => unknown) => {
            if (tabel === "accounts") {
              gezien.push("accounts");
              const uit = (waarden ?? []).flatMap((b) => (inhoud.accountsPerBureau?.[b] ?? []))
                .map((c) => ({ client_id: c }));
              return Promise.resolve(op({ data: uit }));
            }
            return Promise.resolve(op({ data: rijen() }));
          },
        });
        return {
          eq: () => bouw(),
          in: (_k: string, waarden: string[]) => bouw(waarden),
        };
      },
    }),
  };
  return { client, gezien };
}

async function main(): Promise<void> {
  // ── De platformbeheerder ──────────────────────────────────────────────────
  // De enige die over bureaus heen kijkt. Dat staat in platform_beheerders (migratie 057) en
  // niet in een rolnaam, juist omdat een rolnaam per bureau opnieuw wordt uitgedeeld.
  {
    const { client } = nepDb({ rol: "admin", platform: true, bureaus: ["A"] });
    const r = await bepaalScope(client as never, "u");
    check("platformbeheerder ziet alles", r.scope === ALL_CLIENTS, JSON.stringify(r.scope));
    check("platformbeheerder is als zodanig gemarkeerd", r.isPlatform);
  }

  // ── HET GEVAL DAT UIT ELKAAR LIEP ─────────────────────────────────────────
  // Beheerder van bureau A. Vóór deze samenvoeging gaf de middleware hier ALL_CLIENTS, en kwam
  // hij dus langs de poortwachter op de URL van een klant van bureau B.
  {
    const { client, gezien } = nepDb({
      rol: "admin",
      bureaus: ["A"],
      accountsPerBureau: { A: ["klant-1", "klant-2"], B: ["klant-9"] },
    });
    const r = await bepaalScope(client as never, "u");
    check("bureaubeheerder krijgt geen ALL_CLIENTS", r.scope !== ALL_CLIENTS, String(r.scope));
    check("bureaubeheerder ziet alleen zijn eigen bureau",
      Array.isArray(r.scope) && r.scope.join(",") === "klant-1,klant-2",
      JSON.stringify(r.scope));
    check("een klant van een ander bureau zit er niet bij",
      Array.isArray(r.scope) && !r.scope.includes("klant-9"));
    check("de accounts-query is ook echt gedaan", gezien.includes("accounts"));
  }

  // Zonder bureau geen klanten. Stilzwijgend terugvallen op "dan maar alles" is precies hoe de
  // grens verdween; leeg is hier het juiste antwoord, want zo iemand moet nog gekoppeld worden.
  {
    const { client, gezien } = nepDb({ rol: "admin", bureaus: [] });
    const r = await bepaalScope(client as never, "u");
    check("organisatiebrede rol zonder bureau ziet niets",
      Array.isArray(r.scope) && r.scope.length === 0, JSON.stringify(r.scope));
    check("en er wordt dan niet eens naar accounts gevraagd", !gezien.includes("accounts"));
  }

  // ── De klantgebonden rollen ───────────────────────────────────────────────
  // Die komen uit user_clients en niet uit het bureau: een externe klant hoort zijn eigen
  // account te zien, niet dat van zijn buurman bij hetzelfde bureau.
  {
    const { client, gezien } = nepDb({
      rol: "client",
      klanten: ["klant-3"],
      bureaus: ["A"],
      accountsPerBureau: { A: ["klant-1", "klant-2", "klant-3"] },
    });
    const r = await bepaalScope(client as never, "u");
    check("klantrol krijgt alleen zijn eigen koppelingen",
      Array.isArray(r.scope) && r.scope.join(",") === "klant-3", JSON.stringify(r.scope));
    check("en niet de rest van het bureau", !gezien.includes("accounts"));
  }

  // Geen rol is geen toegang, niet stilzwijgend alles.
  {
    const { client } = nepDb({});
    const r = await bepaalScope(client as never, "u");
    check("zonder rol geen scope", Array.isArray(r.scope) && r.scope.length === 0);
    check("zonder rol ook geen rol", r.role === null, String(r.role));
  }
}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
