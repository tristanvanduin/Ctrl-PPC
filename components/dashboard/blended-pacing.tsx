"use client";

import { useMemo } from "react";
import { Zap, TrendingUp, Calendar, Flag, Target } from "lucide-react";
import { gepaardeTotalen, type BronPaar, type BronReeks, type GepaardeTotalen } from "@/lib/period/apply-period";
import { addMonths, formatMonth, formatRange, monthsIn, type PeriodRange } from "@/lib/period/period-range";
import { safeDiv } from "@/lib/util/math";
import { opsomming } from "@/lib/util/tekst";
import { KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import type { BlendedKanaalReeks } from "@/lib/api/blended-historical";
import { uitgeslotenMetDag, type DataStandSamen } from "@/lib/sync/datastand";
import { uitgeslotenZin } from "./period-summary";

// Pacing over alle kanalen samen.
//
// WAAROM DIT ER EERST NIET WAS, EN WAT ER NU WÉL KAN. De kanaal-pacing vergelijkt maand-tot-nu met
// dezelfde dag-telling van de vorige maand. Dat vraagt DAGdata over alle kanalen samen, en die
// bestaat niet als één bron: Google heeft geen leesbare dagtabel -- die loopt via de maandrijen.
//
// Maar "pacing" hoeft niet per se maand-op-maand te zijn. Op jaarbasis kan het wél eerlijk, met
// exact de data die het Jaaroverzicht al ophaalt (useBlendedClientData): het jaar tot nu tegen
// HETZELFDE deel van vorig jaar. Beide kanten zijn dan even lang en er is geen doel voor nodig.
// Dat laatste is de kern: `client_targets` is voor deze klanten leeg, dus elke variant die tegen
// een jaardoel meet zou een doel moeten verzinnen.
//
// TOT WAAR. Het venster loopt t/m de laatste maand die ELK kanaal volledig gemeten heeft
// (dataStand.laatsteVolleMaand, zie lib/sync/datastand.ts), niet t/m "de laatste maand vóór
// vandaag". Bij demo-greentech stopte de data op 25/26 augustus, en dan telde augustus als volle
// maand tegen een volle augustus vorig jaar.
//
// PER KANAAL GEPAARD. Het percentage telde eerst elke rij van het jaar op, zonder naar het kanaal
// te kijken. Bij de demo liepen Meta en LinkedIn vorig jaar nog niet, dus stond er "+158%
// conversies" voor iets dat gelijk-voor-gelijk (alleen Google) een daling van 6,5% was. Nu gaat
// het percentage via gepaardeTotalen, dezelfde regel als de KPI-band: een kanaal telt per
// maandpaar alleen mee als het in BEIDE maanden al liep. Het tempo telt wel alle kanalen van dit
// jaar, want dat is geen vergelijking.

/** De cijfers achter het blok; los van de weergave zodat de regel testbaar is. */
export interface BlendedPacingCijfers {
  /** De laatste maand van het venster, "YYYY-MM". */
  totMaand: string;
  /** Januari t/m totMaand van het jaar van totMaand, en hetzelfde stuk een jaar eerder. */
  periode: PeriodRange;
  vergelijking: PeriodRange;
  /** Maanden in het venster van dit jaar waarin minstens één kanaal een rij heeft. */
  maanden: number;
  /** Het tempo: alle kanalen van dit jaar, ook die van vorig jaar nog niet bestonden. */
  spend: number;
  conv: number;
  /** De vergelijking zelf, per kanaal gepaard. */
  gepaard: GepaardeTotalen;
  /** null = geen vergelijking (geen kanaal met een maandpaar, of vorig jaar nul). */
  spendRatio: number | null;
  convRatio: number | null;
  /** Kanalen met minstens één maandpaar in het percentage. */
  vergeleken: Kanaal[];
  /** Kanalen die in het percentage meetellen, maar niet over alle maanden. */
  deels: BronPaar[];
  /** Kanalen met data in het venster van dit jaar en geen enkel maandpaar. */
  buiten: BronPaar[];
}

export function blendedPacingCijfers(perKanaal: readonly BlendedKanaalReeks[], totMaand: string): BlendedPacingCijfers | null {
  const jaar = Number(totMaand.slice(0, 4));
  const periode: PeriodRange = { start: `${jaar}-01`, end: totMaand };
  const vergelijking: PeriodRange = { start: `${jaar - 1}-01`, end: addMonths(totMaand, -12) };

  const venster = new Set(monthsIn(periode));
  let spend = 0, conv = 0;
  const gezien = new Set<string>();
  for (const k of perKanaal) {
    for (const m of k.maanden) {
      if (!venster.has(m.month)) continue;
      spend += m.adSpend || 0;
      conv += m.conversions || 0;
      gezien.add(m.month);
    }
  }
  if (gezien.size === 0) return null;

  // vanaf: de eerste VOLLE maand van een dagkanaal. Zonder die grens paarde Microsoft's negen dagen
  // juli 2025 tegen een volle juli 2026, en stond er op de demo "Conversies +0%" waar
  // gelijk-voor-gelijk -7% hoort. `?? null`: een antwoord van vóór dit veld paart zoals vroeger.
  const reeksen: BronReeks[] = perKanaal.map((k) => ({
    naam: k.kanaal,
    vanaf: k.vanaf ?? null,
    maanden: new Map(k.maanden.map((m) => [m.month, { conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend }])),
  }));
  const gepaard = gepaardeTotalen(reeksen, periode, vergelijking);
  const metPaar = gepaard.perBron.filter((b) => b.gepaard > 0);

  return {
    totMaand, periode, vergelijking,
    maanden: gezien.size,
    spend, conv,
    gepaard,
    // safeDiv: null bij een nul vorig jaar. Van niets naar iets is geen percentage, en 0% zou
    // lezen als "we doen niets" in plaats van "er is geen vergelijking".
    spendRatio: metPaar.length > 0 ? safeDiv(gepaard.huidig.adSpend, gepaard.vorig.adSpend) : null,
    convRatio: metPaar.length > 0 ? safeDiv(gepaard.huidig.conversions, gepaard.vorig.conversions) : null,
    vergeleken: metPaar.map((b) => b.naam as Kanaal),
    deels: metPaar.filter((b) => b.ongepaardHuidig + b.ongepaardVorig > 0),
    buiten: gepaard.perBron.filter((b) => b.gepaard === 0 && b.ongepaardHuidig + b.ongepaardVorig > 0),
  };
}

const naamVan = (k: string): string => (k in KANAAL_NAAM ? KANAAL_NAAM[k as Kanaal] : k);
const maandNaam = (m: string): string => formatMonth(m).split(" ")[0];

/** De voetregel: wat er vergeleken is, wat er buiten viel, en of er een maand nog niet meetelt. */
export function blendedPacingVoetregel(
  c: BlendedPacingCijfers,
  partieel: DataStandSamen["partieel"] | null | undefined,
  uitgesloten: readonly { bron: string; dataTot: string | null }[] = [],
): string {
  const zinnen: string[] = [];
  // Een partiële eerste maand noemen: "sinds juli 2025" alleen zou de vraag oproepen waarom juli
  // niet in het verschil zit.
  const metStart = (b: BronPaar) => (!b.start ? naamVan(b.naam)
    : b.vanaf && b.vanaf !== b.start ? `${naamVan(b.naam)} (sinds ${formatMonth(b.start)}, volledig vanaf ${formatMonth(b.vanaf)})`
      : `${naamVan(b.naam)} (sinds ${formatMonth(b.start)})`);

  if (c.vergeleken.length === 0) {
    zinnen.push(
      `Geen vergelijking: geen van de kanalen liep in ${formatRange(c.vergelijking)} al. ` +
      "Het tempo telt alle kanalen van dit jaar.",
    );
  } else if (c.buiten.length === 0 && c.deels.length === 0) {
    zinnen.push(
      "Tegen vorig jaar en niet tegen een doel: er staat voor deze kanalen geen jaardoel in het systeem, " +
      "en een verzonnen doel zou een percentage opleveren dat preciezer oogt dan het is.",
    );
  } else {
    zinnen.push(`Het verschil is gelijk-voor-gelijk: ${opsomming(c.vergeleken.map(naamVan))}.`);
    if (c.buiten.length > 0) {
      const een = c.buiten.length === 1;
      // Data in de vergelijkingsperiode en toch geen paar: dan liep het kanaal daar wel, alleen geen
      // volle maand (Microsoft vanaf 23 juli 2025). "Liep nog niet" is dan onwaar.
      const deelsGelopen = c.buiten.some((b) => b.ongepaardVorig > 0);
      zinnen.push(
        `${opsomming(c.buiten.map(metStart))} ${een ? "liep" : "liepen"} in ${formatRange(c.vergelijking)} ` +
        `${deelsGelopen ? "nog geen volle maand" : "nog niet"} en ${een ? "telt" : "tellen"} alleen mee in het tempo.`,
      );
    }
    if (c.deels.length > 0) {
      const een = c.deels.length === 1;
      // Niet "de maanden waarin het in beide jaren liep": een maand zonder data ná de eerste volle
      // maand telt als nul (gepauzeerd is echt niets), en een partiële eerste maand telt niet.
      zinnen.push(
        `${opsomming(c.deels.map(metStart))} ${een ? "telt" : "tellen"} in het verschil alleen mee ` +
        "vanaf de eigen eerste volle maand, in beide jaren.",
      );
    }
  }

  // De maand ná het venster is al deels gemeten: zeggen dat hij bewust ontbreekt, anders leest
  // "t/m juli" op 1 november als een vergissing.
  if (partieel && partieel.maand === addMonths(c.totMaand, 1)) {
    const naam = maandNaam(partieel.maand);
    zinnen.push(`${naam.charAt(0).toUpperCase()}${naam.slice(1)} telt nog niet mee: de data loopt t/m ${partieel.tmDag} ${naam}.`);
  } else {
    zinnen.push(
      "Het venster loopt t/m de laatste maand die alle kanalen volledig gemeten hebben, " +
      "dus beide jaren zijn even lang.",
    );
  }
  // Een kanaal dat het venster niet meer remt (ontkoppeld, of al maanden zonder data), telt na zijn
  // laatste dag als nul en drukt zo het verschil. Dezelfde zin als in de KPI-band, anders leest
  // "lager dan vorig jaar" als een prestatie in plaats van als een kanaal dat er niet meer is.
  const weg = uitgeslotenZin(uitgesloten);
  if (weg) zinnen.push(weg);
  return zinnen.join(" ");
}

export function BlendedPacing({ perKanaal, dataStand }: {
  perKanaal: readonly BlendedKanaalReeks[] | null;
  dataStand: (Pick<DataStandSamen, "laatsteVolleMaand" | "partieel"> & Partial<Pick<DataStandSamen, "uitgesloten" | "bronnen">>) | null;
}) {
  const totMaand = dataStand?.laatsteVolleMaand ?? null;
  const cijfers = useMemo(
    () => (perKanaal && perKanaal.length > 0 && totMaand ? blendedPacingCijfers(perKanaal, totMaand) : null),
    [perKanaal, totMaand],
  );

  if (!cijfers) return null;

  const { maanden, spend, conv, gepaard, spendRatio, convRatio, vergeleken } = cijfers;
  // Alleen een bron die binnen het venster ophoudt: wie pas in de partiële maand erna stopt, is
  // t/m totMaand volledig en raakt dit verschil niet.
  const voetregel = blendedPacingVoetregel(cijfers, dataStand?.partieel,
    uitgeslotenMetDag(dataStand).filter((b) => !!b.dataTot && b.dataTot.slice(0, 7) <= cijfers.totMaand));

  const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
  // Zonder gepaard kanaal staan er geen twee getallen om naast elkaar te zetten; "€ 0 tegen € 0"
  // zou lezen als een gemeten nul.
  const geenPaar = vergeleken.length === 0;

  // Meer uitgeven is niet goed of slecht; meer conversies wel. Vandaar amber bij een spend-stijging
  // en groen bij een conversie-stijging -- dezelfde afspraak als in channel-pacing.tsx.
  const kleurVan = (ratio: number | null, hogerIsBeter: boolean) => {
    if (ratio == null) return "#9ca3af";
    if (ratio >= 1.15) return hogerIsBeter ? "#22c55e" : "#f59e0b";
    if (ratio >= 0.85) return "#22c55e";
    return hogerIsBeter ? "#f59e0b" : "#22c55e";
  };
  const spendKleur = kleurVan(spendRatio, false);
  const convKleur = kleurVan(convRatio, true);
  const tekstVan = (ratio: number | null) =>
    ratio == null ? "Geen vergelijking" : ratio >= 1.15 ? "Hoger dan vorig jaar" : ratio >= 0.85 ? "Gelijk aan vorig jaar" : "Lager dan vorig jaar";

  const spendPerMaand = spend / maanden;
  const convPerMaand = conv / maanden;

  return (
    <div className="@container flex h-full flex-col bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Zap className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Pacing — alle kanalen</h3>
        <span className="text-micro text-muted-foreground ml-auto">
          Jaar tot en met {formatMonth(cijfers.totMaand)} · {maanden} {maanden === 1 ? "maand" : "maanden"} · tegen dezelfde periode vorig jaar
        </span>
      </div>

      <div className="grid flex-1 grid-cols-2 items-stretch gap-4 @6xl:grid-cols-3 @7xl:grid-cols-6">
        {/* GEEN RING HIER, anders dan bij de kanaal-pacing. Een ring codeert een deel van een
            geheel: hij loopt van leeg naar vol en stopt daar. Deze verhouding heeft geen plafond --
            de eerste versie toonde een volle ring met "255%" erin, en dan zegt de ring niets meer
            dan "meer dan honderd". Voor een vergelijking zonder bovengrens is het verschil zelf de
            waarde, met beide absolute getallen eronder zodat het verschil te plaatsen is. Die twee
            getallen zijn de GEPAARDE: dezelfde kanalen aan beide kanten, anders klopt het verschil
            niet met wat eronder staat. */}
        <Vergelijking
          label="Spend"
          ratio={spendRatio}
          nu={geenPaar ? "—" : eur(gepaard.huidig.adSpend)}
          toen={geenPaar ? "—" : eur(gepaard.vorig.adSpend)}
          kleur={spendKleur}
          duiding={tekstVan(spendRatio)}
        />
        <Vergelijking
          label="Conversies"
          ratio={convRatio}
          nu={geenPaar ? "—" : num(gepaard.huidig.conversions, 0)}
          toen={geenPaar ? "—" : num(gepaard.vorig.conversions, 0)}
          kleur={convKleur}
          duiding={tekstVan(convRatio)}
        />

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendPerMaand)}</span>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld per maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo conversies</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{num(convPerMaand, 0)}</span>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld per maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Flag className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendPerMaand * 12)}</span>
          <p className="text-micro mt-1 text-muted-foreground">spend over twaalf maanden</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{num(convPerMaand * 12, 0)}</span>
          <p className="text-micro mt-1 text-muted-foreground">conversies over twaalf maanden</p>
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        {voetregel}
      </p>
    </div>
  );
}

/** Een vergelijking van twee absolute waarden: het verschil groot, beide getallen eronder. */
function Vergelijking({ label, ratio, nu, toen, kleur, duiding }: {
  label: string;
  ratio: number | null;
  nu: string;
  toen: string;
  kleur: string;
  duiding: string;
}) {
  // Het verschil en niet de verhouding: "+68%" is wat je wilt weten, "168%" moet je zelf nog
  // omrekenen. Bij een halvering leest "-50%" ook meteen goed, waar "50%" dubbelzinnig is.
  const verschil = ratio == null ? null : Math.round((ratio - 1) * 100);

  return (
    <div className="flex flex-col justify-center">
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-figure font-bold leading-none tabular-nums" style={{ color: kleur }}>
        {verschil == null ? "—" : `${verschil >= 0 ? "+" : ""}${verschil}%`}
      </p>
      <p className="mt-1.5 text-body text-brand-gray tabular-nums">
        <span className="font-semibold">{nu}</span>
        <span className="text-muted-foreground"> tegen {toen}</span>
      </p>
      <p className="text-micro" style={{ color: kleur }}>{duiding}</p>
    </div>
  );
}
