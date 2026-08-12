import type { Metadata } from "next";
import { CANONIEK_DOMEIN } from "@/lib/domein";
import { LOOP_STAGES } from "@/lib/marketing/loop";
import { DecisionLoop } from "@/components/marketing/decision-loop";
import { DecisionLoopRing } from "@/components/marketing/decision-loop-ring";
import { QualityGateMatrix } from "@/components/marketing/quality-gate-matrix";
import { ContextChips } from "@/components/marketing/context-chips";
import { PrimaryCta } from "@/components/marketing/primary-cta";

// The dedicated "how it works" page, requested after the user shared three AI-generated reference
// diagrams of the Data -> Analyse -> Decision -> Execution -> Evaluation -> Learning loop and
// asked for a real, native version -- "dit is de core van Ctrl PPC... dit is noodzakelijk." Every
// stage's copy is checked against the real pipeline in lib/marketing/loop.ts's header comment,
// including two claims from the reference images that turned out not to hold (God View does not
// belong in this loop; the engine does not apply past learnings automatically yet). This page is
// the deep version; the homepage's ExecutionNode stays the compact teaser and links here.
//
// RING ADDED (same day, second pass): the first version of this page had only the vertical 1-6
// list below. The user pushed back correctly -- "willen we het in een stappenplan... of willen we
// het in een soort loop? want het is een loop" -- a numbered list with an end reads as a sequence,
// and the whole mechanism is that it does not end. DecisionLoopRing is the actual closed shape;
// the vertical list stays for the depth a circle has no room for.
export const metadata: Metadata = {
  title: "How It Works: The Decision Loop | Ctrl PPC",
  description:
    "Data, analysis, a 9-gate decision, execution you control, evaluation against real change history, and learning that closes the loop. The real mechanism behind Ctrl PPC, stage by stage.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How It Works: The Decision Loop | Ctrl PPC",
    description:
      "Data, analysis, a 9-gate decision, execution you control, evaluation, and learning. The real mechanism, stage by stage.",
    type: "website",
  },
};

// HowTo-structured data: dezelfde zes stadia als machineleesbare stappen. Legitiem hier -- dit IS
// een stap-voor-stap-proces, geen kunstmatig in stappen geknipte marketingtekst.
const HOW_TO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How the Ctrl PPC decision loop works",
  description: "The six-stage loop from raw account data to a recorded, learned-from decision.",
  step: LOOP_STAGES.map((s) => ({
    "@type": "HowToStep",
    position: Number(s.stap),
    name: s.naam,
    text: `${s.pitch} ${s.detail}`,
    url: `https://${CANONIEK_DOMEIN}/how-it-works#${s.id}`,
  })),
};

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-14 pb-20 sm:pt-20">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOW_TO_JSON_LD) }}
      />
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">How It Works</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl md:text-5xl">
          The loop behind every decision
        </h1>
        <p className="mt-4 text-off-white/60">
          Not a dashboard you interpret. A loop that reads your accounts, forms a hypothesis,
          checks it against nine gates, hands it to you to execute, confirms what actually
          happened, and remembers it for next time.
        </p>
      </div>

      {/* Three Layers, added 12 August 2026 from the positioning strategy doc: frames where the
          loop below actually lives, without touching the loop content itself (verified against
          lib/marketing/loop.ts and deliberately excludes God View - see that file's header
          comment on why God View is not part of this loop). God View copy stays honest about
          scope: the cross-tenant version does not exist yet, only single-agency/platform-admin
          views (components/terminal/god-mode.tsx, agency-god-view.tsx) and the not-built
          "God View" module in the Intelligence Store on /pricing. */}
      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">Layer 1 - Foundation</p>
          <p className="mt-2 text-sm text-off-white/60">
            Connect Google, Meta, LinkedIn, and Microsoft Ads. See what happened, dashboarding,
            forecasting, KPI monitoring. Free, unlimited accounts, no cap.
          </p>
        </div>
        <div className="rounded-[6px] border border-neon-indigo/30 bg-midnight-slate-raised/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neon-indigo">Layer 2 - Auto-SOP</p>
          <p className="mt-2 text-sm text-off-white/60">
            The loop below. Reads the data, forms a hypothesis, checks it against nine gates, hands
            it to you to execute, and learns from what happened.
          </p>
        </div>
        <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">Layer 3 - God View</p>
          <p className="mt-2 text-sm text-off-white/60">
            Collective intelligence across every connected account. The direction we are building
            toward, not a live feature today.
          </p>
        </div>
      </div>

      <div className="mt-14">
        <DecisionLoopRing />
      </div>

      <div className="mt-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
          The same loop, in depth
        </p>
        <div className="mt-8">
          <DecisionLoop />
        </div>
      </div>

      {/* Illustraties bij twee specifieke stadia, met al gebouwde componenten -- geen nieuwe
          visuals nodig voor wat de homepage al correct laat zien. */}
      <div className="mt-16 space-y-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
            Stage 01, in practice
          </p>
          <p className="mt-2 text-sm text-off-white/60">
            Every signal carries where it came from, not just what it says.
          </p>
          <div className="mt-4">
            <ContextChips />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
            Stage 03, in practice
          </p>
          <p className="mt-2 text-sm text-off-white/60">
            The nine gates a hypothesis has to clear, running against a real example.
          </p>
          <div className="mt-4">
            <QualityGateMatrix />
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 border-t border-off-white/10 pt-10 text-center">
        <p className="text-off-white/60">See the loop run against your own accounts.</p>
        <PrimaryCta>Request a demo</PrimaryCta>
      </div>
    </div>
  );
}
