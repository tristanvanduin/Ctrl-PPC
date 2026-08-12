"use client";

import { useCallback, useEffect, useState } from "react";

// Client-side ophaalhulp voor /api/adoptie/code-rood, gedeeld door het Today-paneel, de
// Agency-God-View en de per-klant dashboardbanner -- één plek die leest, drie plekken die tonen.

export interface CodeRoodMelding {
  id: string;
  clientId: string;
  clientNaam: string;
  licht: "amber" | "rood";
  redenen: string[];
  gedetecteerdOp: string;
  status: "open" | "geaccepteerd" | "afgewezen" | "opgelost";
  gereageerdOp: string | null;
}

interface Antwoord {
  meldingen: CodeRoodMelding[];
  magReageren: boolean;
  loading: boolean;
  error: string | null;
  reageer: (id: string, actie: "accepteren" | "afwijzen") => Promise<void>;
}

export function useCodeRoodMeldingen(): Antwoord {
  const [meldingen, setMeldingen] = useState<CodeRoodMelding[]>([]);
  const [magReageren, setMagReageren] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const laad = useCallback(async () => {
    try {
      const res = await fetch("/api/adoptie/code-rood");
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? `Fout ${res.status}`);
        return;
      }
      setMeldingen(json.meldingen ?? []);
      setMagReageren(Boolean(json.magReageren));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { laad(); }, [laad]);

  const reageer = useCallback(async (id: string, actie: "accepteren" | "afwijzen") => {
    // Optimistisch: de knop verdwijnt meteen, een mislukte poging herstelt via de herlaadde lijst.
    setMeldingen((prev) => prev.map((m) => (m.id === id ? { ...m, status: actie === "accepteren" ? "geaccepteerd" : "afgewezen" } : m)));
    const res = await fetch("/api/adoptie/code-rood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, actie }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `Fout ${res.status}`);
    }
    await laad();
  }, [laad]);

  return { meldingen, magReageren, loading, error, reageer };
}
