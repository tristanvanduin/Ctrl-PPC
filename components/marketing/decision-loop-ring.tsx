"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Lightbulb, ShieldCheck, ClipboardList, BarChart3, Brain } from "lucide-react";
import { LOOP_STAGES } from "@/lib/marketing/loop";

// The at-a-glance version of the loop: an actual closed ring, not a numbered list with a footnote
// saying it loops. Built after the user pushed back on the first version -- "willen we het in een
// stappenplan... of willen we het in een soort loop? want het is een loop." -- correctly: a
// vertical 1-6 list reads as a sequence with an end, and the whole point of this mechanism is that
// it does not end. This sits above the detailed vertical breakdown in components/marketing/
// decision-loop.tsx, which stays for the in-depth per-stage reading; a circle has no room for a
// paragraph and a code reference per node, so the split is "see the shape here, read the depth
// below" rather than trying to cram both into one diagram.
//
// THIRD PASS (same day, now a Client Component). Two rounds of feedback:
//
// 1. Six individual arrowheads (one per segment) were tried after "too simplistic," then reverted
//    after the user compared it against the one-arrow version and preferred that -- correctly, in
//    hindsight: the traveling dot already shows direction continuously, so six static arrowheads
//    on top of it were redundant clutter rather than added clarity. Back to a single highlighted
//    closing arc.
// 2. An interactive brief arrived (hover/tap to focus a node, dim the rest, show a typewriter
//    description in the center, pause the tracer while focused). The mechanics were sound and are
//    built below. The brief's specific center-text CONTENT was not used as given -- two of its six
//    lines were factually wrong for this product ("Deploying changes natively via platform APIs"
//    contradicts the FAQ's "never executes anything itself"; "Logging pattern to global agency
//    intelligence" describes the unbuilt cross-agency God View, not the per-agency Agency Memory
//    this stage actually is) and a third did not match the real nine gate names. The center text
//    uses each stage's `pitch` from lib/marketing/loop.ts instead -- already grounded against the
//    real pipeline, already fact-checked once, no reason to write a second, less accurate version.
//
// Positions are hardcoded percentages for a hexagonal ring (6 nodes, 60 degrees apart, clockwise
// from the top) rather than computed at runtime -- there are exactly six stages and they do not
// change, so the trig only needed to be done once, by me, not by the browser on every render.
//
// MOBILE OVERLAP, also caught by testing rather than by reading the code: on a narrow viewport the
// ring is smaller, so the fixed-size active-state center card (13rem wide, two lines of text) can
// physically overlap the Hypothesis/Agency Memory node labels above it. Measured with Playwright
// bounding boxes on an iPhone 13 viewport: about 40x15px of real overlap, matching what the
// screenshot showed -- the card border cutting through the "HYPOTHESIS" label. Fixed by giving the
// active card a smaller max-width and tighter padding/font below the sm breakpoint.
//
// CLICK VS HOVER, caught by testing rather than by reading the code: a node's onClick originally
// toggled relative to whatever was already active ("if this is already selected, deselect it").
// That looked right in isolation but broke for every real mouse user, not just touch: a click is
// preceded by a real mouseenter at the same coordinates, which already set this node active before
// the click handler ran -- so the toggle saw "already active" and immediately deselected on the
// same interaction. Confirmed with a Playwright click: aria-pressed came back false right after
// clicking. Click now unconditionally selects (with stopPropagation so it does not also trigger
// the container's click-to-deselect below); deselection on desktop is mouseleave, and on touch
// devices (no mouseleave) is tapping anywhere in the ring outside a node.

const ICONS = [Activity, Lightbulb, ShieldCheck, ClipboardList, BarChart3, Brain];

const POSITIES = [
  { x: 50, y: 16 },
  { x: 79.4, y: 33 },
  { x: 79.4, y: 67 },
  { x: 50, y: 84 },
  { x: 20.6, y: 67 },
  { x: 20.6, y: 33 },
];

const SEGMENTEN = [
  "M 50 16 A 34 34 0 0 1 79.4 33",
  "M 79.4 33 A 34 34 0 0 1 79.4 67",
  "M 79.4 67 A 34 34 0 0 1 50 84",
  "M 50 84 A 34 34 0 0 1 20.6 67",
  "M 20.6 67 A 34 34 0 0 1 20.6 33",
];
const SLUITENDE_BOOG = "M 20.6 33 A 34 34 0 0 1 50 16";
const VOLLEDIGE_BAAN = "M 50 16 A 34 34 0 1 1 50 84 A 34 34 0 1 1 50 16";

const TYPE_SNELHEID_MS = 18;

