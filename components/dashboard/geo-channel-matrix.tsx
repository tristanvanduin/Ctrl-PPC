"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabel, Kop, KolomKop, Body, Rij, RijKop, TotaalRij, TotaalCel } from "./data-table";
import { Loader2, Grid3x3 } from "lucide-react";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { divergingColor, inkOn } from "@/lib/branding/chart-colors";
import { stateLabel } from "@/lib/geo/us-fips";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import {
  matrixTotals, cellIndex, findMixDeviations, strongestPerCountry, isUnsplit, cpa, roas,
  CHANNEL_LABEL, type ChannelCell, type ChannelKey,
} from "@/lib/geo/channel-matrix";

// Hoe de kanaalmix per markt verschilt. De kaart erboven beantwoordt "welke landen"; dit
// beantwoordt "en hoe ligt het daar anders dan elders".
//
// DRIE ONTWERPKEUZES DIE HET VERSCHIL MAKEN
//
// 1. Kleur op CPA of ROAS, nooit op kosten. Een heatmap op absolute bedragen kleurt alleen je
//    grootste markt en zegt verder niets — je wist al dat Nederland het meeste kost.
// 2. Divergerend om het accountgemiddelde, niet sequentieel. De vraag is niet "hoe hoog", maar
//    "beter of slechter dan hoe dit account normaal presteert". Het midden moet als niets lezen.
// 3. PMax krijgt een eigen kolom zonder kleur. Die cellen zijn niet nul, ze zijn ONBEKEND: Google
//    levert de kanaalverdeling per asset group en de landverdeling per campagne, maar nooit samen.
//    Ze meekleuren zou een meting suggereren die niet bestaat.

const eur = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

const COUNTRY_NAME: Record<string, string> = {
  NL: "Nederland", BE: "België", DE: "Duitsland", FR: "Frankrijk", GB: "Verenigd Koninkrijk",
  US: "Verenigde Staten", CA: "Canada", ES: "Spanje", IT: "Italië", PL: "Polen",
};
const countryLabel = (code: string) => COUNTRY_NAME[code] ?? stateLabel(code) ?? code;

type MetricKey = "cpa" | "roas";
const METRICS: Record<MetricKey, { label: string; get: (c: ChannelCell) => number | null; fmt: (v: number | null) => string; higherIsBetter: boolean }> = {
  cpa: { label: "CPA", get: cpa, fmt: eur, higherIsBetter: false },
  roas: { label: "ROAS", get: roas, fmt: (v) => (v == null ? "—" : `${num(v, 2)}×`), higherIsBetter: true },
};

