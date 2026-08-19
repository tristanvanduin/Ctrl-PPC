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
    "GRT: 97% dagbudgetbenutting en 28% impression share verloren op budget — een duidelijk te herkennen groeiplafond, in tegenstelling tot GRA en GRN.",
  ],
  synthesized_actions: [
    { clientId: "demo-grt", clientName: "GreenTech Amsterdam (GRT)", action: "Dagbudget verhogen op de Search-campagne vóór de volgende editie", rationale: "97% benutting en 28% IS-verlies op budget wijzen op een plafond, niet op een creative- of biedingsprobleem.", priority: "hoog" },
    { clientId: "demo-gra", clientName: "GreenTech Americas (GRA)", action: "Huidige koers aanhouden, geen ingreep nodig", rationale: "Aanloop ligt voor op dezelfde afstand tot de vorige editie; een ingreep zou een gezonde trend onderbreken.", priority: "laag" },
    { clientId: "demo-grn", clientName: "GreenTech North America (GRN)", action: "Nog geen editie-vergelijking trekken, wel het datavenster laten opbouwen", rationale: "Eerste editie: er is simpelweg nog geen vorige editie om tegen af te zetten.", priority: "midden" },
  ],
};
