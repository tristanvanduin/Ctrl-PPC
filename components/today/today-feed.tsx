"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, Scale, Eye, CheckCircle2, DatabaseZap, MoonStar } from "lucide-react";
import { useTodayFeed } from "@/lib/feed/use-today-feed";
import type { FeedItem, FeedSeverity, FeedChannel } from "@/lib/feed/feed-item";
import { FeedCard } from "./feed-card";
import { Kerncijfer } from "@/components/ui/kerncijfer";
import { CodeRoodPaneel } from "@/components/adoptie/code-rood-paneel";
import { GodViewTeaser } from "@/components/terminal/god-view-teaser";

// De "Vandaag"-cockpit: cross-client triage. Beantwoordt in één blik — is er iets kapot,
// welke beslissingen wachten, wat moet vandaag, wat is nieuw, en wie is veilig buiten beeld.
// Leest bestaande bronnen via useTodayFeed; verandert geen analyse/forecast/drempel.

type OwnerFilter = "team" | "mine" | "unassigned";
type ChannelFilter = "all" | FeedChannel;

const BANDS: { key: FeedSeverity; label: string; lede: string; icon: React.ReactNode; dot: string; count: string }[] = [
  { key: "critical", label: "Kapot / tijdkritisch", lede: "verloopt vandaag · gesorteerd op € risico", icon: <AlertTriangle className="w-4 h-4 text-red-500" />, dot: "bg-red-500", count: "bg-red-500 text-white" },
  { key: "decision", label: "Beslissing gevraagd", lede: "door de data voorbereid · gesorteerd op impact & ICE", icon: <Scale className="w-4 h-4 text-amber-500" />, dot: "bg-amber-400", count: "bg-amber-400 text-white" },
  { key: "watch", label: "Volgt / deze week", lede: "geen brand · kan wachten", icon: <Eye className="w-4 h-4 text-gray-400" />, dot: "bg-gray-300", count: "bg-gray-300 text-brand-gray" },
];

function Pulse({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  // De pols van de dag. Het kaartje blijft van deze pagina; het cijfer erin komt uit de gedeelde
  // tegel, zodat het dezelfde maat heeft als hetzelfde soort cijfer op een klantpagina.
  return (
    <div className="bg-card rounded-xl border border-border px-3.5 py-2 shadow-sm min-w-[104px]">
      <Kerncijfer
        label={label}
        waarde={value}
        formaat="compact"
        toon={tone === "warn" ? "waarschuwing" : tone === "ok" ? "goed" : undefined}
      />
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex bg-gray-100 border border-border rounded-lg p-0.5 gap-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`text-[12.5px] font-medium px-3 py-1.5 rounded-md transition-colors ${value === o.v ? "bg-card text-brand-blue-ink shadow-sm" : "text-muted-foreground hover:text-brand-gray"}`}>{o.l}</button>
      ))}
    </div>
  );
}

const eur = (v: number): string => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

// Hoeveel kaarten per band standaard zichtbaar zijn voor "Toon meer" inklapt. Elke band rendert
// zonder deze grens ongelimiteerd -- gemeten op demo-greentech: 349 kaarten in één ongepagineerde
// kolom, een pagina van bijna 57.000px. Precies het soort "het is geen bug, het rendert gewoon"
// dat deze codebase elders al kent (zie AGENTS.md's kaartoverloop-controle): geen van de tests of
// de build zag dit, want er is niets kapot -- de lijst is alleen nooit bedoeld om ongelimiteerd te
// tonen op een "wat vraagt vandaag aandacht"-triagescherm.
const BAND_PAGE_SIZE = 15;

