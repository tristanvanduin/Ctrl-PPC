"use client";

import { useEffect, useRef, useState } from "react";
import { compactNumber, compactCurrency } from "@/lib/format/compact-number";

// Herbruikbare live-teller (Fase 5, Task 4). Puur presentatie: WANNEER hij telt/tickt bepaalt de
// aanroeper (bijv. een IntersectionObserver op de Platform Pulse-hero, of gewoon een interval dat
// `value` ververst) -- Counter reageert alleen op een veranderende `value`-prop. Dat houdt hem
// bruikbaar op elke pagina, niet alleen de nieuwe "Executive Terminal"-schermen.

export interface CounterProps {
  value: number;
  label: string;
  /** Activeert de tick-animatie en het neon-indigo-accent. Zonder isLive: statisch cijfer,
   *  gewone tekstkleur -- géén "slot machine"-effect op cijfers die niet live zijn. */
  isLive?: boolean;
  /** "compact" (38.4K) of "currency" (€ 4.2M, de opdracht-notatie). Default "compact". */
  format?: "compact" | "currency";
  suffix?: string;
  className?: string;
}

export function Counter({ value, label, isLive = false, format = "compact", suffix, className }: CounterProps) {
  // Een nieuwe key per waardewissel dwingt de CSS-animatie opnieuw af te spelen (React hermonteert
  // het element); zonder key blijft een lopende animatie gewoon lopen en "tickt" hij niet opnieuw.
  const [tickKey, setTickKey] = useState(0);
  const vorige = useRef(value);

  useEffect(() => {
    if (isLive && value !== vorige.current) setTickKey((k) => k + 1);
    vorige.current = value;
  }, [value, isLive]);

  const tekst = format === "currency" ? compactCurrency(value) : compactNumber(value);

  return (
    <div className={className}>
      <span
        key={tickKey}
        className={`teller-waarde block text-3xl font-bold ${isLive ? "teller-tick" : ""}`}
        style={isLive ? { color: "var(--terminal-accent, var(--color-brand-blue-ink))" } : undefined}
      >
        {tekst}
        {suffix}
      </span>
      <span className="mt-1 block text-meta font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
