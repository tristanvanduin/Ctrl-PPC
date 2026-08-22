"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart, X } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { DonutChart, type DonutSlice } from "./donut-chart";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { buildNetworkSplit, networkTotals, type NetworkRow, type NetworkSlice } from "@/lib/pmax/network-split";
import { Laadvlak } from "@/components/ui/laadvlak";

// De opener-donut (masterplan 17.32): spend per campagnetype (Search/Performance Max/Shopping/
// Display). Bewust NIET Performance Max' eigen netwerkringen (pmax-network-split.tsx) -- die
// bestaan alleen als het account PMax draait, en een puur-Search- of puur-Shopping-account zou
// daar dus altijd een lege plek zien. Campagnetype dekt elk account: of het nu 100% Search is,
// 100% PMax, of een mix, er is altijd een aandeel te tonen -- de eigenaar wees hier expliciet op
// ("er is altijd een gemene deler waar we een donut van kunnen maken die zich niet richt op 1
// specifiek campagnetype").
//
// Zelfde rekenkern als de PMax-ringen (buildNetworkSplit uit lib/pmax/network-split.ts) -- die
// is met opzet dimensie-onafhankelijk gebouwd ("dezelfde vraag voor een PMax-netwerk, een
// Meta-plaatsing of een LinkedIn-functie"), hier gewoon gevoed met campagnetype in plaats van
// PMax-netwerk. Geen tweede definitie van diezelfde dertig regels.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

const TYPE_LABEL: Record<string, string> = {
  SEARCH: "Search",
  PERFORMANCE_MAX: "Performance Max",
  SHOPPING: "Shopping",
  DISPLAY: "Display",
};
function typeLabel(t: string): string {
  return TYPE_LABEL[(t || "").toUpperCase()] ?? t;
}

function colorFor(campaignType: string, order: string[]): string {
  const i = order.indexOf(campaignType);
  return CHART_CATEGORICAL[(i < 0 ? 0 : i) % CHART_CATEGORICAL.length];
}

interface CampaignMonthlyRow {
  campaign_type: string | null;
  cost: number | null;
  conversions: number | null;
  conversions_value: number | null;
  impressions: number | null;
  clicks: number | null;
}

