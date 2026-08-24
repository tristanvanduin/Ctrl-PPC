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
  betalingstermijnDagen: null,
  opzegtermijn: null,
  aansprakelijkheidscapMaanden: null,
  aansprakelijkheidscapMaximum: null,
  wijzigingstermijnDagen: null,
  overmachtstermijnDagen: null,
  cookiegebruik: null,
  cookieInstellingen: null,
  supabaseRegio: null,
  vercelRegio: null,
  versie: null,
  laatstGewijzigd: null,
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
};

/** Elk veld dat gevuld moet zijn voordat een document definitief mag heten. */
export const VERPLICHTE_VELDEN = (Object.keys(VELDLABELS) as (keyof Bedrijfsgegevens)[]).filter(
  (v) => v !== "aansprakelijkheidscapMaximum"
);

/** De verplichte velden die nog leeg zijn, in de volgorde van VELDLABELS. */
export function ontbrekendeVelden(
  gegevens: Bedrijfsgegevens = BEDRIJFSGEGEVENS
): (keyof Bedrijfsgegevens)[] {
  return VERPLICHTE_VELDEN.filter((veld) => {
    const waarde = gegevens[veld];
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
