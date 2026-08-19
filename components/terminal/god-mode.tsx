"use client";

import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Crown } from "lucide-react";
import { Counter } from "@/components/ui/counter";
import { compactCurrency, compactNumber } from "@/lib/format/compact-number";
import type { GodModeRow } from "@/app/api/platform/god-mode/route";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_GOD_MODE_DATA } from "@/lib/demo/god-view-demo";

// Fase 5, Task 3: God Mode -- de startpagina voor platform-brede scope (zie app/vandaag/page.tsx
// voor de rolcheck; deze component doet zelf GEEN autorisatie, dat is /api/admin/god-mode's
// server-side taak). Ongefilterde top10/bottom10 en de volledige rauwe lijst, gevirtualiseerd
// zodat een groeiend platform (5000+ accounts) evengoed 60fps blijft scrollen.

interface GodModeData {
  month: string;
  accountCount: number;
  top10: GodModeRow[];
  bottom10: GodModeRow[];
  all: GodModeRow[];
}

function Ranglijst({ titel, rows }: { titel: string; rows: GodModeRow[] }) {
  return (
    <div className="terminal rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-title font-semibold text-brand-gray">{titel}</h3>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={r.clientId} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-body hover:bg-[var(--terminal-accent-soft,rgba(0,0,0,0.03))]">
            <span className="teller-waarde w-6 shrink-0 text-meta text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-brand-gray">{r.name}</span>
            <span className="teller-waarde shrink-0 font-semibold" style={{ color: "var(--terminal-accent, var(--color-brand-blue-ink))" }}>
              {compactCurrency(r.spend)}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-meta text-muted-foreground">Geen data voor deze maand.</p>}
      </div>
    </div>
  );
}

// Rauwe, ongefilterde tabel van ALLE accounts. Gevirtualiseerd: alleen de zichtbare rijen (plus
// een kleine marge) staan in de DOM, dus dit blijft even snel bij 71 accounts als bij 5000+.
function RaweTabel({ rows }: { rows: GodModeRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  return (
    <div className="terminal rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-title font-semibold text-brand-gray">Alle accounts ({rows.length}), ongefilterd</h3>
      <div className="mb-1.5 grid grid-cols-[1fr_auto_auto_auto] gap-3 px-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Klant</span>
        <span className="text-right">Spend</span>
        <span className="text-right">Conversies</span>
        <span className="text-right">ROAS</span>
      </div>
      <div ref={parentRef} className="max-h-[420px] overflow-y-auto border-t border-border">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const r = rows[item.index];
            return (
              <div
                key={r.clientId}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-2 text-body"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span className="truncate text-brand-gray">{r.name}</span>
                <span className="teller-waarde text-right">{compactCurrency(r.spend)}</span>
                <span className="teller-waarde text-right">{compactNumber(r.conversions)}</span>
                <span className="teller-waarde text-right">{r.roas != null ? `${r.roas}x` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function GodMode() {
  const [data, setData] = useState<GodModeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Demo-modus: geen echte sessie, dus /api/platform/god-mode zou altijd 401/403 geven (die
    // route leest echte Supabase-auth-cookies, geen ?demo=1). Statische, veilige demo-data
    // i.p.v. de fetch -- zie lib/demo/god-view-demo.ts voor de reden.
    if (isDemoMode()) { setData(DEMO_GOD_MODE_DATA); return; }
    let cancelled = false;
    fetch("/api/platform/god-mode")
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.error) setError(d.error); else setData(d as GodModeData); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-blue-ink" />
      </div>
    );
  }

  const totalSpend = data.all.reduce((s, r) => s + r.spend, 0);
  const totalConversions = data.all.reduce((s, r) => s + r.conversions, 0);

  return (
    <div className="terminal space-y-6">
      {isDemoMode() && (
        <div className="flex items-center gap-2 text-xs text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-lg px-3 py-1.5">
          Demodata — fictieve accounts, geen live koppeling
        </div>
      )}
      <div className="flex items-center gap-2">
        <Crown className="h-5 w-5" style={{ color: "var(--terminal-accent, var(--color-brand-blue-ink))" }} />
        <h1 className="text-page font-bold text-brand-blue-ink">God Mode</h1>
        <span className="text-meta text-muted-foreground">platform-breed · {data.month.slice(0, 7)}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Counter value={totalSpend} label="Totale spend" format="currency" isLive />
        <Counter value={totalConversions} label="Conversies" isLive />
        <Counter value={data.accountCount} label="Actieve accounts" isLive />
        <Counter value={data.top10[0]?.roas ?? 0} label="Hoogste ROAS" suffix="x" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Ranglijst titel="Top 10 · spend" rows={data.top10} />
        <Ranglijst titel="Bottom 10 · spend" rows={data.bottom10} />
      </div>

      <RaweTabel rows={data.all} />
    </div>
  );
}
