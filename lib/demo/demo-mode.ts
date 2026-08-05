// Gedeelde demo-mode-detectie: via ?demo=1 in de URL óf de env-flag NEXT_PUBLIC_DEMO_MODE.
// Puur voor review/presentatie zonder live data of keys. Eén bron zodat elke plek dezelfde
// beslissing neemt (Vandaag-feed, klantenlijst, data-invoerpunten).
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

const SLEUTEL = "ctrl-ppc-demo";

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
    return window.sessionStorage.getItem(SLEUTEL) === "1";
  } catch {
    // Privémodus of geblokkeerde opslag: dan valt hij terug op alleen de URL, zoals hiervoor.
    try {
      return new URLSearchParams(window.location.search).get("demo") === "1";
    } catch {
      return false;
    }
  }
}
