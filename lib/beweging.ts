"use client";

// Bewegingstokens voor code die niet via CSS beweegt (recharts). Dezelfde drie duren als in
// app/globals.css (@theme: --duur-kort/-middel/-lang), zodat er één woordenschat is:
//   kort   120 ms  hover, focus, een kleur die verspringt
//   middel 200 ms  in- en uitklappen, een paneel dat opent
//   lang   300 ms  een wissel van data: een reeks die naar zijn nieuwe vorm gaat
//
// Waarom dit bestaat. Er stonden vijf losse duren met drie curven door elkaar en geen enkel
// token; recharts draaide op zijn standaard van 1500 ms en groeide bij de EERSTE render in vanaf
// nul, terwijl de data er al stond. Dat is beweging zonder reden: de gebruiker heeft niets gedaan.
// Beweging hoort een antwoord te zijn op een handeling (bouwplan fase 0).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

export const DUUR = { kort: 120, middel: 200, lang: 300 } as const;

// ── De opbouw van de bovenkant van het Overzicht (bouwplan fase 3) ──────────────────────────────
//
// Twee harde grenzen, geen smaak: een opbouw van een seconde bij elke wissel is na een dag
// storend. Bij het EERSTE bezoek in een sessie mogen de blokken na elkaar binnenkomen, samen in
// hooguit 600 ms; bij een WISSEL (kanaal, periode) beweegt alleen wat verandert, in hooguit 400 ms.
// Geen vierde duur: elk blok doet er DUUR.lang over, en alleen de vertraging ervoor verschilt.
export const OPBOUW_MAX = { eerst: 600, wissel: 400 } as const;

/**
 * Hoe lang blok `index` van `aantal` wacht voor het binnenkomt, in ms: gelijk verdeeld over wat er
 * na DUUR.lang van de grens overblijft, zodat ook het laatste blok binnen de grens stilstaat.
 * Bij een wissel is die ruimte 100 ms; een blok dat alleen van waarde verandert (een cijfer dat
 * telt, een staaf die groeit) wacht niet en krijgt 0.
 */
export function opbouwVertraging(index: number, aantal: number, soort: keyof typeof OPBOUW_MAX = "eerst"): number {
  const ruimte = Math.max(0, OPBOUW_MAX[soort] - DUUR.lang);
  if (aantal <= 1 || index <= 0) return 0;
  return Math.round((ruimte * Math.min(index, aantal - 1)) / (aantal - 1));
}

// Eén keer per sessie, niet per klant en niet per tabblad: wie van klant naar klant klikt, heeft de
// opbouw gezien. sessionStorage en geen localStorage: een nieuwe sessie (morgen, een nieuw venster)
// is weer een eerste bezoek. Zonder opslag (privémodus met geblokkeerde opslag) geen opbouw: liever
// stil dan bij elke navigatie opnieuw.
const OPBOUW_SLEUTEL = "overzicht-opbouw-gezien";
let eersteBezoek: boolean | null = null;

function leesEersteBezoek(): boolean {
  if (eersteBezoek === null) {
    try { eersteBezoek = window.sessionStorage.getItem(OPBOUW_SLEUTEL) === null; } catch { eersteBezoek = false; }
  }
  return eersteBezoek;
}

/** Zet vast dat de opbouw in deze sessie gezien is; een volgende mount speelt hem niet meer. */
function markeerOpbouwGezien(): void {
  eersteBezoek = false;
  try { window.sessionStorage.setItem(OPBOUW_SLEUTEL, "1"); } catch { /* geen opslag: de module onthoudt het */ }
}

/**
 * Of de opbouw van het eerste bezoek NU gespeeld moet worden.
 *
 * `actief` zegt dat de inhoud er staat (de cijfers zijn binnen): een laadvlak bouwt niet op. Vanaf
 * dat moment is `speel` true tot `klaar()` is aangeroepen (het laatste blok staat stil), en daarna
 * in deze sessie nooit meer, ook niet op een andere klant. Nooit bij "minder beweging".
 *
 * Het eerste bezoek wordt bij de mount vastgelegd en niet in een effect erna: wie de nieuwe
 * weergave aanzet terwijl de cijfers er al staan, zag ze anders eerst verschijnen, dan verdwijnen
 * en dan opbouwen. Op de server is het antwoord altijd nee; dat geeft geen ander beeld, want bij
 * het hydrateren is de data er nog niet en draagt dus geen enkel blok de klasse.
 */
