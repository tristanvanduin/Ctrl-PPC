"use client";

// De grens om elke dashboardpagina (Vandaag, Portfolio, Klanten, Instellingen, ...). Hij staat
// binnen app/(app)/layout.tsx, dus bij een fout blijven de zijbalk en de bovenbalk staan en kun je
// naar een andere pagina. Zonder dit bestand maakte een renderfout het hele scherm leeg.
// Zie app/(app)/foutgrens.tsx voor wat de melding zegt en waarom.

import { Foutmelding } from "./foutgrens";

export default function DashboardFout({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <Foutmelding error={error} opnieuw={unstable_retry} waar="deze pagina" />;
}
