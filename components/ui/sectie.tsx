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
import { ChevronDown } from "lucide-react";
import { useRememberedOpen } from "./disclosure";

export function Sectie({
  icoon,
  titel,
  bijschrift,
  actie,
  children,
  eerste = false,
  inklapbaarId,
  standaardOpen = true,
}: {
  icoon?: ReactNode;
  titel: string;
  bijschrift?: string;
  /** Rechts uitgelijnd naast de kop: een keuzeknop die bij deze sectie hoort. */
  actie?: ReactNode;
  children: ReactNode;
  /** De eerste sectie van een pagina krijgt geen extra ruimte erboven. */
  eerste?: boolean;
  /**
   * Stabiele sleutel om deze sectie inklapbaar te maken, onthouden per gebruiker (net als
   * CollapsiblePanel). Zonder deze prop is een sectie altijd volledig open, zoals voorheen — een
   * sectie die zelf al het antwoord op een directe vraag is (bv. "wat wacht op je oordeel") hoort
   * dat te blijven.
   */
  inklapbaarId?: string;
  /** Alleen relevant met `inklapbaarId`: begint de sectie open of dicht. */
  standaardOpen?: boolean;
}) {
  const [open, toggle] = useRememberedOpen(inklapbaarId ?? titel, standaardOpen);
  const magInklappen = inklapbaarId != null;
  const isOpen = !magInklappen || open;

  return (
    <section className={eerste ? "" : "mt-10"}>
      <div
        className={`mb-4 flex items-center gap-3 ${magInklappen ? "cursor-pointer select-none" : ""}`}
        onClick={magInklappen ? toggle : undefined}
        role={magInklappen ? "button" : undefined}
        aria-expanded={magInklappen ? isOpen : undefined}
      >
        {icoon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10">{icoon}</div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-brand-blue-ink">{titel}</h2>
          {bijschrift && <p className="text-xs text-muted-foreground">{bijschrift}</p>}
        </div>
        {actie && <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>{actie}</div>}
        {magInklappen && (
          <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${actie ? "" : "ml-auto"} ${isOpen ? "rotate-180" : ""}`} />
        )}
      </div>
      {/* Binnen een sectie staan de kaarten dichter op elkaar dan de secties onderling — én ze
          wegen niet allemaal even zwaar. De eerste kaart is het antwoord op de vraag die de
          sectiekop stelt; wat erna komt is de onderbouwing. `sectie-kaarten` zet daarom vanaf de
          tweede kaart een rustiger schaduw (zie globals.css). Dat werkt via een variabele, dus het
          erft ook door naar kaarten die dieper in een kind zitten. */}
      {isOpen && <div className="space-y-4 sectie-kaarten">{children}</div>}
    </section>
  );
}
