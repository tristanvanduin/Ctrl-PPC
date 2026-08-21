"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

// Feedback: "als je op een week/maand klikt moet er een layover/popup zijn met de relevante
// data uit die periode -- niet een pagina-refresh, niet een nieuw tabblad." Gedeelde, kleine
// overlay voor precies dat: een klik op een periode-cel (maand- of weekstrip) toont zijn
// cijfers in een los paneel bovenop de pagina, en de pagina zelf verandert niet mee.
//
// Geen aparte dialog-library in de codebase (gecheckt: components/ui/ heeft er geen) -- dit is
// bewust net zo lichtgewicht als de bestaande dropdowns (user-menu.tsx, command-palette.tsx),
// alleen gecentreerd met een backdrop in plaats van relatief aan een trigger-knop.
export function PeriodPopover({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-title font-semibold text-brand-gray">{title}</h3>
            {subtitle && <p className="text-micro text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Sluiten"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-gray-100 hover:text-brand-gray"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
