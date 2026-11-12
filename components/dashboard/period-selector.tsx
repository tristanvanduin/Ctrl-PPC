"use client";

// De periodekiezer met vergelijkingsoptie.
//
// Het rekenwerk zit in lib/period/period-range.ts en niet hier: welke maanden een periode
// beslaat is te testen zonder browser, en dat is precies het deel dat stil fout kan gaan.
// Deze component doet alleen de bediening en laat zien wat er vergeleken wordt.
//
// Waarom de gekozen maanden voluit in beeld staan: een filter dat alleen "Laatste 3 maanden"
// toont laat je niet zien dat de lopende maand er niet in zit. Bij een halve maand naast drie
// hele maanden lijkt elke trend te dalen, en niets in de interface zou dat verraden.

import { useEffect, useId, useRef, useState } from "react";
import { Calendar, ChevronDown, TriangleAlert } from "lucide-react";
import {
  PERIOD_PRESETS, COMPARISON_MODES, PRESET_LABEL, COMPARISON_LABEL,
  resolvePeriod, resolveComparison, comparisonWarning, formatRange, monthCount,
  isValidMonth, lastCompleteMonth, SNELKOPPELINGEN,
  type PeriodPreset, type ComparisonMode, type PeriodRange,
} from "@/lib/period/period-range";

export interface PeriodSelection {
  preset: PeriodPreset;
  custom: PeriodRange | null;
  comparison: ComparisonMode;
  /** De uitgerekende periode; de consument hoeft niet zelf te resolven. */
  range: PeriodRange;
  /** De vergelijkingsperiode, of null. */
  compareRange: PeriodRange | null;
}

export function resolveSelection(
  preset: PeriodPreset,
  custom: PeriodRange | null,
  comparison: ComparisonMode,
): PeriodSelection {
  const range = resolvePeriod(preset, custom);
  return { preset, custom, comparison, range, compareRange: resolveComparison(range, comparison) };
}

/**
 * Drie, zes en twaalf maanden als zichtbare knoppen naast de kiezer (bouwplan fase 2).
 *
 * Waarom ze er staan. De periode wisselen was twee klikken en een paneel: openen, kiezen. Voor de
 * drie vensters die je het vaakst naast elkaar legt is dat één klik te veel, en een bediening die
 * achter een paneel zit nodigt niet uit om even te kijken wat er verandert.
 *
 * Geen tweede model: de knoppen zetten de bestaande presets (SNELKOPPELINGEN in period-range.ts),
 * dus ze eindigen op dezelfde laatste volle maand met data en houden de gekozen vergelijking. Is
 * er iets anders gekozen (dit jaar, vorig jaar, een eigen bereik), dan is geen van de drie
 * ingedrukt; de kiezer ernaast toont wat er geldt.
 *
 * Tijdens het laden staan ze er al, uitgeschakeld en even breed: de rij verspringt dan niet als de
 * stand binnenkomt (dezelfde reden als de gereserveerde tekst in de kiezer hieronder).
 */
