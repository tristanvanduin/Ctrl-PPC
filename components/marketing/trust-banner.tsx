const KANALEN = ["Google Ads", "Meta Ads", "LinkedIn Ads", "Shopify", "CRM"];

// Fase 7, Task 2: micro-trust banner. Tekstchips, geen nagemaakte merklogo's -- die bestaan hier
// niet in de codebase en een zelfgetekende imitatie zou een officiële samenwerking suggereren
// die er niet is.
export function TrustBanner() {
  return (
    <section className="border-y border-off-white/10 bg-midnight-slate-raised/50">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-center sm:gap-10">
        <p className="text-xs uppercase tracking-[0.2em] text-off-white/60">Plugs directly into</p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {KANALEN.map((k) => (
            <span key={k} className="text-sm font-medium text-off-white/70">{k}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
