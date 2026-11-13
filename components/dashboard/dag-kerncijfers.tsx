"use client";

// De kerncijfertegels bij een periode per dag (stap 3 van het periodemodel): een event, vrije
// datums, of een vergelijking die maanden niet kunnen (de vorige editie, een vrije periode).
//
// Dezelfde vijf tegels als PeriodSummary in de vorm "tegels" (Kerncijfer, de pil met "was", de
// nadruk op de grootste verandering, dezelfde regels voor een deel en voor "nieuw"), maar de cijfers
// komen uit telDagVergelijking (lib/period/dag-telling.ts, via lib/period/use-dag-telling.ts) en
// niet uit maandreeksen. Er is daarom geen sparkline: er is geen reeks per maand binnen een actie
// van tien dagen, en een lijn van twee punten zou een verloop suggereren.
//
// Kiest de gebruiker "niets", dan is er geen vergelijking en dus geen delta: geen pijl, geen
// percentage, geen "was", en ook geen lege plek waar ze stonden (Kerncijfer zonder delta).

import { formatRoas } from "@/lib/forecast-format";
import { usePeriod } from "@/lib/period/period-context";
import { formatDagPeriode } from "@/lib/period/dag-periode";
import { somVergelijking, verhoudingVergelijking } from "@/lib/period/vergelijkbaar-deel";
import type { DagCijfers } from "@/lib/period/use-dag-telling";
import type { PeriodDelta } from "@/lib/period/apply-period";
import { nadrukIndex } from "@/lib/overzicht/bovenkant";
import { Kerncijfer, type KerncijferDelta } from "@/components/ui/kerncijfer";
import { BandLaadvlak } from "@/components/ui/laadvlak";
import { alsDelta, aantal, euro } from "./period-summary";

/** De vijf tegels uit de telling, zuiver: ook de tests lezen deze lijst. */
export function dagTegels(cijfers: DagCijfers): { label: string; waarde: string; delta: KerncijferDelta | undefined }[] {
  const v = cijfers.vergelijking;
  const t = (v ? v.huidig : cijfers.alleen!).totaal;
  const d = v?.deltas;
  // "Nieuw in deze periode" alleen als er echt niets te paren viel én geen kanaal buiten het
  // percentage valt: anders is het vorige totaal niet leeg maar onvolledig.
  const som = (totaal: number, delta: PeriodDelta | undefined, hogerIsBeter: boolean, opmaak: (n: number) => string): KerncijferDelta | undefined => {
    if (!delta) return undefined;
    if (delta.vorig === 0 && totaal > 0 && v!.ongepaard.length === 0) return { pct: delta.pct, hogerIsBeter, leegTekst: "nieuw in deze periode" };
    return alsDelta(somVergelijking(totaal, delta), hogerIsBeter, opmaak);
  };
  const roas = t.adSpend > 0 ? t.revenue / t.adSpend : null;
  const cpa = t.conversions > 0 ? t.adSpend / t.conversions : null;
  return [
    { label: "Conversies", waarde: aantal(t.conversions), delta: som(t.conversions, d?.conversions, true, aantal) },
    { label: "Omzet", waarde: euro(t.revenue), delta: som(t.revenue, d?.revenue, true, euro) },
    { label: "Advertentiekosten", waarde: euro(t.adSpend), delta: som(t.adSpend, d?.adSpend, false, euro) },
    { label: "ROAS", waarde: roas === null ? "—" : formatRoas(roas),
      delta: alsDelta(verhoudingVergelijking({ totaalTeller: t.revenue, totaalNoemer: t.adSpend, teller: d?.revenue, noemer: d?.adSpend }), true, (n) => formatRoas(n)) },
    { label: "CPA", waarde: cpa === null ? "—" : euro(cpa),
      delta: alsDelta(verhoudingVergelijking({ totaalTeller: t.adSpend, totaalNoemer: t.conversions, teller: d?.adSpend, noemer: d?.conversions }), false, euro) },
  ];
}

/** De uitlegregels onder de tegels: per kanaal wat anders geteld is of buiten het percentage valt. */
export function dagUitleg(cijfers: DagCijfers, waarschuwingen: readonly string[]): string[] {
  const v = cijfers.vergelijking;
  const perKanaal = v ? v.perKanaal.map((k) => k.uitleg) : (cijfers.alleen?.perKanaal ?? []).map((k) => k.uitleg);
  return [...new Set([...cijfers.fouten, ...perKanaal.filter((u): u is string => !!u), ...waarschuwingen])];
}

export function DagKerncijfers({ cijfers, laden }: { cijfers: DagCijfers | null; laden: boolean }) {
  const periode = usePeriod();
  const staat = periode.dag;
  if (!staat || !cijfers) return laden ? <BandLaadvlak compact /> : null;
  const tegels = dagTegels(cijfers);
  const nadruk = nadrukIndex(tegels.map((t) => t.delta?.pct));
  const c = cijfers.vergelijking?.vergelijking ?? null;
  const uitleg = dagUitleg(cijfers, staat.vergelijking.waarschuwingen);
  return (
    <section aria-label={`Kerncijfers over ${formatDagPeriode(staat.periode)}`} data-dagperiode
      className="rounded-xl border border-border bg-card shadow-sm">
      {/* Hetzelfde raster en dezelfde nadruk als de tegels van PeriodSummary. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {tegels.map((t, i) => (
          <div key={t.label} data-nadruk={i === nadruk || undefined}
            className="relative px-3 pb-3 pt-3 lg:border-l lg:border-l-border/60 lg:px-4 lg:first:border-l-0">
            {i === nadruk && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand-gray lg:inset-x-4" />}
            <Kerncijfer label={t.label} waarde={t.waarde} delta={t.delta} deltaVorm="pil" />
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 pb-2.5 pt-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
          <span className="font-medium text-brand-gray">{formatDagPeriode(staat.periode)}</span>
          {c ? <span>vergeleken met {formatDagPeriode(c)}</span> : <span>totaal in deze periode</span>}
        </p>
        {uitleg.map((u) => <p key={u} className="mt-1 text-micro text-muted-foreground">{u}</p>)}
      </div>
    </section>
  );
}
