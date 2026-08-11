"use client";

import Link from "next/link";
import { AlertOctagon, ArrowLeft } from "lucide-react";
import { useCodeRoodMeldingen } from "@/lib/adoptie/use-code-rood";

// Het "Aanvalsplan"-dossier voor een geaccepteerde Code Rood-melding. Bewust minimaal: de volle
// blauwdruk-spec (Marktperspectief via God View, Bewijslast & Roadmap 3-laags) vergt een
// God-View-marktvergelijking die vandaag niet bestaat (lib/benchmark/cel.ts is coverage-only,
// nog niet klantzijdig ontsloten) -- dit toont de echte meldingdata en een proceschecklist, geen
// verzonnen cijfers waar nog geen pijplijn voor is.

export function CodeRoodDossier({ clientId }: { clientId: string }) {
  const { meldingen, loading, error } = useCodeRoodMeldingen();
  const melding = meldingen.find((m) => m.clientId === clientId && m.licht === "rood");

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-4">
      <Link href={`/client/${clientId}`} className="inline-flex items-center gap-1.5 text-body text-muted-foreground hover:text-rm-gray">
        <ArrowLeft className="w-3.5 h-3.5" /> Terug naar het dashboard
      </Link>

      {loading && <p className="text-body text-muted-foreground">Laden&hellip;</p>}
      {error && <p className="text-body text-red-600">{error}</p>}

      {!loading && !error && !melding && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-body text-muted-foreground">
          Geen Code Rood-melding gevonden voor deze klant.
        </p>
      )}

      {melding && (
        <>
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="w-6 h-6 text-red-600" />
            <h1 className="text-page font-bold text-rm-gray">{melding.clientNaam} &mdash; Code Rood</h1>
          </div>
          <p className="text-body text-muted-foreground">
            Gedetecteerd {new Date(melding.gedetecteerdOp).toLocaleDateString("nl-NL")}
            {melding.gereageerdOp && `, geaccepteerd ${new Date(melding.gereageerdOp).toLocaleDateString("nl-NL")}`}.
          </p>

          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h2 className="text-title font-semibold text-red-700 mb-2">Waarom dit is afgevuurd</h2>
            <ul className="space-y-1">
              {melding.redenen.map((r, i) => (
                <li key={i} className="text-body text-red-700">&bull; {r}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-title font-semibold text-rm-gray mb-2">Volgende stappen</h2>
            <p className="text-body text-muted-foreground mb-3">
              Nog geen automatisch aanvalsplan &mdash; dit is een checklist, geen analyse. Een
              marktvergelijking via God View en een onderbouwde roadmap zijn nog niet gebouwd.
            </p>
            <ul className="space-y-1.5 text-body text-rm-gray">
              <li>&bull; Neem contact op met de klant &mdash; weet diegene waarom de cijfers afwijken?</li>
              <li>&bull; Controleer of de nieuwe gebruiker in de change history bekend is (intern, of een ander bureau?)</li>
              <li>&bull; Loop de forecast-afwijking na op de Prognose-tab: welke maand, welk kanaal?</li>
              <li>&bull; Leg de bevindingen en de afspraak vast, ook als het loos alarm blijkt.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
