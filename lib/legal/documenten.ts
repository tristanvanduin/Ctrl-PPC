/**
 * Het Privacy Statement en de Algemene Voorwaarden als gestructureerde data.
 *
 * De brontekst staat in docs/juridisch/ als markdown. Die blijft het document dat wordt
 * nagelezen en aangepast; dit bestand is dezelfde tekst in een vorm die de site kan renderen
 * (paragrafen met een anker, tabellen, opsommingen) zonder dat er een markdown-parser en een
 * sanitizer aan de marketingbundel worden toegevoegd voor twee pagina's.
 *
 * BIJ ELKE WIJZIGING AAN DE BRONTEKST hoort dit bestand mee te veranderen. Dat is de prijs van
 * geen-CMS; de tekst is klein genoeg en verandert zelden genoeg dat dat goedkoper is dan het
 * alternatief. Wat NIET mag: een waarde als een KvK-nummer of een betalingstermijn hier
 * uittypen. Die horen in lib/legal/bedrijfsgegevens.ts en komen hier als {{veldnaam}} binnen --
 * zie de uitleg daar.
 *
 * Inline-opmaak binnen een tekstregel, bewust maar drie dingen:
 *   **vet**             nadruk, zoals in de brontekst
 *   {{veldnaam}}        een waarde uit Bedrijfsgegevens; ontbreekt hij, dan rendert de pagina
 *                       een zichtbare markering in plaats van een lege plek
 *   [[label|/pad]]      een interne link
 */

import {
  BEDRIJFSGEGEVENS, VELDLABELS, type Bedrijfsgegevens,
} from "./bedrijfsgegevens";

export type Blok =
  | { soort: "alinea"; tekst: string }
  | { soort: "subkop"; tekst: string }
  | { soort: "lijst"; items: string[] }
  // start: een artikel waarvan een lid zelf een opsomming bevat, valt uiteen in twee
  // genummerde blokken met de bullets ertussen (zie artikel 7). Zonder een expliciet
  // startnummer begint het tweede blok weer bij 1 en verwijst "art. 7 lid 4" naar de
  // verkeerde bepaling -- een verschrijving die je pas ziet als iemand zich erop beroept.
  | { soort: "genummerd"; items: string[]; start?: number }
  | { soort: "tabel"; koppen: string[]; rijen: string[][] };

export interface Paragraaf {
  /** Anker in de URL, bijv. "p6" -> /privacy#p6. Stabiel houden: er wordt naar gelinkt. */
  id: string;
  /** Wat er voor de titel staat: "§1" of "Artikel 1". */
  nummer: string;
  titel: string;
  /** Kortere variant voor de inhoudsopgave, waar de volle titel over twee regels zou breken. */
  korteTitel: string;
  blokken: Blok[];
}

export interface JuridischDocument {
  slug: string;
  titel: string;
  /** Engelse regel boven de Nederlandse tekst: de rest van de site is Engels, dit document niet. */
  taalnoot: string;
  inleiding: string;
  paragrafen: Paragraaf[];
  /** Verantwoording onderaan het document. */
  slotnoot: string;
}

// ── Inline-parser ──────────────────────────────────────────────────────────
// Puur, geen JSX: de component hoeft alleen nog nodes naar spans te mappen, en de parser is
// zonder React te testen (zie __legal_test.ts).

export type InlineNode =
  | { soort: "tekst"; tekst: string }
  | { soort: "nadruk"; tekst: string }
  | { soort: "waarde"; tekst: string }
  | { soort: "ontbreekt"; label: string }
  | { soort: "link"; tekst: string; href: string };

/** Hoe een waarde in lopende tekst verschijnt. Getallen zonder eenheid: die staat in de zin. */
function toonWaarde(waarde: string | number): string {
  return typeof waarde === "number" ? `${waarde}` : waarde;
}

const TOKEN = /(\*\*[^*]+\*\*|\{\{[a-zA-Z]+\}\}|\[\[[^\]|]+\|[^\]]+\]\])/g;

/**
 * Tokens die geen veld zijn maar een zin die er wel of niet hoort te staan.
 *
 * Er is er precies één, en die bestaat omdat art. 13 lid 1 een bijzin heeft die de brontekst zelf
 * optioneel noemt: het absolute aansprakelijkheidsmaximum. Een leeg veld invullen met een
 * "[nog in te vullen]"-markering zou hier onjuist zijn -- niet-ingevuld betekent hier "geldt niet",
 * niet "weten we nog niet". Levert de functie een lege string op, dan verdwijnt de bijzin
 * spoorloos en loopt de zin zonder gat door.
 */
const AFGELEIDE_TOKENS: Record<string, (g: Bedrijfsgegevens) => string> = {
  capMaximumZin: (g) =>
    g.aansprakelijkheidscapMaximum
      ? ` Daarnaast geldt een absoluut maximum van ${g.aansprakelijkheidscapMaximum} per kalenderjaar.`
      : "",
};

export function parseInline(
  tekst: string,
  gegevens: Bedrijfsgegevens = BEDRIJFSGEGEVENS
): InlineNode[] {
  const nodes: InlineNode[] = [];
  let laatste = 0;
  for (const match of tekst.matchAll(TOKEN)) {
    const stuk = match[0];
    const start = match.index ?? 0;
    if (start > laatste) nodes.push({ soort: "tekst", tekst: tekst.slice(laatste, start) });
    laatste = start + stuk.length;

    if (stuk.startsWith("**")) {
      nodes.push({ soort: "nadruk", tekst: stuk.slice(2, -2) });
      continue;
    }
    if (stuk.startsWith("[[")) {
      const [label, href] = stuk.slice(2, -2).split("|");
      nodes.push({ soort: "link", tekst: label, href });
      continue;
    }
    const naam = stuk.slice(2, -2);
    const afgeleid = AFGELEIDE_TOKENS[naam];
    if (afgeleid) {
      const zin = afgeleid(gegevens);
      if (zin) nodes.push({ soort: "tekst", tekst: zin });
      continue;
    }
    const veld = naam as keyof Bedrijfsgegevens;
    const waarde = gegevens[veld];
    // Een boolean hoort niet in lopende tekst -- contractvoorwaardenBevestigd bewaakt de
    // conceptpoort en is geen woord in een zin. Als er ooit toch {{contractvoorwaardenBevestigd}}
    // in de tekst belandt, is dat een vergissing, en dan hoort de pagina dat te laten zien in
    // plaats van "true" af te drukken.
    if (typeof waarde === "boolean") {
      nodes.push({ soort: "ontbreekt", label: VELDLABELS[veld] ?? veld });
      continue;
    }
    if (waarde === null || waarde === undefined || `${waarde}`.trim() === "") {
      // Het label i.p.v. de veldnaam: "[nog in te vullen: KvK-nummer]" leest voor een bezoeker
      // als een eerlijk gat, "[nog in te vullen: kvkNummer]" als een lek uit de codebase.
      nodes.push({ soort: "ontbreekt", label: VELDLABELS[veld] ?? veld });
    } else {
      nodes.push({ soort: "waarde", tekst: toonWaarde(waarde) });
    }
  }
  if (laatste < tekst.length) nodes.push({ soort: "tekst", tekst: tekst.slice(laatste) });
  return nodes;
}

// ── Privacy Statement ──────────────────────────────────────────────────────
// Woordelijk docs/juridisch/privacy-statement.md, alleen de placeholders vervangen door
// {{velden}}. Niets herschreven, ook niet "even korter" -- dit is de tekst die is nagelezen.

