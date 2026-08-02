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
  const kleur = toon === "waarschuwing" ? "text-red-600" : toon === "goed" ? "text-emerald-600" : "text-rm-gray";

  // De hele tegel is een kolom en het getal zit in een blok dat naar beneden wordt geduwd.
  //
  // Zonder dat ligt een rij tegels scheef zodra één label langer is dan de rest: in de
  // kanaalkerncijfers brak "Lead-formulieren + website-conversies (28d)" over twee regels en zakte
  // alleen dát cijfer een regel omlaag, terwijl de drie andere op hun plek bleven. Vier getallen
  // die je naast elkaar moet lezen horen op één lijn te liggen. In een grid zijn de tegels even
  // hoog, dus `mt-auto` legt de onderranden gelijk — ongeacht hoeveel regels het label kost.
  return (
    <div className="flex h-full flex-col">
      <p className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-auto pt-1.5 ${maat} ${kleur}`}>{waarde}</p>
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
