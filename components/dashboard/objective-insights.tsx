"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatCurrency, formatNumber, formatPercent, formatRoas } from "@/lib/forecast-format";

// Feedback punt 29+31: "onder elk campagnetype hangen verschillende kanalen en verschillende
// inzichten die belangrijk zijn." Voor Meta en LinkedIn bestond de objective-taxonomie al
// (lib/meta/campaign-types.ts, lib/linkedin/campaign-types.ts) met per-objective evaluatiecriteria
// en de reden waarom elk ertoe doet -- alleen nergens gewired. Dit is de gedeelde presentatielaag:
// platform-eigen detectie/aggregatie (lib/meta|linkedin/objective-breakdown.ts) blijft gescheiden
// per platform (eigen vorm, zie de kop van die bestanden), maar hoe je een objective-tab, een
// campagnelijst en een metric-met-uitleg toont is hetzelfde soort scherm ongeacht het platform.
//
// Geen scoregrafiek zoals Google's Search/PMax-scorecard (radar, 5 gewogen factoren): dat is een
// eigen ontwerpronde per objective x metric-gewicht, dertien objectives samen (6 Meta + 7 LinkedIn)
// is te groot om deze ronde mee te nemen. Dit toont in plaats daarvan wat er al stond te
// documenteren -- welke metric ertoe doet en waarom -- gecombineerd met de echte, berekende
// waarde. Een metric zonder kolom in het schema toont eerlijk de checkInAds-tekst in plaats van
// een geraden cijfer.

export interface EvalCriterionLike {
  metric: string;
  label: string;
  why: string;
  direction: "higher_better" | "lower_better" | "range";
  available: boolean;
  checkInAds?: string;
}

export interface ObjectiveGroupLike {
  objective: string;
  label: string;
  spend: number;
  campaigns: { key: string; name: string; spend: number; primaryValue: number }[];
  metrics: Record<string, number | null>;
}

const eur = (v: number) => formatCurrency(v);

/** Kiest een redelijke opmaak op basis van de metric-sleutel -- geen aparte formatter per
 *  metric hoeven meegeven vanuit de aanroeper, want het patroon is consistent genoeg om af te
 *  leiden: geld, percentage, ROAS of een kaal getal. */
function formatMetricValue(metric: string, value: number): string {
  if (metric === "roas" || metric === "purchase_roas") return formatRoas(value);
  if (/rate|ctr$/i.test(metric)) return formatPercent(value, 1);
  if (/^cp[amlc]|cost_per|^cpm$/i.test(metric)) return eur(value);
  if (metric === "conversion_value" || metric === "spend") return eur(value);
  return formatNumber(value);
}

function MetricCard({ criterion, value }: { criterion: EvalCriterionLike; value: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-gray-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-meta font-medium text-brand-gray">{criterion.label}</span>
        <Tooltip>
          <TooltipTrigger className="shrink-0 cursor-help text-muted-foreground hover:text-brand-blue-ink">
            <Info className="w-3.5 h-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 items-start text-left leading-snug">
            <span className="block">{criterion.why}</span>
          </TooltipContent>
        </Tooltip>
      </div>
      {criterion.available ? (
        <p className="mt-1 text-lead font-bold text-brand-blue-ink">
          {value != null ? formatMetricValue(criterion.metric, value) : "—"}
        </p>
      ) : (
        <p className="mt-1 text-micro text-muted-foreground italic">
          Niet in dit dashboard — {criterion.checkInAds ?? "handmatig te checken in het platform"}
        </p>
      )}
    </div>
  );
}

export function ObjectiveInsights({
  groups,
  criteria,
  emptyLabel,
}: {
  groups: ObjectiveGroupLike[];
  criteria: Record<string, EvalCriterionLike[]>;
  /** Getoond als er nul objectives met campagnes zijn -- geen lege tabs renderen. */
  emptyLabel: string;
}) {
  const [active, setActive] = useState<string | null>(groups[0]?.objective ?? null);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-meta text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const selected = groups.find((g) => g.objective === active) ?? groups[0];
  const selectedCriteria = criteria[selected.objective] ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
        {groups.map((g) => (
          <button
            key={g.objective}
            onClick={() => setActive(g.objective)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              selected.objective === g.objective ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"
            }`}
          >
            {g.label}
            <span className="ml-1.5 text-micro text-muted-foreground">{eur(g.spend)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-gray-50/60">
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Campagnes ({selected.campaigns.length})
            </p>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {selected.campaigns.map((c) => (
              <div key={c.key} className="px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-meta text-brand-gray truncate">{c.name}</span>
                <span className="text-meta font-semibold text-brand-gray shrink-0">{eur(c.spend)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 content-start">
          {selectedCriteria.map((c) => (
            <MetricCard key={c.metric} criterion={c} value={selected.metrics[c.metric] ?? null} />
          ))}
        </div>
      </div>
    </div>
  );
}
