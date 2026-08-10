// Fase 4: rijen uit de account-brontabellen omzetten naar DailyPoint[] voor de T-minus-kern
// (lib/rai/event-time-axis.ts). Los van lib/rai/geo-clone-aggregate.ts: dat bestand matcht
// per CAMPAGNE op een geo-clone-afkorting in de naam (aftakkingen van dezelfde beurs in één
// account). Een generiek event (Black Friday, een sale-periode) heeft geen aftakkingen — het
// hele account telt mee — dus is er niets te matchen en zijn de al bestaande, vooraf
// geaggregeerde account-tabellen (ads_account_monthly, meta_account_daily,
// linkedin_account_daily) de rechtstreekse bron. Puur en los getest, geen IO.

import type { DailyPoint } from "@/lib/rai/event-time-axis";
import {
  resolveChannelConversionConfig,
  sumSelectedConversions,
  type ChannelConversionChannel,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";

export interface GoogleAccountMonthlyRow {
  month: string; // "YYYY-MM-01"
  conversions?: number | null;
  cost?: number | null;
}

export interface ChannelAccountDailyRow {
  date: string; // ISO
  spend?: number | null;
  [field: string]: unknown; // conversievelden verschillen per kanaal, zie channel-conversion-config.ts
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Google levert alleen maanddata; de maand-eerste-dag is het punt op de tijdas. */
export function googleMonthlyConversionPoints(rows: GoogleAccountMonthlyRow[]): DailyPoint[] {
  return rows.map((r) => ({ date: r.month.slice(0, 10), value: n(r.conversions) }));
}

export function googleMonthlyCostPoints(rows: GoogleAccountMonthlyRow[]): DailyPoint[] {
  return rows.map((r) => ({ date: r.month.slice(0, 10), value: n(r.cost) }));
}

/** Meta/LinkedIn: dagdata, conversie-optelling volgens de bestaande, gedeelde kanaalselectie
 *  (dezelfde config die ChannelPerformance/ChannelForecast/de beurs-forecast al gebruiken). */
export function channelDailyConversionPoints(
  rows: ChannelAccountDailyRow[],
  channel: ChannelConversionChannel,
  config: ChannelConversionConfig,
): DailyPoint[] {
  return rows.map((r) => ({ date: String(r.date).slice(0, 10), value: sumSelectedConversions(r, channel, config) }));
}

export function channelDailyCostPoints(rows: ChannelAccountDailyRow[]): DailyPoint[] {
  return rows.map((r) => ({ date: String(r.date).slice(0, 10), value: n(r.spend) }));
}

export { resolveChannelConversionConfig };
