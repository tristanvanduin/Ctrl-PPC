// Reusable Midnight Slate video container. 6px radius, neon-indigo glow border, no iframe
// chrome - the brief is explicit that this must not look like a bolted-on embed.
//
// No real product video or Loom recording exists in the codebase yet, so passing src/embedUrl
// stays optional. Without one, this renders a static terminal-style preview instead of a fake
// play button that does nothing when clicked - a non-functional player would be more misleading
// than no video at all. Swap in a real asset later by passing src (mp4/webm) or embedUrl (Loom/
// YouTube) - the container styling does not change.

interface ProductVideoProps {
  src?: string;
  embedUrl?: string;
  poster?: string;
}

const PREVIEW_REGELS = [
  { label: "SCAN", value: "71 accounts, 3 channels" },
  { label: "SIGNAL", value: "Search CPA (mobile) +34% vs. target" },
  { label: "HYPOTHESIS", value: "tROAS +10% during 19:00-22:00 -> CPA -15%" },
  { label: "STATUS", value: "awaiting quality gate" },
];

function TerminalPreview() {
  return (
    <div className="flex aspect-video flex-col justify-center gap-4 p-8 sm:p-12">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">
        Live product preview - full walkthrough coming soon
      </p>
      <div className="space-y-2.5" style={{ fontFamily: "var(--font-marketing-mono)" }}>
        {PREVIEW_REGELS.map((r) => (
          <div key={r.label} className="flex flex-wrap gap-x-3 text-sm">
            <span className="w-28 shrink-0 text-off-white/50">{r.label}</span>
            <span className="text-off-white">{r.value}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1 text-sm text-neon-indigo">
          <span className="inline-block h-3.5 w-2 animate-pulse bg-neon-indigo" aria-hidden />
          <span>awaiting next signal_</span>
        </div>
      </div>
    </div>
  );
}

export function ProductVideo({ src, embedUrl, poster }: ProductVideoProps) {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16">
      <div
        className="overflow-hidden rounded-[6px] border border-neon-indigo/20 bg-midnight-slate-raised/60 backdrop-blur-sm"
        style={{ boxShadow: "0 0 60px rgba(129, 140, 248, 0.12)" }}
      >
        {embedUrl ? (
          <div className="aspect-video">
            <iframe
              src={embedUrl}
              className="h-full w-full border-0"
              allow="autoplay; fullscreen"
              allowFullScreen
              title="Ctrl PPC product demo"
            />
          </div>
        ) : src ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video className="aspect-video w-full" src={src} poster={poster} controls />
        ) : (
          <TerminalPreview />
        )}
      </div>
    </section>
  );
}
