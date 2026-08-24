"use client";

import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { FairWeeksView } from "./fair-weeks-overview";
import { useChannelForecast } from "./channel-forecast-overview";
import { Laadvlak } from "@/components/ui/laadvlak";
import type { ChannelKind } from "./channel-performance";

// "Prestaties richting de beurs" voor Meta en LinkedIn.
//
// De sectie bestond alleen op Google, en niet omdat de cijfers ontbraken: `buildChannelForecast`
// levert voor deze kanalen exact dezelfde twee vormen als Google's forecast (ClientHistoricalData
// + ClientForecast), inclusief de `weeklyPoints` waar de weekkolommen op draaien. Wat ontbrak was
// een ingang: FairWeeksOverview haalde data en forecast zélf uit ClientDataProvider, en die
// provider is Google-only. Nu haalt de Google-ingang ze op en geeft ze door aan FairWeeksView, en
// dit component doet hetzelfde met de kanaal-forecast.
//
// Geen countryFilter-prop: die filtert Google's dagdata per land (useCountryFilteredData), en dat
// pad bestaat voor Meta en LinkedIn niet. Zodra het er is, hoort hij hier ook.

export function ChannelFairWeeks({ clientId, channel, edition }: {
  clientId: string;
  channel: ChannelKind;
  edition: UpcomingEdition;
}) {
  const gebouwd = useChannelForecast(clientId, channel);

  if (gebouwd === null) return <Laadvlak vorm="grafiek" hoogte={280} titel="Weken tot het event" />;
  // Geen dagcijfers gesynced: niets tonen in plaats van een leeg weekraster. Zelfde keuze als
  // ChannelForecastOverview eronder, zodat de twee secties niet tegenstrijdig zijn.
  if (gebouwd === "leeg") return null;

  return <FairWeeksView data={gebouwd.data} forecast={gebouwd.forecast} edition={edition} />;
}