const PRIVACY_PARAGRAFEN: Paragraaf[] = [
  {
    id: "p1",
    nummer: "§1",
    titel: "Twee rollen: wanneer zijn wij verwerker, wanneer verwerkingsverantwoordelijke",
    korteTitel: "Twee rollen: verwerker of verwerkingsverantwoordelijke",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Ctrl PPC is een B2B-platform dat wordt gebruikt door marketingbureaus en adverteerders " +
          "(“Opdrachtgevers”) om advertentiedata te analyseren. Voor de AVG is het onderscheid tussen " +
          "onze twee rollen essentieel:",
      },
      {
        soort: "lijst",
        items: [
          "**Als verwerker.** Voor de advertentie- en campagnedata die via Google Ads, Meta en LinkedIn " +
            "wordt opgehaald en geanalyseerd ten behoeve van Opdrachtgever, handelen wij als **verwerker**. " +
            "Opdrachtgever (of diens eigen klant) is en blijft **verwerkingsverantwoordelijke** voor deze " +
            "data. De afspraken hierover zijn vastgelegd in een verwerkersovereenkomst tussen Ctrl PPC en " +
            "Opdrachtgever, die onlosmakelijk onderdeel uitmaakt van de dienstverleningsovereenkomst.",
          "**Als verwerkingsverantwoordelijke.** Voor de gegevens die wij verzamelen over Opdrachtgever " +
            "zelf en diens gebruikers (accountgegevens, facturatiegegevens, gebruik van het Platform) en " +
            "over bezoekers van onze website, zijn wij zelf **verwerkingsverantwoordelijke**.",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "Dit statement beschrijft beide rollen. Waar relevant, is aangegeven in welke hoedanigheid wij " +
          "optreden.",
      },
    ],
  },
  {
    id: "p2",
    nummer: "§2",
    titel: "Welke gegevens verwerken wij, en op welke grondslag",
    korteTitel: "Welke gegevens, en op welke grondslag",
    blokken: [
      { soort: "subkop", tekst: "2.1 Accountgegevens van Opdrachtgever en diens gebruikers" },
      {
        soort: "tabel",
        koppen: ["Gegevens", "Doel", "Grondslag"],
        rijen: [
          [
            "Naam, e-mailadres, rol/functie van gebruikers binnen het account",
            "Aanmaken en beheren van accounts, authenticatie, toegangscontrole per bureau/klant",
            "Uitvoering van de overeenkomst (art. 6 lid 1 sub b AVG)",
          ],
          [
            "Inlog- en sessiegegevens",
            "Beveiliging, voorkomen van misbruik, foutopsporing",
            "Gerechtvaardigd belang (art. 6 lid 1 sub f AVG): een werkend en veilig platform",
          ],
          [
            "Bedrijfsgegevens (bedrijfsnaam, adres, KvK, BTW-nummer)",
            "Facturatie en fiscale/administratieve verplichtingen",
            "Uitvoering van de overeenkomst en wettelijke verplichting (art. 6 lid 1 sub b en c AVG)",
          ],
        ],
      },
      { soort: "subkop", tekst: "2.2 Gegevens verwerkt namens Opdrachtgever (wij: verwerker)" },
      {
        soort: "alinea",
        tekst:
          "Via de door Opdrachtgever gekoppelde accounts halen wij, met de door Opdrachtgever " +
          "verstrekte API-autorisatie, campagne-, account- en websitedata op bij **Google Ads, Meta " +
          "(Facebook/Instagram) Ads, LinkedIn Ads, Google Analytics 4 en Google Search Console**. " +
          "Dit betreft in de kern **geaggregeerde, " +
          "campagnegerichte prestatiedata**: vertoningen, klikken, kosten, conversies, " +
          "doelgroepsegmenten (bijvoorbeeld op functieniveau of senioriteit, zoals aangeleverd door het " +
          "advertentieplatform zelf, altijd op segment- en nooit op individueel niveau) en vergelijkbare " +
          "statistieken.",
      },
      {
        soort: "lijst",
        items: [
          "Deze data betreft in de regel **geen tot individuele consumenten herleidbare persoonsgegevens**: " +
            "advertentieplatformen leveren doorgaans geaggregeerde cijfers op campagne-, advertentiegroep- " +
            "of doelgroepsegmentniveau, niet op het niveau van een geïdentificeerd of identificeerbaar " +
            "natuurlijk persoon. Dit geldt ook voor leadformulier-data van LinkedIn: wij lezen uitsluitend " +
            "het aantal openingen en inzendingen per formulier, geen namen of contactgegevens van " +
            "individuele leads.",
          "Voor zover in specifieke gevallen toch persoonsgegevens onderdeel zijn van deze dataset " +
            "(bijvoorbeeld een contactpersoon vermeld in klantnotities die Opdrachtgever zelf invoert), " +
            "verwerken wij deze **uitsluitend in opdracht van en volgens instructies van Opdrachtgever**, " +
            "als verwerker. De grondslag voor deze verwerking berust bij Opdrachtgever als " +
            "verwerkingsverantwoordelijke.",
          "Wij gebruiken deze data uitsluitend om de Dienst aan Opdrachtgever te leveren, en niet voor " +
            "eigen doeleinden, behoudens geaggregeerde en/of geanonimiseerde statistiek zoals toegelicht " +
            "in paragraaf 2.5.",
          "Van **Google Analytics 4** lezen wij uitsluitend gerapporteerde, geaggregeerde statistieken " +
            "(sessies, gebruikersaantallen, conversies en vergelijkbare maatstaven per kanaal, campagne of " +
            "landingspagina), met de leesscope `analytics.readonly`. Van **Google Search Console** lezen " +
            "wij vertoningen, klikken, posities en zoekopdrachten op siteniveau, met de leesscope " +
            "`webmasters.readonly`. In beide gevallen gaat het om rapportagedata op geaggregeerd niveau; " +
            "wij lezen geen individuele gebruikersprofielen, client-ID's of gebeurtenissen van een " +
            "afzonderlijke bezoeker uit, en wij schrijven niets terug naar deze diensten.",
          "De autorisatie (koppeling) die Opdrachtgever aan ons verleent, wordt niet als leesbare tekst " +
            "opgeslagen: het toegangstoken zelf staat in een aparte, versleutelde kluis (zie paragraaf 7), " +
            "niet in dezelfde tabel als de campagnedata.",
          "Alle koppelingen zijn **uitsluitend lezend**. Het Platform voert geen wijzigingen door in " +
            "advertentieaccounts, en de gevraagde autorisaties bevatten geen beheerrechten.",
        ],
      },

      // 2.3 is nieuw (24 augustus 2026). Google eist voor de gevoelige leesscopes van GA4 en
      // Search Console dat de verklaring benoemt welke Google-gebruikersdata je ophaalt, waarvoor,
      // en dat je je aan de Limited Use-eisen houdt. Zonder deze paragraaf beschreef het document
      // niet wat er daadwerkelijk wordt aangevraagd -- en dat is precies waar de verificatie op
      // toetst. De oude 2.3 t/m 2.5 zijn een nummer opgeschoven.
      { soort: "subkop", tekst: "2.3 Google-gebruikersdata: beperkt gebruik (Limited Use)" },
      {
        soort: "alinea",
        tekst:
          "Op de data die wij via Google-API's ontvangen (Google Ads, Google Analytics 4 en Google " +
          "Search Console) is aanvullend het **Google API Services User Data Policy** van toepassing, " +
          "inclusief de **Limited Use**-eisen daarvan. Concreet betekent dat:",
      },
      {
        soort: "lijst",
        items: [
          "wij gebruiken deze data uitsluitend om de functies te leveren die Opdrachtgever in het " +
            "Platform zichtbaar zijn, en voor geen enkel ander doel;",
          "wij dragen deze data niet over aan derden, behalve aan de subverwerkers die nodig zijn om " +
            "de Dienst te leveren (zie paragraaf 5), of wanneer de wet daartoe verplicht;",
          "wij gebruiken deze data **niet** voor advertentiedoeleinden van onszelf of van anderen, en " +
            "**niet** om modellen mee te trainen;",
          "wij staan geen mens toe deze data te lezen, tenzij Opdrachtgever daar toestemming voor geeft, " +
            "het nodig is voor beveiliging of foutopsporing, of de wet dat verlangt.",
        ],
      },
      { soort: "subkop", tekst: "2.4 Gebruik van AI-modellen bij analyse en advisering" },
      {
        soort: "alinea",
        tekst:
          "Het Platform gebruikt taalmodellen om op basis van de in 2.2 genoemde geaggregeerde " +
          "prestatiedata analyses, samenvattingen, hypotheses en aanbevelingen te genereren. Deze modellen " +
          "worden ontsloten via **OpenRouter**, dat als routeringslaag fungeert naar onderliggende " +
          "modelaanbieders (afhankelijk van de taak, onder meer aanbieders van Claude-, Gemini- en " +
          "Grok-achtige modellen).",
      },
      {
        soort: "lijst",
        items: [
          "Aan deze modellen wordt de geaggregeerde campagnedata, en géén los daarvan bewaarde " +
            "consumentidentiteit, ter beschikking gesteld ten behoeve van het genereren van de analyse.",
          "Voor zover een AI-modelprovider daarbij optreedt als (sub)verwerker in de zin van de AVG, is " +
            "dit opgenomen in ons subverwerkersoverzicht (paragraaf 5). Wij streven ernaar uitsluitend " +
            "providers in te schakelen die contractueel toezeggen klantdata niet te gebruiken voor het " +
            "trainen van hun modellen; dit wordt per daadwerkelijk actieve provider bevestigd en is op " +
            "verzoek in te zien, in plaats van hier als vaststaand gegeven te worden gepresenteerd.",
          "Door AI gegenereerde output is per definitie een geautomatiseerd gegenereerd advies. Er wordt " +
            "geen besluit met rechtsgevolg of vergelijkbaar wezenlijk gevolg voor een natuurlijk persoon " +
            "(in de zin van art. 22 AVG) op louter geautomatiseerde wijze genomen: de output betreft " +
            "campagne-/marketingadvies aan een onderneming (Opdrachtgever), niet een geautomatiseerd " +
            "besluit over een individuele betrokkene.",
        ],
      },
      { soort: "subkop", tekst: "2.5 Product- en dienstverbetering" },
      {
        soort: "alinea",
        tekst:
          "Wij kunnen geaggregeerde en waar mogelijk geanonimiseerde gebruiksstatistieken (bijvoorbeeld: " +
          "welke onderdelen van het Platform worden gebruikt, foutmeldingen, prestatiemetingen van het " +
          "Platform zelf) gebruiken om de Dienst te verbeteren, op grond van ons gerechtvaardigd belang " +
          "(art. 6 lid 1 sub f AVG) bij een goed functionerend product. Dit betreft geen analyse van de " +
          "inhoud van klantcampagnes voor doeleinden buiten de dienstverlening aan de betreffende " +
          "Opdrachtgever.",
      },
      { soort: "subkop", tekst: "2.6 Websitebezoekers" },
      {
        soort: "alinea",
        tekst:
          "Voor de publieke website (bijvoorbeeld de pagina's over prijzen, blog en contact) verwerken " +
          "wij beperkte technische en analytische gegevens (zoals IP-adres, browsertype en bezochte " +
          "pagina's), voor zover van toepassing via cookies zoals toegelicht in paragraaf 9. Grondslag: " +
          "toestemming (voor niet-noodzakelijke cookies) respectievelijk gerechtvaardigd belang (voor " +
          "strikt noodzakelijke, functionele cookies).",
      },
    ],
  },
  {
    id: "p3",
    nummer: "§3",
    titel: "Herkomst van de gegevens",
    korteTitel: "Herkomst van de gegevens",
    blokken: [
      {
        soort: "lijst",
        items: [
          "Accountgegevens: rechtstreeks verstrekt door Opdrachtgever bij aanmelding en gebruik van het " +
            "Platform.",
          "Campagne-, prestatie- en websitedata: opgehaald bij Google Ads, Meta, LinkedIn, Google " +
            "Analytics 4 en Google Search Console, op basis van de autorisatie (OAuth-koppeling) die " +
            "Opdrachtgever aan Ctrl PPC verleent.",
          "Facturatiegegevens: rechtstreeks verstrekt door Opdrachtgever.",
        ],
      },
    ],
  },
  {
    id: "p4",
    nummer: "§4",
    titel: "Geen verkoop van gegevens",
    korteTitel: "Geen verkoop van gegevens",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Wij verkopen persoonsgegevens niet aan derden en gebruiken de via het Platform verwerkte " +
          "campagnedata niet voor advertentiedoeleinden van onszelf of van andere klanten.",
      },
    ],
  },
  {
    id: "p5",
    nummer: "§5",
    titel: "Subverwerkers en doorgifte buiten de EER",
    korteTitel: "Subverwerkers en doorgifte buiten de EER",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Voor de uitvoering van de Dienst maken wij gebruik van de volgende categorieën " +
          "subverwerkers:",
      },
      {
        soort: "tabel",
        koppen: ["Subverwerker (categorie)", "Functie", "Locatie / doorgiftemechanisme"],
        rijen: [
          [
            "Database-, authenticatie- en opslaginfrastructuur (Supabase)",
            "Opslag van accountgegevens, campagnedata, gegenereerde analyses en bestanden; beheer van " +
              "inloggegevens; versleutelde opslag van API-toegangstokens",
            "{{supabaseRegio}}",
          ],
          [
            "Hostingplatform webapplicatie (Vercel)",
            "Hosten en uitleveren van het Platform, uitvoeren van de dagelijkse synchronisatie",
            "{{vercelRegio}}",
          ],
          [
            "AI-modelrouteringsdienst (OpenRouter)",
            "Routeert analysetaken naar het voor die taak geschikte model",
            "Verwerking (mogelijk) buiten de EER; doorgifte op basis van Standard Contractual Clauses " +
              "c.q. een passend beschermingsniveau, te bevestigen",
          ],
          [
            "Onderliggende modelaanbieders, geraadpleegd via OpenRouter (o.a. Anthropic-, Google- en " +
              "xAI-modellen, afhankelijk van de aard van de analysetaak)",
            "Genereren van analysetekst, samenvattingen en gestructureerde bevindingen op basis van " +
              "geaggregeerde campagnedata",
            "Verwerking (mogelijk) buiten de EER, per aanbieder te bevestigen",
          ],
          [
            "Google Ads, Meta Ads, LinkedIn Ads, Google Analytics 4, Google Search Console",
            "Bron van de campagne-, advertentieprestatie- en websitedata die Opdrachtgever laat koppelen",
            "Treden hier niet op als onze subverwerker, maar als platform waarop Opdrachtgever (of diens " +
              "klant) zelf verwerkingsverantwoordelijke is; wij lezen deze data uit met de door " +
              "Opdrachtgever verleende autorisatie. Voor Google Ads geldt dat de leestoegang loopt via " +
              "één technische koppeling op accountniveau van Ctrl PPC (een " +
              "“manageraccount”), niet via een los token per Opdrachtgever",
          ],
        ],
      },
      {
        soort: "alinea",
        tekst:
          "Met alle subverwerkers die persoonsgegevens buiten de Europese Economische Ruimte verwerken, " +
          "zijn passende waarborgen overeengekomen (zoals de Standard Contractual Clauses van de Europese " +
          "Commissie). Een actueel, volledig overzicht van subverwerkers, inclusief de op dat moment " +
          "daadwerkelijk actieve modelaanbieders, is op verzoek beschikbaar via {{contactEmail}}.",
      },
    ],
  },
  {
    id: "p6",
    nummer: "§6",
    titel: "Bewaartermijnen",
    korteTitel: "Bewaartermijnen",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Wij bewaren persoonsgegevens niet langer dan noodzakelijk voor de doeleinden waarvoor zij zijn " +
          "verzameld. Hieronder staat zowel wat automatisch is ingeregeld als wat op dit moment nog op " +
          "aanvraag verloopt — wij beloven hier niet meer dan wat het Platform daadwerkelijk doet.",
      },
      {
        soort: "lijst",
        items: [
          "**Zoektermdata (Google Ads)**: enige categorie met een **automatische, doorlopende " +
            "bewaartermijn**: maximaal twee maanden, gerekend vanaf de meest recente maand waarvan " +
            "Opdrachtgever data heeft (niet vanaf een vaste kalenderdatum, zodat een tijdelijk " +
            "stilstaande koppeling niet leidt tot het verlies van de enige nog beschikbare data). Oudere " +
            "zoektermregels worden automatisch verwijderd bij elke nieuwe synchronisatie.",
          "**Overige campagne- en accountdata, gegenereerde analyses en rapportages**: bewaard gedurende " +
            "de looptijd van de overeenkomst met Opdrachtgever, zodat historische trends en " +
            "jaar-op-jaar-vergelijkingen beschikbaar blijven. Voor deze categorieën bestaat vandaag " +
            "**geen geautomatiseerde verwijdering na afloop van de overeenkomst**; verwijdering vindt " +
            "plaats op verzoek van Opdrachtgever, en in elk geval bij formele beëindiging van de " +
            "overeenkomst binnen een door Partijen af te spreken termijn.",
          "**Wijzigingsgeschiedenis van hypotheses en trackrecord-events**: bewust **niet** onderworpen " +
            "aan verwijdering of wijziging zolang de overeenkomst loopt — dit is een append-only " +
            "geschiedenis die de betrouwbaarheid van eerdere adviezen aantoonbaar maakt, technisch " +
            "afgedwongen zodat ook per ongeluk overschrijven niet mogelijk is. Bevat geen " +
            "persoonsgegevens van individuen; is gekoppeld aan klant-/campagneniveau.",
          "**Facturatie- en administratieve gegevens**: bewaard gedurende de wettelijke fiscale " +
            "bewaartermijn van zeven jaar (artikel 52 Algemene wet inzake rijksbelastingen).",
          "**Gebruiksstatistieken van AI-modelaanroepen** (welk model, aantal tokens, kosten): bewaard " +
            "voor kostenanalyse en verbetering van de Dienst. Bevat geen prompttekst of gegenereerde " +
            "inhoud, uitsluitend telmetingen.",
          "**Gegevens van proef-/demo-accounts**: uitsluitend fictieve, niet tot bestaande personen " +
            "herleidbare gegevens; geen bewaartermijn van persoonsgegevens van toepassing.",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "Na het verstrijken van de toepasselijke bewaartermijn, of na een geldig verwijderingsverzoek, " +
          "worden de gegevens verwijderd of onomkeerbaar geanonimiseerd. Wij werken toe naar bredere " +
          "automatisering van bewaartermijnen voor de categorieën waar dat vandaag nog niet is " +
          "ingeregeld.",
      },
    ],
  },
  {
    id: "p7",
    nummer: "§7",
    titel: "Beveiliging",
    korteTitel: "Beveiliging",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Wij nemen passende technische en organisatorische maatregelen om persoonsgegevens te " +
          "beschermen tegen verlies of onrechtmatige verwerking. Hieronder staat concreet wat " +
          "daadwerkelijk is ingericht, per beveiligingsdomein — en, waar van toepassing, wat nog in " +
          "ontwikkeling is. Wij kiezen ervoor hier specifiek en verifieerbaar te zijn in plaats van " +
          "algemene geruststellingen te geven.",
      },
      {
        soort: "alinea",
        tekst:
          "**Toegangsbeheer.** Toegang tot klantdata is op databaseniveau afgeschermd per " +
          "bureau/organisatie (row-level security): een gebruiker kan uitsluitend rijen opvragen die aan " +
          "zijn eigen organisatie zijn gekoppeld, afgedwongen door de database zelf en niet alleen door " +
          "de applicatielaag. Dit is functioneel getest met twee afzonderlijke, daadwerkelijk ingelogde " +
          "gebruikers van verschillende organisaties. Toegang binnen een organisatie is bovendien " +
          "rolgebonden (beheerder, specialist, viewer, met elk een eigen rechtenset).",
      },
      {
        soort: "alinea",
        tekst:
          "**Verplichte authenticatie.** Het Platform wordt uitgebreid met verplichte " +
          "sessie-authenticatie voor elke pagina en API-aanroep die klantdata ontsluit; deze " +
          "functionaliteit is gebouwd en getest en wordt gefaseerd geactiveerd.",
      },
      {
        soort: "alinea",
        tekst:
          "**Geheimenbeheer.** Toegangstokens naar gekoppelde advertentieplatformen worden niet als " +
          "leesbare tekst in de reguliere database opgeslagen. Zij staan in een aparte, versleutelde " +
          "kluis, benaderbaar via een streng afgebakende technische functie die uitsluitend het opslaan " +
          "en ophalen van één specifiek geheim toestaat — niet het doorzoeken van de kluis " +
          "als geheel.",
      },
      {
        soort: "alinea",
        tekst:
          "**Versleuteling in transit.** Al het dataverkeer tussen het Platform, de database en de " +
          "gekoppelde diensten loopt via versleutelde verbindingen (TLS).",
      },
      {
        soort: "alinea",
        tekst:
          "**Onveranderlijke audittrail.** Voor de geschiedenis van hypotheses en aanbevelingen wordt op " +
          "databaseniveau afgedwongen dat eenmaal vastgelegde events nooit gewijzigd of verwijderd kunnen " +
          "worden, ook niet per ongeluk door de applicatie zelf.",
      },
      {
        soort: "alinea",
        tekst: "**Wat op dit moment (nog) geen formeel, gedocumenteerd proces is:**",
      },
      {
        soort: "lijst",
        items: [
          "een vastgelegd incidentresponsplan met vaste meldingstermijnen bij een eventueel datalek;",
          "een periodieke, gedocumenteerde risicoanalyse van de architectuur;",
          "een formele, herhaalde beoordeling van subverwerkers op hun beveiligingsniveau (vandaag: " +
            "vertrouwen op de eigen certificeringen en voorwaarden van de ingeschakelde partijen, niet op " +
            "een eigen audit).",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "Wij vermelden dit bewust in plaats van het weg te laten: onze technische maatregelen zijn " +
          "concreet en verifieerbaar, maar vormen nog geen gecertificeerd managementsysteem. " +
          "Opdrachtgevers voor wie dat een vereiste is, kunnen hierover contact opnemen via " +
          "{{contactEmail}}.",
      },
    ],
  },
  {
    id: "p8",
    nummer: "§8",
    titel: "Uw rechten",
    korteTitel: "Uw rechten",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Voor zover Ctrl PPC ten aanzien van uw gegevens optreedt als verwerkingsverantwoordelijke " +
          "(zie paragraaf 1), heeft u op grond van de AVG de volgende rechten:",
      },
      {
        soort: "lijst",
        items: [
          "**Inzage** in de persoonsgegevens die wij van u verwerken;",
          "**Rectificatie** van onjuiste gegevens;",
          "**Verwijdering** van uw gegevens, voor zover geen wettelijke bewaarplicht of ander " +
            "gerechtvaardigd belang zich daartegen verzet;",
          "**Beperking** van de verwerking;",
          "**Overdraagbaarheid** van gegevens die u zelf aan ons heeft verstrekt;",
          "**Bezwaar** tegen verwerking op grond van gerechtvaardigd belang;",
          "**Intrekking van toestemming**, voor zover een verwerking op toestemming berust, zonder " +
            "gevolgen voor de rechtmatigheid van de verwerking vóór de intrekking.",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "U kunt deze rechten uitoefenen door contact op te nemen via {{contactEmail}}. Wij reageren " +
          "binnen de wettelijke termijn van één maand. Voor het specifieke geval van verwijdering staat " +
          "de procedure stap voor stap op [[Data deletion|/data-deletion]].",
      },
      {
        soort: "alinea",
        tekst:
          "Bent u gebruiker van het Platform via een Opdrachtgever (bijvoorbeeld als medewerker van een " +
          "marketingbureau of als klant van dat bureau) en betreft uw verzoek gegevens waarvoor " +
          "Opdrachtgever verwerkingsverantwoordelijke is? Dan verzoeken wij u zich in eerste instantie te " +
          "wenden tot Opdrachtgever; wij ondersteunen Opdrachtgever desgevraagd bij de afhandeling van " +
          "uw verzoek.",
      },
      {
        soort: "alinea",
        tekst:
          "Bent u van mening dat wij niet op de juiste wijze met uw persoonsgegevens omgaan? Dan heeft u " +
          "het recht een klacht in te dienen bij de Autoriteit Persoonsgegevens " +
          "(autoriteitpersoonsgegevens.nl).",
      },
    ],
  },
  {
    id: "p9",
    nummer: "§9",
    titel: "Cookies",
    korteTitel: "Cookies",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Onze website maakt gebruik van {{cookiegebruik}} cookies. Strikt noodzakelijke cookies " +
          "(bijvoorbeeld voor het functioneren van de inlogsessie) worden geplaatst op grond van ons " +
          "gerechtvaardigd belang; overige cookies worden alleen geplaatst na uw toestemming, die u te " +
          "allen tijde kunt intrekken via {{cookieInstellingen}}.",
      },
    ],
  },
  {
    id: "p10",
    nummer: "§10",
    titel: "Wijzigingen in dit Privacy Statement",
    korteTitel: "Wijzigingen in dit statement",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Wij kunnen dit Privacy Statement van tijd tot tijd aanpassen, bijvoorbeeld naar aanleiding " +
          "van wijzigingen in de Dienst, in de ingeschakelde subverwerkers, of in de toepasselijke " +
          "regelgeving. De actuele versie is steeds via het Platform en de website raadpleegbaar. Bij " +
          "wezenlijke wijzigingen stellen wij Opdrachtgever daarvan Schriftelijk op de hoogte.",
      },
    ],
  },
  {
    id: "p11",
    nummer: "§11",
    titel: "Contact",
    korteTitel: "Contact",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Voor vragen over dit Privacy Statement of de verwerking van uw persoonsgegevens:",
      },
      {
        soort: "lijst",
        items: [
          "**{{handelsnaam}}**",
          "{{vestigingsadres}}",
          "{{contactEmail}}",
          "KvK-nummer: {{kvkNummer}}",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "Zie ook de [[Algemene Voorwaarden|/terms]], waarvan dit statement onderdeel uitmaakt.",
      },
    ],
  },
];

