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
// ── WAAROM HIJ NIET MEEGROEIT MET HET ACCOUNT ───────────────────────────────
//
// Een account kan tientallen assetgroepen hebben, verdeeld over meerdere PMax-campagnes. De eerste
// versie mapte over allemaal: bij twintig groepen werd dit blok ruim 1800 pixels hoog naast een
// PMax-kaart van 859 -- precies het gat dat we net gedicht hadden, dan andersom.
//
// Drie grenzen houden hem klein, en ze zijn alle drie inhoudelijk en niet cosmetisch:
//
//   1. Alleen groepen die iets MISSEN of zwakke assets hebben komen in de lijst. Een complete
//      groep vraagt niets van je, dus die hoeft er niet te staan.
//   2. De complete groepen worden geteld en niet opgesomd. "Zeven compleet" zegt alles wat je
//      over zeven groepen zonder probleem hoeft te weten.
//   3. Vraagt er toch een handvol aandacht, dan staan er vier en de rest achter een knop MET het
//      aantal erop -- "meer tonen" zonder getal laat je klikken om erachter te komen of het de
//      moeite is.
//
// De uitleg over WAT er telt (waarom een ontbrekende video zwaarder weegt dan een ontbrekende
// afbeelding, en waarom PENDING geen zwak is) staat in lib/pmax/assetdekking.ts.

import { useEffect, useMemo, useState } from "react";
import { Layers, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useTruncatedList, MeerKnop } from "@/components/ui/disclosure";
import {
  analyseerAssetdekking, TYPE_LABEL, VERWACHTE_TYPES, type AssetRegel, type Typedekking,
} from "@/lib/pmax/assetdekking";

/**
 * Hoeveel groepen er standaard zichtbaar zijn.
 *
 * Vier past naast de PMax-kaart zonder de rij uit te rekken, en meer dan vier problemen tegelijk
 * pak je toch niet op één dag aan.
 */
const ZICHTBAAR = 4;

/** De kolomindeling, op één plek zodat de kop en de rijen niet uit elkaar kunnen lopen. */
const KOLOMMEN = "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] gap-x-3";

/**
 * Eén cel in de matrix: hoeveel assets van dit type, en of er zwakke bij zitten.
 *
 * Hiervoor was dit een omkaderd blok met het type-label erin, drie per groep. Dat is veel chroom
 * voor drie getallen, en bij tien groepen dertig kaders. Nu staat het type één keer als kolomkop
 * en is de cel alleen nog het getal: een derde van de hoogte, en sneller te scannen omdat je oog
 * de kolom afloopt in plaats van elk blok apart te lezen.
 */
function Typecel({ dekking }: { dekking: Typedekking }) {
  const ontbreekt = dekking.aantal === 0;
  // Alleen een ontbrekende VIDEO krijgt de aandachtskleur. Tekst en beeld zijn verplicht bij het
  // aanmaken van een groep, dus die ontbreken in de praktijk niet.
  const opvallend = ontbreekt && dekking.type === "YOUTUBE_VIDEO";
  return (
    <div className="flex items-baseline justify-end gap-1.5 tabular-nums">
      <span
        className={
          opvallend ? "text-sm font-bold text-amber-700"
            : ontbreekt ? "text-sm text-muted-foreground"
            : "text-sm font-semibold text-rm-gray"
        }
      >
        {ontbreekt ? "geen" : dekking.aantal}
      </span>
      {/* Zwak en onbeoordeeld staan apart en niet op één hoop: "we weten het nog niet" is geen
          slecht oordeel. Zie de kop van lib/pmax/assetdekking.ts. */}
      {dekking.zwak > 0 && (
        <span className="text-micro font-medium text-red-600" title={`${dekking.zwak} met het label laag`}>
          {dekking.zwak}&darr;
        </span>
      )}
      {dekking.zwak === 0 && dekking.onbeoordeeld > 0 && (
        <span className="text-micro text-muted-foreground" title={`${dekking.onbeoordeeld} nog niet beoordeeld door Google`}>
          {dekking.onbeoordeeld}?
        </span>
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
  // Vóór de vroege returns: React vereist dat hooks bij elke render in dezelfde volgorde draaien,
  // en een return ertussen breekt dat op het moment dat de data binnenkomt.
  const lijst = useTruncatedList(dekking?.aandacht ?? [], ZICHTBAAR);

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

      {lijst.zichtbaar.length > 0 && (
        <>
          <div className={`${KOLOMMEN} border-b border-border px-5 py-1.5`}>
            <span />
            {VERWACHTE_TYPES.map((t) => (
              <span key={t} className="text-right text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                {TYPE_LABEL[t]}
              </span>
            ))}
          </div>
          <div className="divide-y divide-border">
            {lijst.zichtbaar.map((g) => (
              <div key={g.groep} className={`${KOLOMMEN} items-baseline px-5 py-2.5`}>
                <span className="truncate text-body text-rm-gray" title={g.groep}>{g.groep}</span>
                {g.perType.map((t) => <Typecel key={t.type} dekking={t} />)}
              </div>
            ))}
          </div>
          <MeerKnop
            verborgen={lijst.verborgen}
            uitgeklapt={lijst.uitgeklapt}
            onToggle={lijst.toggle}
            eenheid="groepen"
          />
        </>
      )}

      {/* De complete groepen als één regel. Ze opsommen zou de lijst verdubbelen met rijen waar
          niets aan te doen valt; het aantal is alles wat je erover hoeft te weten. */}
      {dekking.compleet > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border px-5 py-2.5 text-meta text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
          {dekking.compleet} groep{dekking.compleet === 1 ? "" : "en"} compleet — tekst, beeld en video aanwezig
        </p>
      )}
    </div>
  );
}
