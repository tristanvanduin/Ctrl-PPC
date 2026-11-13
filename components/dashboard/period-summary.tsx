"use client";

// De cijfers van de gekozen periode, met de vergelijking ernaast.
//
// Dit is de plek waar de periodekeuze zichtbaar effect heeft: verander de periode en deze
// getallen veranderen mee. Alles komt uit data die de pagina al geladen heeft — er gaat geen
// query overheen — dus het werkt in demo-modus precies zoals met echte data.

import type { ReactElement, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { ClientHistoricalData } from "@/lib/types";
import { usePeriod, type PeriodDataStand, type PeriodState } from "@/lib/period/period-context";
import { comparePeriods, ontbrekendeMaanden, type BronPaar, type BronReeks } from "@/lib/period/apply-period";
import { formatRange, formatMonth, lastCompleteMonth, monthIndex, type PeriodRange } from "@/lib/period/period-range";
import { formatRoas } from "@/lib/forecast-format";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { opsomming } from "@/lib/util/tekst";
import { Kerncijfer, type KerncijferDelta } from "@/components/ui/kerncijfer";
import { somVergelijking, verhoudingVergelijking, type DeelVergelijking } from "@/lib/period/vergelijkbaar-deel";
import { BandLaadvlak } from "@/components/ui/laadvlak";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { nadrukIndex } from "@/lib/overzicht/bovenkant";

// Eén keer gemaakt en niet per aanroep: de band rendert bij elke wissel van kanaal of periode, en
// maakte dan per getal een nieuwe Intl.NumberFormat. Dezelfde opties, dus dezelfde tekst.
const EURO_OPMAAK = new Intl.NumberFormat("nl-NL", {
  style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const AANTAL_OPMAAK = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

function euro(v: number): string {
  return EURO_OPMAAK.format(v);
}

function aantal(v: number): string {
  return AANTAL_OPMAAK.format(v);
}

/** "mrt 2026 t/m apr 2026" voor aaneengesloten maanden, anders de maanden zelf: twee losse pauzes
 *  als "t/m" lezen zou de maanden ertussen ook leeg noemen. */
function maandenTekst(maanden: readonly string[]): string {
  const aaneen = maanden.every((k, i) => i === 0 || monthIndex(k) === monthIndex(maanden[i - 1]) + 1);
  return aaneen
    ? `${formatMonth(maanden[0], true)} t/m ${formatMonth(maanden[maanden.length - 1], true)}`
    : opsomming(maanden.map((k) => formatMonth(k, true)));
}

/** Welke bronnen niet (helemaal) in het percentage zitten, in een zin; null als alles gepaard is.
 *
 *  Het percentage gaat alleen over maandparen waarvan BEIDE maanden op of na de eerste volle maand
 *  van de bron liggen (gepaardeTotalen); daarbinnen telt een maand zonder data als nul. De grote
 *  getallen gaan over de hele periode. Zonder deze regel leest een kanaal dat vorig jaar nog niet liep
 *  als "wel meegeteld, geen groei", of omgekeerd: in de totalen erbij, in het percentage niet, en
 *  niets dat dat zegt. Neutraal en niet amber: er is niets aan te doen, het is uitleg bij de cijfers.
 *
 *  Telt een bron deels mee, dan noemt de zin de maanden zelf (BronPaar.bereik) en niet "vanaf de
 *  start": omdat ook de vergelijkingsmaand na de start moet liggen, valt ook een deel van de gekozen
 *  periode ná de start weg. Op de demo stond "telt alleen maanden vanaf september 2024 in beide
 *  perioden" bij -6,9%, terwijl augustus 2025 niet meetelde; wat de zin beschreef was +4,0%. */
function ongepaardTekst(perBron: readonly BronPaar[], vergelijking: PeriodRange): string | null {
  const geraakt = perBron.filter((b) => b.ongepaardHuidig + b.ongepaardVorig > 0);
  if (geraakt.length === 0) return null;
  const naam = (b: BronPaar): string | null => (b.naam in KANAAL_NAAM ? KANAAL_NAAM[b.naam as Kanaal] : null);
  // Een start op de laadgrens is niet het begin van de data: de band laadt 36 maanden, en een
  // kanaal dat al langer loopt "begon" anders precies op die grens (review [5], [41]).
  const opLaadgrens = (b: BronPaar) => b.start !== null && b.start === b.geladenVanaf;
  // Een partiële eerste maand (de eerste rij op de 23e) telt niet als paar; dan noemen waarom.
  const partieel = (b: BronPaar) => b.start !== null && b.vanaf !== null && b.vanaf !== b.start;
  // Data in de vergelijkingsperiode en toch geen paar: liep wel, alleen geen volle maand.
  const geenVolleMaand = (b: BronPaar) => b.ongepaardVorig > 0;

  // Eén bron (een kanaaltab, of een klant met alleen Google): een kanaalnaam zegt dan niets extra.
  if (geraakt.some((b) => naam(b) === null)) {
    const b = geraakt[0];
    if (b.gepaard === 0) {
      if (opLaadgrens(b)) return `In ${formatRange(vergelijking)} is geen data geladen; de band laadt vanaf ${formatMonth(b.start!)}.`;
      const begin = !b.start ? "" : partieel(b) ? `; de data begint halverwege ${formatMonth(b.start)}` : `; de data begint in ${formatMonth(b.start)}`;
      return `In ${formatRange(vergelijking)} is er nog ${geenVolleMaand(b) ? "geen volle maand" : "geen data"} om tegen af te zetten${begin}.`;
    }
    // gepaard > 0, dus er is een bereik en een start. De maanden zelf, en waarom het daar begint:
    // alleen de start van de bron (of de laadgrens) laat paren wegvallen. Hier stond "telt alleen
    // maanden vanaf <start> in beide perioden", en dat zweeg erover dat ook maanden van de gekozen
    // periode na de start wegvallen zodra hun tegenhanger ervoor ligt. Niet "alleen maanden met
    // data in beide perioden": daarbinnen telt een maand zonder data als nul (gepauzeerd is echt
    // niets), en dat moet de zin zeggen in plaats van tegenspreken (review [6]).
    const r = b.bereik!;
    const waarom = opLaadgrens(b) ? `de band laadt vanaf ${formatMonth(b.start!)}`
      : partieel(b) ? `de data begint halverwege ${formatMonth(b.start!)}` : `de data begint in ${formatMonth(b.start!)}`;
    return `Het percentage vergelijkt ${formatRange(r.huidig)} met ${formatRange(r.vorig)}; ${waarom}. Een maand zonder data daarin telt als nul.`;
  }

  const metStart = (b: BronPaar) => (!b.start ? naam(b)!
    : opLaadgrens(b) ? `${naam(b)} (geladen vanaf ${formatMonth(b.start)})`
      : partieel(b) ? `${naam(b)} (sinds ${formatMonth(b.start)}, volledig vanaf ${formatMonth(b.vanaf!)})`
        : `${naam(b)} (sinds ${formatMonth(b.start)})`);
  // gepaard 0 betekent hier: de bron begon pas na de vergelijkingsperiode, of erin maar zonder volle
  // maand. Begon hij er met een volle maand in, dan telt dat paar al mee (zie gepaardeTotalen).
  const buiten = geraakt.filter((b) => b.gepaard === 0);
  const deels = geraakt.filter((b) => b.gepaard > 0);
  const zinnen: string[] = [];
  const nietGeladen = buiten.filter(opLaadgrens);
  const nieuw = buiten.filter((b) => !opLaadgrens(b));
  if (nieuw.length > 0) {
    const een = nieuw.length === 1;
    const hoe = nieuw.some(geenVolleMaand) ? "nog geen volle maand" : "nog niet";
    zinnen.push(`${opsomming(nieuw.map(metStart))} ${een ? "staat" : "staan"} wel in de totalen, maar niet in het percentage: in ${formatRange(vergelijking)} ${een ? "liep het" : "liepen ze"} ${hoe}.`);
  }
  if (nietGeladen.length > 0) {
    const een = nietGeladen.length === 1;
    zinnen.push(`${opsomming(nietGeladen.map(metStart))} ${een ? "staat" : "staan"} wel in de totalen, maar niet in het percentage: ${formatRange(vergelijking)} is niet geladen.`);
  }
  if (deels.length > 0) {
    // De maanden die per bron echt meetellen, gegroepeerd: bronnen met hetzelfde bereik in één zin.
    // "Vanaf de eigen eerste volle maand, in beide perioden" liet weg dat ook maanden van de gekozen
    // periode na die maand wegvallen. En niet "over de maanden met data in beide perioden": dat was
    // onwaar zodra het kanaal na zijn start een maand pauzeerde.
    const groepen = new Map<string, BronPaar[]>();
    for (const b of deels) {
      const over = `${formatRange(b.bereik!.huidig)} tegen ${formatRange(b.bereik!.vorig)}`;
      groepen.set(over, [...(groepen.get(over) ?? []), b]);
    }
    const delen = [...groepen].map(([over, bs]) => `${opsomming(bs.map(metStart))} ${bs.length === 1 ? "telt" : "tellen"} in het percentage alleen mee over ${over}`);
    zinnen.push(`${delen.join("; ")}; een maand zonder data daarin telt als nul.`);
  }
  return zinnen.join(" ");
}

/** "Data t/m 26 augustus 2026; de periode loopt t/m juli 2026." als de data eerder ophoudt dan de
 *  kalender verwacht, anders null.
 *
 *  Het venster eindigt op de laatste volle maand MET data (PeriodProvider). Zonder deze regel leest
 *  "augustus 2025 t/m juli 2026" op 1 november als een vergissing, of als een keuze van iemand
 *  anders. Een gedeeltelijke LOPENDE maand hoort er niet bij: die laat geen preset ooit zien, en
 *  dan zou de regel bij elke live klant elke dag staan. */
function dataStandTekst(stand: PeriodDataStand | null, eindMaand: string, periode: PeriodRange, kalender: string = lastCompleteMonth()): string | null {
  if (!stand?.dataTot) return null;
  // Een periode die vóór het eind van de data ophoudt, raakt het eind niet.
  if (monthIndex(periode.end) < monthIndex(eindMaand)) return null;
  const achter = monthIndex(eindMaand) < monthIndex(kalender);
  const voorbijePartieel = stand.partieel !== null && monthIndex(stand.partieel.maand) <= monthIndex(kalender);
  if (!achter && !voorbijePartieel) return null;
  const dag = Number(stand.dataTot.slice(8, 10));
  return `Data t/m ${dag} ${formatMonth(stand.dataTot.slice(0, 7))}; de periode loopt t/m ${formatMonth(periode.end)}.`;
}

/** "LinkedIn (geen data na 15 mei 2026) houdt het venster niet tegen; ..." voor de bronnen die
 *  eerder ophouden dan de rest en toch niet remmen (gezamenlijkeDataTot): niet gekoppeld, al
 *  maanden achter, of gepauzeerd met een gezonde sync. Na hun dag tellen ze als nul. Zonder deze
 *  zin stond er "Data t/m 31 oktober" boven een totaal waarin LinkedIn sinds mei nul is, en zei
 *  niets welk kanaal dat was (review [9]). Alleen als de periode tot of voorbij die maand loopt;
 *  daarvoor raakt het de cijfers niet. */
function uitgeslotenTekst(stand: PeriodDataStand | null, periode: PeriodRange): string | null {
  return uitgeslotenZin((stand?.uitgeslotenBronnen ?? [])
    .filter((b) => !!b.dataTot && monthIndex(b.dataTot.slice(0, 7)) <= monthIndex(periode.end)));
}

/** De zin zelf, ook voor het Jaaroverzicht en de Pacing op "Alle kanalen": die rekenen met
 *  dezelfde stand van de route en tellen zo'n bron na zijn dag dus ook als nul. Null zonder bron. */
export function uitgeslotenZin(bronnen: readonly { bron: string; dataTot: string | null }[]): string | null {
  const geraakt = bronnen.filter((b): b is { bron: string; dataTot: string } => !!b.dataTot);
  if (geraakt.length === 0) return null;
  const naam = (bron: string) => (bron in KANAAL_NAAM ? KANAAL_NAAM[bron as Kanaal] : bron);
  const delen = geraakt.map((b) => `${naam(b.bron)} (geen data na ${Number(b.dataTot.slice(8, 10))} ${formatMonth(b.dataTot.slice(0, 7))})`);
  return geraakt.length === 1
    ? `${delen[0]} houdt het venster niet tegen; vanaf die dag telt het als nul.`
    : `${opsomming(delen)} houden het venster niet tegen; vanaf die dag tellen ze als nul.`;
}

interface Props {
  data: ClientHistoricalData | null;
  /** Toon een compactere variant zonder kop, voor binnen een bestaand kaartje. */
  compact?: boolean;
  /** De losse kanalen als `data` een optelling is, zodat de vergelijking per kanaal paart. */
  bronnen?: readonly BronReeks[] | null;
  /** Of `data` nog onderweg is. Dan staat er een vlak op de maat van de band in plaats van niets. */
  laden?: boolean;
  /**
   * `band` is de band zoals hij altijd was. `tegels` is dezelfde inhoud als vijf tegels (bouwplan
   * fase 3, de nieuwe weergave): de verandering als pil met de vorige waarde erbij, één tegel met
   * nadruk (de grootste verandering), en de periode met de vergelijking in de voetregel in plaats
   * van in een kop erboven, zodat het eerste cijfer hoger op de pagina staat. Elke uitlegregel en
   * elke waarschuwing van de band staat er ook: het is een andere vorm, geen andere inhoud.
   */
  vorm?: "band" | "tegels";
  /**
   * Wat er staat zolang `data` nog laadt, in plaats van het laadvlak: de kerncijfers die de server
   * al uit het zaad rekende (components/dashboard/band-uit-zaad.tsx). Weglaten: het laadvlak, zoals
   * altijd.
   */
  zolangLaden?: ReactNode;
}

/**
 * Een vergelijking (lib/period/vergelijkbaar-deel.ts) als delta van een tegel. Gaat het percentage
 * over een deel van de kanalen, dan staan de twee waarden van dat deel erbij, nu en toen; anders
 * alleen de vorige waarde. Zo staat een percentage nooit naast een getal waar het niet bij hoort.
 */
function alsDelta(v: DeelVergelijking, hogerIsBeter: boolean, opmaak: (v: number) => string): KerncijferDelta | undefined {
  switch (v.soort) {
    case "geen": return undefined;
    case "leeg": return { pct: null, hogerIsBeter, leegTekst: "geen vergelijking mogelijk" };
    case "heel": return { pct: v.pct, hogerIsBeter, was: v.pct !== null ? opmaak(v.vorig) : undefined };
    case "deel": return { pct: v.pct, hogerIsBeter, ...(v.pct !== null ? { nu: opmaak(v.huidig), was: opmaak(v.vorig) } : {}) };
  }
}

export function PeriodSummary({ data, compact, bronnen, laden = false, vorm = "band", zolangLaden }: Props) {
  const periode = usePeriod();
  // Zonder data en nog ladend: de ruimte van de band alvast innemen. De band kwam als laatste
  // binnen en duwde dan alles eronder 200 px omlaag; dat was de grootste verspringing op de pagina.
  // Heeft de server de cijfers al gerekend, dan die (zolangLaden), met het laadvlak als terugval.
  if (!data) return laden ? (zolangLaden ?? <BandLaadvlak compact={compact || vorm === "tegels"} />) : null;
  return bandInhoud({ data, compact, bronnen, vorm }, periode);
}

/**
 * De band of de tegels zelf, voor gegeven data en een gegeven periode. Zonder hooks, zodat de
 * kerncijfers uit het zaad (components/dashboard/band-uit-zaad.tsx) door exact deze regels gaan,
 * binnen opDag (lib/reporting-date.ts) met de dag van de server: elke tekst hier die van vandaag
 * afhangt (lastCompleteMonth in dataStandTekst) is dan op server en browser dezelfde.
 */
export function bandInhoud({ data, compact, bronnen, vorm = "band" }: Pick<Props, "compact" | "bronnen" | "vorm"> & { data: ClientHistoricalData }, periode: PeriodState): ReactElement {
  // Met de losse kanalen erbij: een kanaal dat in de vergelijkingsperiode nog niet liep, telt dan
  // niet als groei. De grote getallen blijven de hele periode; alleen de percentages zijn gepaard.
  const { current, deltas, perBron } = comparePeriods(data, periode.range, periode.compareRange, bronnen ?? undefined);
  const nietGepaard = periode.compareRange ? ongepaardTekst(perBron, periode.compareRange) : null;
  const standTekst = [dataStandTekst(periode.dataStand, periode.eindMaand, periode.range), uitgeslotenTekst(periode.dataStand, periode.range)]
    .filter(Boolean).join(" ") || null;
  // Vanaf waar de band ALLES geladen heeft. Bij een optelling de laatste grens van de bronnen:
  // daarvóór is niet elk kanaal opgehaald, en is een lege maand onbekend in plaats van leeg. Zonder
  // grens bij een van de bronnen (of zonder bronnen) is hij onbekend.
  const grenzen = (bronnen ?? []).map((b) => b.geladenVanaf ?? null);
  const laadgrens = grenzen.length > 0 && !grenzen.includes(null)
    ? (grenzen as string[]).reduce((a, b) => (monthIndex(b) > monthIndex(a) ? b : a)) : null;
  const { nietGeladen, gemetenNul, voorStart, start } = ontbrekendeMaanden(data, current.missing, periode.dataStand?.dataTot, laadgrens);
  // Een kanaal waarvan voor deze periode NIETS geladen is (de eerste pagina faalde: zijn laadgrens
  // ligt ná het eind van de periode). Op "Alle kanalen" zweeg de band daarover: zonder rijen geeft
  // bronStart geen start, dus valt hij uit de paarregel, en Google vult elke maand, dus ontbreekt er
  // geen maand. Het totaal stond er als "alle kanalen" zonder dat kanaal. Alleen bij een optelling
  // met kanaalnamen: op een kanaaltab zegt de regel over niet-geladen maanden het al.
  const nietOpgehaald = (bronnen ?? [])
    .filter((b) => b.naam in KANAAL_NAAM && b.geladenVanaf != null && monthIndex(b.geladenVanaf) > monthIndex(periode.range.end))
    .map((b) => KANAAL_NAAM[b.naam as Kanaal]);
  // "Nieuw in deze periode" alleen als de vergelijkingsperiode echt leeg was. Het gepaarde vorige
  // totaal is ook nul als er niets te paren viel terwijl het kanaal er wel was (de demo-Microsoft-tab:
  // negen dagen juli 2025, € 297, en toch drie keer "nieuw", met eronder "de data begint halverwege
  // juli 2025"), en als de vergelijkingsperiode vóór de laadgrens begint: dan is hij niet leeg maar
  // onbekend. Dan "geen vergelijking mogelijk", en de regel eronder zegt waarom.
  const vergelijking = periode.compareRange;
  const vorigeNietLeeg = !!vergelijking && perBron.some((b) => b.ongepaardVorig > 0
    || (b.geladenVanaf !== null && monthIndex(vergelijking.start) < monthIndex(b.geladenVanaf)));

  // De maanden van deze periode, oud naar nieuw. `current.months` bevat alleen de maanden die er
  // werkelijk zijn (ontbrekende staan in `current.missing`), dus de lijn loopt niet dwars over een
  // gat heen alsof daar gemeten is.
  const reeks = (kies: (m: (typeof current.months)[number]) => number): (number | null)[] =>
    current.months.map((m) => {
      const v = kies(m);
      return Number.isFinite(v) ? v : null;
    });
  /** Idem, maar de keuze mag `null` teruggeven als de verhouding voor die maand niet bestaat. */
  const reeksVerhouding = (kies: (m: (typeof current.months)[number]) => number | null): (number | null)[] =>
    current.months.map((m) => {
      const v = kies(m);
      return v != null && Number.isFinite(v) ? v : null;
    });

  const kaarten = [
    { label: "Conversies", waarde: aantal(current.totals.conversions), totaal: current.totals.conversions, opmaak: aantal,
      d: deltas?.conversions, hogerIsBeter: true, reeks: reeks((m) => m.conversions || 0) },
    { label: "Omzet", waarde: euro(current.totals.revenue), totaal: current.totals.revenue, opmaak: euro,
      d: deltas?.revenue, hogerIsBeter: true, reeks: reeks((m) => m.revenue || 0) },
    { label: "Advertentiekosten", waarde: euro(current.totals.adSpend), totaal: current.totals.adSpend, opmaak: euro,
      d: deltas?.adSpend, hogerIsBeter: false, reeks: reeks((m) => m.adSpend || 0) },
  ];

  const roas = current.totals.adSpend > 0 ? current.totals.revenue / current.totals.adSpend : null;
  const cpa = current.totals.conversions > 0 ? current.totals.adSpend / current.totals.conversions : null;
  // ROAS en CPA met hun verandering, uit de GEPAARDE totalen net als de drie percentages ernaast:
  // een kanaal dat in de vergelijkingsperiode nog niet liep, trekt de vorige verhouding anders
  // scheef. Het grote getal is wel het totaal over alle kanalen; gaat het percentage over een
  // deel, dan staan de waarden van dat deel erbij (vergelijkbaar-deel.ts). Hier stond "CPA € 57,
  // +14%, was € 96" waar +14% en € 96 alleen Google waren (nu € 109).
  const roasVergelijking = verhoudingVergelijking({
    totaalTeller: current.totals.revenue, totaalNoemer: current.totals.adSpend,
    teller: deltas?.revenue, noemer: deltas?.adSpend,
  });
  const cpaVergelijking = verhoudingVergelijking({
    totaalTeller: current.totals.adSpend, totaalNoemer: current.totals.conversions,
    teller: deltas?.adSpend, noemer: deltas?.conversions,
  });
  const roasDelta = alsDelta(roasVergelijking, true, (v) => formatRoas(v));
  const cpaDelta = alsDelta(cpaVergelijking, false, (v) => euro(v));

  /** De delta van een somtegel: "nieuw in deze periode" als er toen niets was, anders de vergelijking. */
  const somDelta = (k: (typeof kaarten)[number]): KerncijferDelta | undefined => {
    if (!k.d) return undefined;
    // Van niets naar iets is geen percentage; "+100%" zou een precisie suggereren die er niet is.
    // k.d.vorig is het GEPAARDE vorige totaal: nul betekent ook "er viel niets te paren" (een
    // kanaal dat pas in deze periode begon), en dan staat het grote getal er wel. Daarom op het
    // totaal van de periode en niet op k.d.huidig, dat dan ook nul is.
    if (k.d.vorig === 0 && k.totaal > 0 && !vorigeNietLeeg) {
      return { pct: k.d.pct, hogerIsBeter: k.hogerIsBeter, leegTekst: "nieuw in deze periode" };
    }
    return alsDelta(somVergelijking(k.totaal, k.d), k.hogerIsBeter, k.opmaak);
  };

  /** De band toont bij een somtegel geen "was" (de kop zegt al waartegen), behalve als het
   *  percentage over een deel gaat: dan staan de twee waarden van dat deel erbij. */
  const bandDelta = (k: (typeof kaarten)[number]): KerncijferDelta | undefined => {
    const d = somDelta(k);
    if (!d) return undefined;
    // Het percentage en de sparkline erboven lijken tegenstrijdig, maar zijn twee verschillende
    // vergelijkingen: de lijn is het verloop BINNEN deze periode, dit percentage de vergelijking
    // MET de vorige periode. In de volle band zegt de kop al "vergeleken met ..."; alleen in de
    // compacte variant, zonder kop, staat het per tegel.
    const waartegen = compact && periode.compareRange ? `vs ${formatRange(periode.compareRange)}` : undefined;
    return d.nu ? { ...d, waartegen } : { ...d, was: undefined, waartegen };
  };

  // De uitlegregels en waarschuwingen onder de cijfers: één blok, voor de band en voor de tegels.
  const uitleg = (
    <>
      {/* Uitleg bij de cijfers, geen waarschuwing: dezelfde neutrale stijl, en hooguit één regel
          per onderwerp. Amber blijft voor wat aandacht vraagt (de ontbrekende maanden hieronder). */}
      {nietGepaard && <p className="mt-3 text-micro text-muted-foreground">{nietGepaard}</p>}
      {standTekst && <p className={`${nietGepaard ? "mt-1" : "mt-3"} text-micro text-muted-foreground`}>{standTekst}</p>}

      {/* Een geladen maand vóór de start: er is nog geen data, en er ontbreekt niets. Uitleg, geen
          waarschuwing. De demo-Meta-tab zei hier in amber "Voor 7 maanden is geen data geladen (aug
          2025 t/m feb 2026); die tellen hierboven niet mee", onder de eigen zin "de data begint
          halverwege maart 2026", terwijl de band die maanden wel had opgehaald. */}
      {voorStart.length > 0 && (
        <p className={`${nietGepaard || standTekst ? "mt-1" : "mt-3"} text-micro text-muted-foreground`}>
          {`${voorStart.length === 1 ? `Voor ${formatMonth(voorStart[0])} is er geen data` : `Voor ${voorStart.length} maanden is er geen data (${maandenTekst(voorStart)})`}: ${
            start ? `de data begint pas in ${formatMonth(start)}.` : "er is nog geen enkele maand met data."}`}
        </p>
      )}

      {/* Een maand zonder rij na de start van de data is een gemeten nul (gepauzeerd, of gestopt
          terwijl de stand doorloopt): uitleg, geen waarschuwing. Hij stond in de amberregel als
          "geen data geladen ... tellen hierboven niet mee", terwijl de zin erboven zei dat zo'n maand
          als nul telt, en de cijfers dat ook doen (review [6]). */}
      {gemetenNul.length > 0 && (
        <p className={`${nietGepaard || standTekst || voorStart.length > 0 ? "mt-1" : "mt-3"} text-micro text-muted-foreground`}>
          {gemetenNul.length === 1
            ? `Voor ${formatMonth(gemetenNul[0])} is er geen data; na de start van de data is dat een maand zonder activiteit, en die telt hierboven als nul.`
            : `Voor ${gemetenNul.length} maanden is er geen data (${maandenTekst(gemetenNul)}); na de start van de data zijn dat maanden zonder activiteit, en die tellen hierboven als nul.`}
        </p>
      )}

      {nietOpgehaald.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-micro text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {nietOpgehaald.length === 1
            ? `${nietOpgehaald[0]} kon niet geladen worden en telt hierboven niet mee.`
            : `${opsomming(nietOpgehaald)} konden niet geladen worden en tellen hierboven niet mee.`}
        </p>
      )}

      {nietGeladen.length > 0 && (
        // Ontbrekende maanden melden in plaats van een kortere reeks stilzwijgend doorgeven:
        // anders lees je een totaal over vier maanden als een totaal over zes.
        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-micro text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {nietGeladen.length === 1
            ? `Voor ${formatMonth(nietGeladen[0])} is geen data geladen; dat totaal ontbreekt hierboven.`
            : `Voor ${nietGeladen.length} maanden is geen data geladen (${maandenTekst(nietGeladen)}); die tellen hierboven niet mee.`}
        </p>
      )}
    </>
  );

  if (vorm === "tegels") {
    // De vijf cijfers als één lijst, zodat de nadruk over alle vijf gekozen wordt (nadrukIndex).
    const tegels = [
      ...kaarten.map((k) => ({
        label: k.label, waarde: k.waarde, reeks: k.reeks, reeksBasis: "nul" as const,
        // De bandkop "vergeleken met ..." staat hier in de voetregel; per tegel zegt "was" waartegen.
        delta: somDelta(k),
      })),
      { label: "ROAS", waarde: roas === null ? "—" : formatRoas(roas), reeksBasis: "bereik" as const,
        reeks: reeksVerhouding((m) => (m.adSpend > 0 ? m.revenue / m.adSpend : null)),
        delta: roasDelta },
      { label: "CPA", waarde: cpa === null ? "—" : euro(cpa), reeksBasis: "bereik" as const,
        reeks: reeksVerhouding((m) => (m.conversions > 0 ? m.adSpend / m.conversions : null)),
        delta: cpaDelta },
    ];
    const nadruk = nadrukIndex(tegels.map((t) => t.delta?.pct));
    return (
      // Geen overflow-hidden: een bedrag van zeven cijfers is op een telefoon een paar pixels breder
      // dan zijn kolom, en dan liever over de opvulling heen dan met een afgesneden laatste cijfer.
      <section aria-label={`Kerncijfers over ${formatRange(periode.range)}`} className="rounded-xl border border-border bg-card shadow-sm">
        {/* Hetzelfde raster als de band: twee, drie of vijf kolommen. De tegels hebben GEEN eigen
            achtergrond: op een telefoon is een bedrag van zes cijfers breder dan zijn halve
            kolom, en een buurtegel met een eigen vlak zou de laatste cijfers afdekken. De
            scheidslijn tussen de tegels staat er daarom alleen waar ze naast elkaar passen. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {tegels.map((t, i) => (
            // De nadruk is een streep boven de tegel en geen kleurvlak: het cijfer zelf blijft
            // even groot en even zwart als de andere vier. Een los streepje binnen de opvulling en
            // geen rand van de tegel: een rand loopt door tot in de ronde hoek van de kaart en
            // steekt daar uit, en zo staan de cijfers met en zonder nadruk op dezelfde lijn.
            <div key={t.label} data-nadruk={i === nadruk || undefined}
              className="relative px-3 pb-3 pt-3 lg:border-l lg:border-l-border/60 lg:px-4 lg:first:border-l-0">
              {i === nadruk && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand-gray lg:inset-x-4" />}
              <Kerncijfer
                label={t.label}
                waarde={t.waarde}
                reeks={t.reeks}
                reeksBasis={t.reeksBasis}
                reeksLabel={`${t.label} per maand binnen ${formatRange(periode.range)}`}
                delta={t.delta}
                deltaVorm="pil"
              />
            </div>
          ))}
        </div>
        {/* De periode en de vergelijking voluit, met hetzelfde label als de andere blokken die de
            periode volgen. In de band is dit de kop; hier de voetregel, onder de cijfers. */}
        <div className="border-t border-border px-4 pb-2.5 pt-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
            <span className="font-medium text-brand-gray">{formatRange(periode.range)}</span>
            <Vensterlabel soort="periode" kaal />
            {periode.compareRange && <span>vergeleken met {formatRange(periode.compareRange)}</span>}
          </p>
          {uitleg}
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5 shadow-sm">
      {!compact && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-blue-ink">
            {formatRange(periode.range)}
            {/* De band is het blok dat de periode per definitie volgt. Het label staat er kaal: de
                maanden staan er al voluit naast, en hetzelfde woord als in de andere blokken laat
                zien welke daarvan met deze band meebewegen. */}
            <Vensterlabel soort="periode" kaal />
          </h3>
          {periode.compareRange && (
            <p className="text-micro text-muted-foreground">
              vergeleken met {formatRange(periode.compareRange)}
            </p>
          )}
        </div>
      )}

      {/* De cijferband. Dit is de kop van elke pagina, en hij stond in dezelfde maat als de rest:
          18 pixels tussen honderden regels van 10 tot 13. Dan is er geen kop — dan is er alleen
          tekst, en moet de lezer zelf uitzoeken waar hij moet kijken.

          De verhoudingen die het doen: het cijfer groot en met strakke letterafstand (grote cijfers
          vallen anders uit elkaar), het label klein en in kapitalen erbóven zodat je het leest
          vóór het getal, en de verandering eronder als aparte regel in plaats van ernaast — een
          percentage naast een bedrag concurreert met dat bedrag. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {kaarten.map((k) => (
          <Kerncijfer
            key={k.label}
            label={k.label}
            waarde={k.waarde}
            reeks={k.reeks}
            reeksLabel={`${k.label} per maand binnen ${formatRange(periode.range)}`}
            delta={bandDelta(k)}
          />
        ))}
        {/* ROAS en CPA zijn verhoudingen en geen volumes, dus hun lijn loopt op het eigen bereik:
            vanaf nul zou een ROAS die tussen 1,4 en 1,7 beweegt een kaarsrechte streep worden en
            precies de beweging verbergen waarvoor je naar een ROAS kijkt. Een maand zonder spend of
            zonder conversies levert geen verhouding op — dat wordt een gat in de lijn en geen nul,
            want nul zou "verdiende niets" betekenen in plaats van "niet te berekenen". */}
        <Kerncijfer
          label="ROAS"
          waarde={roas === null ? "—" : formatRoas(roas)}
          reeks={reeksVerhouding((m) => (m.adSpend > 0 ? m.revenue / m.adSpend : null))}
          reeksLabel={`ROAS per maand binnen ${formatRange(periode.range)}`}
          reeksBasis="bereik"
          delta={roasDelta}
        />
        {/* Geen conversies betekent geen CPA; een bedrag tonen zou een prijs per conversie
            suggereren die niet bestaat. */}
        <Kerncijfer
          label="CPA"
          waarde={cpa === null ? "—" : euro(cpa)}
          reeks={reeksVerhouding((m) => (m.conversions > 0 ? m.adSpend / m.conversions : null))}
          reeksLabel={`CPA per maand binnen ${formatRange(periode.range)}`}
          reeksBasis="bereik"
          delta={cpaDelta}
        />
      </div>

      {uitleg}
    </div>
  );
}
