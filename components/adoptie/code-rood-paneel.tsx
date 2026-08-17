"use client";

import { AlertOctagon, AlertTriangle, Check, X } from "lucide-react";
import Link from "next/link";
import { useCodeRoodMeldingen, type CodeRoodMelding } from "@/lib/adoptie/use-code-rood";

// Het Today-paneel voor Code Rood/Amber (klant-churnrisico). Bewust een apart visueel vocabulaire
// -- geen hergebruik van de rode/oranje/gele stippen uit today-feed.tsx, die over dagelijkse
// triage gaan (tracking kapot, budget fout) en niets met churn te maken hebben. Verwarren van de
// twee zou precies het "niet verkeerd afvuren" ondermijnen dat de reden was om Code Rood zeldzaam
// te houden (zie lib/adoptie/account-stoplicht.ts).

function MeldingRij({ melding, magReageren, reageer }: {
  melding: CodeRoodMelding;
  magReageren: boolean;
  reageer: (id: string, actie: "accepteren" | "afwijzen") => Promise<void>;
}) {
  const rood = melding.licht === "rood";
  return (
    <div className={`rounded-lg border p-3 ${rood ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex items-start gap-2.5">
        {rood ? <AlertOctagon className="w-4.5 h-4.5 text-red-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/client/${melding.clientId}`} className={`text-lead font-semibold hover:underline ${rood ? "text-red-800" : "text-amber-800"}`}>
              {melding.clientNaam}
            </Link>
            <span className={`text-micro font-bold uppercase px-1.5 py-0.5 rounded ${rood ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
              {rood ? "Code Rood" : "Code Amber"}
            </span>
            {melding.status !== "open" && (
              <span className="text-micro text-muted-foreground">({melding.status})</span>
            )}
          </div>
          <ul className="mt-1 space-y-0.5">
            {melding.redenen.map((r, i) => (
              <li key={i} className={`text-body ${rood ? "text-red-700" : "text-amber-700"}`}>&bull; {r}</li>
            ))}
          </ul>
        </div>
        {magReageren && melding.status === "open" && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => reageer(melding.id, "accepteren")}
              className="inline-flex items-center gap-1 text-micro font-semibold px-2 py-1 rounded-md bg-white border border-red-300 text-red-700 hover:bg-red-100"
              title={rood ? "Accepteren: klant verplaatst naar de Code Rood-sectie in de zijbalk" : "Accepteren: gezien, geen verdere actie"}
            >
              <Check className="w-3.5 h-3.5" /> Accepteren
            </button>
            <button
              onClick={() => reageer(melding.id, "afwijzen")}
              className="inline-flex items-center gap-1 text-micro font-semibold px-2 py-1 rounded-md bg-white border border-border text-muted-foreground hover:bg-gray-50"
            >
              <X className="w-3.5 h-3.5" /> Afwijzen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CodeRoodPaneel() {
  const { meldingen, magReageren, loading, error, reageer } = useCodeRoodMeldingen();
  const open = meldingen.filter((m) => m.status === "open");

  if (loading) return null;
  if (error) return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body text-amber-800">{error}</div>;
  if (open.length === 0) return null;

  const rood = open.filter((m) => m.licht === "rood");
  const amber = open.filter((m) => m.licht === "amber");

  return (
    <section>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
        <h2 className="text-sm font-bold text-brand-gray">Code Rood / Amber &mdash; klantrisico</h2>
        <span className="text-meta font-bold rounded-full px-2 py-0.5 tabular-nums bg-red-600 text-white">{open.length}</span>
        <span className="text-meta text-muted-foreground ml-auto text-right">forecast-afwijking, nieuwe gebruiker of een kritieke health-score-anomalie</span>
      </div>
      <div className="space-y-2">
        {[...rood, ...amber].map((m) => (
          <MeldingRij key={m.id} melding={m} magReageren={magReageren} reageer={reageer} />
        ))}
      </div>
    </section>
  );
}
