"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart, X } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { CHART_CATEGORICAL, CHANNEL_CHART_COLOR } from "@/lib/branding/chart-colors";
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

// De kleur van een segment. Voor campagnetype en campagnenaam is er geen vaste identiteit, dus
// telt de positie in de ring (grootste eerst) -- dat is stabiel zolang de verdeling stabiel is.
//
// Voor KANALEN telt dat juist niet: Meta was hier paars in de staafgrafiek ernaast en groen in de
// ring, omdat de ring op volgorde van spend kleurt en de staven op identiteit. Dezelfde fout die
// lib/branding/chart-colors.ts beschrijft, twee kaarten naast elkaar. Een kanaal houdt nu overal
// zijn eigen kleur, ook als het van plek wisselt in de verdeling.
function colorFor(uitsplitsing: Uitsplitsing, sleutel: string, order: string[]): string {
  if (uitsplitsing === "kanaal") {
    const naam = KANAAL_LABEL_BLENDED[sleutel];
    const vast = naam ? CHANNEL_CHART_COLOR[naam as keyof typeof CHANNEL_CHART_COLOR] : undefined;
    if (vast) return vast;
  }
  const i = order.indexOf(sleutel);
  return CHART_CATEGORICAL[(i < 0 ? 0 : i) % CHART_CATEGORICAL.length];
}

interface CampaignMonthlyRow {
  campaign_type: string | null;
  campaign_name: string | null;
  cost: number | null;
  conversions: number | null;
  conversions_value: number | null;
  impressions: number | null;
  clicks: number | null;
}

interface BlendedMonthlyRow {
  channel: string | null;
  spend: number | null;
  conversions: number | null;
  conversion_value: number | null;
  impressions: number | null;
  clicks: number | null;
}

// blended_account_monthly schrijft de kanaalsleutel als google_ads/meta_ads/linkedin_ads (zie
// lib/demo/demo-rows.ts en lib/benchmark/god-view-data.ts). KANAAL_NAAM uit lib/kanalen gebruikt
// de korte sleutels (google/meta/linkedin), dus dit is een aparte kaart en geen tweede definitie
// van dezelfde: het zijn twee verschillende sleutelruimtes voor dezelfde drie kanalen.
const KANAAL_LABEL_BLENDED: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta",
  linkedin_ads: "LinkedIn",
};

/**
 * De uitsplitsingen die Google's ringen kunnen tonen.
 *
 * Waarom alleen deze drie. De eigenaar vroeg om meer filteropties (campagne, doelgroep, device,
 * kanaal). Nagemeten in de database welke bronnen daadwerkelijk gevuld zijn:
 * `ads_campaign_monthly` heeft 128 rijen voor de demo (campagnetype EN campagnenaam), en de
 * blended maandtabel draagt de kanaalverdeling. `ads_device_monthly`, `ads_audience_monthly`,
 * `ads_network_monthly` en `ads_schedule_monthly` bestaan wel maar zijn LEEG -- device en doelgroep
 * vragen dus een sync-uitbreiding, geen extra tabblad. Een knop die op nul rijen uitkomt belooft
 * data die er niet is, en dat is precies wat de kanaalkiezer elders al niet meer doet
 * (lib/kanalen/beschikbaar.ts).
 */
const UITSPLITSINGEN = [
  { key: "type", label: "Campagnetype", meervoud: "campagnetypes", titel: "Spend per campagnetype" },
  { key: "campagne", label: "Campagne", meervoud: "campagnes", titel: "Spend per campagne" },
  { key: "kanaal", label: "Kanaal", meervoud: "kanalen", titel: "Spend per kanaal" },
] as const;
type Uitsplitsing = (typeof UITSPLITSINGEN)[number]["key"];

/**
 * Hoe een sleutel van de gekozen uitsplitsing op het scherm heet.
 *
 * Campagnenamen komen letterlijk uit het account en hebben dus geen vertaaltabel -- die geven we
 * ongewijzigd terug in plaats van ze door TYPE_LABEL te halen, want dat zou stilzwijgend "SEARCH"
 * van een campagne die toevallig zo heet omzetten naar "Search" en daarmee twee verschillende
 * dingen op één regel laten lijken.
 */
