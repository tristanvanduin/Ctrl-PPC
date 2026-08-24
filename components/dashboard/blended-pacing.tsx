"use client";

import { useMemo } from "react";
import { Zap, TrendingUp, Calendar, Flag, Target } from "lucide-react";
import { today as vandaag } from "@/lib/reporting-date";

// Pacing over alle kanalen samen.
//
// WAAROM DIT ER EERST NIET WAS, EN WAT ER NU WÉL KAN. De kanaal-pacing vergelijkt maand-tot-nu met
// dezelfde dag-telling van de vorige maand. Dat vraagt DAGdata over alle kanalen samen, en die
// bestaat niet als één bron: `blended_account_monthly` is per maand (de lopende maand is dus
// partieel, en een partiële maand tegen een volle vergelijken is precies de fout die de
// kanaal-pacing vermijdt), er is geen `blended_account_daily`, en Google heeft überhaupt geen
// leesbare dagtabel -- die loopt via ClientDataProvider, dat maandrecords levert.
//
// Maar "pacing" hoeft niet per se maand-op-maand te zijn. Op jaarbasis kan het wél eerlijk, met
// exact de data die dit tabblad toch al ophaalt: het jaar tot nu tegen HETZELFDE deel van vorig
// jaar. Beide kanten zijn dan even lang -- geen partiële maand tegen een volle -- en er is geen
// doel voor nodig. Dat laatste is de kern: `client_targets` is voor deze klanten leeg, dus elke
// variant die tegen een jaardoel meet zou een doel moeten verzinnen.
//
// De vergelijking loopt tot en met de laatste VOLLEDIG gemeten maand, niet tot vandaag: de lopende
// maand is aan beide kanten anders ver, en meenemen zou de vergelijking scheeftrekken op precies
// het moment dat je ernaar kijkt.

interface BlendedPacingRij {
  month: string;
  spend: number | null;
  conversions: number | null;
}

