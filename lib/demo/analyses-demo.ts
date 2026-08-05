// Uitgevoerde analyses voor de demo-klant.
//
// ── WAAROM DIT ER IS ────────────────────────────────────────────────────────
//
// Het tabblad Analyse & advies liet twintig analyses zien die allemaal op "nog niet gedraaid"
// stonden. Dat is eerlijk -- er waren geen rijen -- maar het toont van het hele analysedeel van
// het product precies niets. Voor iemand die de demo voor het eerst ziet is dat de helft van het
// verhaal die ontbreekt.
//
// ── WAAROM DRIE EN NIET TWINTIG ─────────────────────────────────────────────
//
// Twintig gevulde analyses zijn twintig teksten die onderling moeten kloppen, en elke tekst die
// niet strookt met de cijfers op het scherm is erger dan een lege lijst: dan betrapt je publiek
// je op een verzinsel. Deze drie zijn gekozen omdat ze alle drie leunen op cijfers die ELDERS OP
// HETZELFDE SCHERM staan en dus na te rekenen zijn:
//
//   Budgetallocatie   de impression-share-cijfers van de vier searchcampagnes
//   Video & PMax      de netwerkverdeling (Maps/Zoeken) en het eerste kwartiel van de video
//   Landen & staten   de ranglijst naast de wereldkaart
//
// De rest blijft bewust op "nog niet gedraaid". Dat is geen gat maar de eerlijke stand: dit is een
// demo-account, niet een account waarop twintig analyses zijn gedraaid.
//
// ── DE CIJFERS ZIJN NIET VERZONNEN ──────────────────────────────────────────
//
// Ze komen uit dezelfde bronnen als de schermen: greentech-mock (impression share, campagnes),
// pmax-video-demo (netwerkverdeling, kwartielen) en geo-demo (landen). Wie in de demo doorklikt
// van de analyse naar de onderliggende kaart, moet daar hetzelfde getal vinden.

type Row = Record<string, unknown>;

