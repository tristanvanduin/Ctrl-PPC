"use client";

import { useEffect, useMemo, useState } from "react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import type { ReadFilter } from "@/lib/data-access/read-policy";
import { resolveChannelConversionConfig, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { alsBronReeks, type BronReeks } from "@/lib/period/apply-period";
import { addMonths, type Month } from "@/lib/period/period-range";
import { monthsAgo } from "@/lib/reporting-date";
import { HISTORIE_JAREN } from "@/lib/api/google-vergelijking";
import {
  NIET_GOOGLE, kanaalDagbron, kanaalStandUitDagen, samenvoegen,
  type KanaalStand, type NietGoogleKanaal,
} from "@/lib/period/kanaal-maanden";
import type { ClientHistoricalData } from "@/lib/types";

// De KPI-rij (PeriodSummary) toonde altijd Google-cijfers, ook op de Meta/LinkedIn/Alle
// kanalen-tabs -- niet "blend die niet meebeweegt" maar letterlijk het verkeerde kanaal op drie
// van de vier tabs. Deze hook berekent hetzelfde ClientHistoricalData-schema (dat comparePeriods()
// in lib/period/apply-period.ts al kent) voor Meta, LinkedIn en Microsoft, en telt alle kanalen
// samen op voor "blended" (de standaardweergave, "Alle kanalen") -- zodat client-dashboard.tsx aan
// PeriodSummary precies dezelfde vorm data kan geven, welk kanaal er ook actief is.
//
// Bewust dezelfde bron als ChannelPerformance (dbSelect, dus altijd de echte database, ook in
// demo-modus) en dezelfde conversieselectie: dag -> maand loopt via kanaalMaandenUitDagen
// (lib/analysis/channel-report-blend.ts), de ene plek waar de selectie van de klant op dagrijen
// wordt toegepast. De rekenkant staat in lib/period/kanaal-maanden.ts; hier zit alleen het laden.
//
// 22 augustus 2026: dit las tot nu toe rechtstreeks met supabase.from(), wat in demo-modus via de
// demo-mock liep -- de tegenhanger, ChannelPerformance, is in dezelfde ronde net van hetzelfde
// patroon naar dbSelect omgezet. Was dit blijven staan, dan waren de twee juist uit elkaar gaan
// lopen: de KPI-rij bovenaan de pagina met een ander cijfer dan de kaart eronder, voor exact
// dezelfde metriek.

/** Wat de band nodig heeft, voor het actieve kanaal. */
export interface ChannelPeriodData {
  /** De reeks voor de cijfers; bij "blended" de optelling van alle kanalen. Null zolang hij laadt. */
  data: ClientHistoricalData | null;
  /**
   * De losse bronnen voor de vergelijking. Bij "blended" de vier kanalen, zodat er per kanaal
   * gepaard wordt; op een kanaaltab één bron met de eerste volle maand en de laadgrens erbij (zonder
   * die bron bouwt comparePeriods er zelf een, en die kent geen van beide). Google is een maandbron:
   * daar is de eerste maand met data de start, en alleen de laadgrens gaat mee.
   */
  bronnen: BronReeks[] | null;
  /** Per niet-Google-kanaal de laatste dag met een rij, voor het venster van de band. */
  laatsteDag: Record<NietGoogleKanaal, string | null>;
  /** Per niet-Google-kanaal de eerste maand die volledig geladen is; null zolang hij laadt. */
  geladenVanaf: Record<NietGoogleKanaal, Month | null>;
}

// Het plafond van /api/data: PostgREST levert hooguit 1000 rijen per antwoord (max-rows), en de
// route kent geen offset. Expliciet als limit meegegeven, zodat een volle pagina herkenbaar is.
const PAGINA = 1000;

// Hoe ver terug de band laadt: 36 maanden, vanaf de eerste van de maand (Amsterdam). Eerst stond
// hier "nu min 730 dagen": op elke dag behalve de 1e begon dat midden in een maand, en die
// afgeknipte maand telde in "laatste 12 maanden tegen vorig jaar" mee alsof hij compleet was.
// Daarna 24 maanden, en dat was te kort: "Vorig jaar" tegen het jaar daarvoor loopt tot januari van
// twee jaar terug (35 maanden), en de laatste twaalf maanden schuiven mee terug zodra de data
// achterloopt. De band noemde de laadgrens dan "de data begint in" (review [5], [41]).
const MAANDEN_TERUG = 36;

/** Een "YYYY-MM-DD" uit een rij, of "" als hij er niet is. */
const dagVan = (r: Record<string, unknown>): string => String(r.date ?? "").slice(0, 10);

// De dagrijen van een kanaal, ZONDER conversieselectie. dagbronSelect haalt alle selecteerbare
// conversievelden op; de selectie bepaalt alleen hoe ze worden opgeteld, niet welke rijen er
// komen. Stond de selectie in de effect-deps, dan werd elke tabel twee keer opgehaald: eerst met
// de standaardselectie, dan nog eens zodra client_settings binnen was.
//
// PAGINEREN OP DATUM. Eén verzoek zonder paginering gaf bij twee Meta-accounts (een rij per account
// per dag, ~1460 in twee jaar) de nieuwste 1000 rijen, en de afgeknipte oudste maand paarde als
// volle maand: +13,3% op vlakke data, met "de data begint in juni 2025" erbij (review [1]). De
// route kent alleen gte/lte en één sorteerkolom, dus keyset: nieuwste eerst, en na een volle pagina
// verder t/m de oudste dag van die pagina. Die dag kan half binnen zijn (de grens valt tussen twee
// accounts), dus hij gaat uit deze pagina en komt in de volgende in zijn geheel terug.
//
// Lukt een pagina niet, dan houdt het laden daar op en schuift `geladenVanaf` mee: de band zegt dan
// dat die maanden niet geladen zijn, in plaats van ze als nul of als start te lezen.
async function fetchKanaalRijen(clientId: string, kanaal: NietGoogleKanaal): Promise<{ rijen: Record<string, unknown>[]; geladenVanaf: Month }> {
  const bron = kanaalDagbron(kanaal);
  const vanaf = monthsAgo(MAANDEN_TERUG);
  const rijen: Record<string, unknown>[] = [];
  let tot: string | null = null;
  for (;;) {
    const filters: ReadFilter[] = [{ op: "gte", column: "date", value: vanaf }];
    if (tot) filters.push({ op: "lte", column: "date", value: tot });
    const { data, error }: { data: Record<string, unknown>[]; error: { message: string } | null } = await dbSelect(bron.table, {
      select: bron.select, clientId, filters,
      order: { column: "date", ascending: false },
      limit: PAGINA,
    });
    // Een fout op een latere pagina: alles vóór `tot` is niet geladen, en de maand van `tot` maar
    // deels. Een fout op de EERSTE pagina: er is niets geladen, en dan ligt de laadgrens ná de
    // lopende maand. Hier las een mislukte eerste pagina als "nul rijen, dus alles geladen vanaf 36
    // maanden terug" (dbSelect geeft bij een fout data: []), en de band zei daarop "er is nog geen
    // enkele maand met data" bij een kanaal met honderden rijen, in plaats van "geen data geladen".
    // De grens blijft een maand (geen null), zodat de band hem als laadgrens kan lezen.
    if (error) {
      console.warn(`[band] ${bron.table} voor ${clientId}: ${tot ? `pagina vóór ${tot}` : "eerste pagina"} niet geladen (${error.message})`);
      return { rijen, geladenVanaf: tot ? addMonths(tot.slice(0, 7), 1) : addMonths(vanaf.slice(0, 7), MAANDEN_TERUG + 1) };
    }
    if (data.length < PAGINA) {
      rijen.push(...data);
      return { rijen, geladenVanaf: vanaf.slice(0, 7) };
    }
    const oudste: string = data.reduce((m: string, r) => (dagVan(r) < m ? dagVan(r) : m), dagVan(data[0]));
    if (oudste === tot) {
      // Eén dag met 1000 of meer rijen: verder komen kan alleen met een tweede sorteersleutel, en
      // die kent de route niet. Liever een te laag totaal met een spoor dan een lus.
      rijen.push(...data);
      console.warn(`[band] ${bron.table} voor ${clientId}: meer dan ${PAGINA} rijen op ${oudste}, afgekapt`);
      return { rijen, geladenVanaf: addMonths(oudste.slice(0, 7), 1) };
    }
    rijen.push(...data.filter((r) => dagVan(r) !== oudste));
    tot = oudste;
  }
}

// Het opslaan van de conversieselectie (Instellingen > Meten) zit in dezelfde ClientDashboard als
// de band, en de band blijft daarbij gemount. Zonder dit seintje hield hij de oude selectie vast
// tot een herlaadbeurt, terwijl het Jaaroverzicht eronder de nieuwe toonde (review [4], [22], [40]).
const KANAALSELECTIE_OPGESLAGEN = "kanaalselectie-opgeslagen";

/** Aan te roepen na het opslaan van de Meta/LinkedIn/Microsoft-selectie: de band leest opnieuw. */
export function meldKanaalselectieOpgeslagen(clientId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(KANAALSELECTIE_OPGESLAGEN, { detail: { clientId } }));
}

