"use client";

// Wat er staat terwijl er nog niets is.
//
// Dertien kaarten toonden hetzelfde: een leeg wit vlak met een draaiend rondje in het midden.
// Dat is de goedkoopste laadtoestand die er is, en hij doet drie dingen verkeerd.
//
// 1. HIJ ZEGT NIETS OVER WAT ER KOMT. Een skelet in de vorm van het eindresultaat laat de lezer
//    de bladspiegel al lezen: hier komt een tabel, daar een grafiek, dit wordt één getal. De
//    pagina springt daardoor ook niet op als de data binnenkomt — de ruimte was er al.
//
// 2. HIJ HEEFT GEEN EINDE. Een `groups === null` of `runs === null` betekent in de praktijk
//    "aan het laden" én "de query is nooit teruggekomen" én soms zelfs "er is niets". Op het
//    analysetabblad draaiden twee kaarten na twintig seconden nog steeds — één omdat de query
//    hing, één omdat de lege staat onbereikbaar was. Wie dat ziet weet niet of hij moet wachten
//    of verversen.
//
// 3. HET RONDJE DRAAIT ALTIJD EVEN SNEL. Of het nu tweehonderd milliseconden of dertig seconden
//    duurt: hetzelfde beeld. Terwijl juist het verschil tussen die twee is wat je wilt weten.
//
// Vandaar: een skelet in de vorm van het antwoord, en een termijn. Duurt het langer dan die
// termijn, dan zegt de kaart dat — eerlijk, want na tien seconden wéten we het ook niet, en
// "we weten het niet" is een andere mededeling dan "even geduld".

import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/** Na hoeveel milliseconden een laadtoestand zichzelf traag noemt. */
const TRAAG_NA_MS = 10_000;

/**
 * Eén balkje van het skelet. De puls zit op de achtergrondkleur en niet op de dekking van het
 * element: dekking laat ook de rand en de schaduw eromheen meeademen, en dan pulseert de hele
 * kaart in plaats van de plek waar tekst komt.
 */
function Balk({ breedte, hoogte = 12, className = "" }: { breedte: string; hoogte?: number; className?: string }) {
  return (
    <span
      className={`block rounded-md animate-pulse ${className}`}
      style={{ width: breedte, height: hoogte, background: "var(--spoor-zacht, rgba(15,23,42,0.06))" }}
      aria-hidden
    />
  );
}

/**
 * Vaste maar onregelmatige breedtes. Random zou bij elke render verspringen — dan flikkert het
 * skelet, en dat is precies het tegenovergestelde van rust. Deze reeks leest als tekst omdat de
 * regels ongelijk aflopen, en hij is elke keer dezelfde.
 */
const REGELBREEDTES = ["92%", "78%", "85%", "64%", "88%", "71%", "80%", "58%"];

export type SkeletVorm = "tabel" | "grafiek" | "tekst" | "kaartjes";

/**
 * Het laadvlak van een kaart: een skelet in de vorm die eronder komt.
 *
 * `titel` zet er een kopregel boven die er al staat vóór de data binnen is — die kennen we
 * immers al, en hem verzwijgen zou de lezer laten raden waar hij op wacht.
 */
export function Laadvlak({
  vorm = "tekst",
  regels = 4,
  titel,
  hoogte = 180,
  className = "",
}: {
  vorm?: SkeletVorm;
  /** Aantal regels/rijen bij vorm "tabel" of "tekst". */
  regels?: number;
  titel?: ReactNode;
  /** Hoogte van het grafiekvlak bij vorm "grafiek". */
  hoogte?: number;
  className?: string;
}) {
  const traag = useTraag();

  return (
    <div
      className={`bg-card rounded-xl border border-border shadow-sm overflow-hidden ${className}`}
      // De hele kaart is één statusgebied: een schermlezer hoort "laden" en niet acht losse balkjes.
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {titel && (
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <span className="text-sm font-semibold text-rm-gray">{titel}</span>
          <span className="sr-only">wordt geladen</span>
        </div>
      )}

      <div className="px-5 py-4">
        {vorm === "grafiek" && <GrafiekSkelet hoogte={hoogte} />}
        {vorm === "tabel" && <TabelSkelet regels={regels} />}
        {vorm === "kaartjes" && <KaartjesSkelet aantal={regels} />}
        {vorm === "tekst" && (
          <div className="space-y-2.5">
            {Array.from({ length: regels }, (_, i) => (
              <Balk key={i} breedte={REGELBREEDTES[i % REGELBREEDTES.length]} />
            ))}
          </div>
        )}
      </div>

      {traag && <TraagRegel />}
    </div>
  );
}

