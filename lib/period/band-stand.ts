// Tot welke dag de KPI-band rekent, per tabblad. Puur, zodat het te testen is zonder het
// klantdashboard te mounten; client-dashboard.tsx geeft de uitkomst aan de PeriodProvider.
//
// UIT DE BRONNEN DIE DE BAND ZELF TOONT
//
// - Op een kanaaltab stond de stand op de nieuwste rij alleen. Rijen zeggen niet of de sync daarna
//   nog slaagde, en de syncs schrijven geen nulrijen: een gepauzeerd LinkedIn-account met een
//   gezonde sync kreeg "maart 2025 t/m februari 2026" op zijn eigen tab, en "november 2025 t/m
//   oktober 2026" op Alle kanalen (review [3], [10]). De dag mét de sync komt van de blended route
//   (DataStandSamen.bronnen): de browser kan <kanaal>_connections niet lezen, en dat blijft zo.
// - Op "Alle kanalen" kwam de stand uit de route, over fact_core. De band leest Google echter LIVE
//   (/api/google-ads/client-data): een DB-sync die twee weken stillag, liet de band in september
//   stoppen terwijl elke bron die hij toont t/m oktober compleet was (review [12]). Nu dezelfde regel
//   (gezamenlijkeDataTot) over de bronnen van de band, met per bron het oordeel van de route of hij
//   mag remmen. Het Jaaroverzicht en de Pacing lezen fact_core en houden de stand van de route.
// - Faalt de route, dan dezelfde regel over de eigen rijen, zonder syncoordeel (iedereen remt, tot de
//   grens in gezamenlijkeDataTot). Eerder gaf dat geen stand en dus het kalendervenster: september
//   en oktober telden mee als nullen, de inzakkende vergelijking die het venster moest voorkomen
//   (review [7]).

import { dagkanaalDataTot, gezamenlijkeDataTot, uitgeslotenMetDag, volleMaand, type DataStandSamen } from "@/lib/sync/datastand";
import { NIET_GOOGLE, type NietGoogleKanaal } from "./kanaal-maanden";
import type { PeriodDataStand } from "./period-context";

export function bandDataStand(inp: {
  /** De actieve kanaaltab. */
  channel: "google" | "blended" | NietGoogleKanaal;
  /** De kanalen van de klant (beschikbaar.ts); alleen die tellen mee op "Alle kanalen". */
  kanalen: readonly string[];
  /** Google zoals de band hem leest: clientData.data?.dataStand (live t/m gisteren, de demo uit de DB). */
  google: Pick<DataStandSamen, "dataTot" | "laatsteVolleMaand" | "partieel"> | null | undefined;
  /** Per kanaal de nieuwste rij die de band zelf geladen heeft. */
  laatsteDag: Record<NietGoogleKanaal, string | null>;
  /** De stand van de blended route; null als die er niet is (één Google-kanaal, laden, of een fout). */
  route: Pick<DataStandSamen, "bronnen"> | null | undefined;
  /** Vandaag als "YYYY-MM-DD"; alleen tests zetten hem. */
  nu?: string;
}): PeriodDataStand | null {
  if (inp.channel === "google") {
    const g = inp.google;
    return g ? { laatsteVolleMaand: g.laatsteVolleMaand, partieel: g.partieel, dataTot: g.dataTot } : null;
  }
  const vanRoute = (bron: string) => inp.route?.bronnen?.find((b) => b.bron === bron);
  // De nieuwste rij in de browser naast de dag van de route (dagkanaalDataTot). Een rij die later
  // valt dan de routedag telt t/m de dag ervoor: het is de rij van de syncdag zelf, of een rij van
  // een sync na het antwoord van de route (dat staat vijf minuten in de cache). Hier won de laatste
  // van de twee, en dan was een oktober waarvan de sync op de 31e om 05:00 voor het laatst slaagde
  // op de kanaaltab "vol", terwijl de route t/m de 30e zei.
  const dagkanaal = (k: NietGoogleKanaal) => dagkanaalDataTot(inp.laatsteDag[k], vanRoute(k)?.dataTot);
  const stand = (dataTot: string | null, uitgeslotenBronnen: { bron: string; dataTot: string | null }[] = []): PeriodDataStand | null =>
    dataTot ? { ...volleMaand({ dataTot, nu: inp.nu }), dataTot, ...(uitgeslotenBronnen.length > 0 ? { uitgeslotenBronnen } : {}) } : null;

  if (inp.channel !== "blended") return stand(dagkanaal(inp.channel));

  const bronnen = [
    ...(inp.kanalen.includes("google") ? [{ bron: "google", dataTot: inp.google?.dataTot ?? null }] : []),
    // Met de nieuwste rij, voor de zin over een uitgesloten kanaal (uitgeslotenMetDag): die noemt de
    // dag van de laatste rij, niet de dag ervoor. Kon de browser het kanaal niet lezen, dan die van
    // de route: zonder rij viel de zin terug op dataTot (de dag ervoor), en dan noemde de band "geen
    // data na 30 oktober" waar het Jaaroverzicht op dezelfde pagina "na 31 oktober" zei.
    ...NIET_GOOGLE.filter((k) => inp.kanalen.includes(k)).map((k) => ({ bron: k as string, dataTot: dagkanaal(k), laatsteRij: inp.laatsteDag[k] ?? vanRoute(k)?.laatsteRij ?? null })),
  ].map((b) => ({ ...b, syncDraait: vanRoute(b.bron)?.syncDraait ?? false }));
  const samen = gezamenlijkeDataTot(bronnen);
  return stand(samen.dataTot, uitgeslotenMetDag({ uitgesloten: samen.uitgesloten, bronnen }));
}
