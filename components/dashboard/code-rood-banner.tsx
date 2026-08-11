"use client";

import { AlertOctagon, AlertTriangle, Check, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCodeRoodMeldingen } from "@/lib/adoptie/use-code-rood";

// De "hele duidelijke stip" op elk scherm van de klant (besluit eigenaar, 11 aug 2026): deze
// banner staat vlak bij TrackingAlert, buiten de tabwisseling, dus zichtbaar ongeacht welk
// tabblad open staat. Toont zichzelf niet (null) zonder open of geaccepteerde melding, en niet
// meer na afwijzen -- afgewezen betekent gezien en zonder actie, niet "blijf het tonen".

export function CodeRoodBanner({ clientId }: { clientId: string }) {
  const { meldingen, magReageren, reageer } = useCodeRoodMeldingen();
  const melding = meldingen.find((m) => m.clientId === clientId && m.status !== "afgewezen");
  if (!melding) return null;

  const rood = melding.licht === "rood";
  const geaccepteerd = melding.status === "geaccepteerd";

  return (
    <div className={`rounded-xl p-4 shadow-sm border ${rood ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="flex items-start gap-3">
        {rood ? <AlertOctagon className="w-5 h-5 text-red-600 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
        <div className="flex-1">
          <h3 className={`text-title font-semibold ${rood ? "text-red-700" : "text-amber-700"}`}>
            {rood ? "Code Rood" : "Code Amber"} &mdash; {rood ? "churnrisico, alle hands on deck" : "wees alert"}
            {geaccepteerd && <span className="ml-2 text-micro font-normal text-muted-foreground">(geaccepteerd)</span>}
          </h3>
          <ul className="mt-1 space-y-0.5">
            {melding.redenen.map((r, i) => (
              <li key={i} className={`text-xs ${rood ? "text-red-600" : "text-amber-600"}`}>&bull; {r}</li>
            ))}
          </ul>
          <div className="flex items-center gap-3 mt-2">
            {!geaccepteerd && magReageren && (
              <>
                <button
                  onClick={() => reageer(melding.id, "accepteren")}
                  className="inline-flex items-center gap-1 text-micro font-semibold text-red-700 hover:underline"
                >
                  <Check className="w-3 h-3" /> Accepteren
                </button>
                <button
                  onClick={() => reageer(melding.id, "afwijzen")}
                  className="inline-flex items-center gap-1 text-micro font-semibold text-muted-foreground hover:underline"
                >
                  <X className="w-3 h-3" /> Afwijzen
                </button>
              </>
            )}
            {geaccepteerd && rood && (
              <Link href={`/client/${clientId}/code-rood`} className="inline-flex items-center gap-1 text-micro font-semibold text-red-700 hover:underline">
                Naar het dossier <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
