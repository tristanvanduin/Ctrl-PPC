// Cross-Channel Context Chips: small, technical provenance tags. Frosted glass, 6px radius, 1px
// border, a pulsing dot for "this is a live connection" -- not a static icon. Reusable inside the
// Execution Node (the Signal step) or any other spot that needs to show where a signal came from.

interface ContextSource {
  naam: string;
}

const DEFAULT_SOURCES: ContextSource[] = [
  { naam: "Meta API" },
  { naam: "GSC Trend" },
  { naam: "Shopify Data" },
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
