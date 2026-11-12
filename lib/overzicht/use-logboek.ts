"use client";

// De lezer van het logboek in de browser: één verzoek per klant, vijf minuten bewaard.
//
// WAT EEN VERZOEK KOST EN WAT NIET. Het logboek komt bij het laden van het Overzicht één keer
// binnen (GET /api/overzicht/logboek). Een wissel van kanaal of periode raakt deze hook niet: het
// kanaal is een filter over dezelfde lijst (voorKanaal), en de periode gaat het logboek niet aan.
// Terug naar het Overzicht vanaf een ander tabblad binnen vijf minuten: uit de cache.
//
// Opnieuw lezen gebeurt alleen om een echte reden, via `herlees`: de blended route haalde opnieuw
// op (een sync, een opslag in Instellingen), of er begon een nieuw bezoek (terug op het tabblad na
// een lange pauze). De syncbadge leegt na een sync alle broncaches van de klant (vergeetBronnen),
// deze ook; de nieuwe ronde van de blended route laat de hook daarna opnieuw lezen.

import { useEffect, useState } from "react";
import { maakBronCache } from "@/lib/data-access/bron-cache";
import type { Logboek } from "./logboek";

const LOGBOEK_TTL = 5 * 60 * 1000;
const logboekCache = maakBronCache<Logboek>(LOGBOEK_TTL);
const sleutel = (clientId: string) => `${clientId}|logboek`;

/** Het logboek van een klant: uit de cache, van een lopend verzoek, of met één nieuw verzoek. */
export function laadLogboek(clientId: string): Promise<Logboek> {
  return logboekCache.lees(sleutel(clientId), async () => {
    const res = await fetch(`/api/overzicht/logboek?clientId=${encodeURIComponent(clientId)}`);
    const body = (await res.json().catch(() => null)) as (Logboek & { error?: string }) | null;
    if (!res.ok || !body || !Array.isArray(body.items)) {
      throw new Error(body?.error ?? `Het logboek kon niet geladen worden (HTTP ${res.status})`);
    }
    return body;
  });
}

export interface LogboekStand {
  logboek: Logboek | null;
  laadt: boolean;
  fout: string | null;
}

/**
 * @param aan Alleen lezen als het logboek getoond wordt (de nieuwe weergave).
 * @param herlees Een waarde die verandert als er opnieuw gelezen hoort te worden. Niet het kanaal
 *   en niet de periode.
 */
export function useLogboek(clientId: string, aan: boolean, herlees?: unknown): LogboekStand {
  const [stand, setStand] = useState<{ clientId: string; logboek: Logboek | null; fout: string | null } | null>(null);

  useEffect(() => {
    if (!aan) return;
    let levend = true;
    laadLogboek(clientId)
      .then((logboek) => { if (levend) setStand({ clientId, logboek, fout: null }); })
      // Bij een fout blijft de vorige lijst van DEZE klant staan: een mislukte verversing wist
      // niet wat er al te lezen was.
      .catch((e: unknown) => {
        if (!levend) return;
        const fout = e instanceof Error ? e.message : String(e);
        setStand((vorige) => ({ clientId, logboek: vorige?.clientId === clientId ? vorige.logboek : null, fout }));
      });
    return () => { levend = false; };
  }, [clientId, aan, herlees]);

  // De staat van een vorige klant telt niet; de cache wel (een tweede bezoek toont geen laadvlak).
  const eigen = stand?.clientId === clientId ? stand : null;
  const logboek = eigen?.logboek ?? (aan ? logboekCache.kijk(sleutel(clientId)) ?? null : null);
  return { logboek, laadt: aan && logboek === null && !eigen?.fout, fout: eigen?.fout ?? null };
}
