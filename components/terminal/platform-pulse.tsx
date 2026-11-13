"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Counter } from "@/components/ui/counter";
import { LEGE_PULSE, pulseTonen, type Pulse } from "@/lib/marketing/platform-pulse";

// Fase 5, Task 1: "Global Platform Pulse" -- vier platform-brede metrics onder de hero. Data komt
// van /api/public/platform-pulse (aggregaat-totalen, geen sessie nodig). De tick-animatie speelt
// pas als het blok daadwerkelijk in beeld scrolt (IntersectionObserver), niet meteen bij het
// laden van de pagina: Counter tickt op een VERANDERENDE waarde terwijl isLive aanstaat, dus de
// waarden starten op 0 en springen naar het echte cijfer zodra het blok zichtbaar wordt -- geen
// aftellende of oplopende "slot machine", één rustige opkomst per cijfer.
//
// Het hele blok, met de kop, staat er alleen als er iets waars te tellen is (pulseTonen): zonder
// actieve klant stond hier "0 active clients" naast "Not simulated", en daarvoor 70 accounts die
// sinds april niet gesynct waren (lib/marketing/platform-pulse.ts).

export function PlatformPulse({ kop, ruimteOnder }: {
  /** De kop en de ondertitel boven de tellers; verdwijnt mee als het blok verdwijnt. */
  kop?: ReactNode;
  /**
   * De ruimte onder het blok (een padding-klasse). Hier en niet op de sectie eromheen: daar bleef
   * zonder tellers een lege band van 64 px op de homepage staan.
   */
  ruimteOnder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<Pulse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/platform-pulse")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && !d?.error) setData(d as Pulse); })
      .catch(() => { /* stil: de hero blijft prima staan zonder de Pulse-cijfers */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const getoond = visible && data ? data : LEGE_PULSE;

  // Nog niets binnen, of niets om te tonen: geen blok. De buitenste div blijft staan (zonder hoogte
  // als hij leeg is), want daar kijkt de IntersectionObserver naar; die hangt hij één keer op.
  const tonen = pulseTonen(data);
  return (
    <div ref={ref}>
      {tonen && (
        <div className={ruimteOnder}>
          {kop}
          <div
            className="terminal rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/60 p-6 backdrop-blur-sm"
            style={{ boxShadow: "0 0 40px rgba(0, 0, 0, 0.25)" }}
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Counter value={getoond.adSpendOptimized} label="Ad spend optimized" format="currency" isLive />
              <Counter value={getoond.hypothesesTested} label="Hypotheses tested" isLive />
              <Counter value={getoond.analysesRun} label="Analyses run" isLive />
              <Counter value={getoond.activeClients} label="Active clients (synced in the last 7 days)" isLive />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
