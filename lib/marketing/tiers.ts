// De 5-tier ladder voor de pricing-storefront.
//
// PRIJZEN EN FEATURELIJST: door de gebruiker aangeleverd op 11 augustus 2026 als het definitieve
// uitgangspunt (niet langer een placeholder zoals de eerdere versie van dit bestand). Charm-
// pricing gekozen uit de aangeboden paren (749/750, 1249/1250, 1999/2000, 2999/3000): telkens het
// bedrag net onder de ronde honderdtal, de gangbare SaaS-conventie.
//
// GEBOUWD VERSUS ROADMAP: elke feature draagt `gebouwd`. Ongeveer de helft van de aangeleverde
// featurelijst bestaat nog niet in de code -- nagemeten op 11 augustus 2026, zie de PR-discussie.
// Gebouwd (bevestigd in de codebase): unlimited accounts/kanalen/gebruikers (agencies.licentie
// kent geen cap), GA4-integratie (lib/ga4/), Cross-Account Portfolio-view
// (components/terminal/agency-god-view.tsx), de creditgrootboek-infrastructuur zelf (migratie
// 070, controleerSaldo/verbruikCredit blokkeren echt -- alleen de PRIJS per analyse staat nog
// leeg, dat is een prijsbeslissing, geen ontbrekende feature). Niet gebouwd: de volledige
// rapportage-aanpasbaarheid vanaf Growth (koppen/body bewerken, verbergen, 3 master-templates,
// grafiekopties -- alleen de kale, niet-aanpasbare rapportage van Core bestaat al), Custom
// Playbook Engine + AI SOP Extractor, Priority Queue, Business Intelligence Connect
// (Shopify/WooCommerce/CRM/WordPress), MCP Sandbox, en alles onder Enterprise (BI/webhook-exports,
// dedicated servers, custom SLA's). De pagina toont niet-gebouwde items met een "Coming
// soon"-label in plaats van ze te verzwijgen of als feit te presenteren -- zie de PR-discussie
// voor de drie opties die zijn afgewogen.
//
// CODE ORANJE/CODE RED (12 augustus 2026): stond hier als "niet gebouwd", was stale. De
// detectiejob (lib/adoptie/detecteer-code-rood.ts) draait als cron (vercel.json,
// /api/cron/evaluate-code-rood), de UI-sequentie en persistentie zijn gebouwd (migratie 073,
// toegepast), inclusief tests (lib/adoptie/__code_rood_test.ts). gebouwd: true.
//
// SOP-DEKKING (accounts met automatische SOP's) komt uit lib/tenancy/sop-dekking.ts en is HIER
// niet gewijzigd: die getallen (20/50/100/200) zijn een eerdere, apart gegeven indicatie en
// stonden niet in deze prijsopgave.
//
// FOUNDATION (12 augustus 2026): zesde kaart, licentie "basis" -- bestond al als gratis rang-0
// tier in het toegangssysteem, stond op /pricing tot nu toe alleen als een losse zin onder de
// tier-grid. Naam "Foundation" komt uit de positioneringsstrategie (Strategie_v3.pdf); "basis"
// blijft de interne licentie-sleutel, geen migratie nodig.
//
// SECOND OPINION-WELKOMSTCADEAU (12 augustus 2026, drie correcties): de 5 gratis trialruns
// (migratie 074, lib/analysis/second-opinion-trial.ts) stonden eerst alleen in de backend en de
// dashboard-teller, niet op deze prijspagina. Eerste poging: een featureregel op Core. Twee
// problemen daarmee, allebei van de eigenaar: (1) de database-trigger vuurt bij ELKE overgang
// basis -> een betaalde tier, niet alleen naar Core specifiek -- een regel alleen op Core was dus
// feitelijk onvolledig voor wie direct naar Growth of hoger upgradet. (2) "alleen een check valt
// niet op" -- begraven tussen vier andere checkmarks deed het niet als upsell-argument. Tweede
// poging: een los coupon-blok naast de tier-grid. Derde correctie (eigenaar): "een coupon blokje
// dat vast geniet lijkt op de tier kaart, zodat je ziet dat het echt extra is, een bonus" -- nu een
// gedraaide, gestippelde tag die op elke betaalde kaart zelf overlapt (TierCard in
// app/(marketing)/pricing/page.tsx), niet los ernaast.
//
// CRM UIT PROFESSIONAL, BI OP AANVRAAG BIJ ENTERPRISE (12 augustus 2026): Professional noemde
// "Business Intelligence Connect: Shopify, WooCommerce, CRM, WordPress" als roadmapfeature -- dat
// botste met de eerdere, expliciete "geen CRM/ERP-koppeling, hier wil ik echt wegblijven" (n.a.v.
// het Funnel.io-reverse-engineering-document). CRM eruit, de drie e-commerce-integraties (Shopify/
// WooCommerce/WordPress) blijven staan, dat was nooit het bezwaar. Enterprise's BI-API/webhook-
// exportregel was een standaard-inbegrepen belofte op een tier die toch al "Custom" prijst --
// herschreven naar op-aanvraag/bij voldoende volume, in lijn met hoe de rest van Enterprise werkt.

