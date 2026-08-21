"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, ExternalLink } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { isDemoClient } from "@/lib/demo/demo-mode";
import { DEMO_PLACEMENTS } from "@/lib/demo/video-demo";
import {
  aggregatePlacements, judgePlacements, wastedSpend, placementTypeLabel,
  type PlacementInput, type PlacementVerdict,
} from "@/lib/video/placement-analysis";
import { useTruncatedList, MeerKnop } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";

// Waar het videobudget landde, met een voorstel welke placements uit te sluiten. Bij YouTube kiest
// Google de plek; dit maakt zichtbaar wat dat oplevert. Bewust een voorstel met onderbouwing en
// geen knop die het meteen doet — uitsluiten is in zijn effect lastig terug te draaien.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);

const VERDICT_LABEL: Record<PlacementVerdict, string> = {
  uitsluiten: "Uitsluiten",
  bekijken: "Bekijken",
  houden: "Houden",
  te_weinig_data: "Te weinig data",
};

const VERDICT_STYLE: Record<PlacementVerdict, string> = {
  uitsluiten: "bg-red-50 text-red-800 border-red-200",
  bekijken: "bg-amber-50 text-amber-800 border-amber-200",
  houden: "bg-emerald-50 text-emerald-800 border-emerald-200",
  te_weinig_data: "bg-slate-50 text-muted-foreground border-slate-200",
};

// Volgorde waarin de tabel leest: eerst waar actie op zit.
const VERDICT_ORDER: PlacementVerdict[] = ["uitsluiten", "bekijken", "houden", "te_weinig_data"];

