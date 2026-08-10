// Fase 4: de T-minus-X event-module, generiek over "elk event" (Black Friday, een sale-
// periode, een beursditie) in plaats van alleen RAI-beurzen. Kalender-MoM/YoY vergelijkt
// ongelijke momenten -- 8 dagen voor Black Friday dit jaar met 8 dagen voor Black Friday
// vorig jaar is de eerlijke vergelijking, niet "november dit jaar vs november vorig jaar".
//
// GEEN nieuwe rekenkern. De T-minus-wiskunde (dagen-tot-event, editie-over-editie op gelijke
// afstand, sjabloon-projectie, kanaal-blending) bestaat al in lib/rai/ en is daar al
// event-agnostisch: Edition/DailyPoint/alignEditionsAtEqualDaysOut/forecastStream nemen
// nergens een RAI- of beursaanname. Alleen lib/rai/event-comparison.ts's RaiEdition voegt een
// geo-clone-dimensie toe (aftakkingen van dezelfde beurs in één account). Een generiek event
// heeft geen aftakkingen -- dus geven we editionId/geoClone dezelfde waarde (de event-id) mee
// aan de bestaande buildEditions/previousEditionFor/priorEditionsFor: die filteren dan
// vanzelf op "hetzelfde event", zonder dat er iets nieuws bij hoeft. Wat WEL nieuw is: de
// databron. Een geo-clone matcht per CAMPAGNE op een naam-afkorting (lib/rai/geo-clone-
// aggregate.ts); een generiek event geldt voor het HELE account, dus is er niets te matchen
// en zijn de al bestaande, vooraf geaggregeerde account-tabellen de rechtstreekse bron (zie
// account-event-points.ts). Puur en los getest; de route levert alleen rijen en instellingen.

import { buildEditions, pickCurrentEdition } from "@/lib/rai/geo-clone-analysis";
import { previousEditionFor, priorEditionsFor, type FairCadence } from "@/lib/rai/event-comparison";
import { alignEditionsAtEqualDaysOut, isWithinWindow, type DailyPoint, type Edition, type EditionComparison } from "@/lib/rai/event-time-axis";
import { forecastAllChannels, type ChannelForecastInput, type ChannelForecastResult, type BlendedForecast } from "@/lib/rai/multi-channel-forecast";
import type { ForecastConfidence } from "@/lib/rai/event-forecast";
import type { Edition as SettingsEdition } from "@/lib/rai/geo-clone-settings";

export interface AccountEventChannelInput {
  channel: string; // "google_ads" | "meta_ads" | "linkedin_ads"
  points: DailyPoint[]; // conversiepunten
  costPoints: DailyPoint[]; // spend-punten
}

export interface AccountEventAnalysisInput {
  eventId: string;
  eventName: string;
  cadence: FairCadence;
  editions: SettingsEdition[]; // uit client_settings.rai_events
  /** Het account-brede doel voor dit event (bijv. client_settings.kpi_targets), niet per kanaal. */
  conversionsTarget: number | null;
  asOfDate: string;
  channels: AccountEventChannelInput[];
}

export interface AccountEventAnalysisResult {
  eventId: string;
  eventName: string;
  currentEditionId: string | null;
  previousEditionId: string | null;
  previousEditionGapDays: number | null;
  cadenceMatches: boolean;
  /** Editie-over-editie, totaal over alle kanalen samen (punten samengevoegd voor het venster). */
  conversions: EditionComparison | null;
  cost: EditionComparison | null;
  perChannelForecast: ChannelForecastResult[];
  /** Het per-kanaal-blend zoals lib/rai/multi-channel-forecast dat berekent (zwakste-schakel-
   *  zekerheid). target/projectedVsTargetPct staan hier NIET op: dat zijn per-kanaal-doelen die
   *  dit account-event niet heeft. Het account-brede doel zit in de velden hieronder. */
  blendedForecast: BlendedForecast | null;
  projectedFinal: number | null;
  target: number | null;
  projectedVsTargetPct: number | null;
  willHitTarget: boolean | null;
  confidence: ForecastConfidence;
  degradations: string[];
  /** true als de projectie het doel mist of de aanloop materieel achterligt: wachtrij-waardig. */
  actionNeeded: boolean;
  markdown: string;
}

const ACTION_BEHIND_PCT = -0.15; // zelfde drempel als de beursanalyse (geo-clone-analysis.ts): bewust gedeeld, geen losse constante om uit sync te raken

function pointsWithin(points: DailyPoint[], edition: Edition): DailyPoint[] {
  return points.filter((p) => isWithinWindow(p.date, edition));
}