function labelVoor(u: Uitsplitsing, sleutel: string): string {
  if (u === "type") return typeLabel(sleutel);
  if (u === "kanaal") return KANAAL_LABEL_BLENDED[sleutel] ?? sleutel;
  return sleutel;
}

/**
 * Wanneer twee rijen hetzelfde segment zijn.
 *
 * buildNetworkSplit normaliseert standaard naar HOOFDLETTERS, en dat is goed voor enum-achtige
 * sleutels (campagnetype, kanaal) maar verkeerd voor campagnenamen: "GRT | Search | NL" kwam er
 * als "GRT | SEARCH | NL" uit -- de naam zoals hij in het account staat is dan niet meer
 * terug te vinden. Namen normaliseren daarom alleen op witruimte.
 */
function normaliseer(u: Uitsplitsing, sleutel: string): string {
  if (u === "campagne") return (sleutel || "Onbekende campagne").trim();
  return (sleutel || "onbekend").toLowerCase();
}

/**
 * @param toon Welke uitsplitsingen deze kaart aanbiedt; de eerste is het starttabblad.
 *   Standaard alle drie -- dat is de Google-weergave. "Alle kanalen" geeft alleen `["kanaal"]`
 *   mee: campagnetype en campagnenaam komen uit `ads_campaign_monthly` en die tabel kent enkel
 *   Google-campagnes, dus daar zouden die twee tabbladen een Google-verdeling tonen onder een kop
 *   die alle kanalen belooft. Bij één uitsplitsing verdwijnt de kiezer, want er valt niets te
 *   kiezen.
 */
