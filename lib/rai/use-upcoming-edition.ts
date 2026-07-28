"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { today } from "@/lib/reporting-date";
import { selectUpcomingEdition, type RaiEventCfg, type UpcomingEdition } from "./fair-weeks";

// Leest de beurzen van de klant (client_settings.rai_events, migratie 024) en bepaalt welke
// editie de eerstvolgende is. Één plek, zodat de sectiekop en de prestatiekaart hetzelfde
// antwoord gebruiken en niet allebei apart gaan ophalen.
//
// Null betekent: deze klant stuurt niet op een beurs (geen events, of een cadans waaruit geen
// volgende datum te bepalen valt). De kalenderweergave blijft dan gewoon staan.

export function useUpcomingEdition(clientId: string): UpcomingEdition | null {
  const [edition, setEdition] = useState<UpcomingEdition | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let cancelled = false;
    setEdition(null);
    sb.from("client_settings").select("rai_events").eq("client_id", clientId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const events = (data?.rai_events as { events?: RaiEventCfg[] } | null)?.events;
        if (!Array.isArray(events) || events.length === 0) return;
        setEdition(selectUpcomingEdition(events, today()));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  return edition;
}
