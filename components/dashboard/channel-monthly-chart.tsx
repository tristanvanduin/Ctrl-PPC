"use client";

import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { today as vandaag } from "@/lib/reporting-date";
import { useKanaalData } from "./channel-data-provider";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { usePeriod } from "@/lib/period/period-context";
import { formatRange } from "@/lib/period/period-range";

// Het maandverloop van een kanaal als eigen kaart.
//
// Het stond middenin channel-performance.tsx, tussen de kerncijfers en de maandtabel, en kon
// daardoor alleen over de volle breedte onderaan de pagina staan. Losgetrokken kan het naast de
// landencijfers in de hero-rij -- "trek dat maandverloop ook los", en de grafiek wint erbij: een
// staafreeks met zes maanden heeft geen 1600px nodig, en de kaart ernaast wél gezelschap.
//
// De data komt uit ChannelDataProvider, samen met de pacing-kaart, de beurs-sectie en het
// jaaroverzicht. Dat scheelt niet alleen verzoeken: drie losse fetches betekent drie plekken die
// elk hun eigen idee kunnen krijgen van "welke velden tellen als conversie".
//
// Uit de MAANDEN van de provider, niet uit de dagrijen: sinds fase 1, stap 5 draagt de provider
// alleen nog de dagen van de laatste weken (hooguit één volle maand), en de maanden komen met de
// conversieselectie van de klant al toegepast uit dezelfde route. Zes maanden uit dagrijen
// optellen gaf hier anders één staaf -- en MonthlyTrendChart rendert onder twee punten niets.
//
// VOLGT DE GEKOZEN PERIODE (bouwplan fase 2). Hier stonden altijd de laatste zes volle maanden,
// onder een band die over de gekozen periode gaat: twee vensters op één tabblad, en een grafiek
// die stilstond als je de periode verzette. De maanden staan al in het geheugen (de provider), dus
// de wissel kost geen verzoek. Dezelfde maanden als de band: de periode eindigt op de laatste
// volle maand met data, dus de lopende maand zit er nooit in.

export function ChannelMonthlyChart() {
  const { maanden, convLabel } = useKanaalData();
  const periode = usePeriod();
  const periodeStart = periode.range.start;
  const periodeEind = periode.range.end;

  const reeks = useMemo(() => {
    if (!maanden || maanden.length === 0) return [];
    const dezeMaand = vandaag().slice(0, 7);
    // Alleen VOLLE maanden: de lopende maand is per definitie lager en zou als een instorting
    // lezen. De periode eindigt daar al vóór; de grens hier is het vangnet voor een pagina zonder
    // datastand, waar de periode op de kalender eindigt. Zelfde keuze als de maandtabel in
    // channel-performance.tsx.
    return [...maanden]
      .filter((m) => m.month < dezeMaand && m.month.slice(0, 7) >= periodeStart && m.month.slice(0, 7) <= periodeEind)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ maand: m.month, spend: Math.round(m.adSpend), lijn: Math.round(m.conversions) }));
  }, [maanden, periodeStart, periodeEind]);

  if (maanden === null) return <Laadvlak vorm="grafiek" hoogte={240} titel="Maandverloop" />;
  // Het kanaal heeft helemaal geen twee volle maanden: geen kaart, zoals voorheen. Een verloop van
  // één maand bestaat niet, en dat ligt dan niet aan de gekozen periode.
  const volleMaanden = maanden.filter((m) => m.month < vandaag().slice(0, 7)).length;
  if (volleMaanden < 2) return null;
  // Wel genoeg maanden, maar minder dan twee in DEZE periode: de kaart blijft staan en zegt
  // waarom hij leeg is. MonthlyTrendChart geeft onder twee punten null terug, en een kaart die
  // verdwijnt als je de periode verzet leest als een fout.
  if (reeks.length < 2) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />
          <h3 className="text-title font-semibold text-brand-gray">Maandverloop</h3>
          <Vensterlabel soort="periode" className="ml-auto" />
        </div>
        <p className="px-5 py-8 text-center text-body text-muted-foreground">
          {reeks.length === 0
            ? `In ${formatRange(periode.range)} heeft dit kanaal geen volle maand met cijfers.`
            : `In ${formatRange(periode.range)} heeft dit kanaal één volle maand met cijfers; een verloop begint bij twee.`}
        </p>
      </div>
    );
  }
  return <MonthlyTrendChart title="Maandverloop" lineLabel={convLabel} data={reeks} venster={<Vensterlabel soort="periode" />} />;
}
