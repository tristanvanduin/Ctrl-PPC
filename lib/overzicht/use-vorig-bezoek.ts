"use client";

// De hook bij het ijkpunt "sinds je vorige bezoek". De regels staan in lib/overzicht/bezoek.ts.
//
// De stand komt in een effect binnen en niet in de eerste render: de server kent localStorage
// niet, en een eerste render die ervan afhangt geeft een andere boom dan de server stuurde. Tot
// dan is `bekend` false en markeert het logboek niets.

import { useEffect, useState } from "react";
import { bezoekSleutel, leesBezoek, openBezoek, sluitBezoek } from "./bezoek";

export interface VorigBezoek {
  /** Het einde van het vorige bezoek, ISO; null bij het eerste bezoek of zolang het onbekend is. */
  ijkpunt: string | null;
  /** De opslag is gelezen. */
  bekend: boolean;
  /** Er is geen vorig bezoek om mee te vergelijken. */
  eerste: boolean;
  /** Telt op bij elk nieuw bezoek in dit tabblad (terugkomen na een lange pauze): het logboek
   *  leest dan opnieuw. Een wissel van kanaal of periode verandert hem niet. */
  bezoek: number;
}

function lees(sleutel: string): string | null {
  try { return window.localStorage.getItem(sleutel); } catch { return null; }
}
function schrijf(sleutel: string, waarde: string): void {
  try { window.localStorage.setItem(sleutel, waarde); } catch { /* geen opslag: dan is elk bezoek het eerste */ }
}

export function useVorigBezoek(clientId: string): VorigBezoek {
  const [stand, setStand] = useState<{ clientId: string; ijkpunt: string | null; eerste: boolean; bezoek: number } | null>(null);

  useEffect(() => {
    const sleutel = bezoekSleutel(clientId);
    const open = () => {
      const uit = openBezoek(leesBezoek(lees(sleutel)), new Date().toISOString());
      schrijf(sleutel, JSON.stringify(uit.stand));
      setStand((vorige) => {
        const zelfde = vorige?.clientId === clientId;
        // Niets veranderd (hetzelfde bezoek, hetzelfde ijkpunt): dezelfde staat, geen render.
        if (zelfde && !uit.nieuwBezoek && vorige.ijkpunt === uit.stand.ijkpunt) return vorige;
        return { clientId, ijkpunt: uit.stand.ijkpunt, eerste: uit.eerste, bezoek: (zelfde ? vorige.bezoek : 0) + (zelfde && uit.nieuwBezoek ? 1 : 0) };
      });
    };
    const sluit = () => schrijf(sleutel, JSON.stringify(sluitBezoek(leesBezoek(lees(sleutel)), new Date().toISOString())));
    const opZicht = () => { if (document.visibilityState === "hidden") sluit(); else open(); };

    open();
    document.addEventListener("visibilitychange", opZicht);
    window.addEventListener("pagehide", sluit);
    return () => {
      document.removeEventListener("visibilitychange", opZicht);
      window.removeEventListener("pagehide", sluit);
      // Weg van deze klant (een andere klant, een andere pagina): hier eindigt het kijken.
      sluit();
    };
  }, [clientId]);

  const eigen = stand?.clientId === clientId ? stand : null;
  return { ijkpunt: eigen?.ijkpunt ?? null, bekend: eigen !== null, eerste: eigen?.eerste ?? false, bezoek: eigen?.bezoek ?? 0 };
}
