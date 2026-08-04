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
import { loadClientGroups, type GroupWithMembers } from "@/lib/client-groups";
import { bouwHierarchie } from "@/lib/groepen/hierarchie";
import { comparePeriods } from "@/lib/period/apply-period";
import type { PeriodRange } from "@/lib/period/period-range";
import { formatRoas } from "@/lib/forecast-format";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Tabel, Kop, KolomKop, SorteerKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "@/components/dashboard/data-table";
import { Sparkline } from "@/components/ui/sparkline";

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

function SummaryCard({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color ?? "text-rm-gray"}`}>{value}</p>
      {subtitle && <p className="text-micro text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

// De provider zit om het scorebord heen; het bord zelf leest de periode via usePeriod.
/**
 * De kopregel van een merk, met het subtotaal erin.
 *
 * Het subtotaal staat in dezelfde kolommen als de accounts eronder, zodat het te vergelijken is
 * zonder te rekenen. ROAS en CPA komen uit de SOMMEN en niet uit een gemiddelde van de losse
 * waarden: dat laatste weegt een account van honderd euro even zwaar als een van honderdduizend.
 */
function MerkKopRij({ naam, bevestigd, aantal, totaal }: {
  naam: string;
  bevestigd: boolean;
  aantal: number;
  totaal: { conversions: number; revenue: number; adSpend: number; roas: number; cpa: number };
}) {
  return (
    <Rij className="bg-muted/40">
      <NaamCel>
        <span className="inline-flex items-center gap-2">
          <span className="text-sm font-semibold text-rm-blue-ink">{naam}</span>
          <span className="text-micro text-muted-foreground">{aantal}</span>
          {/* Een indeling die uit een naam is geraden hoort ook hier als voorstel te lezen. Een
              subtotaal over een geraden groep is precies zo overtuigend als een over een juiste. */}
          {!bevestigd && (
            <span className="rounded-full bg-amber-100 px-1.5 py-px text-micro font-medium text-amber-800">
              voorstel
            </span>
          )}
        </span>
      </NaamCel>
      <GetalCel>{num(Math.round(totaal.conversions))}</GetalCel>
      {/* Geen YoY op groepsniveau: dat zou een som van percentages zijn, en die bestaat niet.
          Een streepje is hier eerlijker dan een getal dat er goed uitziet. */}
      <GetalCel><span className="text-gray-300">—</span></GetalCel>
      <GetalCel>{fmt(totaal.revenue)}</GetalCel>
      <GetalCel>{formatRoas(totaal.roas)}</GetalCel>
      <GetalCel>{totaal.conversions > 0 ? fmt(totaal.cpa) : <span className="text-gray-300">—</span>}</GetalCel>
      <GetalCel>{fmt(totaal.adSpend)}</GetalCel>
      <Cel>{null}</Cel>
      <Cel>{null}</Cel>
    </Rij>
  );
}

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
  // ── Vergelijken op merk ────────────────────────────────────────────────────
  //
  // ALLEEN op de merk-as, en dat is geen beperking maar de kern. Een merkgroep bevat land- of
  // regiovarianten van dezelfde zaak, en de database staat toe dat een account bij hoogstens één
  // merk hoort (migratie 052 en 053). Daardoor telt een subtotaal elk account precies één keer.
  //
  // Op de specialist-as geldt dat niet: twee mensen kunnen samen aan een account werken, dus
  // optellen per specialist zou dezelfde omzet twee keer meenemen. Een vergelijking die dat doet
  // ziet er precies zo uit als een die klopt, en daarom staat die as hier niet.
  const [groepeer, setGroepeer] = useState(false);
  const [groepen, setGroepen] = useState<GroupWithMembers[]>([]);

  useEffect(() => { loadClientGroups().then(setGroepen).catch(() => setGroepen([])); }, []);

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

  // De merkindeling over de klanten die nu in beeld zijn. Groepen zonder soort tellen NIET mee:
  // dit is de vergelijk-as, en meedoen op een indeling waarvan niemand heeft gezegd dat het een
  // merk is, is precies de gok die het soort-veld moet uitsluiten.
  const merkGroepen = groepen.filter((g) => g.soort === "merk");
  const merkBoom = groepeer && merkGroepen.length > 0
    ? bouwHierarchie(displayClients, merkGroepen, "merk")
    : [];

  /** Subtotaal over een tak. Sommen, en de verhoudingen daaruit -- nooit een gemiddelde van ratio's. */
  function subtotaal(klanten: readonly Client[]) {
    let conversions = 0, revenue = 0, adSpend = 0;
    for (const k of klanten) {
      const y = overviews.get(k.id)?.ytd;
      if (!y) continue;
      conversions += y.conversions; revenue += y.revenue; adSpend += y.adSpend;
    }
    // ROAS en CPA uit de SOMMEN, niet het gemiddelde van de losse ROAS'en. Dat laatste weegt een
    // account van 100 euro even zwaar als een van 100.000 en geeft een getal dat nergens bij hoort.
    return {
      conversions, revenue, adSpend,
      roas: adSpend > 0 ? revenue / adSpend : 0,
      cpa: conversions > 0 ? adSpend / conversions : 0,
    };
  }

  // Een functie die JSX oplevert, geen component: een component dat tijdens de render ontstaat is
  // elke render een nieuw type en laat React de hele kop opnieuw ophangen. En de sorteerknop komt
  // uit de gedeelde tabellaag, zodat hij een echte knop is met aria-sort in plaats van een th met
  // een klik erop — dat laatste is voor een muis een knop en voor een toetsenbord niets.
  const sorteerKop = (col: typeof sortBy, label: string, opties: { getal?: boolean; breed?: boolean; bijschrift?: string } = {}) => (
    <SorteerKop
      key={col}
      getal={opties.getal}
      breed={opties.breed}
      bijschrift={opties.bijschrift}
      actief={sortBy === col}
      richting={sortDir}
      onSorteer={() => handleSort(col)}
    >
      {label}
    </SorteerKop>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-rm-blue-ink" />
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
  // Tegen de grootste klant en niet tegen de som: bij twintig klanten is elk aandeel-van-het-
  // totaal klein, en dan zijn alle streepjes even kort.
  const grootsteConv = Math.max(0, ...allOverviews.map((o) => o.ytd?.conversions ?? 0));
  const grootsteSpend = Math.max(0, ...allOverviews.map((o) => o.ytd?.adSpend ?? 0));
  const activeCount = allOverviews.length;
  const growingCount = allOverviews.filter((o) => (o.yoy?.convChange ?? 0) > 0).length;
  const decliningCount = allOverviews.filter((o) => (o.yoy?.convChange ?? 0) < -10).length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Goedemorgen" : now.getHours() < 18 ? "Goedemiddag" : "Goedenavond";
  const dateStr = now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  /** Eén klantrij. Losgetrokken zodat de gegroepeerde en de platte stand dezelfde opbouw delen. */
  function klantRij(client: Client) {
              const overview = overviews.get(client.id);
              const ytd = overview?.ytd;
              const yoy = overview?.yoy;
              const hasData = ytd && ytd.adSpend > 0;
              const leeg = <span className="text-gray-300">—</span>;

              return (
                <Rij key={client.id} className="group">
                  <NaamCel>
                    <Link href={`/client/${client.id}`} className="inline-flex items-center gap-2.5 hover:text-rm-blue-ink transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rm-blue">
                      {/* Health dot */}
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        !hasData ? "bg-gray-200" :
                        (yoy?.convChange ?? 0) > 10 && ytd!.roas >= 2 ? "bg-green-400" :
                        (yoy?.convChange ?? 0) > -10 ? "bg-amber-400" :
                        "bg-red-400"
                      }`} />
                      {client.name}
                    </Link>
                  </NaamCel>
                  {/* Twee strepen: conversies en spend. Dát is de vraag van een portfolio-overzicht
                      — welke klant trekt het volume en welke trekt het budget — en die vergelijking
                      lieten we eerst aan het hoofd van de lezer over. Op ROAS en CPA staat er geen:
                      dat zijn verhoudingen, en bij CPA is laag juist beter. */}
                  {hasData ? (
                    <AandeelCel waarde={num(ytd.conversions)} aandeel={grootsteConv > 0 ? ytd.conversions / grootsteConv : 0} />
                  ) : <GetalCel>{leeg}</GetalCel>}
                  <GetalCel><TrendBadge value={yoy?.convChange ?? null} /></GetalCel>
                  <GetalCel>{hasData ? fmt(ytd.revenue) : leeg}</GetalCel>
                  <GetalCel className={!hasData ? "" : ytd.roas >= 3 ? "text-green-600 font-medium" : ytd.roas >= 1 ? "" : "text-red-500 font-medium"}>
                    {hasData ? formatRoas(ytd.roas) : leeg}
                  </GetalCel>
                  <GetalCel zacht>{hasData ? fmt(ytd.cpa) : leeg}</GetalCel>
                  {hasData ? (
                    <AandeelCel waarde={fmt(ytd.adSpend)} aandeel={grootsteSpend > 0 ? ytd.adSpend / grootsteSpend : 0} kleur={CHART_CATEGORICAL[2]} />
                  ) : <GetalCel>{leeg}</GetalCel>}
                  <Cel>
                    {overview?.monthlyConversions && overview.monthlyConversions.length > 1
                      // Conversies zijn een volume, dus vanaf nul: de hoogte ís hier de betekenis.
                      ? <Sparkline punten={overview.monthlyConversions} basis="nul" titel={`Conversies per maand voor ${client.name}`} />
                      : leeg}
                  </Cel>
                  <Cel>
                    {/* Alleen zichtbaar op hover was het probleem: met het toetsenbord kun je niet
                        hoveren, dus de pijl was er wel maar onvindbaar. Focus laat hem nu ook zien. */}
                    <Link
                      href={`/client/${client.id}`}
                      aria-label={`Open ${client.name}`}
                      className="inline-flex opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rm-blue"
                    >
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </Cel>
                </Rij>
              );
  }

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
                <p className="text-xl font-bold">{formatRoas(portfolioRoas)}</p>
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
          <SummaryCard label="ROAS" value={formatRoas(portfolioRoas)} color={portfolioRoas >= 3 ? "text-green-600" : portfolioRoas >= 1 ? "text-rm-gray" : "text-red-500"} />
        </div>
      )}

      {/* Alleen aanbieden als er iets te groeperen valt. Een knop die niets doet is erger dan
          geen knop: hij belooft een indeling die er niet is. */}
      {merkGroepen.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => setGroepeer((v) => !v)}
            className={`rounded-lg border px-2.5 py-1 text-meta font-medium transition-colors ${
              groepeer ? "border-rm-blue bg-rm-blue/10 text-rm-blue-ink"
                       : "border-border text-muted-foreground hover:border-rm-blue/40"}`}
          >
            Groepeer op merk
          </button>
          <span className="text-micro text-muted-foreground">
            {merkGroepen.length} merk{merkGroepen.length !== 1 ? "en" : ""} &middot; alleen deze as,
            want op de specialist-as kan een account bij meer mensen horen en telt een subtotaal dubbel
          </span>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <Tabel>
          <Kop>
            {sorteerKop("name", "Klant", { breed: true })}
            {sorteerKop("conversions", "Conversies", { getal: true, bijschrift: "aandeel" })}
            {sorteerKop("yoy", "YoY", { getal: true })}
            {sorteerKop("revenue", "Omzet", { getal: true })}
            {sorteerKop("roas", "ROAS", { getal: true })}
            {sorteerKop("cpa", "CPA", { getal: true })}
            <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
            <KolomKop>Trend</KolomKop>
            <KolomKop><span className="sr-only">Openen</span></KolomKop>
          </Kop>
          <Body>
            {/* Eén rij-opbouw voor beide standen. Twee kopieën zouden binnen een maand uit elkaar
                lopen op een kolom die iemand maar op één plek bijwerkt. */}
            {(groepeer && merkBoom.length > 0
              ? merkBoom.flatMap((tak) => [
                  <MerkKopRij key={`k-${tak.groepId ?? "rest"}`} naam={tak.naam}
                    bevestigd={tak.bevestigd} aantal={tak.aantal} totaal={subtotaal(tak.klanten)} />,
                  ...tak.klanten.map(klantRij),
                ])
              : displayClients.map(klantRij))}
          </Body>
          {/* De som van de zichtbare klanten. Stond alleen in de blauwe kop bovenaan, ver van de
              kolommen af; hier sluit hij aan op de cijfers waar hij bij hoort. De ROAS komt uit de
              totalen — een gemiddelde van klant-ROAS'en weegt een klant met € 2.000 spend even
              zwaar als een met € 400.000. */}
          <TotaalRij>
            <TotaalCel>Alle klanten met spend ({activeCount})</TotaalCel>
            <TotaalCel getal>{num(portfolioConv)}</TotaalCel>
            <TotaalCel getal>{""}</TotaalCel>
            <TotaalCel getal>{fmt(portfolioRev)}</TotaalCel>
            <TotaalCel getal>{formatRoas(portfolioRoas)}</TotaalCel>
            <TotaalCel getal>{portfolioConv > 0 ? fmt(portfolioSpend / portfolioConv) : "—"}</TotaalCel>
            <TotaalCel getal>{fmt(portfolioSpend)}</TotaalCel>
            <TotaalCel>{""}</TotaalCel>
            <TotaalCel>{""}</TotaalCel>
          </TotaalRij>
        </Tabel>
        {emptyCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-gray-50/50 text-meta text-muted-foreground">
            <span>
              {showEmpty
                ? `${emptyCount} lege ${emptyCount === 1 ? "account" : "accounts"} zonder spend worden getoond.`
                : `${emptyCount} lege ${emptyCount === 1 ? "account" : "accounts"} zonder spend ${emptyCount === 1 ? "is" : "zijn"} verborgen.`}
            </span>
            <button
              onClick={() => setShowEmpty((v) => !v)}
              className="font-semibold text-rm-blue-ink hover:underline"
            >
              {showEmpty ? "Verberg lege accounts" : "Toon alles"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