/** De sectienamen komen letterlijk uit lib/analysis/analysis-catalog.ts. */
const ANALYSES: { section: string; output: string }[] = [
  {
    section: "budget_allocation_v1",
    output: `## Budgetallocatie — waar het budget meer kan doen

**De bevinding.** GRT | Search | NL verliest 28% impressieaandeel aan budget en draait op 97% van
zijn dagbudget. GRA | Search | US verliest 22% aan RANG en gebruikt 70% van zijn budget. Dat zijn
twee verschillende problemen die om het tegenovergestelde vragen.

**Wat dat betekent.** Verlies aan budget is een kraan die dicht staat: de veiling is gewonnen, het
geld is op. Verlies aan rang is een kwaliteits- of biedprobleem; daar meer budget in stoppen koopt
je niets, want de vertoningen worden niet gemist door geldgebrek.

**Voorstel.**
- Verhoog het dagbudget van GRT | Search | NL met 25% (€ 140 → € 175). Bij een CPA van € 66 en
  ongewijzigde conversieratio is dat ruwweg 50 extra conversies per maand.
- Laat het budget van GRA | Search | US ongemoeid. Pak daar eerst de rang aan: advertentierelevantie
  en landingspagina-ervaring, en pas daarna het bod.
- GRN | Search | Canada verliest 31% aan budget bij 95% benutting — hetzelfde patroon als NL, maar
  op een kleiner volume. Zelfde beweging, kleinere stap.

**Wat dit niet zegt.** Impressieaandeel zegt niets over de winstgevendheid van het extra volume.
De aanname is dat de marginale conversie evenveel waard is als de gemiddelde; dat is bij een
merkcampagne zelden zo en bij een generieke campagne meestal wel.`,
  },
  {
    section: "google_video_v1",
    output: `## Video & Performance Max

**PMax laat het budget lopen waar de conversies niet zitten.** Maps krijgt 34% van het budget en
levert 11,5% van de conversies (CPA € 277). Zoeken krijgt 23% en levert 57,5% (CPA € 38). Dat is
een factor zeven verschil in CPA binnen dezelfde campagne.

De verdeling zelf is geen knop — welk deel naar Maps gaat bepaalt Google. Wat je wél kunt:
- campagne-brede uitsluitingszoekwoorden op de merk- en servicetermen die Maps aantrekken;
- de assets bijsturen, want die bepalen op welke plaatsingen de campagne überhaupt kan draaien;
- klantenlijsten uitsluiten als de Maps-conversies bestaande relaties zijn.

**De video haalt de opening niet.** GRT | YouTube | Awareness NL houdt 42% van de vertoningen vast
tot 25% van de video. Onder de helft betekent dat de eerste seconden geen aandacht vasthouden: een
creatief probleem, geen biedprobleem. De view rate van 28,7% is op zichzelf niet slecht; het verval
zit daarna.

Ter vergelijking: GRT | YouTube | Merkfilm beurs haalt 43,5% view rate en houdt een ruim deel tot
75% vast. Dezelfde doelgroep, ander materiaal. Dat is de aanwijzing dat het aan de opening ligt.

**Voorstel.** Herknip de awareness-video met de belofte in de eerste drie seconden en zet hem als
tweede asset naast de bestaande. Eén meting over twee weken is genoeg om het kwartiel te zien
bewegen.`,
  },
  {
    section: "geo_markets_v1",
    output: `## Landen & staten

**Zeven landen, en de verdeling is scheef op een verklaarbare manier.** Nederland levert 352
conversies, de Verenigde Staten 179, Canada 41, Duitsland 38, het Verenigd Koninkrijk 25 en België
22. Frankrijk levert er nul.

**Frankrijk is het enige echte signaal.** Het draait wel en converteert niet. Bij een beursformule
met een Nederlandse en een internationale editie is dat geen verrassing — er is geen Franstalige
landingspagina en geen Franstalige advertentie — maar het kost wel geld. Twee opties, en de keuze
is een keuze en geen berekening:
- uitsluiten, en het budget naar Duitsland en het VK laten lopen waar de conversie wél landt;
- of bewust investeren, met een Franstalige pagina, en het over twee edities beoordelen.

**Wat er niet aan de hand is.** De CPA van € 72 over alle landen samen ligt in lijn met het
Nederlandse gemiddelde. Er is dus geen markt die de rest meesleept; de spreiding is normaal voor
een internationale beurs met één sterke thuismarkt.

**Let op bij de VS.** De 179 conversies komen uit meerdere staten. Op landniveau lijkt dat één
markt, maar de kosten per staat lopen sterk uiteen. Klik door op de kaart voordat je hier iets
verschuift.`,
  },
];

/**
 * De rijen zoals saveAnalysisOutputSection ze wegschrijft (zie lib/analysis/helpers.ts).
 *
 * De sleutel is (client_id, sop_type, analysis_date, section) — dezelfde als de unieke index in
 * migratie 028, zodat een demo-rij niet anders van vorm is dan een echte.
 */
export function analyseOutputRows(clientId: string, analyseMaand: string, syncedAt: string): Row[] {
  const eind = new Date(`${analyseMaand}-01T00:00:00Z`);
  const start = new Date(Date.UTC(eind.getUTCFullYear(), eind.getUTCMonth() - 5, 1));
  const periodStart = start.toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(eind.getUTCFullYear(), eind.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  return ANALYSES.map((a, i) => ({
    client_id: clientId,
    sop_type: "standalone",
    // Niet alle drie op dezelfde dag: een analyselijst waarin alles op dezelfde datum staat leest
    // als een import en niet als werk dat over de maand verspreid is gedaan.
    analysis_date: new Date(Date.UTC(eind.getUTCFullYear(), eind.getUTCMonth(), 4 + i * 6))
      .toISOString().slice(0, 10),
    period_start: periodStart,
    period_end: periodEnd,
    section: a.section,
    output: a.output,
    model_used: "demo",
    tokens_used: 0,
    created_at: syncedAt,
  }));
}