export function analyzeAccountEvent(input: AccountEventAnalysisInput): AccountEventAnalysisResult {
  const degradations: string[] = [
    "Google levert alleen maanddata; dagtempo binnen het venster geldt alleen voor kanalen met dagdata (Meta/LinkedIn)",
  ];

  if (input.channels.length === 0) {
    return emptyResult(input, [...degradations, "geen kanaaldata voor dit event; niets te vergelijken"]);
  }

  const editions = buildEditions(input.eventId, input.cadence, input.editions);
  if (editions.length === 0) {
    return emptyResult(input, [
      ...degradations,
      "geen editie-datums geconfigureerd voor dit event; stel ze in bij Instellingen om de T-minus-vergelijking te activeren",
    ]);
  }

  const current = pickCurrentEdition(editions, input.asOfDate);
  if (!current) return emptyResult(input, [...degradations, "geen bruikbare editie gevonden"]);

  const prev = previousEditionFor(editions, current.editionId);
  // Alle eerdere edities, niet alleen de meest recente: de projectie neemt de mediaan, zodat
  // een enkele afwijkende editie de norm niet in zijn eentje zet.
  const alleEerdere = priorEditionsFor(editions, current.editionId);

  // Totaal over alle kanalen: de losse punten samengevoegd. cumulativeThroughDaysOut sommeert
  // op datum binnen het venster, niet op kanaal-identiteit -- samenvoegen voor het totaal is
  // dus correct, dezelfde optelling die forecastAllChannels per kanaal al apart doet.
  const allConvPoints = input.channels.flatMap((c) => c.points);
  const allCostPoints = input.channels.flatMap((c) => c.costPoints);

  const curConv = pointsWithin(allConvPoints, current);
  const prevConv = prev.edition ? pointsWithin(allConvPoints, prev.edition) : [];
  const curCost = pointsWithin(allCostPoints, current);
  const prevCost = prev.edition ? pointsWithin(allCostPoints, prev.edition) : [];

  const conversions = alignEditionsAtEqualDaysOut(
    { edition: current, points: curConv },
    prev.edition ? { edition: prev.edition, points: prevConv } : null,
    input.asOfDate
  );
  const cost = alignEditionsAtEqualDaysOut(
    { edition: current, points: curCost },
    prev.edition ? { edition: prev.edition, points: prevCost } : null,
    input.asOfDate
  );

  // Geen per-kanaal doelen hier (dit is geen geo-clone met eigen goals per aftakking): elk
  // kanaal krijgt target: null, en het account-brede doel wordt hieronder tegen het TOTAAL
  // afgezet -- forecastAllChannels zou een doel alleen optellen als elk kanaal er een had,
  // en dat klopt niet voor één doel dat over alle kanalen samen geldt.
  const channelInputs: ChannelForecastInput[] = input.channels.map((c) => ({
    channel: c.channel,
    current: { edition: current, points: pointsWithin(c.points, current) },
    previous: prev.edition ? { edition: prev.edition, points: pointsWithin(c.points, prev.edition) } : null,
    previousEditions: alleEerdere.map((e) => ({ edition: e, points: pointsWithin(c.points, e) })),
    target: null,
  }));
  const multi = forecastAllChannels(channelInputs, input.asOfDate);
  const blendedForecast = channelInputs.length > 1 ? multi.blended : null;

  const totalProjected = channelInputs.length > 1 ? multi.blended.projectedFinal : multi.perChannel[0]?.forecast.projectedFinal ?? null;
  const confidence: ForecastConfidence = channelInputs.length > 1 ? multi.blended.confidence : multi.perChannel[0]?.forecast.confidence ?? "geen_basis";

  if (input.conversionsTarget == null) {
    degradations.push("geen conversie-doel voor dit event; de projectie heeft geen doel om tegen af te zetten");
  }
  const projectedVsTargetPct =
    totalProjected != null && input.conversionsTarget != null && input.conversionsTarget > 0
      ? Math.round((totalProjected / input.conversionsTarget) * 1000) / 1000
      : null;
  const willHitTarget = projectedVsTargetPct == null ? null : projectedVsTargetPct >= 1;

  const behindMaterially = conversions.comparable && conversions.deltaPct != null && conversions.deltaPct <= ACTION_BEHIND_PCT;
  const missesTarget = willHitTarget === false;
  const actionNeeded = Boolean(behindMaterially || missesTarget);

  const markdown = renderMarkdown(
    input, current, prev.edition?.editionId ?? null, prev.gapDays, prev.cadenceMatches,
    conversions, cost, multi.perChannel, blendedForecast, totalProjected, projectedVsTargetPct, willHitTarget, confidence, degradations
  );

  return {
    eventId: input.eventId,
    eventName: input.eventName,
    currentEditionId: current.editionId,
    previousEditionId: prev.edition?.editionId ?? null,
    previousEditionGapDays: prev.gapDays,
    cadenceMatches: prev.cadenceMatches,
    conversions,
    cost,
    perChannelForecast: multi.perChannel,
    blendedForecast,
    projectedFinal: totalProjected,
    target: input.conversionsTarget,
    projectedVsTargetPct,
    willHitTarget,
    confidence,
    degradations,
    actionNeeded,
    markdown,
  };
}

