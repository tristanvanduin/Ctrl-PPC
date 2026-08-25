"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarClock, Globe, Info, Layers, Loader2, Target, TrendingUp } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { GroupedMonthlyBars } from "./monthly-trend-chart";
import { CampaignTypeSplit } from "./campaign-type-split";
import { blendedReliability } from "@/lib/cross-channel/measurement-reliability";
import type { ChannelKey } from "@/lib/cross-channel/lens-facts";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { RegioToggle, useRememberedOpen } from "@/components/ui/disclosure";
import { maandLabel } from "./chart-chrome";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Sectie } from "@/components/ui/sectie";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstCard, GeoRanglijstInKaart } from "./geo-ranglijst-card";
import { useGeoBreakdown } from "@/lib/geo/use-geo-breakdown";
import { KanaalHealthRanking } from "./kanaal-health-ranking";
import { useBlendedClientData } from "@/lib/use-blended-client-data";
import { computeForecast, type ForecastMetric } from "@/lib/forecast";
import { FairWeeksView } from "./fair-weeks-overview";
import { MetricCardsView } from "./metric-cards";
import { PerformanceChartView } from "./performance-chart";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import { BlendedPacing } from "./blended-pacing";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";

// Cross-channel (blended) tab. Leest de blended_account_monthly-view over Google, Meta en
// LinkedIn heen. De view levert de bouwstenen; de attributie-voetnoot is verplicht, want elk
// kanaal meet zijn eigen attributie en bedragen zijn alleen optelbaar bij gelijke valuta.

interface BlendedRow {
  month: string;
  channel: string;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  conversion_value: number | null;
  leads: number | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: "Google",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
};

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

