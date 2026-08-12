// Cross-Channel Context Chips: small, technical provenance tags. Frosted glass, 6px radius, 1px
// border, a pulsing dot for "this is a live connection" -- not a static icon. Reusable inside the
// Execution Node (the Signal step) or any other spot that needs to show where a signal came from.

interface ContextSource {
  naam: string;
}

// "Shopify Data" stond hier als voorbeeldbron, maar Business Intelligence Connect (Shopify/
// WooCommerce/CRM/WordPress) is een ongebouwde integratie (gebouwd: false in
// lib/marketing/tiers.ts) -- dezelfde fout die al eens gevonden en gefixt is in
// quality-gate-matrix.tsx ("Shopify Inventory" als gate-naam). Vervangen door GA4, wat wel
// gebouwd is (lib/ga4/) en al genoemd wordt als bron voor de Signal-stap in loop.ts.
const DEFAULT_SOURCES: ContextSource[] = [
  { naam: "Meta API" },
  { naam: "GSC Trend" },
  { naam: "GA4 Signal" },
];

export function ContextChips({ sources = DEFAULT_SOURCES }: { sources?: ContextSource[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sources.map((source) => (
        <span
          key={source.naam}
          className="flex items-center gap-1.5 rounded-[6px] border border-off-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-off-white/70 backdrop-blur-sm"
          style={{ fontFamily: "var(--font-marketing-mono)" }}
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-indigo opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon-indigo" />
          </span>
          {source.naam}
        </span>
      ))}
    </div>
  );
}
