// Statische, deterministische demo-data voor God Mode (platform-breed) en de portfolio-synthese
// (cross-account binnen één bureau). Beide vereisen normaal een echte, ingelogde sessie met
// platform-brede resp. performance_marketeer-scope (lib/auth/server.ts, app/(app)/vandaag/page.tsx)
// -- ?demo=1 alleen kan die sessie niet vervangen, want die routes lezen echte Supabase-auth-
// cookies, geen queryparameter. Zonder deze mock zou "God View + cross-account in demo modus"
// dus altijd een 403 blijven geven, ongeacht ?demo=1.
//
// Bewust GEEN echte database-call en GEEN echte LLM-aanroep: dit bestand is puur gepresenteerd
// aan wie geen sessie heeft (VandaagPage's demo-tak rendert dit alleen als er ook echt geen
// ingelogde gebruiker is, zie de kop van app/(app)/vandaag/page.tsx) -- veilig, kosteloos, en
// nooit een echte klantnaam of echt cijfer.

import type { GodModeRow } from "@/app/api/platform/god-mode/route";

export interface DemoGodModeData {
  month: string;
  accountCount: number;
  top10: GodModeRow[];
  bottom10: GodModeRow[];
  all: GodModeRow[];
}

// Fictieve boekhouding van een klein bureau: 9 accounts, uiteenlopende schaal en ROAS, zodat
// top10/bottom10 en de rauwe tabel iets te tonen hebben. "GreenTech (demo)" sluit aan bij de
// rest van de demo-wereld (scripts/demo/seed-demo-client.ts); de overige acht zijn puur fictief.
const ROWS: GodModeRow[] = [
  { clientId: "demo-greentech", name: "GreenTech (demo)", agencyId: "demo", spend: 25955, conversions: 948, conversionValue: 54287, roas: 2.09 },
  { clientId: "demo-noord-bouw", name: "Noord Bouwmaterialen (demo)", agencyId: "demo", spend: 41200, conversions: 612, conversionValue: 98800, roas: 2.4 },
  { clientId: "demo-varenburg", name: "Varenburg Advocatuur (demo)", agencyId: "demo", spend: 18700, conversions: 210, conversionValue: 61300, roas: 3.28 },
  { clientId: "demo-fitplus", name: "FitPlus Studio's (demo)", agencyId: "demo", spend: 9400, conversions: 880, conversionValue: 21600, roas: 2.3 },
  { clientId: "demo-havendok", name: "Havendok Logistiek (demo)", agencyId: "demo", spend: 33500, conversions: 340, conversionValue: 58900, roas: 1.76 },
  { clientId: "demo-zonnepact", name: "Zonnepact Installateurs (demo)", agencyId: "demo", spend: 27800, conversions: 505, conversionValue: 79400, roas: 2.86 },
  { clientId: "demo-kleinvee", name: "Kleinvee Dierenklinieken (demo)", agencyId: "demo", spend: 6100, conversions: 390, conversionValue: 15200, roas: 2.49 },
  { clientId: "demo-rentmeester", name: "De Rentmeester Makelaars (demo)", agencyId: "demo", spend: 15200, conversions: 88, conversionValue: 19800, roas: 1.3 },
  { clientId: "demo-druppel", name: "Druppel Waterzuivering (demo)", agencyId: "demo", spend: 4300, conversions: 52, conversionValue: 3900, roas: 0.91 },
];

const bySpendDesc = [...ROWS].sort((a, b) => b.spend - a.spend);
const bySpendAsc = [...ROWS].sort((a, b) => a.spend - b.spend);

export const DEMO_GOD_MODE_DATA: DemoGodModeData = {
  month: new Date().toISOString().slice(0, 7) + "-01",
  accountCount: ROWS.length,
  top10: bySpendDesc.slice(0, 10),
  bottom10: bySpendAsc.slice(0, 10),
  all: ROWS,
};

