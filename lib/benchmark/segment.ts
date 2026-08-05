// ============================================================================
// WAAR EEN KLANT IN VALT: BEDRIJFSMODEL EN NICHE, APART
// ============================================================================
//
// ── WAAROM DIT GESPLITST WORDT ──────────────────────────────────────────────
//
// Er stond één veld `sector` met zeventien keuzes, hardgecodeerd in de JSX van
// client-settings.tsx. Dat veld gooit drie dingen op één hoop:
//
//   b2b_saas               → bedrijfsmodel (b2b) én niche (software)
//   fysiotherapie          → alleen een niche, het model staat er niet in
//   ecommerce_laag_ticket  → bedrijfsmodel (b2c) én een ticketgrootte die AL in
//                            client_settings.aov_segment staat
//
// Voor een benchmark is dat fataal: je kunt niet vragen "hoe doen b2b-accounts het" als het
// antwoord verspreid zit over b2b_saas, b2b_leadgen en de helft van legal en finance. En je kunt
// niet op niche vergelijken als "fysiotherapie" en "zorg_generiek" verschillende diepten zijn.
//
// Vandaar twee velden. Bedrijfsmodel is grofmazig en vult zich snel; niche is fijnmazig en duurt.
//
// ── DE VOLGORDE IS EEN PRODUCTBESLISSING ────────────────────────────────────
//
// Eerst alleen bedrijfsmodel, of alleen niche -- nooit de combinatie, tot de dekking het toelaat.
// Die regel staat in cel.ts, niet hier: dit bestand zegt wat de labels ZIJN, niet wanneer je ze
// mag gebruiken.
//
// ── WAAROM DE LIJST HIER STAAT EN NIET IN DE JSX ────────────────────────────
//
// De keuzelijst en de aggregatie moeten dezelfde waarden kennen. Staat de lijst in een component,
// dan kan de aggregator niet weten welke waarden geldig zijn, en verschijnt er vroeg of laat een
// niche in de data die nergens in een menu staat -- of andersom.

/** Het bedrijfsmodel. Bewust twee waarden en geen "beide": zie de opmerking bij BEDRIJFSMODELLEN. */
export type Bedrijfsmodel = "b2b" | "b2c";

/**
 * Geen "beide" en geen "hybride".
 *
 * Een derde waarde klinkt eerlijker maar maakt een derde vakje dat nooit vol raakt, én hij trekt
 * elke twijfelaar aan -- want "beide" is bijna altijd verdedigbaar. Dan houd je twee dunne
 * segmenten over en een dikke bak "onduidelijk", en dat is precies andersom dan wat je wilt.
 *
 * Wie het echt niet weet, laat het leeg. Leeg is een eerlijke onbekende; "beide" is een antwoord
 * dat geen antwoord is.
 */
export const BEDRIJFSMODELLEN: ReadonlyArray<{ waarde: Bedrijfsmodel; label: string; uitleg: string }> = [
  { waarde: "b2c", label: "B2C", uitleg: "verkoopt aan consumenten" },
  { waarde: "b2b", label: "B2B", uitleg: "verkoopt aan bedrijven" },
];

export interface NicheOptie {
  waarde: string;
  label: string;
  groep: string;
  /** Het model dat er meestal bij hoort; vult het veld voor als de gebruiker het leeg liet. */
  model?: Bedrijfsmodel;
}

/**
 * De niches.
 *
 * Afgeleid uit de zeventien bestaande sectorkeuzes, met het bedrijfsmodel eruit gehaald en de
 * ticketgroottes eruit gelaten -- die staan al in aov_segment en waren daar een duplicaat van.
 *
 * De lijst hoort te GROEIEN, en wel op grond van wat er in het vrije veld terechtkomt: staat er
 * drie keer hetzelfde, dan hoort het hier. Dat is de enige manier om dekking en telbaarheid
 * tegelijk te krijgen -- een vrij veld alleen levert vijf schrijfwijzen van "tandarts" op, en
 * een vaste lijst alleen levert een half ingevulde kolom.
 */
