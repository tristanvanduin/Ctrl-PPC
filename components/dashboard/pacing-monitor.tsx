"use client";

import { useMemo } from "react";
import { Clock, Target, Zap, AlertTriangle, TrendingUp, Calendar, Flag } from "lucide-react";
import { useClientHistoricalData } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { weeksToFair, type UpcomingEdition } from "@/lib/fair/fair-weeks";
import { today } from "@/lib/reporting-date";
import { berekenLanding, seizoensduiding } from "@/lib/pacing/landing";

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function num(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(v);
}

// 23 augustus 2026: van 44 naar 72px. Twee redenen, en de tweede is de belangrijkste.
//
// (1) Leesbaarheid. Het percentage stond in een ring van 44px in `text-micro` -- op een
//     1920px-scherm is dat een cijfer van een paar millimeter, terwijl het de eerste vraag van
//     deze kaart beantwoordt ("lopen we op schema"). De eigenaar wees er zelf op: "dan worden die
//     kleine donuts wat groter en leesbaarder".
//
// (2) Hoogte. Deze kaart deelt een rasterrij met de campagnetype-donut en was daarvan de laagste
//     (270px tegen 364px). Dat verschil werd opgevangen door de zes blokken uit elkaar te
//     trekken. Grotere ringen vullen dezelfde ruimte met inhoud in plaats van met lucht -- dat is
//     de regel die de eigenaar eerder gaf: "of je maakt een sectie langer, of je voegt iets
//     extras toe".
//
// De ringdikte schaalt mee (5 op 44 werd optisch dun op 128); de verhouding blijft gelijk.
function PacingRing({ pct, color, size = 128 }: { pct: number; color: string; size?: number }) {
  const dikte = Math.max(5, Math.round(size / 9));
  const r = (size - dikte - 1) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct / 100, 1) * circ;

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E1E5F2" strokeWidth={dikte} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color}
        strokeWidth={dikte}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
      />
    </svg>
  );
}

