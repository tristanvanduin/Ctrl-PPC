// Reusable Midnight Slate video container. 6px radius, neon-indigo glow border, no iframe
// chrome - the brief is explicit that this must not look like a bolted-on embed.
//
// src/embedUrl stay optional: without one, this renders a static terminal-style preview instead
// of a fake play button that does nothing when clicked - a non-functional player would be more
// misleading than no video at all.
//
// REMOVED FROM THE HOMEPAGE ENTIRELY, 11 August 2026, same day it was added. Real footage
// (public/videos/) landed and was wired in first, but that footage is a recording of the actual
// product, and the actual product's UI is Dutch throughout ("Zoek klant", "Vandaag",
// "Conversielag: 3 dagen" - every screen). The marketing site is deliberately English-only for a
// "world wide" audience; a Dutch-language video under English copy is not a missing-evidence
// problem the way no-video-at-all is, it is contradicting evidence, actively undercutting the page
// around it -- worse than the fallback it would have been shown instead of.
//
// The fallback itself turned out not to earn a spot either, once the video was gone: its PREVIEW_
// REGELS readout is near-identical to ComparisonBlock's DIAGNOSE_REGELS, already shown higher on
// the same homepage. Two placeholder boxes repeating that same fabricated example a second and
// third time read as filler, not as a considered choice -- caught by the user, not by any of the
// automated checks, because nothing here is technically broken. Both call sites are gone from
// app/(marketing)/page.tsx. This component is unused today; see TOEGESTANE_WEZEN in
// scripts/check-hygiene.mjs for why it stays in the tree rather than getting deleted.
//
// The files (public/videos/*.webm, *-poster.jpg) stay too -- this is a positioning problem, not a
// footage-quality one, and the footage itself may still be useful once there is an English UI to
// record (product feature, not a marketing fix).
//
// preload="metadata" is deliberate for any future src usage: the two clips currently in
// public/videos/ are 5.0MB and 1.6MB, and without it the browser fetches the full file for every
// visitor on page load, not just the ones who press play. No compression tooling is available in
// this environment (ffmpeg could not be installed, network-restricted sandbox) -- if the source
// files can be re-encoded at a lower bitrate before upload, that would help more than anything
// this component can do.
//
// POSTER: a video slot that does carry real src/poster props should always pass both -- without a
// poster the browser has nothing to paint until enough of the file loads to extract a frame, and
// this component's own <video> tag has no built-in fallback for that gap.

interface ProductVideoProps {
  src?: string;
  embedUrl?: string;
  poster?: string;
  caption?: string;
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

export function ProductVideo({ src, embedUrl, poster, caption }: ProductVideoProps) {
  return (
    <section className="mx-auto max-w-2xl px-6 pb-16">
      {caption && (
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
          {caption}
        </p>
      )}
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
          <video className="aspect-video w-full" src={src} poster={poster} controls preload="metadata" />
        ) : (
          <TerminalPreview />
        )}
      </div>
    </section>
  );
}
