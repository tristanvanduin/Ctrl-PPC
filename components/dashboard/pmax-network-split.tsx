"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PieChart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { DonutChart, type DonutSlice } from "./donut-chart";
import {
  buildNetworkSplit, findImbalances, networkTotals,
  type NetworkRow, type NetworkSlice,
} from "@/lib/pmax/network-split";

// Waar Performance Max je budget laat landen. PMax verdeelt zelf over Zoeken, Display, YouTube,
// Discover en Gmail; die verdeling werd wel gesynct maar bereikte alleen de analyse-lagen.
//
// Twee ringen naast elkaar in plaats van één: het kostenaandeel op zichzelf zegt weinig. Pas
// naast het conversie-aandeel wordt zichtbaar of een netwerk zijn plek verdient. De exacte
// cijfers staan eronder — een ring is voor de verhouding op het oog, niet om waarden die dicht
// bij elkaar liggen te vergelijken.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

/** Kleur volgt het netwerk, niet zijn positie: filteren of herordenen mag niets omverkleuren. */
function colorFor(networkType: string, order: string[]): string {
  const i = order.indexOf(networkType);
  return CHART_CATEGORICAL[(i < 0 ? 0 : i) % CHART_CATEGORICAL.length];
}

export function PmaxNetworkSplit({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<NetworkRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Geen aparte demo-tak meer: in demo-modus IS `supabase` de mock-client, en die serveert
    // ads_pmax_network_breakdown uit dezelfde bron als de analyse. Er stond hier een losse
    // DEMO_PMAX_NETWORKS-constante met heel andere cijfers, waardoor deze ringen een ander
    // verhaal vertelden dan de SOP-tekst ernaast over precies dezelfde campagne.
    const sb = supabase;
    if (!sb) { setRows([]); return; }
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    sb.from("ads_pmax_network_breakdown")
      .select("network_type, cost, conversions, conversions_value, impressions, clicks")
      .eq("client_id", clientId)
      .gte("month", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        setRows((data ?? []).map((r) => ({
          networkType: String(r.network_type ?? "UNKNOWN"),
          cost: Number(r.cost ?? 0),
          conversions: Number(r.conversions ?? 0),
          conversionsValue: Number(r.conversions_value ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
        })));
      }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId]);

  const slices = useMemo(() => (rows ? buildNetworkSplit(rows) : []), [rows]);
  const totals = useMemo(() => networkTotals(slices), [slices]);
  const imbalances = useMemo(() => findImbalances(slices), [slices]);
  // Vaste kleurvolgorde op netwerktype, zodat een netwerk in beide ringen dezelfde kleur houdt.
  const order = useMemo(() => slices.map((s) => s.networkType), [slices]);

  const costSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: colorFor(s.networkType, order) }));
  const convSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.conversions, color: colorFor(s.networkType, order) }));

  if (rows === null) {
    return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  }
  if (slices.length === 0 || totals.cost <= 0) return null; // geen PMax: niets te tonen

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <PieChart className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">Performance Max — waar gaat het budget heen</h3>
        <span className="text-meta text-muted-foreground">Google verdeelt zelf over de netwerken</span>
      </div>

      {/* De scheefheid eerst: dat is waarom deze kaart bestaat. */}
      {imbalances.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-amber-50/50 space-y-1">
          {imbalances.slice(0, 2).map(({ slice, kind }) => (
            <p key={slice.networkType} className="text-body text-rm-gray">
              <strong>{slice.label}</strong>{" "}
              {kind === "duur" ? (
                <>krijgt {pct(slice.costShare)} van het budget maar levert {pct(slice.conversionShare)} van de conversies
                  {slice.cpa != null && <> (CPA {eur(slice.cpa)})</>}. Naar verhouding kost dit netwerk meer dan het oplevert.</>
              ) : (
                <>krijgt {pct(slice.costShare)} van het budget en levert {pct(slice.conversionShare)} van de conversies
                  {slice.cpa != null && <> (CPA {eur(slice.cpa)})</>}. Dit netwerk trekt de campagne.</>
              )}
            </p>
          ))}
          <p className="text-meta text-muted-foreground">
            PMax laat de verdeling niet rechtstreeks sturen. Wel bij te sturen via assets (meer of minder
            video en beeld), doelgroepsignalen en uitsluitingen — zie de placements hieronder.
          </p>
        </div>
      )}

      <div className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-center gap-10">
          <figure className="flex flex-col items-center gap-2">
            <DonutChart
              slices={costSlices}
              centerValue={eur(totals.cost)}
              centerLabel="totale kosten"
              format={eur}
              ariaLabel={`Kostenverdeling van Performance Max over de netwerken: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
            />
            <figcaption className="text-meta font-medium text-rm-gray">Kosten</figcaption>
          </figure>

          {totals.hasConversions && (
            <figure className="flex flex-col items-center gap-2">
              <DonutChart
                slices={convSlices}
                centerValue={num(totals.conversions, 1)}
                centerLabel="conversies"
                format={(v) => num(v, 1)}
                ariaLabel={`Conversieverdeling van Performance Max over de netwerken: ${slices.map((s) => `${s.label} ${pct(s.conversionShare)}`).join(", ")}`}
              />
              <figcaption className="text-meta font-medium text-rm-gray">Conversies</figcaption>
            </figure>
          )}
        </div>

        {!totals.hasConversions && (
          <p className="text-meta text-muted-foreground text-center mt-3">
            Er zijn in dit venster geen conversies per netwerk geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      {/* De exacte cijfers. Een ring is voor de verhouding op het oog; hier staan de waarden die
          je nodig hebt om twee netwerken die dicht bij elkaar liggen echt te vergelijken. */}
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">Netwerk</th>
              <th className="px-3 py-2 font-medium text-right">Kosten</th>
              <th className="px-3 py-2 font-medium text-right">Aandeel</th>
              <th className="px-3 py-2 font-medium text-right">Conversies</th>
              <th className="px-3 py-2 font-medium text-right">Aandeel</th>
              <th className="px-5 py-2 font-medium text-right">CPA</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s: NetworkSlice) => (
              <tr key={s.networkType} className="border-b border-border/50">
                <td className="px-5 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-rm-gray font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorFor(s.networkType, order) }} aria-hidden />
                    {s.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">{eur(s.cost)}</td>
                <td className="px-3 py-1.5 text-right">{pct(s.costShare)}</td>
                <td className="px-3 py-1.5 text-right">{s.conversions > 0 ? num(s.conversions, 1) : "—"}</td>
                <td className="px-3 py-1.5 text-right">{pct(s.conversionShare)}</td>
                <td className="px-5 py-1.5 text-right">{s.cpa == null ? "—" : eur(s.cpa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
