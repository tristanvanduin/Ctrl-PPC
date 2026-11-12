"use client";

// Het logboek "Wat er gebeurde" op het Overzicht in de nieuwe weergave (bouwplan fase 4).
//
// WAT HET IS. Een tijdlijn van wat er bij deze klant werkelijk gebeurde: een Code Rood, een sync
// die mislukte of weer slaagt, een analyse die klaar is, een voorstel dat wacht, een hypothese die
// is beoordeeld, een notitie. Het is het enige blok dat de pagina elke dag anders laat openen, om
// een echte reden. Wat een regel is en waar hij vandaan komt staat in lib/overzicht/logboek.ts.
//
// WAT HIER WEL EN NIET GEBEURT.
// - De lijst komt één keer binnen (useLogboek). Het kanaal is een filter over die lijst; de periode
//   gaat het logboek niet aan (de kop zegt het: "vast venster · laatste 30 dagen"). Geen van beide
//   kost een verzoek.
// - Een regel klapt open tot zijn onderbouwing. Beslissen gebeurt hier NIET: "Beoordeel" gaat naar
//   Bevindingen, de enige plek waar een voorstel wordt aangenomen of afgewezen.
// - "Nieuw" is nieuw voor jou: van na het einde van je vorige bezoek aan deze klant
//   (lib/overzicht/bezoek.ts). Een herlaad wist dat niet.
// - Leeg is leeg met een reden (legeStaat): niets gebeurd, of een bron die niet te lezen was.
//
// Beweging alleen als antwoord op een handeling: het openklappen (--duur-middel). Er bouwt niets
// op en er knippert niets; "minder beweging" zet de duur op nul (app/globals.css).

