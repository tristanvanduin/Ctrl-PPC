import Link from "next/link";
import { AlertTriangle, ListChecks, Infinity as InfinityIcon, ArrowRight } from "lucide-react";
import { RoiCalculator } from "./roi-calculator";
import { ExecutionNode } from "./execution-node";

// Fase 7, Task 2 (Blok 3): drie kolommen. De middelste (het 6-staps Decision Framework) volgt
// de echte pijplijn uit lib/decision/ (signaal -> hypothese -> kwaliteitspoort -> uitvoering ->
// attributie -> geheugen), niet een verzonnen marketingraamwerk -- zie hypothesis-discovery.ts,
// quality-gates.ts en hypothesis-evaluator.ts voor de daadwerkelijke implementatie van elke stap.
// De platte genummerde lijst is op 11 augustus 2026 vervangen door ExecutionNode -- een verbonden
// verticale tijdlijn i.p.v. losse genummerde bolletjes, met de Context Chips op de Signal-stap
// zodat de herkomst van de data zichtbaar is, niet alleen het label.

const PIJNPUNTEN = [
  "Separate exports per channel that are never updated on the same day",
  "A recommendation with no measurable expectation, so there is no way to test it later",
  "Account changes that nobody links back to the result they were supposed to explain",
];

export function FeaturesBlock() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
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
          <div className="mt-5">
            <ExecutionNode />
          </div>
          {/* Deze kolom is de teaser: elke stap krijgt hier drie regels. De diepe versie -- de
              echte codepaden per stap, plus hoe stap 6 teruggaat naar stap 1 -- staat op
              /how-it-works (audit-vervolg, 11 augustus 2026). */}
          <Link
            href="/how-it-works"
            className="group mt-4 inline-flex items-center gap-1.5 py-2.5 text-sm font-semibold text-neon-indigo hover:text-off-white"
          >
            See the full loop
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
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