export function useEersteOpbouw(actief: boolean): { speel: boolean; klaar: () => void } {
  const minder = useMinderBeweging();
  const [eerste] = useState(() => typeof window !== "undefined" && leesEersteBezoek());
  const [gespeeld, setGespeeld] = useState(false);
  // Gezien zodra hij begint, niet pas als hij klaar is: wie halverwege wegklikt, heeft hem gezien.
  useEffect(() => { if (actief && eerste) markeerOpbouwGezien(); }, [actief, eerste]);
  const klaar = useCallback(() => setGespeeld(true), []);
  return { speel: eerste && actief && !gespeeld && !minder, klaar };
}

const QUERY = "(prefers-reduced-motion: reduce)";

function abonneer(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True als het besturingssysteem om minder beweging vraagt. Op de server altijd false. */
export function useMinderBeweging(): boolean {
  return useSyncExternalStore(
    abonneer,
    () => (typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches),
    () => false,
  );
}

export interface GrafiekBeweging {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: "ease-in-out";
}

/**
 * De bewegingsprops voor een recharts-reeks (<Bar>, <Line>, <Area>): niet ingroeien bij de
 * eerste render, daarna 300 ms ease-in-out bij elke wissel van data, en helemaal niet als de
 * gebruiker om minder beweging vraagt. Spreiden op de reeks: `<Line {...beweging} ... />`.
 *
 * De eerste render herkennen we aan een ref die ná de eerste commit omgaat: de render die op een
 * datawissel volgt, leest dan false en animeert. Een hover of een andere her-render zonder nieuwe
 * data animeert sowieso niet; recharts beweegt alleen als de reeks verandert.
 */
export function useGrafiekBeweging(): GrafiekBeweging {
  const eerste = useRef(true);
  const minder = useMinderBeweging();
  useEffect(() => { eerste.current = false; }, []);
  return { isAnimationActive: !eerste.current && !minder, animationDuration: DUUR.lang, animationEasing: "ease-in-out" };
}

// ── Een kerncijfer dat naar zijn nieuwe waarde telt ─────────────────────────────────────────────
//
// Waarom. Bij een wissel van kanaal of periode sprongen de vijf kerncijfers in één beeldje naar
// hun nieuwe waarde. Er veranderde dan van alles, maar niets wees aan WAT, of in welke richting.
// Een cijfer dat in hooguit 300 ms van 1.246 naar 1.650 loopt, laat zien dat het omhoog ging en
// dat het dit cijfer was (bouwplan fase 2). Alleen als antwoord op een handeling: niet bij de
// eerste render (toen deed de gebruiker niets), en niet voor wie om minder beweging vraagt.
//
// De tegels krijgen hun waarde als opgemaakte tekst ("€ 1.234", "2,41×", "12,3%"). De telling
// leest het getal daaruit, loopt ertussen en schrijft het in dezelfde opmaak terug; het laatste
// beeldje is letterlijk de doeltekst, dus de eindwaarde is exact wat de aanroeper gaf en nooit een
// afronding van de telling.

interface OntleedGetal {
  voor: string;
  getal: number;
  decimalen: number;
  /** Of het getal punten tussen de duizendtallen heeft; null als dat niet te zien is (onder 1.000). */
  groepen: boolean | null;
  na: string;
}

// Nederlandse opmaak: punt tussen duizendtallen, komma voor de decimalen. Precies één getal, met
// hooguit tekst ervoor en erna; "3 van 5" of "2.5" (een punt als decimaalteken) is geen kandidaat.
const GETAL = /^(\D*?)(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\D*)$/;

/** Het ene getal in een opgemaakte tekst, met wat ervoor en erna staat. null = niets om te tellen. */
export function ontleedGetal(tekst: string): OntleedGetal | null {
  const m = GETAL.exec(tekst);
  if (!m) return null;
  const [, voor, min, heel, dec = "", na] = m;
  const getal = Number(`${min}${heel.replace(/\./g, "")}${dec ? `.${dec}` : ""}`);
  if (!Number.isFinite(getal)) return null;
  const groepen = heel.includes(".") ? true : heel.length > 3 ? false : null;
  return { voor, getal, decimalen: dec.length, groepen, na };
}

/**
 * De tekst op een fractie `t` (0 tot 1) van de weg van `van` naar `naar`.
 *
 * Bij t >= 1 letterlijk `naar`. Valt er niet te tellen (geen getal aan een van beide kanten, of
 * iets anders ervoor of erna: van "€ 12" naar "12%" is geen beweging van één cijfer), dan ook
 * meteen `naar`: liever een sprong dan een verzonnen tussenstand.
 */
export function tussenTekst(van: string, naar: string, t: number): string {
  if (t >= 1 || van === naar) return naar;
  const a = ontleedGetal(van);
  const b = ontleedGetal(naar);
  if (!a || !b || a.voor !== b.voor || a.na !== b.na) return naar;
  const waarde = a.getal + (b.getal - a.getal) * Math.max(0, t);
  return `${b.voor}${telOpmaak(b.decimalen, b.groepen ?? a.groepen ?? true).format(waarde)}${b.na}`;
}

// De opmaak per (decimalen, groepen), één keer gemaakt. tussenTekst loopt per kerncijfer per
// beeldje (useTellendeTekst hieronder), en maakte elke keer een nieuwe Intl.NumberFormat: bij vijf
// tegels en vier kaarten enkele honderden per wissel, in precies de 300 ms waarin de pagina ook
// het nieuwe tabblad opbouwt. Dezelfde opties, dus dezelfde tekst.
const telOpmaken = new Map<string, Intl.NumberFormat>();
function telOpmaak(decimalen: number, groepen: boolean): Intl.NumberFormat {
  const sleutel = `${decimalen}|${groepen}`;
  let opmaak = telOpmaken.get(sleutel);
  if (!opmaak) {
    opmaak = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: decimalen, maximumFractionDigits: decimalen, useGrouping: groepen });
    telOpmaken.set(sleutel, opmaak);
  }
  return opmaak;
}

