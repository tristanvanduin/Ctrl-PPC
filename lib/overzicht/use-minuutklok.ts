"use client";

// Eén minuutklok voor labels die van de tijd afhangen ("zojuist", "12 min geleden").
//
// WAAROM. Zo'n label wordt bij het renderen berekend. Op een scherm dat open blijft staan zonder
// nieuwe render stond er na een uur nog steeds "zojuist": precies de onwaarheid die het label
// moest voorkomen. Deze klok laat de aanroeper elke minuut opnieuw renderen, zodat het label
// meeloopt.
//
// ALLEEN ZOLANG HET TABBLAD ZICHTBAAR IS. Verborgen staat de klok stil (geen timers op een tabblad
// waar niemand naar kijkt); bij terugkomst tikt hij meteen één keer, want er kan een uur voorbij
// zijn, en loopt daarna weer per minuut. Er komt geen netwerkverzoek aan te pas.

import { useEffect, useState } from "react";

export const MINUUT_MS = 60_000;

/** Wat de klok van zijn omgeving nodig heeft. In de browser: document en setInterval. */
export interface KlokOmgeving {
  zichtbaar: () => boolean;
  /** Meldt elke wissel in zichtbaarheid; geeft terug hoe je je afmeldt. */
  opZichtbaarheid: (bij: () => void) => () => void;
  /** Start een interval; geeft terug hoe je hem stopt. */
  interval: (bij: () => void, ms: number) => () => void;
}

/**
 * Start de klok: `tik` elke minuut zolang het tabblad zichtbaar is, en één keer direct als het
 * weer zichtbaar wordt. Geeft terug hoe je hem stopt (dan loopt er geen timer en geen luisteraar
 * meer).
 */
export function startMinuutklok(tik: () => void, omgeving: KlokOmgeving): () => void {
  let stopInterval: (() => void) | null = null;
  const loop = () => { if (!stopInterval) stopInterval = omgeving.interval(tik, MINUUT_MS); };
  const sta = () => { stopInterval?.(); stopInterval = null; };
  if (omgeving.zichtbaar()) loop();
  const afmelden = omgeving.opZichtbaarheid(() => {
    if (omgeving.zichtbaar()) { tik(); loop(); } else sta();
  });
  return () => { sta(); afmelden(); };
}

const browser: KlokOmgeving = {
  zichtbaar: () => document.visibilityState === "visible",
  opZichtbaarheid: (bij) => {
    document.addEventListener("visibilitychange", bij);
    return () => document.removeEventListener("visibilitychange", bij);
  },
  interval: (bij, ms) => {
    const id = window.setInterval(bij, ms);
    return () => window.clearInterval(id);
  },
};

/**
 * Laat de aanroeper elke minuut opnieuw renderen zolang het tabblad zichtbaar is. De waarde is een
 * teller, geen tijd: de aanroeper leest de klok zelf bij het renderen.
 *
 * @param aan Uit: geen timer, geen luisteraar.
 */
export function useMinuutklok(aan = true): number {
  const [tik, setTik] = useState(0);
  useEffect(() => {
    if (!aan) return;
    return startMinuutklok(() => setTik((n) => n + 1), browser);
  }, [aan]);
  return tik;
}
