"use client";

// De trechter op het Overzicht in de nieuwe weergave: de statusregel boven de kerncijfers (HOE GAAT
// HET) en het blok eronder dat zegt WAAR HET ZIT. Op Alle kanalen is dat de bijdrage per kanaal,
// op een gekozen kanaal (of bij een klant met één kanaal) de trechter vertoningen > klikken >
// conversies. Wat hier staat en waarom, staat in lib/overzicht/trechter.ts; deze component rekent
// niets zelf en haalt niets op.
//
// BEWEGING. Alleen als antwoord op een wissel van kanaal of periode: de getallen tellen van oud naar
// nieuw (useTellendeTekst, DUUR.middel) en de balken schuiven in dezelfde 200 ms naar hun nieuwe
// breedte. Bij de eerste render beweegt niets, en "minder beweging" zet beide uit (de hook, en de
// regel onderaan app/globals.css voor de overgang).
//
// TOEGANKELIJK. De balken zijn versiering bij getallen die er altijd naast staan (aria-hidden); een
// schermlezer krijgt de trechter als tabel. Kleur draagt nergens iets alleen: een kanaal dat meer
// kost dan het levert, staat er in woorden, en een verandering heeft altijd een teken.

import type { ReactNode } from "react";
import { ArrowRight, Filter, PieChart } from "lucide-react";
import { DUUR, useTellendeTekst } from "@/lib/beweging";
import { KANAAL_KLEUR, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import {
  BIJDRAGE_VERSCHIL_VANAF, balkBreedtes, procentTekst,
  type BijdrageRij, type Trechter, type TrechterStap,
} from "@/lib/overzicht/trechter";
import { KANAAL_GLYPH } from "./kanaalkaarten";

const AANTAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const EURO_HEEL = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EURO_CENT = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PROCENT = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Een bedrag per eenheid: onder de tien euro met centen (€ 0,42 per klik), anders heel. */
function kosten(v: number | null): string {
  if (v === null) return "niet te berekenen";
  return v < 10 ? EURO_CENT.format(v) : EURO_HEEL.format(v);
}
const verhouding = (v: number | null) => (v === null ? "niet te berekenen" : `${PROCENT.format(v * 100)}%`);

/** Het venster van deze cijfers, zoals de tegels het noemen. */
export interface TrechterVenster {
  over: string;
  tegen: string | null;
  /** Wat de lezer bij dit venster moet weten (kanalen die andere dagen telden). */
  noot?: string;
}

function VensterRegel({ venster }: { venster: TrechterVenster }) {
  return (
    <p className="text-meta text-muted-foreground" data-venster="periode">
      over <span className="font-medium text-brand-gray">{venster.over}</span>
      {venster.tegen ? <> · vergeleken met {venster.tegen}</> : <> · zonder vergelijking</>}
      {venster.noot ? <> · {venster.noot}</> : null}
    </p>
  );
}

// ── 1 HOE GAAT HET ──────────────────────────────────────────────────────────────────────────────

/** De statusregel: één zin boven de kerncijfers. Tijdens het laden een regel op dezelfde hoogte. */
export function StatusRegel({ tekst }: { tekst: string | null }) {
  return (
    <p data-statusregel className="min-h-6 px-1 text-body text-brand-gray" aria-live="polite">
      {tekst ?? <span className="inline-block h-4 w-2/3 rounded bg-muted/70 align-middle" aria-hidden />}
    </p>
  );
}

// ── 2 WAAR ZIT HET, op Alle kanalen ─────────────────────────────────────────────────────────────

function Aandeelbalk({ label, pct, kleur }: { label: string; pct: number | null; kleur: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted/60" aria-hidden>
        <span className="block h-full rounded-full"
          style={{ width: `${pct ?? 0}%`, background: kleur, transition: "width var(--duur-middel, 200ms) var(--ease-aankomst, ease-out)" }} />
      </span>
      <span className="text-right tabular-nums text-brand-gray"><TelTekst tekst={pct === null ? "—" : `${pct}%`} /></span>
    </div>
  );
}

function TelTekst({ tekst }: { tekst: string }) {
  return <>{useTellendeTekst(tekst, DUUR.middel)}</>;
}

function BijdrageRegel({ rij }: { rij: BijdrageRij }) {
  const kleur = KANAAL_KLEUR[rij.kanaal];
  const p = rij.cpaPaar;
  const cpaTekst = rij.cpa === null ? "geen conversies, dus geen CPA" : `CPA ${EURO_HEEL.format(rij.cpa)}`;
  const vergelijking = p && p.pct !== null && p.toen !== null
    ? `${procentTekst(p.pct)} tegen ${EURO_HEEL.format(p.toen)}${p.nu !== null && rij.over ? ` (${EURO_HEEL.format(p.nu)} over ${rij.over})` : ""}`
    : p ? "CPA in een van beide periodes niet te berekenen" : rij.uitleg;
  return (
    <li data-bijdrage={rij.kanaal} data-kenmerk={rij.kenmerk ?? undefined}
      className={`rounded-lg border px-3 py-2.5 ${rij.kenmerk === "duur" ? "border-brand-gray/40" : "border-border/70"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md text-micro font-bold"
          style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}>{KANAAL_GLYPH[rij.kanaal]}</span>
        <span className="text-title font-semibold text-brand-gray">{KANAAL_NAAM[rij.kanaal]}</span>
        {/* In woorden en met een rand, niet in rood: een kanaal dat meer kost dan het levert is een
            vaststelling over deze periode, geen storing. */}
        {rij.kenmerk === "duur" && (
          <span className="rounded-full border border-brand-gray/50 px-2 py-px text-micro font-semibold text-brand-gray">kost meer dan het levert</span>
        )}
        {rij.kenmerk === "voordelig" && (
          <span className="rounded-full border border-border px-2 py-px text-micro text-muted-foreground">levert meer dan het kost</span>
        )}
        <span className="ml-auto text-meta tabular-nums text-brand-gray"><TelTekst tekst={cpaTekst} /></span>
      </div>
      <div className="mt-2 space-y-1">
        <Aandeelbalk label="van de kosten" pct={rij.aandeelKosten} kleur="var(--color-brand-gray, #4b5563)" />
        <Aandeelbalk label="van de conversies" pct={rij.aandeelConversies} kleur={kleur} />
      </div>
      {vergelijking && <p className="mt-1.5 text-micro text-muted-foreground">CPA: {vergelijking}</p>}
    </li>
  );
}

/**
 * Bijdrage per kanaal: per kanaal het aandeel in de kosten tegenover het aandeel in de conversies,
 * de CPA, en hoe die CPA veranderde. Op een telefoon onder elkaar, vanaf een tablet naast elkaar.
 */
export function BijdragePerKanaal({ rijen, venster }: { rijen: readonly BijdrageRij[] | null; venster: TrechterVenster }) {
  return (
    <section aria-labelledby="bijdrage-kop" data-trechterblok="bijdrage" className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="bijdrage-kop" className="flex items-center gap-1.5 text-title font-bold text-brand-blue-ink">
          <PieChart className="h-4 w-4" aria-hidden /> Bijdrage per kanaal
        </h2>
        <VensterRegel venster={venster} />
      </div>
      {rijen === null ? (
        <div className="h-24 rounded-lg bg-muted/40" aria-hidden />
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {rijen.map((r) => <BijdrageRegel key={r.kanaal} rij={r} />)}
          </ul>
          <p className="mt-2 text-micro text-muted-foreground">
            De aandelen gaan over alle kanalen samen en tellen elk op tot 100. Een kanaal krijgt een kenmerk als zijn aandeel in de
            kosten minstens {BIJDRAGE_VERSCHIL_VANAF} punten van dat in de conversies afwijkt. De CPA-verandering gaat alleen over wat
            in beide periodes liep, zoals de tegels erboven.
          </p>
        </>
      )}
    </section>
  );
}

// ── 2 WAAR ZIT HET, per kanaal ──────────────────────────────────────────────────────────────────

function veranderingTekst(pct: number | null): string | null {
  return pct === null ? null : procentTekst(pct);
}

function StapRegel({ stap, breedte, kleur }: { stap: TrechterStap; breedte: number; kleur: string }) {
  const waarde = useTellendeTekst(stap.waarde === null ? "niet bekend" : AANTAL.format(stap.waarde), DUUR.middel);
  const kostenTekst = useTellendeTekst(kosten(stap.kosten.waarde), DUUR.middel);
  const delta = veranderingTekst(stap.pct);
  const kostenDelta = veranderingTekst(stap.kosten.pct);
  return (
    // Op een telefoon het label en het getal op één regel en de balk eronder over de volle breedte;
    // vanaf een tablet label, balk en getal naast elkaar.
    <div data-trechterstap={stap.sleutel} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(9rem,auto)]">
      <span className="text-meta font-medium text-brand-gray">{stap.label}</span>
      <span className="col-span-2 row-start-2 h-6 overflow-hidden rounded-md bg-muted/50 sm:col-span-1 sm:row-start-auto" aria-hidden>
        <span className="block h-full rounded-md"
          style={{ width: `${breedte}%`, background: kleur, transition: "width var(--duur-middel, 200ms) var(--ease-aankomst, ease-out)" }} />
      </span>
      <span className="text-right leading-tight">
        {/* Elke verandering staat bij het getal waar hij over gaat: die van het aantal direct onder het
            aantal, die van de kosten achter de kosten. */}
        <span className="block text-lg font-semibold tabular-nums text-brand-gray">{waarde}</span>
        {delta && <span className="block text-micro tabular-nums text-muted-foreground">aantal {delta}</span>}
        <span className="block text-micro tabular-nums text-muted-foreground">
          {stap.kosten.waarde === null
            ? `kosten ${stap.kosten.label} niet te berekenen`
            : `${kostenTekst} ${stap.kosten.label}${kostenDelta ? `, ${kostenDelta}` : ""}`}
        </span>
      </span>
    </div>
  );
}

function Overgang({ label, waarde, vorig }: { label: string; waarde: number | null; vorig: number | null }) {
  const tekst = useTellendeTekst(verhouding(waarde), DUUR.middel);
  return (
    <p className="flex items-center gap-1.5 pl-1 text-micro text-muted-foreground sm:pl-[7.75rem]">
      <ArrowRight className="h-3 w-3 rotate-90" aria-hidden />
      <span>{label} <span className="font-medium tabular-nums text-brand-gray">{tekst}</span>
        {vorig !== null && waarde !== null ? ` (was ${verhouding(vorig)})` : ""}</span>
    </p>
  );
}

/**
 * De trechter van één kanaal: drie horizontale balken die afnemen, met de getallen ernaast en de
 * CTR en conversieratio ertussen. Daaronder een tabel voor een schermlezer met hetzelfde.
 */
export function KanaalTrechter({ kanaal, trechter, uitleg, venster, children }: {
  kanaal: Kanaal;
  /** Null zolang de cijfers laden. */
  trechter: Trechter | null;
  /** Waarom er voor dit kanaal geen vergelijking is, als dat zo is. */
  uitleg: string | null;
  venster: TrechterVenster;
  /** Wat onder de trechter doorloopt: de stappen na de klik (overzicht-na-de-klik.tsx). */
  children?: ReactNode;
}) {
  const naam = KANAAL_NAAM[kanaal];
  const kleur = KANAAL_KLEUR[kanaal];
  const breedtes = trechter ? balkBreedtes(trechter.stappen.map((s) => s.waarde)) : [];
  return (
    <section aria-labelledby="trechter-kop" data-trechterblok="trechter" data-kanaal={kanaal}
      className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="trechter-kop" className="flex items-center gap-1.5 text-title font-bold text-brand-blue-ink">
          <Filter className="h-4 w-4" aria-hidden /> Trechter {naam}
        </h2>
        <VensterRegel venster={venster} />
      </div>
      {trechter === null ? (
        <div className="h-32 rounded-lg bg-muted/40" aria-hidden />
      ) : trechter.nietGelopen ? (
        // Het kanaal was er in deze periode nog niet: een regel, geen rij nullen die als meting leest.
        <p data-trechter-niet-gelopen className="text-body text-muted-foreground">{trechter.nietGelopen}</p>
      ) : (
        <>
          <div className="space-y-1.5" aria-hidden>
            <StapRegel stap={trechter.stappen[0]} breedte={breedtes[0]} kleur={kleur} />
            <Overgang {...trechter.overgangen[0]} />
            <StapRegel stap={trechter.stappen[1]} breedte={breedtes[1]} kleur={kleur} />
            <Overgang {...trechter.overgangen[1]} />
            <StapRegel stap={trechter.stappen[2]} breedte={breedtes[2]} kleur={kleur} />
          </div>
          {/* In een sr-only blok, niet zelf sr-only: een absolute tabel zonder anker hing aan de body en
              duwde de pagina op een telefoon 436 px zijwaarts (zelfde val als de tabel van de hoofdgrafiek). */}
          <div className="sr-only">
          <table>
            <caption>Trechter van {naam} over {venster.over}{venster.tegen ? `, vergeleken met ${venster.tegen}` : ""}</caption>
            <thead><tr><th scope="col">Stap</th><th scope="col">Aantal</th><th scope="col">Verandering aantal</th><th scope="col">Kosten per stap</th><th scope="col">Verandering kosten</th></tr></thead>
            <tbody>
              {trechter.stappen.map((s) => (
                <tr key={s.sleutel}>
                  <th scope="row">{s.label}</th>
                  <td>{s.waarde === null ? "niet bekend" : AANTAL.format(s.waarde)}</td>
                  <td>{veranderingTekst(s.pct) ?? "geen vergelijking"}</td>
                  <td>{kosten(s.kosten.waarde)} {s.kosten.label}</td>
                  <td>{veranderingTekst(s.kosten.pct) ?? "geen vergelijking"}</td>
                </tr>
              ))}
              {trechter.overgangen.map((o) => (
                <tr key={o.label}>
                  <th scope="row">{o.label}</th>
                  <td>{verhouding(o.waarde)}</td>
                  <td>{o.vorig !== null && o.waarde !== null ? `was ${verhouding(o.vorig)}` : "geen vergelijking"}</td>
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {(trechter.vergelijking === "deel" || uitleg || trechter.opmerkingen.length > 0) && (
            <div className="mt-2 space-y-1 text-micro text-muted-foreground">
              {trechter.vergelijking === "deel" && trechter.over && <p>De veranderingen gaan over {trechter.over}: alleen wat in beide periodes liep.</p>}
              {/* De uitleg van het kanaal (anders geteld, buiten het percentage) staat er altijd bij,
                  ook naast een deel-paar: anders las de getelde week als de gevraagde dagen. */}
              {uitleg && <p>{uitleg}</p>}
              {trechter.opmerkingen.map((o) => <p key={o}>{o}</p>)}
            </div>
          )}
        </>
      )}
      {children}
    </section>
  );
}