export function CampaignTypeSplit({ clientId, toon = UITSPLITSINGEN.map((u) => u.key) }: {
  clientId: string;
  toon?: readonly Uitsplitsing[];
}) {
  const keuzes = UITSPLITSINGEN.filter((u) => toon.includes(u.key));
  const start = keuzes[0]?.key ?? "type";
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [uitsplitsing, setUitsplitsing] = useState<Uitsplitsing>(start);
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
    setRows(null);

    // Kanaal komt uit een ANDERE tabel dan campagnetype en campagne. blended_account_monthly is de
    // enige bron die Meta en LinkedIn naast Google zet; ads_campaign_monthly kent per definitie
    // alleen Google-campagnes en zou dus een "kanaalverdeling" van 100% Google opleveren -- een
    // ring die klopt en niets zegt.
    if (uitsplitsing === "kanaal") {
      dbSelect<BlendedMonthlyRow>("blended_account_monthly", {
        select: "channel, spend, conversions, conversion_value, impressions, clicks",
        clientId, filters: [{ op: "gte", column: "month", value: since.slice(0, 8) + "01" }],
      }).then(({ data }) => {
        if (cancelled) return;
        setRows(data.map((r) => ({
          networkType: r.channel ?? "onbekend",
          cost: Number(r.spend ?? 0),
          conversions: Number(r.conversions ?? 0),
          conversionsValue: Number(r.conversion_value ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
        })));
      }, () => { if (!cancelled) setRows([]); });
      return () => { cancelled = true; };
    }

    dbSelect<CampaignMonthlyRow>("ads_campaign_monthly", {
      select: "campaign_type, campaign_name, cost, conversions, conversions_value, impressions, clicks",
      clientId, filters: [{ op: "gte", column: "month", value: since }],
    }).then(({ data }) => {
      if (cancelled) return;
      setRows(data.map((r) => ({
        networkType: uitsplitsing === "campagne"
          ? (r.campaign_name ?? "Onbekende campagne")
          : (r.campaign_type ?? "ONBEKEND"),
        cost: Number(r.cost ?? 0),
        conversions: Number(r.conversions ?? 0),
        conversionsValue: Number(r.conversions_value ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
      })));
    }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId, uitsplitsing]);

  useEffect(() => { setSelected(null); }, [clientId, uitsplitsing]);

  const actief = UITSPLITSINGEN.find((u) => u.key === uitsplitsing) ?? UITSPLITSINGEN[0];
  const opStart = uitsplitsing === start;
  const slices = useMemo(
    () => (rows
      ? buildNetworkSplit(rows, {
          labelOf: (k) => labelVoor(uitsplitsing, k),
          normalizeKey: (k) => normaliseer(uitsplitsing, k),
        })
      : []),
    [rows, uitsplitsing],
  );
  const totals = useMemo(() => networkTotals(slices), [slices]);
  const order = useMemo(() => slices.map((s) => s.networkType), [slices]);

  const costSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: colorFor(uitsplitsing, s.networkType, order) }));

  const leeg = rows !== null && (slices.length === 0 || totals.cost <= 0);

  // Geen campagnedata deze periode: niets tonen in plaats van een lege ring. Alleen op het
  // START-tabblad -- staat de gebruiker op "Kanaal" of "Campagne" en levert dat niets op, dan
  // moet de kaart BLIJVEN staan met een uitleg, anders verdwijnen de tabbladen mee en kan hij
  // niet terug naar het tabblad dat wel data had.
  if (rows === null && opStart) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel={keuzes[0]?.titel ?? UITSPLITSINGEN[0].titel} />;
  }
  if (leeg && opStart) return null;

  const kop = (
    <div className="border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PieChart className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">{actief.titel}</h3>
        <span className="text-meta text-muted-foreground">laatste 90 dagen</span>
      </div>
      {/* De uitsplitsingskiezer. Radiogroup en geen tabs-rol: er is één paneel eronder dat van
          inhoud wisselt, niet drie panelen waarvan er één zichtbaar is. Bij één keuze helemaal
          weg: een radiogroep met één knop die altijd aan staat is geen keuze maar een label. */}
      {keuzes.length > 1 && (
      <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Uitsplitsing">
        {keuzes.map((u) => {
          const aan = u.key === uitsplitsing;
          return (
            <button
              key={u.key}
              type="button"
              role="radio"
              aria-checked={aan}
              onClick={() => setUitsplitsing(u.key)}
              className={`rounded-full px-2.5 py-1 text-meta font-medium transition-colors ${
                aan
                  ? "bg-brand-blue/10 text-brand-blue-ink"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-brand-gray"
              }`}
            >
              {u.label}
            </button>
          );
        })}
      </div>
      )}
    </div>
  );

  if (rows === null || leeg) {
    return (
      <div className="bg-card overflow-hidden rounded-xl border border-border shadow-sm">
        {kop}
        <p className="px-5 py-8 text-center text-meta text-muted-foreground">
          {rows === null
            ? "Bezig met laden…"
            : `Voor deze klant staat er in de laatste 90 dagen geen verdeling per ${actief.label.toLowerCase()} in het systeem.`}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {kop}

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
                ariaLabel={`Kostenverdeling over ${actief.meervoud}: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
                selected={selected}
                onSliceClick={toggleSelected}
              />
              <figcaption className="text-meta font-medium text-brand-gray">Kosten</figcaption>
            </figure>

            {totals.hasConversions && (
              <figure className="flex flex-col items-center gap-2">
                <DonutChart
                  slices={slices.map((s) => ({ key: s.networkType, label: s.label, value: s.conversions, color: colorFor(uitsplitsing, s.networkType, order) }))}
                  centerValue={num(totals.conversions, 1)}
                  centerLabel="conversies"
                  format={(v) => num(v, 1)}
                  ariaLabel={`Conversieverdeling over ${actief.meervoud}: ${slices.map((s) => `${s.label} ${pct(s.conversionShare)}`).join(", ")}`}
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
              const kleur = colorFor(uitsplitsing, s.networkType, order);
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
              Gefilterd op {labelVoor(uitsplitsing, selected)}
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
            Er zijn in dit venster geen conversies per {actief.label.toLowerCase()} geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="campagnetype-tabel"
        label={`de cijfers per ${actief.label.toLowerCase()} (${slices.length})`}
      />
      <div id="campagnetype-tabel" hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>{actief.label}</KolomKop>
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
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorFor(uitsplitsing, s.networkType, order) }} aria-hidden />
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
            <TotaalCel>Alle {actief.meervoud}</TotaalCel>
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