export const NICHES: readonly NicheOptie[] = [
  { waarde: "mode", label: "Mode & kleding", groep: "Retail", model: "b2c" },
  { waarde: "elektronica", label: "Elektronica", groep: "Retail", model: "b2c" },
  { waarde: "huisdieren", label: "Huisdieren", groep: "Retail", model: "b2c" },
  { waarde: "wonen", label: "Wonen & interieur", groep: "Retail", model: "b2c" },
  { waarde: "sport", label: "Sport & outdoor", groep: "Retail", model: "b2c" },
  { waarde: "retail_lokaal", label: "Lokale retail", groep: "Retail", model: "b2c" },

  { waarde: "fysiotherapie", label: "Fysiotherapie", groep: "Zorg", model: "b2c" },
  { waarde: "tandheelkunde", label: "Tandheelkunde", groep: "Zorg", model: "b2c" },
  { waarde: "zorg_overig", label: "Zorg, overig", groep: "Zorg", model: "b2c" },

  { waarde: "software", label: "Software & SaaS", groep: "Zakelijk", model: "b2b" },
  { waarde: "zakelijke_diensten", label: "Zakelijke dienstverlening", groep: "Zakelijk", model: "b2b" },
  { waarde: "industrie", label: "Industrie & productie", groep: "Zakelijk", model: "b2b" },
  { waarde: "groothandel", label: "Groothandel", groep: "Zakelijk", model: "b2b" },
  { waarde: "vakbeurzen", label: "Vakbeurzen & events", groep: "Zakelijk", model: "b2b" },

  { waarde: "juridisch", label: "Juridische dienstverlening", groep: "Dienstverlening" },
  { waarde: "financieel", label: "Financieel & verzekeringen", groep: "Dienstverlening" },
  { waarde: "automotive", label: "Automotive", groep: "Dienstverlening" },
  { waarde: "bouw_installatie", label: "Bouw & installatie", groep: "Dienstverlening" },
  { waarde: "opleidingen", label: "Opleidingen & onderwijs", groep: "Dienstverlening" },
  { waarde: "horeca", label: "Horeca", groep: "Dienstverlening", model: "b2c" },
  { waarde: "reizen", label: "Reizen & recreatie", groep: "Dienstverlening", model: "b2c" },
  { waarde: "diensten_lokaal", label: "Lokale dienstverlening", groep: "Dienstverlening", model: "b2c" },
];

const NICHE_INDEX = new Map(NICHES.map((n) => [n.waarde, n]));

export function isBekendeNiche(waarde: string | null | undefined): boolean {
  return !!waarde && NICHE_INDEX.has(waarde);
}

export function nicheLabel(waarde: string | null | undefined): string | null {
  if (!waarde) return null;
  return NICHE_INDEX.get(waarde)?.label ?? waarde;
}

/** De niches gegroepeerd, in de volgorde waarin de groepen voorkomen. Voor de keuzelijst. */
export function nichesPerGroep(): Array<{ groep: string; opties: NicheOptie[] }> {
  const uit: Array<{ groep: string; opties: NicheOptie[] }> = [];
  for (const n of NICHES) {
    let g = uit.find((x) => x.groep === n.groep);
    if (!g) { g = { groep: n.groep, opties: [] }; uit.push(g); }
    g.opties.push(n);
  }
  return uit;
}

/**
 * Normaliseert wat iemand in het vrije veld typt.
 *
 * ── WAAROM DIT ER IS ───────────────────────────────────────────────────────
 *
 * Tien bureaus typen "tandarts", "Tandarts", "tandartspraktijk", "Tandartspraktijk " en
 * "tandarts praktijk". Dat zijn vijf vakjes met één account, en dan haalt niets ooit een drempel.
 * Het probleem dat volume niet oplost, want het wordt erdoor VEROORZAAKT.
 *
 * Deze functie doet alleen wat aantoonbaar veilig is: kleine letters, spaties en streepjes naar
 * één liggend streepje, accenten eraf, randruimte weg. Geen synoniemenlijst en geen stammen --
 * dat zou "tandarts" en "tandheelkunde" samenvoegen op een gok, en een verkeerde samenvoeging is
 * erger dan twee losse hokjes: die eerste levert een benchmark op die niemand kan controleren.
 *
 * Wat er ná normalisatie nog uiteenloopt, hoort door een mens naar de vaste lijst getild te
 * worden. Vandaar `vrijeNichesTellen`.
 */
