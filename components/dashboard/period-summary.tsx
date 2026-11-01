"use client";

// De cijfers van de gekozen periode, met de vergelijking ernaast.
//
// Dit is de plek waar de periodekeuze zichtbaar effect heeft: verander de periode en deze
// getallen veranderen mee. Alles komt uit data die de pagina al geladen heeft — er gaat geen
// query overheen — dus het werkt in demo-modus precies zoals met echte data.

import { TriangleAlert } from "lucide-react";
import type { ClientHistoricalData } from "@/lib/types";
import { usePeriod, type PeriodDataStand } from "@/lib/period/period-context";
import { comparePeriods, ontbrekendeMaanden, type BronPaar, type BronReeks } from "@/lib/period/apply-period";
import { formatRange, formatMonth, lastCompleteMonth, monthIndex, type PeriodRange } from "@/lib/period/period-range";
import { formatRoas } from "@/lib/forecast-format";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { opsomming } from "@/lib/util/tekst";
import { Kerncijfer } from "@/components/ui/kerncijfer";

function euro(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function aantal(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
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
 *  niets dat dat zegt. Neutraal en niet amber: er is niets aan te doen, het is uitleg bij de cijfers. */
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
    // Niet "alleen maanden met data in beide perioden": vanaf de start telt een maand zonder data
    // als nul (gepauzeerd is echt niets), en dat moet de zin zeggen in plaats van tegenspreken.
    const vanaf = b.vanaf ?? b.start;
    const waarom = opLaadgrens(b) ? " Eerdere maanden zijn niet geladen."
      : partieel(b) ? ` De data begint halverwege ${formatMonth(b.start!)}.` : "";
    return vanaf
      ? `Het percentage telt alleen maanden vanaf ${formatMonth(vanaf)} in beide perioden; een maand zonder data daarna telt als nul.${waarom}`
      : "Het percentage telt alleen maanden in beide perioden; een maand zonder data telt als nul.";
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
    // Zelfde reden als hierboven: "over de maanden met data in beide perioden" was onwaar zodra
    // het kanaal na zijn start een maand pauzeerde.
    zinnen.push(`${opsomming(deels.map(metStart))} ${deels.length === 1 ? "telt" : "tellen"} in het percentage alleen mee vanaf de eigen eerste volle maand, in beide perioden; een maand zonder data daarna telt als nul.`);
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
}

export function PeriodSummary({ data, compact, bronnen }: Props) {
  const periode = usePeriod();
  if (!data) return null;

  // Met de losse kanalen erbij: een kanaal dat in de vergelijkingsperiode nog niet liep, telt dan
  // niet als groei. De grote getallen blijven de hele periode; alleen de percentages zijn gepaard.
  const { current, deltas, perBron } = comparePeriods(data, periode.range, periode.compareRange, bronnen ?? undefined);
  const nietGepaard = periode.compareRange ? ongepaardTekst(perBron, periode.compareRange) : null;
  const standTekst = [dataStandTekst(periode.dataStand, periode.eindMaand, periode.range), uitgeslotenTekst(periode.dataStand, periode.range)]
    .filter(Boolean).join(" ") || null;
  const { nietGeladen, gemetenNul } = ontbrekendeMaanden(data, current.missing, periode.dataStand?.dataTot);

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
    { label: "Conversies", waarde: aantal(current.totals.conversions), totaal: current.totals.conversions,
      d: deltas?.conversions, hogerIsBeter: true, reeks: reeks((m) => m.conversions || 0) },
    { label: "Omzet", waarde: euro(current.totals.revenue), totaal: current.totals.revenue,
      d: deltas?.revenue, hogerIsBeter: true, reeks: reeks((m) => m.revenue || 0) },
    { label: "Advertentiekosten", waarde: euro(current.totals.adSpend), totaal: current.totals.adSpend,
      d: deltas?.adSpend, hogerIsBeter: false, reeks: reeks((m) => m.adSpend || 0) },
  ];

  const roas = current.totals.adSpend > 0 ? current.totals.revenue / current.totals.adSpend : null;
  const cpa = current.totals.conversions > 0 ? current.totals.adSpend / current.totals.conversions : null;

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5 shadow-sm">
      {!compact && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-blue-ink">
            {formatRange(periode.range)}
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
            delta={k.d ? {
              pct: k.d.pct,
              hogerIsBeter: k.hogerIsBeter,
              // Van niets naar iets is geen percentage; "+100%" zou een precisie suggereren die
              // er niet is. k.d.vorig is het GEPAARDE vorige totaal: nul betekent ook "er viel
              // niets te paren" (een kanaal dat pas in deze periode begon), en dan staat het grote
              // getal er wel. Daarom op het totaal van de periode en niet op k.d.huidig, dat dan
              // ook nul is.
              leegTekst: k.d.vorig === 0 && k.totaal > 0 ? "nieuw in deze periode" : undefined,
              // Feedback: het percentage en de sparkline erboven lijken tegenstrijdig, maar zijn
              // twee verschillende vergelijkingen — de lijn is het verloop BINNEN deze periode, dit
              // percentage is de vergelijking MET de vorige periode. Zonder "waartegen" oogt dat als
              // dezelfde claim twee keer verteld; met "waartegen" is het duidelijk twee metingen.
              waartegen: periode.compareRange ? `vs ${formatRange(periode.compareRange)}` : undefined,
            } : undefined}
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
        />
        {/* Geen conversies betekent geen CPA; een bedrag tonen zou een prijs per conversie
            suggereren die niet bestaat. */}
        <Kerncijfer
          label="CPA"
          waarde={cpa === null ? "—" : euro(cpa)}
          reeks={reeksVerhouding((m) => (m.conversions > 0 ? m.adSpend / m.conversions : null))}
          reeksLabel={`CPA per maand binnen ${formatRange(periode.range)}`}
          reeksBasis="bereik"
        />
      </div>

      {/* Uitleg bij de cijfers, geen waarschuwing: dezelfde neutrale stijl, en hooguit één regel
          per onderwerp. Amber blijft voor wat aandacht vraagt (de ontbrekende maanden hieronder). */}
      {nietGepaard && <p className="mt-3 text-micro text-muted-foreground">{nietGepaard}</p>}
      {standTekst && <p className={`${nietGepaard ? "mt-1" : "mt-3"} text-micro text-muted-foreground`}>{standTekst}</p>}

      {/* Een maand zonder rij na de start van de data is een gemeten nul (gepauzeerd, of gestopt
          terwijl de stand doorloopt): uitleg, geen waarschuwing. Hij stond in de amberregel als
          "geen data geladen ... tellen hierboven niet mee", terwijl de zin erboven zei dat zo'n maand
          als nul telt, en de cijfers dat ook doen (review [6]). */}
      {gemetenNul.length > 0 && (
        <p className={`${nietGepaard || standTekst ? "mt-1" : "mt-3"} text-micro text-muted-foreground`}>
          {gemetenNul.length === 1
            ? `Voor ${formatMonth(gemetenNul[0])} is er geen data; na de start van de data is dat een maand zonder activiteit, en die telt hierboven als nul.`
            : `Voor ${gemetenNul.length} maanden is er geen data (${maandenTekst(gemetenNul)}); na de start van de data zijn dat maanden zonder activiteit, en die tellen hierboven als nul.`}
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
    </div>
  );
}
