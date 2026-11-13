"use client";

// De periodekiezer van de nieuwe weergave (stap 3 van het periodemodel; het ontwerp V4-Periode en
// V4-Mobiel). Twee knoppen naast elkaar, Periode en Vergelijk met, en daaronder altijd één regel
// die zegt wat er tegen wat staat, met de datums. Beide knoppen openen hetzelfde paneel: je kiest
// de twee samen. Op een telefoon en tablet is het paneel een blad van onderen (tot lg).
//
// De regels (welke keuzes er zijn, de standaarden, wat er in de adresbalk staat) staan in
// lib/period/dag-keuze.ts; dit bestand is alleen de bediening. De keuze gaat via usePeriod().setDag,
// en dus via dezelfde provider, adresbalk en cookie als altijd.
//
// TOEGANKELIJK. Echte knoppen; de vergelijking is een radiogroep (role="radio", aria-checked, de
// pijltjes verplaatsen de keuze); het paneel is een dialoog: de focus gaat erin bij openen, blijft
// erin met Tab, en gaat terug naar de knop die hem opende bij Escape of "Klaar". Elk datumveld
// heeft een label. Tikvlakken van minstens 44 pixels.
//
// BEWEGING. Het paneel komt in 200 ms binnen (DUUR.middel; .kiezer-paneel en .kiezer-blad in
// app/globals.css), en staat er direct bij "minder beweging". De cijfers eronder lopen van oud
// naar nieuw met de bestaande telbeweging (Kerncijfer, useTellendeTekst).

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { usePeriod } from "@/lib/period/period-context";
import {
  googleWeekNoot, kiesPeriode, kiesVergelijk, periodeKnop, SNELLE_PERIODES, VERGELIJK_KEUZES, vergelijkUitleg, vergelijkZin,
  vrijePeriode, schoneDagKeuze, type DagStaat,
} from "@/lib/period/dag-keuze";
import { formatDagPeriode, type DagPeriode, type DagVergelijkingModus } from "@/lib/period/dag-periode";
import type { EventPeriode } from "@/lib/events/event-periodes";
import type { Kanaal } from "@/lib/kanalen/beschikbaar";

/** Heeft de gebruiker in deze sessie zelf een vergelijking gekozen? Dan springt hij niet meer mee. */
const EXPLICIET_SLEUTEL = (scope: string) => `periode-vergelijk-gekozen-${scope}`;

export function leesExpliciet(scope: string): boolean {
  try { return window.sessionStorage.getItem(EXPLICIET_SLEUTEL(scope)) === "1"; } catch { return false; }
}
function zetExpliciet(scope: string): void {
  try { window.sessionStorage.setItem(EXPLICIET_SLEUTEL(scope), "1"); } catch { /* geen opslag: dan springt hij mee */ }
}

const FOCUSBAAR = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Alleen wat Tab echt bereikt. De selector hierboven matcht ook de radio's met tabIndex -1 (in een
 * radiogroep is alleen de gekozen tabbaar); telden die mee, dan was bij de standaardkeuze de
 * niet-gekozen radio "Een vrije periode" de laatste, en liep Tab vanaf de gekozen radio de dialoog uit.
 */
export function alleenTabbaar<T extends { tabIndex: number }>(lijst: readonly T[]): T[] {
  return lijst.filter((el) => el.tabIndex >= 0);
}

const knopKlasse = (aan: boolean) =>
  `min-h-11 rounded-lg border px-3 text-body font-medium transition-colors ${
    aan ? "border-brand-gray bg-brand-gray text-white" : "border-border bg-card text-brand-gray hover:border-gray-400"}`;

