"use client";

import { TrendingUp, Target } from "lucide-react";
import { Sectie } from "@/components/ui/sectie";
import { ChannelForecast, ChannelMonthlyTrend } from "./channel-forecast";
import { ChannelBudgetScenario } from "./channel-budget-scenario";
import type { ChannelKind } from "@/lib/analysis/use-channel-run-rate";

// Meta/LinkedIn-tegenhanger van GoogleForecast (google-view.tsx): dezelfde drie secties, dezelfde
// volgorde ("waar dit op uitkomt" / "wat een budgetwijziging zou doen" / detail), zodat de
// Prognose-tab niet meer per kanaal een andere opbouw heeft (layout-uniformering, 22 augustus). De
// titels van sectie 1 zijn bewust anders geformuleerd ("tempo" i.p.v. "jaar") -- geen visuele
// overname van een claim die het run-rate-model niet waarmaakt (geen seizoenscorrectie, geen
// jaardoel). Om diezelfde reden is sectie 3 hier een maandgrafiek en geen kopie van Google's
// Verwacht/Prognose/Ratio-tabel: die tabel toetst aan een jaardoel, en dat doel bestaat voor
// Meta/LinkedIn niet (geen meerjarige historie om een seizoenscorrectie op te baseren).
export function ChannelForecastSections({ clientId, channel }: { clientId: string; channel: Exclude<ChannelKind, "blended"> }) {
  return (
    <>
      <Sectie
        eerste
        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Waar dit tempo op uitkomt"
        bijschrift="Lopende en volgende maand op run-rate — nog geen jaarprognose, daarvoor ontbreekt de meerjarige historie"
      >
        <ChannelForecast clientId={clientId} channel={channel} metGrafiek={false} />
      </Sectie>
      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Wat een budgetwijziging zou doen"
        bijschrift="Doorrekening van een hoger of lager mediabudget op dezelfde CPA"
      >
        <ChannelBudgetScenario clientId={clientId} channel={channel} />
      </Sectie>
      <Sectie
        icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Volle maanden"
        bijschrift="Spend en resultaat per maand, run-rate-basis"
      >
        <ChannelMonthlyTrend clientId={clientId} channel={channel} />
      </Sectie>
    </>
  );
}
