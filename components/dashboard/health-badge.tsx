"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info, Activity } from "lucide-react";
import { useClientHistoricalData, useClientDataState } from "@/lib/client-data-provider";
import { computeForecast } from "@/lib/forecast";
import { computeHealthScore, type HealthScore } from "@/lib/health-score";
import { magRadarTonen } from "@/lib/health-radar";
import { HealthRadar } from "./health-radar";

export function HealthBadge({ clientId }: { clientId: string }) {
  const data = useClientHistoricalData(clientId);
  const dataState = useClientDataState();
  const forecast = useMemo(() => computeForecast(data), [data]);

  const health = useMemo(() => computeHealthScore(
    forecast,
    dataState?.impressionShare,
    dataState?.wastefulSearchTerms,
    dataState?.adGroupBleeders,
  ), [forecast, dataState]);

  // Eén plek voor de statuskleur. De boog en de radar tonen dezelfde score, dus een tweede
  // ternary ernaast zou vroeg of laat iets anders zeggen dan de eerste.
  const radarKleur = health.grade === "?" ? "#9ca3af"
    : health.total >= 70 ? "#22c55e"
    : health.total >= 50 ? "#f59e0b"
    : "#ef4444";

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-5">
        {/* Score circle */}
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
            <circle cx="40" cy="40" r="34" fill="none" className="stroke-border" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke={radarKleur}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={health.grade === "?" ? "0 213.6" : `${health.total * 2.136} 213.6`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Een getal tonen naast een "?" suggereert precisie die er niet is: bij te
                weinig beoordeelde factoren is de score geen lage score maar een onbekende. */}
            <span className={`text-xl font-bold ${health.color}`}>
              {health.grade === "?" ? "—" : health.total}
            </span>
            <span className="text-micro font-semibold text-muted-foreground">
              {health.grade === "?" ? `${health.assessedCount}/5` : health.grade}
            </span>
          </div>
        </div>

        {/* Factors.

            De boog links zegt HOE VER (één begrensd getal), de radar zegt WAARUIT dat getal
            bestaat. Dezelfde data op twee hoogtes, naast elkaar -- een account met 68 dat overal
            middelmatig is en een account met 68 dat uitblinkt op budget en faalt op hygiëne zagen
            er hiervoor identiek uit.

            Onder de drie beoordeelde assen valt de radar terug op de staafjes: twee punten en drie
            gaten is geen vorm maar ruis die eruitziet als een meting. */}
        <div className="shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-rm-blue-ink" />
            <h3 className="text-sm font-semibold text-rm-blue-ink uppercase tracking-wide">Account Health</h3>
          </div>
          {magRadarTonen(health.factors) ? (
            <HealthRadar factoren={health.factors} kleur={radarKleur} />
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {health.factors.map((f) => (
                <div key={f.name} className="text-center">
                  {/* Niet-beoordeeld toont een streepje en geen 0/20: een nul-balk leest als een
                      falende score terwijl het "niet te meten" betekent. De donut ernaast zei dat
                      al goed ("—" en "3/5"); deze balkjes spraken hem tegen. */}
                  <div className="text-xs font-semibold text-rm-gray">
                    {f.assessed ? `${f.score}/${f.maxScore}` : "—"}
                  </div>
                  <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                    {f.assessed && (
                      <div
                        className={`h-full rounded-full ${f.score >= 16 ? "bg-green-400" : f.score >= 10 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{ width: `${(f.score / f.maxScore) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className={`text-micro mt-1 ${f.assessed ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                    {f.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Anomalies */}
        {health.anomalies.length > 0 && (
          <div className="flex-1 min-w-0">
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Anomalieën ({health.anomalies.length})
            </p>
            <div className="space-y-1.5">
              {health.anomalies.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  {a.severity === "critical" ? (
                    <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  ) : a.severity === "warning" ? (
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                  )}
                  <span className="text-meta leading-tight">
                    <span className="text-rm-gray font-medium">{a.title}</span>
                    <span className="text-muted-foreground"> — {a.description}</span>
                  </span>
                </div>
              ))}
              {health.anomalies.length > 6 && (
                <span className="text-micro text-muted-foreground">+{health.anomalies.length - 6} meer</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
