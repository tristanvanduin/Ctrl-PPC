// Hypothesis Execution Node: a vertical connected timeline for the 6-step Decision Framework,
// replacing the plain numbered list. A continuous neon-indigo line runs through every node,
// low padding, sharp mono labels -- IDE pipeline log, not a marketing infographic. The Signal
// node carries ContextChips to show where the data actually comes from.

import { ContextChips } from "./context-chips";

interface NodeStep {
  stap: string;
  titel: string;
  omschrijving: string;
}

const STAPPEN: NodeStep[] = [
  { stap: "01", titel: "Signal", omschrijving: "Automatic detection per channel: Google, Meta, LinkedIn." },
  { stap: "02", titel: "Hypothesis", omschrijving: "A concrete, measurable prediction. Not a vague suggestion." },
  { stap: "03", titel: "Quality gate", omschrijving: "Every hypothesis has to clear hard criteria before it counts." },
  { stap: "04", titel: "Execution", omschrijving: "Observed, not automated: we see what actually changed." },
  { stap: "05", titel: "Attribution", omschrijving: "The result gets linked back to the hypothesis that predicted it." },
  { stap: "06", titel: "Agency memory", omschrijving: "The outcome is remembered, for the next decision." },
];

export function ExecutionNode() {
  return (
    <div className="relative" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <div className="absolute bottom-1 left-[9px] top-1 w-px bg-gradient-to-b from-neon-indigo/60 via-neon-indigo/30 to-transparent" aria-hidden />

      <ol className="space-y-5">
        {STAPPEN.map((s) => (
          <li key={s.stap} className="relative flex gap-3 pl-0">
            <span
              className="relative z-10 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border border-neon-indigo/50 bg-midnight-slate text-[9px] font-bold text-neon-indigo"
              style={{ boxShadow: "0 0 8px rgba(129, 140, 248, 0.35)" }}
            >
              {s.stap.slice(1)}
            </span>
            <div className="min-w-0 pb-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-off-white">{s.titel}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-off-white/50" style={{ fontFamily: "var(--font-sans, inherit)" }}>
                {s.omschrijving}
              </p>
              {s.stap === "01" && (
                <div className="mt-2">
                  <ContextChips />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
