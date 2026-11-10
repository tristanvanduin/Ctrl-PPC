"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccess } from "@/lib/auth/use-access";

// Client-side ophaalhulp voor /api/adoptie/code-rood, gedeeld door het Today-paneel, het dossier,
// de per-klant dashboardbanner en de zijbalk -- één plek die leest, vier plekken die tonen.
//
// ÉÉN VERZOEK, EN ALLEEN MET EEN SESSIE
//
// De zijbalk en de banner mounten tegelijk en deden elk een eigen fetch. Nu staat het lopende of
// bewaarde verzoek op module-niveau (zelfde patroon als `onderweg` in lib/use-blended-client-data.ts):
// de tweede mount wacht op het eerste. En de route zit achter requireCapability("client:read"),
// die zonder sessie altijd 401 geeft, ongeacht O1_AUTH_ENFORCED -- dus zonder sessie (useAccess
// zegt ingelogd: false) wordt er helemaal niet gevraagd. Dat verandert niets aan wat een
// ingelogde gebruiker ziet: met sessie komt dezelfde lijst, nu één keer.

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

interface Lijst {
  meldingen: CodeRoodMelding[];
  magReageren: boolean;
}

// Vijf minuten, zoals de datacaches: de meldingen komen uit een nachtelijke detectiejob, en een
// klantwissel (de banner mount opnieuw) hoeft de lijst niet opnieuw te halen. Na een reactie wordt
// hij meteen vergeten en vers gelezen.
const CACHE_TTL = 5 * 60 * 1000;
let bewaard: { verzoek: Promise<Lijst>; timestamp: number } | null = null;
// Elke gemounte hook die de lijst toont. Na een reactie in de banner herleest ook de zijbalk,
// zodat een zojuist geaccepteerde rood-melding daar meteen zijn eigen map krijgt.
const luisteraars = new Set<() => Promise<void>>();

function haal(): Promise<Lijst> {
  if (bewaard && Date.now() - bewaard.timestamp < CACHE_TTL) return bewaard.verzoek;
  const eigen = {
    verzoek: fetch("/api/adoptie/code-rood")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? `Fout ${res.status}`);
        return { meldingen: (json.meldingen ?? []) as CodeRoodMelding[], magReageren: Boolean(json.magReageren) };
      }),
    timestamp: Date.now(),
  };
  bewaard = eigen;
  // Een fout blijft niet vijf minuten hangen: de volgende mount probeert opnieuw.
  eigen.verzoek.catch(() => { if (bewaard === eigen) bewaard = null; });
  return eigen.verzoek;
}

export function useCodeRoodMeldingen(): Antwoord {
  const { loading: toegangLaadt, ingelogd } = useAccess();
  const [meldingen, setMeldingen] = useState<CodeRoodMelding[]>([]);
  const [magReageren, setMagReageren] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const laad = useCallback(async () => {
    try {
      const lijst = await haal();
      setMeldingen(lijst.meldingen);
      setMagReageren(lijst.magReageren);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (toegangLaadt) return;
    // Zonder sessie is er niets te halen (zie de kop): klaar, zonder meldingen en zonder fout.
    if (!ingelogd) { setLoading(false); return; }
    laad();
    luisteraars.add(laad);
    return () => { luisteraars.delete(laad); };
  }, [toegangLaadt, ingelogd, laad]);

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
    // De bewaarde lijst is nu verouderd: iedereen die hem toont leest dezelfde verse ronde.
    bewaard = null;
    const ronde = [...luisteraars];
    if (!ronde.includes(laad)) ronde.push(laad);
    await Promise.all(ronde.map((l) => l()));
  }, [laad]);

  return { meldingen, magReageren, loading, error, reageer };
}