export function DecisionLoopRing() {
  const [actief, setActief] = useState<number | null>(null);
  const [getypt, setGetypt] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // De reizende stip pauzeert zolang een stadium focus heeft -- SMIL luistert niet naar React
  // state rechtstreeks, dus dit gaat via de echte SVG-API (pauseAnimations/unpauseAnimations),
  // niet via een CSS-klasse zoals de rest van de animaties op deze site.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (actief !== null) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }, [actief]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (actief === null) { setGetypt(""); return; }

    const tekst = LOOP_STAGES[actief].pitch;
    const verkortBewegen = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (verkortBewegen) { setGetypt(tekst); return; }

    setGetypt("");
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 1;
      setGetypt(tekst.slice(0, i));
      if (i >= tekst.length && timerRef.current) clearInterval(timerRef.current);
    }, TYPE_SNELHEID_MS);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [actief]);

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[26rem] sm:max-w-[30rem]"
      onClick={() => setActief(null)}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        style={{ filter: "drop-shadow(0 0 6px rgba(129, 140, 248, 0.2))" }}
        aria-hidden
      >
        <defs>
          <marker id="loop-close-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#818cf8" />
          </marker>
          <path id="loop-track-full" d={VOLLEDIGE_BAAN} fill="none" />
        </defs>

        {SEGMENTEN.map((d) => (
          <path key={d} d={d} fill="none" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="0.7" />
        ))}
        {/* De sluitende boog, van Agency Memory terug naar Signal -- de ene plek waar "hier
            begint de lus opnieuw" met opzet wel een pijlpunt draagt. Zes losse pijlpunten zijn
            geprobeerd en teruggedraaid: de reizende stip laat de richting al continu zien, dus
            zes stilstaande pijlen erbovenop lazen als herhaling, niet als duidelijkheid. */}
        <path d={SLUITENDE_BOOG} fill="none" stroke="#818cf8" strokeWidth="1.3" markerEnd="url(#loop-close-arrow)" />

        <circle r="1.3" fill="#818cf8" className="loop-travel-dot" style={{ filter: "drop-shadow(0 0 3px rgba(129, 140, 248, 0.9))" }}>
          <animateMotion dur="9s" repeatCount="indefinite">
            <mpath href="#loop-track-full" />
          </animateMotion>
        </circle>
      </svg>

      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        {actief === null ? (
          <div
            className="rounded-[8px] bg-midnight-slate/80 px-4 py-2.5 backdrop-blur-sm"
            style={{ boxShadow: "0 0 24px rgba(0, 0, 0, 0.5)" }}
          >
            <p className="font-marketing-heading text-sm font-bold text-off-white sm:text-base">Ctrl PPC</p>
            <p
              className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-neon-indigo sm:text-[10px]"
              style={{ fontFamily: "var(--font-marketing-mono)" }}
            >
              Decision Loop
            </p>
            {/* "System Active" was the original ask; same issue as before -- it implies a live
                per-visitor session, and nothing is active for an anonymous visitor who has
                connected nothing. */}
            <div className="mt-1.5 flex items-center justify-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[9px] text-off-white/50" style={{ fontFamily: "var(--font-marketing-mono)" }}>
                Runs continuously
              </span>
            </div>
            <p className="mt-2 text-[9px] text-off-white/30">Select a stage</p>
          </div>
        ) : (
          <div
            className="w-full max-w-[9.5rem] rounded-[8px] bg-midnight-slate/90 px-3 py-2 backdrop-blur-sm sm:max-w-[13rem] sm:px-4 sm:py-3"
            style={{ boxShadow: "0 0 24px rgba(0, 0, 0, 0.55)" }}
          >
            <p
              className="text-[8px] font-semibold uppercase tracking-[0.2em] text-neon-indigo sm:text-[10px]"
              style={{ fontFamily: "var(--font-marketing-mono)" }}
            >
              {LOOP_STAGES[actief].naam}
            </p>
            <p
              className="mt-1 min-h-[2.2rem] text-[9.5px] leading-relaxed text-off-white sm:mt-1.5 sm:min-h-[2.5rem] sm:text-xs"
              style={{ fontFamily: "var(--font-marketing-mono)" }}
            >
              {getypt}
              <span className="animate-pulse text-neon-indigo">_</span>
            </p>
          </div>
        )}
      </div>

      {LOOP_STAGES.map((s, i) => {
        const Icon = ICONS[i];
        const pos = POSITIES[i];
        const isActief = actief === i;
        const isGedimd = actief !== null && !isActief;
        return (
          <button
            key={s.id}
            type="button"
            onMouseEnter={() => setActief(i)}
            onMouseLeave={() => setActief(null)}
            onClick={(e) => { e.stopPropagation(); setActief(i); }}
            aria-pressed={isActief}
            aria-label={`${s.naam}: ${s.pitch}`}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity duration-200"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, opacity: isGedimd ? 0.35 : 1 }}
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-midnight-slate transition-all duration-200 sm:h-12 sm:w-12"
              style={{
                borderColor: isActief ? "#818cf8" : "rgba(129, 140, 248, 0.5)",
                boxShadow: isActief ? "0 0 20px rgba(129, 140, 248, 0.75)" : "0 0 12px rgba(129, 140, 248, 0.4)",
              }}
            >
              <Icon className="h-4 w-4 text-neon-indigo sm:h-5 sm:w-5" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-off-white sm:text-[11px]">
              {s.naam}
            </span>
          </button>
        );
      })}
    </div>
  );
}
