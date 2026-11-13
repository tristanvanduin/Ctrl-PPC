"use client";

// Wat er na de klik gebeurt, op het Overzicht in de nieuwe weergave. Op een kanaal loopt de
// trechter door: klikken > de stappen die de klant meet (KanaalNaDeKlik, onderaan de trechter van
// dat kanaal). Op Alle kanalen per stap de kanalen naast elkaar, NIET opgeteld (NaDeKlikPerKanaal,
// direct onder Bijdrage per kanaal). Wat hier staat en waarom: lib/overzicht/conversiestappen.ts.
// Deze component rekent niets zelf en haalt niets op.
//
// TOEGANKELIJK. De lijst in beeld is versiering bij getallen die er naast staan (aria-hidden); een
// schermlezer krijgt hetzelfde als tabel, in een sr-only BLOK en niet als sr-only tabel: een
// absolute tabel zonder anker duwde de pagina op een telefoon zijwaarts (overzicht-trechter.tsx).
// Op een telefoon breekt elke regel om in plaats van zijwaarts te lopen, en de link naar de
// instellingen is een tikvlak van 44 px.

import { ArrowDown, MousePointerClick, Settings } from "lucide-react";
import { KANAAL_KLEUR, KANAAL_NAAM } from "@/lib/kanalen/beschikbaar";
import { procentTekst } from "@/lib/overzicht/trechter";
import { NIET_OPTELLEN, type Keten, type KetenRij, type NaDeKlikUitkomst } from "@/lib/overzicht/conversiestappen";
import { KANAAL_GLYPH } from "./kanaalkaarten";
import type { TrechterVenster } from "./overzicht-trechter";

const AANTAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const PROCENT = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const aantal = (v: number) => AANTAL.format(v);
const aandeel = (v: number | null) => (v === null ? "niet te berekenen" : `${PROCENT.format(v * 100)}%`);

/** "+12 (+8%)", "-3 (vrijwel gelijk)", of "+5 (toen nul)". */
function veranderingTekst(v: KetenRij["verandering"]): string | null {
  if (!v) return null;
  const abs = `${v.absoluut > 0 ? "+" : ""}${aantal(v.absoluut)}`;
  return `${abs} (${v.pct === null ? "toen nul, geen percentage" : procentTekst(v.pct)})`;
}

