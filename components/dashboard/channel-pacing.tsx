"use client";

import { useMemo } from "react";
import { Zap, TrendingUp, Calendar, Flag, Target } from "lucide-react";
import { today as vandaag } from "@/lib/reporting-date";
import { weeksToFair, type UpcomingEdition } from "@/lib/fair/fair-weeks";
import { berekenMaandPacing } from "@/lib/kanalen/maand-pacing";
import { useKanaalDagen } from "@/lib/kanalen/use-kanaal-dagen";
import { eur, fmt, type ChannelKind } from "./channel-performance";
import { PacingRing } from "./pacing-monitor";
import { Laadvlak } from "@/components/ui/laadvlak";

// Pacing voor Meta en LinkedIn, als eigen kaart in de hero -- naast Account Health, op dezelfde
// plek waar Google's PacingMonitor staat.
//
// Waarom een eigen component en geen tweede PacingMonitor: die leest Google's jaardoel en
// jaarprognose (ClientDataProvider/computeForecast), en dat pad bestaat voor deze kanalen niet.
// Hier is de vergelijking maand-tot-nu tegen dezelfde dag-telling van de vorige maand -- geen doel
// nodig, wel eerlijk tempo. De rekenkern staat in lib/kanalen/maand-pacing.ts en wordt gedeeld met
// channel-performance.tsx, dat hem al gebruikte.
//
// Waarom een eigen, KLEIN venster en niet dat van ChannelPerformance: die haalt 200 dagen account-
// EN campagnedata plus campagnenamen op, voor de maandtabel en de beurs-splitsing. Deze kaart heeft
// aan de huidige en de vorige maand genoeg. De fetch zelf is wel gedeeld (useKanaalDagen), zodat er
// niet twee plekken zijn die elk hun eigen idee hebben van welke velden als conversie tellen.

export function ChannelPacing({ clientId, channel, edition }: {
  clientId: string;
  channel: ChannelKind;
  edition?: UpcomingEdition | null;
}) {
  // 70 dagen: genoeg om de volle vorige maand te dekken, ook op dag 1 van de huidige.
  const { rijen, convVan, convLabel } = useKanaalDagen(clientId, channel, 70);

  const pacing = useMemo(() => {
    if (!rijen || rijen.length === 0) return null;
    return berekenMaandPacing(rijen, convVan, vandaag());
  }, [rijen, convVan]);

  if (rijen === null) return <Laadvlak vorm="grafiek" hoogte={200} titel="Pacing" />;
  if (!pacing) return null;

  const { dagVanMaand, mtdSpend, mtdConv, vorigeSpend, vorigeConv, spendRatio, convRatio } = pacing;
  const wekenTotBeurs = edition ? weeksToFair(edition.fairDate, vandaag()) : null;

  // De kleur zegt niet "goed of slecht" maar "in de pas of niet". Boven 115% loopt het kanaal
  // harder dan vorige maand, en dat is een signaal en geen fout: bij spend hoort daar een blik op
  // het budget bij, bij conversies is het juist het gewenste beeld. Vandaar amber en niet rood.
  const kleurVan = (ratio: number | null, hogerIsBeter: boolean) => {
    if (ratio == null) return "#9ca3af";
    if (ratio >= 1.15) return hogerIsBeter ? "#22c55e" : "#f59e0b";
    if (ratio >= 0.85) return "#22c55e";
    return hogerIsBeter ? "#f59e0b" : "#22c55e";
  };
  const spendKleur = kleurVan(spendRatio, false);
  const convKleur = kleurVan(convRatio, true);
  const tekstVan = (ratio: number | null) =>
    ratio == null ? "Geen vorige maand" : ratio >= 1.15 ? "Loopt voor" : ratio >= 0.85 ? "In de pas" : "Loopt achter";

  const dagenGeteld = Math.max(dagVanMaand, 1);
  const spendPerDag = mtdSpend / dagenGeteld;
  const convPerDag = mtdConv / dagenGeteld;
  // Rechtdoor tot het einde van de maand: dezelfde "op dit tempo"-vraag als bij Google, maar dan
  // op maandbasis. Bewust géén seizoensmodel -- dat bestaat voor deze kanalen niet, en een
  // prognose suggereren die er niet is, is erger dan een rechte lijn die zichzelf zo noemt.
  const dagenInMaand = new Date(new Date(vandaag()).getFullYear(), new Date(vandaag()).getMonth() + 1, 0).getDate();
  const spendEindeMaand = spendPerDag * dagenInMaand;
  const convEindeMaand = convPerDag * dagenInMaand;

  const pctVan = (ratio: number | null) => (ratio == null ? 0 : Math.round(ratio * 100));

  return (
    // Zelfde opbouw als pacing-monitor.tsx: `flex h-full flex-col` met het blokkenraster als
    // `flex-1`, zodat deze kaart de opvanger van zijn kolom kan zijn (zie meta-view.tsx).
    <div className="@container flex h-full flex-col bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Zap className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Pacing</h3>
        <span className="text-micro text-muted-foreground ml-auto">
          {wekenTotBeurs != null && wekenTotBeurs >= 0 && (
            <span className="font-semibold text-brand-blue-ink mr-1.5">
              Nog {wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"} tot {edition!.label}
            </span>
          )}
          Maand tot nu · dag {dagVanMaand} van {dagenInMaand} · vergeleken met vorige maand op dag {dagVanMaand}
        </span>
      </div>

      <div className="grid flex-1 grid-cols-2 items-stretch gap-4 @6xl:grid-cols-3 @7xl:grid-cols-6">
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <PacingRing pct={pctVan(spendRatio)} color={spendKleur} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-figure font-bold leading-none tabular-nums" style={{ color: spendKleur }}>
                {spendRatio == null ? "—" : `${pctVan(spendRatio)}%`}
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-title font-semibold text-brand-gray">Spend</p>
            <p className="text-body text-muted-foreground">{eur(mtdSpend)} / {eur(vorigeSpend)}</p>
            <p className="text-body font-semibold" style={{ color: spendKleur }}>{tekstVan(spendRatio)}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <PacingRing pct={pctVan(convRatio)} color={convKleur} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-figure font-bold leading-none tabular-nums" style={{ color: convKleur }}>
                {convRatio == null ? "—" : `${pctVan(convRatio)}%`}
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-title font-semibold text-brand-gray">{convLabel || "Conversies"}</p>
            <p className="text-body text-muted-foreground">{fmt(mtdConv, 1)} / {fmt(vorigeConv, 1)}</p>
            <p className="text-body font-semibold" style={{ color: convKleur }}>{tekstVan(convRatio)}</p>
          </div>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendPerDag)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld deze maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo {convLabel || "conversies"}</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-figure font-bold leading-none text-brand-gray">{fmt(convPerDag, 1)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld deze maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Flag className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendEindeMaand)}</span>
          <p className="text-micro mt-1 text-muted-foreground">spend eind van de maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{fmt(convEindeMaand, 1)}</span>
          <p className="text-micro mt-1 text-muted-foreground">{convLabel || "conversies"} eind van de maand</p>
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        Rechte lijn tot het eind van de maand, geen seizoensmodel: voor dit kanaal is er geen
        jaardoel en geen seizoenspatroon in het systeem, dus dit is wat het tempo van vandaag
        oplevert als het niet verandert.
      </p>
    </div>
  );
}