// Snel weg en rustig aankomen: het oog volgt de eerste sprong en leest het cijfer als het stilvalt.
const uitlopen = (t: number): number => 1 - (1 - t) ** 3;

/**
 * De tekst die een kerncijfer NU toont: bij een nieuwe waarde telt hij er in hooguit `duur`
 * (standaard DUUR.lang, 300 ms) naartoe, vanaf wat er op dat moment stond. De trechter telt in
 * DUUR.middel (200 ms), gelijk met zijn balken.
 *
 * - Eerste render: de waarde zelf, geen telling.
 * - Minder beweging (of geen requestAnimationFrame): de nieuwe waarde direct.
 * - Komt er onderweg weer een nieuwe waarde, dan telt hij verder vanaf de tussenstand.
 *
 * useLayoutEffect en geen useEffect: de telling moet beginnen vóór het beeld getekend wordt.
 * Anders staat de nieuwe waarde er één beeldje, springt hij terug naar de oude, en telt hij dan
 * pas: beweging die niets aanwijst.
 */
export function useTellendeTekst(doel: string, duur: number = DUUR.lang): string {
  const minder = useMinderBeweging();
  // Wat er loopt: van welke tekst, naar welke, en hoe ver. null = er loopt niets.
  const [telling, setTelling] = useState<{ naar: string; tekst: string } | null>(null);
  const vorigDoel = useRef(doel);
  const getoond = useRef(doel);
  // Via een ref en niet als afhankelijkheid van het effect: de voorkeur telt op het moment dat een
  // telling begint. Als afhankelijkheid brak een wissel van de voorkeur een lopende telling af
  // zonder hem af te maken, en bleef de tussenstand staan.
  const minderNu = useRef(minder);
  useLayoutEffect(() => { minderNu.current = minder; }, [minder]);

  useLayoutEffect(() => {
    const van = getoond.current;
    if (vorigDoel.current === doel) return;
    vorigDoel.current = doel;
    const kanTellen = !minderNu.current && typeof requestAnimationFrame === "function" && tussenTekst(van, doel, 0) !== doel;
    if (!kanTellen) { getoond.current = doel; setTelling(null); return; }
    setTelling({ naar: doel, tekst: van });
    let begin: number | null = null;
    let raf = requestAnimationFrame(function stap(nu: number) {
      if (begin === null) begin = nu;
      const t = Math.min(1, (nu - begin) / duur);
      const tekst = tussenTekst(van, doel, uitlopen(t));
      getoond.current = tekst;
      if (t >= 1) { setTelling(null); return; }
      setTelling({ naar: doel, tekst });
      raf = requestAnimationFrame(stap);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- de duur telt bij het begin van een telling, zoals de voorkeur
  }, [doel]);

  // Een telling hoort bij het doel waarvoor hij begon. Is het doel alweer anders (deze render),
  // dan toont hij nog één beeldje de tussenstand en neemt het effect hierboven het over.
  return telling ? telling.tekst : doel;
}