export function PeriodeKiezer({ scope, events, kanalen, laden = false, onNaarEvents }: {
  /** Per klant: de sessievlag "zelf een vergelijking gekozen" geldt voor deze klant. */
  scope: string;
  /** De events van de klant; null zolang ze laden. */
  events: readonly EventPeriode[] | null;
  /** De kanalen van de klant, voor de regel over Google per week. */
  kanalen: readonly Kanaal[];
  /** De pagina weet nog niet tot waar de data loopt: dan is de kiezer nog niet te openen. */
  laden?: boolean;
  /** Naar Instellingen > Events. */
  onNaarEvents: () => void;
}) {
  const periode = usePeriod();
  const staat = periode.dag;
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const paneel = useRef<HTMLDivElement>(null);
  const paneelId = useId();
  const titelId = useId();

  const sluit = useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);

  // Escape sluit, waar de focus ook staat; alleen zolang het paneel open is.
  useEffect(() => {
    if (!open) return;
    const opToets = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); sluit(); } };
    document.addEventListener("keydown", opToets);
    return () => document.removeEventListener("keydown", opToets);
  }, [open, sluit]);

  // De focus het paneel in: op de gekozen keuze van de knop waarmee het openging (de gekozen periode,
  // of de gekozen vergelijking in de radiogroep), anders de eerste knop.
  useEffect(() => {
    if (!open) return;
    const p = paneel.current;
    const gekozen = opener.current?.dataset.kiezer === "vergelijk" ? '[role="radio"][aria-checked="true"]' : '[aria-pressed="true"]';
    const doel = p?.querySelector<HTMLElement>(gekozen) ?? p?.querySelector<HTMLElement>(FOCUSBAAR);
    doel?.focus();
  }, [open]);

  if (!staat) return null;
  const knop = periodeKnop(staat, periode.range);
  const vergelijkLabel = VERGELIJK_KEUZES.find((v) => v.modus === staat.keuze.vergelijk)?.label ?? "";
  const zin = vergelijkZin(staat);
  const noot = googleWeekNoot(staat.periode, kanalen);

  const openMet = (knopEl: HTMLButtonElement) => {
    opener.current = knopEl;
    setOpen((o) => !o);
  };

  // Tab blijft in de dialoog: van de laatste naar de eerste en terug.
  const opToetsInPaneel = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !paneel.current) return;
    const lijst = alleenTabbaar([...paneel.current.querySelectorAll<HTMLElement>(FOCUSBAAR)]);
    if (lijst.length === 0) return;
    const eerste = lijst[0];
    const laatste = lijst[lijst.length - 1];
    if (e.shiftKey && document.activeElement === eerste) { e.preventDefault(); laatste.focus(); }
    else if (!e.shiftKey && document.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
  };

  return (
    <div className="relative flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? paneelId : undefined}
          aria-busy={laden || undefined} disabled={laden} data-kiezer="periode"
          onClick={(e) => openMet(e.currentTarget)}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-left hover:border-gray-400 disabled:opacity-60">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Periode</span>
            <span className="truncate text-body font-semibold text-brand-gray">{knop.label}
              <span className="font-normal text-muted-foreground max-sm:hidden"> · {knop.bereik}</span></span>
          </span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? paneelId : undefined}
          aria-busy={laden || undefined} disabled={laden} data-kiezer="vergelijk"
          onClick={(e) => openMet(e.currentTarget)}
          className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-left hover:border-gray-400 disabled:opacity-60 ${
            staat.keuze.vergelijk === "none" ? "bg-muted/60" : "bg-card"}`}>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Vergelijk met</span>
            <span className="truncate text-body font-semibold text-brand-gray">{vergelijkLabel}</span>
          </span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </div>
      {/* Altijd één regel: wat er tegen wat staat, met de datums. */}
      <p data-vergelijkzin aria-live="polite" className="max-w-xl text-meta text-brand-gray sm:text-right">{zin}</p>
      {noot && <p data-googlenoot className="max-w-xl text-micro text-muted-foreground sm:text-right">{noot}</p>}

      {open && (
        <>
          {/* Een klik ernaast sluit. Op een telefoon en tablet een donkere laag achter het blad.
              Pas vanaf lg hangt het paneel onder de knoppen: op tabletbreedte staat rechts van de
              kiezer nog de weergaveschakelaar, en viel de linkerkant van een rechts uitgelijnd paneel
              buiten beeld. */}
          <div aria-hidden className="fixed inset-0 z-40 bg-black/30 lg:bg-transparent" onClick={sluit} />
          <div ref={paneel} id={paneelId} role="dialog" aria-modal="true" aria-labelledby={titelId} onKeyDown={opToetsInPaneel}
            className="kiezer-paneel fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overflow-x-hidden rounded-t-2xl border border-border bg-card p-4 text-left shadow-xl lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-full lg:mt-2 lg:max-h-[80vh] lg:w-[min(46rem,calc(100vw-2rem))] lg:rounded-xl">
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border lg:hidden" />
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id={titelId} className="text-title font-semibold text-brand-gray">Periode en vergelijking</h2>
              <button type="button" onClick={sluit} className="min-h-11 rounded-lg bg-brand-gray px-4 text-body font-semibold text-white">Klaar</button>
            </div>
            <div className="grid min-w-0 gap-6 sm:grid-cols-2">
              <PeriodeDeel staat={staat} scope={scope} events={events} onNaarEvents={() => { setOpen(false); onNaarEvents(); }} />
              <VergelijkDeel staat={staat} scope={scope} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kop({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function PeriodeDeel({ staat, scope, events, onNaarEvents }: {
  staat: DagStaat; scope: string; events: readonly EventPeriode[] | null; onNaarEvents: () => void;
}) {
  const { setDag } = usePeriod();
  const p = staat.keuze.periode;
  const [van, setVan] = useState(staat.periode.start);
  const [tot, setTot] = useState(staat.periode.eind);
  const vrij = vrijePeriode(van, tot);
  // Nieuwste eerst: de editie die eraan komt of net was, staat bovenaan.
  const lijst = useMemo(() => [...(events ?? [])].reverse(), [events]);
  const kies = (nieuw: Parameters<typeof kiesPeriode>[1], heeftVorigeEditie = false) =>
    setDag(kiesPeriode(staat.keuze, nieuw, { expliciet: leesExpliciet(scope), heeftVorigeEditie }));

  return (
    <section aria-labelledby={`${scope}-periode`} className="flex min-w-0 flex-col gap-4">
      <h3 id={`${scope}-periode`} className="text-body font-semibold text-brand-gray">Periode</h3>
      <div>
        <Kop>Snel</Kop>
        <div className="flex flex-wrap gap-2">
          {SNELLE_PERIODES.map((s) => {
            const aan = p.soort === "maanden" && p.preset === s.preset;
            return (
              <button key={s.preset} type="button" aria-pressed={aan} className={knopKlasse(aan)}
                onClick={() => kies({ soort: "maanden", preset: s.preset, custom: null })}>{s.kort}</button>
            );
          })}
        </div>
      </div>
      <div>
        <Kop>Events van deze klant <span className="font-normal normal-case tracking-normal">· uit Instellingen &gt; Events</span></Kop>
        {events === null ? (
          <p className="text-meta text-muted-foreground">Events laden…</p>
        ) : lijst.length === 0 ? (
          <p className="text-meta text-muted-foreground">Nog geen events met datums.</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {lijst.map((e) => {
              const aan = p.soort === "dagen" && p.event === e.eventId && p.start === e.start && p.eind === e.eind;
              return (
                <button key={`${e.eventId}-${e.datum}`} type="button" aria-pressed={aan}
                  onClick={() => kies({ soort: "dagen", start: e.start, eind: e.eind, event: e.eventId }, !!e.vorige)}
                  className={`flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-1.5 text-left text-body ${
                    aan ? "border-brand-gray bg-brand-blue/5" : "border-border bg-card hover:border-gray-400"}`}>
                  <span className="font-semibold text-brand-gray">{e.naam}</span>
                  <span className="text-muted-foreground">{e.label}</span>
                  <span className="ml-auto text-muted-foreground">{formatDagPeriode(e)}</span>
                </button>
              );
            })}
          </div>
        )}
        <button type="button" onClick={onNaarEvents}
          className="mt-1 min-h-11 text-meta text-brand-blue-ink underline underline-offset-2">
          + Event toevoegen of datums aanpassen
        </button>
      </div>
      <div>
        <Kop>Vrije datums</Kop>
        <div className="grid grid-cols-2 items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-micro text-muted-foreground">Van
            <input type="date" value={van} onChange={(e) => setVan(e.target.value)}
              className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-body text-brand-gray" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-micro text-muted-foreground">Tot en met
            <input type="date" value={tot} onChange={(e) => setTot(e.target.value)}
              className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-body text-brand-gray" />
          </label>
          <button type="button" disabled={!vrij} aria-pressed={p.soort === "dagen" && !p.event}
            onClick={() => vrij && kies({ soort: "dagen", start: vrij.start, eind: vrij.eind, event: null })}
            className={`col-span-2 ${knopKlasse(p.soort === "dagen" && !p.event)} disabled:opacity-50`}>Gebruik deze datums</button>
        </div>
      </div>
    </section>
  );
}

export function VergelijkDeel({ staat, scope }: { staat: DagStaat; scope: string }) {
  const { setDag } = usePeriod();
  const groep = useRef<HTMLDivElement>(null);
  const k = staat.keuze;
  const [van, setVan] = useState(k.eigen?.start ?? staat.vergelijking.periode?.start ?? "");
  const [tot, setTot] = useState(k.eigen?.eind ?? staat.vergelijking.periode?.eind ?? "");

  const kies = (modus: DagVergelijkingModus, eigen?: DagPeriode | null) => {
    zetExpliciet(scope);
    const nieuw = kiesVergelijk(staat, modus, eigen);
    if (modus === "custom" && nieuw.eigen) { setVan(nieuw.eigen.start); setTot(nieuw.eigen.eind); }
    setDag(nieuw);
  };

  // De pijltjes verplaatsen de keuze binnen de groep, en slaan de uitgeschakelde over.
  const opPijl = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const stap = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!stap) return;
    e.preventDefault();
    const kiesbaar = VERGELIJK_KEUZES.filter((v) => v.modus !== "previous_edition" || staat.vorigeEditie.kan);
    const i = kiesbaar.findIndex((v) => v.modus === k.vergelijk);
    const volgende = kiesbaar[(i + stap + kiesbaar.length) % kiesbaar.length];
    kies(volgende.modus);
    requestAnimationFrame(() => groep.current?.querySelector<HTMLElement>(`[data-modus="${volgende.modus}"]`)?.focus());
  };

  const eigen = vrijePeriode(van, tot);
  return (
    <section aria-labelledby={`${scope}-vergelijk`} className="flex min-w-0 flex-col gap-3 sm:border-l sm:border-border sm:pl-6">
      <h3 id={`${scope}-vergelijk`} className="text-body font-semibold text-brand-gray">Vergelijk met</h3>
      <div ref={groep} role="radiogroup" aria-labelledby={`${scope}-vergelijk`} onKeyDown={opPijl} className="flex flex-col gap-1.5">
        {VERGELIJK_KEUZES.map((v) => {
          const aan = k.vergelijk === v.modus;
          const uit = v.modus === "previous_edition" && !staat.vorigeEditie.kan;
          return (
            <button key={v.modus} type="button" role="radio" aria-checked={aan} aria-disabled={uit || undefined}
              data-modus={v.modus} tabIndex={aan ? 0 : -1}
              onClick={() => { if (!uit) kies(v.modus); }}
              className={`flex min-h-11 min-w-0 items-start gap-3 rounded-lg border px-3 py-2 text-left text-body ${
                aan ? "border-brand-gray bg-muted/50" : "border-border bg-card"} ${uit ? "cursor-not-allowed text-muted-foreground" : "text-brand-gray hover:border-gray-400"}`}>
              <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${aan ? "border-brand-gray" : "border-gray-400"}`}>
                {aan && <span className="h-2 w-2 rounded-full bg-brand-gray" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{v.label}</span>
                <span className="text-meta text-muted-foreground">{vergelijkUitleg(staat, v.modus)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {k.vergelijk === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-micro text-muted-foreground">Vergelijk van
            <input type="date" value={van} onChange={(e) => { setVan(e.target.value); const q = vrijePeriode(e.target.value, tot); if (q) setDag(schoneDagKeuze({ ...k, eigen: q })); }}
              className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-body text-brand-gray" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-micro text-muted-foreground">Tot en met
            <input type="date" value={tot} onChange={(e) => { setTot(e.target.value); const q = vrijePeriode(van, e.target.value); if (q) setDag(schoneDagKeuze({ ...k, eigen: q })); }}
              className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-body text-brand-gray" />
          </label>
          {!eigen && <p className="col-span-2 text-micro text-muted-foreground">Vul twee geldige datums in.</p>}
        </div>
      )}
      {staat.weekdagZichtbaar && (
        <label className="flex min-h-11 items-center gap-3 text-body text-brand-gray">
          <input type="checkbox" checked={k.weekdag} className="h-5 w-5 shrink-0"
            onChange={(e) => setDag(schoneDagKeuze({ ...k, weekdag: e.target.checked }))} />
          Weekdagen gelijk houden: 52 weken terug, zodat vrijdag tegen vrijdag staat
        </label>
      )}
      {staat.vergelijking.waarschuwingen.map((w) => <p key={w} className="text-micro text-muted-foreground">{w}</p>)}
    </section>
  );
}
