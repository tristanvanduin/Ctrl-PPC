"use client";

// Sectie 13.2, fase 3 (docs/MASTERPLAN.md): de open/dicht-status van de zijbalk op smalle
// schermen, gedeeld tussen de TopBar (de hamburger-knop) en de Sidebar (het paneel zelf) --
// twee zustercomponenten onder app/(app)/layout.tsx die geen ouder-kind-relatie hebben. Een
// context is hier de juiste vorm: dit is UI-status van het scherm, geen data die met een
// window-event hoeft te synchroniseren zoals de klantenlijst elders in dit bestand doet.
//
// Standaard dicht: op een smal scherm mag de eerste render nooit de content overdekken. Op
// `lg` en breder doet deze status er niet toe -- de zijbalk staat daar altijd, zie de
// `lg:translate-x-0` in sidebar.tsx die de mobiele status overstemt.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface SidebarMobileState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const SidebarMobileContext = createContext<SidebarMobileState | null>(null);

export function SidebarMobileProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <SidebarMobileContext.Provider value={{ open, toggle, close }}>
      {children}
    </SidebarMobileContext.Provider>
  );
}

/** Buiten de provider (zou een programmeerfout zijn, geen runtime-toestand) een veilige
 *  terugval: dicht, en de knoppen doen dan niets in plaats van te crashen. */
export function useSidebarMobile(): SidebarMobileState {
  return useContext(SidebarMobileContext) ?? { open: false, toggle: () => {}, close: () => {} };
}
