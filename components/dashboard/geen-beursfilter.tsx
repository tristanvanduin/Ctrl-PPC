"use client";

import { Info } from "lucide-react";
import { geenBeursfilterTekst } from "@/lib/overzicht/beursfilter";

/** De regel boven een blok dat de gekozen beurs niet volgt (lib/overzicht/beursfilter.ts). */
export function GeenBeursfilter({ geo, onderwerp = "", meervoud = false, tekst: vasteTekst }: {
  geo: string | null | undefined;
  onderwerp?: string;
  meervoud?: boolean;
  /** Een al opgebouwde zin (overzichtBeursmelding); dan geldt onderwerp niet. */
  tekst?: string | null;
}) {
  const tekst = vasteTekst !== undefined ? vasteTekst : geenBeursfilterTekst(geo, onderwerp, meervoud);
  if (!tekst) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-800" data-geen-beursfilter={geo ?? undefined}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {tekst}
    </p>
  );
}
