/**
 * De bedrijfs- en contractgegevens die de juridische documenten invullen.
 *
 * WAAROM DIT BESTAND BESTAAT. De brontekst van het Privacy Statement en de Algemene Voorwaarden
 * (docs/juridisch/) is inhoudelijk af, maar staat vol met vierkante haken: [KVK-NUMMER],
 * [BETALINGSTERMIJN, bijv. 14], [ARRONDISSEMENT]. Dat zijn geen schrijffouten maar bewust
 * openstaande beslissingen -- feiten over de onderneming en het contract die alleen de eigenaar
 * kan invullen. Zolang ze openstaan is het document een concept, hoe compleet de rest ook is.
 *
 * De verleiding is om die waarden op ~20 plekken in de paginatekst te typen zodra ze bekend zijn.
 * Dat geeft twee bronnen (de markdown in docs/juridisch/ en de pagina) die stilzwijgend uit
 * elkaar gaan lopen, en precies bij een juridisch document is "welke versie geldt nu eigenlijk"
 * de duurste vraag die je kunt oproepen. Daarom staat elk openstaand gegeven hier één keer, en
 * leidt de pagina er alles uit af: de tekst zelf, of het document als concept of als definitief
 * wordt gepresenteerd, of zoekmachines hem mogen indexeren, en of hij in de sitemap staat.
 *
 * ZO ZET JE DE PAGINA'S LIVE: vul hieronder de waarden in (null -> echte waarde). Zodra elk
 * verplicht veld gevuld is, verdwijnt de conceptbanner, gaan de pagina's van noindex naar
 * indexeerbaar en verschijnen ze in de sitemap. Er is verder niets aan te passen. Blijft er één
 * veld op null staan, dan blijft de hele pagina als concept gemarkeerd -- dat is opzet: een
 * juridisch document dat er definitief uitziet maar nog een gat heeft, is erger dan een document
 * dat eerlijk zegt dat het nog niet af is.
 */

export interface Bedrijfsgegevens {
  /** Statutaire naam of handelsnaam waaronder gecontracteerd wordt. */
  handelsnaam: string | null;
  /** Plaats van vestiging, zoals in het KvK-register. */
  vestigingsplaats: string | null;
  /** Volledig postadres, voor de contactparagraaf van het Privacy Statement. */
  vestigingsadres: string | null;
  kvkNummer: string | null;
  btwNummer: string | null;
  /** Het adres waar AVG-verzoeken en vragen over de voorwaarden binnenkomen. */
  contactEmail: string | null;
  /** Arrondissement van de bevoegde rechter (art. 16 AV). */
  arrondissement: string | null;
  /** Betalingstermijn in dagen na factuurdatum (art. 11 lid 3 AV). */
  betalingstermijnDagen: number | null;
  /** Opzegtermijn in woorden, bijv. "één kalendermaand" (art. 12 lid 2 AV). */
  opzegtermijn: string | null;
  /** Over hoeveel maanden betaalde vergoeding de aansprakelijkheid wordt afgetopt (art. 13 lid 1). */
  aansprakelijkheidscapMaanden: number | null;
  /**
   * Optioneel absoluut maximum per kalenderjaar, als tekst inclusief valuta ("€ 25.000").
   * Uitdrukkelijk NIET verplicht: de brontekst noemt hem zelf optioneel, en een cap op basis van
   * betaalde vergoeding staat ook zonder absoluut plafond. Blijft dit null, dan laat de pagina de
   * hele bijzin weg -- er komt geen gat en geen conceptmarkering voor in de plaats.
   */
  aansprakelijkheidscapMaximum: string | null;
  /** Aankondigingstermijn in dagen voor tariefs- en voorwaardenwijzigingen (art. 11 lid 5, 15 lid 1). */
  wijzigingstermijnDagen: number | null;
  /** Na hoeveel dagen overmacht elk der partijen mag ontbinden (art. 14 lid 2 AV). */
  overmachtstermijnDagen: number | null;
  /**
   * Welke cookiecategorieën de website daadwerkelijk plaatst, als lopende opsomming
   * ("functionele en analytische"). Moet overeenkomen met wat er echt staat -- dit is de
   * bewering waar een toezichthouder als eerste op toetst.
   */
  cookiegebruik: string | null;
  /** Waar een bezoeker zijn cookietoestemming intrekt ("de cookiebanner onderaan elke pagina"). */
  cookieInstellingen: string | null;
  /** Hostingregio van Supabase, plus doorgiftemechanisme als die buiten de EER ligt. */
  supabaseRegio: string | null;
  /** Idem voor Vercel. */
  vercelRegio: string | null;
  /** Versienummer van de documenten, bijv. "1.0". */
  versie: string | null;
  /** Datum van de laatste wijziging, als ISO-datum (YYYY-MM-DD). */
  laatstGewijzigd: string | null;
  /**
   * Zijn de commerciële termijnen hieronder (betaling, opzegging, aansprakelijkheidscap,
   * aankondiging, overmacht) door de eigenaar bevestigd?
   *
   * Ze staan ingevuld met conventionele waarden, zodat de tekst leesbaar is en de pagina niet
   * op vijf plekken een gat toont voor beslissingen waar een gangbaar antwoord op bestaat. Maar
   * ingevuld is niet hetzelfde als besloten: dit zijn de bedragen en termijnen waar Opdrachtgever
   * zich straks op beroept. Zonder deze vlag op true zou een voorstel van mij stilzwijgend een
   * afspraak worden zodra de laatste bedrijfsgegevens binnen zijn -- precies het soort
   * onopgemerkte overgang waar de conceptpoort voor bedoeld is.
   */
  contractvoorwaardenBevestigd: boolean;
}

