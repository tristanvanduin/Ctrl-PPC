"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";

interface ChannelGap {
  channel: string;
  segmentLabel: string;
  accountsCount: number;
  bureausCount: number;
  medianCpa: number | null;
  medianRoas: number | null;
}

const KANAAL_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
};

const eur = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));

// Kanaalaanbeveling: welk kanaal scoort goed in het segment van deze klant, terwijl de klant het
// zelf niet gebruikt? Zie app/api/analysis/channel-gaps/route.ts + lib/benchmark/
// god-view-channel-gaps.ts. Toont zichzelf niet (return null) zolang er geen enkele deelbare cel
// is -- bij vandaag 2 echte bureaus is dat de verwachte stand, niet een storing (masterplan
// 17.65/regel 3 van de vertrouwensdoctrine: insufficient_data is eerlijk, geen fout).
export function ChannelGapCard({ clientId }: { clientId: string }) {
  const [gaps, setGaps] = useState<ChannelGap[] | null>(null);
  const [testMode, setTestMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGaps(null);
    fetch(`/api/analysis/channel-gaps?clientId=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((data: { gaps?: ChannelGap[]; testMode?: boolean }) => {
        if (cancelled) return;
        setGaps(data.gaps ?? []);
        setTestMode(Boolean(data.testMode));
      })
      .catch(() => { if (!cancelled) setGaps([]); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (gaps === null) {
    return <div className="flex items-center gap-2 text-meta text-muted-foreground py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Kanaalaanbevelingen laden...</div>;
  }
  if (gaps.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Lightbulb className="w-4.5 h-4.5 text-brand-blue-ink" />
        <div className="flex-1">
          <h3 className="text-title font-semibold text-brand-gray">Kanaalaanbeveling</h3>
          <p className="text-micro text-muted-foreground mt-0.5">
            Op basis van vergelijkbare accounts in hetzelfde segment (God View, anoniem)
          </p>
        </div>
        {testMode && (
          <span className="text-micro font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
            Testmodus
          </span>
        )}
      </div>
      <div className="px-5 py-4 space-y-3">
        {gaps.map((g) => (
          <div key={g.channel} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-gray-50/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-body font-semibold text-brand-gray">
                {KANAAL_LABEL[g.channel] ?? g.channel} nog niet actief
              </p>
              <p className="text-meta text-muted-foreground mt-0.5">
                Segment {g.segmentLabel}: mediane CPA {eur(g.medianCpa)}
                {g.medianRoas != null ? `, mediane ROAS ${g.medianRoas.toFixed(2)}` : ""} bij{" "}
                {g.accountsCount} accounts, {g.bureausCount} bureaus.
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
