import { ComingSoonBadge } from "./coming-soon-badge";

interface Kanaal {
  naam: string;
  gebouwd: boolean;
}

const KANALEN: Kanaal[] = [
  { naam: "Google Ads", gebouwd: true },
  { naam: "Meta Ads", gebouwd: true },
  { naam: "LinkedIn Ads", gebouwd: true },
  { naam: "Bing Ads", gebouwd: false },
  { naam: "Shopify", gebouwd: false },
  { naam: "WooCommerce", gebouwd: false },
];

// Fase 7, Task 2: micro-trust banner. Tekstchips, geen nagemaakte merklogo's -- die bestaan hier
// niet in de codebase en een zelfgetekende imitatie zou een officiële samenwerking suggereren
// die er niet is.
//
// CRM is op 11 augustus 2026 uit deze lijst gehaald, Bing Ads en WooCommerce toegevoegd (gevraagd
// in de PR-discussie).
//
// OVERCLAIM GEFIXT (audit, 11 augustus 2026): alleen Google Ads, Meta Ads en LinkedIn Ads hebben
// een echte, werkende koppeling in deze codebase vandaag. Bing Ads, Shopify en WooCommerce stonden
// hier zonder enige kwalificatie onder "Plugs directly into" -- letterlijk de claim die de
// pricing-pagina wel eerlijk labelt met "Coming soon". Nu dragen de drie niet-gebouwde kanalen
// dezelfde ComingSoonBadge, gedempt in plaats van weggelaten: de banner blijft compact, maar zegt
// niet meer iets dat niet klopt.
export function TrustBanner() {
  return (
    <section className="border-y border-off-white/10 bg-midnight-slate-raised/50">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-center sm:gap-10">
        <p className="text-xs uppercase tracking-[0.2em] text-off-white/60">Plugs directly into</p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {KANALEN.map((k) => (
            <span key={k.naam} className="flex items-center gap-1.5 text-sm font-medium text-off-white/70">
              {k.naam}
              {!k.gebouwd && <ComingSoonBadge />}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