export function CrossChannelView({ clientId, kanalen = [], edition }: {
  clientId: string;
  kanalen?: Kanaal[];
  edition?: UpcomingEdition | null;
}) {
  const [maandenOpen, toggleMaanden] = useRememberedOpen("cross-maanden", false);
  // Eén hook-aanroep voor beide geo-kaarten: de kaart en de cijfers eronder delen dezelfde
  // metric-keuze en dezelfde VS-drilldown. Twee aanroepen zouden twee losse states geven.
  const geo = useGeoBreakdown({ clientId, channel: "blended" });
  // De blended historie voedt zowel de beurs-sectie als het jaaroverzicht. Eén hook, één forecast:
  // twee aanroepen zouden dezelfde route twee keer bevragen en twee keer dezelfde som uitrekenen.
  const blended = useBlendedClientData(clientId);
  const blendedForecast = useMemo(
    () => (blended.data ? { data: blended.data, forecast: computeForecast(blended.data) } : null),
    [blended.data],
  );
  const [jaaroverzichtMetric, setJaaroverzichtMetric] = useState<ForecastMetric>("conversions");
  const [rows, setRows] = useState<BlendedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    dbSelect<BlendedRow>("blended_account_monthly", {
      select: "month, channel, currency, impressions, clicks, spend, conversions, conversion_value, leads",
      clientId,
      order: { column: "month", ascending: false },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows(data);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  const months = rows ? [...new Set(rows.map((r) => r.month))] : [];

  // Grafiek-data: spend per kanaal per maand, gefocust op het recente advertentievenster
  // (de laatste maanden richting de beurs) i.p.v. de hele historie. De maandtabel eronder toont
  // het detail. Social (Meta/LinkedIn) draait doorgaans pas in de aanloop, dus dit venster laat
  // de mix ook eerlijker zien.
  const RECENT_MONTHS = 6;
  const chartMonths = [...months].sort().slice(-RECENT_MONTHS);

  // Lens 5: de optelsom-illusie.
  //
  // Elk kanaal claimt zijn eigen conversies met zijn eigen attributievenster, dus de som telt
  // dubbel: dezelfde aankoop wordt door Google en Meta allebei opgeeist. De blokjes hierboven
  // waarschuwen daar in algemene bewoordingen voor; deze lens maakt er een getal van.
  //
  // Zonder anker — het werkelijke aantal orders of leads uit een primaire bron — is de som een
  // BOVENGRENS en zegt de lens dat expliciet. Dat is de eerlijke uitkomst en niet een tekort:
  // een verzonnen verdeling zou hier erger zijn dan geen verdeling.
  // chartMonths wordt elke render opnieuw opgebouwd; als afhankelijkheid zou de memo dus nooit
  // aanslaan. Het venster wordt daarom hierbinnen bepaald, uit rows.
  const betrouwbaarheid = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const venster = [...new Set(rows.map((r) => r.month))].sort().slice(-RECENT_MONTHS);
    const perKanaal = new Map<string, number>();
    for (const r of rows.filter((x) => venster.includes(x.month))) {
      perKanaal.set(r.channel, (perKanaal.get(r.channel) ?? 0) + (r.conversions ?? 0));
    }
    if (perKanaal.size < 2) return null; // met één kanaal valt er niets op te tellen
    return blendedReliability(
      [...perKanaal].map(([channel, conversions]) => ({ channel: channel as ChannelKey, conversions })),
      null // geen anker beschikbaar in deze weergave
    );
  }, [rows]);
  const chartSeries = [...new Set((rows ?? []).map((r) => CHANNEL_LABEL[r.channel] ?? r.channel))];
  // Een maand waarin een kanaal niet gemeten is, krijgt géén nul. Hier stond `row[s] = 0` voor elke
  // serie, en daardoor las februari als "Meta heeft nul euro uitgegeven" terwijl Meta toen simpelweg
  // niet liep — de tooltip zei er "€ 0" bij. Een ontbrekende meting als meetwaarde tonen is dezelfde
  // fout als een lege grafiek als een resultaat tonen. Zonder sleutel tekent recharts niets en zwijgt
  // de tooltip; wélke series later beginnen, zegt de grafiek er in een voetnoot bij.
  const chartData = chartMonths.map((m) => {
    const row: Record<string, number | string> = { maand: m.slice(0, 7) };
    for (const r of (rows ?? []).filter((x) => x.month === m)) {
      const label = CHANNEL_LABEL[r.channel] ?? r.channel;
      row[label] = (Number(row[label]) || 0) + (r.spend ?? 0);
    }
    return row;
  });

  return (
    <div>
      {/* "Markten" stond hier lange tijd als laatste sectie, onder de volle cross-channel-tabel --
          op Google/Meta/LinkedIn's eigen Overzicht staat dezelfde kaart wél bovenaan, in de opener.
          Voor een klant met >1 kanaal (waar "Alle kanalen" de standaardweergave is) betekende dat:
          de kaart bestond en werkte, maar wie hem zocht moest eerst door de hele tabel scrollen --
          precies het "ik mis de wereldkaart"-effect, zonder dat er iets ontbrak. Nu vooraan, zelfde
          plek als bij de losse kanalen. */}
      <Sectie
        eerste
        icoon={<Globe className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Markten"
        bijschrift="Waar het verkeer en de conversies vandaan komen, over alle kanalen samen"
      >
        {/* DEZELFDE TWEE KAARTEN ALS DE KANAALTABBLADEN, en niet meer GeoBreakdown.
            GeoBreakdown is de oude, ongesplitste vorm: kaart links en ranglijst rechts in één
            kaart, met een `max-w-6xl` (1152px) die op een scherm van 1920px gecentreerd in een
            kaart van 1584px stond -- 216px wit aan weerszijden en een projectie van 760px in het
            midden. Dat viel niet op zolang alle tabbladen zo waren; nu de kanaaltabbladen de
            gesplitste vorm hebben (projectie plus balken in de kaart, cijfers in een eigen kaart
            eronder) las het als "er is iets met de kaart gebeurd". Zelfde componenten, zelfde
            volgorde, zelfde breedtegedrag. */}
        {/* Dezelfde asymmetrische hero als de kanaaltabbladen: links de gezondheid, rechts de
            wereldkaart, en de linkerkolom vangt het hoogteverschil op. Zie google-view.tsx voor
            de volledige redenering achter de 1800px-grens. */}
        <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-2 min-[1800px]:items-stretch">
          <div className="flex flex-col gap-4">
            <KanaalHealthRanking clientId={clientId} kanalen={kanalen} />
            {/* De opvanger van deze kolom. Pacing hoort hier ook inhoudelijk: de rangschikking
                zegt hoe gezond elk kanaal is, pacing zegt of het geheel op tempo ligt. */}
            <div className="flex flex-1 flex-col">
              <BlendedPacing rows={rows} />
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <GeoMapCard state={geo} channel="blended" verdieping={<GeoRanglijstInKaart state={geo} />} />
          </div>
        </div>

        {/* Over de volle breedte: zes tegels naast elkaar vullen die breedte, in een halve kolom
            stonden ze in twee rijen van drie met een lege onderhelft. */}
        <div className="mt-4">
          <GeoRanglijstCard state={geo} zonderBalken />
        </div>
      </Sectie>

      {/* DEZELFDE TWEE SECTIES ALS DE KANAALTABBLADEN, gevoed uit de blended historie.
          "Waarom heeft alle kanalen deze sectie niet?" -- omdat FairWeeksOverview, MetricCards en
          PerformanceChart hun data uit ClientDataProvider haalden, en die is Google-only. Alle
          drie zijn nu gesplitst in een Google-ingang en een weergave die data + forecast als props
          neemt; useBlendedClientData levert exact dezelfde twee vormen over Google, Meta en
          LinkedIn samen, inclusief hetzelfde jaardoel-mechanisme (vorig jaar plus groei zolang er
          niets is ingevoerd, zie lib/analysis/standaard-jaardoel.ts). */}
      {blendedForecast && edition && (
        <Sectie
          icoon={<CalendarClock className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Prestaties richting de beurs"
          bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
        >
          <FairWeeksView data={blendedForecast.data} forecast={blendedForecast.forecast} edition={edition} />
        </Sectie>
      )}

      {/* Dezelfde sectie-indeling als de Google-weergave. Deze tak van de pagina stond nog op een
          vlakke `space-y-6`: de grafiek en de tabel eronder hadden evenveel lucht tussen zich als
          binnen zichzelf, terwijl het twee antwoorden op twee vragen zijn — "hoe verhouden de
          kanalen zich over de maanden" en "wat leverde elk kanaal op". */}
      {rows && rows.length > 0 && (
        <Sectie
          icoon={<TrendingUp className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Verdeling over de kanalen"
          bijschrift="Spend per kanaal per maand en over de laatste 90 dagen"
        >
          {/* De staven en de ringen naast elkaar, want het zijn twee helften van dezelfde vraag:
              de staven tonen het VERLOOP per maand, de ringen de VERDELING nu -- en de ringen ook
              voor conversies, wat de staven niet doen. "Waarom heeft alle kanalen geen donuts?"
              was terecht: de kaart bestond al (dezelfde die op Google onder "Spend per kanaal"
              staat) en las hier alleen niemand.

              Alleen de kanaal-uitsplitsing: campagnetype en campagnenaam komen uit
              ads_campaign_monthly, en die tabel kent enkel Google-campagnes. Twee tabbladen die
              een Google-verdeling tonen onder een kop die alle kanalen belooft, is precies de
              soort halve waarheid die dit tabblad moet vermijden. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
            <div className="lg:col-span-2">
              <GroupedMonthlyBars title="Spend per kanaal per maand" months={chartMonths} series={chartSeries} data={chartData} groeit />
            </div>
            <CampaignTypeSplit clientId={clientId} toon={["kanaal"]} />
          </div>
        </Sectie>
      )}

      {blendedForecast && (
        <Sectie
          icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
          titel="Jaaroverzicht"
          bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend, over alle kanalen samen"
        >
          {/* Het voorbehoud hoort hier en niet alleen bij de tabel verderop: elk kanaal claimt
              zijn eigen conversies met zijn eigen attributievenster, dus de blended som is een
              BOVENGRENS, en een prognose die daarop rekent erft dat. Maar als voetnoot en niet in
              alarmkleur: dit is hoe blended rekenen werkt, niet iets wat vandaag is misgegaan en
              wat je kunt verhelpen. */}
          <p className="text-meta leading-snug text-muted-foreground">
            De conversies hieronder zijn de som over de kanalen, elk met zijn eigen
            attributievenster: een bovengrens, geen exacte telling.
          </p>
          <MetricCardsView
            clientId={clientId}
            data={blendedForecast.data}
            forecast={blendedForecast.forecast}
            selected={jaaroverzichtMetric}
            onSelect={setJaaroverzichtMetric}
          />
          <PerformanceChartView
            clientData={blendedForecast.data}
            forecast={blendedForecast.forecast}
            metric={jaaroverzichtMetric}
            onMetricChange={setJaaroverzichtMetric}
          />
        </Sectie>
      )}

      {/* Data-weergave; de cross-channel-signaalanalyse draait via Analyses → Cross-channel. */}
      <Sectie
        icoon={<Layers className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Cross-channel (blended)"
        bijschrift="Wat elk kanaal opleverde, en de maanden erachter"
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
              Nog geen cross-channel data. Zodra minstens één kanaal (Google/Meta/LinkedIn) gesynct is, verschijnt hier de blended maandview.
            </div>
          )}
          {rows && rows.length > 0 && (() => {
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
                    {/* De kanaaltotalen hierboven (`tot`) sommeren ALLE opgehaalde rijen, niet
                        alleen het 6-maanden-venster van de grafiek erboven -- dat venster heet
                        `chartMonths` en is voor recente demo-data (24 maanden historie) een stuk
                        korter dan de werkelijke reeks. Het label gebruikte per ongeluk
                        chartMonths.length en beweerde dus "Totaal (6 maanden)" bij een bedrag dat
                        over de hele historie liep -- op deze klant ~4x te hoog voor wat het label
                        zei. `months` (alle maanden in `rows`) is de tabel die er echt bij hoort;
                        de maanddetails eronder tonen dezelfde volledige reeks. */}
                    <TotaalCel>Totaal ({months.length} maanden)</TotaalCel>
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
                      <KolomKop>Valuta</KolomKop>
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
                            <td className="px-3 py-2 text-muted-foreground">{r.currency ?? "—"}</td>
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
                <> Over de laatste {chartMonths.length} maanden claimen de kanalen samen{" "}
                <strong className="text-brand-gray">{fmt(betrouwbaarheid.blendedSum)} conversies</strong>;
                dat is een bovengrens.</>
              )}{" "}
              Bedragen alleen optellen over kanalen met gelijke valuta.
            </div>
            {/* De weggevallen kolom, één keer uitgelegd in plaats van zes keer een streepje.
                Zie de opmerking bij `heeftWaarde` hierboven. */}
            {rows && rows.length > 0 && rows.every((r) => !((r.conversion_value ?? 0) > 0)) && (
              <div className="rounded-lg border border-border bg-gray-50/70 px-4 py-3 text-meta leading-snug text-muted-foreground">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-brand-gray">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Geen conversiewaarde
                </p>
                Geen van de kanalen levert in deze periode een conversiewaarde, dus die kolom staat
                er niet. Sturen gaat hier op CPA. Wil je op ROAS sturen, dan moet er in Google,
                Meta en LinkedIn een waarde aan de conversie hangen.
              </div>
            )}
          </aside>
        </div>
      </div>
      </Sectie>
    </div>
  );
}