/**
 * Balken van ongelijke hoogte op één grondlijn — het silhouet van een staafgrafiek. Een grijs
 * rechthoekje zou net zo goed een afbeelding of een tabel kunnen worden.
 */
const BALKHOOGTES = [0.55, 0.8, 0.42, 0.95, 0.68, 0.5, 0.85, 0.6, 0.75, 0.38, 0.9, 0.62];

function GrafiekSkelet({ hoogte }: { hoogte: number }) {
  return (
    <div className="flex items-end gap-2" style={{ height: hoogte }} aria-hidden>
      {BALKHOOGTES.map((h, i) => (
        <span
          key={i}
          className="flex-1 rounded-t-md animate-pulse"
          style={{ height: `${h * 100}%`, background: "var(--spoor-zacht, rgba(15,23,42,0.06))" }}
        />
      ))}
    </div>
  );
}

/** Een kopregel en dan rijen: de bladspiegel van een tabel, inclusief een smallere laatste kolom. */
function TabelSkelet({ regels }: { regels: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex items-center gap-4 pb-2 border-b border-border">
        <Balk breedte="30%" hoogte={9} />
        <span className="flex-1" />
        <Balk breedte="64px" hoogte={9} />
        <Balk breedte="48px" hoogte={9} />
        <Balk breedte="40px" hoogte={9} />
      </div>
      {Array.from({ length: regels }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Balk breedte={REGELBREEDTES[i % REGELBREEDTES.length]} className="max-w-[38%]" />
          <span className="flex-1" />
          <Balk breedte="64px" />
          <Balk breedte="48px" />
          <Balk breedte="40px" />
        </div>
      ))}
    </div>
  );
}

/** Een rij KPI-blokjes: label boven, getal eronder. */
function KaartjesSkelet({ aantal }: { aantal: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-hidden>
      {Array.from({ length: Math.max(2, aantal) }, (_, i) => (
        <div key={i} className="rounded-lg border border-border px-4 py-3 space-y-2">
          <Balk breedte="60%" hoogte={9} />
          <Balk breedte="80%" hoogte={16} />
        </div>
      ))}
    </div>
  );
}

/**
 * Zegt dat het lang duurt, en niet meer dan dat. Geen "er ging iets mis" — dat weten we niet;
 * de query kan nog gewoon onderweg zijn. Wél een uitweg, want wachten zonder knop is geen keuze.
 */
function TraagRegel() {
  return (
    <div className="px-5 py-2.5 border-t border-border bg-amber-50/50 flex items-center gap-2 text-meta text-amber-800">
      <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span>Dit duurt langer dan normaal.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ml-auto font-medium underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rm-blue rounded-sm"
      >
        Opnieuw laden
      </button>
    </div>
  );
}

/**
 * Wordt `true` zodra het laden langer duurt dan de termijn. Losstaand bruikbaar voor plekken die
 * hun eigen laadvorm hebben maar wel dezelfde eerlijkheid moeten tonen.
 */
export function useTraag(naMs: number = TRAAG_NA_MS): boolean {
  const [traag, setTraag] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTraag(true), naMs);
    return () => clearTimeout(t);
  }, [naMs]);
  return traag;
}

/**
 * Het kleine broertje: een regel skelet zonder kaart eromheen, voor plekken die al ín een kaart
 * zitten. Neemt de hoogte in die de inhoud straks ook neemt, zodat er niets verspringt.
 */
export function Laadregels({ regels = 3, className = "" }: { regels?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-busy="true">
      <span className="sr-only">wordt geladen</span>
      {Array.from({ length: regels }, (_, i) => (
        <Balk key={i} breedte={REGELBREEDTES[i % REGELBREEDTES.length]} />
      ))}
    </div>
  );
}