export const PRIVACY_STATEMENT: JuridischDocument = {
  slug: "privacy",
  titel: "Privacy Statement",
  taalnoot:
    "This document is published in Dutch. Ctrl PPC contracts under Dutch law, and the Dutch text is " +
    "the binding version — a translation would risk saying something subtly different from the " +
    "text that was actually reviewed.",
  inleiding:
    "Dit Privacy Statement legt uit hoe {{handelsnaam}}, gevestigd te {{vestigingsplaats}}, KvK-nummer " +
    "{{kvkNummer}} (hierna: **“Ctrl PPC”**, “wij”), omgaat met persoonsgegevens in " +
    "het kader van het platform Ctrl PPC. Vragen over dit statement of over de verwerking van uw " +
    "gegevens kunt u richten aan {{contactEmail}}.",
  paragrafen: PRIVACY_PARAGRAFEN,
  slotnoot:
    "De technische beweringen in dit document (rolscheiding, geheimenkluis, zoektermretentie, " +
    "audittrail) zijn geverifieerd tegen de codebase en database op 20 augustus 2026. Bij een volgende " +
    "materiële architectuurwijziging wordt dit statement opnieuw tegen de code gelegd, in plaats van " +
    "stilzwijgend als nog kloppend te worden aangenomen.",
};

