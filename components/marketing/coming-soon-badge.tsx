// Shared "Coming soon" badge. Was copied four times with small drift (margin, whitespace-nowrap,
// text-off-white/40 vs /50) across intelligence-store.tsx, pricing/page.tsx (twice) and vs/page.tsx
// -- the same class of duplication the hygiene gate flags for the app (median, safeDiv). One
// component, one place to change the treatment.

export function ComingSoonBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`whitespace-nowrap rounded-[4px] border border-off-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-off-white/50 ${className}`}
    >
      Coming soon
    </span>
  );
}
