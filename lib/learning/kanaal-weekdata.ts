// Welk kanaal een hypothese meet, en de weekrijen van dat kanaal.
//
// De evaluator las altijd ads_account_weekly, de Google-weektabel, ook voor een voorstel uit de
// Meta-, LinkedIn- of Microsoft-analyse. Nagedraaid op demo-greentech kreeg de meta_biweekly-
// hypothese "Blog Traffic pauzeren" daardoor "cpa ging van 95,76 naar 103,71; verdict rejected":
// twee Google-cijfers (doorlichting 13 november). Dat oordeel reisde als les terug de prompts in
// en stuurde de ICE-confidence van de hele bron bij. Een les over het verkeerde kanaal is erger
// dan geen les.
//
// Hier staat welke bron bij welk kanaal hoort, en hoe dagrijen van een niet-Google-kanaal
// weekrijen worden in de vorm die de evaluator al kent (WeeklyRow), met de conversieselectie van
// de klant. Pure functies; de cron-route leest, dit rekent.

import { KANAAL_DAGBRON } from "@/lib/analysis/channel-report-blend";
import { conversionSourcesFor, sumSelectedConversions, type ChannelConversionChannel, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import type { WeeklyRow } from "./weekly-metrics";

export type HypotheseKanaal = "google_ads" | ChannelConversionChannel;

export const KANAAL_NAAM: Record<HypotheseKanaal, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
  microsoft_ads: "Microsoft Ads",
};

/**
 * Het kanaal van een voorstel uit zijn bron (sprint_hypotheses.source). Null als het voorstel over
 * meer dan een kanaal gaat (cross_channel, master_synthesis): daar bestaat geen enkele weektabel
 * die het meet, en een blended cijfer zou weer een ander kanaal laten meetellen.
 *
 * "analysis" en een lege bron zijn historisch de Google-maandpijplijn; de deelanalyses zonder
 * kanaalvoorvoegsel (search_terms, bid_strategy, impression_share, ...) zijn Google-analyses.
 */
export function kanaalVoorBron(source: string | null | undefined): HypotheseKanaal | null {
  const s = (source ?? "").toLowerCase();
  if (s === "cross_channel" || s === "master_synthesis" || s.startsWith("portfolio")) return null;
  if (s.startsWith("meta_")) return "meta_ads";
  if (s.startsWith("linkedin_")) return "linkedin_ads";
  if (s.startsWith("microsoft_")) return "microsoft_ads";
  return "google_ads";
}

/** De maandag van de week waarin deze datum valt (UTC, zoals week_start in ads_account_weekly). */
export function maandagVan(datum: string): string {
  const d = new Date(`${datum.slice(0, 10)}T00:00:00Z`);
  const dag = (d.getUTCDay() + 6) % 7; // maandag 0
  d.setUTCDate(d.getUTCDate() - dag);
  return d.toISOString().slice(0, 10);
}

/**
 * Dagrijen van een niet-Google-kanaal (gelezen met dagbronSelect) naar weekrijen. Conversies via
 * de selectie van de klant, zoals elke andere lezer van deze tabellen (kanaalMaandenUitDagen).
 */
export function weekRijenUitDagen(
  rijen: Array<Record<string, unknown>>,
  kanaal: ChannelConversionChannel,
  convConfig: ChannelConversionConfig,
): WeeklyRow[] {
  const klikVeld = KANAAL_DAGBRON[kanaal].clicksField;
  const convVelden = conversionSourcesFor(kanaal).map((s) => s.field);
  const perWeek = new Map<string, WeeklyRow>();
  for (const r of rijen) {
    const datum = String(r.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(datum)) continue;
    const week = maandagVan(datum);
    const w = perWeek.get(week) ?? { week_start: week, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
    w.impressions = (w.impressions ?? 0) + Number(r.impressions ?? 0);
    w.clicks = (w.clicks ?? 0) + Number(r[klikVeld] ?? 0);
    w.cost = (w.cost ?? 0) + Number(r.spend ?? 0);
    w.conversions = (w.conversions ?? 0) + sumSelectedConversions(
      Object.fromEntries(convVelden.map((f) => [f, Number(r[f] ?? 0)])), kanaal, convConfig);
    w.conversions_value = (w.conversions_value ?? 0) + Number(r.conversion_value ?? 0);
    perWeek.set(week, w);
  }
  return [...perWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
}