// ── God View Premium (cross-agency benchmark + churn-concentratie) ─────────
//
// Zelfde reden als DEMO_GOD_MODE_DATA hierboven: /api/platform/god-view en
// /api/platform/god-view-churn vergen een echte platform-brede sessie en lezen echte
// Supabase-cookies, dus ?demo=1 alleen bereikt ze nooit. In productie draaien deze routes altijd
// tegen precies 2 echte bureaus (te weinig voor de k-anonimiteitsdrempel van 4) -- de live
// testdrempel-modus (TEST_DREMPELS, zie cel.ts) toont dat met ECHTE data en een zichtbaar
// TESTMODUS-label, maar laat het er noodgedwongen dun uitzien (2 bureaus, een paar cellen).
//
// Dit hier is het andere doel: laten zien hoe de module oogt zodra het platform gegroeid is tot
// voorbij de drempel -- 6 fictieve bureaus, elk met een handvol fictieve klanten, verspreid over
// vier niches. Puur fictief, nooit als echte meting gepresenteerd (testMode: false hieronder
// betekent hier "geen testdrempel nodig", NIET "dit zijn echte cijfers" -- de demo-banner in
// GodViewPremium.tsx zet die framing recht, zelfde patroon als bij DEMO_GOD_MODE_DATA).

interface DemoRatioCel {
  model: string | null;
  niche: string | null;
  nicheLabel: string | null;
  accounts: number;
  bureaus: number;
  metrics: { medianCpa: number | null; medianRoas: number | null; accountsMetCpa: number; accountsMetRoas: number } | null;
}

interface DemoChurnCel {
  model: string | null;
  niche: string | null;
  nicheLabel: string | null;
  accounts: number;
  bureaus: number;
  churn: { rood: number; amber: number; groen: number; onbekend: number } | null;
}

interface DemoAntwoord<C> {
  testMode: boolean;
  testModeWaarschuwing: string | null;
  stand: {
    bureausMetKwalificerendeData: number;
    bureausNodigVoorEersteCel: number;
    accountsNodigVoorEersteCel: number;
    accountsMetAfbakening: number;
    cellenTotaal: number;
    cellenDeelbaar: number;
  };
  cellen: C[];
}

export const DEMO_GOD_VIEW_CELLEN: DemoAntwoord<DemoRatioCel> = {
  testMode: false,
  testModeWaarschuwing: null,
  stand: {
    bureausMetKwalificerendeData: 6,
    bureausNodigVoorEersteCel: 4,
    accountsNodigVoorEersteCel: 10,
    accountsMetAfbakening: 74,
    cellenTotaal: 8,
    cellenDeelbaar: 6,
  },
  cellen: [
    { model: "b2b", niche: "software", nicheLabel: "Software & SaaS", accounts: 22, bureaus: 6, metrics: { medianCpa: 84, medianRoas: null, accountsMetCpa: 22, accountsMetRoas: 0 } },
    { model: "b2c", niche: "mode", nicheLabel: "Mode & kleding", accounts: 18, bureaus: 5, metrics: { medianCpa: null, medianRoas: 3.4, accountsMetCpa: 0, accountsMetRoas: 18 } },
    { model: "b2c", niche: "tandheelkunde", nicheLabel: "Tandheelkunde", accounts: 14, bureaus: 5, metrics: { medianCpa: 61, medianRoas: null, accountsMetCpa: 14, accountsMetRoas: 0 } },
    { model: "b2b", niche: "zakelijke_diensten", nicheLabel: "Zakelijke dienstverlening", accounts: 12, bureaus: 4, metrics: { medianCpa: 128, medianRoas: null, accountsMetCpa: 12, accountsMetRoas: 0 } },
    { model: "b2b", niche: null, nicheLabel: null, accounts: 41, bureaus: 6, metrics: { medianCpa: 96, medianRoas: 2.7, accountsMetCpa: 34, accountsMetRoas: 30 } },
    { model: "b2c", niche: null, nicheLabel: null, accounts: 33, bureaus: 6, metrics: { medianCpa: 52, medianRoas: 3.1, accountsMetCpa: 28, accountsMetRoas: 25 } },
    { model: null, niche: "juridisch", nicheLabel: "Juridische dienstverlening", accounts: 8, bureaus: 3, metrics: null },
    { model: null, niche: "financieel", nicheLabel: "Financieel & verzekeringen", accounts: 6, bureaus: 2, metrics: null },
  ],
};

