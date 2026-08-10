"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Target, Loader2 } from "lucide-react";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { compactNumber, compactCurrency } from "@/lib/format/compact-number";
import { EventTminusChart, type TminusPoint } from "./event-tminus-chart";

// Fase 6: de T-minus Forecaster. Consumeert uitsluitend GET /api/analysis/event-pacing (Fase 4,
// uitgebreid met curves/perChannelForecast/blendedForecast in dezelfde route) en visualiseert wat
// die route al berekent. Geen rekenlogica hier: alles onder "wiskunde" komt uit lib/rai en
// lib/events, ongewijzigd.

type Cadence = "annual" | "biennial" | "custom";
interface RaiEdition { date: string; label: string }
interface RaiEventCfg { id: string; name: string; abbrev?: string; cadence?: Cadence; editions?: RaiEdition[] }

type ChannelKey = "blended" | "google_ads" | "meta_ads" | "linkedin_ads";
const CHANNEL_LABEL: Record<ChannelKey, string> = {
  blended: "Totaal account",
  google_ads: "Google",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
};

interface CurvePoint { daysToFair: number; cumulative: number }
interface CpaCurvePoint { daysToFair: number; cpa: number | null }
interface EditionCurves { current: CurvePoint[]; previous: CurvePoint[] }
interface CpaCurves { current: CpaCurvePoint[]; previous: CpaCurvePoint[] }

interface StreamForecast {
  currentCumulative: number;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  confidence: "hoog" | "gemiddeld" | "laag" | "geen_basis";
  daysToFairNow: number | null;
}
interface ChannelForecastEntry { channel: string; forecast: StreamForecast }
interface BlendedForecast extends StreamForecast { channelsWithProjection: number; channelsTotal: number }

interface PacingResponse {
  channels: string[];
  curves: {
    conversions: Record<string, EditionCurves>;
    spend: Record<string, EditionCurves>;
    cpa: Record<string, CpaCurves>;
  };
  perChannelForecast: ChannelForecastEntry[];
  blendedForecast: BlendedForecast | null;
  pacing: {
    eventId: string;
    eventName: string;
    previousEditionId: string | null;
    target: number | null;
    projectedFinal: number | null;
    projectedVsTargetPct: number | null;
    willHitTarget: boolean | null;
    confidence: "hoog" | "gemiddeld" | "laag" | "geen_basis";
  };
}

const CONFIDENCE_LABEL: Record<string, string> = { hoog: "hoge zekerheid", gemiddeld: "gemiddelde zekerheid", laag: "lage zekerheid", geen_basis: "geen basis" };

type Status = "ahead" | "on-track" | "behind" | "no-target";

function statusFor(projectedVsTargetPct: number | null, target: number | null): Status {
  if (target == null || projectedVsTargetPct == null) return "no-target";
  if (projectedVsTargetPct >= 1.05) return "ahead";
  if (projectedVsTargetPct >= 0.95) return "on-track";
  return "behind";
}

const STATUS_LABEL: Record<Status, string> = {
  ahead: "Ahead of Goal",
  "on-track": "On Track",
  behind: "Pacing Behind",
  "no-target": "Geen doel ingesteld",
};

// De statuskleuren volgen dezelfde semantiek als de rest van het dashboard (groen/rood), op één
// uitzondering na: "Ahead of Goal" krijgt het neon-indigo accent uit het Executive Terminal-thema
// in plaats van nog een tint groen. Dat is geen versiering: het is de enige status die beter is
// dan het doel zelf, en verdient dus een eigen signaal in plaats van "extra goed groen".
const STATUS_COLOR: Record<Status, string> = {
  ahead: "var(--terminal-accent, var(--color-rm-blue-ink))",
  "on-track": "#22c55e",
  behind: "#ef4444",
  "no-target": "var(--muted-foreground, #64748b)",
};

function toTminusPoints(curve: CurvePoint[] | undefined): TminusPoint[] {
  return (curve ?? []).map((p) => ({ daysToFair: p.daysToFair, value: p.cumulative }));
}
function cpaToTminusPoints(curve: CpaCurvePoint[] | undefined): TminusPoint[] {
  return (curve ?? []).filter((p) => p.cpa != null).map((p) => ({ daysToFair: p.daysToFair, value: p.cpa as number }));
}

