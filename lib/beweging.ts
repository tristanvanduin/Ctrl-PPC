"use client";

// Bewegingstokens voor code die niet via CSS beweegt (recharts). Dezelfde drie duren als in
// app/globals.css (@theme: --duur-kort/-middel/-lang), zodat er één woordenschat is:
//   kort   120 ms  hover, focus, een kleur die verspringt
//   middel 200 ms  in- en uitklappen, een paneel dat opent
//   lang   300 ms  een wissel van data: een reeks die naar zijn nieuwe vorm gaat
//
// Waarom dit bestaat. Er stonden vijf losse duren met drie curven door elkaar en geen enkel
// token; recharts draaide op zijn standaard van 1500 ms en groeide bij de EERSTE render in vanaf
// nul, terwijl de data er al stond. Dat is beweging zonder reden: de gebruiker heeft niets gedaan.
// Beweging hoort een antwoord te zijn op een handeling (bouwplan fase 0).

import { useEffect, useRef, useSyncExternalStore } from "react";

export const DUUR = { kort: 120, middel: 200, lang: 300 } as const;

const QUERY = "(prefers-reduced-motion: reduce)";

function abonneer(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True als het besturingssysteem om minder beweging vraagt. Op de server altijd false. */
export function useMinderBeweging(): boolean {
  return useSyncExternalStore(
    abonneer,
    () => (typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches),
    () => false,
  );
}

export interface GrafiekBeweging {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: "ease-in-out";
}

/**
 * De bewegingsprops voor een recharts-reeks (<Bar>, <Line>, <Area>): niet ingroeien bij de
 * eerste render, daarna 300 ms ease-in-out bij elke wissel van data, en helemaal niet als de
 * gebruiker om minder beweging vraagt. Spreiden op de reeks: `<Line {...beweging} ... />`.
 *
 * De eerste render herkennen we aan een ref die ná de eerste commit omgaat: de render die op een
 * datawissel volgt, leest dan false en animeert. Een hover of een andere her-render zonder nieuwe
 * data animeert sowieso niet; recharts beweegt alleen als de reeks verandert.
 */
export function useGrafiekBeweging(): GrafiekBeweging {
  const eerste = useRef(true);
  const minder = useMinderBeweging();
  useEffect(() => { eerste.current = false; }, []);
  return { isAnimationActive: !eerste.current && !minder, animationDuration: DUUR.lang, animationEasing: "ease-in-out" };
}