/** Een kanaal zoals de band het bewaart: de stand plus tot waar terug hij geladen is. */
type GeladenKanaal = KanaalStand & { geladenVanaf: Month };

export interface ChannelPeriodDataArgs {
  clientId: string;
  /** De actieve kanaaltab. "blended" = Alle kanalen (de standaardweergave). */
  channel: "google" | "meta" | "linkedin" | "microsoft" | "blended";
  /** Google's al opgehaalde data -- deze hook haalt alleen Meta/LinkedIn/Microsoft zelf op. */
  googleData: ClientHistoricalData | null;
}

/** De juiste data voor de KPI-rij, gegeven het actieve kanaal. */
export function useChannelPeriodData({ clientId, channel, googleData }: ChannelPeriodDataArgs): ChannelPeriodData {
  // Met de klant erbij opgeslagen: bij een klantwissel tellen de kanalen van de vorige klant niet
  // meer, ook niet in de render vóór het nieuwe antwoord binnen is.
  const [geladen, setGeladen] = useState<{ clientId: string; kanalen: Partial<Record<NietGoogleKanaal, GeladenKanaal>> } | null>(null);
  // Opgehoogd na het opslaan van de selectie, zodat het effect hieronder opnieuw leest. De oude
  // cijfers blijven staan tot de nieuwe binnen zijn: het is dezelfde klant, alleen anders geteld.
  const [versie, setVersie] = useState(0);
  useEffect(() => {
    const opOpslaan = (e: Event) => {
      if ((e as CustomEvent<{ clientId?: string }>).detail?.clientId === clientId) setVersie((v) => v + 1);
    };
    window.addEventListener(KANAALSELECTIE_OPGESLAGEN, opOpslaan);
    return () => window.removeEventListener(KANAALSELECTIE_OPGESLAGEN, opOpslaan);
  }, [clientId]);

  // Eén effect, op clientId en `versie` (die alleen een opgeslagen selectie ophoogt). Hier stond de
  // conversie-config als eigen state, en hadden de drie fetches [clientId, convConfig] als deps.
  // resolveChannelConversionConfig levert elke keer een NIEUW object, dus zodra client_settings
  // binnen was startten alle drie opnieuw -- ook als er niets was opgeslagen (vandaag bij elke
  // klant): 7 verzoeken per paginabezoek waar 4 volstaan.
  //
  // Altijd alle drie ophalen, ongeacht welk kanaal actief is: "blended" heeft ze alle drie nodig, en
  // tussen tabs wisselen zonder herhaald fetchen is prettiger dan per tab opnieuw laden.
  useEffect(() => {
    let cancelled = false;
    // Parallel aan de dagrijen, maar een kanaal wordt pas gezet als BEIDE binnen zijn. Niet eerder:
    // tellen met de standaardselectie kan een ander getal geven dan de opgeslagen keuze (LinkedIn met
    // alleen "Lead-formulieren": 200 in plaats van 387 bij de demo), en dat getal stond dan even in
    // de KPI-rij. Een mislukte lees valt terug op de standaardselectie, net als voorheen.
    const config = dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId })
      .then(({ data }) => resolveChannelConversionConfig((data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
    for (const kanaal of NIET_GOOGLE) {
      Promise.all([config, fetchKanaalRijen(clientId, kanaal)]).then(([cfg, { rijen, geladenVanaf }]) => {
        if (cancelled) return;
        const stand: GeladenKanaal = { ...kanaalStandUitDagen(clientId, rijen, kanaal, cfg), geladenVanaf };
        setGeladen((g) => ({ clientId, kanalen: { ...(g?.clientId === clientId ? g.kanalen : {}), [kanaal]: stand } }));
      });
    }
    return () => { cancelled = true; };
  }, [clientId, versie]);

  const kanalen = geladen?.clientId === clientId ? geladen.kanalen : null;
  const meta = kanalen?.meta ?? null;
  const linkedin = kanalen?.linkedin ?? null;
  const microsoft = kanalen?.microsoft ?? null;

  const keuze = useMemo((): Pick<ChannelPeriodData, "data" | "bronnen"> => {
    // Eén kanaal: de data plus één bron met zijn eerste volle maand en laadgrens. "totaal" en geen
    // kanaalnaam: de band noemt bij één bron geen kanaal (ongepaardTekst in period-summary.tsx).
    const los = (s: GeladenKanaal | null): Pick<ChannelPeriodData, "data" | "bronnen"> =>
      (s ? { data: s.data, bronnen: [alsBronReeks("totaal", s.data, s.vanaf, s.geladenVanaf)] } : { data: null, bronnen: null });
    // Google's laadgrens: /api/google-ads/client-data haalt vanaf 1 januari, HISTORIE_JAREN jaar vóór
    // het jaar van het antwoord. Zonder die grens "begon" een account dat al sinds 2015 loopt in
    // januari 2021, en zei de band over 2020 "de data begint in januari 2021" en "nieuw in deze
    // periode", of op Alle kanalen "Google Ads (sinds januari 2021) ... liep het nog niet". De
    // demoroute haalt de hele historie; daar is dit een ondergrens, en zegt de band over wat ervóór
    // ligt alleen dat hij het niet heeft, niet dat het leeg was.
    const googleGeladen = googleData ? `${googleData.currentYear - HISTORIE_JAREN}-01` : null;
    if (channel === "google") return { data: googleData, bronnen: googleData ? [alsBronReeks("totaal", googleData, null, googleGeladen)] : null };
    if (channel === "meta") return los(meta);
    if (channel === "linkedin") return los(linkedin);
    if (channel === "microsoft") return los(microsoft);
    // blended: pas tonen zodra alle kanalen binnen zijn -- anders telt een half-geladen kanaal als
    // nul mee, en dat leest als "dit kanaal presteert niet" in plaats van "nog aan het laden".
    if (!googleData || !meta || !linkedin || !microsoft) return { data: null, bronnen: null };
    // De losse kanalen gaan mee, zodat de vergelijking per kanaal kan paren: een kanaal dat in de
    // vergelijkingsperiode nog niet liep, telde in de optelling anders als groei. Google is een
    // maandbron zonder dagen: daar is de eerste maand met data de start.
    return {
      data: samenvoegen(clientId, [googleData, meta.data, linkedin.data, microsoft.data]),
      bronnen: [
        alsBronReeks("google", googleData, null, googleGeladen),
        alsBronReeks("meta", meta.data, meta.vanaf, meta.geladenVanaf),
        alsBronReeks("linkedin", linkedin.data, linkedin.vanaf, linkedin.geladenVanaf),
        alsBronReeks("microsoft", microsoft.data, microsoft.vanaf, microsoft.geladenVanaf),
      ],
    };
  }, [channel, clientId, googleData, meta, linkedin, microsoft]);

  const mDag = meta?.laatsteDag ?? null;
  const lDag = linkedin?.laatsteDag ?? null;
  const msDag = microsoft?.laatsteDag ?? null;
  const laatsteDag = useMemo(() => ({ meta: mDag, linkedin: lDag, microsoft: msDag }), [mDag, lDag, msDag]);
  const mVan = meta?.geladenVanaf ?? null;
  const lVan = linkedin?.geladenVanaf ?? null;
  const msVan = microsoft?.geladenVanaf ?? null;
  const geladenVanaf = useMemo(() => ({ meta: mVan, linkedin: lVan, microsoft: msVan }), [mVan, lVan, msVan]);

  return { ...keuze, laatsteDag, geladenVanaf };
}
