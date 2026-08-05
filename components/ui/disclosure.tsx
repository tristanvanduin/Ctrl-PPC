"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// Inklappen, op één plek.
//
// De dashboardpagina stapelt twaalf blokken onder elkaar, elk met een volledige tabel eronder.
// Wie de kaart wil zien scrolt langs vijftig landregels; wie de donut wil zien langs de tabel
// die eronder hoort. Dat is niet op te lossen door dingen weg te halen — de cijfers moeten er
// zijn — maar wel door ze dicht te laten beginnen.
//
// Twee vormen, bewust gescheiden:
//
// 1. Een heel blok dat dicht kan (CollapsiblePanel). Het onthoudt de keuze per gebruiker, want
//    een paneel dat bij elke navigatie weer openklapt is geen keuze maar een obstakel.
//
// 2. Een lijst die kort begint (useTruncatedList + MeerKnop). Hier gaat het niet om het blok
//    maar om de rijen: de eerste drie zijn het verhaal, de rest is naslag.

const OPSLAG_PREFIX = "paneel-open:";

function leesOpgeslagen(id: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(OPSLAG_PREFIX + id);
    return v === null ? null : v === "1";
  } catch {
    // Privémodus of geblokkeerde opslag: dan onthouden we het gewoon niet.
    return null;
  }
}

function schrijfOpgeslagen(id: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPSLAG_PREFIX + id, open ? "1" : "0");
  } catch {
    /* niets te doen; het paneel werkt ook zonder geheugen */
  }
}

export function CollapsiblePanel({
  id,
  title,
  subtitle,
  icon,
  meta,
  defaultOpen = true,
  naadloos = false,
  children,
}: {
  /** Stabiele sleutel voor het onthouden van open/dicht. Verander hem niet zonder reden. */
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Korte samenvatting die óók zichtbaar blijft als het paneel dicht is — anders is dichtklappen informatieverlies. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /**
   * Zonder eigen kaartrand, voor een paneel dat ín een andere kaart staat.
   *
   * Een paneel met rand, hoeken en schaduw binnen een kaart die datzelfde al heeft, geeft een
   * kaart-in-een-kaart: twee randen op drie pixels van elkaar. Naadloos houdt alleen de scheiding
   * bovenaan, zodat het als een volgend blok van dezelfde kaart leest.
   */
  naadloos?: boolean;
}) {
  // Server en eerste client-render moeten hetzelfde opleveren, dus de opgeslagen keuze wordt
  // pas ná het monteren toegepast. Zou dat in de initializer staan, dan hydrateert React op een
  // andere boom dan de server stuurde.
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const opgeslagen = leesOpgeslagen(id);
    if (opgeslagen !== null) setOpen(opgeslagen);
  }, [id]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      schrijfOpgeslagen(id, !v);
      return !v;
    });
  }, [id]);

  const paneelId = `paneel-${id}`;

  return (
    <div className={naadloos ? "border-t border-border" : "bg-card rounded-xl border border-border shadow-sm overflow-hidden"}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={paneelId}
        className="w-full px-5 py-3 flex items-center gap-2 text-left hover:bg-gray-50/70 transition-colors"
      >
        {icon}
        <h3 className="text-title font-semibold text-rm-gray">{title}</h3>
        {subtitle && <span className="text-meta text-muted-foreground">{subtitle}</span>}
        <span className="ml-auto flex items-center gap-2">
          {meta}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div id={paneelId} className="border-t border-border">{children}</div>}
    </div>
  );
}

/**
 * Open/dicht dat onthouden wordt, zonder de paneel-chrome eromheen. Voor een deel ván een kaart
 * — de tabel onder een kaartje of een donut — waar de kop al bestaat en zijn eigen knoppen heeft.
 */
export function useRememberedOpen(id: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const opgeslagen = leesOpgeslagen(id);
    if (opgeslagen !== null) setOpen(opgeslagen);
  }, [id]);
  const toggle = useCallback(() => {
    setOpen((v) => {
      schrijfOpgeslagen(id, !v);
      return !v;
    });
  }, [id]);
  return [open, toggle];
}

/** De balk waarmee zo'n deel open- en dichtgaat. Volle breedte, onderaan het blok erboven. */
export function RegioToggle({
  open,
  onToggle,
  label,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  /** Wat er achter zit, inclusief aantal: "tabel per land (12)". */
  label: string;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="w-full px-5 py-2.5 text-meta font-medium text-rm-blue-ink hover:bg-gray-50 border-t border-border flex items-center justify-center gap-1.5 transition-colors"
    >
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      {open ? `Verberg ${label}` : `Toon ${label}`}
    </button>
  );
}

export interface TruncatedList<T> {
  /** De rijen die nu getoond worden. */
  zichtbaar: T[];
  /** Hoeveel er nog achter de knop zitten; 0 als alles zichtbaar is. */
  verborgen: number;
  uitgeklapt: boolean;
  toggle: () => void;
}

/**
 * Een lijst die kort begint. Zijn er niet meer rijen dan de limiet, dan gedraagt dit zich als
 * een gewone lijst: `verborgen` is 0 en de knop hoort niet getoond te worden.
 */
export function useTruncatedList<T>(items: T[], limiet: number): TruncatedList<T> {
  const [uitgeklapt, setUitgeklapt] = useState(false);
  const toggle = useCallback(() => setUitgeklapt((v) => !v), []);
  const zichtbaar = uitgeklapt ? items : items.slice(0, limiet);
  return { zichtbaar, verborgen: Math.max(0, items.length - limiet), uitgeklapt, toggle };
}

/**
 * De knop onder een ingekorte lijst. Noemt het aantal, want "Meer tonen" zonder getal laat je
 * klikken om erachter te komen of het de moeite is.
 */
export function MeerKnop({
  verborgen,
  uitgeklapt,
  onToggle,
  eenheid = "regels",
}: {
  verborgen: number;
  uitgeklapt: boolean;
  onToggle: () => void;
  eenheid?: string;
}) {
  if (verborgen === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-5 py-2.5 text-meta font-medium text-rm-blue-ink hover:bg-gray-50 border-t border-border flex items-center justify-center gap-1.5 transition-colors"
    >
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${uitgeklapt ? "rotate-180" : ""}`} />
      {uitgeklapt ? "Toon minder" : `Toon ${verborgen} ${eenheid} meer`}
    </button>
  );
}
