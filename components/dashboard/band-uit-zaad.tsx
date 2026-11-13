"use client";

// De kerncijfers van het Overzicht al in de HTML van de server, uit het zaad.
//
// WAAROM. De tegels kregen pas een getal nadat de browser het script (ongeveer 2 MB) geladen en
// gehydrateerd had en de hooks hun antwoord binnen hadden: eerste kerncijfer na 1,7 s op een
// desktop en 4,6 s bij een vier keer tragere processor, tegen een norm van 1,0 en 1,5 s. De server
// las de data al (lib/overzicht/zaad-server.ts) maar rendeerde er niets mee. Nu rendert hij met
// dezelfde antwoorden dezelfde band, in een eigen Suspense-grens: React stuurt de HTML na zodra de
// beloften er zijn, zonder op het script te wachten (node_modules/next/dist/docs/01-app/
// 01-getting-started/06-fetching-data.md, "Streaming data with the use API").
//
// DEZELFDE REKENWEG, GEEN TWEEDE. Elke stap is de functie die de browser ook gebruikt:
// googleDataUitAntwoord (useClientData), kanalenUitRoute/bandPerKanaal/bandKeuze/bandLaatsteDag
// (useChannelPeriodData), kanalenUitBronnen en kanaalkeuzeUitUrl (het klantdashboard),
// bandDataStand, vasteStand en periodeWaarde (de PeriodProvider) en bandInhoud (PeriodSummary).
// Zodra de hooks in de browser klaar zijn, neemt de gewone band het over met dezelfde tekst.
//
// GEEN HYDRATIEVERSCHIL. De browser rendert dit bij het hydrateren opnieuw, en dat moet byte voor
// byte dezelfde HTML geven. Daarom:
// - de beloften zijn dezelfde (React stuurt hun waarde mee in de stroom);
// - de periode komt uit de provider, die op server en browser met dezelfde keuze begint: de
//   adresbalk, of de cookie die de server meegaf (lib/period/periode-cookie.ts). Is geen van beide
//   er, dan staat dit uit (`periodeBekend`): de browser zou daarna localStorage lezen en het getal
//   zou verspringen;
// - het kanaal komt uit de adresbalk (?kanaal=), die beide kennen;
// - alles wat van vandaag afhangt, rekent met de dag van de SERVER (opDag, lib/reporting-date.ts):
//   vlak na middernacht op de laatste dag van een maand zou de browser anders een ander venster
//   kiezen dan de server een moment eerder.
// Elk antwoord dat niet bruikbaar is (geen toegang, een fout, geen data, een klant zonder dit
// kanaal) geeft het gewone laadvlak, op server en browser hetzelfde; de hooks doen dan wat ze
// altijd deden.

