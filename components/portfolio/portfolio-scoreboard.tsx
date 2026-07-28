"use client";

import { useState, useEffect } from "react";
import { Loader2, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getVisibleClients } from "@/lib/visible-clients";
import { type Client } from "@/lib/clients";
import { PeriodProvider, usePeriod } from "@/lib/period/period-context";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { formatRange } from "@/lib/period/period-range";
import { DEMO_GREENTECH_ID, buildGreentechClientData } from "@/lib/demo/greentech-mock";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "@/lib/api/adapter";
import { comparePeriods } from "@/lib/period/apply-period";
import type { PeriodRange } from "@/lib/period/period-range";

// De demo-klant komt niet uit de Google Ads MCC en heeft dus geen gads-id; zonder deze
// omweg blijft het scorebord in demo-modus leeg terwijl de periodekiezer er wel boven staat.
// De cijfers lopen door dezelfde adapter en dezelfde periodesnede als het klantdashboard, dus
// wat je hier ziet is consistent met wat je daar ziet.
function demoOverview(range: PeriodRange, compareRange: PeriodRange | null): AccountOverview {
  const api = buildGreentechClientData(DEMO_GREENTECH_ID);
  const data = buildClientDataFromApi(
    DEMO_GREENTECH_ID,
    api.historicalYears as YearDataInput[],
    api.currentYearMonthly as ApiMonthlyData[],
    api.currentYearWeekly as ApiWeeklyData[],
    api.targetCurrentYear,
    api.currentYear,
    api.realizedThroughMonth,
  );
  const { current, previous, deltas } = comparePeriods(data, range, compareRange);
  const laatste = current.months[current.months.length - 1];
  const vorigJaarZelfdeMaand = previous?.months.find((m) => m.month === laatste?.month);
  return {
    customerId: DEMO_GREENTECH_ID,
    ytd: {
      conversions: current.totals.conversions,
      revenue: current.totals.revenue,
      adSpend: current.totals.adSpend,
      roas: current.totals.adSpend > 0 ? current.totals.revenue / current.totals.adSpend : 0,
      cpa: current.totals.conversions > 0 ? current.totals.adSpend / current.totals.conversions : 0,
    },
    yoy: {
      convChange: deltas?.conversions.pct ?? null,
      revChange: deltas?.revenue.pct ?? null,
      spendChange: deltas?.adSpend.pct ?? null,
    },
    lastMonth: laatste ? {
      month: laatste.month, conversions: laatste.conversions,
      revenue: laatste.revenue, adSpend: laatste.adSpend,
      prevYearConv: vorigJaarZelfdeMaand?.conversions ?? 0,
    } : null,
    monthlyConversions: current.months.map((m) => m.conversions),
  };
}

// Het klassieke portfolio-scorebord (YTD-prestaties per klant). Ongewijzigd verplaatst van de
// oude homepage (/) naar /portfolio bij de introductie van de "Vandaag"-cockpit. Geen wijziging
// in logica of data — puur verhuisd zodat de reporting-view behouden blijft.

interface AccountOverview {
  customerId: string;
  ytd?: {
    conversions: number;
    revenue: number;
    adSpend: number;
    roas: number;
    cpa: number;
  };
  yoy?: {
    convChange: number | null;
    revChange: number | null;
    spendChange: number | null;
  };
  lastMonth?: {
    month: number;
    conversions: number;
    revenue: number;
    adSpend: number;
    prevYearConv: number;
  } | null;
  monthlyConversions?: number[];
  error?: string;
}

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(v);
}

