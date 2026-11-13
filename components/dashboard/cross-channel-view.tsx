"use client";

import { useState, useMemo, memo } from "react";
import { CalendarClock, Info, Layers, Loader2, Target, TrendingUp } from "lucide-react";
import { GroupedMonthlyBars } from "./monthly-trend-chart";
import { CampaignTypeSplit } from "./campaign-type-split";
import { blendedReliability } from "@/lib/cross-channel/measurement-reliability";
import type { ChannelKey } from "@/lib/cross-channel/lens-facts";
import { kanaalMaandRijen, rijenInPeriode } from "@/lib/cross-channel/kanaal-maandrijen";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Lade, RegioToggle, useRememberedOpen } from "@/components/ui/disclosure";
import { maandLabel } from "./chart-chrome";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Sectie, Deelkop } from "@/components/ui/sectie";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { usePeriod } from "@/lib/period/period-context";
import { formatRange } from "@/lib/period/period-range";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard, GeoRanglijstInKaart, GeoTabelLade } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { KanaalHealthRanking } from "./kanaal-health-ranking";
import { useBlendedClientData } from "@/lib/use-blended-client-data";
import type { ForecastMetric } from "@/lib/forecast";
import { FairWeeksView } from "./fair-weeks-overview";
import { MetricCardsView } from "./metric-cards";
import { PerformanceChartView } from "./performance-chart";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { BlendedPacing } from "./blended-pacing";
import { PacingJaaroverzicht } from "./pacing-jaaroverzicht";
import { uitgeslotenZin } from "./period-summary";
import { uitgeslotenMetDag } from "@/lib/sync/datastand";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";
import type { ClientHistoricalData } from "@/lib/types";
import { alsBronReeks } from "@/lib/period/apply-period";
import { grafiekMaanden } from "@/lib/overzicht/bovenkant";
import { bronVerschilZin, kostenBronVerschil } from "@/lib/overzicht/bron-verschil";

// Cross-channel (blended) tab. Eén bron: de pacing, de beurs-sectie, het jaaroverzicht én de
// grafiek, de ringen en de kanaaltabel lezen de blended historie (useBlendedClientData: Google uit
// fact_core, Meta/LinkedIn/Microsoft uit de dagtabellen met de conversieselectie van de klant).
// De laatste drie lazen tot fase 1, stap 6 de view blended_account_monthly, met de
// standaardselectie en zonder Microsoft: dezelfde maand kon in de tabel een ander aantal
// conversies hebben dan in de kerncijfers erboven. De attributie-voetnoot is verplicht, want elk
// kanaal meet zijn eigen attributie en de bedragen zijn niet naar één valuta omgerekend.

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: "Google",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
  microsoft_ads: "Microsoft",
};

/**
 * Waar Microsoft Ads op dit tabblad wel en niet meetelt. Eén zin voor beide weergaven: in de
 * vertrouwde staat hij boven de sectie, in de nieuwe bij het voorbehoud "zonder Microsoft" van de
 * wereldkaart, het enige blok dat Microsoft nog niet meetelt.
 */
export const MICROSOFT_UITLEG =
  "Microsoft Ads telt mee in de kerncijfers bovenaan, de ranking, de pacing, de beurs-sectie, het jaaroverzicht, "
  + "de verdeling over de kanalen en de cross-channel-tabel. In de markten nog niet; de eigen Microsoft-cijfers staan op het tabblad Microsoft.";

// Bedragen dragen hun valutateken. Zonder dat staat er "489.160" naast "266.532" en moet je uit
// de kolomkop afleiden wat geld is en wat een aantal — precies het soort werk dat een tabel je
// hoort te besparen.
function eur(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n);
}