// ── Algemene Voorwaarden ───────────────────────────────────────────────────
// Woordelijk docs/juridisch/algemene-voorwaarden.md. De genummerde leden staan als
// "genummerd"-blok: de nummering hoort bij de tekst (er wordt naar verwezen als "art. 13 lid 2"),
// dus die mag niet uit een opsommingsteken worden afgeleid.

const VOORWAARDEN_PARAGRAFEN: Paragraaf[] = [
  {
    id: "a1",
    nummer: "Artikel 1",
    titel: "Definities",
    korteTitel: "Definities",
    blokken: [
      { soort: "alinea", tekst: "In deze algemene voorwaarden wordt verstaan onder:" },
      {
        soort: "lijst",
        items: [
          "**Platform**: de door Ctrl PPC ontwikkelde en beheerde " +
            "performance-marketing-analyse-engine, inclusief de bijbehorende webapplicatie, " +
            "API-koppelingen en gegenereerde rapportages, adviezen en hypotheses.",
          "**Dienst**: het geheel van diensten dat Ctrl PPC via het Platform aan Opdrachtgever levert, " +
            "waaronder het ophalen, verwerken, analyseren en presenteren van advertentiedata, en het " +
            "genereren van AI-ondersteunde inzichten, hypotheses en aanbevelingen.",
          "**Gekoppelde Platformen**: externe advertentie-, analyse- en marketingplatformen waarmee " +
            "Opdrachtgever het Platform laat koppelen, waaronder in elk geval Google Ads, Meta " +
            "(Facebook/Instagram) Ads, LinkedIn Ads, Google Analytics 4 en Google Search Console.",
          "**AI-modelproviders**: externe aanbieders van taalmodellen die door het Platform worden " +
            "geraadpleegd voor data-synthese, samenvatting en adviesgeneratie, waaronder in elk geval de " +
            "dienst OpenRouter en de daarachter liggende modelaanbieders.",
          "**Overeenkomst**: iedere overeenkomst tussen Ctrl PPC en Opdrachtgever waarop deze algemene " +
            "voorwaarden van toepassing zijn.",
          "**Partijen**: Ctrl PPC en Opdrachtgever gezamenlijk.",
          "**Schriftelijk**: per brief, e-mail, of via een functionaliteit van het Platform, tenzij " +
            "anders bepaald.",
        ],
      },
    ],
  },
  {
    id: "a2",
    nummer: "Artikel 2",
    titel: "Toepasselijkheid en aard van de overeenkomst",
    korteTitel: "Toepasselijkheid en aard van de overeenkomst",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Deze voorwaarden zijn van toepassing op elk aanbod van Ctrl PPC en op elke Overeenkomst " +
            "tussen Ctrl PPC en Opdrachtgever.",
          "**Ctrl PPC contracteert uitsluitend met ondernemingen die handelen in de uitoefening van een " +
            "beroep of bedrijf.** De Overeenkomst is nadrukkelijk geen consumentenovereenkomst. " +
            "Opdrachtgever verklaart bij het aangaan van de Overeenkomst dat hij handelt in de uitoefening " +
            "van een beroep of bedrijf. De wettelijke (afdwingbare) bepalingen ter bescherming van " +
            "consumenten, waaronder titel 5, afdeling 3 van Boek 6 van het Burgerlijk Wetboek (algemene " +
            "voorwaarden) voor zover deze uitsluitend voor consumenten gelden, zijn op de Overeenkomst " +
            "niet van toepassing.",
          "Eventuele inkoop- of andere voorwaarden van Opdrachtgever worden uitdrukkelijk van de hand " +
            "gewezen en zijn niet van toepassing, ook niet indien Ctrl PPC daar niet uitdrukkelijk tegen " +
            "protesteert.",
          "Afwijkingen van deze voorwaarden zijn slechts geldig indien deze uitdrukkelijk Schriftelijk " +
            "tussen Partijen zijn overeengekomen.",
          "Indien enige bepaling van deze voorwaarden nietig is of vernietigd wordt, blijven de overige " +
            "bepalingen onverminderd van kracht. Partijen treden in dat geval in overleg om de nietige of " +
            "vernietigde bepaling te vervangen door een bepaling die de strekking van de oorspronkelijke " +
            "bepaling zo dicht mogelijk benadert.",
        ],
      },
    ],
  },
  {
    id: "a3",
    nummer: "Artikel 3",
    titel: "Totstandkoming van de overeenkomst",
    korteTitel: "Totstandkoming van de overeenkomst",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Alle aanbiedingen en offertes van Ctrl PPC zijn vrijblijvend, tenzij daarin uitdrukkelijk " +
            "anders is aangegeven.",
          "De Overeenkomst komt tot stand op het moment dat Opdrachtgever een aanbod van Ctrl PPC " +
            "Schriftelijk aanvaardt, dan wel op het moment dat Ctrl PPC met instemming van Opdrachtgever " +
            "met de uitvoering van de Dienst begint, bijvoorbeeld door het aanmaken van een account op het " +
            "Platform.",
          "Ctrl PPC is gerechtigd om, alvorens de Overeenkomst uit te voeren, zich te vergewissen van de " +
            "identiteit en kredietwaardigheid van Opdrachtgever.",
        ],
      },
    ],
  },
  {
    id: "a4",
    nummer: "Artikel 4",
    titel: "De Dienst",
    korteTitel: "De Dienst",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Ctrl PPC biedt Opdrachtgever toegang tot het Platform, waarmee campagnedata van Gekoppelde " +
            "Platformen wordt opgehaald, geaggregeerd en geanalyseerd, en waarmee met behulp van " +
            "AI-modelproviders hypotheses, bevindingen en aanbevelingen worden gegenereerd ten behoeve van " +
            "de advertentiestrategie van Opdrachtgever of diens klanten.",
          "De door het Platform gegenereerde output — waaronder analyses, hypotheses, " +
            "aanbevelingen, prognoses en scores — is **adviserend en ondersteunend van aard**. De " +
            "output is (mede) gebaseerd op geautomatiseerde verwerking van data via AI-modellen en vormt " +
            "geen garantie, toezegging of resultaatsverplichting van Ctrl PPC.",
          "Ctrl PPC spant zich in om het Platform met zorg en naar beste kunnen beschikbaar te stellen " +
            "en te onderhouden, maar verbindt zich niet tot een bepaald percentage beschikbaarheid " +
            "(uptime), tenzij Partijen dit Schriftelijk anders zijn overeengekomen in een Service Level " +
            "Agreement.",
          "Ctrl PPC is gerechtigd het Platform, de functionaliteiten en de gehanteerde AI-modellen te " +
            "wijzigen, uit te breiden of te beperken, mits de kernfunctionaliteit van de Dienst daardoor " +
            "niet wezenlijk wordt aangetast.",
        ],
      },
    ],
  },
  {
    id: "a5",
    nummer: "Artikel 5",
    titel: "Verplichtingen van Opdrachtgever",
    korteTitel: "Verplichtingen van Opdrachtgever",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Opdrachtgever is verantwoordelijk voor het verlenen van de benodigde (API-)toegang tot de " +
            "Gekoppelde Platformen, en staat ervoor in dat hij daartoe gerechtigd is, onder meer doordat " +
            "hij zelf rechthebbende is op de betreffende advertentieaccounts of daartoe rechtsgeldig is " +
            "gemachtigd door de betreffende klant.",
          "Opdrachtgever is verantwoordelijk voor de juistheid en volledigheid van de door hem " +
            "aangeleverde gegevens, instellingen, doelstellingen en targets binnen het Platform. Onjuiste " +
            "of onvolledige invoer kan leiden tot onjuiste of onbruikbare analyses en adviezen; Ctrl PPC " +
            "is daarvoor niet aansprakelijk.",
          "**Opdrachtgever blijft te allen tijde zelf verantwoordelijk voor:** de daadwerkelijke " +
            "inrichting, uitvoering en het beheer van advertentiecampagnes; beslissingen omtrent de " +
            "besteding, verhoging, verlaging of stopzetting van advertentiebudgetten; en de beoordeling " +
            "of, en op welke wijze, een door het Platform gegenereerde hypothese, bevinding of aanbeveling " +
            "wordt opgevolgd.",
          "Het Platform en de daarin vervatte adviezen zijn een hulpmiddel bij de besluitvorming van " +
            "Opdrachtgever, en vervangen niet het eigen professionele oordeel van Opdrachtgever of diens " +
            "medewerkers.",
          "Opdrachtgever zal de inloggegevens tot het Platform vertrouwelijk behandelen en niet aan " +
            "onbevoegde derden verstrekken, en is aansprakelijk voor handelingen die via zijn account " +
            "worden verricht.",
        ],
      },
    ],
  },
  {
    id: "a6",
    nummer: "Artikel 6",
    titel: "Geen garantie op resultaat of rendement (ROI)",
    korteTitel: "Geen garantie op resultaat of rendement",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "**Ctrl PPC geeft geen enkele garantie, toezegging of prognose ten aanzien van het financiële " +
            "resultaat, rendement, return on investment (ROI), omzet, conversieratio's, kostenbesparing of " +
            "enig ander commercieel resultaat** dat Opdrachtgever met behulp van het Platform, de daarin " +
            "gegenereerde analyses of adviezen zou kunnen behalen.",
          "Door het Platform gepresenteerde prognoses, forecasts, doelstellingsstatussen en " +
            "benchmarkvergelijkingen zijn statistische inschattingen op basis van historische data en " +
            "modelmatige aannames. Zij vormen geen garantie voor toekomstige prestaties en kunnen afwijken " +
            "van de daadwerkelijke uitkomsten.",
          "Resultaten van advertentiecampagnes zijn afhankelijk van een groot aantal factoren buiten de " +
            "invloedssfeer van Ctrl PPC, waaronder marktomstandigheden, concurrentiegedrag, wijzigingen in " +
            "advertentieplatformen, de kwaliteit van de aangeboden producten of diensten van " +
            "Opdrachtgever, en de wijze waarop Opdrachtgever of diens klant de gegeven adviezen al dan " +
            "niet opvolgt.",
          "Elke aansprakelijkheid van Ctrl PPC voor gederfde omzet, gemiste besparingen, verminderde ROI " +
            "of andere vormen van (gevolg)schade die voortvloeit uit of verband houdt met de inhoud van " +
            "analyses, hypotheses of aanbevelingen, is uitgesloten, onverminderd het bepaalde in artikel " +
            "13.",
        ],
      },
    ],
  },
  {
    id: "a7",
    nummer: "Artikel 7",
    titel: "Afhankelijkheid van derden: Gekoppelde Platformen en AI-modelproviders",
    korteTitel: "Afhankelijkheid van derden",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Het Platform is voor het functioneren afhankelijk van de beschikbaarheid, werking en " +
            "voorwaarden van Gekoppelde Platformen (waaronder Google Ads, Meta en LinkedIn) en " +
            "AI-modelproviders (waaronder OpenRouter en de daarachter liggende modelaanbieders). Deze " +
            "derde partijen zijn niet door Ctrl PPC gecontroleerde partijen.",
        ],
      },
      {
        soort: "genummerd",
        start: 2,
        items: [
          "**Ctrl PPC is niet aansprakelijk voor schade, uitval, vertraging of onjuiste of " +
            "onvolledige werking van de Dienst voor zover deze het gevolg is van:**",
        ],
      },
      {
        soort: "lijst",
        items: [
          "storingen, onderhoud of downtime bij Gekoppelde Platformen of AI-modelproviders;",
          "wijzigingen, beperkingen, deprecatie of stopzetting van API's, endpoints of functionaliteiten " +
            "door Gekoppelde Platformen of AI-modelproviders;",
          "rate limits, quota, throttling of andere toegangsbeperkingen die door Gekoppelde Platformen " +
            "of AI-modelproviders worden opgelegd;",
          "wijzigingen in het beleid, de voorwaarden of de tarieven van Gekoppelde Platformen of " +
            "AI-modelproviders;",
          "het (tijdelijk of blijvend) intrekken van API-toegang door Opdrachtgever, diens klant, of het " +
            "Gekoppelde Platform zelf;",
          "onjuistheden, vertekeningen of hiaten in de brondata die door Gekoppelde Platformen wordt " +
            "aangeleverd;",
          "fouten, onnauwkeurigheden, “hallucinaties” of onverwachte output van " +
            "AI-modellen die door AI-modelproviders worden geleverd.",
        ],
      },
      {
        soort: "genummerd",
        start: 3,
        items: [
          "Indien een Gekoppeld Platform of AI-modelprovider zijn dienstverlening wijzigt op een wijze " +
            "die redelijkerwijs noodzaakt tot aanpassing van het Platform, spant Ctrl PPC zich in om deze " +
            "aanpassing binnen een redelijke termijn door te voeren, zonder dat hieraan een " +
            "resultaatsverplichting of termijngarantie is verbonden.",
          "Opdrachtgever erkent dat door AI-modellen gegenereerde tekst en analyses een probabilistisch " +
            "karakter hebben en fouten kunnen bevatten. Opdrachtgever dient de output van het Platform te " +
            "allen tijde op aannemelijkheid te (laten) beoordelen alvorens daarop te handelen.",
        ],
      },
    ],
  },
  {
    id: "a8",
    nummer: "Artikel 8",
    titel: "Intellectueel eigendom",
    korteTitel: "Intellectueel eigendom",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Alle rechten van intellectuele eigendom op het Platform, de onderliggende software, " +
            "algoritmen, prompts, modellen, documentatie en het uiterlijk van het Platform, berusten " +
            "uitsluitend bij Ctrl PPC of diens licentiegevers.",
          "Opdrachtgever verkrijgt uitsluitend een niet-exclusief, niet-overdraagbaar gebruiksrecht op " +
            "het Platform voor de duur van de Overeenkomst en ten behoeve van zijn eigen bedrijfsvoering.",
          "De door het Platform gegenereerde rapportages, analyses en exportbestanden die specifiek " +
            "betrekking hebben op de data van Opdrachtgever, mogen door Opdrachtgever vrij worden gebruikt " +
            "binnen zijn eigen onderneming en jegens diens eigen klanten.",
          "Het is Opdrachtgever niet toegestaan het Platform te decompileren, te reverse-engineeren, of " +
            "de onderliggende prompts, promptstructuren of modelconfiguraties te extraheren of te " +
            "reproduceren, behoudens voor zover dwingend Nederlands recht dit toestaat.",
        ],
      },
    ],
  },
  {
    id: "a9",
    nummer: "Artikel 9",
    titel: "Vertrouwelijkheid",
    korteTitel: "Vertrouwelijkheid",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Partijen zullen alle informatie die zij van elkaar ontvangen en waarvan zij weten of " +
            "redelijkerwijs behoren te weten dat deze vertrouwelijk is, geheimhouden, tenzij een wettelijke " +
            "plicht tot openbaarmaking dwingt.",
          "Deze verplichting geldt niet voor informatie die reeds openbaar was, die de ontvangende partij " +
            "al rechtmatig bezat, of die zelfstandig door de ontvangende partij is ontwikkeld.",
        ],
      },
    ],
  },
  {
    id: "a10",
    nummer: "Artikel 10",
    titel: "Verwerking van persoonsgegevens",
    korteTitel: "Verwerking van persoonsgegevens",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Voor zover Ctrl PPC bij de uitvoering van de Overeenkomst persoonsgegevens verwerkt ten " +
            "behoeve van Opdrachtgever, doet zij dit als verwerker in de zin van de Algemene Verordening " +
            "Gegevensbescherming (AVG), overeenkomstig het [[Privacy Statement|/privacy]] en een tussen " +
            "Partijen te sluiten verwerkersovereenkomst.",
          "Voor zover Ctrl PPC persoonsgegevens verwerkt over Opdrachtgever zelf en diens gebruikers " +
            "(bijvoorbeeld accountgegevens en facturatiegegevens), doet zij dit als zelfstandig " +
            "verwerkingsverantwoordelijke, zoals nader toegelicht in het Privacy Statement.",
          "Opdrachtgever staat ervoor in dat hij gerechtigd is de persoonsgegevens die hij via het " +
            "Platform (doet) verwerken aan Ctrl PPC te verstrekken, en dat hij ten aanzien van betrokkenen " +
            "aan diens eigen AVG-verplichtingen heeft voldaan.",
        ],
      },
    ],
  },
  {
    id: "a11",
    nummer: "Artikel 11",
    titel: "Prijzen en betaling",
    korteTitel: "Prijzen en betaling",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Alle prijzen zijn exclusief BTW en andere heffingen van overheidswege, tenzij anders vermeld.",
          "Facturatie vindt plaats overeenkomstig de in het aanbod of de Overeenkomst vermelde termijn, " +
            "bij gebreke waarvan maandelijks vooraf wordt gefactureerd.",
          "Betaling dient te geschieden binnen {{betalingstermijnDagen}} dagen na factuurdatum, zonder " +
            "recht op verrekening of opschorting door Opdrachtgever, tenzij dwingend recht anders bepaalt.",
          "Bij niet-tijdige betaling is Opdrachtgever van rechtswege in verzuim en is de wettelijke " +
            "handelsrente (artikel 6:119a BW) verschuldigd, onverminderd het recht van Ctrl PPC om de " +
            "toegang tot het Platform op te schorten.",
          "Ctrl PPC is gerechtigd haar tarieven jaarlijks te indexeren, dan wel te wijzigen met " +
            "inachtneming van een redelijke aankondigingstermijn van ten minste {{wijzigingstermijnDagen}} " +
            "dagen.",
        ],
      },
    ],
  },
  {
    id: "a12",
    nummer: "Artikel 12",
    titel: "Duur en beëindiging",
    korteTitel: "Duur en beëindiging",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "De Overeenkomst wordt aangegaan voor de in het aanbod vermelde duur, en wordt bij gebreke van " +
            "een uitdrukkelijke opzegging telkens stilzwijgend verlengd met dezelfde periode, tenzij anders " +
            "overeengekomen.",
          "Elk der Partijen kan de Overeenkomst Schriftelijk opzeggen met inachtneming van een " +
            "opzegtermijn van {{opzegtermijn}} tegen het einde van de dan lopende contractperiode.",
          "Ctrl PPC is gerechtigd de Overeenkomst met onmiddellijke ingang, zonder ingebrekestelling en " +
            "zonder tot enige schadevergoeding gehouden te zijn, geheel of gedeeltelijk op te schorten of " +
            "te ontbinden, indien Opdrachtgever in staat van faillissement wordt verklaard, surseance van " +
            "betaling aanvraagt, of anderszins de vrije beschikking over zijn vermogen verliest, dan wel " +
            "indien Opdrachtgever een wezenlijke verplichting uit de Overeenkomst niet nakomt en dit " +
            "verzuim niet binnen een redelijke termijn na Schriftelijke ingebrekestelling herstelt.",
          "Na beëindiging van de Overeenkomst wordt de toegang tot het Platform beëindigd. " +
            "Ctrl PPC bewaart de data van Opdrachtgever gedurende de in het Privacy Statement genoemde " +
            "termijn, waarna deze wordt verwijderd, tenzij een wettelijke bewaarplicht (zoals de fiscale " +
            "bewaarplicht voor facturatiegegevens) anders vereist.",
        ],
      },
    ],
  },
  {
    id: "a13",
    nummer: "Artikel 13",
    titel: "Aansprakelijkheid",
    korteTitel: "Aansprakelijkheid",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "De totale aansprakelijkheid van Ctrl PPC jegens Opdrachtgever, uit welke hoofde dan ook " +
            "— contractueel, uit onrechtmatige daad of anderszins — is per gebeurtenis " +
            "(waarbij een reeks samenhangende gebeurtenissen als één gebeurtenis geldt) " +
            "**beperkt tot het totaalbedrag dat Opdrachtgever aan Ctrl PPC heeft betaald voor de Dienst " +
            "gedurende de {{aansprakelijkheidscapMaanden}} maanden onmiddellijk voorafgaand aan de " +
            "gebeurtenis waaruit de aansprakelijkheid voortvloeit**.{{capMaximumZin}}",
          "In geen geval is Ctrl PPC aansprakelijk voor **indirecte schade**, waaronder in elk geval " +
            "begrepen: gevolgschade, gederfde winst, gemiste besparingen, gederfde omzet, verminderde " +
            "goodwill, schade door bedrijfsstagnatie, en schade als gevolg van door AI-modelproviders of " +
            "Gekoppelde Platformen geleverde onjuiste of onvolledige data of output.",
          "De uitsluitingen en beperkingen van dit artikel gelden niet voor zover de schade het gevolg is " +
            "van opzet of bewuste roekeloosheid van Ctrl PPC of haar leidinggevenden.",
          "Iedere vordering tot schadevergoeding jegens Ctrl PPC vervalt indien deze niet binnen twaalf " +
            "(12) maanden nadat Opdrachtgever bekend werd of redelijkerwijs bekend had kunnen zijn met de " +
            "schade en de mogelijke aansprakelijkheid van Ctrl PPC, in rechte aanhangig is gemaakt.",
          "Opdrachtgever vrijwaart Ctrl PPC voor aanspraken van derden (waaronder diens eigen klanten) " +
            "die verband houden met of voortvloeien uit het gebruik van het Platform door Opdrachtgever, " +
            "waaronder begrepen aanspraken die verband houden met advertentiebeslissingen die (mede) op " +
            "basis van de output van het Platform zijn genomen.",
        ],
      },
    ],
  },
  {
    id: "a14",
    nummer: "Artikel 14",
    titel: "Overmacht",
    korteTitel: "Overmacht",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Geen van de Partijen is gehouden tot nakoming van enige verplichting indien zij daartoe " +
            "verhinderd is als gevolg van overmacht. Onder overmacht wordt in elk geval mede verstaan: " +
            "storingen bij Gekoppelde Platformen of AI-modelproviders, internet- of energiestoringen, " +
            "cyberaanvallen, overheidsmaatregelen, en storingen bij door Ctrl PPC ingeschakelde " +
            "hostingpartijen.",
          "Indien de overmachtsituatie langer dan {{overmachtstermijnDagen}} dagen voortduurt, is elk der " +
            "Partijen gerechtigd de Overeenkomst Schriftelijk te ontbinden, zonder gehoudenheid tot enige " +
            "schadevergoeding.",
        ],
      },
    ],
  },
  {
    id: "a15",
    nummer: "Artikel 15",
    titel: "Wijziging van deze voorwaarden",
    korteTitel: "Wijziging van deze voorwaarden",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Ctrl PPC is gerechtigd deze algemene voorwaarden te wijzigen. Gewijzigde voorwaarden worden " +
            "ten minste {{wijzigingstermijnDagen}} dagen voor inwerkingtreding Schriftelijk aan " +
            "Opdrachtgever bekendgemaakt.",
          "Indien Opdrachtgever niet instemt met een wezenlijke wijziging, is hij gerechtigd de " +
            "Overeenkomst op te zeggen tegen de datum waarop de wijziging in werking treedt.",
        ],
      },
    ],
  },
  {
    id: "a16",
    nummer: "Artikel 16",
    titel: "Toepasselijk recht en geschillen",
    korteTitel: "Toepasselijk recht en geschillen",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Op de Overeenkomst en deze algemene voorwaarden is uitsluitend **Nederlands recht** van " +
            "toepassing. De toepasselijkheid van het Weens Koopverdrag is uitgesloten.",
          "Geschillen die voortvloeien uit of verband houden met de Overeenkomst worden bij uitsluiting " +
            "voorgelegd aan de bevoegde rechter te {{arrondissement}}, onverminderd het recht van Ctrl PPC " +
            "om een geschil voor te leggen aan de volgens de wet bevoegde rechter.",
        ],
      },
    ],
  },
  {
    id: "a17",
    nummer: "Artikel 17",
    titel: "Slotbepalingen",
    korteTitel: "Slotbepalingen",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "Ctrl PPC is gerechtigd haar rechten en verplichtingen uit de Overeenkomst over te dragen aan " +
            "een derde in het kader van een overdracht van (een deel van) haar onderneming, zonder " +
            "voorafgaande toestemming van Opdrachtgever.",
          "Opdrachtgever is niet gerechtigd rechten of verplichtingen uit de Overeenkomst zonder " +
            "voorafgaande Schriftelijke toestemming van Ctrl PPC aan een derde over te dragen.",
        ],
      },
    ],
  },
];