export function PacingMonitor({ clientId, countryFilter, edition }: { clientId: string; countryFilter?: string | null; edition?: UpcomingEdition | null }) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const forecast = useMemo(() => computeForecast(data), [data]);

  const conv = forecast.conversions.kpi;
  const spend = forecast.adSpend.kpi;
  const rev = forecast.revenue.kpi;

  const now = new Date();

  // Year progress
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const yearProgressPct = (dayOfYear / 365) * 100;

  // Stuurt de klant op een beurs, dan is "dag 209 van 365" geen ijkpunt maar ruis: het jaar
  // loopt door, de beurs is een deadline. De doelen blijven jaardoelen — daarom blijft het
  // jaarverloop erbij staan; alleen de kop leidt met de afstand die er wél toe doet.
  const wekenTotBeurs = edition ? weeksToFair(edition.fairDate, today()) : null;

  // Year pacing: compare realized vs EXPECTED for this period (not linear annual %)
  // This accounts for seasonality — Q1 might only be 15% of the annual target, not 25%
  const convExpectedYtd = conv.ytdExpected;
  const spendExpectedYtd = spend.ytdExpected;

  // Pacing %: how far are we toward annual target
  const convPacingPct = conv.annualTarget > 0 ? (conv.ytdRealized / conv.annualTarget) * 100 : 0;
  const spendPacingPct = spend.annualTarget > 0 ? (spend.ytdRealized / spend.annualTarget) * 100 : 0;
  const revPacingPct = rev.annualTarget > 0 ? (rev.ytdRealized / rev.annualTarget) * 100 : 0;

  // On pace? Compare realized vs what was EXPECTED for this period (season-aware)
  const convPaceRatio = convExpectedYtd > 0 ? conv.ytdRealized / convExpectedYtd : 1;
  const spendPaceRatio = spendExpectedYtd > 0 ? spend.ytdRealized / spendExpectedYtd : 1;

  // Daily run rate
  const daysElapsed = Math.max(dayOfYear, 1);
  const dailyConvRate = conv.ytdRealized / daysElapsed;
  const dailySpendRate = spend.ytdRealized / daysElapsed;
  const remainingDays = 365 - dayOfYear;
  // "Nodig per dag" based on remaining target gap (target - realized so far)
  const convGap = Math.max(0, conv.annualTarget - conv.ytdRealized);
  const spendGap = Math.max(0, spend.annualTarget - spend.ytdRealized);
  const convNeededPerDay = remainingDays > 0 ? convGap / remainingDays : 0;
  const spendNeededPerDay = remainingDays > 0 ? spendGap / remainingDays : 0;

  // ── Waar land je? ──────────────────────────────────────────────────────
  //
  // De kaart zei hoe hard je gaat en wat er nodig is, maar niet waar je dan uitkomt -- terwijl dat
  // de vraag is die er meteen op volgt. Twee antwoorden, want een rechte lijn en de prognose zijn
  // niet hetzelfde: zie lib/pacing/landing.ts.
  const convLanding = berekenLanding({
    gerealiseerd: conv.ytdRealized,
    tempoPerDag: dailyConvRate,
    dagenResterend: remainingDays,
    prognose: conv.adjustedAnnual,
    doel: conv.annualTarget,
  });
  const convSeizoen = seizoensduiding(convLanding);

  // Status colors & labels
  // Conversions: straightforward pace check
  const convColor = convPaceRatio >= 0.9 ? "#22c55e" : convPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const convStatus = convPaceRatio >= 0.9 ? "Op schema" : convPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  // Budget: also consider whether spend is translating into results
  // If spend is "on track" but conversions are far behind, the spend is inefficient
  const spendIsOnPace = spendPaceRatio >= 0.9;
  const convIsWayBehind = convPaceRatio < 0.7;
  const spendColor = spendIsOnPace && convIsWayBehind
    ? "#f59e0b"  // amber: spending enough but not getting results
    : spendPaceRatio >= 0.9 ? "#22c55e" : spendPaceRatio >= 0.7 ? "#f59e0b" : "#ef4444";
  const spendStatus = spendIsOnPace && convIsWayBehind
    ? "Inefficiënt"
    : spendPaceRatio >= 0.9 ? "Op schema" : spendPaceRatio >= 0.7 ? "Achterlopend" : "Sterk achter";

  return (
    // `flex h-full flex-col` + een grid dat `flex-1` is: deze kaart deelt een rasterrij met de
    // campagnetype-donut, en die is inhoudelijk hoger (364px tegen 203-270px op brede schermen).
    // Rasterrijen rekken naar de hoogste cel, dus stond het verschil als wit ONDER de zes blokken.
    // Nu rekken de blokken zelf mee en staat hun inhoud verticaal gecentreerd: dezelfde hoogte,
    // maar gevuld in plaats van afgetopt.
    <div className="@container flex h-full flex-col bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Pacing</h3>
        <span className="text-micro text-muted-foreground ml-auto">
          {wekenTotBeurs != null && wekenTotBeurs >= 0 && (
            <span className="font-semibold text-brand-blue-ink mr-1.5">
              Nog {wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"} tot {edition!.label} ·
            </span>
          )}
          Dag {dayOfYear} van 365 · {Math.round(yearProgressPct)}% van het jaar
        </span>
      </div>

      {/* Zes blokken op een rij, en dat is geen opmaakkeuze maar een leesrichting: waar staan we
          (twee ringen), hoe hard gaan we (twee tempo's), waar landt dat (twee uitkomsten). Elk
          blok volgt uit het vorige. "Tempo conversies 3/dag" en "Op dit tempo 1.086" horen naast
          elkaar omdat het tweede letterlijk uit het eerste volgt.

          De landing stond eerst onder een scheidingslijn. Dat gebruikte 40% van de breedte en liet
          de rest leeg -- hetzelfde gat als elders, alleen binnen een kaart.

          @6xl en niet lg: op een breedte waar zes blokken niet passen vallen ze terug op twee
          kolommen. lg: kijkt naar het venster en ziet die kaartbreedte niet. De grens stond op
          @2xl (672px); daar sloeg de kaart al bij een hero-kolom van 784px om naar drie kolommen
          en werd hij 276px hoog naast een donut-kaart van 364px. Op @6xl (1152px) blijft het bij
          twee kolommen van drie, en dat is precies de hoogte die de rij toch al vraagt -- de
          blokken worden er breder van in plaats van dat de kaart lucht krijgt.

          @7xl en niet @5xl voor de eenrijige variant: op 1024px kaartbreedte werden het zes smalle
          kolommen op EEN rij, en dan is de kaart 203px hoog naast een donut-kaart van 364px --
          161px die als lucht tussen de blokken landde. Op 1280px is er ook echt ruimte voor zes
          kolommen naast elkaar; daaronder blijven het twee rijen van drie, en dat is precies de
          hoogte die de rij vraagt.

          Vijf kolommen i.p.v. zes zonder "volgens prognose" (geen seizoensmodel voor dit account):
          met een vaste zes-koloms grid en maar vijf blokken bleef de laatste kolom leeg -- geen
          witruimte maar een gat, precies waar de eigen comment hierboven al voor waarschuwt. */}
      <div className={`grid flex-1 grid-cols-2 items-stretch gap-4 @6xl:grid-cols-3 ${
        convLanding.volgensPrognose !== null ? "@7xl:grid-cols-6" : "@7xl:grid-cols-5"
      }`}>
        {/* Conversions pacing */}
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <PacingRing pct={convPacingPct} color={convColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-figure font-bold leading-none tabular-nums" style={{ color: convColor }}>
                {Math.round(convPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-title font-semibold text-brand-gray">Conversies</p>
            <p className="text-body text-muted-foreground">{num(conv.ytdRealized)} / {num(conv.annualTarget)}</p>
            <p className="text-body font-semibold" style={{ color: convColor }}>{convStatus}</p>
          </div>
        </div>

        {/* Spend pacing */}
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <PacingRing pct={spendPacingPct} color={spendColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-figure font-bold leading-none tabular-nums" style={{ color: spendColor }}>
                {Math.round(spendPacingPct)}%
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-title font-semibold text-brand-gray">Budget</p>
            <p className="text-body text-muted-foreground">{fmt(spend.ytdRealized)} / {fmt(spend.annualTarget)}</p>
            <p className="text-body font-semibold" style={{ color: spendColor }}>{spendStatus}</p>
          </div>
        </div>

        {/* Daily run rate — conversions */}
        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo conversies</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-figure font-bold leading-none text-brand-gray">{num(dailyConvRate)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          {convNeededPerDay > 0 && (
            // Feedback: "X nodig???" -- het ✗-teken vóór "Nodig" rendert onduidelijk (leest als
            // een losse letter X, niet als een kruisje). Woorden i.p.v. een dubbelzinnig
            // glyph -- kleur blijft de tweede, niet de enige drager van de status.
            <p className={`text-micro mt-1 ${dailyConvRate >= convNeededPerDay ? "text-green-600" : "text-red-500"}`}>
              {dailyConvRate >= convNeededPerDay ? "Op tempo" : "Nog niet op tempo"} — nodig: {num(convNeededPerDay)}/dag
            </p>
          )}
        </div>

        {/* Daily run rate — spend */}
        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-figure font-bold leading-none text-brand-gray">{fmt(dailySpendRate)}</span>
            <span className="text-micro text-muted-foreground">/dag</span>
          </div>
          {spendNeededPerDay > 0 && (
            <p className={`text-micro mt-1 ${dailySpendRate >= spendNeededPerDay * 0.9 ? "text-green-600" : "text-red-500"}`}>
              {dailySpendRate >= spendNeededPerDay * 0.9 ? "Op tempo" : "Nog niet op tempo"} — nodig: {fmt(spendNeededPerDay)}/dag
            </p>
          )}
        </div>

        {/* Waar dat op uitkomt: kolom vijf en zes van dezelfde rij, niet een blok eronder.

            Het stond eerst onder een scheidingslijn en gebruikte daar 40% van de breedte -- twee
            lege kolommen naast zich, hetzelfde gat als elders maar dan binnen een kaart. En het
            hoort inhoudelijk in die rij: de rij leest van links naar rechts als waar staan we
            (twee ringen), hoe hard gaan we (twee tempo's), waar landt dat (twee uitkomsten). "Op
            dit tempo 1.086" volgt letterlijk uit "Tempo conversies 3/dag" ernaast.

            Twee getallen en niet een: "op dit tempo" is een rechte lijn en met de hand na te
            rekenen, de prognose weet dat november niet op juli lijkt. Alleen het eerste tonen zou
            de prognosegrafiek elders op het scherm tegenspreken.

            "geschat jaardoel" en niet "jaardoel": dat getal is vorig jaar x 1,10 uit
            client-data/route.ts, want er is nog geen scherm om een doel in te voeren. */}
        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Flag className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{num(convLanding.opTempo)}</span>
          {convLanding.deelVanDoel !== null && (
            <p className="text-micro mt-1 text-muted-foreground">
              {Math.round(convLanding.deelVanDoel * 100)}% van geschat jaardoel
            </p>
          )}
        </div>

        {convLanding.volgensPrognose !== null && (
          <div className="flex flex-col justify-center border-l border-border pl-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Volgens prognose</p>
            </div>
            <span className="text-figure font-bold leading-none text-brand-gray">{num(convLanding.volgensPrognose)}</span>
            <p className="text-micro mt-1 text-muted-foreground">seizoen meegerekend</p>
          </div>
        )}
      </div>

      {/* De duiding onder de hele rij en niet in een kolom: het is een zin over het VERSCHIL tussen
          twee van die blokken, dus hij hoort bij geen van beide alleen. Alleen bij een afwijking
          die ertoe doet -- een zin over elke afwijking leert de lezer hem over te slaan. */}
      {convSeizoen && (
        <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
          {convSeizoen}
        </p>
      )}
    </div>
  );
}
