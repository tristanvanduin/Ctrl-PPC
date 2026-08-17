"use client";

// Eén cijfertegel voor het hele dashboard.
//
// Waarom dit bestaat. Hetzelfde ding — een label, een getal, en meestal een verandering eronder —
// stond op zes plekken en op vijf manieren: `text-figure` in de periodeband, `text-2xl font-bold`
// in de doelenkaarten, `text-xl font-bold` in de dagfeed, `text-lg font-semibold` in de
// kanaalkerncijfers, de geo-kloonkaarten en de beurspacing. Wie doorklikt van Overzicht naar een
// kanaal ziet dezelfde soort cijfers ineens een maat kleiner, zonder dat er iets veranderd is aan
// hun belang. Dat is precies wat een product er zelfgebouwd uit laat zien: niet één lelijk scherm,
// maar tien schermen die niet met elkaar overleggen.
//
// Dit is dezelfde fout als twee versies van `median` — twee waarheden voor één begrip — alleen in
// de opmaak in plaats van in de rekenkern. De hygiënepoort vangt hem daarom ook: staat er ergens
// weer een eigen `Kerncijfer`, dan valt de poort om.
//
// Twee maten en niet zes:
//   groot   — de band bovenaan een pagina, het antwoord op "hoe staat het ervoor"
//   compact — een rij cijfers bínnen een kaart, onderbouwing bij een kop die er al staat
// Een derde maat zou weer een keuze zijn zonder criterium.

import type { ReactNode } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Sparkline, type SparkBasis } from "./sparkline";

export type CijferFormaat = "groot" | "compact";

export interface KerncijferDelta {
  /** De verandering in procenten. `null` = niet te berekenen (van niets naar iets). */
  pct: number | null;
  /** Voor kosten is een stijging niet automatisch goed; de aanroeper bepaalt de richting. */
  hogerIsBeter?: boolean;
  /** Waartegen vergeleken is, in woorden. Zonder dat is een percentage betekenisloos. */
  waartegen?: string;
  /** Tekst als er geen percentage is, bijv. "nieuw in deze periode". */
  leegTekst?: string;
}

function Delta({ pct, hogerIsBeter = true, waartegen, leegTekst }: KerncijferDelta) {
  if (pct === null) {
    return <span className="text-micro text-muted-foreground">{leegTekst ?? "geen vergelijking mogelijk"}</span>;
  }
  // Onder een half procent is geen beweging maar ruis; die een kleur geven maakt van
  // meetonnauwkeurigheid een gebeurtenis.
  const vlak = Math.abs(pct) < 0.5;
  const goed = hogerIsBeter ? pct > 0 : pct < 0;
  const kleur = vlak ? "text-muted-foreground" : goed ? "text-green-600" : "text-red-600";
  const Icoon = vlak ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const getal = `${pct > 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")}%`;
  return (
    <span className={`flex items-center gap-1 text-micro ${kleur}`}>
      <Icoon className="h-3 w-3" aria-hidden />
      {getal}
      {waartegen && <span className="text-muted-foreground">{waartegen}</span>}
    </span>
  );
}

export function Kerncijfer({
  label,
  waarde,
  formaat = "groot",
  labelRegels = 1,
  delta,
  reeks,
  reeksBasis = "nul",
  reeksLabel,
  toon,
  onderschrift,
  children,
}: {
  label: string;
  waarde: string;
  formaat?: CijferFormaat;
  /**
   * Hoeveel regels het label hoogstens kost. Staat er in een rij één label dat over twee regels
   * breekt, geef dan 2 mee: dan reserveren álle tegels die ruimte en liggen de getallen op één
   * lijn. Standaard 1, want de meeste labels zijn één woord en dan is reserveren loze ruimte.
   */
  labelRegels?: number;
  delta?: KerncijferDelta;
  /** Het verloop achter dit cijfer, oud naar nieuw. `null` is een gat, geen nul. */
  reeks?: (number | null)[];
  reeksBasis?: SparkBasis;
  reeksLabel?: string;
  /** Kleurt het getal zelf; alleen voor een cijfer dat zélf een status ís (pacing, verval). */
  toon?: "waarschuwing" | "goed";
  /** Een regel onder het getal die zegt waar het over gaat ("conversies", "vorige editie"). */
  onderschrift?: string;
  children?: ReactNode;
}) {
  // Proportionele cijfers en geen `tabular-nums`. Dat laatste geeft elke cijfer de breedte van een
  // nul, en op deze maat wordt een "1" daardoor een spatie met een streepje: "1.086" valt uit
  // elkaar. Uitlijnen is alleen nodig waar getallen ónder elkaar staan — tabelkolommen en
  // asticks — en daar staat het dus wél.
  const maat = formaat === "groot"
    ? "text-figure font-semibold leading-none tracking-tight"
    : "text-xl font-semibold leading-none tracking-tight";
  const kleur = toon === "waarschuwing" ? "text-red-600" : toon === "goed" ? "text-emerald-600" : "text-brand-gray";

  // Uitlijnen doet het LABEL, niet het getal.
  //
  // Eerste poging was `mt-auto` op de waarde: in een grid zijn de tegels even hoog, dus dat legt de
  // onderranden gelijk. Dat repareerde het geval waarvoor het bedoeld was — een label dat over twee
  // regels breekt — en brak meteen een ander: een tegel zónder delta eronder heeft minder te dragen,
  // dus zakte zijn getal precies de hoogte van die delta omlaag. In de periodeband stonden ROAS en
  // CPA daardoor drieëntwintig pixels lager dan de drie ernaast. Gemeten, niet vermoed.
  //
  // De juiste plek om te compenseren is bóven het getal: reserveer regels voor het label en alle
  // getallen beginnen op dezelfde hoogte, ongeacht wat eronder hangt. Hoeveel regels weet alleen de
  // aanroeper — hij kent zijn eigen labels — dus dat is een keuze en geen gok.
  return (
    <div className="flex h-full flex-col">
      <p
        // De regelhoogte staat hier expliciet, want de reservering rekent ermee. Op de
        // overgeërfde 1,5 kwam een label van twee regels drie pixels boven zijn eigen reservering
        // uit en stond de rij alsnog scheef — drie pixels, maar wel zichtbaar in de meting.
        className="text-micro font-medium uppercase tracking-wider text-muted-foreground leading-[1.35]"
        style={labelRegels > 1 ? { minHeight: `${labelRegels * 1.35}em` } : undefined}
      >
        {label}
      </p>
      <p className={`mt-1.5 ${maat} ${kleur}`}>{waarde}</p>
      {onderschrift && <p className="mt-1 text-micro text-muted-foreground">{onderschrift}</p>}
      {/* Het verloop onder het getal. Een totaal verzwijgt hoe het tot stand kwam: twaalf gelijke
          maanden en een half jaar niets gevolgd door een piek geven hetzelfde getal. */}
      {reeks && reeks.length > 1 && (
        <div className="mt-2">
          <Sparkline punten={reeks} basis={reeksBasis} breedte={72} hoogte={formaat === "groot" ? 18 : 14} titel={reeksLabel} />
        </div>
      )}
      {delta && <div className="mt-2"><Delta {...delta} /></div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
