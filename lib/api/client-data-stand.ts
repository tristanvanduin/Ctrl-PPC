// Tot waar de Google-cijfers van /api/google-ads/client-data lopen, en welke maanden van het
// lopende jaar daardoor als gerealiseerd tellen.
//
// WAAROM DIT BESTAAT
//
// De route bepaalde "gerealiseerd" met `new Date().getMonth()`: de UTC-maand van het serverproces
// naast een Amsterdams jaar. Op de eerste van de maand tussen middernacht en 02:00 viel de net
// afgesloten maand daardoor weg. En de geseede demo deed hetzelfde op de kalender, terwijl zijn
// data op 26 augustus stopt: augustus telde als volle maand, en de KPI-band liep door tot in
// september en oktober, die in de database niet bestaan.
//
// Nu één regel voor beide paden, dezelfde als de rest van het dashboard (volleMaand in
// lib/sync/datastand.ts). Alleen de vraag "tot welke DAG is de data definitief" verschilt per
// bron:
// - de live Google Ads API levert t/m gisteren;
// - een geseede demo is een maandbron: de dag vóór de laatste geslaagde sync, begrensd door de
//   maand van de nieuwste rij (dataTotVanMaandbron).
//
// Puur en client-veilig: geen IO, de routes geven de gelezen waarden mee.

import { volleMaand, dataTotVanMaandbron, type DataStandSamen, type VolleMaand } from "@/lib/sync/datastand";
import { today, addDays } from "@/lib/reporting-date";

function standOp(dataTot: string | null, nu: string): DataStandSamen {
  // Eén bron, dus niets om uit te sluiten; het veld hoort bij de vorm die de KPI-band leest.
  return { ...volleMaand({ dataTot, nu }), dataTot, uitgesloten: [] };
}

/** De live Google Ads API: alles t/m gisteren is gemeten, vandaag groeit nog.
 *  @param nu vandaag als "YYYY-MM-DD" (standaard today(), Amsterdam); alleen tests zetten hem. */
export function liveDataStand(nu: string = today()): DataStandSamen {
  return standOp(addDays(nu, -1), nu);
}

/**
 * Een maandbron (de geseede demo-tabellen): dataTotVanMaandbron over de nieuwste maandrij en de
 * laatste geslaagde sync.
 *
 * Nooit later dan gisteren. Zonder synctijdstip valt dataTotVanMaandbron terug op het eind van de
 * maand, en staat de nieuwste rij in de lopende maand (de demo-mock rekent vanaf vandaag), dan zou
 * hier "data t/m 30 november" staan op 1 november. volleMaand begrenst de maand al zo; dataTot
 * staat los in beeld (de melding onder de KPI-band) en krijgt dus dezelfde grens.
 */
export function maandbronDataStand(
  laatsteMaand: string | null | undefined,
  laatsteSync: string | null | undefined,
  nu: string = today(),
): DataStandSamen {
  const ruw = dataTotVanMaandbron(laatsteMaand, laatsteSync);
  const gisteren = addDays(nu, -1);
  return standOp(ruw !== null && ruw > gisteren ? gisteren : ruw, nu);
}

/**
 * realizedThroughMonth voor het jaar `currentYear`: de laatste volle maand van de stand, zodra er
 * in dat jaar t/m die maand minstens één rij is. 0 als er in dat jaar nog geen volle maand met
 * data is (in januari, of als de data in een eerder jaar stopte).
 *
 * De volle maand en niet de laatste maand MET een rij. De API vult niets aan: een maand zonder
 * uitgaven heeft geen rij, ook als hij gemeten is. Een account dat na mei stilviel, bekeken op
 * 1 november, kreeg zo een grens van 5, en juni t/m oktober een prognose: vijf maanden die al
 * voorbij waren, en een jaarkaart die "op doel" zei. De adapter maakt van de lege maanden binnen
 * de grens nu nullen (apiDataToMonthlyRecords): gepauzeerd is een echte nul.
 */
export function gerealiseerdTotMaand(
  stand: Pick<VolleMaand, "laatsteVolleMaand">,
  currentYear: number,
  maandenMetData: readonly number[],
): number {
  const vol = stand.laatsteVolleMaand;
  if (!vol) return 0;
  const jaar = Number(vol.slice(0, 4));
  const grens = jaar > currentYear ? 12 : jaar === currentYear ? Number(vol.slice(5, 7)) : 0;
  const binnen = maandenMetData.filter((m) => m >= 1 && m <= grens);
  return binnen.length > 0 ? Math.min(grens, 12) : 0;
}