export const ALGEMENE_VOORWAARDEN: JuridischDocument = {
  slug: "terms",
  titel: "Algemene Voorwaarden",
  taalnoot:
    "This document is published in Dutch. Ctrl PPC contracts under Dutch law, and the Dutch text is " +
    "the binding version — a translation would risk saying something subtly different from the " +
    "text that was actually reviewed.",
  inleiding:
    "Deze algemene voorwaarden zijn van toepassing op alle overeenkomsten tussen {{handelsnaam}}, " +
    "statutair gevestigd te {{vestigingsplaats}}, ingeschreven bij de Kamer van Koophandel onder nummer " +
    "{{kvkNummer}}, BTW-identificatienummer {{btwNummer}} (hierna: **“Ctrl PPC”**), en " +
    "de opdrachtgever die met Ctrl PPC een overeenkomst aangaat (hierna: " +
    "**“Opdrachtgever”**), met betrekking tot het gebruik van het platform Ctrl PPC.",
  paragrafen: VOORWAARDEN_PARAGRAFEN,
  slotnoot:
    "Deze voorwaarden gelden samen met het [[Privacy Statement|/privacy]] en de verwerkersovereenkomst " +
    "die daarin wordt genoemd; bij strijdigheid over de verwerking van persoonsgegevens gaat de " +
    "verwerkersovereenkomst voor.",
};