export function GeoChannelMatrix({ clientId }: { clientId: string }) {
  const [cells, setCells] = useState<ChannelCell[] | null>(null);
  const [metricKey, setMetricKey] = useState<MetricKey>("cpa");
  const [hover, setHover] = useState<{ country: string; channel: ChannelKey } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const demo = isDemoMode();
    fetch(`/api/geo/channels?clientId=${encodeURIComponent(clientId)}${demo ? "&demo=1" : ""}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCells(d.cells ?? []); })
      .catch(() => { if (!cancelled) setCells([]); });
    return () => { cancelled = true; };
  }, [clientId]);

  const totals = useMemo(() => (cells ? matrixTotals(cells) : null), [cells]);
  const index = useMemo(() => (cells ? cellIndex(cells) : new Map<string, ChannelCell>()), [cells]);
  const deviations = useMemo(() => (cells ? strongestPerCountry(findMixDeviations(cells)) : []), [cells]);

  const metric = METRICS[metricKey];

  // Het referentiepunt van de schaal: de accountbrede waarde, uit de totalen berekend (niet het
  // gemiddelde van de celwaarden — dat zou een land met twee conversies even zwaar wegen).
  const reference = useMemo(() => (totals ? metric.get(totals.grand) : null), [totals, metric]);

  /**
   * Positie op de divergerende schaal. Genormaliseerd op de grootste afwijking die daadwerkelijk
   * voorkomt, zodat de schaal het bereik van dít account gebruikt in plaats van een vaste marge
   * die bij de ene klant alles bleek en bij de andere alles verzadigd maakt.
   */
  const spread = useMemo(() => {
    if (!cells || reference == null || reference === 0) return 0;
    const devs = cells
      .filter((c) => !isUnsplit(c.channel))
      .map((c) => metric.get(c))
      .filter((v): v is number => v != null)
      .map((v) => Math.abs(v / reference - 1));
    return devs.length ? Math.max(...devs) : 0;
  }, [cells, reference, metric]);

  /**
   * Kosten zonder enige conversie. Dit is GEEN ontbrekende waarde: er is gemeten, en de uitkomst
   * is nul. Zonder dit onderscheid zou zo'n cel er identiek uitzien als een kanaal dat in die
   * markt niet draait — en juist die cel is de scherpste bevinding in de hele matrix.
   */
  const isDeadSpend = (cell: ChannelCell): boolean =>
    !isUnsplit(cell.channel) && cell.cost > 0 && cell.conversions === 0;

  function fillFor(cell: ChannelCell | undefined): { bg: string; fg: string } | null {
    if (!cell || isUnsplit(cell.channel) || reference == null || reference === 0) return null;
    // Betaald zonder resultaat is het slechtst mogelijke geval — het uiterste van de warme arm.
    if (isDeadSpend(cell)) { const bg = divergingColor(1); return { bg, fg: inkOn(bg) }; }
    if (spread === 0) return null;
    const v = metric.get(cell);
    if (v == null) return null;
    // t > 0 = slechter dan het account. Bij ROAS betekent hóger juist beter, dus draaien we om.
    const rel = (v / reference - 1) / spread;
    const t = metric.higherIsBetter ? -rel : rel;
    const bg = divergingColor(t);
    return { bg, fg: inkOn(bg) };
  }

  // De matrix is de vervolgvraag na "welke landen", niet het eerste antwoord. Hij staat daarom
  // dicht bij binnenkomst; wie hem opent houdt hem open (de keuze wordt onthouden).
  const panelProps = {
    id: "geo-kanaal-matrix",
    title: "Land × kanaal",
    subtitle: "hoe elke markt bediend wordt",
    icon: <Grid3x3 className="w-4.5 h-4.5 text-rm-blue-ink" aria-hidden />,
    defaultOpen: false,
  };

  if (cells === null) {
    return (
      <CollapsiblePanel {...panelProps}>
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden /> <span className="text-body">Land × kanaal laden…</span>
        </div>
      </CollapsiblePanel>
    );
  }
  if (!totals || totals.countries.length === 0) {
    return (
      <CollapsiblePanel {...panelProps}>
        <p className="text-body text-muted-foreground px-5 py-6">
          Nog geen land×kanaal-data. Dit komt uit <code>ads_geo_performance_monthly</code> gecombineerd
          met het campagnetype; zodra de geo-sync gedraaid heeft verschijnt de matrix hier.
        </p>
      </CollapsiblePanel>
    );
  }

  const hasUnsplit = totals.channels.some(isUnsplit);

  return (
    <CollapsiblePanel {...panelProps}>
    <section className="space-y-3 px-5 py-4">
      <header className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex gap-1" role="group" aria-label="Metriek">
          {(Object.keys(METRICS) as MetricKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setMetricKey(k)}
              aria-pressed={metricKey === k}
              className={`text-meta px-2 py-1 rounded border transition-colors ${
                metricKey === k ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
      </header>

      <p className="text-meta text-muted-foreground">
        Kleur toont {metric.label} ten opzichte van het account ({metric.fmt(reference)}).
        Blauw is beter dan gemiddeld, rood slechter. Een streepje betekent dat dat kanaal in die
        markt niet draait; &ldquo;0 conv.&rdquo; betekent dat er wél budget in ging en er niets uitkwam.
        {hasUnsplit && " De PMax-kolom is bewust ongekleurd: daar is het budget per land bekend, maar de kanaalverdeling niet gemeten."}
      </p>

      <Tabel>
          <caption className="sr-only">
            {metric.label} per land en kanaal, laatste 180 dagen. Blauw is beter dan het accountgemiddelde, rood slechter.
          </caption>
          <Kop>
            <KolomKop breed>Markt</KolomKop>
            {totals.channels.map((ch) => (
              <KolomKop key={ch} getal>{CHANNEL_LABEL[ch]}</KolomKop>
            ))}
            <KolomKop getal>Totaal</KolomKop>
          </Kop>
          <Body>
            {totals.countries.map((country) => {
              const row = totals.byCountry.get(country)!;
              return (
                <Rij key={country}>
                  <RijKop>
                    {countryLabel(country)}
                    <span className="text-micro text-muted-foreground ml-1.5">{eur(row.cost)}</span>
                  </RijKop>
                  {totals.channels.map((ch) => {
                    const cell = index.get(`${country}|${ch}`);
                    const fill = fillFor(cell);
                    const isHover = hover?.country === country && hover?.channel === ch;
                    return (
                      <td
                        key={ch}
                        className="px-3 py-2 text-right tabular-nums relative"
                        style={fill ? { backgroundColor: fill.bg, color: fill.fg } : undefined}
                        onMouseEnter={() => setHover({ country, channel: ch })}
                        onMouseLeave={() => setHover(null)}
                      >
                        {!cell ? (
                          <span className="text-muted-foreground" title="Dit kanaal draait niet in deze markt">—</span>
                        ) : isUnsplit(ch) ? (
                          <span className="text-muted-foreground" title="Kanaalverdeling per land levert Google niet voor Performance Max">
                            {eur(cell.cost)} <span className="text-micro">niet gemeten</span>
                          </span>
                        ) : isDeadSpend(cell) ? (
                          <span title={`${eur(cell.cost)} uitgegeven zonder één conversie`}>
                            {eur(cell.cost)} <span className="text-micro">0 conv.</span>
                          </span>
                        ) : (
                          metric.fmt(metric.get(cell))
                        )}
                        {isHover && cell && (
                          <span className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-1 whitespace-nowrap rounded border border-border bg-popover text-popover-foreground shadow-md px-2 py-1 text-meta text-left font-normal">
                            <span className="block font-medium">{countryLabel(country)} — {CHANNEL_LABEL[ch]}</span>
                            <span className="block">{eur(cell.cost)} · {num(cell.conversions, 1)} conv.</span>
                            {!isUnsplit(ch) && <span className="block">CPA {eur(cpa(cell))} · ROAS {cell.cost > 0 ? `${num(roas(cell) ?? 0, 2)}×` : "—"}</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{metric.fmt(metric.get(row))}</td>
                </Rij>
              );
            })}
          </Body>
          {/* De totaalregel staat nu in een <tfoot> in plaats van als laatste rij in de body.
              Dat is niet alleen netter HTML: een schermlezer kondigt een voet aan als samenvatting,
              en bij het scrollen door honderd landen blijft duidelijk wat een gewone rij is en wat
              de optelsom. */}
          <TotaalRij>
            <RijKop>Alle markten</RijKop>
            {totals.channels.map((ch) => {
              const col = totals.byChannel.get(ch)!;
              return (
                <TotaalCel key={ch} getal>
                  {isUnsplit(ch) ? <span className="text-muted-foreground">{eur(col.cost)}</span> : metric.fmt(metric.get(col))}
                </TotaalCel>
              );
            })}
            <TotaalCel getal>{metric.fmt(metric.get(totals.grand))}</TotaalCel>
          </TotaalRij>
      </Tabel>

      {/* Legenda: bij een kleurschaal is de schaal zelf de legenda. */}
      <div className="flex items-center gap-2 text-micro text-muted-foreground">
        <span>Beter</span>
        <span className="flex h-2 rounded-sm overflow-hidden" aria-hidden>
          {[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map((t) => (
            <span key={t} className="w-6" style={{ backgroundColor: divergingColor(t) }} />
          ))}
        </span>
        <span>Slechter</span>
      </div>

      {deviations.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
          <p className="text-meta font-medium">Markten met een afwijkende kanaalmix</p>
          <ul className="space-y-1">
            {deviations.slice(0, 4).map((d) => (
              <li key={`${d.country}|${d.channel}`} className="text-meta text-muted-foreground">
                <span className="text-foreground font-medium">{countryLabel(d.country)}</span>{" "}
                besteedt {pct(d.countryShare)} aan {CHANNEL_LABEL[d.channel].toLowerCase()},
                tegen {pct(d.accountShare)} accountbreed
                <span className="text-foreground"> ({d.gap > 0 ? "+" : ""}{pct(d.gap)})</span>.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
    </CollapsiblePanel>
  );
}