export function normaliseerNiche(ruw: string | null | undefined): string | null {
  if (!ruw) return null;
  const s = ruw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // accenten eraf
    .toLowerCase()
    .replace(/[\s_/-]+/g, "-")                          // spaties, streepjes en slashes gelijk
    .replace(/[^a-z0-9-]/g, "")                         // de rest weg
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || null;
}

/**
 * Telt de vrije niches, zodat je ziet wat er aan de vaste lijst toegevoegd hoort te worden.
 *
 * Alleen waarden die NIET in de vaste lijst staan; die staan er immers al. Aflopend op aantal,
 * zodat de bovenste regel de meest urgente aanvulling is.
 */
export function vrijeNichesTellen(waarden: ReadonlyArray<string | null | undefined>): Array<{ waarde: string; aantal: number }> {
  const telling = new Map<string, number>();
  for (const w of waarden) {
    const n = normaliseerNiche(w);
    if (!n || NICHE_INDEX.has(n)) continue;
    telling.set(n, (telling.get(n) ?? 0) + 1);
  }
  return [...telling.entries()]
    .map(([waarde, aantal]) => ({ waarde, aantal }))
    .sort((a, b) => b.aantal - a.aantal || a.waarde.localeCompare(b.waarde));
}

/**
 * De oude `sector`-waarden naar het nieuwe paar.
 *
 * Nodig omdat er vijf klanten zijn die al een sector hebben, en omdat de zeventien oude keuzes
 * nog in opgeslagen analyses en in benchmark_sectors voorkomen. Null als er geen niche in zat --
 * `ecommerce_laag_ticket` is bijvoorbeeld puur een bedrijfsmodel plus een ticketgrootte, en die
 * laatste staat al in aov_segment.
 */
export function uitOudeSector(sector: string | null | undefined): { model: Bedrijfsmodel | null; niche: string | null } {
  const kaart: Record<string, { model: Bedrijfsmodel | null; niche: string | null }> = {
    ecommerce_laag_ticket: { model: "b2c", niche: null },
    ecommerce_mid_ticket: { model: "b2c", niche: null },
    ecommerce_hoog_ticket: { model: "b2c", niche: null },
    ecommerce_general: { model: "b2c", niche: null },
    ecommerce_fashion: { model: "b2c", niche: "mode" },
    ecommerce_electronics: { model: "b2c", niche: "elektronica" },
    ecommerce_huisdieren: { model: "b2c", niche: "huisdieren" },
    fysiotherapie: { model: "b2c", niche: "fysiotherapie" },
    zorg_generiek: { model: "b2c", niche: "zorg_overig" },
    b2b_saas: { model: "b2b", niche: "software" },
    b2b_software: { model: "b2b", niche: "software" },
    b2b_leadgen: { model: "b2b", niche: "zakelijke_diensten" },
    leadgen_generiek: { model: "b2c", niche: "diensten_lokaal" },
    automotive: { model: null, niche: "automotive" },
    legal: { model: null, niche: "juridisch" },
    finance: { model: null, niche: "financieel" },
    horeca: { model: "b2c", niche: "horeca" },
    retail_local: { model: "b2c", niche: "retail_lokaal" },
    // "hybrid" was geen sector maar een accounttype dat hier per ongeluk in stond. Levert niets op.
    hybrid: { model: null, niche: null },
  };
  return kaart[String(sector ?? "")] ?? { model: null, niche: null };
}
