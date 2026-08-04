// Welke kanaaltabs er getoond worden. Deterministisch, geen IO.
// Draaien: npx tsx lib/kanalen/__beschikbaar_test.ts
//
// De aantallen in dit bestand komen uit de echte database: van de 71 accounts hebben er 62 alleen
// Google, 8 helemaal niets en 1 alle drie. Dat is de verdeling waar deze regels op moeten kloppen
// -- niet een gedachte-experiment met drie gelijkwaardige kanalen.

import {
  zichtbareTabs, geldigeKeuze, geenDataTekst, laadBeschikbareKanalen, ALLE_KANALEN,
  type Kanaal,
} from "./beschikbaar";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De tabs ───────────────────────────────────────────────────────────────

check("geen kanalen: geen tabs", zichtbareTabs([]).length === 0);

// HET GEVAL VAN 62 VAN DE 71 KLANTEN. Eén kanaal betekent geen kiezer: een knoppenbalk met één
// knop is geen keuze, en "Alle kanalen" ernaast toont exact hetzelfde.
check("alleen Google: geen tabs", zichtbareTabs(["google"]).length === 0,
  JSON.stringify(zichtbareTabs(["google"])));
check("alleen Meta: geen tabs", zichtbareTabs(["meta"]).length === 0);
check("alleen LinkedIn: geen tabs", zichtbareTabs(["linkedin"]).length === 0);

check("twee kanalen: blended plus die twee",
  zichtbareTabs(["google", "meta"]).join(",") === "blended,google,meta",
  zichtbareTabs(["google", "meta"]).join(","));
check("drie kanalen: alles",
  zichtbareTabs(ALLE_KANALEN).join(",") === "blended,google,meta,linkedin");

// Volgorde ligt vast, ongeacht de volgorde waarin ze binnenkomen: anders verspringen de tabs
// zodra er een kanaal bijkomt of de bron een andere volgorde teruggeeft.
check("volgorde is vast, niet die van de invoer",
  zichtbareTabs(["linkedin", "meta", "google"] as Kanaal[]).join(",") === "blended,google,meta,linkedin",
  zichtbareTabs(["linkedin", "meta", "google"] as Kanaal[]).join(","));

// ── De keuze bijstellen bij het wisselen van klant ────────────────────────
//
// Zonder deze correctie blijf je hangen op een kanaal dat de nieuwe klant niet heeft: je kijkt
// naar klant A op de Meta-tab, klikt naar klant B die alleen Google draait, en ziet een leeg
// scherm terwijl die tab niet eens meer bestaat.

check("Meta-keuze valt terug op Google bij een Google-only klant",
  geldigeKeuze("meta", ["google"]) === "google");
check("blended valt terug op het enige kanaal",
  geldigeKeuze("blended", ["meta"]) === "meta");
check("een geldige keuze blijft staan",
  geldigeKeuze("meta", ["google", "meta"]) === "meta");
check("blended blijft blended bij meerdere kanalen",
  geldigeKeuze("blended", ["google", "meta"]) === "blended");
check("onbekend kanaal valt terug op blended",
  geldigeKeuze("linkedin", ["google", "meta"]) === "blended");
check("zonder kanalen: blended als rustige terugval",
  geldigeKeuze("meta", []) === "blended");

// ── De lege staat ─────────────────────────────────────────────────────────
// Acht klanten in de database hebben geen enkel kanaal. Die horen een uitleg te zien, geen
// dashboard vol nullen -- een scherm vol nullen leest als "het gaat slecht" in plaats van
// "er is nog niets gekoppeld".

check("geen kanalen levert een uitleg", (geenDataTekst([]) ?? "").length > 40);
check("met een kanaal geen lege staat", geenDataTekst(["google"]) === null);

// tsx compileert dit bestand naar CommonJS; top-level await bestaat daar niet.
async function main(): Promise<void> {
  // ── De loader ─────────────────────────────────────────────────────────────

  function nepSupabase(gevuld: readonly string[]) {
    return {
      from: (tabel: string) => ({
        select: () => ({
          eq: () => ({
            limit: async () => {
              if (tabel === "kapot") throw new Error("tabel bestaat niet");
              return { data: gevuld.includes(tabel) ? [{ x: 1 }] : [] };
            },
          }),
        }),
      }),
    };
  }

  {
    const k = await laadBeschikbareKanalen(nepSupabase(["ads_account_monthly"]) as never, "klant");
    check("vindt alleen Google", k.join(",") === "google", k.join(","));
  }
  {
    const k = await laadBeschikbareKanalen(
      nepSupabase(["ads_account_monthly", "meta_account_daily", "linkedin_account_daily"]) as never, "klant");
    check("vindt alle drie", k.length === 3, k.join(","));
  }
  {
    const k = await laadBeschikbareKanalen(nepSupabase([]) as never, "klant");
    check("lege klant levert niets", k.length === 0);
  }
  // Een kapotte bron mag de hele kiezer niet omgooien: dan verdwijnen ook de kanalen die het wél
  // doen, en dat is een grotere storing dan het ontbrekende kanaal zelf.
  {
    const stuk = {
      from: (tabel: string) => ({
        select: () => ({
          eq: () => ({
            limit: async () => {
              if (tabel === "meta_account_daily") throw new Error("stuk");
              return { data: tabel === "ads_account_monthly" ? [{ x: 1 }] : [] };
            },
          }),
        }),
      }),
    };
    const k = await laadBeschikbareKanalen(stuk as never, "klant");
    check("één kapotte bron laat de rest staan", k.join(",") === "google", k.join(","));
  }
}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
