"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FaqItem {
  vraag: string;
  antwoord: string;
}

// Fase 7, Task 3: strakke accordions voor /faq. Eén item open tegelijk -- bij een lijst met
// technische antwoorden (privacy, RLS) helpt dat de lezer, die anders al snel drie lange
// antwoorden tegelijk openstaan heeft.
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.vraag} className="overflow-hidden rounded-[6px] border border-off-white/10 bg-midnight-slate-raised">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold text-off-white">{item.vraag}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-neon-indigo transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {isOpen && (
              <p className="px-5 pb-5 text-sm leading-relaxed text-off-white/60">{item.antwoord}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