export const DEMO_GOD_VIEW_CHURN_CELLEN: DemoAntwoord<DemoChurnCel> = {
  testMode: false,
  testModeWaarschuwing: null,
  stand: {
    bureausMetKwalificerendeData: 6,
    bureausNodigVoorEersteCel: 4,
    accountsNodigVoorEersteCel: 10,
    accountsMetAfbakening: 74,
    cellenTotaal: 8,
    cellenDeelbaar: 6,
  },
  cellen: [
    { model: "b2c", niche: "tandheelkunde", nicheLabel: "Tandheelkunde", accounts: 14, bureaus: 5, churn: { rood: 4, amber: 3, groen: 7, onbekend: 0 } },
    { model: "b2b", niche: "zakelijke_diensten", nicheLabel: "Zakelijke dienstverlening", accounts: 12, bureaus: 4, churn: { rood: 3, amber: 1, groen: 8, onbekend: 0 } },
    { model: "b2c", niche: "mode", nicheLabel: "Mode & kleding", accounts: 18, bureaus: 5, churn: { rood: 1, amber: 2, groen: 15, onbekend: 0 } },
    { model: "b2b", niche: "software", nicheLabel: "Software & SaaS", accounts: 22, bureaus: 6, churn: { rood: 0, amber: 2, groen: 20, onbekend: 0 } },
    { model: "b2b", niche: null, nicheLabel: null, accounts: 41, bureaus: 6, churn: { rood: 4, amber: 5, groen: 32, onbekend: 0 } },
    { model: "b2c", niche: null, nicheLabel: null, accounts: 33, bureaus: 6, churn: { rood: 2, amber: 4, groen: 27, onbekend: 0 } },
    { model: null, niche: "juridisch", nicheLabel: "Juridische dienstverlening", accounts: 8, bureaus: 3, churn: null },
    { model: null, niche: "financieel", nicheLabel: "Financieel & verzekeringen", accounts: 6, bureaus: 2, churn: null },
  ],
};

export interface DemoPortfolioAction {
  clientId: string;
  clientName?: string;
  action: string;
  rationale: string;
  priority: "hoog" | "midden" | "laag";
}

export interface DemoPortfolioSynthesis {
  headline: string;
  narrative: string;
  recurring_patterns: string[];
  outliers: string[];
  synthesized_actions: DemoPortfolioAction[];
}

// Verhaal opgebouwd uit de echte, ontworpen GRT/GRA/GRN-scenario's (scripts/demo/seed-demo-
// client.ts [S10]/[S11]/[S12], zie ook scripts/demo/seed-geoclone-clients.ts die deze drie een
// eigen client_id geeft): dezelfde soort bevinding die de LLM-synthese hier normaal zelf zou
// trekken, nu handmatig vastgelegd zodat de demo nooit op een lege OPENROUTER_API_KEY of een
// live LLM-aanroep hoeft te wachten.
export const DEMO_PORTFOLIO_SYNTHESIS: DemoPortfolioSynthesis = {
  headline: "GRT loopt achter door effectiviteit, niet door budget — GRA en GRN groeien allebei gezond",
  narrative:
    "Alle drie de GreenTech-beursaccounts zitten in dezelfde sector (B2B, industrie), dus de vergelijking is inhoudelijk geldig. GreenTech Amsterdam (GRT) ligt zo'n 35% achter op de aanloop naar de vorige editie, bij nagenoeg gelijke spend en 97% dagbudgetbenutting — dat is geen investeringsvraag maar een effectiviteitsvraag. GreenTech Americas (GRA) en GreenTech North America (GRN) laten intussen allebei een gezonde, gestage groei zien; GRN is de jongste van de drie (pas sinds april actief) en dus nog niet één-op-één te vergelijken met een vorige editie.",
  recurring_patterns: [
    "Alle drie B2B in dezelfde industrienis — geen sectorverschil dat de vergelijking zou vertekenen.",
    "Meta en LinkedIn dragen op alle drie accounts een meetbaar deel van de conversies bij, niet alleen Google Search.",
  ],
  outliers: [
    "GRT: 97% dagbudgetbenutting en 28% impression share verloren op budget — een duidelijk te herkennen opschalingskans, in tegenstelling tot GRA en GRN.",
  ],
  synthesized_actions: [
    { clientId: "demo-grt", clientName: "GreenTech Amsterdam (GRT)", action: "Dagbudget verhogen op de Search-campagne vóór de volgende editie", rationale: "97% benutting en 28% IS-verlies op budget betekent dat de markt groter is dan het budget: onbenutte opschalingsruimte, geen creative- of biedingsprobleem.", priority: "hoog" },
    { clientId: "demo-gra", clientName: "GreenTech Americas (GRA)", action: "Huidige koers aanhouden, geen ingreep nodig", rationale: "Aanloop ligt voor op dezelfde afstand tot de vorige editie; een ingreep zou een gezonde trend onderbreken.", priority: "laag" },
    { clientId: "demo-grn", clientName: "GreenTech North America (GRN)", action: "Nog geen editie-vergelijking trekken, wel het datavenster laten opbouwen", rationale: "Eerste editie: er is simpelweg nog geen vorige editie om tegen af te zetten.", priority: "midden" },
  ],
};
