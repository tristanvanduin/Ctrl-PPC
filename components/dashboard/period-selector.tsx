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

import { useState } from "react";
import { Calendar, ChevronDown, TriangleAlert } from "lucide-react";
import {
  PERIOD_PRESETS, COMPARISON_MODES, PRESET_LABEL, COMPARISON_LABEL,
  resolvePeriod, resolveComparison, comparisonWarning, formatRange, monthCount,
  isValidMonth, addMonths,
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

interface Props {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  /** Bij een jaarlijkse beurseditie is "voorgaande periode" misleidend; dan waarschuwt hij. */
  jaarlijkseEditie?: boolean;
}

export function PeriodSelector({ value, onChange, jaarlijkseEditie }: Props) {
  const [open, setOpen] = useState(false);
  const waarschuwing = comparisonWarning(value.range, value.comparison, { jaarlijkseEditie });

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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-body text-rm-gray hover:border-gray-400"
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{formatRange(value.range)}</span>
        {value.compareRange && (
          <span className="text-micro text-muted-foreground">
            tegen {formatRange(value.compareRange)}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-border bg-card supports-[backdrop-filter]:bg-[var(--zweef-vlak)] supports-[backdrop-filter]:backdrop-blur-md p-3 shadow-lg">
          <p className="mb-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">Periode</p>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {PERIOD_PRESETS.filter((p) => p !== "custom").map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => zet(p, null, value.comparison)}
                className={`rounded-md border px-2 py-1.5 text-left text-body ${
                  value.preset === p
                    ? "border-rm-blue bg-rm-blue/5 font-medium text-rm-blue-ink"
                    : "border-border text-rm-gray hover:border-gray-400"
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
                className="w-full rounded-md border border-border px-2 py-1 text-body focus:border-rm-blue focus:outline-none"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-micro text-muted-foreground">Tot en met</span>
              <input
                type="month"
                value={value.range.end}
                min={value.range.start}
                // De lopende maand is onvolledig en hoort niet kiesbaar te zijn.
                max={addMonths(new Date().toISOString().slice(0, 7), -1)}
                onChange={(e) => zetMaand("end", e.target.value)}
                className="w-full rounded-md border border-border px-2 py-1 text-body focus:border-rm-blue focus:outline-none"
              />
            </label>
          </div>

          <p className="mb-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">Vergelijken met</p>
          <div className="space-y-1">
            {COMPARISON_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => zet(value.preset, value.custom, m)}
                className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-body ${
                  value.comparison === m
                    ? "border-rm-blue bg-rm-blue/5 font-medium text-rm-blue-ink"
                    : "border-border text-rm-gray hover:border-gray-400"
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
