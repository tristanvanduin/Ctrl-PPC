"use client";

// "Wat nu", onderaan het Overzicht in de nieuwe weergave: het einde van de trechter. De drie
// belangrijkste open punten van deze klant (open to-do's, dan voorstellen die op een oordeel wachten),
// elk met zijn cijfer en datum, en een knop naar Bevindingen, waar beslist wordt. Op een kanaal
// alleen wat over dat kanaal gaat of de hele klant raakt.
//
// GEEN NIEUW VERZOEK. De punten komen uit het logboek dat het Overzicht al leest (useLogboek, met
// dezelfde cache als het logboek bovenaan): één verzoek per klant, niets bij een wissel. Daarmee
// geldt ook zijn bereik, en dat staat er in woorden bij: de voorstellen uit de wachtrij
// (sprint_hypotheses) van de laatste dertig dagen, alleen de VOORSTELLEN_MAX nieuwste daarvan, en de
// to-do's (client_notes) van de laatste dertig dagen. De aanbevelingen uit de analyses
// (sop_recommendations) en oudere punten staan hier NIET in; die heeft Bevindingen. Wachten er in
// totaal meer voorstellen, dan staat dat erbij. De keuze en de volgorde staan in watNuItems
// (lib/overzicht/trechter.ts).
//
// Leeg is een rustige regel, geen leeg vlak, en hij beweert niet dat er niets openstaat: alleen
// dat er in dit bereik niets is. Een bron die niet te lezen was, wordt genoemd.

import { ArrowRight, CheckSquare, Lightbulb } from "lucide-react";
import { KANAAL_NAAM, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";
import { LOGBOEK_DAGEN, VOORSTELLEN_MAX, tijdLabel } from "@/lib/overzicht/logboek";
import { useLogboek } from "@/lib/overzicht/use-logboek";
import { watNuItems } from "@/lib/overzicht/trechter";

export function OverzichtWatNu({ clientId, channel, onBeoordeel, herlees }: {
  clientId: string;
  channel: Kanaalkeuze;
  /** Naar het tabblad Bevindingen. */
  onBeoordeel: () => void;
  /** Dezelfde waarde als het logboek bovenaan: de ronde van de blended route. */
  herlees?: unknown;
}) {
  const { logboek, laadt, fout } = useLogboek(clientId, true, herlees);
  const items = logboek ? watNuItems(logboek.items, channel) : [];
  const waar = channel === "blended" ? "" : ` voor ${KANAAL_NAAM[channel]}`;
  const nietGelezen = (logboek?.bronnen ?? []).filter((b) => (b.bron === "voorstellen" || b.bron === "notities") && !b.ok);
  const wachten = logboek?.wachtOpOordeel ?? null;
  const nu = new Date();

  return (
    <section aria-labelledby="wat-nu-kop" data-trechterblok="wat-nu" className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="wat-nu-kop" className="text-title font-bold text-brand-blue-ink">Wat nu</h2>
        <span className="text-meta text-muted-foreground" data-venster="vast">
          de {VOORSTELLEN_MAX} nieuwste voorstellen uit de wachtrij en de open to-do&apos;s{waar} · laatste {LOGBOEK_DAGEN} dagen
        </span>
        <button type="button" onClick={onBeoordeel}
          className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-meta font-medium text-brand-blue-ink hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-ink sm:min-h-8">
          Naar Bevindingen <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {laadt ? (
        <p className="h-5 w-1/2 rounded bg-muted/60" aria-hidden />
      ) : !logboek ? (
        <p className="text-body text-muted-foreground">De voorstellen en to-do&apos;s konden niet geladen worden{fout ? ` (${fout})` : ""}.</p>
      ) : items.length === 0 ? (
        <p data-wat-nu-leeg className="text-body text-muted-foreground">
          {nietGelezen.length > 0
            ? `De ${nietGelezen.map((b) => (b.bron === "voorstellen" ? "voorstellen" : "to-do's")).join(" en ")} konden niet gelezen worden; er is dus niet te zeggen of er iets openstaat.`
            : `Geen wachtende voorstellen of open to-do's${waar} uit de laatste ${LOGBOEK_DAGEN} dagen. Aanbevelingen uit de analyses en oudere punten staan in Bevindingen.`}
          {wachten !== null && wachten > 0 ? ` In totaal ${wachten === 1 ? "wacht er 1 voorstel" : `wachten er ${wachten} voorstellen`} op een oordeel, ook oudere en van andere kanalen.` : ""}
        </p>
      ) : (
        <>
          <ol className="divide-y divide-border/60">
            {items.map((i) => (
              <li key={i.id} data-wat-nu={i.soort} className="flex items-start gap-2 py-2">
                <span className="mt-0.5 text-muted-foreground" aria-hidden>
                  {i.soort === "todo" ? <CheckSquare className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-brand-gray">{i.titel}</span>
                  <span className="block text-micro text-muted-foreground">
                    {i.soort === "todo" ? "to-do" : "voorstel"}
                    {i.kanaal ? ` · ${KANAAL_NAAM[i.kanaal]}` : ""}
                    {" · "}{tijdLabel(i.tijd, nu)}
                    {i.voorbeeld ? " · voorbeeld" : ""}
                  </span>
                </span>
                {/* Het cijfer: de ICE-score van een voorstel, of "open" bij een to-do. */}
                {i.chip && <span className="shrink-0 rounded-full border border-border px-2 py-px text-micro font-medium tabular-nums text-brand-gray">{i.chip}</span>}
              </li>
            ))}
          </ol>
          {wachten !== null && wachten > items.length && (
            <p className="mt-1 text-micro text-muted-foreground">
              In totaal wachten er {wachten} voorstellen op een oordeel, ook oudere en van andere kanalen; Bevindingen heeft ze allemaal.
            </p>
          )}
        </>
      )}
    </section>
  );
}
