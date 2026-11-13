"use client";

// De foutmelding van het dashboard, en de grens om een onderdeel heen.
//
// WAAROM DIT BESTAAT. Tot 13 november had de app geen enkele error-grens buiten de kaartgrafiek
// (components/dashboard/map-error-boundary.tsx). Een renderfout in een onderdeel haalde de hele
// klantpagina onderuit en liet de standaardfoutpagina van Next achter, terwijl tsc, de tests en de
// build groen stonden. Nu zijn er drie lagen:
//   - OnderdeelGrens, om de inhoud van een tabblad: kop, navigatie en de andere tabbladen blijven;
//   - app/(app)/error.tsx en app/(app)/client/[clientId]/error.tsx: de pagina valt weg, de zijbalk
//     en bovenbalk blijven, zodat je ergens anders heen kunt;
//   - app/global-error.tsx: alleen als de root-layout zelf breekt.
//
// WAT DE MELDING ZEGT. Wat er misging (de foutmelding zelf: bij een fout in de browser is dat de
// echte tekst; bij een fout op de server geeft Next in productie een algemene tekst met een code,
// en die code staat in de serverlogs), waar (het onderdeel), en een knop om het opnieuw te proberen.
// "Er ging iets mis" zonder meer zegt niets; de eigenaar moet kunnen zien of het een netwerkfout of
// een rekenfout is voordat hij besluit of hij erop wacht.
//
// data-foutgrens staat op elke melding: scripts/rookproef.mjs zoekt erop, want een pagina die
// "netjes" een foutmelding toont is voor de rookproef nog steeds een kapotte pagina.

import { useEffect } from "react";
import { unstable_catchError, type ErrorInfo } from "next/error";
import { AlertTriangle, RotateCcw } from "lucide-react";

export function Foutmelding({
  error,
  opnieuw,
  waar,
}: {
  error: Error & { digest?: string };
  opnieuw: () => void;
  /** Welk deel van het scherm: "dit tabblad", "deze pagina". */
  waar: string;
}) {
  useEffect(() => {
    // Ook in de console, met de stack: de melding op het scherm is voor de gebruiker, dit is voor
    // wie hem gaat oplossen.
    console.error(`[foutgrens] ${waar}:`, error);
  }, [error, waar]);

  const tekst = error?.message?.trim() || "Onbekende fout zonder melding.";
  return (
    <div
      role="alert"
      data-foutgrens={waar}
      className="mx-auto my-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-5 text-red-900"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">Er ging iets mis bij het tonen van {waar}.</p>
          <p className="break-words text-sm">{tekst}</p>
          {error?.digest && (
            <p className="text-xs text-red-800">
              Foutcode {error.digest}: dezelfde code staat in de serverlogs.
            </p>
          )}
          <p className="text-xs text-red-800">
            De rest van het dashboard werkt nog. Opnieuw proberen haalt de gegevens opnieuw op.
          </p>
          <button
            type="button"
            onClick={opnieuw}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Opnieuw proberen
          </button>
        </div>
      </div>
    </div>
  );
}

function OnderdeelFout({ onderdeel }: { onderdeel: string }, { error, unstable_retry }: ErrorInfo) {
  return <Foutmelding error={error} opnieuw={unstable_retry} waar={`het onderdeel ${onderdeel}`} />;
}

/**
 * Een grens om een onderdeel van een pagina. Een fout erin toont de melding op die plek; alles
 * eromheen blijft staan. Next's eigen variant (unstable_catchError) en geen eigen klasse: die laat
 * redirect() en notFound() door en kan met unstable_retry ook servercomponenten opnieuw ophalen.
 */
export const OnderdeelGrens = unstable_catchError(OnderdeelFout);