export function BlendedPacing({ rows }: { rows: BlendedPacingRij[] | null }) {
  const cijfers = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const nu = vandaag();
    const dezeMaand = nu.slice(0, 7);
    const jaar = Number(nu.slice(0, 4));

    // De laatste maand die compleet is: alles vóór de lopende maand.
    const volledig = [...new Set(rows.map((r) => r.month.slice(0, 7)))].filter((m) => m < dezeMaand).sort();
    if (volledig.length === 0) return null;
    const tot = volledig[volledig.length - 1].slice(5, 7); // "07"

    const som = (jaartal: number) => {
      let spend = 0, conv = 0, maanden = 0;
      const gezien = new Set<string>();
      for (const r of rows) {
        const m = r.month.slice(0, 7);
        if (Number(m.slice(0, 4)) !== jaartal) continue;
        if (m.slice(5, 7) > tot) continue;
        spend += Number(r.spend ?? 0);
        conv += Number(r.conversions ?? 0);
        if (!gezien.has(m)) { gezien.add(m); maanden += 1; }
      }
      return { spend, conv, maanden };
    };

    const ditJaar = som(jaar);
    const vorigJaar = som(jaar - 1);
    if (ditJaar.maanden === 0) return null;

    return {
      totMaand: tot,
      maanden: ditJaar.maanden,
      spend: ditJaar.spend,
      conv: ditJaar.conv,
      vorigSpend: vorigJaar.spend,
      vorigConv: vorigJaar.conv,
      // null zodra vorig jaar niets gemeten heeft: dan is er niets om tegen af te zetten, en 0%
      // zou lezen als "we doen niets" in plaats van "er is geen vergelijking".
      spendRatio: vorigJaar.spend > 0 ? ditJaar.spend / vorigJaar.spend : null,
      convRatio: vorigJaar.conv > 0 ? ditJaar.conv / vorigJaar.conv : null,
    };
  }, [rows]);

  if (!cijfers) return null;

  const { totMaand, maanden, spend, conv, vorigSpend, vorigConv, spendRatio, convRatio } = cijfers;

  const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
  const maandNaam = ["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][Number(totMaand)] ?? totMaand;

  // Meer uitgeven is niet goed of slecht; meer conversies wel. Vandaar amber bij een spend-stijging
  // en groen bij een conversie-stijging -- dezelfde afspraak als in channel-pacing.tsx.
  const kleurVan = (ratio: number | null, hogerIsBeter: boolean) => {
    if (ratio == null) return "#9ca3af";
    if (ratio >= 1.15) return hogerIsBeter ? "#22c55e" : "#f59e0b";
    if (ratio >= 0.85) return "#22c55e";
    return hogerIsBeter ? "#f59e0b" : "#22c55e";
  };
  const spendKleur = kleurVan(spendRatio, false);
  const convKleur = kleurVan(convRatio, true);
  const tekstVan = (ratio: number | null) =>
    ratio == null ? "Geen vorig jaar" : ratio >= 1.15 ? "Hoger dan vorig jaar" : ratio >= 0.85 ? "Gelijk aan vorig jaar" : "Lager dan vorig jaar";

  const spendPerMaand = spend / maanden;
  const convPerMaand = conv / maanden;

  return (
    <div className="@container flex h-full flex-col bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Zap className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Pacing — alle kanalen</h3>
        <span className="text-micro text-muted-foreground ml-auto">
          Jaar tot en met {maandNaam} · {maanden} {maanden === 1 ? "maand" : "maanden"} · tegen dezelfde periode vorig jaar
        </span>
      </div>

      <div className="grid flex-1 grid-cols-2 items-stretch gap-4 @6xl:grid-cols-3 @7xl:grid-cols-6">
        {/* GEEN RING HIER, anders dan bij de kanaal-pacing. Een ring codeert een deel van een
            geheel: hij loopt van leeg naar vol en stopt daar. Deze verhouding heeft geen plafond --
            de eerste versie toonde een volle ring met "255%" erin, en dan zegt de ring niets meer
            dan "meer dan honderd". Voor een vergelijking zonder bovengrens is het verschil zelf de
            waarde, met beide absolute getallen eronder zodat het verschil te plaatsen is. */}
        <Vergelijking
          label="Spend"
          ratio={spendRatio}
          nu={eur(spend)}
          toen={eur(vorigSpend)}
          kleur={spendKleur}
          duiding={tekstVan(spendRatio)}
        />
        <Vergelijking
          label="Conversies"
          ratio={convRatio}
          nu={num(conv, 0)}
          toen={num(vorigConv, 0)}
          kleur={convKleur}
          duiding={tekstVan(convRatio)}
        />

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo spend</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendPerMaand)}</span>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld per maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Tempo conversies</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{num(convPerMaand, 0)}</span>
          <p className="text-micro mt-1 text-muted-foreground">gemiddeld per maand</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Flag className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{eur(spendPerMaand * 12)}</span>
          <p className="text-micro mt-1 text-muted-foreground">spend over twaalf maanden</p>
        </div>

        <div className="flex flex-col justify-center border-l border-border pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">Op dit tempo</p>
          </div>
          <span className="text-figure font-bold leading-none text-brand-gray">{num(convPerMaand * 12, 0)}</span>
          <p className="text-micro mt-1 text-muted-foreground">conversies over twaalf maanden</p>
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-meta leading-snug text-muted-foreground">
        Tegen vorig jaar en niet tegen een doel: er staat voor deze kanalen geen jaardoel in het
        systeem, en een verzonnen doel zou een percentage opleveren dat preciezer oogt dan het is.
        De lopende maand telt aan geen van beide kanten mee, zodat de twee periodes even lang zijn.
      </p>
    </div>
  );
}

/** Een vergelijking van twee absolute waarden: het verschil groot, beide getallen eronder. */
function Vergelijking({ label, ratio, nu, toen, kleur, duiding }: {
  label: string;
  ratio: number | null;
  nu: string;
  toen: string;
  kleur: string;
  duiding: string;
}) {
  // Het verschil en niet de verhouding: "+68%" is wat je wilt weten, "168%" moet je zelf nog
  // omrekenen. Bij een halvering leest "-50%" ook meteen goed, waar "50%" dubbelzinnig is.
  const verschil = ratio == null ? null : Math.round((ratio - 1) * 100);

  return (
    <div className="flex flex-col justify-center">
      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-figure font-bold leading-none tabular-nums" style={{ color: kleur }}>
        {verschil == null ? "—" : `${verschil >= 0 ? "+" : ""}${verschil}%`}
      </p>
      <p className="mt-1.5 text-body text-brand-gray tabular-nums">
        <span className="font-semibold">{nu}</span>
        <span className="text-muted-foreground"> tegen {toen}</span>
      </p>
      <p className="text-micro" style={{ color: kleur }}>{duiding}</p>
    </div>
  );
}
