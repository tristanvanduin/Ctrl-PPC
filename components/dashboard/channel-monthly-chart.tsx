"use client";

import { useMemo } from "react";
import { today as vandaag } from "@/lib/reporting-date";
import { useKanaalData } from "./channel-data-provider";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { Laadvlak } from "@/components/ui/laadvlak";

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

export function ChannelMonthlyChart() {
  const { maanden, convLabel } = useKanaalData();

  const reeks = useMemo(() => {
    if (!maanden || maanden.length === 0) return [];
    const dezeMaand = vandaag().slice(0, 7);
    // Alleen VOLLE maanden: de lopende maand is per definitie lager en zou als een instorting
    // lezen. Zelfde keuze als de maandtabel in channel-performance.tsx.
    return [...maanden]
      .filter((m) => m.month < dezeMaand)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
      .map((m) => ({ maand: m.month, spend: Math.round(m.adSpend), lijn: Math.round(m.conversions) }));
  }, [maanden]);

  if (maanden === null) return <Laadvlak vorm="grafiek" hoogte={240} titel="Maandverloop" />;
  // MonthlyTrendChart geeft zelf null terug onder twee punten; dat hier herhalen zou betekenen
  // dat twee plekken moeten weten wat "genoeg om een verloop te tonen" is.
  return <MonthlyTrendChart title="Maandverloop" lineLabel={convLabel} data={reeks} />;
}
