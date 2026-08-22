// Gedeelde demo-mode-detectie: via ?demo=1 in de URL, het pad zelf (/client/<demo-klant>), óf de
// env-flag NEXT_PUBLIC_DEMO_MODE. Puur voor review/presentatie zonder live data of keys. Eén bron
// zodat elke plek dezelfde beslissing neemt (Vandaag-feed, klantenlijst, data-invoerpunten).
//
// ── WAAROM DE VLAG BLIJFT PLAKKEN BINNEN HET TABBLAD ────────────────────────
//
// Hij las alleen de huidige URL. Dat werkt zolang je op één pagina blijft, en breekt zodra je
// klikt: de klantenlijst en de zijbalk linken naar /client/<id>, zonder queryparameters. Wie de
// demo opende op /clients?demo=1 en op de klant klikte, kwam dus op een dashboard ZONDER
// demo-modus -- dat vraagt de echte Supabase, en zonder sleutels is dat een leeg scherm.
//
// Gezien in een doorloop: de lijst werkte, de klik erna niet. Dat is precies wat een collega als
// eerste doet.
//
// De vlag in elke link meegeven zou werken, maar dan moet ELKE link eraan denken -- inclusief de
// volgende die iemand toevoegt. Hier vastleggen is één plek en geldt overal.
//
// sessionStorage en niet localStorage: het geldt voor dit tabblad en niet voor altijd. Sluit je
// het tabblad, dan ben je de demo kwijt, en dat is het gedrag dat je wilt. Aanzetten kan alleen
// bewust met ?demo=1; uitzetten met ?demo=0, zodat het geen val is.
//
// ── WAAROM HET PAD OOK TELT, NIET ALLEEN ?demo=1 ────────────────────────────
//
// lib/supabase.ts's export const supabase wordt ÉÉN KEER berekend, bij het laden van die module --
// niet opnieuw bij elke render. Wie in een verse tab rechtstreeks naar /client/demo-greentech
// navigeert (bookmark, tweede tabblad, direct getypte URL) zonder ?demo=1, laat isDemoMode() op
// dat allereerste moment "false" teruggeven; de singleton bevriest dan voorgoed op de ECHTE
// (hier ongeconfigureerde) client, en geen latere ?demo=1 of sessionStorage-wijziging haalt hem
// daar nog uit voor de rest van die tab. supabaseForClient() op de server heeft dit probleem niet
// (die kijkt bij elk verzoek opnieuw naar clientId), maar de client-side singleton wel -- vandaar
// de melding "Supabase is niet geconfigureerd" op onderdelen die deze singleton gebruiken, terwijl
// componenten die via de server lazen gewoon demo-cijfers toonden. Het pad zelf is op dat eerste,
// synchrone moment al bekend (window.location.pathname), dus die telt hier net zo hard mee als de
// queryparameter.

import { GEOCLONE_DEMO_IDS } from "./geoclone-clients";

const SLEUTEL = "ctrl-ppc-demo";

/** Is dit een demo-klant-id: GreenTech zelf of een van de geo-klonen (GRT/GRA/GRN). */
function isDemoClientId(id: string): boolean {
  const bare = id.replace(/^gads-/, "");
  return bare === "demo-greentech" || GEOCLONE_DEMO_IDS.includes(bare);
}

/** De demo-klant-id in /client/<id>(/...), of null als het huidige pad daar niet op lijkt. */
function demoClientIdInPath(pathname: string): string | null {
  const match = /\/client\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return isDemoClientId(id) ? id : null;
}

// 22 augustus 2026: de Decision Terminal (components/terminal/decision-terminal-page.tsx) draagt
// de klant bewust NIET in het pad maar in ?client= (zie de toelichting daar: geen eigen route per
// klant, één pagina). demoClientIdInPath hierboven kende alleen /client/<id> en miste dat, dus
// gaf isDemoMode() op een verse tab op /decision-terminal?client=demo-greentech "false" terug --
// exact het patroon dat hierboven al is gedocumenteerd voor het pad, nu via de querystring. Zichtbaar
// gevolg: de hoofdinhoud (die zelf clientId al uit de URL leest) toonde gewoon demodata, maar de
// zijbalk eromheen -- die via getAllClients()/isDemoMode() loopt -- toonde "KLANTEN (0)".
function demoClientIdInQuery(search: string): string | null {
  const id = new URLSearchParams(search).get("client");
  if (!id) return null;
  return isDemoClientId(id) ? id : null;
}

export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("demo");
    if (param === "1") {
      window.sessionStorage.setItem(SLEUTEL, "1");
      return true;
    }
    // Een expliciete uitweg. Zonder dit zit je tot het einde van het tabblad vast aan demodata,
    // en dat is een val in plaats van een hulpmiddel.
    if (param === "0") {
      window.sessionStorage.removeItem(SLEUTEL);
      return false;
    }
    if (window.sessionStorage.getItem(SLEUTEL) === "1") return true;
    if (demoClientIdInPath(window.location.pathname) || demoClientIdInQuery(window.location.search)) {
      window.sessionStorage.setItem(SLEUTEL, "1");
      return true;
    }
    return false;
  } catch {
    // Privémodus of geblokkeerde opslag: dan valt hij terug op alleen de URL, zoals hiervoor.
    try {
      const param = new URLSearchParams(window.location.search).get("demo");
      if (param === "1") return true;
      if (param === "0") return false;
      return demoClientIdInPath(window.location.pathname) !== null || demoClientIdInQuery(window.location.search) !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Of DIT account (los van de sessievlag) een demo-klant is: GreenTech zelf of een van de
 * geo-klonen. isDemoMode() hierboven leest de sessie/URL/pad, maar weet zonder clientId niet
 * WELKE klant het over heeft -- deze combineert dat met de al-bekende clientId, voor componenten
 * die die al binnen handbereik hebben.
 */
export function isDemoClient(clientId: string | null | undefined): boolean {
  if (!clientId) return isDemoMode();
  return isDemoMode() || isDemoClientId(clientId);
}