export function TodayFeed() {
  const feed = useTodayFeed();
  const [owner, setOwner] = useState<OwnerFilter>("team");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [expanded, setExpanded] = useState<Record<FeedSeverity, boolean>>({ critical: false, decision: false, watch: false });

  const match = useMemo(() => (i: FeedItem): boolean => {
    if (channel !== "all" && i.channel !== channel) return false;
    if (owner === "unassigned" && i.ownerName) return false;
    if (owner === "mine" && i.ownerName !== feed.currentUser) return false;
    return true;
  }, [channel, owner, feed.currentUser]);

  const bands = useMemo(() => ({
    critical: feed.bands.critical.filter(match),
    decision: feed.bands.decision.filter(match),
    watch: feed.bands.watch.filter(match),
  }), [feed.bands, match]);

  const myActions = useMemo(() => feed.myActions.filter(match), [feed.myActions, match]);
  const snoozedVisible = useMemo(() => feed.snoozed.filter(match), [feed.snoozed, match]);
  const totalVisible = bands.critical.length + bands.decision.length + bands.watch.length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Goedemorgen" : now.getHours() < 18 ? "Goedemiddag" : "Goedenavond";
  const dateStr = now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (feed.loading) {
    return <div className="flex items-center justify-center py-20 gap-3"><Loader2 className="w-6 h-6 animate-spin text-brand-blue-ink" /><p className="text-sm text-muted-foreground">Vandaag samenstellen…</p></div>;
  }

  // Geen live data én geen demo-mode: heldere data-unavailable state i.p.v. stilletjes demo tonen.
  if (!feed.demoMode && !feed.hasRealData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-page font-bold text-brand-gray">{greeting}{feed.currentUser ? `, ${feed.currentUser.split("@")[0]}` : ""}</h1>
          <p className="text-lead text-muted-foreground capitalize">{dateStr}</p>
        </div>
        {feed.error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-body text-amber-800">{feed.error}</div>}
        <div className="rounded-xl border border-border bg-card shadow-sm p-10 text-center max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center mx-auto mb-4"><DatabaseZap className="w-6 h-6 text-brand-blue-ink" /></div>
          <p className="text-title font-semibold text-brand-gray">Geen live data beschikbaar voor de Vandaag-feed.</p>
          <p className="text-lead text-muted-foreground mt-1.5">Koppel databronnen of bekijk een demo van de triagecockpit.</p>
          <div className="flex gap-2.5 justify-center mt-5">
            <Link href="/vandaag?demo=1" className="text-lead font-semibold text-white bg-brand-blue rounded-lg px-4 py-2 hover:brightness-110">Bekijk demo</Link>
            <Link href="/portfolio" className="text-lead font-semibold text-brand-gray border border-border rounded-lg px-4 py-2 hover:border-brand-blue hover:text-brand-blue-ink">Ga naar portfolio</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Kop + pols */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page font-bold text-brand-gray">{greeting}{feed.currentUser ? `, ${feed.currentUser.split("@")[0]}` : ""}</h1>
          <p className="text-lead text-muted-foreground capitalize">{dateStr}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pulse label="Aandacht nodig" value={String(feed.pulse.attention)} tone={feed.pulse.attention > 0 ? "warn" : "ok"} />
          <Pulse label="Op koers" value={String(feed.pulse.onTrack)} tone="ok" />
          <Pulse label="Risico open (gemeten)" value={feed.pulse.measuredRisk > 0 ? eur(feed.pulse.measuredRisk) : "€0"} tone={feed.pulse.measuredRisk > 0 ? "warn" : undefined} />
          <Pulse label="Niet toegewezen" value={String(feed.pulse.unassigned)} tone={feed.pulse.unassigned > 0 ? "warn" : undefined} />
          {feed.pulse.openTodos > 0 && <Pulse label="Taken open" value={String(feed.pulse.openTodos)} />}
        </div>
      </div>

      {feed.error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-body text-amber-800">{feed.error}</div>}
      {feed.demoMode && (
        <div className="rounded-lg border border-purple-300 bg-purple-50 px-4 py-3 text-[12.5px] text-purple-900 flex items-start gap-2.5">
          <MoonStar className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong>Demo-modus actief:</strong> deze signalen zijn voorbeelddata en tellen niet mee als echte businessdata. De cijfers hieronder zijn <strong>demo-cijfers</strong>.
            <Link href="/" className="ml-2 font-semibold underline whitespace-nowrap">Terug naar de echte feed →</Link>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Seg value={owner} onChange={setOwner} options={[{ v: "team", l: "Team" }, { v: "mine", l: "Mijn" }, { v: "unassigned", l: "Niet toegewezen" }]} />
        <Seg value={channel} onChange={setChannel} options={[{ v: "all", l: "Alle kanalen" }, { v: "google", l: "Google" }, { v: "meta", l: "Meta" }, { v: "linkedin", l: "LinkedIn" }, { v: "microsoft", l: "Microsoft" }]} />
        <span className="ml-auto text-meta font-mono text-muted-foreground bg-card border border-border rounded-full px-3 py-1">Nieuw sinds gisteren · {feed.pulse.newSince}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Feed */}
        <div className="space-y-6">
          {/* Code Rood/Amber: klant-churnrisico, los van de triage-banden hieronder -- zie de
              koptekst van code-rood-paneel.tsx voor waarom dit een eigen vocabulaire heeft. Toont
              zichzelf niet (null) zolang er niets open staat. */}
          <CodeRoodPaneel />

          {BANDS.map((b) => (
            <section key={b.key}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />
                <h2 className="text-sm font-bold text-brand-gray">{b.label}</h2>
                <span className={`text-meta font-bold rounded-full px-2 py-0.5 tabular-nums ${b.count}`}>{bands[b.key].length}</span>
                <span className="text-meta text-muted-foreground ml-auto text-right">{b.lede}</span>
              </div>
              {bands[b.key].length === 0 ? (
                <p className="text-body text-muted-foreground bg-card border border-border rounded-lg px-4 py-3">Niets in deze band{owner !== "team" || channel !== "all" ? " binnen dit filter" : ""}.</p>
              ) : (
                <div className="space-y-2">
                  {(expanded[b.key] ? bands[b.key] : bands[b.key].slice(0, BAND_PAGE_SIZE)).map((item) => (
                    <FeedCard key={item.id} item={item} onSnooze={feed.snooze} onAssign={feed.assign} onStatus={feed.setStatus} />
                  ))}
                  {!expanded[b.key] && bands[b.key].length > BAND_PAGE_SIZE && (
                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [b.key]: true }))}
                      className="text-meta font-medium text-brand-blue-ink hover:underline px-1"
                    >
                      Toon {bands[b.key].length - BAND_PAGE_SIZE} meer
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}

          {totalVisible === 0 && (
            <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-5 py-4 text-lead text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4.5 h-4.5" />
              Onder deze lijn: {feed.pulse.onTrack} klanten op koers, niets dat vandaag je aandacht vraagt.
            </div>
          )}

          {/* Gesnoozed — komt terug op de ingestelde tijd */}
          {snoozedVisible.length > 0 && (
            <section>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                <h2 className="text-sm font-bold text-brand-gray">Gesnoozed</h2>
                <span className="text-meta font-bold rounded-full px-2 py-0.5 tabular-nums bg-gray-200 text-brand-gray">{snoozedVisible.length}</span>
                <span className="text-meta text-muted-foreground ml-auto">komt terug op de ingestelde tijd</span>
              </div>
              <div className="space-y-2">
                {snoozedVisible.map((item) => (
                  <div key={item.id} className="bg-card rounded-xl border border-border border-l-[3px] border-l-gray-300 shadow-sm p-3 flex items-center gap-3 opacity-80">
                    <span className="text-lead font-semibold text-brand-gray truncate max-w-[32%]">{item.clientName}</span>
                    <span className="text-body text-muted-foreground truncate flex-1 min-w-0">{item.title}</span>
                    {item.snoozeReason && <span className="text-meta text-gray-400 italic truncate hidden sm:inline">&ldquo;{item.snoozeReason}&rdquo;</span>}
                    {item.snoozedUntil && <span className="text-meta font-mono text-gray-400 shrink-0">tot {item.snoozedUntil.slice(0, 10)}</span>}
                    {item.isMock && <span className="text-micro font-bold uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">Demo</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Feedback: "tease god mode" voor bureaus zonder platformtoegang -- TodayFeed is precies
              die doelgroep (zie app/(app)/vandaag/page.tsx: God Mode en Agency God View takken eerder
              af). Onderaan, na de echte content, niet ervoor. */}
          {!feed.demoMode && <GodViewTeaser />}
        </div>

        {/* Rechterkolom */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-meta font-mono uppercase tracking-wider text-muted-foreground">Mijn acties vandaag</h3>
              <span className="text-body font-bold text-brand-blue-ink tabular-nums">{myActions.length}</span>
            </div>
            <p className="text-[10.5px] text-gray-400 mb-2.5">= dezelfde feed, gefilterd op deadline vandaag/verlopen{feed.currentUser ? " of jouw naam" : ""}</p>
            {myActions.length === 0 ? (
              <p className="text-body text-muted-foreground">Geen acties met deadline vandaag.</p>
            ) : (
              <ul className="space-y-2">
                {myActions.slice(0, 8).map((i) => (
                  <li key={i.id} className="text-[12.5px] border-t border-border pt-2 first:border-0 first:pt-0">
                    <span className="text-brand-gray">{i.title}</span>
                    <span className="block text-meta text-muted-foreground font-mono mt-0.5">{i.clientName}{i.dueAt ? ` · ${new Date(i.dueAt) <= now ? "verlopen" : i.dueAt.slice(0, 10)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <h3 className="text-meta font-mono uppercase tracking-wider text-muted-foreground mb-3">Nieuw sinds gisteren</h3>
            {(["critical", "decision", "watch"] as FeedSeverity[]).map((k, idx) => (
              <div key={k} className={`flex justify-between text-[12.5px] py-1.5 ${idx > 0 ? "border-t border-border" : ""}`}>
                <span className="text-muted-foreground">{k === "critical" ? "Kapot / tijdkritisch" : k === "decision" ? "Beslissing gevraagd" : "Volgt deze week"}</span>
                <span className="font-mono font-bold tabular-nums text-brand-gray">+{feed.newByBand[k]}</span>
              </div>
            ))}
            <div className="flex justify-between text-[12.5px] py-1.5 border-t border-border">
              <span className="text-muted-foreground">Automatisch opgelost</span>
              <span className="font-mono font-bold tabular-nums text-emerald-600">{feed.pulse.autoResolved}</span>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border shadow-sm p-4">
            <h3 className="text-meta font-mono uppercase tracking-wider text-muted-foreground mb-3">Wanneer kleurt het?</h3>
            <ul className="space-y-2.5">
              <li className="flex gap-2.5 text-body text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 mt-1 shrink-0" /><span><strong className="text-brand-gray">Rood</strong> — tracking/sync kapot, budget acuut fout, grote spend-anomalie, conversies vallen weg, deadline vandaag/verlopen. Schaars &amp; vandaag actioneerbaar.</span></li>
              <li className="flex gap-2.5 text-body text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 mt-1 shrink-0" /><span><strong className="text-brand-gray">Oranje</strong> — beslissing nodig, substantiële afwijking, hoge ICE, budgetherallocatie.</span></li>
              <li className="flex gap-2.5 text-body text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 mt-1 shrink-0" /><span><strong className="text-brand-gray">Geel</strong> — optimalisatiekans, trendverslechtering, monitoring.</span></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
