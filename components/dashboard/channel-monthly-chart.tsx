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

export function ChannelMonthlyChart() {
  const { rijen, convVan, convLabel } = useKanaalData();

  const maanden = useMemo(() => {
    if (!rijen || rijen.length === 0) return [];
    const dezeMaand = vandaag().slice(0, 7);
    const perMaand = new Map<string, { spend: number; conv: number }>();
    for (const r of rijen) {
      const m = r.date.slice(0, 7);
      const a = perMaand.get(m) ?? { spend: 0, conv: 0 };
      a.spend += r.spend;
      a.conv += convVan(r);
      perMaand.set(m, a);
    }
    // Alleen VOLLE maanden: de lopende maand is per definitie lager en zou als een instorting
    // lezen. Zelfde keuze als de maandtabel in channel-performance.tsx.
    return [...perMaand.entries()]
      .filter(([m]) => m < dezeMaand)
      .sort()
      .slice(-6)
      .map(([m, a]) => ({ maand: m, spend: Math.round(a.spend), lijn: Math.round(a.conv) }));
  }, [rijen, convVan]);

  if (rijen === null) return <Laadvlak vorm="grafiek" hoogte={240} titel="Maandverloop" />;
  // MonthlyTrendChart geeft zelf null terug onder twee punten; dat hier herhalen zou betekenen
  // dat twee plekken moeten weten wat "genoeg om een verloop te tonen" is.
  return <MonthlyTrendChart title="Maandverloop" lineLabel={convLabel} data={maanden} />;
}
