"use client";

// Het ritme van een pagina.
//
// De Overzicht-pagina was dertien kaarten onder elkaar met overal dezelfde `space-y-6`. Elke
// afstand gelijk betekent dat niets groepeert: de kaart over videoplacements staat even ver van
// de kaart over PMax als van de jaarprognose, terwijl de eerste twee bij elkaar horen en de derde
// een ander onderwerp is. De lezer krijgt geen structuur aangereikt en moet er zelf een maken —
// en dat is, naast het ontbreken van schaalcontrast, wat een pagina als een spreadsheet laat lezen.
//
// Ritme is niet "meer witruimte". Het is óngelijke witruimte: veel tussen onderwerpen, weinig
// binnen een onderwerp. Pas door dat verschil ontstaan er groepen, en pas dan kun je een pagina
// scannen in plaats van hem regel voor regel af te lopen.
//
// De verhouding hier is ongeveer 2,5 : 1 — veertig pixels tussen secties, zestien binnen een
// sectie. Genoeg om als scheiding te lezen, niet zoveel dat de pagina uit elkaar valt.

import type { ReactNode } from "react";

export function Sectie({
  icoon,
  titel,
  bijschrift,
  actie,
  children,
  eerste = false,
}: {
  icoon?: ReactNode;
  titel: string;
  bijschrift?: string;
  /** Rechts uitgelijnd naast de kop: een keuzeknop die bij deze sectie hoort. */
  actie?: ReactNode;
  children: ReactNode;
  /** De eerste sectie van een pagina krijgt geen extra ruimte erboven. */
  eerste?: boolean;
}) {
  return (
    <section className={eerste ? "" : "mt-10"}>
      <div className="mb-4 flex items-center gap-3">
        {icoon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rm-blue/10">{icoon}</div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-rm-blue-ink">{titel}</h2>
          {bijschrift && <p className="text-xs text-muted-foreground">{bijschrift}</p>}
        </div>
        {actie && <div className="ml-auto shrink-0">{actie}</div>}
      </div>
      {/* Binnen een sectie staan de kaarten dichter op elkaar dan de secties onderling. */}
      <div className="space-y-4">{children}</div>
    </section>
  );
}
