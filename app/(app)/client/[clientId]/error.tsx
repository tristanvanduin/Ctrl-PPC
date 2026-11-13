"use client";

// De grens om de klantpagina. Een fout in een tabblad vangt OnderdeelGrens al binnen het dashboard
// (components/dashboard/client-dashboard.tsx); deze grens is voor wat daarbuiten breekt, zoals de
// kop en de kanaalbalk. De zijbalk blijft staan, dus een andere klant kiezen werkt nog.

import { Foutmelding } from "../../foutgrens";

export default function KlantpaginaFout({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <Foutmelding error={error} opnieuw={unstable_retry} waar="deze klantpagina" />;
}
