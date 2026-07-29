"use client";

import { ResponsiveContainer, ComposedChart, Bar, Line, LineChart } from "recharts";
import { TrendingUp } from "lucide-react";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_CATEGORICAL, CHART_LINE_SECONDARY } from "@/lib/branding/chart-colors";
import {
  Raster, AsX, AsY, Tip, Legenda, PLOT_MARGE,
  BALK_RADIUS, BALK_GAP, GROEP_GAP,
  kortEuro, volledigEuro, volledigGetal, maandLabel, asSchaal, BALK_MAX, type LegendaItem,
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
  const schaalLijn = asSchaal(Math.max(0, ...rows.map((r) => r.lijn)));
  const hoogBoven = Math.round(height * 0.56);
  const hoogOnder = height - hoogBoven;

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
        <span className="text-meta text-muted-foreground">spend en {lineLabel.toLowerCase()}, zelfde maanden</span>
      </div>

      <div className="px-3 pt-4 pb-1">
        <p className="px-2 text-micro font-medium text-muted-foreground uppercase tracking-wider mb-1">Spend</p>
        <div style={{ height: hoogBoven }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={PLOT_MARGE} barCategoryGap={GROEP_GAP}>
              <Raster />
              {/* Alleen de onderste plot draagt de maandlabels: twee keer dezelfde as is ruis. */}
              <AsX dataKey="maand" formatter={() => ""} />
              <AsY formatter={kortEuro} {...schaalSpend} />
              <Tip formatter={volledigEuro} />
              <Bar dataKey="spend" name="Spend" fill={theme.primary} radius={BALK_RADIUS} barSize={BALK_MAX} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="px-3 pb-4">
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
  const hoogste = Math.max(0, ...data.flatMap((r) => series.map((s) => Number(r[s] ?? 0))));
  const schaal = asSchaal(hoogste);
  const legenda: LegendaItem[] = series.map((s, i) => ({ label: s, kleur: kleurVan(i) }));

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">{title}</h3>
        {/* De legenda staat boven de plot: je leest hem vóór de grafiek, niet erna. */}
        <Legenda items={legenda} className="ml-auto" />
      </div>
      <div className="px-3 py-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={PLOT_MARGE} barCategoryGap={GROEP_GAP} barGap={BALK_GAP}>
            <Raster />
            <AsX dataKey="maand" formatter={maandLabel} />
            <AsY formatter={kortEuro} {...schaal} />
            <Tip formatter={volledigEuro} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} name={s} fill={kleurVan(i)} radius={BALK_RADIUS} barSize={BALK_MAX} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
