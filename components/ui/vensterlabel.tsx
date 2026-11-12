"use client";

// Het venster van een blok, zichtbaar in zijn kop (bouwplan fase 2).
//
// Waarom dit bestaat. Op het Overzicht stonden zes conversietotalen die elk over een ander venster
// gingen: de band over de gekozen periode, de ringen over "90 dagen", de staven over zes maanden,
// de kanaaltabel over vierentwintig, het jaaroverzicht over het kalenderjaar. Geen van die blokken
// zei welk. Wie de periode verzette zag één blok veranderen en twintig stilstaan, en kon niet zien
// of dat een fout was of de bedoeling.
//
// Elk blok zegt nu in zijn kop één van drie dingen:
//   volgt periode · jun–aug 2026     het blok luistert naar de kiezer bovenaan
//   jaarblok · 2026                  het blok gaat over het kalenderjaar (pacing, jaardoel, beurs)
//   vast venster · laatste 28 dagen  het blok heeft een eigen venster en kan de periode niet
//                                    volgen zonder extra verzoek; dan staat dat venster er eerlijk bij
//
// Eén component en geen losse tekstjes per kaart: dezelfde woorden, dezelfde plek, en de meting
// (scripts/meet-overzicht.mjs) vindt de blokken aan `data-venster`. "Volgt periode" is licht
// gekleurd, de andere twee neutraal: zo zie je in één blik welke blokken meebewegen.
//
// EN EEN VIERDE SOORT ZONDER LABEL: de stand van nu (STAND_VAN_NU). De bronrij (live of demo, de
// conversielag, de datastand), de to-do's, de notities en "Over dit tabblad" gaan over geen enkel
// venster: ze zeggen hoe het er op dit moment voor staat. Een zichtbaar label "stand van nu" bij
// een chip die "Conversielag: 3 dagen" zegt, is ruis. Maar de meting moet ze kunnen onderscheiden
// van een blok dat zijn venster vergat te noemen, en vooral van een blok dat de periode hoort te
// volgen: zonder dit kenmerk leende de meting voor deze blokken het label van een buurblok, en
// telde ze als "volgt periode, maar beweegt niet".

import { usePeriod } from "@/lib/period/period-context";
import { formatRange, formatRangeKort } from "@/lib/period/period-range";
import { today } from "@/lib/reporting-date";

/**
 * Voor op de buitenste tag van een blok dat de stand van nu toont en geen venster heeft:
 * `<div {...STAND_VAN_NU} className="...">`. Onzichtbaar; alleen de meting leest het.
 */
export const STAND_VAN_NU = { "data-venster": "stand" } as const;

type Props = (
  /** `kaal`: alleen "volgt periode", zonder de maanden; voor een kop die de periode zelf al voluit
   *  toont (de KPI-band), waar de maanden ernaast een herhaling zijn. */
  | { soort: "periode"; kaal?: boolean }
  /** Zonder `jaar`: het lopende rapportagejaar (Amsterdam), het jaar waar pacing, jaardoel en
   *  prognose over gaan. Een blok dat zijn jaar uit de data kent, geeft dat mee. */
  | { soort: "jaar"; jaar?: number }
  | { soort: "vast"; venster: string }
) & {
  /** Een voorbehoud dat bij dit venster hoort, kort: "zonder Microsoft", "alleen Google". */
  toevoeging?: string;
  /** Het voorbehoud voluit, voor de uitleg bij het label (title): wat het wel en niet raakt.
   *  Zonder deze staat de korte toevoeging in de uitleg. */
  toevoegingUitleg?: string;
  className?: string;
};

export function Vensterlabel(props: Props) {
  const periode = usePeriod();
  const { soort, toevoeging, toevoegingUitleg, className = "" } = props;
  const jaar = soort === "jaar" ? props.jaar ?? Number(today().slice(0, 4)) : null;
  const tekst = soort === "periode" ? (props.kaal ? "volgt periode" : `volgt periode · ${formatRangeKort(periode.range)}`)
    : soort === "jaar" ? `jaarblok · ${jaar}`
    : `vast venster · ${props.venster}`;
  const uitleg = soort === "periode" ? `Dit blok volgt de gekozen periode: ${formatRange(periode.range)}.`
    : soort === "jaar" ? `Dit blok gaat over het kalenderjaar ${jaar} en volgt de gekozen periode niet.`
    : `Dit blok heeft een eigen venster (${props.venster}) en volgt de gekozen periode niet.`;
  const kleur = soort === "periode"
    ? "border-brand-blue/30 bg-brand-blue/5 text-brand-blue-ink"
    : "border-border text-muted-foreground";
  return (
    <span
      data-venster={soort}
      title={toevoegingUitleg ? `${uitleg} ${toevoegingUitleg}` : toevoeging ? `${uitleg} ${toevoeging}.` : uitleg}
      // `truncate` en geen `shrink-0`: in een kop die omloopt (flex-wrap) schuift het label naar
      // een eigen regel; in een kop die dat niet kan (de knop van een uitklappaneel) wordt het
      // ingekort in plaats van de titel ernaast woord voor woord te laten afbreken. De volledige
      // tekst staat in `title`. De opmaak van de kop eromheen (kapitalen, vet) geldt hier niet.
      className={`inline-block min-w-0 max-w-full truncate rounded-full border px-2 py-px align-middle text-meta font-normal normal-case tracking-normal ${kleur} ${className}`}
    >
      {tekst}{toevoeging ? ` · ${toevoeging}` : ""}
    </span>
  );
}