function TrendBadge({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-gray-300">—</span>;
  const isPositive = value >= 0;
  const color = isPositive ? "text-green-600" : "text-red-500";
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? "+" : ""}{Math.round(value)}{suffix}
    </span>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke="#08288C"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SummaryCard({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color ?? "text-rm-gray"}`}>{value}</p>
      {subtitle && <p className="text-micro text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

// De provider zit om het scorebord heen; het bord zelf leest de periode via usePeriod.
export function PortfolioScoreboard() {
  return (
    <PeriodProvider scope="portfolio">
      <PortfolioScoreboardBody />
    </PeriodProvider>
  );
}

function PortfolioScoreboardBody() {
  const periode = usePeriod();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [overviews, setOverviews] = useState<Map<string, AccountOverview>>(new Map());
  const [sortBy, setSortBy] = useState<"name" | "conversions" | "revenue" | "roas" | "cpa" | "yoy">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    const visible = getVisibleClients();
    setClients(visible);

    // Only fetch for Google Ads clients
    // De demo-klant krijgt zijn cijfers lokaal; de rest komt van de API.
    const demoMap = new Map<string, AccountOverview>();
    if (visible.some((c) => c.id === DEMO_GREENTECH_ID)) {
      demoMap.set(DEMO_GREENTECH_ID, demoOverview(periode.range, periode.compareRange));
    }

    const gadsClients = visible.filter((c) => c.id.startsWith("gads-"));
    if (gadsClients.length === 0) {
      setOverviews(demoMap);
      setLoading(false);
      return;
    }

    const customerIds = gadsClients.map((c) => c.id.replace("gads-", "")).join(",");
    // De periode gaat mee de query in: het scorebord haalt zijn cijfers server-side op, dus
    // client-side snijden zoals op het klantdashboard kan hier niet.
    const q = new URLSearchParams({ customerIds, start: periode.range.start, end: periode.range.end });
    if (periode.compareRange) {
      q.set("compareStart", periode.compareRange.start);
      q.set("compareEnd", periode.compareRange.end);
    }
    fetch(`/api/google-ads/overview?${q}`)
      .then((r) => r.json())
      .then((data) => {
        const map = new Map<string, AccountOverview>(demoMap);
        for (const account of data.accounts || []) {
          map.set(`gads-${account.customerId}`, account);
        }
        setOverviews(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [periode.range.start, periode.range.end, periode.compareRange?.start, periode.compareRange?.end]);

  function handleSort(col: typeof sortBy) {
    if (sortBy === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  }

  const sortedClients = [...clients].sort((a, b) => {
    const oa = overviews.get(a.id);
    const ob = overviews.get(b.id);
    let va: number, vb: number;

    switch (sortBy) {
      case "name": return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      case "conversions": va = oa?.ytd?.conversions ?? 0; vb = ob?.ytd?.conversions ?? 0; break;
      case "revenue": va = oa?.ytd?.revenue ?? 0; vb = ob?.ytd?.revenue ?? 0; break;
      case "roas": va = oa?.ytd?.roas ?? 0; vb = ob?.ytd?.roas ?? 0; break;
      case "cpa": va = oa?.ytd?.cpa ?? 0; vb = ob?.ytd?.cpa ?? 0; break;
      case "yoy": va = oa?.yoy?.convChange ?? -999; vb = ob?.yoy?.convChange ?? -999; break;
      default: return 0;
    }
    return sortDir === "asc" ? va - vb : vb - va;
  });

  // Een "spook-klant" is een Google-account waarvan de overview POSITIEF nul spend toont.
  // Alleen verbergen als we het echt konden vaststellen — faalt de fetch (geen overview),
  // dan verbergen we niets. Puur weergave: de data blijft ongemoeid, de toggle zet het terug.
  function isEmptyAccount(client: Client): boolean {
    if (!client.id.startsWith("gads-")) return false; // demo en handmatige klanten nooit verbergen
    const o = overviews.get(client.id);
    if (!o) return false;
    return !(o.ytd && o.ytd.adSpend > 0);
  }
  const emptyCount = clients.filter(isEmptyAccount).length;
  const displayClients = showEmpty ? sortedClients : sortedClients.filter((c) => !isEmptyAccount(c));

  const SortHeader = ({ col, label, align }: { col: typeof sortBy; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-3 text-meta font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-rm-blue transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label}
      {sortBy === col && (
        <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-rm-blue" />
        <p className="text-sm text-muted-foreground">Klantoverzicht laden...</p>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Geen klanten geconfigureerd. Ga naar Instellingen om te beginnen.</p>
      </div>
    );
  }

  // Portfolio totals
  const allOverviews = Array.from(overviews.values()).filter((o) => o.ytd && o.ytd.adSpend > 0);
  const portfolioConv = allOverviews.reduce((s, o) => s + (o.ytd?.conversions ?? 0), 0);
  const portfolioRev = allOverviews.reduce((s, o) => s + (o.ytd?.revenue ?? 0), 0);
  const portfolioSpend = allOverviews.reduce((s, o) => s + (o.ytd?.adSpend ?? 0), 0);
  const portfolioRoas = portfolioSpend > 0 ? portfolioRev / portfolioSpend : 0;
  const activeCount = allOverviews.length;
  const growingCount = allOverviews.filter((o) => (o.yoy?.convChange ?? 0) > 0).length;
  const decliningCount = allOverviews.filter((o) => (o.yoy?.convChange ?? 0) < -10).length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Goedemorgen" : now.getHours() < 18 ? "Goedemiddag" : "Goedenavond";
  const dateStr = now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* De periodekiezer boven het bord: alle kolommen hieronder gaan over deze periode. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">
          Cijfers over <span className="font-medium text-rm-gray">{formatRange(periode.range)}</span>
          {periode.compareRange && <> tegenover {formatRange(periode.compareRange)}</>}
        </p>
        <PeriodSelector
          value={{
            preset: periode.preset, custom: periode.custom, comparison: periode.comparison,
            range: periode.range, compareRange: periode.compareRange,
          }}
          onChange={(v) => periode.set(v.preset, v.custom, v.comparison)}
        />
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-r from-rm-blue to-rm-blue/80 rounded-2xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/60 text-sm">{dateStr}</p>
            <h1 className="text-2xl font-bold mt-1">{greeting}</h1>
            <p className="text-white/70 mt-2 text-sm max-w-lg">
              {activeCount > 0
                ? `${activeCount} actieve klanten · ${growingCount} groeiend · ${decliningCount > 0 ? `${decliningCount} vragen aandacht` : "alles op schema"}`
                : `${clients.length} klanten geconfigureerd`
              }
            </p>
          </div>
          {activeCount > 0 && (
            <div className="hidden lg:grid grid-cols-3 gap-6 text-right">
              <div>
                <p className="text-white/50 text-micro uppercase tracking-wider">Totaal conversies</p>
                <p className="text-xl font-bold">{num(portfolioConv)}</p>
              </div>
              <div>
                <p className="text-white/50 text-micro uppercase tracking-wider">Totaal omzet</p>
                <p className="text-xl font-bold">{fmt(portfolioRev)}</p>
              </div>
              <div>
                <p className="text-white/50 text-micro uppercase tracking-wider">Gem. ROAS</p>
                <p className="text-xl font-bold">{portfolioRoas.toFixed(1)}x</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick stats on mobile (hero hides them) */}
      {activeCount > 0 && (
        <div className="grid grid-cols-4 gap-3 lg:hidden">
          <SummaryCard label="Conversies" value={num(portfolioConv)} />
          <SummaryCard label="Omzet" value={fmt(portfolioRev)} />
          <SummaryCard label="Spend" value={fmt(portfolioSpend)} />
          <SummaryCard label="ROAS" value={`${portfolioRoas.toFixed(1)}x`} color={portfolioRoas >= 3 ? "text-green-600" : portfolioRoas >= 1 ? "text-rm-gray" : "text-red-500"} />
        </div>
      )}

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-border bg-gray-50/50">
            <tr>
              <SortHeader col="name" label="Klant" />
              <SortHeader col="conversions" label="Conversies" align="right" />
              <SortHeader col="yoy" label="YoY" align="right" />
              <SortHeader col="revenue" label="Omzet" align="right" />
              <SortHeader col="roas" label="ROAS" align="right" />
              <SortHeader col="cpa" label="CPA" align="right" />
              <th className="px-4 py-3 text-meta font-semibold text-muted-foreground uppercase tracking-wider text-center">Spend</th>
              <th className="px-4 py-3 text-meta font-semibold text-muted-foreground uppercase tracking-wider text-center">Trend</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayClients.map((client) => {
              const overview = overviews.get(client.id);
              const ytd = overview?.ytd;
              const yoy = overview?.yoy;
              const hasData = ytd && ytd.adSpend > 0;

              return (
                <tr key={client.id} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-4 py-3">
                    <Link href={`/client/${client.id}`} className="flex items-center gap-2.5 text-sm font-medium text-rm-gray hover:text-rm-blue transition-colors">
                      {/* Health dot */}
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        !hasData ? "bg-gray-200" :
                        (yoy?.convChange ?? 0) > 10 && ytd!.roas >= 2 ? "bg-green-400" :
                        (yoy?.convChange ?? 0) > -10 ? "bg-amber-400" :
                        "bg-red-400"
                      }`} />
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasData ? (
                      <span className="text-sm font-semibold text-rm-gray">{num(ytd.conversions)}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TrendBadge value={yoy?.convChange ?? null} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasData ? (
                      <span className="text-sm text-rm-gray">{fmt(ytd.revenue)}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasData ? (
                      <span className={`text-sm font-medium ${ytd.roas >= 3 ? "text-green-600" : ytd.roas >= 1 ? "text-rm-gray" : "text-red-500"}`}>
                        {ytd.roas.toFixed(1)}x
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasData ? (
                      <span className="text-sm text-rm-gray">{fmt(ytd.cpa)}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {hasData ? (
                      <span className="text-sm text-muted-foreground">{fmt(ytd.adSpend)}</span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {overview?.monthlyConversions && overview.monthlyConversions.length > 1 ? (
                      <MiniSparkline data={overview.monthlyConversions} />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/client/${client.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {emptyCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-gray-50/50 text-meta text-muted-foreground">
            <span>
              {showEmpty
                ? `${emptyCount} lege ${emptyCount === 1 ? "account" : "accounts"} zonder spend worden getoond.`
                : `${emptyCount} lege ${emptyCount === 1 ? "account" : "accounts"} zonder spend ${emptyCount === 1 ? "is" : "zijn"} verborgen.`}
            </span>
            <button
              onClick={() => setShowEmpty((v) => !v)}
              className="font-semibold text-rm-blue hover:underline"
            >
              {showEmpty ? "Verberg lege accounts" : "Toon alles"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