/**
 * NIETS INGEVULD, EN DAT IS DE HUIDIGE STAND. De brontekst is op 20 augustus 2026 tegen de
 * codebase geverifieerd, maar deze feiten zijn nooit vastgelegd. Vul ze in zodra ze bekend zijn;
 * verzin ze niet -- een verkeerd KvK-nummer of een verzonnen betalingstermijn in een document dat
 * "Algemene Voorwaarden" heet is een groter probleem dan een zichtbaar concept.
 */
export const BEDRIJFSGEGEVENS: Bedrijfsgegevens = {
  handelsnaam: null,
  vestigingsplaats: null,
  vestigingsadres: null,
  kvkNummer: null,
  btwNummer: null,
  contactEmail: null,
  arrondissement: null,
  // De vijf termijnen hieronder staan op conventionele waarden, NIET op een besluit. Zie
  // contractvoorwaardenBevestigd: zolang die op false staat blijft het document een concept,
  // ook als al het andere gevuld is. Pas ze aan waar je iets anders wilt, en zet dan de vlag om.
  betalingstermijnDagen: 14,
  opzegtermijn: "één kalendermaand",
  aansprakelijkheidscapMaanden: 12,
  aansprakelijkheidscapMaximum: null,
  wijzigingstermijnDagen: 30,
  overmachtstermijnDagen: 60,
  cookiegebruik: null,
  cookieInstellingen: null,
  supabaseRegio: null,
  vercelRegio: null,
  versie: null,
  laatstGewijzigd: null,
  contractvoorwaardenBevestigd: false,
};

/**
 * Wat er per openstaand veld aan de bezoeker wordt getoond zolang het leeg is, en wat het
 * dashboard-loze alternatief is voor "even in het document zoeken waar de gaten zitten".
 * aansprakelijkheidscapMaximum staat hier bewust niet in: zie het commentaar bij het veld.
 */
export const VELDLABELS: Record<keyof Bedrijfsgegevens, string> = {
  handelsnaam: "handelsnaam",
  vestigingsplaats: "vestigingsplaats",
  vestigingsadres: "vestigingsadres",
  kvkNummer: "KvK-nummer",
  btwNummer: "BTW-nummer",
  contactEmail: "contact-e-mailadres",
  arrondissement: "bevoegde rechtbank",
  betalingstermijnDagen: "betalingstermijn",
  opzegtermijn: "opzegtermijn",
  aansprakelijkheidscapMaanden: "aansprakelijkheidscap (aantal maanden)",
  aansprakelijkheidscapMaximum: "absoluut aansprakelijkheidsmaximum (optioneel)",
  wijzigingstermijnDagen: "aankondigingstermijn wijzigingen",
  overmachtstermijnDagen: "overmachtstermijn",
  cookiegebruik: "daadwerkelijk cookiegebruik",
  cookieInstellingen: "waar toestemming wordt ingetrokken",
  supabaseRegio: "hostingregio Supabase",
  vercelRegio: "hostingregio Vercel",
  versie: "versienummer",
  laatstGewijzigd: "datum laatste wijziging",
  contractvoorwaardenBevestigd: "akkoord op de contracttermijnen",
};