function emptyResult(input: AccountEventAnalysisInput, degradations: string[]): AccountEventAnalysisResult {
  return {
    eventId: input.eventId,
    eventName: input.eventName,
    currentEditionId: null,
    previousEditionId: null,
    previousEditionGapDays: null,
    cadenceMatches: false,
    conversions: null,
    cost: null,
    perChannelForecast: [],
    blendedForecast: null,
    projectedFinal: null,
    target: input.conversionsTarget,
    projectedVsTargetPct: null,
    willHitTarget: null,
    confidence: "geen_basis",
    degradations,
    actionNeeded: false,
    markdown: [`# T-minus-analyse ${input.eventName}`, "", "## Niet uitvoerbaar", ...degradations.map((d) => `- ${d}`)].join("\n"),
  };
}

const fmtPct = (v: number | null): string => (v == null ? "n.v.t." : `${v >= 0 ? "+" : ""}${Math.round(v * 1000) / 10}%`);
const fmtNum = (v: number | null): string => (v == null ? "n.v.t." : String(Math.round(v)));
const CHANNEL_LABEL: Record<string, string> = { google_ads: "Google", meta_ads: "Meta", linkedin_ads: "LinkedIn" };
const channelLabel = (c: string): string => CHANNEL_LABEL[c] ?? c;

function renderMarkdown(
  input: AccountEventAnalysisInput,
  current: Edition,
  prevId: string | null,
  gapDays: number | null,
  cadenceMatches: boolean,
  conversions: EditionComparison,
  cost: EditionComparison,
  perChannel: ChannelForecastResult[],
  blended: BlendedForecast | null,
  totalProjected: number | null,
  projectedVsTargetPct: number | null,
  willHitTarget: boolean | null,
  confidence: ForecastConfidence,
  degradations: string[]
): string {
  const daysToFairNow = perChannel.find((c) => c.forecast.daysToFairNow != null)?.forecast.daysToFairNow ?? null;
  const lines: string[] = [
    `# T-minus-analyse ${input.eventName}`,
    "",
    `Editie: **${current.editionId}** (event-datum ${current.fairStartDate}). Peildatum ${input.asOfDate}${daysToFairNow != null ? `, T-${daysToFairNow}` : ""}.`,
    prevId
      ? `Vorige editie: **${prevId}**${gapDays != null ? ` (${gapDays} dagen terug${cadenceMatches ? ", past bij de cadans" : "; LET OP: past niet bij de opgegeven cadans"})` : ""}.`
      : "Geen vorige editie bekend: dit is de eerste geconfigureerde editie (alleen de projectie, geen vergelijking).",
    "",
    "## Editie-over-editie (gelijke afstand tot het event, alle kanalen samen)",
  ];

  if (conversions.comparable) {
    lines.push(
      `- Conversies opgebouwd tot nu: **${fmtNum(conversions.currentCumulative)}** vs **${fmtNum(conversions.previousCumulativeAtSameDaysOut)}** op hetzelfde punt voor de vorige editie: **${fmtPct(conversions.deltaPct)}**.`,
      `- Spend opgebouwd tot nu: **${fmtNum(cost.currentCumulative)}** vs **${fmtNum(cost.previousCumulativeAtSameDaysOut)}**: **${fmtPct(cost.deltaPct)}**.`
    );
    if (conversions.deltaPct != null && cost.deltaPct != null && conversions.deltaPct < 0 && cost.deltaPct >= 0) {
      lines.push("- De aanloop ligt achter TERWIJL de spend gelijk of hoger ligt: de achterstand is geen investeringskwestie maar een effectiviteitsvraag.");
    }
  } else {
    lines.push(`- Niet vergelijkbaar: ${conversions.reason ?? "onbekend"}.`);
  }

  lines.push(
    "",
    "## Projectie richting het event",
    `- Opgebouwd tot nu (alle kanalen): **${fmtNum(perChannel.reduce((s, c) => s + c.forecast.currentCumulative, 0))}**${totalProjected != null ? `; geprojecteerde eindstand: **${fmtNum(totalProjected)}**` : ""} (zekerheid: ${confidence}).`
  );
  if (input.conversionsTarget != null) {
    lines.push(
      `- Doel: **${fmtNum(input.conversionsTarget)}**${projectedVsTargetPct != null ? ` — projectie komt uit op **${Math.round(projectedVsTargetPct * 100)}%** van het doel (${willHitTarget ? "haalt het doel" : "MIST het doel"})` : ""}.`
    );
  }

  if (blended && perChannel.length > 1) {
    lines.push("", "## Per kanaal (dagen-tot-event)");
    for (const { channel, forecast: f } of perChannel) {
      lines.push(
        `- **${channelLabel(channel)}**: opgebouwd ${fmtNum(f.currentCumulative)}${f.projectedFinal != null ? `, projectie ${fmtNum(f.projectedFinal)}` : " (geen projectie)"} (${f.method}, zekerheid ${f.confidence}).`
      );
    }
  }

  lines.push("", "## Aannames en degradaties (geen stil gokken)", ...degradations.map((d) => `- ${d}`));
  return lines.join("\n");
}
