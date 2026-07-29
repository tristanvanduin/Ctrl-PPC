"use client";

// De licht/donker-schakelaar.
//
// Drie standen en niet twee: licht, donker, en "volg het systeem". Die derde is de standaard, en
// hij is het belangrijkst — wie zijn laptop 's avonds op donker zet verwacht niet dat één tabblad
// wit blijft branden. Een schakelaar met alleen aan/uit dwingt zo iemand elke keer opnieuw te
// kiezen, of legt een keuze vast die hij nooit bewust gemaakt heeft.
//
// De keuze staat in localStorage en niet in de database: het is een eigenschap van dit scherm, niet
// van deze klant. Dezelfde gebruiker op een tweede scherm mag een andere voorkeur hebben.

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

export type Thema = "licht" | "donker" | "systeem";

const SLEUTEL = "rai-thema";

/** Leest de opgeslagen voorkeur. Buiten de browser (SSR) bestaat die niet: dan "systeem". */
function gekozenThema(): Thema {
  if (typeof window === "undefined") return "systeem";
  const v = window.localStorage.getItem(SLEUTEL);
  return v === "licht" || v === "donker" ? v : "systeem";
}

/**
 * Zet of haalt de `dark`-klasse op het wortelelement. Alle kleuren hangen aan die ene klasse, dus
 * dit is het enige wat er hoeft te gebeuren om het hele dashboard om te zetten.
 */
export function pasThemaToe(thema: Thema): void {
  const donker = thema === "donker" || (thema === "systeem" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", donker);
  document.documentElement.style.colorScheme = donker ? "dark" : "light";
}

const OPTIES: { id: Thema; label: string; icoon: React.ReactNode }[] = [
  { id: "licht", label: "Licht", icoon: <Sun className="w-3.5 h-3.5" aria-hidden /> },
  { id: "systeem", label: "Systeem", icoon: <Monitor className="w-3.5 h-3.5" aria-hidden /> },
  { id: "donker", label: "Donker", icoon: <Moon className="w-3.5 h-3.5" aria-hidden /> },
];

export function ThemaSchakelaar({ className = "" }: { className?: string }) {
  // Begin op "systeem" en lees de voorkeur pas na de eerste render: de server weet niet wat er in
  // localStorage staat, en een andere beginwaarde zou een hydratatieverschil geven.
  const [thema, setThema] = useState<Thema>("systeem");
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    setThema(gekozenThema());
    setGeladen(true);
  }, []);

  useEffect(() => {
    if (!geladen) return;
    pasThemaToe(thema);
    if (thema === "systeem") window.localStorage.removeItem(SLEUTEL);
    else window.localStorage.setItem(SLEUTEL, thema);
  }, [thema, geladen]);

  // Staat de voorkeur op "systeem", dan moet een wijziging in het besturingssysteem meteen
  // doorwerken — anders klopt "volg het systeem" alleen op het moment dat je de pagina laadt.
  useEffect(() => {
    if (thema !== "systeem") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const luister = () => pasThemaToe("systeem");
    mq.addEventListener("change", luister);
    return () => mq.removeEventListener("change", luister);
  }, [thema]);

  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 ${className}`} role="group" aria-label="Kleurthema">
      {OPTIES.map((o) => {
        const actief = thema === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setThema(o.id)}
            aria-pressed={actief}
            title={o.label}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-micro font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rm-blue ${
              actief ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {o.icoon}
            <span className="sr-only sm:not-sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Het scriptje dat vóór de eerste verf draait.
 *
 * Zonder dit laadt de pagina in het licht en klapt hij een fractie later om — een witte flits op
 * een donker scherm, en dat is precies het moment waarop een product er goedkoop uitziet. Het moet
 * dus synchroon in de `head`, vóór React, en daarom als string.
 */
export const THEMA_INIT_SCRIPT = `(function(){try{
  var v=localStorage.getItem(${JSON.stringify(SLEUTEL)});
  var d=v==="donker"||(v!=="licht"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  if(d){document.documentElement.classList.add("dark");}
  document.documentElement.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
