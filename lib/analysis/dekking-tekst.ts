// De dekking van een analyse in één regel voor het scherm.
//
// WAAROM DIT BESTAAT
//
// Na de herbouw van de deep dives (1 september 2026) zegt elke route eerlijk waar hij op
// draaide: period_start/period_end zijn de echte grenzen van de gebruikte data, en de
// POST-respons draagt een `dekking`-blok (verouderd, rijenAfgekapt, peilmaand, ...). Die
// eerlijkheid stopte bij de API: de kaarten toonden alleen "Laatst: <datum>" — de datum van
// de RUN, niet van de DATA. Een gebruiker zag zo een verse analyse zonder te zien dat die op
// data van april draaide. Dit hulpje maakt van de periode en het dekkingsblok tekst voor de
// kaart, één keer, voor elke kaart hetzelfde. Puur, los getest.

import { lastCompleteMonth } from "@/lib/period/period-range";

export interface DekkingRegel {
  /** Bijv. "Data: 2026-06-01 t/m 2026-08-01". */
  tekst: string;
  /** True als de data ouder is dan de laatste afgesloten maand: toon als waarschuwing. */
  verouderd: boolean;
}

/**
 * De dataperiode van een opgeslagen analyse, met verouderd-vlag. De vergelijking gebruikt de
 * maand van period_end tegen de laatste afgesloten maand (period-range); een analyse over
 * dagdata die tot in de lopende maand loopt is dus nooit "verouderd".
 */
export function dekkingUitPeriode(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  nu: string = lastCompleteMonth()
): DekkingRegel | null {
  if (!periodEnd) return null;
  const eind = String(periodEnd).slice(0, 10);
  const start = periodStart ? String(periodStart).slice(0, 10) : null;
  const verouderd = eind.slice(0, 7) < nu;
  const tekst = start && start !== eind ? `Data: ${start} t/m ${eind}` : `Data t/m ${eind}`;
  return { tekst: verouderd ? `${tekst} (ouder dan de laatste afgesloten maand)` : tekst, verouderd };
}

/**
 * Waarschuwingen uit het `dekking`-blok van een POST-respons. Onbekende vormen leveren niets;
 * de kaart hoort er niet op te breken.
 */
export function waarschuwingenUitDekking(dekking: unknown): string[] {
  if (!dekking || typeof dekking !== "object") return [];
  const d = dekking as Record<string, unknown>;
  const uit: string[] = [];
  if (d.verouderd === true) {
    const maand = typeof d.peilmaand === "string" ? d.peilmaand : typeof d.analysemaand === "string" ? d.analysemaand : null;
    uit.push(maand ? `De jongste data is van ${maand}; recentere maanden ontbreken in de sync.` : "De jongste data is ouder dan de laatste afgesloten maand.");
  }
  if (d.rijenAfgekapt === true || d.prestatieRijenAfgekapt === true) {
    uit.push("De bron leverde meer rijen dan het plafond; de cijfers zijn op een deelverzameling berekend.");
  }
  if (typeof d.buitenDekkingCampagnes === "number" && d.buitenDekkingCampagnes > 0) {
    uit.push(`${d.buitenDekkingCampagnes} campagne(s) vallen buiten de dekking van deze analyse.`);
  }
  if (typeof d.beeindigdeCampagnes === "number" && d.beeindigdeCampagnes > 0) {
    uit.push(`${d.beeindigdeCampagnes} beëindigde campagne(s) buiten beschouwing gelaten.`);
  }
  if (d.uurdata === false) {
    uit.push("Geen uurdata beschikbaar: dagdeel-analyse niet uitgevoerd.");
  }
  return uit;
}
