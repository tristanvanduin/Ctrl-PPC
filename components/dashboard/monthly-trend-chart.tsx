"use client";

import { ResponsiveContainer, ComposedChart, Bar, Area, AreaChart, LabelList } from "recharts";
import { TrendingUp } from "lucide-react";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { categoricalColor, CHART_LINE_SECONDARY } from "@/lib/branding/chart-colors";
import {
  Raster, AsX, AsY, Tip, Legenda, PLOT_MARGE,
  BALK_RADIUS, BALK_GAP, GROEP_GAP,
  kortEuro, kortEuroLabel, volledigEuro, volledigGetal, maandLabel, asSchaal, asSchaalLijn, balkBreedte,
  PLOT_MARGE_LABELS, PLOT_MARGE_WAARDEN, PLOT_MARGE_EIND, plotBreedte,
  BalkVerloop, VlakWas, verloopId, type LegendaItem,
} from "./chart-chrome";
import { Kerncijfer } from "@/components/ui/kerncijfer";

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
  // Bij een handvol balken draagt elke balk zijn eigen bedrag, en vervalt het raster eronder.
  const elkBedragErbij = rows.length <= 8;

  // Wat er in de overgebleven breedte staat.
  //
  // De plot is zo breed als de data (zie `plotBreedte`), en bij vier maanden blijft er een halve
  // kaart over. Die leeg laten was eerlijk maar niet af: een kaart die voor de helft niets doet
  // leest als een kaart die niet af is. Wat er nu staat is geen opvulling maar de drie vragen die
  // je bij een reeks stelt en die je uit balkjes moet optellen — hoeveel bij elkaar, hoeveel per
  // maand, en hoeveel is het opgelopen.
  //
  // Bewust de maanden van déze grafiek en niet die van de periodekeuze erboven: dat zijn andere
  // maanden (alleen de volle), en daarom staat het aantal er expliciet bij.
  const totaal = rows.reduce((t, r) => t + r.spend, 0);
  const eerste = rows[0].spend;
  const laatste = rows[rows.length - 1].spend;
  const verloop = eerste > 0 ? ((laatste - eerste) / eerste) * 100 : null;
  // "Totaal over 5 maanden" stond er eerst zonder grootheid, in een kaart die twee grootheden
  // toont. Dan moet de lezer raden of het over spend of over acties gaat, en die twee staan hier
  // juist naast elkaar omdat ze niet hetzelfde zijn.
  const kerncijfers = [
    { label: `Spend over ${rows.length} maanden`, waarde: volledigEuro(totaal) },
    { label: "Spend per maand", waarde: volledigEuro(Math.round(totaal / rows.length)) },
    {
      label: `Spend ${maandLabel(rows[0].maand)} → ${maandLabel(rows[rows.length - 1].maand)}`,
      waarde: verloop === null ? "—" : `${verloop > 0 ? "+" : ""}${verloop.toFixed(0)}%`,
    },
  ];

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{title}</h3>
        <span className="text-meta text-muted-foreground">spend en {lineLabel.toLowerCase()}, zelfde maanden</span>
      </div>

      {/* De plot en de cijfers als één blok links, niet elk tegen een rand geduwd.
          Met `flex-1` op de plot slokte die alle ruimte op en werden de cijfers naar de rechterrand
          gedrukt: twee blokken met een gat ertussen, wat leest als een kaart die uit elkaar valt.
          Nu volgen de cijfers direct op de plot en valt de overgebleven breedte in één stuk rechts —
          witruimte aan de buitenkant leest als marge, witruimte in het midden als een fout.
          Onder de brede breekpunten vallen de cijfers weg: dan vult de plot de kaart al.

          `flex-1` mét het plafond op deze kolom, en niet `shrink`: zonder groeirichting zakt een
          flex-kind terug op zijn inhoud, en de ResponsiveContainer erin meet dan nul. Dat leverde
          een plot van honderddertig pixels op met over elkaar heen liggende labels — zichtbaar in
          de schermafdruk, en tsc zag er niets van. */}
      <div className="flex items-stretch">
      <div className="min-w-0 flex-1" style={vlak}>
      <div className="px-3 pt-4 pb-1" style={vlak}>
        <p className="px-2 text-micro font-medium text-muted-foreground uppercase tracking-wider mb-1">Spend</p>
        <div style={{ height: hoogBoven }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={elkBedragErbij ? PLOT_MARGE_WAARDEN : PLOT_MARGE} barCategoryGap={GROEP_GAP}>
              {/* Of het raster, of de bedragen — niet allebei.
                  Eerst stond hier allebei: vier balken met "€ 10k" tot "€ 13k" op de kop, en
                  daarnaast een as met 0 / 5k / 10k / 15k. Acht getallen voor vier waarden. De
                  mark-specificatie zegt het in één zin: de asgetallen dragen wat je niet direct
                  gelabeld hebt, dus houd ze — tenzij élke waarde gelabeld is. Bij een handvol
                  balken is dat laatste het geval, en dan is het raster de tweede kopie. Wat
                  overblijft is de nullijn, want zonder die ene lijn staan de balken nergens op. */}
              {!elkBedragErbij && <Raster />}
              {/* Alleen de onderste plot draagt de maandlabels: twee keer dezelfde as is ruis. */}
              <AsX dataKey="maand" formatter={() => ""} basislijn={elkBedragErbij} />
              <AsY formatter={kortEuro} {...schaalSpend} stil={elkBedragErbij} />
              <Tip formatter={volledigEuro} />
              <BalkVerloop id="balk-verloop-spend" kleur={theme.primary} />
              <Bar dataKey="spend" name="Spend" fill="url(#balk-verloop-spend)" filter="url(#balk-verloop-spend-gloed)" radius={BALK_RADIUS} barSize={balkBreedte(rows.length)}>
                {elkBedragErbij && (
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
            <AreaChart data={rows} margin={PLOT_MARGE_EIND}>
              <Raster />
              <AsX dataKey="maand" formatter={maandLabel} />
              <AsY {...schaalLijn} />
              <Tip formatter={volledigGetal} />
              <VlakWas id="lijn-was" kleur={CHART_LINE_SECONDARY} />
              {/* Drie dingen die dit paneel eerder niet had, en waardoor het las als een vlek in
                  plaats van als een reeks:
                  - Punten. Vier maanden zijn vier metingen; zonder punten is niet te zien dát het
                    er vier zijn, en lijkt het een doorlopende streep. De ring in vlakkleur is geen
                    versiering maar de scheiding — een randje óm een mark is een anti-pattern, een
                    gat eromheen is de manier.
                  - Een wassing van tien procent eronder. Geeft de reeks gewicht zonder een tweede
                    waarde te suggereren; een verzadigd vlak zou dat wel doen.
                  - Het laatste getal erbij. Een lijn draagt zijn waarde aan het eind — anders is
                    het enige wat je kunt aflezen "ongeveer tussen 1k en 2k". */}
              <Area
                dataKey="lijn"
                name={lineLabel}
                stroke={CHART_LINE_SECONDARY}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#lijn-was)"
                dot={rows.length <= 12 ? { r: 3.5, strokeWidth: 2, stroke: "var(--card, #fff)", fill: CHART_LINE_SECONDARY } : false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card, #fff)" }}
              >
                <LabelList
                  dataKey="lijn"
                  content={(props: unknown) => (
                    <EindWaarde {...(props as LabelProps)} laatste={rows.length - 1} tekst={volledigGetal(rows[rows.length - 1].lijn)} />
                  )}
                />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>

      <div className="hidden shrink-0 flex-col justify-center gap-6 px-6 py-4 lg:flex" style={{ width: 220 }}>
        {kerncijfers.map((k) => (
          <Kerncijfer key={k.label} label={k.label} waarde={k.waarde} formaat="compact" />
        ))}
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

/**
 * De waarde van een lijn, rechts van zijn laatste punt.
 *
 * Naast en niet erboven: boven het punt botst het met de lijn zelf zodra die stijgt. Zes pixels
 * lucht is genoeg om los te lezen en weinig genoeg om bij het punt te horen.
 */
function EindWaarde({ x, y, index, laatste, tekst }: LabelProps & { laatste: number; tekst: string }) {
  if (index !== laatste || x == null || y == null) return null;
  return (
    <text x={x + 8} y={y + 4} className="fill-muted-foreground" style={{ fontSize: 10, fontWeight: 500 }}>
      {tekst}
    </text>
  );
}

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
  // een kanaal weg, dan houden de overige hun kleur. Was hier zelf nooit waar: de "vaste plek"
  // was gewoon de array-index, en die hing af van welk kanaal toevallig het eerst in de data
  // stond -- Meta kon zo op de ene grafiek blauw zijn en op de andere oranje. categoricalColor()
  // kent Google/Meta/LinkedIn/Cross-channel nu een echte vaste kleur toe, ongeacht volgorde.
  const kleurVan = (i: number) => categoricalColor(series[i], i);
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
  // Voor de aandelen in de kolom rechts. Nul-veilig: bij een leeg venster is er niets te delen.
  const totaalAlles = data.reduce((t, r) => t + series.reduce((s2, s) => s2 + Number(r[s] ?? 0), 0), 0);
  const hoogste = Math.max(0, ...data.flatMap((r) => series.map((s) => Number(r[s] ?? 0))));
  const schaal = asSchaal(hoogste);
  const legenda: LegendaItem[] = series.map((s, i) => ({ label: s, kleur: kleurVan(i) }));

  // Welke series pas later beginnen, en vanaf wanneer.
  //
  // In februari staat hier alleen Google. Een leeg vak leest als nul, en nul leest als "dat kanaal
  // heeft niets uitgegeven" — terwijl het kanaal er toen gewoon nog niet was. De grafiek kan dat
  // verschil niet tekenen (een ontbrekende balk en een balk van nul zien er hetzelfde uit), dus
  // moet hij het zeggen. Eén regel eronder is genoeg; het alternatief — de as afkappen tot de
  // maanden waarin álles meet — gooit echte Google-data weg om een misverstand te vermijden.
  const laatstarters = series
    .map((s) => ({ naam: s, vanaf: data.findIndex((r) => r[s] !== undefined && Number(r[s]) > 0) }))
    .filter((x) => x.vanaf > 0)
    .map((x) => ({ ...x, maand: maandLabel(String(data[x.vanaf].maand ?? "")) }));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{title}</h3>
        {/* De legenda staat boven de plot: je leest hem vóór de grafiek, niet erna. */}
        <Legenda items={legenda} className="ml-auto" />
      </div>
      {/* Plot links, de cijfers ertegenaan — dezelfde indeling als MonthlyTrendChart hierboven,
          en om dezelfde reden.

          De plot is zo breed als zijn data (zie plotBreedte). Bij zes maanden bleef er ruim een
          derde kaart over, en die stond leeg: een grafiek die in witruimte zweeft leest als een
          kaart die niet af is, hoe netjes de balken zelf ook zijn. Dat was ook de terugkoppeling
          -- "straalt geen premium uit" ging niet over de marks maar over de leegte eromheen.

          Wat er rechts staat is geen opvulling maar de vraag die deze grafiek oproept en niet
          beantwoordt: hoeveel draagt elk kanaal nou eigenlijk? Dat tel je niet op uit achttien
          balkjes. Het kleurblokje bindt de regel aan zijn balken. */}
      <div className="flex items-stretch">
      <div className="min-w-0 flex-1 px-3 py-4" style={{ height, maxWidth: plotBreedte(data.length) }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={PLOT_MARGE_LABELS} barCategoryGap={GROEP_GAP} barGap={BALK_GAP}>
            <Raster />
            <AsX dataKey="maand" formatter={maandLabel} />
            <AsY formatter={kortEuro} {...schaal} />
            <Tip formatter={volledigEuro} />
            {series.map((s, i) => <BalkVerloop key={`v-${s}`} id={verloopId(s, i)} kleur={kleurVan(i)} />)}
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} name={s} fill={`url(#${verloopId(s, i)})`} filter={`url(#${verloopId(s, i)}-gloed)`} radius={BALK_RADIUS} barSize={balkBreedte(data.length * series.length)}>
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

      {/* ml-auto: zonder plafond duwt de plot deze kolom zelf tegen de rechterrand, maar met
          plotBreedte() erop (zie hierboven) kan de plot smaller uitvallen dan de rij breed is —
          en dan bleef deze kolom los van de plot staan met de echte lege ruimte ná zich, tegen de
          kaartrand. ml-auto duwt hem altijd naar de rechterrand, ongeacht hoe smal de plot is. */}
      <div className="hidden shrink-0 flex-col justify-center gap-5 border-l border-border px-6 py-4 ml-auto lg:flex" style={{ width: 230 }}>
        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Totaal over {data.length} {data.length === 1 ? "maand" : "maanden"}
        </p>
        {series.map((s, i) => {
          const som = data.reduce((t, r) => t + Number(r[s] ?? 0), 0);
          const deel = totaalAlles > 0 ? som / totaalAlles : 0;
          return (
            <div key={s}>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: kleurVan(i) }} aria-hidden />
                <span className="text-meta text-muted-foreground">{s}</span>
                <span className="ml-auto text-micro tabular-nums text-muted-foreground">
                  {new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 0 }).format(deel)}
                </span>
              </div>
              <div className="mt-0.5 text-lead font-semibold tabular-nums text-brand-gray">{volledigEuro(som)}</div>
            </div>
          );
        })}
      </div>
      </div>

      {laatstarters.length > 0 && (
        <p className="px-5 pb-4 -mt-1 text-micro text-muted-foreground">
          {laatstarters.map((x) => `${x.naam} vanaf ${x.maand}`).join(", ")} — daarvóór is er geen meting, geen nul.
        </p>
      )}
    </div>
  );
}
