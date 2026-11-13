"use client";

// De kiesbare event-periodes van een klant, voor de periodekiezer van de nieuwe weergave.
//
// Uit de gedeelde client_settings-rij (lib/client-settings.ts), dezelfde die de beurs-editie en de
// KPI-band lezen: geen eigen verzoek ernaast. Null zolang de rij laadt; daarna een lijst, ook als
// die leeg is. Per klant bewaard, zodat na een klantwissel de events van de vorige niet meetellen.
//
// `herlees` is een waarde die verandert als de events opnieuw gelezen horen te worden (het
// klantdashboard geeft het tabblad mee: wie in Instellingen > Events een editie aanpast en terug
// naar het Overzicht gaat, ziet hem in de kiezer). Zolang de rij in de cache staat, kost dat niets;
// na het opslaan vergeet event-settings.tsx de rij, en dan komt de nieuwe.

import { useEffect, useState } from "react";
import { loadClientSettingsRij } from "@/lib/client-settings";
import { eventPeriodesUitRaiEvents, type EventPeriode } from "./event-periodes";

export function useEventPeriodes(clientId: string, aan: boolean, herlees?: unknown): readonly EventPeriode[] | null {
  const [geladen, setGeladen] = useState<{ clientId: string; events: EventPeriode[] } | null>(null);
  useEffect(() => {
    if (!aan) return;
    let weg = false;
    loadClientSettingsRij(clientId)
      .then(({ data }) => { if (!weg) setGeladen({ clientId, events: eventPeriodesUitRaiEvents(data?.rai_events) }); })
      .catch(() => { if (!weg) setGeladen({ clientId, events: [] }); });
    return () => { weg = true; };
  }, [clientId, aan, herlees]);
  return geladen?.clientId === clientId ? geladen.events : null;
}
