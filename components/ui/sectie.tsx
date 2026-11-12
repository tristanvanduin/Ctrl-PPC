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
      {/* flex-wrap: bij een brede `actie` (bv. vier campagnetype-knoppen) en weinig ruimte kon de
          titel/bijschrift-kolom (min-w-0) tot 0 breed uitgeknepen worden in plaats van dat de
          actie naar een eigen regel brak -- op een telefoonbreed scherm duwde dat de hele pagina
          breder. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 gap-y-2">
        {icoon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10">{icoon}</div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-brand-blue-ink">{titel}</h2>
          {bijschrift && <p className="text-xs text-muted-foreground">{bijschrift}</p>}
        </div>
        {actie && <div className="ml-auto shrink-0">{actie}</div>}
      </div>
      {/* Binnen een sectie staan de kaarten dichter op elkaar dan de secties onderling — én ze
          wegen niet allemaal even zwaar. De eerste kaart is het antwoord op de vraag die de
          sectiekop stelt; wat erna komt is de onderbouwing. `sectie-kaarten` zet daarom vanaf de
          tweede kaart een rustiger schaduw (zie globals.css). Dat werkt via een variabele, dus het
          erft ook door naar kaarten die dieper in een kind zitten. */}
      <div className="space-y-4 sectie-kaarten">{children}</div>
    </section>
  );
}

/**
 * Een kop bínnen een sectie: een onderwerp dat bij zijn buren hoort, maar een eigen vraag stelt.
 *
 * Waarom dit bestaat (bouwplan fase 2). De blokken met een vast venster (pacing, het jaaroverzicht,
 * de beurs) stonden verspreid over de pagina, elk onder een eigen sectiekop, met blokken ertussen
 * die de periodekiezer wel volgen. Ze staan nu bij elkaar onder één sectiekop; wat eerder een
 * sectie was, is daarbinnen een deel. De titel, het bijschrift en de keuzeknop blijven precies wat
 * ze waren, alleen een maat kleiner (h3 onder de h2 van de sectie) en met minder lucht erboven dan
 * een sectie: ze horen bij elkaar.
 *
 * `venster` is de plek voor het Vensterlabel van dit deel, als de kaarten eronder er zelf geen
 * dragen.
 */
export function Deelkop({ icoon, titel, bijschrift, actie, venster }: {
  icoon?: ReactNode;
  titel: string;
  bijschrift?: string;
  actie?: ReactNode;
  venster?: ReactNode;
}) {
  return (
    // pt-4: binnen `space-y-4` van de sectie staat een deelkop zo op 32 px van het vorige blok,
    // tussen de 16 px binnen een onderwerp en de 40 px tussen secties in.
    <div className="flex flex-wrap items-center gap-3 gap-y-2 pt-4">
      {icoon && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10">{icoon}</div>
      )}
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-title font-bold text-brand-blue-ink">
          {titel}
          {venster}
        </h3>
        {bijschrift && <p className="text-xs text-muted-foreground">{bijschrift}</p>}
      </div>
      {actie && <div className="ml-auto shrink-0">{actie}</div>}
    </div>
  );
}
