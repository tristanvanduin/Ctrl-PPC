// Fase 2, Task 1: de eerste echte ChannelProvider. Zuiver een I/O-schil, geen nieuwe
// detectielogica: haalt ads_ad_schedule_performance op met de service-role client en duwt de
// rijen door de al-geteste detectScheduleWaste uit lib/signals/google-schedule.ts.
//
// WAAROM DEZE DETECTOR ALS EERSTE
//
// De meeste google-*.ts-detectors in lib/signals/ vragen campagne-niveau-data met een
// maand-over-maand-vergelijking (bijv. detectWinnerStarves: cost, prevCost, conversions,
// prevConversions, budgetLostIs per campagne -- dat is een join over twee maanden). schedule-
// waste is de enige die op een enkele tabel, zonder periodevergelijking, werkt: ScheduleSlotInput
// {dayOfWeek, hourOfDay, cost, clicks, conversions} komt kolom-voor-kolom overeen met
// ads_ad_schedule_performance. Dat is de eerlijke lezing van "minimale query, geen nieuwe logica"
// -- niet elke detector past daarin, deze wel.
//
// WAT DIT NIET DOET
//
// periodStart/periodEnd uit de ChannelProvider-invoer worden NIET gebruikt om te filteren:
// ads_ad_schedule_performance draagt zijn eigen period_start/period_end uit de sync (een vast
// venster), en dat filteren op de gevraagde decision-periode is een aparte stap die nog niet
// gebouwd is. Elke aanroep leest dus het volledige gesyncte venster, ongeacht runType.

import { detectScheduleWaste, type ScheduleSlotInput } from "@/lib/signals/google-schedule";
import { getSupabase } from "@/lib/analysis/helpers";
import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";
import type { Signal } from "../types";

async function haalScheduleSlots(accountId: string): Promise<ScheduleSlotInput[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("ads_ad_schedule_performance")
    .select("day_of_week, hour_of_day, cost, clicks, conversions")
    .eq("client_id", accountId);
  return (data ?? []).map((r) => ({
    dayOfWeek: r.day_of_week as string,
    hourOfDay: Number(r.hour_of_day),
    cost: Number(r.cost ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));
}

export const googleProvider: ChannelProvider = {
  channel: "google",

  isAvailable(accountId) {
    return heeftKanaalData("google", accountId);
  },

  async collectSignals({ accountId }) {
    const slots = await haalScheduleSlots(accountId);
    const { triggered } = detectScheduleWaste(slots);
    return triggered.map((story): Signal => {
      const eersteWaarde = story.evidence[0]?.value;
      return {
        id: story.id,
        channel: "google",
        description: `${story.story} ${story.actionDirection}`,
        value: typeof eersteWaarde === "number" ? eersteWaarde : undefined,
      };
    });
  },

  async analyze(input) {
    const signals = await googleProvider.collectSignals(input);
    return {
      channel: "google",
      accountId: input.accountId,
      signals,
      summary: signals.length > 0
        ? `${signals.length} schedule-verspilling-signaal(en) gevonden.`
        : "Geen materiele schedule-verspilling gevonden in het gesyncte venster.",
    };
  },
};
