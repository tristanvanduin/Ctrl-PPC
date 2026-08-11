import { AlertTriangle, ListChecks, Infinity as InfinityIcon } from "lucide-react";
import { RoiCalculator } from "./roi-calculator";

// Fase 7, Task 2 (Blok 3): drie kolommen. De middelste (het 6-staps Decision Framework) volgt
// de echte pijplijn uit lib/decision/ (signaal -> hypothese -> kwaliteitspoort -> uitvoering ->
// attributie -> geheugen), niet een verzonnen marketingraamwerk -- zie hypothesis-discovery.ts,
// quality-gates.ts en hypothesis-evaluator.ts voor de daadwerkelijke implementatie van elke stap.

const PIJNPUNTEN = [
  "Separate exports per channel that are never updated on the same day",
  "A recommendation with no measurable expectation, so there is no way to test it later",
  "Account changes that nobody links back to the result they were supposed to explain",
];

const FRAMEWORK_STAPPEN = [
  { stap: "1", titel: "Signal", omschrijving: "Automatic detection per channel: Google, Meta, LinkedIn." },
  { stap: "2", titel: "Hypothesis", omschrijving: "A concrete, measurable prediction. Not a vague suggestion." },
  { stap: "3", titel: "Quality gate", omschrijving: "Every hypothesis has to clear hard criteria before it counts." },
  { stap: "4", titel: "Execution", omschrijving: "Observed, not automated: we see what actually changed." },
  { stap: "5", titel: "Attribution", omschrijving: "The result gets linked back to the hypothesis that predicted it." },
  { stap: "6", titel: "Agency memory", omschrijving: "The outcome is remembered, for the next decision." },
];

export function FeaturesBlock() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-10 lg:grid-cols-3">
        {/* Kolom 1: Industrie-pijn */}
        <div>
          <AlertTriangle className="h-8 w-8 text-amber-waste" aria-hidden />
          <h3 className="mt-4 font-marketing-heading text-xl font-bold text-off-white">
            Where performance marketing breaks down
          </h3>
          <ul className="mt-4 space-y-3">
            {PIJNPUNTEN.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-off-white/60">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-waste" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* Kolom 2: 6-staps Decision Framework */}
        <div>
          <ListChecks className="h-8 w-8 text-neon-indigo" aria-hidden />
          <h3 className="mt-4 font-marketing-heading text-xl font-bold text-off-white">
            The 6-step Decision Framework
          </h3>
          <ol className="mt-4 space-y-4">
            {FRAMEWORK_STAPPEN.map((s) => (
              <li key={s.stap} className="flex gap-3">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-midnight-slate"
                  style={{ backgroundColor: "#818cf8", fontFamily: "var(--font-marketing-mono)" }}
                >
                  {s.stap}
                </span>
                <div>
                  <p className="text-sm font-semibold text-off-white">{s.titel}</p>
                  <p className="text-sm text-off-white/50">{s.omschrijving}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Kolom 3: 'No Limits' propositie + ROI-calculator */}
        <div>
          <InfinityIcon className="h-8 w-8 text-copper" aria-hidden />
          <h3 className="mt-4 font-marketing-heading text-xl font-bold text-off-white">
            No limit on accounts
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-off-white/60">
            One platform for every account and every agency you manage, without a new invoice opening
            for each extra client. Cross-channel synergy compounds with every account you add, not
            just every channel.
          </p>
          <div className="mt-6">
            <RoiCalculator />
          </div>
        </div>
      </div>
    </section>
  );
}
