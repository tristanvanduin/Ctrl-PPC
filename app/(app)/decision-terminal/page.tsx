import { Suspense } from "react";
import { DecisionTerminalPage } from "@/components/terminal/decision-terminal-page";

// Fase 2, Task 4: Decision Terminal. Losse, geisoleerde route buiten analysis-catalog.ts en
// buiten de bestaande klant-tabs (zie het gesprek bij het bouwen: de decision-routes horen nog
// niet in de UI-navigatie, Stap 4). Suspense: DecisionTerminalPage leest ?client= via
// useSearchParams(), hetzelfde patroon als app/client/[clientId]/page.tsx.
export default function Page() {
  return (
    <Suspense>
      <DecisionTerminalPage />
    </Suspense>
  );
}
