"use client";

import { ResponsiveContainer, ComposedChart, Bar, Line, LineChart, LabelList } from "recharts";
import { TrendingUp } from "lucide-react";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_CATEGORICAL, CHART_LINE_SECONDARY } from "@/lib/branding/chart-colors";
import {
  Raster, AsX, AsY, Tip, Legenda, PLOT_MARGE,
  BALK_RADIUS, BALK_GAP, GROEP_GAP,
  kortEuro, kortEuroLabel, volledigEuro, volledigGetal, maandLabel, asSchaal, asSchaalLijn, balkBreedte,
  PLOT_MARGE_LABELS, PLOT_MARGE_WAARDEN, plotBreedte,
  BalkVerloop, verloopId, type LegendaItem,
} from "./chart-chrome";

// Maand-trendgrafieken: spend per maand, en dezelfde maanden per kanaal.
//
// DE DUBBELE AS IS ERUIT
//
// Dit component tekende spend op een linker-as en een tweede metriek op een rechter-as in
// dezelfde plot. Dat leest als een verband tussen de twee, maar dat verband is er niet: de
// uitlijning van twee schalen is willekeurig, en door een van beide anders te schalen wordt de
// "correlatie" groter of kleiner zonder dat er één cijfer verandert. Het is de meest gemaakte
// fout in dashboardgrafieken en hij is niet met opmaak te verzachten.
//
// Nu twee plots onder elkaar met dezelfde x-as. Je kunt de vorm nog steeds vergelijken — daar was
// het om begonnen — maar niets suggereert meer dat de hoogtes iets met elkaar te maken hebben.

export interface MonthlyTrendPoint {
  maand: string;
  spend: number;
  lijn: number;
}

