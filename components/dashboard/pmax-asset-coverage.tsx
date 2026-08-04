"use client";

// Assetdekking per PMax-assetgroep: wat heb je aangeleverd, en wat vindt Google ervan?
//
// ── WAAROM DEZE KAART BESTAAT ───────────────────────────────────────────────
//
// De netwerkkaart ernaast zegt dat de kanaalverdeling geen knop is en dat je eromheen stuurt, met
// assets als eerste lever. Die assets stonden vervolgens nergens op het scherm. Een kaart die een
// knop noemt en hem niet laat zien, is dezelfde soort dode verwijzing als een tabblad dat niet
// bestaat.
//
// De uitleg over WAT er telt (waarom een ontbrekende video zwaarder weegt dan een ontbrekende
// afbeelding, en waarom PENDING geen zwak is) staat in lib/pmax/assetdekking.ts. Dit bestand
// tekent alleen.

import { useEffect, useMemo, useState } from "react";
import { Layers, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Laadvlak } from "@/components/ui/laadvlak";
import {
  analyseerAssetdekking, TYPE_LABEL, type AssetRegel, type Typedekking,
} from "@/lib/pmax/assetdekking";

/** Eén type binnen een groep: hoeveel, en hoe ze beoordeeld zijn. */
function Typecel({ dekking }: { dekking: Typedekking }) {
  const ontbreekt = dekking.aantal === 0;
  const video = dekking.type === "YOUTUBE_VIDEO";
  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 ${
        // Alleen een ontbrekende VIDEO krijgt de aandachtskleur. Tekst en beeld zijn verplicht bij
        // het aanmaken van een groep, dus die ontbreken in de praktijk niet -- en als het toch
        // gebeurt is het geen keuze maar een storing, en dan zegt het aantal van nul genoeg.
        ontbreekt && video
          ? "border-amber-200 bg-amber-50"
          : "border-border bg-muted/40"
      }`}
    >
      <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {TYPE_LABEL[dekking.type]}
      </p>
      <p className={`text-sm font-bold ${ontbreekt && video ? "text-amber-700" : "text-rm-gray"}`}>
        {dekking.aantal === 0 ? "geen" : dekking.aantal}
      </p>
      {/* Zwak en onbeoordeeld staan apart. Ze op één hoop gooien zou "we weten het nog niet"
          als een slecht oordeel laten lezen. */}
      {dekking.zwak > 0 && (
        <p className="text-micro text-red-600">{dekking.zwak}× laag</p>
      )}
      {dekking.zwak === 0 && dekking.onbeoordeeld > 0 && (
        <p className="text-micro text-muted-foreground">{dekking.onbeoordeeld}× nog geen oordeel</p>
      )}
    </div>
  );
}

export function PmaxAssetCoverage({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<AssetRegel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase;
    if (!sb) { setRows([]); return; }
    // Zelfde venster als de netwerkkaart ernaast: anders gaan twee kaarten over dezelfde campagne
    // over een andere periode, en dan spreken ze elkaar tegen zonder dat iemand ziet waarom.
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    sb.from("ads_pmax_asset_performance")
      .select("asset_group_name, asset_id, asset_type, performance_label, month")
      .eq("client_id", clientId)
      .gte("month", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        setRows((data ?? []) as AssetRegel[]);
      }, () => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [clientId]);

  const dekking = useMemo(() => (rows ? analyseerAssetdekking(rows) : null), [rows]);

  if (rows === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel="Assets per groep" />;
  }
  // Geen assetgroepen: geen PMax, of nog niet gesynct. Dan hoort deze kaart er niet te staan --
  // een leeg blok met een kop is erger dan geen blok.
  if (!dekking || dekking.groepen.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Layers className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">Assets per groep</h3>
        <span className="text-meta text-muted-foreground">de eerste knop waarmee je PMax stuurt</span>
        <span className="ml-auto text-micro text-muted-foreground">
          {dekking.groepen.length} groep{dekking.groepen.length === 1 ? "" : "en"}
        </span>
      </div>

      {/* De melding alleen als er iets te melden is. Een blok dat altijd een zin toont leert de
          lezer die zin over te slaan, en dan mist hij hem op de dag dat er wél iets is. */}
      {dekking.samenvatting && (
        <div className="flex items-start gap-2 border-b border-border bg-amber-50/60 px-5 py-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-meta leading-snug text-amber-900">{dekking.samenvatting}</p>
        </div>
      )}

      <div className="divide-y divide-border">
        {dekking.groepen.map((g) => (
          <div key={g.groep} className="px-5 py-3">
            <p className="mb-2 truncate text-body font-medium text-rm-gray">{g.groep}</p>
            <div className="grid grid-cols-3 gap-2">
              {g.perType.map((t) => <Typecel key={t.type} dekking={t} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
