"use client";

// De verdeling als één regel: "Google 72,3% · Meta 20,1% · Microsoft 7,6% van de kosten".
//
// Voor de ringkaarten in de nieuwe weergave (CampaignTypeSplit, BreakdownDonuts), die hun ringen
// achter een knop zetten. Wat open blijft, is de verdeling zelf in woorden en getallen; de ring is
// dezelfde verdeling als vorm. De aanroeper rekent de aandelen met dezelfde functies als de legenda
// van de ring (buildNetworkSplit en zijn eigen `pct`), zodat de regel en de legenda nooit een punt
// verschillen.
//
// Meer dan `max` delen: de grootste en "en N andere". De andere staan met hun aandeel in de ring,
// in de legenda ernaast en in de tabel eronder; geen van die drie verdwijnt.

export type VerdelingDeel = { sleutel: string; label: string; aandeel: string; kleur: string };

export function VerdelingRegel({ delen, waarvan, max = 4 }: {
  delen: readonly VerdelingDeel[];
  /** Waar de aandelen een deel van zijn: "van de kosten". */
  waarvan: string;
  max?: number;
}) {
  if (delen.length === 0) return null;
  const getoond = delen.length > max ? delen.slice(0, max - 1) : delen;
  const rest = delen.length - getoond.length;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-foreground" data-verdeling-regel>
      {getoond.map((d, i) => (
        <span key={d.sleutel} className="inline-flex items-center gap-1.5" data-verdeling-deel={d.sleutel}>
          {i > 0 && <span aria-hidden>·</span>}
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.kleur }} aria-hidden />
          <span className="font-medium text-brand-gray">{d.label}</span>
          <span className="tabular-nums">{d.aandeel}</span>
        </span>
      ))}
      {rest > 0 && <span>· en {rest} {rest === 1 ? "ander" : "andere"}</span>}
      <span>{waarvan}</span>
    </p>
  );
}
