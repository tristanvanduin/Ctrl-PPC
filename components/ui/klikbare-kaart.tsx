"use client";

import type { ReactNode } from "react";

// De klik-schil om een KPI-kaart die een grafiek eronder aanstuurt.
//
// Waarom dit een eigen component is en geen twee keer acht regels. De Google-kaartjes
// (metric-cards.tsx) waren klikbaar, de Meta/LinkedIn-kaartjes (channel-forecast-overview.tsx)
// niet -- terwijl ze naast elkaar dezelfde vier metrics tonen boven dezelfde soort grafiek. De
// eigenaar: "waarom is bij google het wel klikable en bij meta en linkedin niet? Voor de record,
// clickable is de way to go." Twee kopieën van dit gedrag zouden binnen een maand weer uit elkaar
// lopen op precies de dingen die je niet ziet tenzij je met een toetsenbord werkt: de rol, de
// tabvolgorde, of Enter en spatie allebei werken.
//
// `metricKey`/`onSelect` optioneel houden betekent dat dezelfde kaart ook zonder klikgedrag kan
// blijven bestaan (bijvoorbeeld in een rapport-export), zonder een tweede variant.
export function KlikbareKaart<T>({ waarde, geselecteerd, onKies, className = "", children }: {
  /** Wat er aan onKies wordt doorgegeven. Undefined = de kaart is niet klikbaar. */
  waarde?: T;
  geselecteerd?: boolean;
  onKies?: (waarde: T) => void;
  className?: string;
  children: ReactNode;
}) {
  const klikbaar = waarde !== undefined && onKies !== undefined;
  const kies = () => { if (klikbaar) onKies(waarde); };

  return (
    <div
      role={klikbaar ? "button" : undefined}
      tabIndex={klikbaar ? 0 : undefined}
      aria-pressed={klikbaar ? geselecteerd === true : undefined}
      onClick={klikbaar ? kies : undefined}
      onKeyDown={klikbaar ? (e) => {
        // Enter én spatie: een element met role="button" hoort op allebei te reageren, en een
        // <div> doet dat uit zichzelf op geen van beide. preventDefault houdt spatie tegen die
        // anders de pagina scrollt.
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kies(); }
      } : undefined}
      className={`bg-card rounded-xl border p-5 shadow-sm transition-colors ${
        klikbaar ? "cursor-pointer hover:border-brand-blue/40" : ""
      } ${geselecteerd ? "border-brand-blue ring-1 ring-brand-blue/30" : "border-border"} ${className}`}
    >
      {children}
    </div>
  );
}
