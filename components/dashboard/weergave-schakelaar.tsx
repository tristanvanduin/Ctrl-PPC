"use client";

// De schakelaar "Nieuwe weergave", rechtsboven op het Overzicht (bouwplan fase 3 en 6).
//
// Klein en in beide weergaven op dezelfde plek: wie hem aanzet, moet hem ook weer kunnen vinden om
// terug te gaan. De keuze zelf (per gebruiker, standaard uit, ?weergave= als voorrang) staat in
// lib/weergave.ts; dit is alleen de knop.

import type { Weergave } from "@/lib/weergave";

export function WeergaveSchakelaar({ weergave, onKies, compactOpTelefoon = false }: {
  weergave: Weergave;
  onKies: (w: Weergave) => void;
  /** Toon op een telefoon alleen het schuifje; het label blijft er voor schermlezers. Voor de
   *  merkregel van de nieuwe weergave, waar naast de naam en de aftelling geen ruimte is. */
  compactOpTelefoon?: boolean;
}) {
  const aan = weergave === "nieuw";
  return (
    <button
      type="button"
      // Een schakelaar en geen drukknop: hij heeft twee standen, en "aan" is wat een schermlezer
      // hoort te zeggen. De naam blijft "Nieuwe weergave", in beide standen.
      role="switch"
      aria-checked={aan}
      title={aan ? "Terug naar de vertrouwde weergave van het Overzicht" : "Probeer de nieuwe bovenkant van het Overzicht: kanaalkaarten, tegels en de hoofdgrafiek"}
      onClick={() => onKies(aan ? "oud" : "nieuw")}
      className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-meta text-muted-foreground transition-colors hover:text-brand-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink"
    >
      <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${aan ? "bg-brand-blue" : "bg-muted-foreground/40"}`}>
        <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${aan ? "translate-x-3" : "translate-x-0"}`} />
      </span>
      <span className={compactOpTelefoon ? "sr-only sm:not-sr-only" : undefined}>Nieuwe weergave</span>
    </button>
  );
}
