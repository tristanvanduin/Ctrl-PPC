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
// leeg, dat is een prijsbeslissing, geen ontbrekende feature). Niet gebouwd: Code Oranje/Code
// Red-protocollen, de volledige rapportage-aanpasbaarheid vanaf Growth (koppen/body bewerken,
// verbergen, 3 master-templates, grafiekopties -- alleen de kale, niet-aanpasbare rapportage van
// Core bestaat al), Custom Playbook Engine + AI SOP Extractor, Priority Queue, Business
// Intelligence Connect (Shopify/WooCommerce/CRM/WordPress), MCP Sandbox, en alles onder
// Enterprise (BI/webhook-exports, dedicated servers, custom SLA's). De pagina toont niet-gebouwde
// items met een "Coming soon"-label in plaats van ze te verzwijgen of als feit te presenteren --
// zie de PR-discussie voor de drie opties die zijn afgewogen.
//
// SOP-DEKKING (accounts met automatische SOP's) komt uit lib/tenancy/sop-dekking.ts en is HIER
// niet gewijzigd: die getallen (20/50/100/200) zijn een eerdere, apart gegeven indicatie en
// stonden niet in deze prijsopgave.

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
    licentie: "core",
    naam: "Core",
    focus: "The data engine and operational foundation.",
    vanafPerMaand: 749,
    creditsPerMaand: 10_000,
    features: [
      { tekst: "Unlimited accounts, channels, and users", gebouwd: true },
      { tekst: "GA4 integration", gebouwd: true },
      { tekst: "Code Oranje & Code Red churn protocols from day one", gebouwd: false },
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
      { tekst: "Business Intelligence Connect: Shopify, WooCommerce, CRM, WordPress", gebouwd: false },
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
      { tekst: "Full BI API and webhook exports to your own PowerBI or data lake", gebouwd: false },
      { tekst: "Dedicated servers, white-glove onboarding, custom security SLAs", gebouwd: false },
    ],
    rapportage: { tekst: "Fully custom reporting", gebouwd: false },
  },
];

export function sopDekkingVoor(licentie: Licentie): number {
  return SOP_DEKKING[licentie];
}
