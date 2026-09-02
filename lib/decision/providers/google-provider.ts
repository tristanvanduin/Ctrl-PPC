// De eerste echte ChannelProvider. Zuiver een I/O-schil, geen nieuwe detectielogica: haalt
// ads_ad_schedule_performance op en duwt de rijen door de al-geteste detectScheduleWaste uit
// lib/signals/google-schedule.ts.
//
// WAAROM DEZE DETECTOR ALS EERSTE
//
// De meeste google-*.ts-detectors in lib/signals/ vragen campagne-niveau-data met een
// maand-over-maand-vergelijking. schedule-waste is de enige die op een enkele tabel, zonder
// periodevergelijking, werkt: ScheduleSlotInput {dayOfWeek, hourOfDay, cost, clicks, conversions}
// komt kolom-voor-kolom overeen met ads_ad_schedule_performance.
//
// WAT HET VENSTER IS (herbouw 2 september 2026)
//
// ads_ad_schedule_performance draagt zijn eigen period_start/period_end uit de sync (een vast
// venster van ruim een jaar, zie lib/google/orchestrator.ts). De gevraagde decision-periode
// (7 of 14 dagen) kan hier dus NIET op worden gefilterd: de rijen zijn al over het gesyncte
// venster geaggregeerd. De oude versie deed alsof dat wel kon (VENSTER_DAGEN werd berekend en
// nergens toegepast) en las bovendien zonder foutcontrole en zonder paginering -- 7×24 rijen
// per campagne, dus vanaf zes campagnes kapte PostgREST stil af in onbepaalde volgorde.
// Nu: gepagineerd met vaste volgorde, verplichte foutcontrole, en het ECHTE datavenster in de
// uitkomst zodat de aanroeper eerlijk kan zeggen waarover het signaal gaat.

import type { SupabaseClient } from "@supabase/supabase-js";
import { detectScheduleWaste, type ScheduleSlotInput } from "@/lib/signals/google-schedule";
import { alleRijen } from "@/lib/analysis/db-veilig";
import { heeftKanaalData } from "./beschikbaarheid";
import type { ChannelProvider } from "../channel-provider";
import type { Signal, SignaalVerzameling } from "../types";

interface ScheduleRij {
  day_of_week: string;
  hour_of_day: number | string;
  cost: number | null;
  clicks: number | null;
  conversions: number | null;
  period_start: string | null;
  period_end: string | null;
}

// Ruim boven wat een groot account levert (7 dagen × 24 uur × ~100 campagnes = 16.800).
const MAX_SCHEDULE_RIJEN = 30_000;

async function haalScheduleSlots(supabase: SupabaseClient, accountId: string): Promise<{
  slots: ScheduleSlotInput[];
  venster: { start: string | null; eind: string | null };
  rijenAfgekapt: boolean;
}> {
  const fetch = await alleRijen<ScheduleRij>(
    (van, tot) => supabase
      .from("ads_ad_schedule_performance")
      .select("day_of_week, hour_of_day, cost, clicks, conversions, period_start, period_end")
      .eq("client_id", accountId)
      .order("period_end", { ascending: false })
      .order("id", { ascending: true }) // vaste volgorde, anders is paginering loterij
      .range(van, tot),
    "ads_ad_schedule_performance",
    { max: MAX_SCHEDULE_RIJEN }
  );
  const starts = fetch.rijen.map((r) => r.period_start).filter((v): v is string => !!v).sort();
  const einden = fetch.rijen.map((r) => r.period_end).filter((v): v is string => !!v).sort();
  return {
    slots: fetch.rijen.map((r) => ({
      dayOfWeek: String(r.day_of_week),
      hourOfDay: Number(r.hour_of_day),
      cost: Number(r.cost ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: Number(r.conversions ?? 0),
    })),
    venster: { start: starts[0] ?? null, eind: einden[einden.length - 1] ?? null },
    rijenAfgekapt: fetch.afgekapt,
  };
}

export const googleProvider: ChannelProvider = {
  channel: "google",

  isAvailable(supabase, accountId) {
    return heeftKanaalData(supabase, "google", accountId);
  },

  async collectSignals(supabase, { accountId }): Promise<SignaalVerzameling> {
    const { slots, venster, rijenAfgekapt } = await haalScheduleSlots(supabase, accountId);
    const { triggered } = detectScheduleWaste(slots);
    const signalen = triggered.map((story): Signal => {
      const eersteWaarde = story.evidence[0]?.value;
      return {
        id: story.id,
        channel: "google",
        description: `${story.scope}: ${story.story} ${story.actionDirection}`,
        value: typeof eersteWaarde === "number" ? eersteWaarde : undefined,
        category: story.category,
      };
    });
    return { signalen, venster, rijenAfgekapt };
  },

  async analyze(supabase, input) {
    const verzameling = await googleProvider.collectSignals(supabase, input);
    const signals = verzameling?.signalen ?? [];
    return {
      channel: "google",
      accountId: input.accountId,
      gemeten: true,
      signals,
      summary: signals.length > 0
        ? `${signals.length} schedule-verspilling-signaal(en) gevonden in het gesyncte venster ${verzameling?.venster.start ?? "?"} t/m ${verzameling?.venster.eind ?? "?"}.`
        : "Geen materiele schedule-verspilling gevonden in het gesyncte venster.",
    };
  },
};
