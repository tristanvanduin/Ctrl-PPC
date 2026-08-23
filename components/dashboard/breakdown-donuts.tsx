"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { DonutChart, type DonutSlice } from "./donut-chart";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { buildNetworkSplit, findImbalances, networkTotals, type NetworkRow } from "@/lib/pmax/network-split";
import { BREAKDOWN_DIMENSIES, metaWaardeLabel, type BreakdownKanaal } from "@/lib/analysis/breakdown-dimensions";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useVorige } from "@/lib/use-vorige";

// Waar het budget van Meta en LinkedIn landt, per uitsplitsing.
//
// Google had deze weergave wel (de PMax-ringen) en de andere twee kanalen niet, terwijl de data
// er al lag: meta_breakdown_daily en linkedin_demographic_daily werden gesynct maar bereikten
// alleen de signaal-detectors op het analysetabblad. Wie op het Meta-tabblad keek zag campagnes
// en verder niets — geen antwoord op "waar zit mijn geld".
//
// Het kostenaandeel op zichzelf zegt weinig; pas naast het conversie-aandeel wordt zichtbaar of
// een segment zijn plek verdient. De rekenkern is dezelfde als die van de PMax-ringen — dat is
// geen toeval maar dezelfde vraag over een andere dimensie, en dus dezelfde functie.
//
// De vorm is wél anders geworden. Zie de opmerking bij het strepenraster verderop: twee ringen
// dwongen de lezer een partje op kleur terug te vinden in de andere ring; twee strepen op één
// nullijn laten hetzelfde verschil in één blik zien.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

type Kanaal = BreakdownKanaal;

interface Segment { dimensie: string; waarde: string; label: string; spend: number; conversies: number; impressies: number; klikken: number }

/**
 * Eén streep: een aandeel van nul tot honderd procent, op een gedeelde nullijn.
 *
 * De breedte is `aandeel × 100`, geklemd tussen nul en honderd — een aandeel kán niet buiten dat
 * bereik vallen, maar een deling door nul of een rij die later een andere noemer krijgt wel, en een
 * streep die buiten zijn spoor loopt liegt over de verhouding.
 *
 * Een segment met een aandeel van nul krijgt géén streep van nul pixels maar een zichtbaar
 * streepje van twee, in een gedempte tint. Anders verdwijnt de rij en lijkt het segment er niet te
 * zijn, terwijl "dit segment kreeg niets" juist het antwoord is.
 */
function Streep({ aandeel, kleur, label }: { aandeel: number | null; kleur: string; label: string }) {
  const veilig = aandeel == null || !Number.isFinite(aandeel) ? 0 : Math.min(100, Math.max(0, aandeel * 100));
  const leeg = veilig <= 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--spoor,#eef1f6)]" role="img" aria-label={label}>
      {/* Loodrecht op de lengte, niet erlangs — zie de opmerking bij `AandeelCel` in data-table:
          een verloop langs de streep maakt van de kleur een tweede grootheid. */}
      <div
        className="h-full rounded-full"
        style={{
          width: leeg ? "2px" : `${veilig}%`,
          backgroundImage: `linear-gradient(to bottom, ${kleur}, color-mix(in srgb, ${kleur} 72%, transparent))`,
          opacity: leeg ? 0.35 : 1,
        }}
      />
    </div>
  );
}

/**
 * Per segment twee strepen naast elkaar: welk deel van het budget het kreeg, en welk deel van de
 * opbrengst het leverde. Dezelfde kleur in beide kolommen, want het is hetzelfde segment; de
 * vergelijking zit in de lengte en niet in de tint.
 */