export function MonthlyTrendChart({ title, data, lineLabel, height = 240 }: {
  title: string;
  data: MonthlyTrendPoint[];
  lineLabel: string;
  height?: number;
}) {
  const { theme } = useBrandTheme();
  if (data.length < 2) return null;

  const rows = data.map((d) => ({ maand: d.maand, spend: Math.round(d.spend), lijn: Math.round(d.lijn) }));
  // Twee panelen delen de hoogte; de bovenste krijgt iets meer omdat de spend het anker is.
  const schaalSpend = asSchaal(Math.max(0, ...rows.map((r) => r.spend)));
  // De lijn krijgt lucht boven zijn hoogste punt; de balken niet. Zie asSchaalLijn.
  const schaalLijn = asSchaalLijn(Math.max(0, ...rows.map((r) => r.lijn)));
  const hoogBoven = Math.round(height * 0.56);
  const hoogOnder = height - hoogBoven;
  // Beide panelen krijgen dezelfde maximumbreedte, anders staan de balken en de lijn niet meer
  // boven elkaar — en dat is het enige wat de twee panelen tot één figuur maakt.
  //
  // Links uitgelijnd en niet gecentreerd. Gecentreerd geprobeerd en teruggedraaid: de kaarttitel en
  // het kopje van het paneel staan links, dus een gecentreerde plot zweeft weg van zijn eigen kop
  // en er valt een gat linksonder. Zichtbaar in de schermafdruk, niet in de code.
  const vlak = { maxWidth: plotBreedte(rows.length) } as const;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
        <span className="text-meta text-muted-foreground">spend en {lineLabel.toLowerCase()}, zelfde maanden</span>
      </div>

      <div className="px-3 pt-4 pb-1" style={vlak}>
        <p className="px-2 text-micro font-medium text-muted-foreground uppercase tracking-wider mb-1">Spend</p>
        <div style={{ height: hoogBoven }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={rows.length <= 8 ? PLOT_MARGE_WAARDEN : PLOT_MARGE} barCategoryGap={GROEP_GAP}>
              <Raster />
              {/* Alleen de onderste plot draagt de maandlabels: twee keer dezelfde as is ruis. */}
              <AsX dataKey="maand" formatter={() => ""} />
              <AsY formatter={kortEuro} {...schaalSpend} />
              <Tip formatter={volledigEuro} />
              <BalkVerloop id="balk-verloop-spend" kleur={theme.primary} />
              <Bar dataKey="spend" name="Spend" fill="url(#balk-verloop-spend)" radius={BALK_RADIUS} barSize={balkBreedte(rows.length)}>
                {/* Bij weinig balken draagt elke balk zijn eigen bedrag. "Nooit een getal op elk
                    punt" gaat over dichte grafieken waar het chaos wordt; bij een handvol balken is
                    het juist het tegenovergestelde — dan hoeft de lezer niet te mikken op een
                    hoogte tussen twee rasterlijnen. Vanaf negen balken vervalt het en doet de as
                    het werk. */}
                {rows.length <= 8 && (
                  <LabelList
                    dataKey="spend"
                    position="top"
                    offset={8}
                    className="fill-muted-foreground"
                    style={{ fontSize: 10, fontWeight: 500 }}
                    formatter={(v: unknown) => kortEuroLabel(Number(v))}
                  />
                )}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="px-3 pb-4" style={vlak}>
        <p className="px-2 text-micro font-medium text-muted-foreground uppercase tracking-wider mb-1">{lineLabel}</p>
        <div style={{ height: hoogOnder }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={PLOT_MARGE}>
              <Raster />
              <AsX dataKey="maand" formatter={maandLabel} />
              <AsY {...schaalLijn} />
              <Tip formatter={volledigGetal} />
              <Line
                dataKey="lijn"
                name={lineLabel}
                stroke={CHART_LINE_SECONDARY}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/**
 * De naam van een serie, één keer, boven zijn balk in de laatste groep.
 *
 * De labelprops van recharts zijn per versie anders getypeerd; dit is wat we er werkelijk uit
 * lezen. `index` is de positie in de reeks, dus alleen de laatste krijgt tekst.
 */
interface LabelProps { x?: number; y?: number; width?: number; index?: number }

function SerieNaam({ x, y, width, index, naam, laatste }: LabelProps & { naam: string; laatste: number }) {
  if (index !== laatste || x == null || y == null || width == null) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 6}
      textAnchor="middle"
      className="fill-muted-foreground"
      style={{ fontSize: 10, fontWeight: 500 }}
    >
      {naam}
    </text>
  );
}

// Gegroepeerde maandbalken per serie (bijv. spend per kanaal): categorische vergelijking, dus het
// gevalideerde categorische palet (kleurenblind-veilig, merk-onafhankelijk).

export function GroupedMonthlyBars({ title, months, series, data, height = 260 }: {
  title: string;
  months: string[];
  series: string[];
  data: Record<string, number | string>[];
  height?: number;
}) {
  if (months.length < 1 || series.length === 0) return null;

  // Kleur volgt de serie op zijn vaste plek in het palet, niet zijn rang in deze grafiek: valt er
  // een kanaal weg, dan houden de overige hun kleur.
  const kleurVan = (i: number) => CHART_CATEGORICAL[i % CHART_CATEGORICAL.length];
  // De laatste maand waarin déze serie iets heeft, en niet simpelweg de laatste maand van de
  // grafiek. Meta en LinkedIn beginnen hier pas in maart, dus recharts geeft hun labels een index
  // van 0 tot 4 terwijl Google er zes heeft: vergelijken met `data.length - 1` liet twee van de
  // drie namen weg. Dat was in de code niet te zien en in de types ook niet — alleen in de DOM,
  // waar drie labellijsten stonden en er één tekst in zat.
  const laatsteMetWaarde = (serie: string): number => {
    let n = -1;
    for (const rij of data) if (Number(rij[serie] ?? 0) > 0) n += 1;
    return n;
  };

  // Eén directe label, op de grootste serie.
  //
  // Eerst kregen alle drie de series er een. Dat botste: Meta en LinkedIn liggen hier dicht bij
  // elkaar in waarde én staan naast elkaar, dus hun namen schoven over elkaar heen. De richtlijn
  // is daar duidelijk over — botsende eindlabels niet uit elkaar duwen, want dan raken ze los van
  // hun mark en worden ze ruis; terugvallen op de legenda, of alleen labelen wat het verhaal
  // draagt. Google is hier drie keer de rest; dat is het verhaal. De legenda dekt de andere twee.
  const grootsteSerie = series.reduce((beste, s) => {
    const som = (reeks: string) => data.reduce((t, r) => t + Number(r[reeks] ?? 0), 0);
    return som(s) > som(beste) ? s : beste;
  }, series[0]);
  const hoogste = Math.max(0, ...data.flatMap((r) => series.map((s) => Number(r[s] ?? 0))));
  const schaal = asSchaal(hoogste);
  const legenda: LegendaItem[] = series.map((s, i) => ({ label: s, kleur: kleurVan(i) }));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
        {/* De legenda staat boven de plot: je leest hem vóór de grafiek, niet erna. */}
        <Legenda items={legenda} className="ml-auto" />
      </div>
      <div className="px-3 py-4" style={{ height, maxWidth: plotBreedte(data.length) }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={PLOT_MARGE_LABELS} barCategoryGap={GROEP_GAP} barGap={BALK_GAP}>
            <Raster />
            <AsX dataKey="maand" formatter={maandLabel} />
            <AsY formatter={kortEuro} {...schaal} />
            <Tip formatter={volledigEuro} />
            {series.map((s, i) => <BalkVerloop key={`v-${s}`} id={verloopId(s, i)} kleur={kleurVan(i)} />)}
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} name={s} fill={`url(#${verloopId(s, i)})`} radius={BALK_RADIUS} barSize={balkBreedte(data.length * series.length)}>
                {/* Alleen de grootste serie draagt een naam, boven zijn laatste balk. Zie
                    `grootsteSerie` hierboven voor waarom het er één is en niet drie. */}
                {s === grootsteSerie && (
                  <LabelList
                    dataKey={s}
                    position="top"
                    offset={8}
                    content={(props: unknown) => <SerieNaam {...(props as LabelProps)} naam={s} laatste={laatsteMetWaarde(s)} />}
                  />
                )}
              </Bar>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