/**
 * Velden die het document NIET tegenhouden, met de reden per stuk. Alles wat hier niet in staat
 * is verplicht. Deze lijst hoort kort te blijven: elke uitzondering is een stukje document dat
 * definitief kan heten terwijl het onvolledig is.
 */
export const NIET_BLOKKEREND = new Map<keyof Bedrijfsgegevens, string>([
  // De brontekst noemt dit maximum zelf optioneel; een cap op basis van betaalde vergoeding
  // staat ook zonder absoluut plafond. Leeg betekent hier "geldt niet", niet "weten we nog niet".
  ["aansprakelijkheidscapMaximum", "art. 13 lid 1 noemt dit maximum zelf optioneel"],

  // KvK en BTW: op verzoek van de eigenaar (24 augustus 2026) niet blokkerend, zodat de pagina's
  // definitief kunnen zijn voordat de onderneming is ingeschreven.
  //
  // LET OP WAT DIT WEL EN NIET BETEKENT. Voor de AVG is het in orde: art. 13 vraagt om de
  // identiteit en contactgegevens van de verwerkingsverantwoordelijke -- naam, adres, een
  // werkend contactadres -- en niet om een registratienummer. Die drie blijven verplicht.
  //
  // Maar art. 3:15d BW (de e-commercebepaling) verplicht wie online een dienst aanbiedt wél om
  // handelsregisternummer en BTW-identificatienummer permanent en makkelijk vindbaar te tonen.
  // BEN JE INGESCHREVEN, DAN HOREN ZE ER DUS OP, en publiceren zonder is een bewuste
  // tekortkoming en geen vergetelheid. Ze staan om die reden nog steeds in de tekst: zolang ze
  // leeg zijn toont de pagina op die plek een zichtbare markering, alleen blokkeert hij de
  // publicatie niet meer.
  ["kvkNummer", "eigenaar publiceert vooruitlopend op inschrijving; art. 3:15d BW vraagt hem wél"],
  ["btwNummer", "zelfde reden als kvkNummer: nog geen inschrijving, art. 3:15d BW vraagt hem wél"],
]);

/** Elk veld dat gevuld moet zijn voordat een document definitief mag heten. */
export const VERPLICHTE_VELDEN = (Object.keys(VELDLABELS) as (keyof Bedrijfsgegevens)[]).filter(
  (v) => !NIET_BLOKKEREND.has(v)
);

/**
 * De verplichte velden die nog leeg zijn, in de volgorde van VELDLABELS.
 *
 * contractvoorwaardenBevestigd is een boolean en geen tekst: `false` is dáár de lege waarde, en
 * niet een ingevulde "nee". Zonder dit onderscheid zou de vlag als ingevuld tellen zodra hij
 * bestaat, en dan bewaakt hij niets.
 */
export function ontbrekendeVelden(
  gegevens: Bedrijfsgegevens = BEDRIJFSGEGEVENS
): (keyof Bedrijfsgegevens)[] {
  return VERPLICHTE_VELDEN.filter((veld) => {
    const waarde = gegevens[veld];
    if (typeof waarde === "boolean") return !waarde;
    return waarde === null || waarde === undefined || `${waarde}`.trim() === "";
  });
}

/**
 * Is het document definitief? Alleen dan mag het zonder conceptbanner getoond, geïndexeerd en in
 * de sitemap opgenomen worden. Eén functie, drie call-sites -- geen drie losse controles die uit
 * elkaar kunnen lopen.
 */
export function isDefinitief(gegevens: Bedrijfsgegevens = BEDRIJFSGEGEVENS): boolean {
  return ontbrekendeVelden(gegevens).length === 0;
}