function CrossChannelViewRuw({ clientId, kanalen = [], edition, nieuw = false, alleenTabel = false, googleData = null }: {
  clientId: string;
  kanalen?: Kanaal[];
  edition?: UpcomingEdition | null;
  /** De schakelaar "Nieuwe weergave" staat aan: de herschikte, ingekorte opbouw (bouwplan fase 5).
   *  Uit rendert dit tabblad precies wat het altijd renderde. */
  nieuw?: boolean;
  /**
   * Alleen de kanaaltabel met zijn voorbehouden, als eigen sectie: voor Campagnes > Alle kanalen in
   * de nieuwe weergave (element 57 van de elementtabel). Op het Overzicht staat dezelfde tabel dan
   * achter "Toon als tabel"; hier staat hij open, boven de campagnes per kanaal. Dezelfde rijen uit
   * dezelfde ophaalronde, dus geen verzoek erbij; de landcijfers worden in deze stand niet gelezen.
   */
  alleenTabel?: boolean;
  /**
   * De Google-data zoals de tegels en de hoofdgrafiek bovenaan ze lezen (de Google-route), in de
   * nieuwe weergave. Alleen om te kunnen ZEGGEN wanneer die afwijkt van wat de ring en de
   * kanaaltabel hier tonen (lib/overzicht/bron-verschil.ts); er wordt niets mee geteld.
   */
  googleData?: ClientHistoricalData | null;
}) {
  const [maandenOpen, toggleMaanden] = useRememberedOpen("cross-maanden", false);
  // Eén hook-aanroep voor beide geo-kaarten: de kaart en de cijfers eronder delen dezelfde
  // metric-keuze en dezelfde VS-drilldown. Twee aanroepen zouden twee losse states geven.
  const geo = useGeoBreakdown({ clientId, channel: "blended", enabled: !alleenTabel });
  // De blended historie voedt zowel de beurs-sectie als het jaaroverzicht. Eén hook, één forecast:
  // twee aanroepen zouden dezelfde route twee keer bevragen en twee keer dezelfde som uitrekenen.
  //
  // Alleen ophalen als er meer dan één kanaal is. De kanalen kunnen nog onbekend zijn als dit
  // tabblad mount (client-dashboard begint op "blended" met kanalen null), en dan vroeg dit de
  // zware route ook op voor een klant met alleen Google. Bij meer kanalen deelt hij het verzoek
  // met de KPI-band.
  const blended = useBlendedClientData(clientId, kanalen.length > 1);
  // De prognose komt uit de hook: de som per kanaal, één keer per ophaalronde berekend. Hier werd
  // computeForecast op de optelling gedraaid, en die las de kanaalmix als groei.
  const blendedForecast = useMemo(
    () => (blended.data && blended.forecast ? { data: blended.data, forecast: blended.forecast } : null),
    [blended.data, blended.forecast],
  );
  // Een kanaal dat het venster van de route niet meer remt (ontkoppeld, of al maanden zonder data),
  // telt na zijn laatste dag als nul in het jaar hieronder. De KPI-band noemt het; zonder deze zin
  // zei het Jaaroverzicht niets over een kanaal dat sinds mei nul levert.
  const jaarUitgesloten = uitgeslotenZin(uitgeslotenMetDag(blended.dataStand));
  const [jaaroverzichtMetric, setJaaroverzichtMetric] = useState<ForecastMetric>("conversions");
  // De maandrijen per kanaal, uit dezelfde ophaalronde als de pacing en het jaaroverzicht: de
  // tellers van perKanaal, met de selectie van de klant en Microsoft erbij. Geen eigen verzoek
  // meer, dus een terugkeer naar dit tabblad kost er ook geen. null = nog onderweg (of mislukt:
  // dan zegt `error` waarom); een lege lijst = er valt niets te tonen, ook als de hook uit staat
  // omdat er geen twee kanalen (bekend) zijn -- de tabel hieronder staat er dan niet.
  const error = blended.error;
  const rows = useMemo(
    () => (blended.perKanaal ? kanaalMaandRijen(blended.perKanaal) : blended.loading || blended.error ? null : []),
    [blended.perKanaal, blended.loading, blended.error],
  );

  // ── DE GEKOZEN PERIODE (bouwplan fase 2) ─────────────────────────────────────────────────────
  //
  // De staven, de ring en de kanaaltabel volgen de periodekiezer. Ze hadden elk een eigen vast
  // venster: de staven de laatste zes maanden, de ring ongeveer negentig dagen, de tabel alle
  // geladen maanden (op de demo vierentwintig). Drie conversietotalen onder één band, geen van
  // drieën gelijk aan die band en geen dat bewoog als je de periode verzette. De rijen staan al in
  // het geheugen, dus de wissel kost geen verzoek; `rows` (alles) blijft de bron en bepaalt of de
  // secties er staan, zodat ze niet verdwijnen als een periode leeg is.
  const periode = usePeriod();
  const periodeStart = periode.range.start;
  const periodeEind = periode.range.end;
  // Bij een periode per dag (nieuwe weergave) is `range` de omhullende maanden, niet de gekozen
  // periode zelf: 20 t/m 30 nov wordt "nov 2026". Het bijschrift noemt dat dan niet "de gekozen periode".
  const inPeriode = periode.dag && !periode.dag.maandPad
    ? `in de maanden die de gekozen periode raken (${formatRange(periode.range)})`
    : `in de gekozen periode (${formatRange(periode.range)})`;
  const rijenPeriode = useMemo(
    () => (rows ? rijenInPeriode(rows, { start: periodeStart, end: periodeEind }) : null),
    [rows, periodeStart, periodeEind],
  );

  // Lopen de maandkosten in de hoofdgrafiek en in de kanaaltabel uiteen? Dezelfde maanden, twee
  // lezingen van Google (zie bron-verschil.ts). Leeg als ze gelijk lopen; dan staat er niets.
  const bronVerschil = useMemo(() => {
    if (!nieuw || !googleData || !rijenPeriode) return [];
    const grafiek = grafiekMaanden({ google: alsBronReeks("google", googleData) }, ["google"], { start: periodeStart, end: periodeEind });
    return kostenBronVerschil(grafiek, rijenPeriode);
  }, [nieuw, googleData, rijenPeriode, periodeStart, periodeEind]);

  // Nieuwste maand eerst, zoals de rijen binnenkomen: zo staat de maandtabel onderaan ook.
  const months = rijenPeriode ? [...new Set(rijenPeriode.map((r) => r.month))] : [];

  // Grafiek-data: spend per kanaal per maand, over de maanden van de gekozen periode waarin
  // minstens één kanaal een rij heeft. De maandtabel eronder toont het detail.
  const chartMonths = [...months].sort();

  // Lens 5: de optelsom-illusie.
  //
  // Elk kanaal claimt zijn eigen conversies met zijn eigen attributievenster, dus de som telt
  // dubbel: dezelfde aankoop wordt door Google en Meta allebei opgeeist. De blokjes hierboven
  // waarschuwen daar in algemene bewoordingen voor; deze lens maakt er een getal van.
  //
  // Zonder anker — het werkelijke aantal orders of leads uit een primaire bron — is de som een
  // BOVENGRENS en zegt de lens dat expliciet. Dat is de eerlijke uitkomst en niet een tekort:
  // een verzonnen verdeling zou hier erger zijn dan geen verdeling.
  // Over de gekozen periode, net als de tabel waar dit getal naast staat: hier stond een eigen
  // venster van zes maanden, en dan claimde de zin een ander totaal dan de totaalrij ernaast.
  const betrouwbaarheid = useMemo(() => {
    if (!rijenPeriode || rijenPeriode.length === 0) return null;
    const perKanaal = new Map<ChannelKey, number>();
    for (const r of rijenPeriode) {
      perKanaal.set(r.channel, (perKanaal.get(r.channel) ?? 0) + (r.conversions ?? 0));
    }
    if (perKanaal.size < 2) return null; // met één kanaal valt er niets op te tellen
    return blendedReliability(
      [...perKanaal].map(([channel, conversions]) => ({ channel, conversions })),
      null // geen anker beschikbaar in deze weergave
    );
  }, [rijenPeriode]);
  const chartSeries = [...new Set((rijenPeriode ?? []).map((r) => CHANNEL_LABEL[r.channel] ?? r.channel))];
  // Een maand waarin een kanaal niet gemeten is, krijgt géén nul. Hier stond `row[s] = 0` voor elke
  // serie, en daardoor las februari als "Meta heeft nul euro uitgegeven" terwijl Meta toen simpelweg
  // niet liep — de tooltip zei er "€ 0" bij. Een ontbrekende meting als meetwaarde tonen is dezelfde
  // fout als een lege grafiek als een resultaat tonen. Zonder sleutel tekent recharts niets en zwijgt
  // de tooltip; wélke series later beginnen, zegt de grafiek er in een voetnoot bij.
  const chartData = chartMonths.map((m) => {
    const row: Record<string, number | string> = { maand: m.slice(0, 7) };
    for (const r of (rijenPeriode ?? []).filter((x) => x.month === m)) {
      const label = CHANNEL_LABEL[r.channel] ?? r.channel;
      row[label] = (Number(row[label]) || 0) + (r.spend ?? 0);
    }
    return row;
  });

  // De kanaaltabel met de twee voorbehouden ernaast. Eén stuk voor beide weergaven: in de
  // vertrouwde staat het open in de sectie "Cross-channel (blended)", in de nieuwe achter "Toon als
  // tabel". Dezelfde rijen, dezelfde totalen, dezelfde tekst. Een functie en geen waarde: de
  // totalen en de veertig maandregels worden pas uitgerekend waar hij wordt aangeroepen, en in de
  // nieuwe weergave is dat pas als de lade open is.
  const tabelMetVoorbehoud = () => (
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
          {rows === null && !error && (
            <div className="flex items-center gap-2 text-body text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Laden...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>
          )}
          {rows && rows.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
              Nog geen cross-channel data. Zodra minstens twee kanalen (Google, Meta, LinkedIn of Microsoft) gesynct zijn, verschijnt hier de blended maandview.
            </div>
          )}
          {/* De rijen zijn er, maar geen enkele valt in de gekozen periode (een bereik van vóór de
              data). Neutraal en geen amber: er is niets mis, de periode is alleen leeg. */}
          {rows && rows.length > 0 && rijenPeriode && rijenPeriode.length === 0 && (
            <p className="py-8 text-center text-body text-muted-foreground">
              In {formatRange(periode.range)} heeft geen enkel kanaal cijfers. Kies een latere periode om de kanalen te vergelijken.
            </p>
          )}
          {rijenPeriode && rijenPeriode.length > 0 && (() => {
            // De rijen van de gekozen periode. Hier stond `rows`: alle geladen maanden, op de demo
            // vierentwintig, onder een band die over twaalf ging. Hetzelfde woord "Conversies",
            // twee totalen.
            const rows = rijenPeriode;
            // WAAROM DIT GEEN PLATTE LIJST MEER IS
            //
            // Hier stonden alle (maand × kanaal)-rijen onder elkaar: veertig regels ruwe data,
            // met de maand alleen op de eerste regel van elke groep en lege cellen daaronder.
            // Dat beantwoordt de vraag niet die je stelt als je hier komt — hoe verdeelt mijn
            // budget zich over de kanalen, en wat levert elk kanaal op. Die stond nergens; je
            // moest hem zelf optellen uit veertig regels.
            //
            // Nu eerst de kanaaltotalen (drie regels, met de verhouding zichtbaar), en de
            // maanddetails eronder achter een klik. De ruwe cijfers zijn niet weg; ze zijn alleen
            // niet meer het eerste wat je ziet.
            const perKanaal = new Map<string, { spend: number; clicks: number; conversions: number; waarde: number }>();
            for (const r of rows) {
              const k = CHANNEL_LABEL[r.channel] ?? r.channel;
              const a = perKanaal.get(k) ?? { spend: 0, clicks: 0, conversions: 0, waarde: 0 };
              a.spend += r.spend ?? 0;
              a.clicks += r.clicks ?? 0;
              a.conversions += r.conversions ?? 0;
              a.waarde += r.conversion_value ?? 0;
              perKanaal.set(k, a);
            }
            const kanalen = [...perKanaal.entries()].sort((a, b) => b[1].spend - a[1].spend);
            const grootsteSpend = Math.max(0, ...kanalen.map(([, a]) => a.spend));
            const grootsteConv = Math.max(0, ...kanalen.map(([, a]) => a.conversions));
            const tot = kanalen.reduce((s, [, a]) => ({
              spend: s.spend + a.spend, clicks: s.clicks + a.clicks,
              conversions: s.conversions + a.conversions, waarde: s.waarde + a.waarde,
            }), { spend: 0, clicks: 0, conversions: 0, waarde: 0 });

            // ── EEN KOLOM DIE ALLEEN STREEPJES BEVAT, HOORT ER NIET TE STAAN ──────
            //
            // Conv.waarde stond er altijd. Bij een klant die geen conversiewaarde meet -- een
            // beursformule met aanvragen in plaats van orders, dus de meeste hier -- was dat een
            // kolom van zes em-streepjes breed. Dat kost de breedte van een kolom en leest als
            // kapot in plaats van als niet-gemeten.
            //
            // Is er ergens waarde, dan staat de kolom er gewoon. Is die nergens, dan valt hij weg
            // en zegt de kaart ernaast in één regel waaróm -- dat is het verschil tussen een gat
            // en een antwoord.
            const heeftWaarde = tot.waarde > 0;

            const opVolgorde = [...months].sort();
            const n = opVolgorde.length;
            const periodeTekst = n === 0 ? null
              : n === 1 ? `${maandLabel(opVolgorde[0])} · 1 maand`
              : `${maandLabel(opVolgorde[0])} – ${maandLabel(opVolgorde[n - 1])} · ${n} maanden`;

            return (
              <>
                <Tabel>
                  <Kop>
                    <KolomKop>Kanaal</KolomKop>
                    <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
                    <KolomKop getal>Klikken</KolomKop>
                    <KolomKop getal bijschrift="aandeel">Conversies</KolomKop>
                    {heeftWaarde && <KolomKop getal>Conv.waarde</KolomKop>}
                    <KolomKop getal>CPA</KolomKop>
                  </Kop>
                  <Body>
                    {kanalen.map(([naam, a]) => (
                      <Rij key={naam}>
                        <NaamCel>{naam}</NaamCel>
                        <AandeelCel waarde={eur(a.spend)} aandeel={grootsteSpend > 0 ? a.spend / grootsteSpend : 0} />
                        <GetalCel zacht>{fmt(a.clicks)}</GetalCel>
                        <AandeelCel
                          waarde={fmt(a.conversions)}
                          aandeel={grootsteConv > 0 ? a.conversions / grootsteConv : 0}
                          kleur={CHART_CATEGORICAL[2]}
                        />
                        {heeftWaarde && <GetalCel zacht>{a.waarde > 0 ? eur(a.waarde) : "—"}</GetalCel>}
                        <GetalCel zacht>{a.conversions > 0 ? eur(a.spend / a.conversions) : "—"}</GetalCel>
                      </Rij>
                    ))}
                  </Body>
                  <TotaalRij>
                    {/* De kanaaltotalen hierboven (`tot`) sommeren de rijen van de gekozen periode,
                        dezelfde maanden als de staven, de ring en de maanddetails eronder
                        (`months`). Dat was niet altijd zo: de tabel telde alle opgehaalde rijen en
                        het label zei "Totaal (6 maanden)", het venster van de grafiek, bij een
                        bedrag dat over de hele historie liep -- ~4x te hoog voor wat er stond.

                        Met de maanden erbij die er echt in zitten, niet alleen de lengte: begint
                        een kanaal later dan de periode, dan is "12 maanden" niet WELKE, en een CPA
                        over die maanden is een ander getal dan de CPA van het jaar elders op de
                        pagina. Dat moet je kunnen zien zonder de maanden open te klappen. */}
                    <TotaalCel>
                      Totaal
                      {periodeTekst && (
                        <span className="block text-micro font-normal text-muted-foreground">{periodeTekst}</span>
                      )}
                    </TotaalCel>
                    <TotaalCel getal>{eur(tot.spend)}</TotaalCel>
                    <TotaalCel getal>{fmt(tot.clicks)}</TotaalCel>
                    <TotaalCel getal>{fmt(tot.conversions)}</TotaalCel>
                    {heeftWaarde && <TotaalCel getal>{eur(tot.waarde)}</TotaalCel>}
                    {/* De CPA uit de totalen, niet als gemiddelde van de kanaal-CPA's: dat zou
                        LinkedIn even zwaar laten wegen als Google. */}
                    <TotaalCel getal>{tot.conversions > 0 ? eur(tot.spend / tot.conversions) : "—"}</TotaalCel>
                  </TotaalRij>
                </Tabel>

                <div className="-mx-5 mt-4">
                  <RegioToggle
                    open={maandenOpen}
                    onToggle={toggleMaanden}
                    controls="cross-maanden"
                    label={`de maanden per kanaal (${rows.length} regels)`}
                  />
                </div>
                <div id="cross-maanden" hidden={!maandenOpen} className="-mx-5">
                  <Tabel>
                    <Kop>
                      <KolomKop>Maand</KolomKop>
                      <KolomKop>Kanaal</KolomKop>
                      <KolomKop getal>Spend</KolomKop>
                      <KolomKop getal>Klikken</KolomKop>
                      <KolomKop getal>Conversies</KolomKop>
                      {heeftWaarde && <KolomKop getal>Conv.waarde</KolomKop>}
                      {/* GEEN KOLOM VALUTA MEER. Die kwam uit blended_account_monthly. De route
                          waar deze rijen nu vandaan komen leest de dagtabellen, en die dragen geen
                          valuta; hem meesturen zou een extra lezing kosten, voor een kolom die
                          niets aan de bedragen deed: die stonden er al als euro's, wat er in die
                          kolom ook stond. Het voorbehoud staat in het blok hiernaast. */}
                    </Kop>
                    <Body>
                      {months.map((m) =>
                        rows.filter((r) => r.month === m).map((r, i) => (
                          <Rij key={`${m}-${r.channel}`}>
                            {/* De maand alleen op de eerste regel van zijn groep; herhaling maakt
                                de kolom een muur van dezelfde datum. */}
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{i === 0 ? maandLabel(m) : ""}</td>
                            <NaamCel>{CHANNEL_LABEL[r.channel] ?? r.channel}</NaamCel>
                            <GetalCel>{eur(r.spend)}</GetalCel>
                            <GetalCel zacht>{fmt(r.clicks)}</GetalCel>
                            <GetalCel>{fmt(r.conversions)}</GetalCel>
                            {heeftWaarde && <GetalCel zacht>{eur(r.conversion_value)}</GetalCel>}
                          </Rij>
                        ))
                      )}
                    </Body>
                  </Tabel>
                </div>
              </>
            );
          })()}
          </div>

          {/* De twee voorbehouden, naast de cijfers waar ze over gaan. */}
          <aside className="flex flex-col gap-3 lg:col-span-4">
            {/* EEN NEUTRAAL BLOK, GEEN AMBER WAARSCHUWING. Hier stonden er twee die hetzelfde
                zeiden: "Dubbeltelling" in alarmkleur en "Waarom blended indicatief is" in grijs.
                Het eerste stond er ALTIJD -- overlappende attributie is geen incident maar hoe
                blended rekenen werkt. Een waarschuwing die nooit weggaat leert je de kleur
                negeren, en daarmee ook de waarschuwing die er wel toe doet. Het cijfer blijft
                staan, de alarmkleur niet. */}
            <div className="rounded-lg border border-border bg-gray-50/70 px-4 py-3 text-meta leading-snug text-muted-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-brand-gray">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Waarom &quot;blended&quot; indicatief is
              </p>
              Elk kanaal meet zijn eigen attributie, dus de som is geen exacte verdeling: dezelfde
              aankoop kan door twee kanalen geclaimd zijn.
              {betrouwbaarheid && (
                <> In de gekozen periode claimen de kanalen samen{" "}
                <strong className="text-brand-gray">{fmt(betrouwbaarheid.blendedSum)} conversies</strong>;
                dat is een bovengrens.</>
              )}{" "}
              De bedragen zijn niet omgerekend: het totaal klopt alleen als alle kanalen in
              dezelfde valuta afrekenen.
            </div>
            {/* De weggevallen kolom, één keer uitgelegd in plaats van zes keer een streepje.
                Zie de opmerking bij `heeftWaarde` hierboven. */}
            {rijenPeriode && rijenPeriode.length > 0 && rijenPeriode.every((r) => !((r.conversion_value ?? 0) > 0)) && (
              <div className="rounded-lg border border-border bg-gray-50/70 px-4 py-3 text-meta leading-snug text-muted-foreground">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-brand-gray">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Geen conversiewaarde
                </p>
                Geen van de kanalen levert in deze periode een conversiewaarde, dus die kolom staat
                er niet. Sturen gaat hier op CPA. Wil je op ROAS sturen, dan moet er in elk kanaal
                een waarde aan de conversie hangen.
              </div>
            )}
          </aside>
        </div>
  );

  if (alleenTabel) {
    // Dezelfde voorwaarde als op het Overzicht: zonder twee kanalen valt er niets te vergelijken.
    if (kanalen.length <= 1) return null;
    return (
      <Sectie
        eerste
        icoon={<Layers className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Kanaaltotalen"
        bijschrift={`Wat elk kanaal opleverde ${inPeriode}, en de maanden erachter`}
        actie={<Vensterlabel soort="periode" />}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {tabelMetVoorbehoud()}
        </div>
      </Sectie>
    );
  }

  // De verdeling over de kanalen: de ring van de gekozen periode, of de zin dat de periode leeg is.
  const legePeriode = (
            <div className="rounded-xl border border-border bg-card px-5 py-8 text-center shadow-sm">
              <p className="mb-2"><Vensterlabel soort="periode" /></p>
              <p className="text-body text-muted-foreground">
                In {formatRange(periode.range)} heeft geen enkel kanaal cijfers. Kies een latere periode om de verdeling te zien.
              </p>
            </div>
  );

  // ── DE NIEUWE WEERGAVE (bouwplan fase 5) ─────────────────────────────────────────────────────
  //
  // Dezelfde blokken, herschikt en ingekort; achter de schakelaar "Nieuwe weergave". Wat hier niet
  // meer open staat, staat achter een knop of op een andere plek, en nergens is een cijfer weg:
  //
  //   Account Health          de rangschikking open; radar, factoren en toelichting achter
  //                           "Toon onderbouwing"
  //   Pacing + Jaaroverzicht  één kaart (pacing-jaaroverzicht.tsx) met de lade "Verloop en
  //                           prognose"; het budgetadvies in de kaart zelf
  //   Beurs                   de strook en het weekvenster blijven; de drie weekkaarten zijn één
  //                           regel "deze week"
  //   Spend per kanaal        de schakelaar Kosten in de hoofdgrafiek bovenaan
  //   Ring per kanaal         blijft, volgt de periode
  //   Kanaaltabel en maanden  achter "Toon als tabel", met de voorbehouden erbij
  //   Wereldkaart             de ranglijst naast de projectie, de tabel per land achter "Toon als
  //                           tabel"; de zes tegels "per land" staan in de totaalrij van die tabel
  //   De Microsoft-regel      het voorbehoud in het vensterlabel van de wereldkaart, het enige
  //                           blok dat Microsoft nog niet meetelt
  //
  // Alles leest dezelfde hook-aanroepen als hierboven: de herschikking kost geen verzoek, en een
  // wissel van kanaal of periode ook niet.
  if (nieuw) {
    return (
      <div>
        {/* De markten bovenaan, zoals in de vertrouwde weergave (daar direct na gezondheid en pacing,
            voor de beurs). Bij GreenTech zijn de landen de beurzen: "waar zit het" is daar net zo
            goed een vraag per land als per kanaal. Op verzoek van de eigenaar weer hoog geplaatst;
            hij stond in deze weergave eerst onderaan in "Gezondheid, pacing en markten". Geen eigen
            sectiekop: de kaart heeft er zelf een. */}
        <div>
          <GeoMapCard
            state={geo}
            channel="blended"
            naast={<GeoRanglijstInKaart state={geo} naast />}
            voet={<GeoTabelLade state={geo} toelichting={kanalen.includes("microsoft") ? MICROSOFT_UITLEG : undefined} />}
            vensterToevoeging={kanalen.includes("microsoft") ? "zonder Microsoft" : undefined}
            // De volledige zin, zoals hij in de vertrouwde weergave boven de sectie staat: waar
            // Microsoft WEL meetelt, waar niet, en waar de eigen cijfers staan. Alleen "zonder
            // Microsoft" liet de vraag open of de andere blokken het dan wel meetellen.
            vensterUitleg={kanalen.includes("microsoft") ? MICROSOFT_UITLEG : undefined}
          />
        </div>

        {blendedForecast && edition && (
          <Sectie
            icoon={<CalendarClock className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel="Prestaties richting de beurs"
            bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
          >
            <FairWeeksView data={blendedForecast.data} forecast={blendedForecast.forecast} edition={edition} compact />
          </Sectie>
        )}

        <Sectie
          icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Gezondheid en pacing"
          bijschrift="Elk blok zegt in zijn kop welk venster het gebruikt: het kalenderjaar, de gekozen periode of een eigen venster."
        >
          {/* `items-start`: de twee kaarten rekken elkaar niet op. Klapt de onderbouwing van Health
              open, dan groeit alleen die kaart. */}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <KanaalHealthRanking clientId={clientId} kanalen={kanalen} onderbouwingAchterKlik />
            {rows && rows.length > 0 && (
              chartMonths.length === 0 ? legePeriode : <CampaignTypeSplit clientId={clientId} toon={["kanaal"]} kanaalRijen={rows} />
            )}
          </div>

          {blendedForecast && (
            <PacingJaaroverzicht
              data={blendedForecast.data}
              forecast={blendedForecast.forecast}
              perKanaal={blended.perKanaal}
              dataStand={blended.dataStand}
              metric={jaaroverzichtMetric}
              onMetricChange={setJaaroverzichtMetric}
              uitgesloten={jaarUitgesloten}
            />
          )}

          {/* De kanaaltabel: de data achter de ring, en het tekstalternatief ervan. Dicht staat er de
              kop met het venster en de knop; de tabel van de maanden per kanaal (tot veertig
              regels) wordt pas gerenderd als je hem opent.
              NIET "de cijfers achter de grafiek": de hoofdgrafiek staat op de reeksen van de tegels
              bovenaan, en daarin komt Google live uit de Google-route; de ring en deze tabel lezen
              de gesynchroniseerde database. Lopen die twee uiteen, dan staat dat hier open, met
              beide bedragen, en niet pas achter de knop. */}
          {kanalen.length > 1 && (
            <section aria-label="Kanaaltotalen als tabel" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                <Layers className="h-4 w-4 text-brand-blue-ink" aria-hidden />
                <h3 className="text-title font-semibold text-brand-gray">Kanaaltotalen en maanden per kanaal</h3>
                <Vensterlabel soort="periode" />
                <span className="ml-auto text-micro text-muted-foreground">de cijfers achter de ring · staat ook open op Campagnes</span>
              </div>
              {bronVerschil.length > 0 && (
                <p className="mx-5 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-meta leading-snug text-amber-900" data-bronverschil={bronVerschil.map((v) => v.kanaal).join(",")}>
                  {bronVerschil.map((v) => bronVerschilZin(v)).join(" ")}
                </p>
              )}
              <Lade id="cross-kanaaltabel" label="Toon als tabel" labelOpen="Verberg de tabel" heelBlok>
                {tabelMetVoorbehoud}
              </Lade>
            </section>
          )}

        </Sectie>
      </div>
    );
  }

  return (
    <div>
      {/* ÉÉN KOP VOOR DE BLOKKEN MET EEN VAST VENSTER (bouwplan fase 2). Hier stonden vier secties
          door elkaar: "Markten" (met Account Health en Pacing erin), "Prestaties richting de
          beurs", dan de verdeling over de kanalen, dan het "Jaaroverzicht". Pacing, de beurs en
          het jaaroverzicht gaan alle drie over het kalenderjaar en stonden op drie plekken, met
          ertussen een blok dat de periodekiezer hoort te volgen. Wie de periode verzette zag de
          helft van de pagina stilstaan zonder te kunnen zien waarom.

          Nu staan de blokken die NIET meebewegen bij elkaar onder één kop die dat zegt, en de
          blokken die de periode WEL volgen daaronder. Niets is weg: wat een sectie was, is hier
          een deel met dezelfde titel en hetzelfde bijschrift (Deelkop), en elk blok zegt in zijn
          kop welk venster het gebruikt (Vensterlabel). De wereldkaart blijft naast Account Health
          en Pacing staan: die indeling is op hoogte uitgemeten (zie hieronder) en hoort bij de
          bovenkant van de pagina. De kaart stond lange tijd als laatste sectie, onder de volle
          cross-channel-tabel: hij bestond en werkte, maar wie hem zocht moest eerst door de hele
          tabel scrollen -- het "ik mis de wereldkaart"-effect, zonder dat er iets ontbrak. */}
      <Sectie
        eerste
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Jaar, beurs en markten"
        bijschrift="Vaste vensters: het kalenderjaar, de beurs en waar het verkeer vandaan komt, over alle kanalen samen. Deze blokken volgen de periodekiezer niet; elk zegt in zijn kop welk venster het gebruikt."
      >
        {/* DEZELFDE TWEE KAARTEN ALS DE KANAALTABBLADEN, en niet meer GeoBreakdown.
            GeoBreakdown is de oude, ongesplitste vorm: kaart links en ranglijst rechts in één
            kaart, met een `max-w-6xl` (1152px) die op een scherm van 1920px gecentreerd in een
            kaart van 1584px stond -- 216px wit aan weerszijden en een projectie van 760px in het
            midden. Dat viel niet op zolang alle tabbladen zo waren; nu de kanaaltabbladen de
            gesplitste vorm hebben (projectie plus balken in de kaart, cijfers in een eigen kaart
            eronder) las het als "er is iets met de kaart gebeurd". Zelfde componenten, zelfde
            volgorde, zelfde breedtegedrag. */}
        {/* Microsoft telt op dit tabblad niet overal mee, en dat moet er staan. De pacing, de
            beurs-sectie en het jaaroverzicht lezen sinds 1 november 2026 de dagtabellen (via
            /api/blended/client-data), net als de kerncijfers bovenaan: daar telt Microsoft mee. De
            ranking (fase 1, stap 5), de verdeling over de kanalen en de cross-channel-tabel (stap 6)
            ook: die lezen het tab-object en de tellers per kanaal uit dezelfde route. Alleen de
            markten lezen nog een bron zonder Microsoft. Zonder deze regel ontbrak Microsoft stil
            onder een kop die "alle kanalen" belooft. Gedempt en niet amber: er valt vandaag niets
            aan te doen (de kleurregel van 82cde2d). */}
        {kanalen.includes("microsoft") && (
          <p className="mb-3 text-meta leading-snug text-muted-foreground">{MICROSOFT_UITLEG}</p>
        )}
        {/* Dezelfde asymmetrische hero als de kanaaltabbladen: links de gezondheid, rechts de
            wereldkaart, en de linkerkolom vangt het hoogteverschil op. Zie google-view.tsx voor
            de volledige redenering achter de 1800px-grens. */}
        <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2 min-[1800px]:items-stretch">
          <div className="flex flex-col gap-4">
            <KanaalHealthRanking clientId={clientId} kanalen={kanalen} />
            {/* De opvanger van deze kolom. Pacing hoort hier ook inhoudelijk: de rangschikking
                zegt hoe gezond elk kanaal is, pacing zegt of het geheel op tempo ligt. Gevoed uit
                dezelfde historie als het jaaroverzicht (per kanaal, met de datastand), niet uit
                blended_account_monthly: anders konden de twee blokken over hetzelfde jaar
                verschillende getallen tonen (andere conversieselectie, wees-rollups, geen
                Microsoft). */}
            <div className="flex flex-1 flex-col">
              <BlendedPacing perKanaal={blended.perKanaal} dataStand={blended.dataStand} />
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <GeoMapCard state={geo} channel="blended" verdieping={<GeoRanglijstInKaart state={geo} />} />
          </div>
        </div>

        {/* Over de volle breedte: zes tegels naast elkaar vullen die breedte, in een halve kolom
            stonden ze in twee rijen van drie met een lege onderhelft. */}
        <GeoRanglijstCard state={geo} zonderBalken />

        {/* DEZELFDE TWEE DELEN ALS DE KANAALTABBLADEN, gevoed uit de blended historie.
            "Waarom heeft alle kanalen deze sectie niet?" -- omdat FairWeeksOverview, MetricCards en
            PerformanceChart hun data uit ClientDataProvider haalden, en die is Google-only. Alle
            drie zijn nu gesplitst in een Google-ingang en een weergave die data + forecast als props
            neemt; useBlendedClientData levert exact dezelfde twee vormen over Google, Meta,
            LinkedIn en Microsoft samen, inclusief hetzelfde jaardoel-mechanisme (vorig jaar plus
            groei zolang er niets is ingevoerd, zie lib/analysis/standaard-jaardoel.ts). */}
        {blendedForecast && edition && (
          <>
            <Deelkop
              icoon={<CalendarClock className="w-4 h-4 text-brand-blue-ink" />}
              titel="Prestaties richting de beurs"
              bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
            />
            <FairWeeksView data={blendedForecast.data} forecast={blendedForecast.forecast} edition={edition} />
          </>
        )}

        {blendedForecast && (
          <>
            <Deelkop
              icoon={<Target className="w-4 h-4 text-brand-blue-ink" />}
              titel="Jaaroverzicht"
              bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend, over alle kanalen samen"
              venster={<Vensterlabel soort="jaar" jaar={blendedForecast.data.currentYear} />}
            />
            {/* Het voorbehoud hoort hier en niet alleen bij de tabel verderop: elk kanaal claimt
                zijn eigen conversies met zijn eigen attributievenster, dus de blended som is een
                BOVENGRENS, en een prognose die daarop rekent erft dat. Maar als voetnoot en niet in
                alarmkleur: dit is hoe blended rekenen werkt, niet iets wat vandaag is misgegaan en
                wat je kunt verhelpen. */}
            <p className="text-meta leading-snug text-muted-foreground">
              De conversies hieronder zijn de som over de kanalen, elk met zijn eigen
              attributievenster: een bovengrens, geen exacte telling.
              {jaarUitgesloten && ` ${jaarUitgesloten}`}
            </p>
            <MetricCardsView
              forecast={blendedForecast.forecast}
              selected={jaaroverzichtMetric}
              onSelect={setJaaroverzichtMetric}
            />
            <PerformanceChartView
              reeks="blended"
              clientData={blendedForecast.data}
              forecast={blendedForecast.forecast}
              metric={jaaroverzichtMetric}
              onMetricChange={setJaaroverzichtMetric}
            />
          </>
        )}
      </Sectie>

      {/* Dezelfde sectie-indeling als de Google-weergave. Deze tak van de pagina stond nog op een
          vlakke `space-y-6`: de grafiek en de tabel eronder hadden evenveel lucht tussen zich als
          binnen zichzelf, terwijl het twee antwoorden op twee vragen zijn — "hoe verhouden de
          kanalen zich over de maanden" en "wat leverde elk kanaal op". */}
      {rows && rows.length > 0 && (
        <Sectie
          icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Verdeling over de kanalen"
          bijschrift={`Spend per kanaal per maand en de verdeling over de kanalen, ${inPeriode}`}
        >
          {/* De staven en de ringen naast elkaar, want het zijn twee helften van dezelfde vraag:
              de staven tonen het VERLOOP per maand, de ringen de VERDELING nu -- en de ringen ook
              voor conversies, wat de staven niet doen. "Waarom heeft alle kanalen geen donuts?"
              was terecht: de kaart bestond al (dezelfde die op Google onder "Spend per kanaal"
              staat) en las hier alleen niemand.

              Alleen de kanaal-uitsplitsing: campagnetype en campagnenaam komen uit
              ads_campaign_monthly, en die tabel kent enkel Google-campagnes. Twee tabbladen die
              een Google-verdeling tonen onder een kop die alle kanalen belooft, is precies de
              soort halve waarheid die dit tabblad moet vermijden.

              De ring krijgt dezelfde rijen als de staven en de tabel (`kanaalRijen`) en kiest er
              zelf zijn venster uit: geen tweede lezing, en geen ring die een maand anders telt
              dan de tabel eronder. */}
          {/* Beide volgen de gekozen periode, uit dezelfde rijen: de staven per maand, de ring over
              de hele periode. Heeft de periode geen enkele rij (een bereik van vóór de data), dan
              zegt de kaart dat in plaats van te verdwijnen: een blok dat wegvalt als je de periode
              verzet leest als een fout, niet als een antwoord. */}
          {chartMonths.length === 0 ? legePeriode : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
              <div className="lg:col-span-2">
                <GroupedMonthlyBars
                  title="Spend per kanaal per maand"
                  venster={<Vensterlabel soort="periode" />}
                  months={chartMonths}
                  series={chartSeries}
                  data={chartData}
                  groeit
                />
              </div>
              <CampaignTypeSplit clientId={clientId} toon={["kanaal"]} kanaalRijen={rows} />
            </div>
          )}
        </Sectie>
      )}

      {/* Data-weergave; de cross-channel-signaalanalyse draait via Analyses → Cross-channel.

          Alleen bij meer dan één kanaal, dezelfde voorwaarde als de hook hierboven: de rijen komen
          daaruit, en zolang hij uit staat is er niets te tonen en ook niets te laden. Dat is het
          geval bij een klant zonder data (de melding bovenaan het dashboard zegt dat al) en heel
          even bij het openen, als de kanalen nog niet bekend zijn. Zonder deze voorwaarde zou
          daar dan een halve tel "nog geen cross-channel data" staan voor een klant die vier
          kanalen heeft. De secties hierboven verschijnen op dezelfde manier pas met hun data. */}
      {kanalen.length > 1 && (
      <Sectie
        icoon={<Layers className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Cross-channel (blended)"
        bijschrift={`Wat elk kanaal opleverde ${inPeriode}, en de maanden erachter`}
        actie={<Vensterlabel soort="periode" />}
      >
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">

        {/* ── DE TABEL SMALLER, MET DE WAARSCHUWINGEN ERNAAST ──────────────────
            Hier stonden twee volle-breedte banners bóven een tabel van zes kolommen, en die tabel
            liep zelf ook over de volle kaartbreedte. Drie brede blokken onder elkaar, met veel
            witruimte rechts in alle drie.

            Nu staat de tabel in acht van de twaalf kolommen en staan de twee mededelingen ernaast.
            Geen opvulling: het zijn de twee voorbehouden die je bij déZE cijfers moet kennen, en
            naast de cijfers gelezen worden ze eerder gelezen dan erboven, waar je ze overslaat op
            weg naar de tabel.

            Bewust NIET de kanaalverdeling ernaast gezet, hoe verleidelijk ook: die staat al in de
            grafiek erboven én in de eerste kolom van deze tabel. Een derde kopie is geen bento
            maar herhaling.

            Onder lg valt alles terug op één kolom en staat de tabel weer voluit -- op een smal
            scherm is naast elkaar geen indeling maar gedrang. */}
        {tabelMetVoorbehoud()}
      </div>
      </Sectie>
      )}
    </div>
  );
}

// In memo: een kanaal- of periodewissel rendert ClientDashboard twee keer (de dringende render van
// de klik, daarna die van Next op het gewijzigde adres), en de tweede keer is er aan dit tabblad
// niets veranderd. Zonder memo bouwde elke wissel het hele tabblad twee keer op. De props zijn
// primitieven, setters en gememoiseerde objecten; komt er een inline functie of een nieuw object
// als prop bij, dan werkt dit stil niet meer.
export const CrossChannelView = memo(CrossChannelViewRuw);