export function EventForecaster({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<RaiEventCfg[] | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("blended");
  const [data, setData] = useState<PacingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dbSelectOne<{ rai_events: unknown }>("client_settings", { select: "rai_events", clientId }).then(({ data: row }) => {
      if (cancelled) return;
      const raw = (row?.rai_events as { events?: RaiEventCfg[] } | null)?.events ?? [];
      const metEdities = raw.filter((e) => (e.editions ?? []).some((ed) => ed.date));
      setEvents(metEdities);
      if (metEdities.length > 0) setSelectedEventId((prev) => prev ?? metEdities[0].id);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    if (!selectedEventId) return;
    let cancelled = false;
    setData(null); setError(null); setSelectedChannel("blended");
    fetch(`/api/analysis/event-pacing?client_id=${encodeURIComponent(clientId)}&event_id=${encodeURIComponent(selectedEventId)}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.error) setError(d.error); else setData(d as PacingResponse); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [clientId, selectedEventId]);

  const beschikbareKanalen: ChannelKey[] = useMemo(() => {
    const echte = (data?.channels ?? []) as ChannelKey[];
    return echte.length > 1 ? ["blended", ...echte] : echte;
  }, [data]);

  const forecast: StreamForecast | BlendedForecast | null = useMemo(() => {
    if (!data) return null;
    if (selectedChannel === "blended") return data.blendedForecast ?? data.perChannelForecast[0]?.forecast ?? null;
    return data.perChannelForecast.find((c) => c.channel === selectedChannel)?.forecast ?? null;
  }, [data, selectedChannel]);

  // Geen events met een geconfigureerde editie: dit blok voegt niets toe (zie ook
  // AccountEventPacing in event-settings.tsx, dat dezelfde regel volgt). Ná alle hooks: React
  // eist dezelfde hook-volgorde bij elke render, dus een vroege return moet achter useState/
  // useEffect/useMemo staan, nooit ertussen.
  if (events !== null && events.length === 0) return null;

  // Het account-brede doel geldt alleen voor "Totaal account" (zie lib/events/account-event-
  // analysis.ts: per-kanaal-forecasts krijgen bewust geen eigen doel). Bij een los kanaal tonen we
  // de projectie zonder doel-vergelijking in plaats van een onjuiste vergelijking te verzinnen.
  const target = selectedChannel === "blended" ? (data?.pacing.target ?? null) : null;
  const projectedVsTargetPct = selectedChannel === "blended" ? (data?.pacing.projectedVsTargetPct ?? null) : null;
  const status = statusFor(projectedVsTargetPct, target);

  return (
    <div className="terminal space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TrendingUp className="h-4.5 w-4.5" style={{ color: "var(--terminal-accent, var(--color-rm-blue-ink))" }} />
        <h3 className="text-title font-semibold text-rm-gray">T-minus Forecaster</h3>
        {events && events.length > 1 && (
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1 text-meta text-rm-gray focus:border-rm-blue/50 focus:outline-none"
          >
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        )}
        {data && (
          <span className="text-meta text-muted-foreground">
            {events && events.length === 1 ? events[0].name : data.pacing.eventName}
            {data.pacing.previousEditionId ? `, vs editie ${data.pacing.previousEditionId}` : ""}
          </span>
        )}
      </div>

      {error && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-800">{error}</p>}
      {!error && !data && (
        <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Laden...
        </div>
      )}

      {data && (
        <>
          {/* Task 2: kanaal-blending. Beschikbaar is alleen wat de route echt teruggeeft; een klant
              met alleen Google krijgt dus geen toggle die niets doet. */}
          {beschikbareKanalen.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {beschikbareKanalen.map((k) => (
                <button
                  key={k}
                  onClick={() => setSelectedChannel(k)}
                  className={`rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                    selectedChannel === k
                      ? "bg-rm-blue text-white"
                      : "border border-border text-muted-foreground hover:border-rm-blue/40"
                  }`}
                >
                  {CHANNEL_LABEL[k]}
                </button>
              ))}
            </div>
          )}

          {/* Task 3: Forecaster-statuspaneel. Harde getallen in var(--mono); het accent is alleen
              zichtbaar in donkere modus (zie .dark .terminal in app/globals.css), anders valt het
              terug op de gewone merkkleur. */}
          {forecast && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Opgebouwd tot nu</p>
                  <p className="teller-waarde mt-0.5 text-2xl font-bold text-rm-gray">{compactNumber(forecast.currentCumulative)}</p>
                </div>
                <div>
                  <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Geprojecteerde eindstand</p>
                  <p className="teller-waarde mt-0.5 text-2xl font-bold text-rm-gray">
                    {forecast.projectedFinal != null ? compactNumber(forecast.projectedFinal) : "geen basis"}
                  </p>
                </div>
                {target != null && (
                  <div>
                    <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Doel</p>
                    <p className="teller-waarde mt-0.5 text-2xl font-bold text-rm-gray">{compactNumber(target)}</p>
                  </div>
                )}
                <div className="ml-auto">
                  <span
                    className="teller-waarde rounded-full px-3 py-1.5 text-meta font-semibold"
                    style={{ color: STATUS_COLOR[status], backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[status]} 14%, transparent)` }}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                  <p className="mt-1 text-right text-micro text-muted-foreground">{CONFIDENCE_LABEL[forecast.confidence]}</p>
                </div>
              </div>
              {target == null && selectedChannel !== "blended" && (
                <p className="mt-3 text-micro text-muted-foreground">
                  Doel-vergelijking geldt alleen voor Totaal account: er is geen apart doel per kanaal.
                </p>
              )}
            </div>
          )}

          {/* Task 1: de drie T-minus trendlijnen, altijd voor het geselecteerde kanaal. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <EventTminusChart
              title="Spend"
              previousLabel="Vorige editie"
              current={toTminusPoints(data.curves.spend[selectedChannel]?.current)}
              previous={toTminusPoints(data.curves.spend[selectedChannel]?.previous)}
              valueFormatter={(v) => compactCurrency(v)}
            />
            <EventTminusChart
              title="Conversies"
              previousLabel="Vorige editie"
              current={toTminusPoints(data.curves.conversions[selectedChannel]?.current)}
              previous={toTminusPoints(data.curves.conversions[selectedChannel]?.previous)}
              valueFormatter={(v) => compactNumber(v)}
            />
            <EventTminusChart
              title="CPA"
              previousLabel="Vorige editie"
              current={cpaToTminusPoints(data.curves.cpa[selectedChannel]?.current)}
              previous={cpaToTminusPoints(data.curves.cpa[selectedChannel]?.previous)}
              valueFormatter={(v) => compactCurrency(v)}
            />
          </div>
        </>
      )}
    </div>
  );
}