function AandeelRaster({ slices, kleur, toonConversies, conversieWoord }: {
  slices: { networkType: string; label: string; costShare: number; conversionShare: number | null }[];
  kleur: (k: string) => string;
  toonConversies: boolean;
  conversieWoord: string;
}) {
  const kolommen = toonConversies ? "1fr 1fr" : "1fr";
  return (
    <div className="space-y-3">
      <div className="grid gap-x-6 text-micro font-medium uppercase tracking-wider text-muted-foreground"
           style={{ gridTemplateColumns: `minmax(0,10rem) ${kolommen}` }}>
        <span>Segment</span>
        <span>Aandeel spend</span>
        {toonConversies && <span>Aandeel {conversieWoord}</span>}
      </div>
      {slices.map((s) => (
        <div key={s.networkType} className="grid items-center gap-x-6 gap-y-1"
             style={{ gridTemplateColumns: `minmax(0,10rem) ${kolommen}` }}>
          <span className="truncate text-body text-brand-gray" title={s.label}>{s.label}</span>
          <div className="flex items-center gap-2">
            <Streep aandeel={s.costShare} kleur={kleur(s.networkType)} label={`${s.label}: ${pct(s.costShare)} van de spend`} />
            <span className="w-10 shrink-0 text-right text-micro tabular-nums text-muted-foreground">{pct(s.costShare)}</span>
          </div>
          {toonConversies && (
            <div className="flex items-center gap-2">
              <Streep aandeel={s.conversionShare} kleur={kleur(s.networkType)} label={`${s.label}: ${pct(s.conversionShare)} van de ${conversieWoord}`} />
              <span className="w-10 shrink-0 text-right text-micro tabular-nums text-muted-foreground">{pct(s.conversionShare)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * `overslaan`: dimensies die deze kaart NIET mag tonen.
 *
 * Waarvoor. De hero kan twee van deze kaarten naast elkaar zetten -- bv. LinkedIn, waar alle vier
 * de dimensies in dezelfde groep zitten en er zonder dit twee keer dezelfde donut zou staan. De
 * tweede kaart krijgt de eerste dimensie mee als `overslaan` en pakt dan vanzelf de volgende die
 * data heeft. Zo zie je er twee tegelijk in plaats van één met de rest achter tabjes.
 *
 * Bewust "welke NIET" en niet "welke WEL": een vaste dimensie voorschrijven levert een lege kaart
 * op zodra die dimensie voor deze klant geen data heeft. Uitsluiten laat de bestaande
 * `beschikbaar`-filter (alleen dimensies met echte data) gewoon zijn werk doen.
 */
export function BreakdownDonuts({ clientId, channel, groep = "levering", overslaan }: { clientId: string; channel: Kanaal; groep?: "levering" | "doelgroep"; overslaan?: readonly string[] }) {
  const [segmenten, setSegmenten] = useState<Segment[] | null>(null);
  const [dimensie, setDimensie] = useState<string | null>(null);
  const [tabelOpen, toggleTabel] = useRememberedOpen(`breakdown-tabel-${channel}-${groep}${overslaan?.length ? "-b" : ""}`, false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setSegmenten([]); return; }
    let cancelled = false;
    setSegmenten(null); setDimensie(null);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    async function laad() {
      const opgeteld = new Map<string, Segment>();
      const tel = (dimensie: string, waarde: string, label: string, spend: number, conversies: number, impressies: number, klikken: number) => {
        const sleutel = `${dimensie}|${waarde}`;
        const a = opgeteld.get(sleutel) ?? { dimensie, waarde, label, spend: 0, conversies: 0, impressies: 0, klikken: 0 };
        a.spend += spend; a.conversies += conversies; a.impressies += impressies; a.klikken += klikken;
        opgeteld.set(sleutel, a);
      };

      if (channel === "meta") {
        const { data } = await dbSelect<Record<string, unknown>>("meta_breakdown_daily", {
          select: "breakdown_type, breakdown_value, spend, conversions, impressions, link_clicks",
          clientId, filters: [{ op: "gte", column: "date", value: since }],
        });
        for (const r of data) {
          const waarde = String(r.breakdown_value ?? "");
          if (!waarde) continue;
          tel(String(r.breakdown_type ?? ""), waarde, metaWaardeLabel(waarde),
            Number(r.spend ?? 0), Number(r.conversions ?? 0), Number(r.impressions ?? 0), Number(r.link_clicks ?? 0));
        }
      } else {
        // De pivot-waarden zijn URN's; de leesbare naam staat in een aparte labeltabel. Zonder die
        // vertaling staat er "urn:li:function:8" in de legenda.
        const [{ data: rijen }, { data: labels }] = await Promise.all([
          dbSelect<Record<string, unknown>>("linkedin_demographic_daily", {
            select: "pivot_type, pivot_value_urn, spend, leads, impressions, clicks",
            clientId, filters: [{ op: "gte", column: "date", value: since }],
          }),
          // linkedin_urn_labels is een gedeelde opzoektabel zonder client_id: blijft de
          // rechtstreekse anon-lezer, buiten migratie 067's scope (zie de kop van die migratie).
          sb!.from("linkedin_urn_labels").select("urn, label"),
        ]);
        const naam = new Map((labels ?? []).map((l: Record<string, unknown>) => [String(l.urn), String(l.label ?? l.urn)]));
        for (const r of rijen) {
          const urn = String(r.pivot_value_urn ?? "");
          if (!urn) continue;
          tel(String(r.pivot_type ?? ""), urn, naam.get(urn) ?? urn,
            Number(r.spend ?? 0), Number(r.leads ?? 0), Number(r.impressions ?? 0), Number(r.clicks ?? 0));
        }
      }
      if (!cancelled) setSegmenten([...opgeteld.values()]);
    }

    laad().catch(() => { if (!cancelled) setSegmenten([]); });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  // Groep-wissel (Overzicht vs Campagnes) is geen nieuwe fetch -- dezelfde rijen, ander filter --
  // maar de eerder gekozen dimensieknop kan uit de andere groep zijn en moet dan terugvallen op
  // de eerste beschikbare knop van de nieuwe groep.
  useEffect(() => { setDimensie(null); }, [groep]);

  // Alleen dimensies waar daadwerkelijk iets in zit. Een lege keuzeknop belooft data die er niet is.
  // De vorige uitsplitsing blijft staan zolang de nieuwe onderweg is.
  const getoond = useVorige(segmenten);
  const ververst = segmenten === null && getoond !== null;

  const beschikbaar = useMemo(() => {
    if (!getoond) return [];
    const metData = new Set(getoond.filter((s) => s.spend > 0 || s.impressies > 0).map((s) => s.dimensie));
    const uitgesloten = new Set(overslaan ?? []);
    return BREAKDOWN_DIMENSIES[channel].filter((d) => d.groep === groep && metData.has(d.key) && !uitgesloten.has(d.key));
  }, [getoond, channel, groep, overslaan]);

  const actief = dimensie ?? beschikbaar[0]?.key ?? null;

  const { slices, totalen, scheefheid, kleur } = useMemo(() => {
    const vanDimensie = (getoond ?? []).filter((s) => s.dimensie === actief);
    const rijen: NetworkRow[] = vanDimensie.map((s) => ({
      networkType: s.waarde, cost: s.spend, conversions: s.conversies,
      conversionsValue: 0, impressions: s.impressies, clicks: s.klikken,
    }));
    const naam = new Map(vanDimensie.map((s) => [s.waarde, s.label]));
    // De sleutel niet normaliseren: bij Meta zijn de waarden al kleingeschreven enums en bij
    // LinkedIn zijn het URN's, waar hoofdletters betekenis hebben.
    const gesplitst = buildNetworkSplit(rijen, { labelOf: (k) => naam.get(k) ?? k, normalizeKey: (k) => k });
    const volgorde = gesplitst.map((s) => s.networkType);
    const kleur = (k: string) => CHART_CATEGORICAL[Math.max(0, volgorde.indexOf(k)) % CHART_CATEGORICAL.length];
    return { slices: gesplitst, totalen: networkTotals(gesplitst), scheefheid: findImbalances(gesplitst), kleur };
  }, [getoond, actief]);

  // Alleen een skelet als er nog nooit iets was. Wisselt de gebruiker van kanaal, dan blijft de
  // vorige uitsplitsing staan op verlaagde dekking terwijl de nieuwe binnenkomt — geen terugval
  // naar een skelet, geen hoogtesprong. Zie lib/use-vorige.ts.
  if (getoond === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel={groep === "doelgroep" ? "Doelgroepen — wie we bereiken" : "Waar gaat het budget heen"} />;
  }
  // Geen uitsplitsingen gesynct: niets tonen in plaats van een lege ring.
  if (beschikbaar.length === 0 || slices.length === 0) return null;

  const conversieWoord = channel === "linkedin" ? "leads" : "conversies";
  const kostenSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: kleur(s.networkType) }));

  return (
    <div
      // `flex h-full flex-col` met het ring+rasterblok als `flex-1`: deze kaart staat op Meta naast
      // "Conversies per land" en is niet altijd de hoogste van de twee. Zonder dit zakte het
      // verschil naar de onderrand als wit.
      className="bg-card flex h-full flex-col rounded-xl border border-border shadow-sm overflow-hidden transition-opacity duration-200"
      style={{ opacity: ververst ? 0.55 : 1 }}
      aria-busy={ververst}
    >
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        {groep === "doelgroep" ? (
          <Users className="w-4.5 h-4.5 text-brand-blue-ink" />
        ) : (
          <PieChart className="w-4.5 h-4.5 text-brand-blue-ink" />
        )}
        <h3 className="text-title font-semibold text-brand-gray">
          {groep === "doelgroep" ? "Doelgroepen — wie we bereiken" : "Waar gaat het budget heen"}
        </h3>
        <span className="text-meta text-muted-foreground">laatste 60 dagen</span>
        <div className="ml-auto flex gap-1 bg-gray-100 rounded-lg p-0.5 flex-wrap">
          {beschikbaar.map((d) => (
            <button
              key={d.key}
              onClick={() => setDimensie(d.key)}
              className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                actief === d.key ? "bg-brand-blue text-white" : "text-muted-foreground hover:text-brand-blue-ink"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* De scheefheid eerst: dat is waarom deze kaart bestaat. */}
      {scheefheid.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-amber-50/50 space-y-1">
          {scheefheid.slice(0, 2).map(({ slice, kind }) => (
            <p key={slice.networkType} className="text-body text-brand-gray">
              <strong>{slice.label}</strong>{" "}
              {kind === "duur" ? (
                <>krijgt {pct(slice.costShare)} van het budget maar levert {pct(slice.conversionShare)} van de {conversieWoord}
                  {slice.cpa != null && <> (kosten per {conversieWoord === "leads" ? "lead" : "conversie"} {eur(slice.cpa)})</>}.
                  Naar verhouding kost dit segment meer dan het oplevert.</>
              ) : (
                <>krijgt {pct(slice.costShare)} van het budget en levert {pct(slice.conversionShare)} van de {conversieWoord}
                  {slice.cpa != null && <> (kosten per {conversieWoord === "leads" ? "lead" : "conversie"} {eur(slice.cpa)})</>}.
                  Dit segment trekt het account.</>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Eén ring en een strepenraster, en niet twee ringen.
          Hier stonden twee ringen naast elkaar: kostenaandeel links, conversieaandeel rechts. De
          vraag van deze kaart is of een segment zijn plek verdient, en dat is een vergelijking
          tussen twee aandelen van hetzelfde segment — maar om die te maken moest je een partje in
          de ene ring op kleur terugvinden in de andere en twee hoeken tegen elkaar afwegen. Voor
          het vergelijken van waarden die dicht bij elkaar liggen is een ring de verkeerde vorm;
          strepen op één gedeelde nullijn zijn de goede. De ring die blijft doet wat een ring wél
          kan: in één oogopslag het geheel en het totaalbedrag in het midden. */}
      <div className="flex flex-1 flex-col justify-center px-5 py-5">
        <div className="flex flex-wrap items-center gap-8">
          <figure className="flex shrink-0 flex-col items-center gap-2">
            <DonutChart
              slices={kostenSlices}
              centerValue={eur(totalen.cost)}
              centerLabel="totale spend"
              format={eur}
              ariaLabel={`Kostenverdeling: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
            />
            <figcaption className="text-meta font-medium text-brand-gray">Spend</figcaption>
          </figure>

          <div className="min-w-0 flex-1">
            <AandeelRaster
              slices={slices}
              kleur={kleur}
              toonConversies={totalen.hasConversions}
              conversieWoord={conversieWoord}
            />
          </div>
        </div>

        {!totalen.hasConversions && (
          <p className="text-meta text-muted-foreground mt-3">
            Er zijn in dit venster geen {conversieWoord} per segment geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls={`breakdown-tabel-${channel}`}
        label={`de cijfers per segment (${slices.length})`}
      />
      <div id={`breakdown-tabel-${channel}`} hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>Segment</KolomKop>
            <KolomKop getal>Spend</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>{conversieWoord === "leads" ? "Leads" : "Conversies"}</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>{conversieWoord === "leads" ? "CPL" : "CPA"}</KolomKop>
          </Kop>
          <Body>
            {slices.map((s) => (
              <Rij key={s.networkType}>
                <NaamCel>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: kleur(s.networkType) }} aria-hidden />
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
            <TotaalCel>Alle segmenten</TotaalCel>
            <TotaalCel getal>{eur(totalen.cost)}</TotaalCel>
            <TotaalCel getal>100%</TotaalCel>
            <TotaalCel getal>{totalen.hasConversions ? num(totalen.conversions, 1) : "—"}</TotaalCel>
            <TotaalCel getal>{totalen.hasConversions ? "100%" : "—"}</TotaalCel>
            <TotaalCel getal>{totalen.conversions > 0 ? eur(totalen.cost / totalen.conversions) : "—"}</TotaalCel>
          </TotaalRij>
        </Tabel>
      </div>
    </div>
  );
}
