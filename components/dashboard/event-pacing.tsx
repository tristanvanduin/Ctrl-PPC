"use client";

import { useState, useEffect } from "react";
import { CalendarClock, Info } from "lucide-react";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Kerncijfer } from "@/components/ui/kerncijfer";

// Event-relatieve pacing: voor een beurs is "dag X van 365" zinloos. Wat telt is de opbouw tot NU
// afgezet tegen HETZELFDE punt vóór de vorige editie (op gelijke afstand tot de beursdag,
// cadans-bewust). Loop je vóór of achter t.o.v. de vorige keer? Deze widget toont dat altijd-live
// (draait de deterministische geo-clone-analyse via ?live=1), zonder dat je een knop hoeft te
// klikken. De rekenkern zit in lib/fair; dit is puur de uitlezing.

interface Pacing {
  geoClone: string;
  fairLabel: string;
  daysToFair: number | null;
  currentEditionId: string | null;
  previousEditionId: string | null;
  comparable: boolean;
  currentCumulative: number | null;
  previousCumulative: number | null;
  deltaPct: number | null;
  costDeltaPct: number | null;
  actionNeeded: boolean;
  degradations: string[];
}

const fmt = (n: number | null): string => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n));
const pct = (r: number | null): string => (r == null || !Number.isFinite(r) ? "—" : `${r >= 0 ? "+" : ""}${Math.round(r * 100)}%`);

export function EventPacing({ clientId, geoClone }: { clientId: string; geoClone: string }) {
  const [data, setData] = useState<Pacing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    fetch(`/api/analysis/geo-clone?client_id=${encodeURIComponent(clientId)}&geo_clone=${encodeURIComponent(geoClone)}&live=1`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.pacing) setData(d.pacing as Pacing); else setError(d?.error ?? "Geen pacing beschikbaar"); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  // Aanvullend widget: kan de pacing niet berekend worden (geen data/config), dan tonen we niets
  // en laat het beursoverzicht eronder het werk doen — geen storende foutmelding bovenaan.
  if (error) return null;
  if (!data) {
    return <Laadvlak vorm="kaartjes" regels={4} />;
  }

  const behind = data.comparable && data.deltaPct != null && data.deltaPct < -0.02;
  const ahead = data.comparable && data.deltaPct != null && data.deltaPct > 0.02;
  // Spend gelijk of hoger terwijl de opbouw achterloopt = effectiviteitsvraag, geen budgetkwestie.
  const effectivenessNote = behind && data.costDeltaPct != null && data.deltaPct != null && data.costDeltaPct >= data.deltaPct;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <CalendarClock className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Pacing richting de beurs</h3>
        <span className="text-meta text-muted-foreground">event-relatief · vs vorige editie</span>
        {data.daysToFair != null && (
          <span className="ml-auto text-meta font-medium text-brand-blue-ink">
            nog {data.daysToFair} {data.daysToFair === 1 ? "dag" : "dagen"} tot {data.fairLabel}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        {!data.comparable ? (
          <div className="text-body text-muted-foreground flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Nog niet vergelijkbaar met de vorige editie{data.previousEditionId ? ` (${data.previousEditionId})` : ""}:
              {data.degradations[0] ? ` ${data.degradations[0]}` : " te weinig vergelijkbare data op gelijke afstand tot de beursdag."}
              {" "}Opbouw tot nu: <strong>{fmt(data.currentCumulative)}</strong> conversies.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kerncijfer
              label="Opbouw tot nu (deze editie)"
              waarde={fmt(data.currentCumulative)}
              formaat="compact"
              onderschrift="conversies"
            />
            <Kerncijfer
              label="Vorige editie op ditzelfde punt"
              waarde={fmt(data.previousCumulative)}
              formaat="compact"
              onderschrift={`${data.previousEditionId ?? "vorige editie"}, gelijke afstand`}
            />
            <div>
              {/* Dit cijfer ís de status — het pacing-verschil zelf — dus hier kleurt het getal,
                  en niet een delta eronder. */}
              <Kerncijfer
                label="Pacing vs vorige editie"
                waarde={pct(data.deltaPct)}
                formaat="compact"
                toon={behind ? "waarschuwing" : ahead ? "goed" : undefined}
                onderschrift={behind ? "loopt achter" : ahead ? "loopt voor" : "op koers"}
              />
            </div>
          </div>
        )}

        {effectivenessNote && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-800">
            De aanloop ligt achter terwijl de spend gelijk of hoger is ({pct(data.costDeltaPct)}): dit is een
            effectiviteitsvraag, geen budgetkwestie — kijk naar conversieratio en targeting vóór je meer budget inzet.
          </div>
        )}
      </div>
    </div>
  );
}
