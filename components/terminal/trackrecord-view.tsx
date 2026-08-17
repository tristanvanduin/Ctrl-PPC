"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Fase 4 (docs/MASTERPLAN.md sectie 9), punt 5: het trackrecordscherm uit sectie 3.3 --
// "Ctrl PPC publiceert zijn eigen trackrecord." Leest app/api/insights/trackrecord/route.ts
// (agency_memory_events, niet sprint_hypotheses rechtstreeks: dit scherm toont GESCHIEDENIS,
// niet de huidige status van losse hypotheses -- dat doet het Hypothesis Board al ernaast).

interface TrackrecordTotals {
  proposed: number;
  accepted: number;
  rejected: number;
  executed: number;
  notExecuted: number;
  outcomeMet: number;
  outcomeMissed: number;
  unmeasurable: number;
  expired: number;
}

interface TrackrecordSource {
  source: string;
  proposed: number;
  met: number;
  missed: number;
  hitRate: number | null;
}

interface TrackrecordRejection {
  hypothesis: string;
  reason: string;
  createdAt: string;
}

interface TrackrecordPayload {
  totals: TrackrecordTotals;
  hitRate: number | null;
  bySource: TrackrecordSource[];
  recentRejections: TrackrecordRejection[];
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function formatWanneer(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="terminal rounded-lg border border-border bg-card p-3">
      <div className="teller-waarde text-page font-bold text-brand-blue-ink">{value}</div>
      <div className="text-micro text-muted-foreground">{label}</div>
    </div>
  );
}

export function TrackrecordView({ clientId }: { clientId: string }) {
  const [data, setData] = useState<TrackrecordPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/insights/trackrecord?client_id=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload.error) { setError(payload.error); return; }
        setData(payload as TrackrecordPayload);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!data) {
    return (
      <div className="terminal flex items-center justify-center rounded-xl border border-border bg-card p-8">
        <Loader2 className="h-4 w-4 animate-spin text-brand-blue-ink" />
      </div>
    );
  }

  const { totals, hitRate, bySource, recentRejections } = data;
  const evaluated = totals.outcomeMet + totals.outcomeMissed;
  const geenGeschiedenis = totals.proposed === 0;

  return (
    <div className="terminal space-y-4">
      {geenGeschiedenis ? (
        <div className="rounded-xl border border-border bg-muted px-4 py-3 text-body text-muted-foreground">
          Nog geen geschiedenis voor dit account — het trackrecord vult zich naarmate er
          voorstellen gedaan, geaccepteerd en geëvalueerd worden.
        </div>
      ) : (
        <p className="text-body text-brand-gray leading-relaxed">
          Van de <strong>{totals.proposed}</strong> hypotheses die voorgesteld zijn, zijn er{" "}
          <strong>{totals.executed}</strong> uitgevoerd.
          {evaluated > 0 && (
            <>
              {" "}Daarvan haalden er <strong>{totals.outcomeMet}</strong> van de {evaluated} de voorspelde
              uitkomst — een trefpercentage van <strong>{pct(hitRate)}</strong>.
            </>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Voorgesteld" value={totals.proposed} />
        <StatTile label="Geaccepteerd" value={totals.accepted} />
        <StatTile label="Uitgevoerd" value={totals.executed} />
        <StatTile label="Trefpercentage" value={pct(hitRate)} />
      </div>

      {bySource.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-meta font-semibold text-brand-blue-ink">Per bron</h3>
          <p className="mb-3 text-micro text-muted-foreground">
            Uitgesplitst naar waar de hypothese vandaan kwam — de fijnste indeling die vandaag
            echt bestaat, niet gegokt op een signaaltype.
          </p>
          <div className="space-y-1.5">
            {bySource.map((s) => (
              <div key={s.source} className="flex items-center justify-between gap-3 text-body">
                <span className="text-brand-gray">{s.source}</span>
                <span className="teller-waarde text-micro text-muted-foreground">
                  {s.met + s.missed > 0 ? `${s.met} van ${s.met + s.missed} raak (${pct(s.hitRate)})` : `${s.proposed} voorgesteld, nog niet geëvalueerd`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentRejections.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-meta font-semibold text-brand-blue-ink">Recent afgewezen</h3>
          <div className="space-y-2">
            {recentRejections.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted p-2.5">
                <p className="text-body text-brand-gray leading-snug">{r.hypothesis}</p>
                <p className="mt-1 text-micro text-muted-foreground">
                  {formatWanneer(r.createdAt)} — {r.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
