// Welke kanaaltabs er getoond worden. Deterministisch, geen IO.
// Draaien: npx tsx lib/kanalen/__beschikbaar_test.ts
//
// De aantallen in dit bestand komen uit de echte database: van de 71 accounts hebben er 62 alleen
// Google, 8 helemaal niets en 1 alle drie. Dat is de verdeling waar deze regels op moeten kloppen
// -- niet een gedachte-experiment met drie gelijkwaardige kanalen.

import {
  zichtbareTabs, geldigeKeuze, geenDataTekst, laadBeschikbareKanalen, kanalenOpsomming, kanalenUitBronnen,
  proefjeNodig, PROEFJE_WACHT_MS, WACHT_MS,
  ALLE_KANALEN, type Kanaal,
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
check("alle kanalen: alles",
  zichtbareTabs(ALLE_KANALEN).join(",") === "blended,google,meta,linkedin,microsoft",
  zichtbareTabs(ALLE_KANALEN).join(","));

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

// ── De opsomming in het bijschrift ────────────────────────────────────────
//
// Het bijschrift bovenaan het dashboard noemde altijd Google Ads. Bij de LinkedIn-only doorloop
// stond er "Live data uit Google Ads" boven een scherm zonder één Google-rij. Een zin die geen
// enkele test tegenhoudt, want er is niets aan gerekend.

check("één kanaal: alleen dat kanaal", kanalenOpsomming(["linkedin"]) === "LinkedIn",
  String(kanalenOpsomming(["linkedin"])));
check("twee kanalen: met 'en' ertussen", kanalenOpsomming(["google", "meta"]) === "Google Ads en Meta",
  String(kanalenOpsomming(["google", "meta"])));
check("alle kanalen: komma's en één 'en'",
  kanalenOpsomming(ALLE_KANALEN) === "Google Ads, Meta, LinkedIn en Microsoft Ads",
  String(kanalenOpsomming(ALLE_KANALEN)));
// Vaste volgorde, net als bij de tabs: anders wisselt de tekst mee met de volgorde waarin de
// drie queries toevallig terugkomen.
check("volgorde volgt ALLE_KANALEN, niet de invoer",
  kanalenOpsomming(["linkedin", "google"] as Kanaal[]) === "Google Ads en LinkedIn",
  String(kanalenOpsomming(["linkedin", "google"] as Kanaal[])));
// Zonder kanalen hoort er geen bijschrift te zijn, geen bijschrift met een gat erin.
check("geen kanalen levert null", kanalenOpsomming([]) === null,
  String(kanalenOpsomming([])));

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
      nepSupabase(["ads_account_monthly", "meta_account_daily", "linkedin_account_daily", "microsoft_account_daily"]) as never, "klant");
    check("vindt alle vier", k.length === 4, k.join(","));
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

  // ── De kanalenlijst uit de bronnen van het dashboard (fase 1, stap 4) ─────────────────────────
  // Het dashboard vraagt bij de mount de Google-route, de blended route en het proefje tegelijk.
  // kanalenUitBronnen zegt wat er op elk moment bekend is; null = nog niet.
  const uit = (inp: Parameters<typeof kanalenUitBronnen>[0]) => { const k = kanalenUitBronnen(inp); return k === null ? "null" : k.join(","); };
  const basis = { googleLaadt: false, google: true as boolean | null, route: null as string[] | null, proefje: null as string[] | null };

  // ── Wanneer het proefje vertrekt ─────────────────────────────────────────────────────────────
  // De regel is de race: bij de mount, naast de route. De uitzondering is een antwoord dat de
  // server met de pagina meestuurt: dan alleen nog bij een routefout of een route die stil blijft.
  const p = { routeKlaar: false, routeFout: false, routeStil: false, proefjeBekend: false, zaadVerwacht: false };
  check("zonder zaad, bij de mount: het proefje vertrekt naast de route (de race)", proefjeNodig(p) === true);
  check("zonder zaad, de route antwoordde al (de cache): geen proefje", proefjeNodig({ ...p, routeKlaar: true }) === false);
  check("zonder zaad, het proefje is er al: niet nog een keer", proefjeNodig({ ...p, proefjeBekend: true }) === false);
  const z = { ...p, zaadVerwacht: true };
  check("met zaad, bij de mount: geen proefje", proefjeNodig(z) === false);
  check("met zaad, de route antwoordde: geen proefje", proefjeNodig({ ...z, routeKlaar: true }) === false);
  check("met zaad, de route antwoordde, ook al was hij eerst stil: geen proefje", proefjeNodig({ ...z, routeKlaar: true, routeStil: true }) === false);
  check("met zaad, een routefout ('geen data' uit het zaad zelf): het proefje vertrekt meteen", proefjeNodig({ ...z, routeFout: true }) === true);
  check("met zaad, de route blijft stil: het proefje vertrekt", proefjeNodig({ ...z, routeStil: true }) === true);
  check("met zaad, het proefje is er al: niet nog een keer", proefjeNodig({ ...z, routeFout: true, proefjeBekend: true }) === false);
  check("het zaad bleek leeg (de aanroeper zet zaadVerwacht uit): de race geldt weer", proefjeNodig({ ...z, zaadVerwacht: false }) === true);
  check("de stilte is korter dan de wachttijd waarna een kanaal als afwezig geldt", PROEFJE_WACHT_MS > 0 && PROEFJE_WACHT_MS < WACHT_MS);

  check("niets binnen: onbekend, niet 'geen kanalen'", uit({ ...basis, googleLaadt: true, google: null }) === "null");
  check("alleen Google binnen: de dagkanalen zijn nog onbekend", uit(basis) === "null");
  check("de route en het proefje binnen, Google laadt nog: onbekend",
    uit({ googleLaadt: true, google: null, route: ["google", "meta"], proefje: ["google", "meta"] }) === "null");

  // HET GEVAL VAN 62 VAN DE 71 KLANTEN: alleen Google. Het proefje is er eerder dan de blended
  // route, en dan hoeft de kanalenlijst (en dus de band op het Google-tabblad) niet op de route.
  check("alleen Google: bekend zodra het proefje er is, zonder de blended route", uit({ ...basis, proefje: ["google"] }) === "google");
  check("en hetzelfde als de route er daarna is", uit({ ...basis, route: ["google"], proefje: ["google"] }) === "google");
  check("alleen de route (het proefje nog onderweg): ook bekend", uit({ ...basis, route: ["google", "meta", "linkedin", "microsoft"] }) === "google,meta,linkedin,microsoft");

  // Google komt uit het Google-antwoord, niet uit de database: een live account zonder gesyncte
  // rijen is er, een gesynct account zonder één maand met data niet.
  check("Google live maar niet gesynct: het telt", uit({ ...basis, google: true, proefje: [] }) === "google");
  check("Google zonder een maand met data: het telt niet, ook al staat er een rij in de database",
    uit({ ...basis, google: false, route: ["google", "meta"], proefje: ["google", "meta"] }) === "meta");
  check("geen enkel kanaal: de lege lijst, zodat de melding 'nog geen data' verschijnt", uit({ ...basis, google: false, proefje: [] }) === "");
  // Faalde de Google-route, dan wat de database van Google weet (de route eerst, anders het proefje).
  check("Google-route gefaald: Google uit de blended route", uit({ ...basis, google: null, route: ["google", "meta"] }) === "google,meta");
  check("Google-route gefaald, blended route ook: Google uit het proefje", uit({ ...basis, google: null, proefje: ["google"] }) === "google");
  check("Google-route gefaald en verder niets binnen: onbekend", uit({ ...basis, google: null }) === "null");

  // De route gaat voor zodra hij er is: hij is ook de bron van de cijfers in de band. Een proefje
  // dat een kanaal miste (te lang stil telt daar als afwezig) wordt zo gecorrigeerd.
  check("de route gaat voor het proefje", uit({ ...basis, route: ["google", "meta"], proefje: ["google"] }) === "google,meta");
  check("een routefout (null): het proefje blijft gelden", uit({ ...basis, route: null, proefje: ["google", "linkedin"] }) === "google,linkedin");
  check("volgorde is vast, niet die van de bron", uit({ ...basis, route: ["microsoft", "linkedin", "meta", "google"] }) === "google,meta,linkedin,microsoft");
}

main().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
