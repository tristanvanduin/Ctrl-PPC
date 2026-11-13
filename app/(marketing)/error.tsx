"use client";

// De grens om de marketingpagina's en /login. Binnen app/(marketing)/layout.tsx, dus kop en voet
// blijven staan. Bewust zonder de dashboardmelding: een bezoeker hoeft geen foutcode te lezen, maar
// wel te weten dat het aan ons ligt en dat opnieuw proberen kan helpen.

import { useEffect } from "react";

export default function MarketingFout({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[foutgrens] marketingpagina:", error);
  }, [error]);

  return (
    <div role="alert" data-foutgrens="marketingpagina" className="mx-auto my-16 max-w-xl px-4 text-center">
      <h1 className="text-xl font-semibold">Deze pagina kon niet geladen worden.</h1>
      <p className="mt-2 text-sm opacity-80">Er ging bij ons iets mis. Probeer het opnieuw; blijft het zo, laat het ons weten.</p>
      {error?.digest && <p className="mt-2 text-xs opacity-60">Foutcode {error.digest}</p>}
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Opnieuw proberen
      </button>
    </div>
  );
}
