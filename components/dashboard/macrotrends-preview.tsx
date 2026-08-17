"use client";

// Voorbeeldweergave van de macro-trendlaag (app/api/admin/macrotrends). Geen bewerkscherm --
// alleen bewijs dat de aggregatie op echte data draait, in dezelfde stijl als BenchmarkSectie.
//
// Toont de MEEST RECENTE maand uit het venster, niet een opgeteld totaal over meerdere maanden:
// een cel se `accounts` is het aantal DISTINCTE klanten in die ene maand, en die tellingen zomaar
// optellen over maanden zou een klant die in drie maanden voorkomt als drie accounts meetellen.
// Liever één correcte maand tonen dan een vlotte som die de verkeerde vraag beantwoordt.

import { useEffect, useState } from "react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "./data-table";
import { segmentLabel } from "@/lib/macro/types";

interface Cel_ {
  sleutel: { agencyId: string; channel: string; bedrijfsmodel: string | null; niche: string | null; maand: string };
  metrics: { spend: number; conversions: number };
  accounts: number;
}

interface Antwoord {
  vanaf: string;
  aantalCellen: number;
  aantalKlantenIngelezen: number;
  cellen: Cel_[];
}

export function MacroTrendsPreview() {
  const [data, setData] = useState<Antwoord | null>(null);
  const [anoniem, setAnoniem] = useState(false);

  useEffect(() => {
    let af = false;
    fetch("/api/admin/macrotrends")
      .then(async (res) => {
        if (af) return;
        if (res.status === 401 || res.status === 403) { setAnoniem(true); return; }
        if (!res.ok) return;
        setData(await res.json());
      })
      .catch(() => { /* stil: dit voorbeeld mag de rest van de admin-pagina niet breken */ });
    return () => { af = true; };
  }, []);

  if (anoniem || !data) return null;
  if (data.cellen.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-title font-semibold text-brand-gray">Agency macro trends</h2>
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-meta text-muted-foreground">
          Nog geen cellen — geen klant heeft in het venster sinds {data.vanaf} zowel spend als een
          gekoppeld bureau.
        </p>
      </section>
    );
  }

  const laatsteMaand = data.cellen.reduce((m, c) => (c.sleutel.maand > m ? c.sleutel.maand : m), data.cellen[0].sleutel.maand);
  const rijen = data.cellen
    .filter((c) => c.sleutel.maand === laatsteMaand)
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 20);

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-brand-gray">Agency macro trends</h2>
        <span className="text-meta text-muted-foreground">
          {data.aantalCellen} cellen over {data.aantalKlantenIngelezen} klanten sinds {data.vanaf}
        </span>
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Eigen portfolio per bureau, gesegmenteerd op bedrijfsmodel en niche — geen benchmark tussen
        bureaus, wel het verschil tussen &ldquo;dit ene account daalt&rdquo; en &ldquo;heel dit
        segment daalt&rdquo;. Getoond: {laatsteMaand}, top 20 op spend.
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
          {rijen.map((c, i) => (
            <Rij key={i}>
              <NaamCel sub={c.sleutel.agencyId}>{segmentLabel(c.sleutel)}</NaamCel>
              <Cel nowrap zacht>{c.sleutel.channel}</Cel>
              <GetalCel>{c.accounts}</GetalCel>
              <GetalCel>{c.metrics.spend.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</GetalCel>
              <GetalCel>{c.metrics.conversions.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}</GetalCel>
            </Rij>
          ))}
        </Body>
      </Tabel>
    </section>
  );
}