import type { Licentie } from "@/lib/chat/toegang";
import { SOP_DEKKING } from "@/lib/tenancy/sop-dekking";

export interface TierFeature {
  tekst: string;
  /** true = vandaag echt in het product; false = roadmap, toont een "Coming soon"-label. */
  gebouwd: boolean;
}

export interface TierDefinitie {
  licentie: Licentie;
  naam: string;
  focus: string;
  vanafPerMaand: number | null; // null = "Custom", geen bedrag te tonen
  creditsPerMaand: number;
  features: TierFeature[];
  rapportage: TierFeature;
}

export const TIERS: readonly TierDefinitie[] = [
  {
    // "basis" bestond al als rang-0 licentie (lib/chat/toegang.ts, SOP_DEKKING.basis = 0) --
    // gratis, geen enkele cap op accounts/kanalen/gebruikers, alleen nooit een automatische SOP.
    // Stond tot 12 augustus 2026 alleen als losse zin onder de tier-grid, niet als kaart.
    licentie: "basis",
    naam: "Foundation",
    focus: "Connect everything. See what happened, always free.",
    vanafPerMaand: 0,
    creditsPerMaand: 0,
    features: [
      { tekst: "Google Ads, Meta Ads, LinkedIn Ads, and Microsoft Ads", gebouwd: true },
      { tekst: "Unlimited accounts, channels, and users", gebouwd: true },
      { tekst: "Dashboarding, forecasting, and KPI monitoring", gebouwd: true },
    ],
    rapportage: { tekst: "No automatic SOP analyses - upgrade to Core when you want the why", gebouwd: true },
  },
  {
    licentie: "core",
    naam: "Core",
    focus: "The data engine and operational foundation.",
    vanafPerMaand: 749,
    creditsPerMaand: 10_000,
    features: [
      { tekst: "Everything in Foundation", gebouwd: true },
      { tekst: "GA4 integration", gebouwd: true },
      { tekst: "Agency Memory: hypotheses, sprint items, and learnings that compound over time", gebouwd: true },
      { tekst: "Code Oranje & Code Red churn protocols from day one", gebouwd: true },
    ],
    rapportage: { tekst: "Standard report templates, not yet customizable", gebouwd: true },
  },
  {
    licentie: "growth",
    naam: "Growth",
    focus: "Portfolio overview and light narrative control.",
    vanafPerMaand: 1_249,
    creditsPerMaand: 25_000,
    features: [
      { tekst: "Everything in Core", gebouwd: true },
      { tekst: "Cross-account portfolio view", gebouwd: true },
      { tekst: "External alerts to Slack or Teams", gebouwd: false },
    ],
    rapportage: { tekst: "Editable headers and body text on standard templates", gebouwd: false },
  },
  {
    licentie: "scale",
    naam: "Scale",
    focus: "Visual control, IP, and priority.",
    vanafPerMaand: 1_999,
    creditsPerMaand: 50_000,
    features: [
      { tekst: "Everything in Growth", gebouwd: true },
      { tekst: "Custom Playbook Engine, including the AI SOP Extractor", gebouwd: false },
      { tekst: "Priority queue on our servers", gebouwd: false },
    ],
    rapportage: {
      tekst: "3 master templates (Minimal, Executive, Data-Heavy) plus hiding specific slides or data blocks from the client",
      gebouwd: false,
    },
  },
  {
    licentie: "professional",
    naam: "Professional",
    focus: "E-commerce dominance and enterprise tech.",
    vanafPerMaand: 2_999,
    creditsPerMaand: 100_000,
    features: [
      { tekst: "Everything in Scale", gebouwd: true },
      { tekst: "Business Intelligence Connect: Shopify, WooCommerce, WordPress", gebouwd: false },
      { tekst: "MCP Sandbox: bring your own AI into a secured debate with ours", gebouwd: false },
    ],
    rapportage: { tekst: "Swap and personalize individual charts within the 3 master templates", gebouwd: false },
  },
  {
    licentie: "enterprise",
    naam: "Enterprise",
    focus: "Custom-built for mega-agencies.",
    vanafPerMaand: null,
    creditsPerMaand: 500_000,
    features: [
      { tekst: "Everything in Professional", gebouwd: true },
      { tekst: "Full BI API and webhook exports - available on request for qualifying volume, not a standard inclusion", gebouwd: false },
      { tekst: "Dedicated servers, white-glove onboarding, custom security SLAs", gebouwd: false },
    ],
    rapportage: { tekst: "Fully custom reporting", gebouwd: false },
  },
];

export function sopDekkingVoor(licentie: Licentie): number {
  return SOP_DEKKING[licentie];
}
