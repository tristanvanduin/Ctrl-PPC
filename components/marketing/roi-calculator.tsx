"use client";

import { useMemo, useState } from "react";

// Fase 7-upgrade: niet langer "willekeurige uren per account", maar het standaardpakket dat
// voor elke klant loopt: de 7 analyses (bid-strategy, budget-allocation, quality-score,
// impression-share, cross-channel, kpi-relations, monthly) plus de maandrapportage
// (client-reports/pdf). Elke regel is de tijd die een specialist daar naar schatting handmatig
// aan kwijt zou zijn -- niet een percentage van iets vaags. Extra analyses (diepe duiken,
// ad-hoc onderzoek) komen hier bovenop en tellen dus niet mee: dit is het MINIMUM, niet het
// plafond. Zelfde regel als eerder: de aannames staan zichtbaar in de UI, niet verstopt in de
// berekening.

interface Analyse {
  naam: string;
  minuten: number;
}

const STANDAARDPAKKET: Analyse[] = [
  { naam: "Maandanalyse", minuten: 90 },
  { naam: "Budget-allocatie", minuten: 30 },
  { naam: "Bod-strategie", minuten: 30 },
  { naam: "Quality Score", minuten: 20 },
  { naam: "Impression Share", minuten: 20 },
  { naam: "Kanaalsynergie", minuten: 40 },
  { naam: "KPI-verhoudingen", minuten: 30 },
  { naam: "Maandrapportage", minuten: 60 },
];

const MINUTEN_TOTAAL = STANDAARDPAKKET.reduce((som, a) => som + a.minuten, 0);
const UREN_PER_KLANT_PER_MAAND = MINUTEN_TOTAAL / 60;

interface Invoer {
  klanten: number;
  uurtarief: number;
}

function berekenBesparing({ klanten, uurtarief }: Invoer) {
  const urenPerMaand = UREN_PER_KLANT_PER_MAAND * klanten;
  const euroPerMaand = urenPerMaand * uurtarief;
  return { urenPerMaand, euroPerMaand };
}

export function RoiCalculator() {
  const [klanten, setKlanten] = useState(15);
  const [uurtarief, setUurtarief] = useState(65);
  const [toonPakket, setToonPakket] = useState(false);

  const { urenPerMaand, euroPerMaand } = useMemo(
    () => berekenBesparing({ klanten, uurtarief }),
    [klanten, uurtarief],
  );

  const euroFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <p className="text-xs uppercase tracking-[0.2em] text-off-white/50">Minimale maandelijkse besparing</p>

      <div className="mt-5 space-y-5">
        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Aantal klanten</span>
            <span className="text-neon-indigo">{klanten}</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={klanten}
            onChange={(e) => setKlanten(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
        </label>

        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Uurtarief van je specialist</span>
            <span className="text-neon-indigo">{euroFmt.format(uurtarief)}</span>
          </div>
          <input
            type="range"
            min={20}
            max={200}
            step={5}
            value={uurtarief}
            onChange={(e) => setUurtarief(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-off-white/10 pt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-off-white/50">Uren per maand</p>
          <p className="mt-1 text-2xl font-bold text-off-white">{urenPerMaand.toFixed(0)}u</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-off-white/50">Minimale waarde</p>
          <p className="mt-1 text-2xl font-bold text-neon-indigo">{euroFmt.format(euroPerMaand)}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setToonPakket((v) => !v)}
        className="mt-4 text-xs font-semibold text-off-white/50 underline hover:text-off-white"
      >
        {toonPakket ? "Verberg het standaardpakket" : `Waar komt ${UREN_PER_KLANT_PER_MAAND.toFixed(1)}u per klant vandaan?`}
      </button>

      {toonPakket && (
        <ul className="mt-3 space-y-1 border-t border-off-white/10 pt-3">
          {STANDAARDPAKKET.map((a) => (
            <li key={a.naam} className="flex items-center justify-between text-xs text-off-white/60">
              <span>{a.naam}</span>
              <span>{a.minuten} min</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-off-white/40">
        Dit zijn de 7 analyses die standaard voor elke klant draaien plus de maandrapportage, met een
        geschatte tijdsbesteding per stuk als een specialist ze handmatig zou doen. Extra analyses en
        diepe duiken zijn hierboven op mogelijk en tellen dus niet mee: dit is het minimum, geen
        plafond. Een schatting op basis van jouw invoer, geen gemeten resultaat.
      </p>
    </div>
  );
}
