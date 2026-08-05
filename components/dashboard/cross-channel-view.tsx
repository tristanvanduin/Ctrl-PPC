"use client";

import { useState, useEffect, useMemo } from "react";
import { Globe, Info, Layers, Loader2, TrendingUp, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GroupedMonthlyBars } from "./monthly-trend-chart";
import { blendedReliability } from "@/lib/cross-channel/measurement-reliability";
import type { ChannelKey } from "@/lib/cross-channel/lens-facts";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { RegioToggle, useRememberedOpen } from "@/components/ui/disclosure";
import { maandLabel } from "./chart-chrome";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { Sectie } from "@/components/ui/sectie";
import { GeoBreakdown } from "./geo-breakdown";

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

export function CrossChannelView({ clientId }: { clientId: string }) {
  const [maandenOpen, toggleMaanden] = useRememberedOpen("cross-maanden", false);
  const [rows, setRows] = useState<BlendedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    sb.from("blended_account_monthly")
      .select("month, channel, currency, impressions, clicks, spend, conversions, conversion_value, leads")
      .eq("client_id", clientId)
      .order("month", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setRows((data ?? []) as BlendedRow[]);
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
      {/* Dezelfde sectie-indeling als de Google-weergave. Deze tak van de pagina stond nog op een
          vlakke `space-y-6`: de grafiek en de tabel eronder hadden evenveel lucht tussen zich als
          binnen zichzelf, terwijl het twee antwoorden op twee vragen zijn — "hoe verhouden de
          kanalen zich over de maanden" en "wat leverde elk kanaal op". */}
      {rows && rows.length > 0 && (
        <Sectie
          eerste
          icoon={<TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />}
          titel="Verdeling over de kanalen"
          bijschrift="Spend per kanaal per maand — welk kanaal draagt welk deel van het budget"
        >
          <GroupedMonthlyBars title="Spend per kanaal per maand" months={chartMonths} series={chartSeries} data={chartData} />
        </Sectie>
      )}

      {/* Data-weergave; de cross-channel-signaalanalyse draait via Analyses → Cross-channel. */}
      <Sectie
        icoon={<Layers className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Cross-channel (blended)"
        bijschrift="Wat elk kanaal opleverde, en de maanden erachter"
        eerste={!(rows && rows.length > 0)}
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

            return (
              <>
                <Tabel>
                  <Kop>
                    <KolomKop breed>Kanaal</KolomKop>
                    <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
                    <KolomKop getal>Klikken</KolomKop>
                    <KolomKop getal bijschrift="aandeel">Conversies</KolomKop>
                    <KolomKop getal>Conv.waarde</KolomKop>
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
                        <GetalCel zacht>{a.waarde > 0 ? eur(a.waarde) : "—"}</GetalCel>
                        <GetalCel zacht>{a.conversions > 0 ? eur(a.spend / a.conversions) : "—"}</GetalCel>
                      </Rij>
                    ))}
                  </Body>
                  <TotaalRij>
                    <TotaalCel>Totaal ({chartMonths.length} maanden)</TotaalCel>
                    <TotaalCel getal>{eur(tot.spend)}</TotaalCel>
                    <TotaalCel getal>{fmt(tot.clicks)}</TotaalCel>
                    <TotaalCel getal>{fmt(tot.conversions)}</TotaalCel>
                    <TotaalCel getal>{tot.waarde > 0 ? eur(tot.waarde) : "—"}</TotaalCel>
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
                      <KolomKop breed>Kanaal</KolomKop>
                      <KolomKop getal>Spend</KolomKop>
                      <KolomKop getal>Klikken</KolomKop>
                      <KolomKop getal>Conversies</KolomKop>
                      <KolomKop getal>Conv.waarde</KolomKop>
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
                            <GetalCel zacht>{eur(r.conversion_value)}</GetalCel>
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
            {betrouwbaarheid && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-meta leading-snug text-amber-900">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  Dubbeltelling
                </p>
                Over de laatste {chartMonths.length} maanden claimen de kanalen samen{" "}
                <strong>{fmt(betrouwbaarheid.blendedSum)} conversies</strong>. {betrouwbaarheid.detail}
              </div>
            )}
            <div className="rounded-lg border border-border bg-gray-50/70 px-4 py-3 text-meta leading-snug text-muted-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-rm-gray">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Waarom &quot;blended&quot; indicatief is
              </p>
              Elk kanaal meet zijn eigen attributie, dus de som is geen exacte verdeling. Bedragen
              alleen optellen over kanalen met gelijke valuta.
            </div>
          </aside>
        </div>
      </div>
      </Sectie>

      {/* De wereldkaart stond op het Campagnes-tabblad, en alleen bij Alle kanalen. Op Google,
          Meta en LinkedIn stond hij op Overzicht — dezelfde vraag, drie tabbladen verderop.
          "Waar komt het vandaan" is een overzichtsvraag, dus hier hoort hij. */}
      <Sectie
        icoon={<Globe className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Markten"
        bijschrift="Waar het verkeer en de conversies vandaan komen, over alle kanalen samen"
      >
        <GeoBreakdown clientId={clientId} channel="blended" />
      </Sectie>
    </div>
  );
}
