// Fase 7 vervolg (17 augustus 2026, na Copilot-feedback "je vertelt wat het doet, niet voor wie
// het is"): een bezoeker moet zichzelf herkennen voordat de rest van de pagina landt. Vier rollen,
// elk met een claim die al elders op de site staat -- "unlimited accounts/channels/users" komt
// letterlijk uit lib/marketing/tiers.ts, cross-channel uit kanaalsynergie-bewijzen (blog), PMax-
// diepte uit de vijf PMax-signaalposts. Geen nieuwe claim, alleen herordend naar publiek.
const DOELGROEPEN = [
  {
    naam: "Performance Marketing Agencies",
    tekst: "Every client account on one platform, with no per-account invoice tax as the book of business grows.",
  },
  {
    naam: "In-House Marketing Teams",
    tekst: "Cross-channel visibility without stitching together separate exports every month.",
  },
  {
    naam: "Google Ads Specialists",
    tekst: "Search, Shopping, and Performance Max read at the depth a blended report never gives you.",
  },
  {
    naam: "Cross-Channel Teams",
    tekst: "Google, Meta, and LinkedIn read together, not as three separate silos with three separate stories.",
  },
];

export function BuiltFor() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
        Built for
      </p>
      <h2 className="mt-2 text-center font-marketing-heading text-2xl font-bold text-off-white sm:text-3xl">
        Who this reads accounts for
      </h2>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {DOELGROEPEN.map((d) => (
          <div key={d.naam} className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-5">
            <p className="text-sm font-semibold text-off-white">{d.naam}</p>
            <p className="mt-2 text-xs leading-relaxed text-off-white/50">{d.tekst}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
