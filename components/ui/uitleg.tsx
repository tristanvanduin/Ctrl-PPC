"use client";

// Een uitleg die pas verschijnt als je erom vraagt.
//
// ── WAAROM DIT ER KOMT ──────────────────────────────────────────────────────
//
// De kaarten waren tekstzwaar geworden: boven bijna elke tabel stond een alinea die uitlegde wat
// de kolommen betekenen. Dat leest de eerste keer prettig en daarna nooit meer -- en het duwt de
// cijfers, waar je voor komt, onder de vouw.
//
// Een blok proza dat er altijd staat en zelden gelezen wordt, is erger dan geen uitleg: het leert
// de lezer die plek over te slaan, en dan mist hij hem op de dag dat er wél iets bijzonders staat.
// Dezelfde regel als bij de samenvattingszin die null mag zijn.
//
// ── WAAROM EEN KNOP EN GEEN title-ATTRIBUUT ─────────────────────────────────
//
// `title=""` is gratis, maar: hij verschijnt pas na ongeveer een seconde, hij is met het
// toetsenbord niet te bereiken, op aanraakschermen bestaat hij niet, en hij is niet op te maken.
// Deze variant is een echte knop -- tabbaar, met aria-label, en hij opent ook op tik.
//
// De inhoud van de hover is dus GEEN vervanging voor iets wat je moet weten om het scherm te
// kunnen lezen. Wat noodzakelijk is staat op het scherm; hier staat wat het preciezer maakt.

import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function Uitleg({
  children,
  /** Wat er in de knop-toelichting komt voor wie hem niet ziet maar hoort. */
  label = "Uitleg",
  side = "top",
  /** Groter dan het icoon: 12px pictogram met een 24px raakvlak eromheen. */
  className = "",
}: {
  children: React.ReactNode;
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-rm-blue-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rm-blue-ink ${className}`}
      >
        <Info className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 items-start text-left leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Een kolomkop die zelf de trigger is.
 *
 * Bij acht kolommen naast elkaar is er geen ruimte voor een los icoontje per kop -- dat zou de
 * kolom breder maken dan het getal eronder. De kop krijgt daarom een stippellijn eronder: het
 * bekende teken voor "hier zit meer achter", zonder extra breedte.
 */
export function UitlegKop({
  children,
  uitleg,
  className = "",
}: {
  children: React.ReactNode;
  uitleg: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={`cursor-help underline decoration-dotted decoration-from-font underline-offset-4 transition-colors hover:text-rm-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rm-blue-ink ${className}`}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 items-start text-left leading-snug">
        {uitleg}
      </TooltipContent>
    </Tooltip>
  );
}
