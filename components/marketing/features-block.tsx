import { AlertTriangle, ListChecks, Infinity as InfinityIcon } from "lucide-react";
import { RoiCalculator } from "./roi-calculator";

// Fase 7, Task 2 (Blok 3): drie kolommen. De middelste (het 6-staps Decision Framework) volgt
// de echte pijplijn uit lib/decision/ (signaal -> hypothese -> kwaliteitspoort -> uitvoering ->
// attributie -> geheugen), niet een verzonnen marketingraamwerk -- zie hypothesis-discovery.ts,
// quality-gates.ts en hypothesis-evaluator.ts voor de daadwerkelijke implementatie van elke stap.

const PIJNPUNTEN = [
  "Losse exports per kanaal die nooit op dezelfde dag zijn bijgewerkt",
  "Een aanbeveling zonder meetbare verwachting, dus zonder manier om hem later te toetsen",
  "Wijzigingen in het account die niemand terugkoppelt aan het resultaat dat ze zouden verklaren",
];

const FRAMEWORK_STAPPEN = [
  { stap: "1", titel: "Signaal", omschrijving: "Automatische detectie per kanaal: Google, Meta, LinkedIn." },
  { stap: "2", titel: "Hypothese", omschrijving: "Een concrete, meetbare voorspelling. Geen vage aanbeveling." },
  { stap: "3", titel: "Kwaliteitspoort", omschrijving: "Elke hypothese moet langs harde criteria voor hij telt." },
  { stap: "4", titel: "Uitvoering", omschrijving: "Geobserveerd, niet geautomatiseerd: wij zien wat er veranderde." },
  { stap: "5", titel: "Attributie", omschrijving: "Het resultaat teruggekoppeld aan de hypothese die het voorspelde." },
  { stap: "6", titel: "Geheugen", omschrijving: "De uitkomst blijft onthouden, voor de volgende beslissing." },
];

export function FeaturesBlock() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-10 lg:grid-cols-3">
        {/* Kolom 1: Industrie-pijn */}
        <div>
          <AlertTriangle className="h-8 w-8 text-amber-waste" aria-hidden />
          <h3 className="mt-4 font-marketing-heading text-xl font-bold text-off-white">
            Waar performance marketing op vastloopt
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
            Het 6-staps Decision Framework
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
            Geen limiet op accounts
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-off-white/60">
            Eén platform voor elk account en elk bureau dat je beheert, zonder dat elke extra klant een
            aparte rekening opent.
          </p>
          <div className="mt-6">
            <RoiCalculator />
          </div>
        </div>
      </div>
    </section>
  );
}