import { Suspense, use, useMemo, type ReactElement } from "react";
import type { Zaad } from "@/lib/overzicht/zaadbak";
import { googleDataUitAntwoord, type GoogleAntwoord } from "@/lib/use-client-data";
import type { BlendedAntwoord, BlendedApiResponse } from "@/lib/use-blended-client-data";
import { bandKeuze, bandLaatsteDag, bandPerKanaal, kanalenUitRoute, type BandKanalen } from "@/lib/use-channel-period-data";
import { kanaalkeuzeUitUrl, kanalenUitBronnen, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { googleHeeftData, type BronReeks } from "@/lib/period/apply-period";
import { bandDataStand } from "@/lib/period/band-stand";
import { periodeWaarde, usePeriod, vasteStand, VastePeriode, type PeriodState } from "@/lib/period/period-context";
import type { PeriodeKeuze } from "@/lib/period/period-range";
import { opDag } from "@/lib/reporting-date";
import type { ClientHistoricalData } from "@/lib/types";
import { BandLaadvlak } from "@/components/ui/laadvlak";
import { bandInhoud } from "./period-summary";

/** Wat de klantpagina voor de kerncijfers uit het zaad meegeeft. */
export interface BandZaad {
  clientId: string;
  /** Het antwoord van de Google-route, door de server gelezen (lib/overzicht/zaad-server.ts). */
  google: Promise<Zaad<GoogleAntwoord> | null>;
  /** Het antwoord van de blended route, idem. */
  blended: Promise<Zaad<BlendedAntwoord> | null>;
  /** Het kanaal uit de adresbalk, zoals het klantdashboard het leest; null is "Alle kanalen". */
  kanaal: Kanaal | null;
  /** Vandaag volgens de server ("YYYY-MM-DD"): server en browser rekenen met deze dag. */
  vandaag: string;
}

/** De provider geeft hier een `set`, maar de cijfers uit het zaad kiezen geen periode. */
const NIETS_KIEZEN: PeriodState["set"] = () => {};

/**
 * De band uit de twee antwoorden, zoals de browser hem zou rekenen zodra zijn hooks klaar zijn.
 * Null als het zaad niets bruikbaars draagt: dan wacht de pagina op de hooks, zoals altijd.
 * Zuiver; de aanroeper zet de dag vast (opDag).
 */
export function bandUitZaad(inp: {
  clientId: string;
  google: GoogleAntwoord | null | undefined;
  blended: BlendedAntwoord | null | undefined;
  kanaal: Kanaal | null;
  keuze: PeriodeKeuze;
}): { channel: Kanaalkeuze; data: ClientHistoricalData; bronnen: BronReeks[] | null; periode: PeriodState } | null {
  const { clientId, google, blended } = inp;
  // Een fout van een route wordt in de browser een foutstaat of de terugvalweg (eigen dagrijen);
  // die rekent hier niemand na. Dan de hooks.
  if (!google || google.error || !blended || (blended as { error?: string }).error) return null;
  const route = blended as BlendedApiResponse;
  // Zoals useClientData en useBlendedClientData de antwoorden lezen.
  const googleData = googleDataUitAntwoord(clientId, google);
  const routePerKanaal = route.perKanaal ?? [];
  const routeStand = route.dataStand ?? null;
  // Zoals het klantdashboard de kanalen bepaalt als beide routes er zijn (geen proefje: met zaad
  // vertrekt dat niet).
  const kanalen = kanalenUitBronnen({ googleLaadt: false, google: googleHeeftData(googleData), route: routePerKanaal.map((r) => r.kanaal), proefje: null });
  if (!kanalen) return null;
  const channel = kanaalkeuzeUitUrl(inp.kanaal, kanalen);
  // Zoals useChannelPeriodData de band bouwt als de route er is.
  const bandKanalen: BandKanalen = { googleData, ...kanalenUitRoute(clientId, { perKanaal: routePerKanaal, dataStand: routeStand }) };
  const { data, bronnen } = bandKeuze(clientId, channel, bandKanalen, bandPerKanaal(bandKanalen));
  if (!data) return null;
  // Zoals het klantdashboard de stand aan de PeriodProvider geeft, en de provider het venster rekent.
  const stand = bandDataStand({ channel, kanalen, google: googleData.dataStand, laatsteDag: bandLaatsteDag(bandKanalen), route: routeStand });
  return { channel, data, bronnen, periode: periodeWaarde(inp.keuze, vasteStand(stand), NIETS_KIEZEN) };
}

interface Props {
  zaad: BandZaad;
  vorm?: "band" | "tegels";
  compact?: boolean;
}

/** De kerncijfers uit het zaad, in een eigen Suspense-grens met het gewone laadvlak als terugval. */
export function BandUitZaad(props: Props) {
  const laadvlak = <BandLaadvlak compact={props.compact || props.vorm === "tegels"} />;
  return (
    <Suspense fallback={laadvlak}>
      <BandUitZaadInhoud {...props} laadvlak={laadvlak} />
    </Suspense>
  );
}

// Per belofte van de server één belofte die nooit afwijst (zonderAfwijzing).
const veilig = new WeakMap<object, Promise<unknown>>();

/**
 * De belofte zoals `use` hem leest, maar zonder afwijzing: breekt de stroom af, dan zou `use` de
 * fout naar de dichtstbijzijnde foutgrens gooien en het hele Overzicht in de foutstaat zetten,
 * terwijl de hooks gewoon hun eigen verzoek kunnen doen. Dan null, en dus het laadvlak. Per
 * belofte één keer gemaakt (anders een nieuwe belofte per render, en dan blijft `use` wachten).
 * Een belofte die React al als vervuld kent, gaat ongewijzigd door: dan rendert de browser bij het
 * hydrateren meteen, zonder eerst een ronde te wachten.
 */
export function zonderAfwijzing<T>(belofte: Promise<T | null>): Promise<T | null> {
  if ((belofte as { status?: string }).status === "fulfilled") return belofte;
  let v = veilig.get(belofte) as Promise<T | null> | undefined;
  if (!v) {
    v = Promise.resolve(belofte).catch(() => null);
    veilig.set(belofte, v);
  }
  return v;
}

function BandUitZaadInhoud({ zaad, vorm = "band", compact, laadvlak }: Props & { laadvlak: ReactElement }) {
  const google = use(zonderAfwijzing(zaad.google));
  const blended = use(zonderAfwijzing(zaad.blended));
  // De keuze van de provider: op server en browser dezelfde (adresbalk of cookie, zie de kop).
  const { preset, custom, comparison } = usePeriod();
  const { clientId, kanaal, vandaag } = zaad;
  // Eén keer per antwoord en keuze: het dashboard rendert vaak terwijl zijn hooks laden.
  const uit = useMemo(() => opDag(vandaag, () => {
    const band = bandUitZaad({ clientId, google: google?.waarde, blended: blended?.waarde, kanaal, keuze: { preset, custom, comparison } });
    // bandInhoud binnen dezelfde vaste dag: de uitlegregels lezen lastCompleteMonth.
    return band ? { periode: band.periode, inhoud: bandInhoud({ data: band.data, bronnen: band.bronnen, compact, vorm }, band.periode) } : null;
  }), [vandaag, clientId, google, blended, kanaal, preset, custom, comparison, compact, vorm]);
  if (!uit) return laadvlak;
  // De Vensterlabel in de band leest de periode uit de context: hier die van het zaad.
  return <VastePeriode waarde={uit.periode}>{uit.inhoud}</VastePeriode>;
}