export function VideoPlacements({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<PlacementInput[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemoClient(clientId)) { setRows(DEMO_PLACEMENTS); return; }

    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    dbSelect<Record<string, unknown>>("ads_video_placements", {
      select: "placement, display_name, placement_type, target_url, campaign_name, impressions, clicks, cost, conversions, video_views, metrics_complete, source",
      clientId,
      filters: [{ op: "gte", column: "month", value: since }],
    })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data ?? []).map((r) => ({
          placement: String(r.placement ?? ""),
          displayName: String(r.display_name ?? ""),
          placementType: String(r.placement_type ?? "UNKNOWN"),
          targetUrl: String(r.target_url ?? ""),
          campaignName: String(r.campaign_name ?? ""),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          cost: Number(r.cost ?? 0),
          conversions: Number(r.conversions ?? 0),
          videoViews: Number(r.video_views ?? 0),
          metricsComplete: r.metrics_complete !== false,
          source: (r.source === "pmax" ? "pmax" : "video") as "video" | "pmax",
        })));
      });

    return () => { cancelled = true; };
  }, [clientId]);

  const judged = useMemo(() => {
    if (!rows) return [];
    return judgePlacements(aggregatePlacements(rows))
      .sort((a, b) => {
        const d = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
        return d !== 0 ? d : b.agg.cost - a.agg.cost;
      });
  }, [rows]);

  // De sortering zet de uit te sluiten placements bovenaan, dus de eerste drie regels zijn
  // precies waar actie op zit. De rest is naslag en hoeft de pagina niet te verlengen —
  // een account met tweehonderd placements duwde alles eronder buiten beeld.
  const lijst = useTruncatedList(judged, 3);

  const waste = useMemo(() => wastedSpend(judged), [judged]);
  // De schaal van de aandeelstreep komt uit de volledige lijst en niet uit de zichtbare drie: een
  // schaal die verspringt zodra je uitklapt maakt de streep onvergelijkbaar met wat je net zag.
  const duursteKosten = useMemo(
    () => Math.max(0, ...judged.filter((j) => j.agg.metricsComplete).map((j) => j.agg.cost)),
    [judged],
  );
  const excluding = judged.filter((j) => j.verdict === "uitsluiten");
  // Gescheiden tellen: van PMax-placements kent Google de kosten niet, dus die mogen niet
  // meegeteld worden in een bedrag. Ze wel meetellen zou het bedrag te laag of te stellig maken.
  const withCost = excluding.filter((j) => j.agg.metricsComplete);
  const impressionsOnly = excluding.filter((j) => !j.agg.metricsComplete);

  if (rows === null) {
    return <Laadvlak vorm="tabel" regels={3} titel="Waar je video&apos;s draaien" />;
  }
  if (judged.length === 0) return null; // geen videoplacements: niets te tonen

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Ban className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Waar je video&apos;s draaien</h3>
        <span className="text-meta text-muted-foreground">voorstel welke placements uit te sluiten</span>
      </div>

      {excluding.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-red-50/50 space-y-1">
          {withCost.length > 0 && (
            <p className="text-body text-brand-gray">
              <strong>{withCost.length} placement{withCost.length === 1 ? "" : "s"}</strong> kostte{withCost.length === 1 ? "" : "n"} samen{" "}
              <strong>{eur(waste)}</strong> zonder één conversie. Uitsluiten geeft dat budget terug aan de plekken die wél werken.
            </p>
          )}
          {impressionsOnly.length > 0 && (
            <p className="text-body text-brand-gray">
              Daarnaast {impressionsOnly.length === 1 ? "staat er 1 plaatsing" : `staan er ${impressionsOnly.length} plaatsingen`} uit{" "}
              <strong>Performance Max</strong> met samen {int(impressionsOnly.reduce((s, j) => s + j.agg.impressions, 0))} vertoningen.
              Google geeft daar geen kosten of conversies bij, dus wat die precies kosten is niet te zeggen.
            </p>
          )}
          <p className="text-meta text-muted-foreground">
            Uit te sluiten in Google Ads via de campagne → Content → Uitsluitingen; voor Performance Max
            alleen accountbreed. Dit dashboard doet het niet automatisch: eenmaal uitgesloten leer je
            niets meer over die plek.
          </p>
        </div>
      )}

      <Tabel>
        <Kop>
          <KolomKop breed>Placement</KolomKop>
          <KolomKop>Type</KolomKop>
          <KolomKop getal>Vertoningen</KolomKop>
          <KolomKop getal bijschrift="aandeel">Kosten</KolomKop>
          <KolomKop getal>Views</KolomKop>
          <KolomKop getal>Klikken</KolomKop>
          <KolomKop getal>Conv.</KolomKop>
          <KolomKop getal>CPA</KolomKop>
          <KolomKop>Advies</KolomKop>
        </Kop>
        <Body>
          {lijst.zichtbaar.map(({ agg, verdict, reason }) => (
            <Rij key={agg.placement}>
              <NaamCel sub={reason}>
                <span className="flex items-center gap-1">
                  {agg.displayName || agg.placement}
                  {agg.targetUrl && (
                    <a href={agg.targetUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-brand-blue-ink shrink-0">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              </NaamCel>
              <Cel zacht nowrap>
                {placementTypeLabel(agg.placementType)}
                {agg.sources.includes("pmax") && <span className="block text-micro text-muted-foreground">via PMax</span>}
              </Cel>
              <GetalCel>{int(agg.impressions)}</GetalCel>
              {/* De streep staat op kosten en niet op vertoningen: de vraag hier is waar het geld
                  heen ging, niet waar het bereik zat. Placements uit Performance Max krijgen geen
                  streep — Google geeft daar geen kosten bij, en een streep van nul zou als
                  "kostte niets" lezen terwijl het "onbekend" is. */}
              {agg.metricsComplete ? (
                <AandeelCel waarde={eur(agg.cost)} aandeel={duursteKosten > 0 ? agg.cost / duursteKosten : 0} />
              ) : (
                <GetalCel zacht>
                  <span title="Performance Max levert geen kosten per placement">onbekend</span>
                </GetalCel>
              )}
              <GetalCel>{agg.metricsComplete ? int(agg.videoViews) : "—"}</GetalCel>
              <GetalCel>{agg.metricsComplete ? int(agg.clicks) : "—"}</GetalCel>
              <GetalCel>{!agg.metricsComplete ? "—" : agg.conversions === 0 ? "—" : int(agg.conversions)}</GetalCel>
              <GetalCel zacht>{agg.cpa == null ? "—" : eur(agg.cpa)}</GetalCel>
              <Cel>
                <span className={`inline-block rounded-md border px-1.5 py-0.5 text-micro font-medium whitespace-nowrap ${VERDICT_STYLE[verdict]}`}>
                  {VERDICT_LABEL[verdict]}
                </span>
              </Cel>
            </Rij>
          ))}
        </Body>
        {/* Geen totaalrij: de lijst staat standaard ingeklapt op drie regels, en een som onder een
            afgekapte lijst telt iets anders op dan wat je ziet. Het bedrag dat er wél toe doet —
            de verspilling — staat hierboven, en dat is over álle placements gerekend. */}
      </Tabel>
      <MeerKnop
        verborgen={lijst.verborgen}
        uitgeklapt={lijst.uitgeklapt}
        onToggle={lijst.toggle}
        eenheid="placements"
      />
    </div>
  );
}