export function CampaignTypeSplit({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [tabelOpen, toggleTabel] = useRememberedOpen("campagnetype-tabel", false);
  // Klik op een ring-segment of een legendaregel selecteert dat campagnetype -- gedeeld tussen
  // beide donuts (Kosten en Conversies lichten samen op, niet los van elkaar) en filtert de tabel
  // eronder. Nogmaals klikken op hetzelfde type heft de selectie op.
  const [selected, setSelected] = useState<string | null>(null);
  const toggleSelected = (key: string) => setSelected((cur) => (cur === key ? null : key));

  useEffect(() => {
    let cancelled = false;
    // Drie maanden: genoeg om een net gestarte campagne niet als "geen data" te tonen, kort
    // genoeg om een verschoven mix (bv. een gestopt PMax-experiment) nog te laten zien --
    // zelfde overweging als PmaxNetworkSplit's eigen venster, alleen op maandrijen i.p.v. dagrijen.
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    dbSelect<CampaignMonthlyRow>("ads_campaign_monthly", {
      select: "campaign_type, cost, conversions, conversions_value, impressions, clicks",
      clientId, filters: [{ op: "gte", column: "month", value: since }],
    }).then(({ data }) => {
      if (cancelled) return;
      setRows(data.map((r) => ({
        networkType: r.campaign_type ?? "ONBEKEND",
        cost: Number(r.cost ?? 0),
        conversions: Number(r.conversions ?? 0),
        conversionsValue: Number(r.conversions_value ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
      })));
    }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => { setSelected(null); }, [clientId]);

  const slices = useMemo(() => (rows ? buildNetworkSplit(rows, { labelOf: typeLabel }) : []), [rows]);
  const totals = useMemo(() => networkTotals(slices), [slices]);
  const order = useMemo(() => slices.map((s) => s.networkType), [slices]);

  const costSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: colorFor(s.networkType, order) }));

  if (rows === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel="Spend per campagnetype" />;
  }
  // Geen campagnedata deze periode: niets tonen in plaats van een lege ring.
  if (slices.length === 0 || totals.cost <= 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <PieChart className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Spend per campagnetype</h3>
        <span className="text-meta text-muted-foreground">laatste 90 dagen</span>
      </div>

      <div className="px-3 py-5 @2xl:px-5">
        {/* justify-start op de donutrij, niet -center: de titel erboven en de tabel eronder lijnen
            links uit. 22 augustus 2026: de legenda stond ERONDER, wat op een brede kaart rechts van
            de donuts een groot leeg vlak overliet -- de legenda staat nu DAARNAAST (met het aandeel
            per type erbij, niet alleen een kleurstip) en vult precies die ruimte; op smal valt hij
            terug onder de donuts (flex-wrap). */}
        <div className="flex flex-wrap items-start justify-start gap-8 @2xl:gap-12">
          <div className="flex flex-wrap items-start gap-4 @2xl:gap-10">
            <figure className="flex flex-col items-center gap-2">
              <DonutChart
                slices={costSlices}
                centerValue={eur(totals.cost)}
                centerLabel="totale kosten"
                format={eur}
                ariaLabel={`Kostenverdeling over campagnetypes: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
                selected={selected}
                onSliceClick={toggleSelected}
              />
              <figcaption className="text-meta font-medium text-brand-gray">Kosten</figcaption>
            </figure>

            {totals.hasConversions && (
              <figure className="flex flex-col items-center gap-2">
                <DonutChart
                  slices={slices.map((s) => ({ key: s.networkType, label: s.label, value: s.conversions, color: colorFor(s.networkType, order) }))}
                  centerValue={num(totals.conversions, 1)}
                  centerLabel="conversies"
                  format={(v) => num(v, 1)}
                  ariaLabel={`Conversieverdeling over campagnetypes: ${slices.map((s) => `${s.label} ${pct(s.conversionShare)}`).join(", ")}`}
                  selected={selected}
                  onSliceClick={toggleSelected}
                />
                <figcaption className="text-meta font-medium text-brand-gray">Conversies</figcaption>
              </figure>
            )}
          </div>

          {/* Klikbaar, niet alleen decoratief: zelfde selectie als een ringsegment aanklikken --
              een legendaregel is een groter, makkelijker doelwit dan een dun segment van een
              type met een klein aandeel. */}
          <ul className="flex min-w-[10rem] flex-1 flex-col gap-1 pt-1">
            {slices.map((s) => {
              const kleur = colorFor(s.networkType, order);
              const isSelected = selected === s.networkType;
              const isDimmed = selected != null && !isSelected;
              return (
                <li key={s.networkType}>
                  <button
                    type="button"
                    onClick={() => toggleSelected(s.networkType)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-meta transition-opacity hover:bg-muted/60 ${isDimmed ? "opacity-40" : ""}`}
                    style={isSelected ? { boxShadow: `inset 2px 0 0 ${kleur}`, background: "var(--muted, rgba(15,23,42,0.04))" } : undefined}
                    aria-pressed={isSelected}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: kleur }} aria-hidden />
                    <span className="text-brand-gray font-medium">{s.label}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{pct(s.costShare)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {selected && (
          <div className="mt-3 flex items-center gap-2 text-meta">
            <span className="rounded-full bg-brand-blue/10 px-2.5 py-1 font-medium text-brand-blue-ink">
              Gefilterd op {typeLabel(selected)}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-muted-foreground hover:text-brand-gray"
            >
              <X className="h-3 w-3" /> Wis filter
            </button>
          </div>
        )}

        {!totals.hasConversions && (
          <p className="text-meta text-muted-foreground text-center mt-3">
            Er zijn in dit venster geen conversies per campagnetype geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="campagnetype-tabel"
        label={`de cijfers per campagnetype (${slices.length})`}
      />
      <div id="campagnetype-tabel" hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>Campagnetype</KolomKop>
            <KolomKop getal>Kosten</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>Conversies</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>CPA</KolomKop>
          </Kop>
          <Body>
            {/* Dimmen, niet verbergen: verdwijnende rijen zouden de TotaalRij's "100%" laten
                lezen als het totaal van alleen de zichtbare rijen -- precies verkeerd. */}
            {slices.map((s: NetworkSlice) => (
              <Rij key={s.networkType} className={selected != null && selected !== s.networkType ? "opacity-40" : ""}>
                <NaamCel>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorFor(s.networkType, order) }} aria-hidden />
                    {s.label}
                  </span>
                </NaamCel>
                <GetalCel>{eur(s.cost)}</GetalCel>
                <GetalCel zacht>{pct(s.costShare)}</GetalCel>
                <GetalCel>{s.conversions > 0 ? num(s.conversions, 1) : "—"}</GetalCel>
                <GetalCel zacht>{pct(s.conversionShare)}</GetalCel>
                <GetalCel zacht>{s.cpa == null ? "—" : eur(s.cpa)}</GetalCel>
              </Rij>
            ))}
          </Body>
          <TotaalRij>
            <TotaalCel>Alle campagnetypes</TotaalCel>
            <TotaalCel getal>{eur(totals.cost)}</TotaalCel>
            <TotaalCel getal>100%</TotaalCel>
            <TotaalCel getal>{totals.hasConversions ? num(totals.conversions, 1) : "—"}</TotaalCel>
            <TotaalCel getal>{totals.hasConversions ? "100%" : "—"}</TotaalCel>
            <TotaalCel getal>{totals.conversions > 0 ? eur(totals.cost / totals.conversions) : "—"}</TotaalCel>
          </TotaalRij>
        </Tabel>
      </div>
    </div>
  );
}