// ── Data deletion ──────────────────────────────────────────────────────────
// Geen vertaling van een stuk uit het Privacy Statement, maar de aparte pagina die Meta bij App
// Review vraagt als "Data Deletion Instructions URL": een bezoeker moet zonder account kunnen
// lezen hoe hij verwijdering vraagt en wat er dan gebeurt. Privacy §8 verwijst ernaar.
//
// ENGELS, ANDERS DAN DE TWEE DOCUMENTEN HIERBOVEN. Die zijn Nederlands omdat het de nagelezen,
// bindende contractteksten zijn. Dit is geen contract maar een instructie, en de twee lezers zijn
// een reviewer van Meta of Google en een bezoeker van een Engelstalige site. Onderaan staat
// dezelfde procedure in het Nederlands, zodat een Nederlandse betrokkene die zijn AVG-recht
// uitoefent niet op een Engelse pagina wordt vastgezet.

const DATA_DELETION_PARAGRAFEN: Paragraaf[] = [
  {
    id: "d1",
    nummer: "§1",
    titel: "What we hold",
    korteTitel: "What we hold",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Ctrl PPC is a B2B analytics platform. We hold three kinds of data about a customer: the " +
          "account details of the people who log in, the advertising and website data we read from the " +
          "platforms that customer connected (Google Ads, Meta Ads, LinkedIn Ads, Google Analytics 4, " +
          "Google Search Console), and the analyses our platform generated from it.",
      },
      {
        soort: "alinea",
        tekst:
          "We never receive login credentials for those platforms. What we hold is an access token, " +
          "stored in a separate encrypted vault, that lets us **read** reporting data. We do not write " +
          "anything back.",
      },
    ],
  },
  {
    id: "d2",
    nummer: "§2",
    titel: "How to request deletion",
    korteTitel: "How to request deletion",
    blokken: [
      {
        soort: "genummerd",
        items: [
          "**Disconnect the platform.** In Ctrl PPC, open Settings and disconnect the account you want " +
            "us to stop reading. You can also revoke our access from the platform's own side: in Google " +
            "through your Google Account's third-party access settings, in Meta through Business " +
            "Settings, in LinkedIn through your account's permitted services. From that moment we can no " +
            "longer read new data.",
          "**Email us to erase what we already hold.** Send a message to {{contactEmail}} from the " +
            "address associated with the account, naming the customer or client account concerned. " +
            "Disconnecting stops new data coming in; it does not by itself erase what is already stored.",
          "**We confirm what will go, then erase it.** We reply with an inventory of what is held for " +
            "that account, and once you confirm, we erase it. We respond within one month, the statutory " +
            "period under Article 12(3) GDPR.",
        ],
      },
    ],
  },
  {
    id: "d3",
    nummer: "§3",
    titel: "What is erased, and what is kept",
    korteTitel: "What is erased, and what is kept",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Erasure covers the account data, the campaign and website data read from connected platforms, " +
          "the generated analyses and reports, and the stored access tokens. Two categories survive, and " +
          "we would rather say so here than surprise you afterwards:",
      },
      {
        soort: "lijst",
        items: [
          "**Invoicing and accounting records**, for the seven-year statutory retention period under " +
            "Dutch tax law (Article 52 AWR). We are not permitted to erase these on request.",
          "**Aggregated, anonymised statistics** that can no longer be traced to an account, person or " +
            "campaign. These are no longer personal data, and erasing them would not add any protection.",
        ],
      },
      {
        soort: "alinea",
        tekst:
          "See the [[Privacy Statement|/privacy]] for the retention period of each category, and the " +
          "[[Terms of Service|/terms]] for what happens to your data when an agreement ends.",
      },
    ],
  },
  {
    id: "d4",
    nummer: "§4",
    titel: "In het Nederlands",
    korteTitel: "In het Nederlands",
    blokken: [
      {
        soort: "alinea",
        tekst:
          "Wilt u dat wij uw gegevens verwijderen? Verbreek de koppeling in Ctrl PPC onder Instellingen " +
          "(of trek onze toegang in bij Google, Meta of LinkedIn zelf) en stuur daarna een bericht aan " +
          "{{contactEmail}} vanaf het e-mailadres dat bij het account hoort, met vermelding van de klant " +
          "of het account waar het om gaat. Het verbreken van de koppeling stopt de aanvoer van nieuwe " +
          "data; het wist niet uit zichzelf wat er al staat.",
      },
      {
        soort: "alinea",
        tekst:
          "Wij sturen u een overzicht van wat er voor dat account bewaard wordt, en verwijderen het na " +
          "uw bevestiging. Wij reageren binnen één maand (art. 12 lid 3 AVG). Facturatie- en " +
          "administratiegegevens houden wij zeven jaar, omdat de fiscale bewaarplicht (art. 52 AWR) ons " +
          "dat voorschrijft; geanonimiseerde, niet meer herleidbare statistiek blijft eveneens bestaan. " +
          "Zie het [[Privacy Statement|/privacy]] voor de bewaartermijn per categorie.",
      },
    ],
  },
];

export const DATA_DELETION: JuridischDocument = {
  slug: "data-deletion",
  titel: "Data deletion",
  taalnoot:
    "Deze pagina staat in het Engels omdat hij ook door reviewers van Google en Meta gelezen wordt. " +
    "Paragraaf 4 geeft dezelfde procedure in het Nederlands.",
  inleiding:
    "This page explains how to have data held by {{handelsnaam}} erased, and what happens once you " +
    "ask. It covers customers of Ctrl PPC and anyone whose data reached us through a customer. For " +
    "the full picture of what we process and why, see the [[Privacy Statement|/privacy]].",
  paragrafen: DATA_DELETION_PARAGRAFEN,
  slotnoot:
    "Bent u eindgebruiker en heeft een marketingbureau uw gegevens in Ctrl PPC gezet, dan is dat bureau " +
    "de verwerkingsverantwoordelijke en wij de verwerker. Richt uw verzoek dan in eerste instantie tot " +
    "dat bureau; wij ondersteunen hen bij de afhandeling.",
};

export const JURIDISCHE_DOCUMENTEN = [PRIVACY_STATEMENT, ALGEMENE_VOORWAARDEN, DATA_DELETION];