import { useState, type ReactNode } from "react";
import {
  AlertOctagon, ArrowRight, CheckSquare, ChevronDown, Database, FileText, FlaskConical, History, Lightbulb, RefreshCw, StickyNote,
} from "lucide-react";
import { KANAAL_KLEUR, KANAAL_NAAM, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import {
  SOORT_LABEL, legeStaat, tijdLabel, voorKanaal,
  type Logboek, type LogboekItem, type LogboekSoort, type LogboekToon,
} from "@/lib/overzicht/logboek";
import { isNieuwSinds } from "@/lib/overzicht/bezoek";
import { useLogboek } from "@/lib/overzicht/use-logboek";
import { useVorigBezoek } from "@/lib/overzicht/use-vorig-bezoek";
import { useMinuutklok } from "@/lib/overzicht/use-minuutklok";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { MeerKnop, useTruncatedList } from "@/components/ui/disclosure";
import { KANAAL_GLYPH } from "./kanaalkaarten";

/** Hoeveel regels er staan voor "toon meer": wat naast de grafiek past. */
export const LOGBOEK_ZICHTBAAR = 4;

const SOORT_ICOON: Record<LogboekSoort, ReactNode> = {
  "code-rood": <AlertOctagon className="h-3.5 w-3.5" aria-hidden />,
  sync: <RefreshCw className="h-3.5 w-3.5" aria-hidden />,
  datastand: <Database className="h-3.5 w-3.5" aria-hidden />,
  analyse: <FileText className="h-3.5 w-3.5" aria-hidden />,
  voorstel: <Lightbulb className="h-3.5 w-3.5" aria-hidden />,
  hypothese: <FlaskConical className="h-3.5 w-3.5" aria-hidden />,
  notitie: <StickyNote className="h-3.5 w-3.5" aria-hidden />,
  todo: <CheckSquare className="h-3.5 w-3.5" aria-hidden />,
};

// De chip naast de titel. Amber alleen voor wat om actie vraagt (een open to-do, een Code Amber);
// een voorstel is een uitnodiging en krijgt de merkkleur.
const TOON_CHIP: Record<LogboekToon, string> = {
  neutraal: "bg-muted text-muted-foreground",
  goed: "bg-green-50 text-green-700",
  "let-op": "bg-amber-50 text-amber-800",
  alarm: "bg-red-50 text-red-700",
  voorstel: "bg-brand-blue/10 text-brand-blue-ink",
};

const kaart = "relative flex min-h-[19rem] flex-col rounded-xl border border-border bg-card px-1.5 pb-2 pt-3 shadow-sm";

function Rij({ item, nieuw, open, onWissel, nu, bekijkKanaal, onBeoordeel }: {
  item: LogboekItem;
  nieuw: boolean;
  open: boolean;
  onWissel: () => void;
  nu: Date;
  /** Het kanaal van deze regel als filter zetten; null als dat niet kan of al zo staat. */
  bekijkKanaal: (() => void) | null;
  onBeoordeel: () => void;
}) {
  const paneel = `logboek-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const kleur = item.kanaal ? KANAAL_KLEUR[item.kanaal] : null;
  return (
    <li className="border-t border-border/60" data-logboek-soort={item.soort} data-nieuw={nieuw ? "ja" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={paneel}
        onClick={onWissel}
        className="grid min-h-[52px] w-full grid-cols-[26px_minmax(0,1fr)_auto_16px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-blue-ink"
      >
        <span
          aria-hidden
          className={`flex h-6 w-6 items-center justify-center rounded-md text-meta font-bold ${kleur ? "" : "bg-muted text-muted-foreground"}`}
          style={kleur ? { backgroundColor: `${kleur}1f`, color: kleur } : undefined}
        >
          {item.kanaal ? KANAAL_GLYPH[item.kanaal] : SOORT_ICOON[item.soort]}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground">
            {nieuw && (
              // Een stip EN het woord: kleur alleen zegt een schermlezer en een kleurenblinde niets.
              <span className="inline-flex items-center gap-1 font-semibold text-brand-blue-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-blue" aria-hidden />nieuw
              </span>
            )}
            <span>{SOORT_LABEL[item.soort]}{item.kanaal ? ` · ${KANAAL_NAAM[item.kanaal]}` : ""} · {tijdLabel(item.tijd, nu)}</span>
            {item.voorbeeld && <span className="rounded border border-border px-1 text-micro font-medium uppercase tracking-wide">voorbeeld</span>}
          </span>
          {/* Op een telefoon twee regels, daarboven één: de titel is de inhoud van de regel. */}
          <span className="line-clamp-2 text-xs leading-snug text-brand-gray sm:line-clamp-1" title={item.titel}>{item.titel}</span>
        </span>
        {item.chip ? (
          <span className={`whitespace-nowrap rounded-full px-1.5 py-px text-meta font-semibold ${TOON_CHIP[item.toon]}`}>{item.chip}</span>
        ) : <span />}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {/* 0fr -> 1fr: het paneel schuift open zonder dat de hoogte gemeten hoeft te worden. Dicht is
          het ook echt weg voor toetsenbord en schermlezer (hidden), niet alleen nul pixels hoog. */}
      <div
        className="grid transition-[grid-template-rows] ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", transitionDuration: "var(--duur-middel, 200ms)" }}
      >
        <div id={paneel} className="overflow-hidden" hidden={!open}>
          <div className="flex flex-col gap-2 pb-2.5 pl-10 pr-2">
            {item.detail.map((alinea, i) => (
              <p key={i} className="text-xs leading-relaxed text-brand-gray">{alinea}</p>
            ))}
            {(item.beoordeelbaar || bekijkKanaal) && (
              <div className="flex flex-wrap gap-1.5">
                {item.beoordeelbaar && (
                  <button
                    type="button"
                    onClick={onBeoordeel}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-gray px-3 text-xs font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink"
                  >
                    Beoordeel <ArrowRight className="h-3 w-3" aria-hidden />
                    <span className="sr-only">in Bevindingen</span>
                  </button>
                )}
                {bekijkKanaal && item.kanaal && (
                  <button
                    type="button"
                    onClick={bekijkKanaal}
                    className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-xs text-brand-gray hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink"
                  >
                    Bekijk {KANAAL_NAAM[item.kanaal]}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** De regel onder de kop: hoeveel er nieuw is sinds het vorige bezoek. */
export function nieuwTekst(inp: { bekend: boolean; eerste: boolean; ijkpunt: string | null; nieuw: number; nieuwElders: number; nu: Date }): string | null {
  if (!inp.bekend) return null;
  if (inp.eerste || !inp.ijkpunt) return "eerste bezoek: vanaf nu zie je hier wat er nieuw is";
  const sinds = `sinds je vorige bezoek (${tijdLabel(inp.ijkpunt, inp.nu)})`;
  const elders = inp.nieuwElders > 0 ? `, en ${inp.nieuwElders} bij andere kanalen` : "";
  return inp.nieuw > 0 ? `${inp.nieuw} nieuw ${sinds}${elders}` : `niets nieuws ${sinds}${elders}`;
}

/**
 * De kaart zelf, zonder ophalen: alles wat hij toont komt via de props. Zo is hij te renderen
 * zonder netwerk en zonder opslag.
 */
export function LogboekKaart({ logboek, laadt, fout, channel, kanalen, ijkpunt, bezoekBekend, eersteBezoek, onKies, onBeoordeel, nu = new Date() }: {
  logboek: Logboek | null;
  laadt: boolean;
  fout: string | null;
  channel: Kanaalkeuze;
  /** De kanalen van de klant: alleen daarvoor staat er een knop "Bekijk <kanaal>". */
  kanalen: readonly Kanaal[];
  /** Het einde van het vorige bezoek; wat daarna gebeurde is nieuw. */
  ijkpunt: string | null;
  bezoekBekend: boolean;
  eersteBezoek: boolean;
  onKies: (keuze: Kanaalkeuze) => void;
  /** Naar Bevindingen: de enige plek om te beslissen. */
  onBeoordeel: () => void;
  nu?: Date;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const alle = logboek?.items ?? [];
  const items = voorKanaal(alle, channel);
  const lijst = useTruncatedList(items, LOGBOEK_ZICHTBAAR);
  const nieuw = items.filter((i) => isNieuwSinds(i.tijd, ijkpunt)).length;
  const nieuwElders = alle.filter((i) => isNieuwSinds(i.tijd, ijkpunt)).length - nieuw;
  const sub = logboek ? nieuwTekst({ bekend: bezoekBekend, eerste: eersteBezoek, ijkpunt, nieuw, nieuwElders, nu }) : null;
  const metVoorbeelden = items.some((i) => i.voorbeeld);

  const kop = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-1.5">
      <History className="h-4 w-4 text-brand-blue-ink" aria-hidden />
      <h3 id="logboek-kop" className="text-title font-semibold text-brand-gray">Wat er gebeurde</h3>
      <Vensterlabel soort="vast" venster={`laatste ${logboek?.dagen ?? 30} dagen`} />
      {/* Altijd aanwezig, ook leeg: de regel eronder verspringt dan niet als het ijkpunt bekend wordt. */}
      <p className="min-h-4 w-full text-meta text-muted-foreground" data-logboek-nieuw={nieuw} aria-live="polite">{sub}</p>
    </div>
  );

  if (!logboek) {
    return (
      <section aria-labelledby="logboek-kop" aria-busy={laadt} className={kaart}>
        {kop}
        {laadt ? (
          <>
            <ul className="flex flex-col" aria-hidden>
              {Array.from({ length: LOGBOEK_ZICHTBAAR }, (_, i) => (
                <li key={i} className="flex min-h-[52px] items-center gap-2 border-t border-border/60 px-2">
                  <span className="h-6 w-6 rounded-md bg-muted/70" />
                  <span className="h-4 flex-1 rounded bg-muted/50" />
                </li>
              ))}
            </ul>
            <span className="sr-only">het logboek wordt geladen</span>
          </>
        ) : (
          <p className="border-t border-border/60 px-2 pt-3 text-xs leading-relaxed text-red-700">
            Het logboek kon niet geladen worden{fout ? `: ${fout}` : "."} Dat zegt niets over wat er gebeurd is; de cijfers hierboven komen uit een andere bron.
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="logboek-kop" className={kaart}>
      {kop}
      {items.length === 0 ? (
        <p className="border-t border-border/60 px-2 pt-3 text-xs leading-relaxed text-muted-foreground" data-logboek-leeg>
          {legeStaat({ ...logboek, items: alle }, channel)}
        </p>
      ) : (
        // Een eigen schuifvak: een regel die openklapt of "toon meer" maakt de kaart niet hoger dan
        // de grafiek ernaast en duwt niets onder de bovenkant omlaag. `relative`: de sr-only tekst
        // in een regel is absoluut gepositioneerd en hoort met het vak mee te schuiven, niet de
        // pagina langer te maken. Alleen naast de grafiek (vanaf lg): op een telefoon staat het
        // logboek boven de grafiek over de volle breedte, en is een schuifvak in een schuivende
        // pagina een val voor de duim. Daar groeit de kaart mee met wat je openklapt.
        <div className={`relative min-h-0 lg:overflow-y-auto ${lijst.uitgeklapt ? "lg:max-h-[28rem]" : "lg:max-h-[13.5rem]"}`}>
          <ul className="flex flex-col">
            {lijst.zichtbaar.map((item) => (
              <Rij
                key={item.id}
                item={item}
                nieuw={isNieuwSinds(item.tijd, ijkpunt)}
                open={open === item.id}
                onWissel={() => setOpen((v) => (v === item.id ? null : item.id))}
                nu={nu}
                bekijkKanaal={item.kanaal && item.kanaal !== channel && kanalen.includes(item.kanaal) ? () => onKies(item.kanaal!) : null}
                onBeoordeel={onBeoordeel}
              />
            ))}
          </ul>
        </div>
      )}
      {/* Buiten het schuifvak: vier regels vullen het vak al, en een knop onder de vouw daarvan
          ziet alleen wie in het vak schuift. Hier staat altijd in beeld dat er meer is. */}
      {items.length > 0 && (
        <MeerKnop verborgen={lijst.verborgen} uitgeklapt={lijst.uitgeklapt} onToggle={lijst.toggle} eenheid="regels" />
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 px-2 pt-2 text-meta text-muted-foreground">
        <button type="button" onClick={onBeoordeel} className="inline-flex items-center gap-1 font-medium text-brand-blue-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink">
          Naar Bevindingen <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
        {logboek.wachtOpOordeel > 0 && (
          <span>· {logboek.wachtOpOordeel} {logboek.wachtOpOordeel === 1 ? "voorstel wacht" : "voorstellen wachten"} op je oordeel</span>
        )}
        {fout && <span className="text-red-700">· verversen mislukte: {fout}</span>}
        {logboek.bronnen.some((b) => !b.ok) && items.length > 0 && (
          <span title={logboek.bronnen.filter((b) => !b.ok).map((b) => `${b.bron}: ${b.fout ?? "niet te lezen"}`).join("\n")}>· niet elke bron was te lezen</span>
        )}
        {metVoorbeelden && <span className="w-full">Regels met &lsquo;voorbeeld&rsquo; zijn verzonnen voor de demo; de rest is echt.</span>}
      </div>
    </section>
  );
}

/**
 * Het logboek met zijn eigen bedrading: één verzoek bij het laden, en het ijkpunt uit de browser.
 *
 * `herlees` verandert als er opnieuw gelezen hoort te worden (een nieuwe ronde van de blended
 * route, na een sync). Het kanaal en de periode zitten daar NIET in.
 */
export function OverzichtLogboek({ clientId, channel, kanalen, onKies, onBeoordeel, herlees }: {
  clientId: string;
  channel: Kanaalkeuze;
  kanalen: readonly Kanaal[];
  onKies: (keuze: Kanaalkeuze) => void;
  onBeoordeel: () => void;
  herlees?: unknown;
}) {
  const bezoek = useVorigBezoek(clientId);
  // Twee redenen om opnieuw te lezen, samen in één waarde: de aanroeper (een sync) en een nieuw
  // bezoek (terug op het tabblad na een lange pauze).
  const [ronde, setRonde] = useState<{ herlees: unknown; bezoek: number; n: number }>({ herlees, bezoek: bezoek.bezoek, n: 0 });
  if (ronde.herlees !== herlees || ronde.bezoek !== bezoek.bezoek) setRonde({ herlees, bezoek: bezoek.bezoek, n: ronde.n + 1 });
  const stand = useLogboek(clientId, true, ronde.n);
  // "zojuist" en "12 min geleden" lopen mee zolang het tabblad zichtbaar is: de kaart leest de
  // klok bij elke render, en dit geeft hem elke minuut een render. Geen verzoek.
  useMinuutklok();
  return (
    <LogboekKaart
      logboek={stand.logboek}
      laadt={stand.laadt}
      fout={stand.fout}
      channel={channel}
      kanalen={kanalen}
      ijkpunt={bezoek.ijkpunt}
      bezoekBekend={bezoek.bekend}
      eersteBezoek={bezoek.eerste}
      onKies={onKies}
      onBeoordeel={onBeoordeel}
    />
  );
}
