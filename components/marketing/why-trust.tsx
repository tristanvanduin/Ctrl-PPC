import { CheckCircle2 } from "lucide-react";

// Fase 7 vervolg (17 augustus 2026, na Copilot-feedback op de homepage): de site liet nergens
// zien WAAROM een aanbeveling te vertrouwen is, alleen WAT het product doet. Elk item hieronder
// is nagekeken tegen het echte schema voordat het hier kwam te staan -- geen marketingclaim die
// niet ergens een kolom heeft: success_predicates/guardrail_predicates en evaluate_after
// (migratie 005), outcome/evaluated_at (005/010), result_met/learning (migratie 010). Geen
// interne veldnamen genoemd op de pagina zelf, alleen het gedrag dat ze afdwingen.
const CHECKLIST = [
  {
    titel: "A measurable prediction",
    tekst: "Every hypothesis states what should happen, not just what to change.",
  },
  {
    titel: "A defined success criterion",
    tekst: "Decided before the change ships, not judged after the fact.",
  },
  {
    titel: "A fixed review date",
    tekst: "A date the outcome gets checked, not \"whenever someone remembers.\"",
  },
  {
    titel: "A logged outcome",
    tekst: "Measured and recorded, whether it worked or not.",
  },
  {
    titel: "A learning that compounds",
    tekst: "Feeds that account's next analysis, so nothing gets re-tested from scratch.",
  },
];

export function WhyTrust() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
        Why trust the recommendation
      </p>
      <h2 className="mt-2 text-center font-marketing-heading text-2xl font-bold text-off-white sm:text-3xl">
        Most tools tell you what changed. Ctrl PPC tells you why.
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-off-white/60">
        Every signal gets tested against the same question before it becomes a recommendation: is
        the real cause your account, your tracking, your market, your demand, or your attribution.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {CHECKLIST.map((item) => (
          <div key={item.titel} className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 p-4">
            <CheckCircle2 className="h-5 w-5 text-neon-indigo" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-off-white">{item.titel}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-off-white/50">{item.tekst}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
