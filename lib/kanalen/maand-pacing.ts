// Maand-tot-nu tegen dezelfde dag-telling van de vorige maand.
//
// Waarom Meta en LinkedIn dit hebben en niet Google's doel-pacing: er is voor deze kanalen geen
// jaardoel ingevoerd (dat komt uit client-data/route.ts en is Google-specifiek). Zonder doel is
// "hoe ver ben je" een zinloze vraag, maar "ga je harder of zachter dan vorige maand op dezelfde
// dag" is dat niet -- die vergelijking heeft geen doel nodig en is niet vertekend door het aantal
// verstreken dagen.
//
// Deze berekening stond binnen channel-performance.tsx en wordt nu door twee schermen gebruikt
// (die view en de losse pacing-kaart in de hero van Meta/LinkedIn). Eén definitie, want twee
// kopieën van "vorige maand tot dezelfde dag" gaan vroeg of laat uit elkaar lopen op precies het
// detail dat ertoe doet: of dag 31 in een maand van 30 dagen wel of niet meetelt.

export interface MaandPacingRij {
  date: string;
  spend: number;
}

export interface MaandPacing {
  /** De dag van de maand waar we nu staan; de vorige maand wordt tot en met deze dag geteld. */
  dagVanMaand: number;
  mtdSpend: number;
  mtdConv: number;
  vorigeSpend: number;
  vorigeConv: number;
  /** mtd / vorige maand tot dezelfde dag. null zolang de vorige maand nul was. */
  spendRatio: number | null;
  convRatio: number | null;
}

/**
 * @param rijen dagrijen met minstens `date` en `spend`
 * @param convVan haalt de conversietelling uit een rij (de conversie-selectie per kanaal bepaalt
 *               welke velden meetellen, dus dat weet alleen de aanroeper)
 * @param vandaagIso de rapportagedatum (lib/reporting-date), niet `new Date()` -- de app rekent
 *                   overal met dezelfde peildatum en tests zetten hem vast
 */
export function berekenMaandPacing<T extends MaandPacingRij>(
  rijen: readonly T[],
  convVan: (r: T) => number,
  vandaagIso: string,
): MaandPacing {
  const dagVanMaand = Number(vandaagIso.slice(8, 10));
  const dezeMaand = vandaagIso.slice(0, 7);
  const vorigeDatum = new Date(vandaagIso);
  vorigeDatum.setMonth(vorigeDatum.getMonth() - 1);
  const vorigeMaand = vorigeDatum.toISOString().slice(0, 7);

  let mtdSpend = 0, mtdConv = 0, vorigeSpend = 0, vorigeConv = 0;
  for (const r of rijen) {
    const maand = r.date.slice(0, 7);
    if (maand === dezeMaand) {
      mtdSpend += r.spend;
      mtdConv += convVan(r);
    } else if (maand === vorigeMaand && Number(r.date.slice(8, 10)) <= dagVanMaand) {
      vorigeSpend += r.spend;
      vorigeConv += convVan(r);
    }
  }

  return {
    dagVanMaand,
    mtdSpend, mtdConv, vorigeSpend, vorigeConv,
    spendRatio: vorigeSpend > 0 ? mtdSpend / vorigeSpend : null,
    convRatio: vorigeConv > 0 ? mtdConv / vorigeConv : null,
  };
}
