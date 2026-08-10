"use client";

import { useEffect, useState } from "react";
import { Loader2, Building2 } from "lucide-react";
import { Counter } from "@/components/ui/counter";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "@/components/dashboard/data-table";
import { segmentLabel, magAlsTrendGelden, MIN_ACCOUNTS_VOOR_TREND } from "@/lib/macro/types";

// Fase 5, Task 3: Agency God View -- geaggregeerde macro-data en de eigen portfolio, voor
// performance_marketeer (organisatiebreed maar bureau-gescoped, zie lib/auth/scope.ts). Leunt op
// /api/platform/agency-macrotrends (NIET /api/admin/macrotrends -- die vergt user:manage via de
// middleware, en performance_marketeer heeft dat recht niet; zie de kop van die route voor de
// volledige toelichting). De route beperkt hard tot de eigen bureaus van de aanroeper, dus deze
// view vraagt nooit expliciet een agencyId op. Geen k-anonimiteit nodig (dat is voor CROSS-agency
// vergelijken, lib/benchmark/cel.ts): dit is één bureau dat zijn eigen data ziet, precies zoals
// MacroTrendsPreview dat ook al deed -- deze component is de volwaardige pagina-versie daarvan,
// plus live koptellers.

interface Cel_ {
  sleutel: { agencyId: string; channel: string; bedrijfsmodel: string | null; niche: string | null; maand: string };
  metrics: { spend: number; conversions: number; conversionValue: number };
  accounts: number;
}

interface Antwoord {
  vanaf: string;
  aantalCellen: number;
  aantalKlantenIngelezen: number;
  cellen: Cel_[];
}

export function AgencyGodView() {
  const [data, setData] = useState<Antwoord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/agency-macrotrends")
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; if (d?.error) setError(d.error); else setData(d as Antwoord); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-rm-blue-ink" />
      </div>
    );
  }
  if (data.cellen.length === 0) {
    return (
      <div className="terminal space-y-4">
        <h1 className="text-page font-bold text-rm-blue-ink">Agency God View</h1>
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-body text-muted-foreground">
          Nog geen cellen — geen klant van dit bureau heeft in het venster sinds {data.vanaf} zowel
          spend als een gekoppeld segment.
        </p>
      </div>
    );
  }

  const laatsteMaand = data.cellen.reduce((m, c) => (c.sleutel.maand > m ? c.sleutel.maand : m), data.cellen[0].sleutel.maand);
  const rijenLaatsteMaand = data.cellen.filter((c) => c.sleutel.maand === laatsteMaand);
  const totaalSegment = rijenLaatsteMaand.find((c) => !c.sleutel.bedrijfsmodel && !c.sleutel.niche);
  const gesegmenteerd = rijenLaatsteMaand
    .filter((c) => c.sleutel.bedrijfsmodel || c.sleutel.niche)
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 20);

  return (
    <div className="terminal space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5" style={{ color: "var(--terminal-accent, var(--color-rm-blue-ink))" }} />
        <h1 className="text-page font-bold text-rm-blue-ink">Agency God View</h1>
        <span className="text-meta text-muted-foreground">eigen bureau · {laatsteMaand.slice(0, 7)}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Counter value={totaalSegment?.metrics.spend ?? 0} label="Spend deze maand" format="currency" isLive />
        <Counter value={totaalSegment?.metrics.conversions ?? 0} label="Conversies" isLive />
        <Counter value={totaalSegment?.accounts ?? 0} label="Klanten met data" />
        <Counter value={data.aantalKlantenIngelezen} label="Klanten in venster" />
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-title font-semibold text-rm-gray">Portfolio per segment</h2>
          <span className="text-meta text-muted-foreground">
            {data.aantalCellen} cellen sinds {data.vanaf}
          </span>
        </div>
        <p className="mb-3 text-meta text-muted-foreground">
          Eigen portfolio, gesegmenteerd op bedrijfsmodel en niche — geen benchmark tussen bureaus,
          wel het verschil tussen &ldquo;dit ene account daalt&rdquo; en &ldquo;heel dit segment
          daalt&rdquo;. Een cel onder {MIN_ACCOUNTS_VOOR_TREND} accounts is eigen data en blijft
          zichtbaar, maar leest niet als een portfoliobeweging.
        </p>
        <Tabel>
          <Kop>
            <KolomKop breed>Segment</KolomKop>
            <KolomKop>Kanaal</KolomKop>
            <KolomKop getal>Accounts</KolomKop>
            <KolomKop getal>Spend</KolomKop>
            <KolomKop getal>Conversies</KolomKop>
          </Kop>
          <Body>
            {gesegmenteerd.map((c, i) => (
              <Rij key={i}>
                <NaamCel sub={magAlsTrendGelden(c.accounts) ? "trend" : "te klein voor een trend"}>{segmentLabel(c.sleutel)}</NaamCel>
                <Cel nowrap zacht>{c.sleutel.channel}</Cel>
                <GetalCel>{c.accounts}</GetalCel>
                <GetalCel>{c.metrics.spend.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</GetalCel>
                <GetalCel>{c.metrics.conversions.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}</GetalCel>
              </Rij>
            ))}
            {gesegmenteerd.length === 0 && (
              <Rij>
                <Cel>Geen gesegmenteerde cellen deze maand — klanten missen nog een bedrijfsmodel/niche in Instellingen.</Cel>
              </Rij>
            )}
          </Body>
        </Tabel>
      </section>
    </div>
  );
}