function Redenen({ keten }: { keten: Keten }) {
  if (!keten.weg.length && !keten.opmerkingen.length) return null;
  return (
    <div className="mt-2 space-y-1 text-micro text-muted-foreground">
      {keten.opmerkingen.map((o) => <p key={o}>{o}</p>)}
      {keten.weg.length > 0 && (
        <>
          <p>Niet in de keten:</p>
          <ul className="list-disc pl-4">{keten.weg.map((w) => <li key={w}>{w}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** De keten van één kanaal: klikken en de stappen na de klik, onder de trechter van dat kanaal. */
export function KanaalNaDeKlik({ keten, venster, onNaarInstellingen }: {
  /** Null zolang de cijfers laden. */
  keten: Keten | null;
  venster: TrechterVenster;
  onNaarInstellingen?: () => void;
}) {
  return (
    <div data-trechterblok="na-de-klik" className="mt-3 border-t border-border/70 pt-3">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold text-brand-gray">
        <MousePointerClick className="h-4 w-4" aria-hidden /> Na de klik
      </h3>
      {keten === null ? (
        <div className="mt-2 h-16 rounded-lg bg-muted/40" aria-hidden />
      ) : keten.leeg ? (
        <>
          <p className="mt-1 text-micro text-muted-foreground">
            {KANAAL_NAAM[keten.kanaal]} heeft in deze periode geen stappen na de klik.{" "}
            {onNaarInstellingen && <InstellingenLink onClick={onNaarInstellingen} />}
          </p>
          <Redenen keten={keten} />
        </>
      ) : (
        <>
          <ol className="mt-2 space-y-1" aria-hidden>
            {keten.rijen.map((r, i) => (
              <li key={r.naam} data-nadeklikstap={r.naam}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-meta font-medium text-brand-gray">{r.naam}</span>
                  <span className="ml-auto text-title font-semibold tabular-nums text-brand-gray">{aantal(r.waarde)}</span>
                  {veranderingTekst(r.verandering) && (
                    <span className="w-full text-right text-micro tabular-nums text-muted-foreground">{veranderingTekst(r.verandering)}</span>
                  )}
                </div>
                {i < keten.rijen.length - 1 && (
                  <p className="flex flex-wrap items-center gap-x-1.5 py-0.5 pl-1 text-micro text-muted-foreground">
                    <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                    <span>naar de volgende stap <span className="font-medium tabular-nums text-brand-gray">{aandeel(r.naarVolgende)}</span></span>
                    {r.uitval !== null && <span>· uitval {aantal(r.uitval)}</span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="sr-only">
            <table>
              <caption>Na de klik bij {KANAAL_NAAM[keten.kanaal]} over {venster.over}{venster.tegen ? `, vergeleken met ${venster.tegen}` : ""}</caption>
              <thead><tr><th scope="col">Stap</th><th scope="col">Aantal</th><th scope="col">Naar de volgende stap</th><th scope="col">Uitval</th><th scope="col">Verandering</th></tr></thead>
              <tbody>
                {keten.rijen.map((r, i) => (
                  <tr key={r.naam}>
                    <th scope="row">{r.naam}</th>
                    <td>{aantal(r.waarde)}</td>
                    <td>{i < keten.rijen.length - 1 ? aandeel(r.naarVolgende) : "laatste stap"}</td>
                    <td>{r.uitval === null ? "geen" : aantal(r.uitval)}</td>
                    <td>{veranderingTekst(r.verandering) ?? "geen vergelijking"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Redenen keten={keten} />
        </>
      )}
    </div>
  );
}

function InstellingenLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-blue-ink underline underline-offset-2">
      <Settings className="h-3.5 w-3.5" aria-hidden /> Stel de conversietrechter in
    </button>
  );
}

/** "per maand" bij een kanaal dat de periode niet per dag kon tellen (Google zonder dagcijfers). */
const PER_MAAND = "per maand geteld";

/**
 * Alle kanalen: per stap na de klik de kanalen naast elkaar, niet opgeteld, met de reden erbij.
 * Alleen kanalen met stapdata; zonder een enkel kanaal een regel met een link naar de instellingen.
 * Een kanaal dat per maand telt, heeft dat label bij elk getal, in beeld en in de tabel, en de noten
 * per kanaal (welke maanden, waarom geen verandering) staan eronder.
 */
export function NaDeKlikPerKanaal({ uitkomst, venster, onNaarInstellingen }: {
  /** Null zolang de cijfers laden. */
  uitkomst: NaDeKlikUitkomst | null;
  venster: TrechterVenster;
  onNaarInstellingen?: () => void;
}) {
  return (
    <section aria-labelledby="na-de-klik-kop" data-trechterblok="na-de-klik-alle" className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="na-de-klik-kop" className="flex items-center gap-1.5 text-title font-bold text-brand-blue-ink">
          <MousePointerClick className="h-4 w-4" aria-hidden /> Na de klik
        </h2>
        <p className="text-meta text-muted-foreground">
          over <span className="font-medium text-brand-gray">{venster.over}</span>
          {venster.tegen ? <> · vergeleken met {venster.tegen}</> : <> · zonder vergelijking</>}
        </p>
      </div>
      {uitkomst === null ? (
        <div className="h-20 rounded-lg bg-muted/40" aria-hidden />
      ) : uitkomst.kanalen.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          Geen enkel kanaal heeft in deze periode stappen na de klik, of er is nog niet gekozen welke acties een stap zijn.{" "}
          {onNaarInstellingen && <InstellingenLink onClick={onNaarInstellingen} />}
        </p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
            {uitkomst.stappen.map((s) => (
              <li key={s.naam} data-nadeklikstap={s.naam} className="rounded-lg border border-border/70 px-3 py-2.5">
                <p className="text-meta font-semibold text-brand-gray">{s.naam}</p>
                <ul className="mt-1 space-y-1">
                  {s.perKanaal.map((k) => (
                    <li key={k.kanaal} className="flex flex-wrap items-baseline gap-x-2 text-meta">
                      <span className="flex h-5 w-5 items-center justify-center rounded text-micro font-bold"
                        style={{ color: KANAAL_KLEUR[k.kanaal], background: `color-mix(in srgb, ${KANAAL_KLEUR[k.kanaal]} 14%, transparent)` }}>
                        {KANAAL_GLYPH[k.kanaal]}
                      </span>
                      <span className="text-muted-foreground">
                        {KANAAL_NAAM[k.kanaal]}
                        {k.fijnheid === "maand" && <span className="ml-1 text-micro">({PER_MAAND})</span>}
                      </span>
                      <span className="ml-auto font-semibold tabular-nums text-brand-gray">{aantal(k.waarde)}</span>
                      {veranderingTekst(k.verandering) && (
                        <span className="w-full text-right text-micro tabular-nums text-muted-foreground">{veranderingTekst(k.verandering)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="sr-only">
            <table>
              <caption>Na de klik per kanaal over {venster.over}{venster.tegen ? `, vergeleken met ${venster.tegen}` : ""}. {NIET_OPTELLEN}</caption>
              <thead><tr><th scope="col">Stap</th><th scope="col">Kanaal</th><th scope="col">Aantal</th><th scope="col">Verandering</th></tr></thead>
              <tbody>
                {uitkomst.stappen.flatMap((s) => s.perKanaal.map((k) => (
                  <tr key={`${s.naam}|${k.kanaal}`}>
                    <th scope="row">{s.naam}</th>
                    <td>{KANAAL_NAAM[k.kanaal]}{k.fijnheid === "maand" ? ` (${PER_MAAND})` : ""}</td>
                    <td>{aantal(k.waarde)}</td>
                    <td>{veranderingTekst(k.verandering) ?? "geen vergelijking"}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-micro text-muted-foreground">{NIET_OPTELLEN}</p>
          {uitkomst.noten.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-micro text-muted-foreground" data-nadeklik-noten>
              {uitkomst.noten.map((n) => <li key={`${n.kanaal}|${n.tekst}`}>{n.tekst}</li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
