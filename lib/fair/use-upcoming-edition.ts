"use client";

import { useEffect, useMemo, useState } from "react";
import { loadClientSettingsRij } from "@/lib/client-settings";
import { today } from "@/lib/reporting-date";
import { NASLEEP_WEKEN, selectActiveEdition, type FairEventCfg, type UpcomingEdition } from "./fair-weeks";

// Leest de beurzen van de klant (client_settings.rai_events, migratie 024) en bepaalt over welke
// editie de pagina gaat: de aankomende, of de vorige zolang die in zijn nasleep zit. Eén plek,
// zodat de hero, de sectiekop en de prestatiekaart hetzelfde antwoord gebruiken en niet allebei
// apart gaan ophalen.
//
// De gekozen beurs (?geo= / GeoCloneScope) gaat mee. Zonder die parameter stond in de hero
// "Beurs: GreenTech Americas" naast de aftelling van welke ingestelde beurs toevallig de
// eerstvolgende was. De events worden één keer per klant geladen; wisselen van beurs kiest
// opnieuw uit wat er al is, zonder nieuw verzoek. En die ene keer is de gedeelde client_settings-rij
// (lib/client-settings.ts): dezelfde rij die de provider en de KPI-band lezen, dus geen eigen
// select rai_events meer naast hun verzoek.
//
// Null betekent: deze klant (of de gekozen beurs) stuurt niet op een beurs — geen events, geen
// event met die afkorting, of een cadans waaruit geen volgende datum te bepalen valt. De
// kalenderweergave blijft dan gewoon staan.

export function useUpcomingEdition(clientId: string, selectedGeo: string | null = null): UpcomingEdition | null {
  // Met de klant erbij opgeslagen: bij een klantwissel tellen de events van de vorige klant niet
  // meer, ook niet in de render vóór het nieuwe antwoord binnen is.
  const [geladen, setGeladen] = useState<{ clientId: string; events: FairEventCfg[] | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadClientSettingsRij(clientId)
      .then(({ data }) => {
        if (cancelled) return;
        const ev = (data?.rai_events as { events?: FairEventCfg[] } | null)?.events;
        setGeladen({ clientId, events: Array.isArray(ev) && ev.length > 0 ? ev : null });
      });
    return () => { cancelled = true; };
  }, [clientId]);

  const events = geladen?.clientId === clientId ? geladen.events : null;

  // De datum als string in de afhankelijkheden: na middernacht (Amsterdam) kiest de volgende
  // render opnieuw, zonder dat het object elke render nieuw is.
  const vandaag = today();
  return useMemo(
    () => (events ? selectActiveEdition(events, vandaag, { selectedGeo, nasleepWeken: NASLEEP_WEKEN }) : null),
    [events, vandaag, selectedGeo],
  );
}
