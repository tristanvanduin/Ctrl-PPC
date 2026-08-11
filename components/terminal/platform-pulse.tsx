"use client";

import { useEffect, useRef, useState } from "react";
import { Counter } from "@/components/ui/counter";

// Fase 5, Task 1: "Global Platform Pulse" -- vier platform-brede metrics onder de hero. Data komt
// van /api/public/platform-pulse (aggregaat-totalen, geen sessie nodig). De tick-animatie speelt
// pas als het blok daadwerkelijk in beeld scrolt (IntersectionObserver), niet meteen bij het
// laden van de pagina: Counter tickt op een VERANDERENDE waarde terwijl isLive aanstaat, dus de
// waarden starten op 0 en springen naar het echte cijfer zodra het blok zichtbaar wordt -- geen
// aftellende of oplopende "slot machine", één rustige opkomst per cijfer.

interface Pulse {
  adSpendOptimized: number;
  hypothesesTested: number;
  analysesRun: number;
  activeClients: number;
}

const LEEG: Pulse = { adSpendOptimized: 0, hypothesesTested: 0, analysesRun: 0, activeClients: 0 };

export function PlatformPulse() {
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

  const getoond = visible && data ? data : LEEG;

  return (
    <div ref={ref} className="terminal grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Counter value={getoond.adSpendOptimized} label="Ad spend optimized" format="currency" isLive />
      <Counter value={getoond.hypothesesTested} label="Hypotheses tested" isLive />
      <Counter value={getoond.analysesRun} label="Analyses run" isLive />
      <Counter value={getoond.activeClients} label="Active clients" isLive />
    </div>
  );
}
