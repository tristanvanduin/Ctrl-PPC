// De planning van de nachtcron: wie eerst, hoeveel tegelijk, en wanneer er geen nieuwe klant
// meer start. Puur, los getest; de cron (app/api/sync/cron/route.ts) voert uit.
//
// WAAROM DIT BESTAAT
//
// Op 3 september 2026 telde `accounts` zeventig Google Ads-klanten. Een nachtelijke sync kostte
// per klant vier tot vierentwintig seconden (13 maanden, ~25 datasets), sequentieel: ruim tien
// minuten voor het bureau, tegen een maxDuration van tien minuten. De kanaalronde (Meta,
// LinkedIn, Microsoft) kwam NA de Google-ronde en mocht alleen starten binnen 180 seconden na
// de invocatiestart -- die zou dus elke nacht "doorgeschoven" zijn zodra Google weer draaide.
//
// Het venster verkleinen is geen optie: elf datasets (ads_region_monthly, ads_country_yoy,
// ads_pmax_*, ...) gaan via replaceBatch -- alle rijen van de klant weg, het venster opnieuw --
// en een korter venster wist daar dus geschiedenis. Vandaar drie hefbomen die het venster met
// rust laten:
//
//   1. STALEST-FIRST. De klant die het langst niet gesynct is gaat voor; wie nooit gesynct is
//      helemaal vooraan. Wat vannacht niet past, staat morgen vooraan. Zo verdeelt de
//      achterstand zich eerlijk in plaats van dat dezelfde klanten (alfabetisch achteraan)
//      elke nacht buiten de boot vallen.
//   2. GELIJKTIJDIG. Drie klanten naast elkaar. De sync is netwerkgebonden (Google Ads API,
//      Supabase), niet CPU-gebonden; de fetch-foutverzamelaar draait op AsyncLocalStorage en
//      is per run gescheiden. Drie en niet tien: het rapportquotum van Google en het geheugen
//      van één Vercel-functie.
//   3. TIJDBUDGET. Google start geen nieuwe klant meer na zijn deel van maxDuration; de
//      kanaalronde krijgt een eigen venster daarna. Zonder kanaalkoppelingen krijgt Google
//      bijna alles.

/** Hoeveel Google-klanten tegelijk. */
export const GOOGLE_GELIJKTIJDIG = 3;

/** Marge aan het eind voor de klant/het paar dat nog loopt als het budget op is. */
const EINDMARGE_MS = 90_000;

/**
 * Stalest-first: nooit gesynct vooraan, dan oplopend op laatste geslaagde sync; gelijke
 * standen op clientId, zodat twee nachten met dezelfde achterstand dezelfde volgorde geven.
 */
export function sorteerOpStaleness<T extends { clientId: string }>(
  klanten: T[],
  laatsteSync: ReadonlyMap<string, string | null>
): T[] {
  const sleutel = (k: T): string => laatsteSync.get(k.clientId) ?? "";
  return [...klanten].sort((a, b) => {
    const sa = sleutel(a), sb = sleutel(b);
    if (sa !== sb) return sa < sb ? -1 : 1; // "" (nooit) sorteert vóór elke datum
    return a.clientId.localeCompare(b.clientId);
  });
}

export interface Tijdbudget {
  /** Na zoveel ms sinds de invocatiestart start er geen nieuwe Google-klant meer. */
  googleStopMs: number;
  /** Na zoveel ms start er geen nieuw kanaalpaar meer. */
  kanaalStopMs: number;
}

/** Zonder kanaalparen krijgt Google alles minus de eindmarge; anders 55% voor Google en het
 *  restant tot de eindmarge voor de kanalen. */
export function verdeelTijdbudget(inp: { maxDurationMs: number; kanaalParen: number }): Tijdbudget {
  const einde = Math.max(0, inp.maxDurationMs - EINDMARGE_MS);
  if (inp.kanaalParen <= 0) return { googleStopMs: einde, kanaalStopMs: einde };
  return { googleStopMs: Math.floor(inp.maxDurationMs * 0.55), kanaalStopMs: einde };
}

/**
 * Een werkpool: hooguit `gelijktijdig` items tegelijk, in volgorde gestart, en een nieuw item
 * start alleen zolang `magStarten()` waar is. Wat niet gestart is komt terug als
 * `doorgeschoven`, in volgorde. De uitkomsten staan op de index van hun item.
 *
 * `werk` hoort zijn eigen fouten te vangen en als uitkomst terug te geven: een worp uit werk
 * breekt de pool af, en dat is voor een nachtcron met zeventig klanten precies verkeerd.
 */
export async function draaiMetPool<T, R>(
  items: readonly T[],
  gelijktijdig: number,
  magStarten: () => boolean,
  werk: (item: T, index: number) => Promise<R>
): Promise<{ uitkomsten: R[]; doorgeschoven: T[] }> {
  const uitkomsten: R[] = new Array(items.length);
  let volgende = 0;
  let gestopt = false;

  async function worker(): Promise<void> {
    while (volgende < items.length) {
      if (gestopt || !magStarten()) { gestopt = true; return; }
      const index = volgende++;
      uitkomsten[index] = await werk(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(gelijktijdig, items.length)) }, () => worker());
  await Promise.all(workers);
  const doorgeschoven = items.slice(volgende);
  return { uitkomsten: uitkomsten.slice(0, volgende), doorgeschoven };
}
