"use client";

import { useMemo, useState } from "react";

// Fase 7, Task 2 (Blok 3, 'No Limits'): een indicatieve rekensom, geen harde belofte. De
// aannames staan met opzet zichtbaar in de UI in plaats van verstopt in de berekening -- een
// bezoeker die de schuifjes verzet moet kunnen zien WAAROM het antwoord verandert, en de
// codebase heeft eerder al een keer een ongefundeerde claim ("De #1 SEM specialist") verwijderd
// omdat hij als feit oogde zonder onderbouwing. Dezelfde regel geldt hier: dit is een schatting
// op basis van invoer van de bezoeker zelf, niet een gemeten statistiek.

const UUR_PER_ACCOUNT_PER_WEEK = 2.5;
const BESPARING_FRACTIE = 0.6;

interface Invoer {
  accounts: number;
  uurtarief: number;
}

function berekenBesparing({ accounts, uurtarief }: Invoer) {
  const urenPerWeek = accounts * UUR_PER_ACCOUNT_PER_WEEK * BESPARING_FRACTIE;
  const urenPerMaand = urenPerWeek * 4.33;
  const euroPerMaand = urenPerMaand * uurtarief;
  return { urenPerMaand, euroPerMaand };
}

export function RoiCalculator() {
  const [accounts, setAccounts] = useState(15);
  const [uurtarief, setUurtarief] = useState(65);

  const { urenPerMaand, euroPerMaand } = useMemo(
    () => berekenBesparing({ accounts, uurtarief }),
    [accounts, uurtarief],
  );

  const euroFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6" style={{ fontFamily: "var(--font-marketing-mono)" }}>
      <p className="text-xs uppercase tracking-[0.2em] text-off-white/50">Indicatieve berekening</p>

      <div className="mt-5 space-y-5">
        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Beheerde accounts</span>
            <span className="text-neon-indigo">{accounts}</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={accounts}
            onChange={(e) => setAccounts(Number(e.target.value))}
            className="mt-2 w-full accent-[#818cf8]"
          />
        </label>

        <label className="block">
          <div className="flex items-center justify-between text-sm text-off-white/80">
            <span>Uurtarief van je team</span>
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
          <p className="text-xs uppercase tracking-[0.15em] text-off-white/50">Waarde per maand</p>
          <p className="mt-1 text-2xl font-bold text-neon-indigo">{euroFmt.format(euroPerMaand)}</p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-off-white/40">
        Gebaseerd op {UUR_PER_ACCOUNT_PER_WEEK}u handmatige rapportage per account per week, waarvan Ctrl PPC
        naar schatting {Math.round(BESPARING_FRACTIE * 100)}% wegneemt. Een schatting op basis van jouw
        invoer, geen gemeten resultaat.
      </p>
    </div>
  );
}
