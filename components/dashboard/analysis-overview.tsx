"use client";

import { useEffect, useState } from "react";
import { Radar, CheckCircle2, Circle } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import {
  ANALYSE_CATALOGUS,
  KANAAL_LABEL,
  groepeerOpStatus,
  type AnalyseKanaal,
  type AnalyseStatus,
} from "@/lib/analysis/analysis-catalog";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useTruncatedList, MeerKnop } from "@/components/ui/disclosure";

/**
 * Hoeveel niet-gedraaide analyses er standaard staan.
 *
 * Vijf is genoeg om te laten zien wat er klaarstaat; twintig maakt van een voorraadlijst het
 * langste blok op de pagina, zonder één uitkomst te tonen.
 */
const OPEN_ZICHTBAAR = 5;

// Wat kan ik hier draaien, en wat heb ik al gedraaid?
//
// Die twee vragen waren nergens te beantwoorden. De analyses stonden als losse kaarten onder de
// kanaaltabbladen, en "Alle kanalen" — het tabblad waar je op binnenkomt — toonde er precies
// één. Dat leest als een leeg product terwijl er twintig analyses klaarstaan.
//
// Uitgevoerde analyses staan bovenaan, recentste eerst: dat is de lijst waar je iets aan hebt.
// Wat nog niet gedraaid heeft blijft eronder staan en verdwijnt niet — juist die lijst laat
// zien wat er nog te halen valt.

function Regel({ a, onKies }: { a: AnalyseStatus; onKies?: (k: AnalyseKanaal) => void }) {
  const gedraaid = a.laatst !== null;
  return (
    <button
      type="button"
      onClick={() => onKies?.(a.kanaal)}
      className="w-full px-5 py-2 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
    >
      {gedraaid
        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        : <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="text-body font-medium text-rm-gray">{a.titel}</span>
        <span className="block text-micro text-muted-foreground truncate">{a.waarover}</span>
      </span>
      <span className="text-micro font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
        {KANAAL_LABEL[a.kanaal]}
      </span>
      <span className="text-micro text-muted-foreground w-24 text-right shrink-0">
        {a.laatst ?? "nog niet"}
      </span>
    </button>
  );
}

export function AnalysisOverview({
  clientId,
  onKiesKanaal,
}: {
  clientId: string;
  /** Klik op een regel springt naar het kanaaltabblad waar die analyse te draaien is. */
  onKiesKanaal?: (kanaal: AnalyseKanaal) => void;
}) {
  const [runs, setRuns] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    // Eén query voor alle twintig analyses, begrensd op de secties uit de catalogus. Het
    // alternatief — elke kaart haalt zijn eigen laatste run op — was twintig requests voor
    // twintig datums.
    dbSelect<{ section: string; analysis_date: string | null }>("sop_analysis_output", {
      select: "section, analysis_date", clientId,
      filters: [{ op: "in", column: "section", values: ANALYSE_CATALOGUS.map((a) => a.section) }],
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setRuns(new Map()); return; }
      const laatste = new Map<string, string>();
      for (const r of data) {
        if (!r.analysis_date) continue;
        const huidig = laatste.get(r.section);
        if (!huidig || r.analysis_date > huidig) laatste.set(r.section, r.analysis_date);
      }
      setRuns(laatste);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  // Groeperen en de inkorting VÓÓR de vroege return. Een hook onder een `return` draait niet bij
  // elke render, en dan klapt React eruit op het moment dat de data binnenkomt -- precies de
  // volgorde die je in de demo pas ziet, niet in tsc. Bij runs === null is de kaart een laadvlak
  // en zijn deze twee onschadelijk.
  const { uitgevoerd, open } = groepeerOpStatus(runs ?? new Map());
  const openLijst = useTruncatedList(open, OPEN_ZICHTBAAR);

  if (runs === null) {
    return <Laadvlak vorm="kaartjes" regels={6} />;
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Radar className="w-4.5 h-4.5 text-rm-blue-ink" />
        <div className="flex-1">
          <h3 className="text-title font-semibold text-rm-gray">Alle analyses</h3>
          <p className="text-micro text-muted-foreground mt-0.5">
            {uitgevoerd.length} van {ANALYSE_CATALOGUS.length} gedraaid · klik een regel om naar het kanaal te gaan waar hij staat
          </p>
        </div>
      </div>

      {uitgevoerd.length > 0 && (
        <>
          <div className="px-5 py-1.5 bg-gray-50/70 border-b border-border">
            <span className="text-micro font-semibold text-rm-blue-ink uppercase tracking-wide">Uitgevoerd</span>
          </div>
          <div className="divide-y divide-border/50">
            {uitgevoerd.map((a) => <Regel key={a.section} a={a} onKies={onKiesKanaal} />)}
          </div>
        </>
      )}

      {/* INGEKORT, en alleen deze helft.
          Wat GEDRAAID is, is de oogst -- die staat er voluit. Wat nog niet gedraaid is, is een
          voorraadlijst, en bij een verse klant staan daar alle twintig regels in. Dat is precies
          wat je in de demo zag: twintig keer "nog niet", en de kaart werd het langste blok op de
          pagina zonder één uitkomst te tonen.
          Vijf en de rest achter een knop mét het aantal -- hetzelfde patroon als bij de
          assetdekking. "Meer tonen" zonder getal laat je klikken om erachter te komen of het de
          moeite is. */}
      {open.length > 0 && (
        <>
          <div className="px-5 py-1.5 bg-gray-50/70 border-y border-border">
            <span className="text-micro font-semibold text-muted-foreground uppercase tracking-wide">Nog niet gedraaid</span>
          </div>
          <div className="divide-y divide-border/50">
            {openLijst.zichtbaar.map((a) => <Regel key={a.section} a={a} onKies={onKiesKanaal} />)}
          </div>
          <MeerKnop
            verborgen={openLijst.verborgen}
            uitgeklapt={openLijst.uitgeklapt}
            onToggle={openLijst.toggle}
            eenheid="analyses"
          />
        </>
      )}
    </div>
  );
}