export function PeriodeSnelkoppelingen({ preset, onKies, laden }: {
  preset: PeriodPreset;
  onKies: (preset: PeriodPreset) => void;
  laden?: boolean;
}) {
  return (
    <div role="group" aria-label="Periode, snelkoppelingen" className="flex gap-0.5 rounded-md border border-border bg-card p-0.5">
      {SNELKOPPELINGEN.map((k) => {
        const actief = !laden && preset === k.preset;
        return (
          <button
            key={k.preset}
            type="button"
            aria-pressed={actief}
            aria-label={PRESET_LABEL[k.preset]}
            title={PRESET_LABEL[k.preset]}
            disabled={laden}
            onClick={() => onKies(k.preset)}
            // min-h-7 plus de rand van de groep: even hoog als de kiezer ernaast, en op een telefoon
            // een raakvlak van 44 px breed.
            className={`min-h-7 min-w-11 rounded px-2 text-body transition-colors disabled:text-muted-foreground ${
              actief
                ? "bg-brand-blue/10 font-semibold text-brand-blue-ink"
                : "text-brand-gray hover:bg-muted/70 disabled:hover:bg-transparent"
            }`}
          >
            {k.kort}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  /** Bij een jaarlijkse beurseditie is "voorgaande periode" misleidend; dan waarschuwt hij. */
  jaarlijkseEditie?: boolean;
  /** De laatste kiesbare eindmaand. Standaard de laatste volle kalendermaand; een pagina met een
   *  datastand geeft de maand waarop haar presets eindigen (usePeriod().eindMaand). */
  maxMaand?: string;
  /** De pagina weet nog niet tot waar de data loopt. Dan staat er geen periode en is hij niet te
   *  openen: de waarde is tot dan het kalendervenster, en dat sprong zodra de stand binnenkwam
   *  (review [8]). Wie in die tijd een eindmaand koos, kon ook voorbij de data kiezen. */
  laden?: boolean;
}

export function PeriodSelector({ value, onChange, jaarlijkseEditie, maxMaand, laden }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const waarschuwing = comparisonWarning(value.range, value.comparison, { jaarlijkseEditie });

  // Zelfde patroon als components/layout/user-menu.tsx: zonder dit sloot het paneel alleen via
  // de trigger-knop zelf, niet door ergens anders op de pagina te klikken -- inconsistent met
  // elke andere dropdown in de app (gebruikersmenu, command palette, meldingen-bel).
  // Escape sluit hem ook (zoals components/insights/eigenaar-kiezer.tsx) en geeft de focus terug
  // aan de knop: wie met het toetsenbord werkt, kon het paneel anders alleen dicht krijgen door
  // terug te tabben naar de knop, en na sluiten stond de focus nergens. Alleen luisteren zolang
  // hij open is; dicht hoeft niemand elke klik op de pagina te zien.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function zet(preset: PeriodPreset, custom: PeriodRange | null, comparison: ComparisonMode) {
    onChange(resolveSelection(preset, custom, comparison));
  }

  // De maandvelden werken op de al uitgerekende periode, zodat je vanuit elke preset verder
  // kunt verfijnen zonder eerst "Aangepast" te moeten kiezen.
  function zetMaand(kant: "start" | "end", maand: string) {
    if (!isValidMonth(maand)) return;
    const basis = value.range;
    zet("custom", { ...basis, [kant]: maand }, value.comparison);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open && !laden}
        aria-controls={open && !laden ? panelId : undefined}
        aria-busy={laden || undefined}
        disabled={laden}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-body text-brand-gray hover:border-gray-400 disabled:text-muted-foreground disabled:hover:border-border"
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        {laden ? (
          // Tijdens het laden dezelfde twee teksten, maar onzichtbaar op een grijs vlak: dan heeft de
          // knop al de breedte en hoogte die hij straks krijgt. "Periode laden…" was één regel; op
          // een telefoon breekt de echte inhoud in twee, en die groei van 32 naar 50 px schoof de
          // hele pagina omlaag (CLS 0,14 op mobiel, in zijn eentje boven de grens van 0,10). Het
          // kalendervenster van nu kan een maand naast het echte zitten, maar is even breed.
          <>
            <span className="sr-only">Periode laden…</span>
            <span className="font-medium rounded bg-muted/70 text-transparent select-none" aria-hidden>{formatRange(value.range)}</span>
            {value.compareRange && (
              <span className="text-micro rounded bg-muted/70 text-transparent select-none" aria-hidden>
                tegen {formatRange(value.compareRange)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-medium">{formatRange(value.range)}</span>
            {value.compareRange && (
              <span className="text-micro text-muted-foreground">
                tegen {formatRange(value.compareRange)}
              </span>
            )}
          </>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !laden && (
        <div id={panelId} role="dialog" aria-label="Periode en vergelijking" className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-border bg-card supports-[backdrop-filter]:bg-[var(--zweef-vlak)] supports-[backdrop-filter]:backdrop-blur-md p-3 shadow-lg">
          <p className="mb-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">Periode</p>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {PERIOD_PRESETS.filter((p) => p !== "custom").map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={value.preset === p}
                // Een preset is een volledige keuze: daarna dicht. De maandvelden en de
                // vergelijking houden hem open, die verfijn je.
                onClick={() => { zet(p, null, value.comparison); setOpen(false); }}
                className={`rounded-md border px-2 py-1.5 text-left text-body ${
                  value.preset === p
                    ? "border-brand-blue bg-brand-blue/5 font-medium text-brand-blue-ink"
                    : "border-border text-brand-gray hover:border-gray-400"
                }`}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-micro text-muted-foreground">Van</span>
              <input
                type="month"
                value={value.range.start}
                max={value.range.end}
                onChange={(e) => zetMaand("start", e.target.value)}
                className="w-full rounded-md border border-border px-2 py-1 text-body focus:border-brand-blue focus:outline-none"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-micro text-muted-foreground">Tot en met</span>
              <input
                type="month"
                value={value.range.end}
                min={value.range.start}
                // De lopende maand is onvolledig en hoort niet kiesbaar te zijn, en een maand na
                // het eind van de data ook niet. In Amsterdam, net als resolvePeriod: in UTC liep
                // dit rond middernacht op de 1e een maand achter, en dan stond de eindmaand boven
                // zijn eigen max.
                max={maxMaand ?? lastCompleteMonth()}
                onChange={(e) => zetMaand("end", e.target.value)}
                className="w-full rounded-md border border-border px-2 py-1 text-body focus:border-brand-blue focus:outline-none"
              />
            </label>
          </div>

          <p className="mb-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">Vergelijken met</p>
          <div className="space-y-1">
            {COMPARISON_MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={value.comparison === m}
                onClick={() => zet(value.preset, value.custom, m)}
                className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-body ${
                  value.comparison === m
                    ? "border-brand-blue bg-brand-blue/5 font-medium text-brand-blue-ink"
                    : "border-border text-brand-gray hover:border-gray-400"
                }`}
              >
                <span>{COMPARISON_LABEL[m]}</span>
                {m !== "none" && (
                  // Voluit tonen waar tegen vergeleken wordt: "voorgaande periode" en "vorig
                  // jaar" geven bij een beurs een wezenlijk ander antwoord, en dat verschil
                  // hoort zichtbaar te zijn vóór je klikt.
                  <span className="text-micro text-muted-foreground">
                    {formatRange(resolveComparison(value.range, m)!)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {waarschuwing && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-micro text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {waarschuwing}
            </p>
          )}

          <p className="mt-2 text-micro text-muted-foreground">
            {monthCount(value.range)} maanden. De lopende maand telt niet mee: die is nog niet compleet.
          </p>
        </div>
      )}
    </div>
  );
}
