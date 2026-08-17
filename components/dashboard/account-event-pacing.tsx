"use client";

import { useState, useEffect } from "react";
import { CalendarClock, Info } from "lucide-react";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Kerncijfer } from "@/components/ui/kerncijfer";

// Fase 4: de generieke T-minus-pacing-widget, het niet-beurs-gebonden zusje van
// components/dashboard/event-pacing.tsx. Zelfde idee -- "dag X van het jaar" zegt niets voor
// een event, "hoe sta ik ervoor t.o.v. hetzelfde punt vóór de vorige editie" wel -- maar dan
// account-breed (alle kanalen samen) in plaats van gefilterd op één geo-clone/aftakking. Werkt
// voor elk event uit client_settings.rai_events, dus ook Black Friday of een sale-periode.

interface Pacing {
  eventId: string;
  eventName: string;
  daysToFair: number | null;
  currentEditionId: string | null;
  previousEditionId: string | null;
  comparable: boolean;
  currentCumulative: number | null;
  previousCumulative: number | null;
  deltaPct: number | null;
  costDeltaPct: number | null;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  actionNeeded: boolean;
  degradations: string[];
}

const fmt = (n: number | null): string => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n));
const pct = (r: number | null): string => (r == null || !Number.isFinite(r) ? "—" : `${r >= 0 ? "+" : ""}${Math.round(r * 100)}%`);

export function AccountEventPacing({ clientId, eventId, refreshKey }: { clientId: string; eventId: string; refreshKey?: number }) {
  const [data, setData] = useState<Pacing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    fetch(`/api/analysis/event-pacing?client_id=${encodeURIComponent(clientId)}&event_id=${encodeURIComponent(eventId)}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.pacing) setData(d.pacing as Pacing); else setError(d?.error ?? "Geen pacing beschikbaar"); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [clientId, eventId, refreshKey]);

  // Zoals event-pacing.tsx: kan de pacing niet berekend worden (nog geen edities opgeslagen,
  // geen data), toon dan niets in plaats van een storende foutmelding in het instellingenscherm.
  if (error) return null;
  if (!data) return <Laadvlak vorm="kaartjes" regels={3} />;

  const behind = data.comparable && data.deltaPct != null && data.deltaPct < -0.02;
  const ahead = data.comparable && data.deltaPct != null && data.deltaPct > 0.02;
  const effectivenessNote = behind && data.costDeltaPct != null && data.deltaPct != null && data.costDeltaPct >= data.deltaPct;

  return (
    <div className="rounded-lg border border-border bg-gray-50/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-brand-blue-ink" />
        <h4 className="text-meta font-semibold text-brand-gray uppercase tracking-wide">T-minus pacing</h4>
        {data.daysToFair != null && (
          <span className="ml-auto text-meta font-medium text-brand-blue-ink">
            T-{data.daysToFair} tot {data.eventName}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {!data.comparable ? (
          <div className="text-meta text-muted-foreground flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Nog niet vergelijkbaar met de vorige editie{data.previousEditionId ? ` (${data.previousEditionId})` : ""}:
              {data.degradations[0] ? ` ${data.degradations[0]}` : " te weinig vergelijkbare data op gelijke afstand tot de event-datum."}
              {" "}Opbouw tot nu: <strong>{fmt(data.currentCumulative)}</strong> conversies.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kerncijfer label="Opbouw tot nu" waarde={fmt(data.currentCumulative)} formaat="compact" onderschrift="conversies, alle kanalen" />
            <Kerncijfer
              label="Vorige editie op ditzelfde punt"
              waarde={fmt(data.previousCumulative)}
              formaat="compact"
              onderschrift={`${data.previousEditionId ?? "vorige editie"}, gelijke afstand`}
            />
            <Kerncijfer
              label="Pacing vs vorige editie"
              waarde={pct(data.deltaPct)}
              formaat="compact"
              toon={behind ? "waarschuwing" : ahead ? "goed" : undefined}
              onderschrift={behind ? "loopt achter" : ahead ? "loopt voor" : "op koers"}
            />
          </div>
        )}

        {data.target != null && (
          <p className="mt-2 text-meta text-muted-foreground">
            Projectie: <strong>{fmt(data.projectedFinal)}</strong> vs doel <strong>{fmt(data.target)}</strong>
            {data.projectedVsTargetPct != null && ` (${Math.round(data.projectedVsTargetPct * 100)}%, ${data.willHitTarget ? "haalt het doel" : "mist het doel"})`}.
          </p>
        )}

        {effectivenessNote && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-800">
            De aanloop ligt achter terwijl de spend gelijk of hoger is ({pct(data.costDeltaPct)}): een effectiviteitsvraag, geen budgetkwestie.
          </div>
        )}
      </div>
    </div>
  );
}
