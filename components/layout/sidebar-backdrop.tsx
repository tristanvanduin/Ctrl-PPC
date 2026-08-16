"use client";

// Het donkere vlak achter de zijbalk zodra die op een smal scherm openstaat. Los van
// sidebar.tsx: de zijbalk zelf heeft een hogere z-index en moet BOVEN dit vlak blijven liggen,
// en `lg:hidden` zorgt dat dit element op een breed scherm nooit bestaat (geen onzichtbaar vlak
// dat per ongeluk clicks opvangt).
import { useSidebarMobile } from "./sidebar-mobile-context";

export function SidebarBackdrop() {
  const { open, close } = useSidebarMobile();
  if (!open) return null;
  return (
    <button
      aria-label="Menu sluiten"
      onClick={close}
      className="fixed inset-0 z-40 bg-black/50 lg:hidden"
    />
  );
}
