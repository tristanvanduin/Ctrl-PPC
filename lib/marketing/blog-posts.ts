// Fase 7, Task 3 (uitgebreid in de SEO/GEO-fase): voorbeeldcontent voor /blog. Er is geen CMS
// in deze codebase en dat wordt met deze posts ook niet geintroduceerd: een vaste lijst is
// genoeg voor een grid-overzicht en een artikel-template, en een echte redactieworkflow is een
// aparte beslissing voor later. De laatste drie (kanaalsynergie, RSA-assets, KPI-relaties) zijn
// gericht geschreven op zoekopdrachten en LLM-vragen van een specialist die naar precies dit
// probleem zoekt, en zijn gegrond in echte, bestaande analysecapaciteit (lib/cross-channel/
// funnel-overlap.ts, rsa-insights-facts.ts, lib/analysis/kpi-relations) -- geen verzonnen
// klantcijfers of onderzoeksclaims, ook hier niet.

export interface BlogPost {
  slug: string;
  titel: string;
  samenvatting: string;
  datum: string;
  leesminuten: number;
  inhoud: string[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "gemiddelde-cpa-verkeerde-vraag",
    titel: "Waarom een gemiddelde CPA de verkeerde vraag is",
    samenvatting:
      "Een enkel CPA-cijfer per maand middelt twee heel verschillende accounts tot dezelfde uitkomst. Wat je erdoor mist, en waar je wel naar moet kijken.",
    datum: "2026-06-02",
    leesminuten: 6,
    inhoud: [
      "Een campagne met een CPA van 40 euro kan twee heel verschillende accounts beschrijven: een die " +
        "overal stabiel rond de 40 euro zit, en een die op desktop overdag 15 euro haalt en 's avonds op " +
        "mobiel 90. Het gemiddelde is in beide gevallen hetzelfde getal, en in beide gevallen de verkeerde " +
        "vraag om te stellen.",
      "De vraag die wel werkt, is een uitsplitsing: per dagdeel, per device, en waar relevant per " +
        "doelgroep. Niet omdat meer detail altijd beter is, maar omdat een bod-strategie op accountniveau " +
        "reageert op het gemiddelde, terwijl de kosten per dagdeel en device ontstaan. Een tROAS-target dat " +
        "past bij het gemiddelde past daardoor bij geen van beide segmenten echt.",
      "Praktisch betekent dit: voor je een biedstrategie bijstelt, splits eerst de periode waarin het " +
        "probleem optrad uit naar dagdeel en device. Een piek die zich beperkt tot een paar avonduren op " +
        "mobiel vraagt om een andere aanpassing dan een structureel te hoge CPA over de hele dag. Het " +
        "6-staps Decision Framework van Ctrl PPC bouwt hierop voort: de hypothese die uit een signaal " +
        "volgt, wijst naar het segment waarin het probleem daadwerkelijk zit, niet naar het account als " +
        "geheel.",
    ],
  },
  {
    slug: "impression-share-dashboard-vertelt-niet",
    titel: "Wat een dashboard je niet vertelt over impression share",
    samenvatting:
      "Impression share daalt, en het dashboard laat een rode lijn zien. De reden waarom staat er meestal niet bij, en die reden bepaalt welke actie zin heeft.",
    datum: "2026-06-24",
    leesminuten: 5,
    inhoud: [
      "Impression share (search) daalt om een van twee redenen: budget of rank. Een dashboard dat alleen " +
        "het percentage toont, dwingt je te gokken welke van de twee het is, en de verkeerde gok kost geld " +
        "in de verkeerde richting. Een budgetprobleem oplossen met een hogere bieding verhoogt de CPC zonder " +
        "het onderliggende tekort weg te nemen; een rank-probleem oplossen met meer budget verhoogt de spend " +
        "zonder de vertoningen terug te winnen.",
      "Het onderscheid zit in twee losse metrics die Google Ads wel degelijk levert: search impression " +
        "share lost to budget, en search impression share lost to rank. Beide zijn zelden zichtbaar in een " +
        "standaardoverzicht, en dat is precies waar 'de dashboard illusie' vandaan komt: het scherm toont " +
        "een uitkomst, niet de twee metrics die de oorzaak uit elkaar trekken.",
      "Zodra de oorzaak bekend is, is de vervolgstap eenduidig: bij budget is de vraag of de extra spend de " +
        "marge waard is, bij rank is de vraag of het bod, de advertentiekwaliteit, of allebei achterblijven. " +
        "Twee heel verschillende gesprekken, die met een gemiddeld dashboard allebei op hetzelfde rode " +
        "cijfer uitkomen.",
    ],
  },
  {
    slug: "attributie-zonder-trackingcode",
    titel: "Attributie zonder trackingcode: wat je uit change history kunt lezen",
    samenvatting:
      "Je hoeft niet elke wijziging handmatig te loggen om te weten of een hypothese is uitgevoerd. De change history die het platform toch al bijhoudt, vertelt het je.",
    datum: "2026-07-15",
    leesminuten: 7,
    inhoud: [
      "Elk advertentieplatform houdt een change history bij: wat er is gewijzigd, wanneer, en door wie. " +
        "Die geschiedenis wordt zelden gebruikt voor iets anders dan een audit achteraf, terwijl hij ook de " +
        "ontbrekende schakel is tussen een hypothese en het resultaat dat hij voorspelde.",
      "Het probleem dat dit oplost: een metric kan verbeteren zonder dat de voorgestelde wijziging ooit is " +
        "doorgevoerd, en een metric kan gelijk blijven terwijl de wijziging wel is doorgevoerd maar door " +
        "iets anders wordt overschaduwd. Zonder de change history erbij te betrekken, is een verbeterde " +
        "metric na het accepteren van een hypothese geen bevestiging, hooguit een toeval dat er verdacht " +
        "veel op lijkt.",
      "De aanpak is niet ingewikkeld, maar vraagt wel discipline: classificeer elke wijziging naar het type " +
        "dat de hypothese voorspelde (budget, bod, status, zoekwoord), beperk dat tot het venster tussen het " +
        "accepteren van de hypothese en het meetmoment, en behandel 'geen passende wijziging gevonden' als " +
        "een eigen uitkomst, niet als een verborgen 'nee'. Die laatste stap is waar de meeste " +
        "attributiepogingen stranden: een niet-uitgevoerde hypothese wordt dan alsnog beoordeeld op cijfers " +
        "die er niets mee te maken hadden.",
    ],
  },
  {
    slug: "kanaalsynergie-bewijzen",
    titel: "Kanaalsynergie bewijzen tussen Google, Meta en LinkedIn",
    samenvatting:
      "Elk kanaal levert zijn eigen rapport, en geen enkel rapport laat zien of de kanalen elkaar versterken of dezelfde warme doelgroep dubbel betalen. Een concrete manier om dat wel te zien.",
    datum: "2026-07-28",
    leesminuten: 8,
    inhoud: [
      "Vraag een specialist of zijn kanalen elkaar versterken, en het antwoord is bijna altijd een gevoel, " +
        "geen cijfer. Google Ads rapporteert over Google Ads, Meta rapporteert over Meta, en geen van beide " +
        "weet dat de ander bestaat. Kanaalsynergie bewijzen betekent dus niet 'nog een rapport erbij', maar " +
        "een laag die over de kanalen heen naar dezelfde vraag kijkt.",
      "Die vraag valt uiteen in drie rollen die elke campagne, op elk kanaal, in feite speelt: prospecting " +
        "(nieuwe vraag aanboren), retargeting (een warme doelgroep terugpakken) en branded capture (vraag " +
        "vangen die er toch al was, op je eigen merknaam). Een campagne kun je op zijn eigen signalen in een " +
        "van de drie indelen: draait hij op eigen merktermen, dan is het branded capture. Richt hij zich op " +
        "een custom audience, websitebezoekers of een klantenlijst, dan is het retargeting. Is de doelgroep " +
        "breed of een lookalike, of is het campagnetype vraag-genererend (display, video, demand gen), dan " +
        "is het prospecting.",
      "Zodra elke campagne op elk kanaal een rol heeft, worden twee dingen zichtbaar die geen enkel los " +
        "kanaalrapport laat zien. Het eerste is het dubbel-betaal-risico: twee of drie kanalen die allemaal " +
        "dezelfde warme pool retargeten, wat de blended CPA opdrijft zonder dat een van de losse rapporten " +
        "daar iets vreemds aan ziet, want binnen elk kanaal apart lijkt de retargeting-campagne prima te " +
        "presteren. Het tweede is het groeiplafond: een portfolio dat overwegend uit retargeting en branded " +
        "capture bestaat, zonder een campagne die nieuwe vraag aanboort, groeit niet meer zodra de bestaande " +
        "pool doorverkocht is, en dat patroon is pas zichtbaar als je alle kanalen naast elkaar legt.",
      "Wat dit in de praktijk oplevert, hangt af van hoeveel doelgroepdata er beschikbaar is: op Google " +
        "Ads is de rolclassificatie vandaag volledig, want merktermen en campagnetype staan gewoon in de " +
        "data die elk account al heeft. Op Meta en LinkedIn is diezelfde classificatie zo goed als de " +
        "doelgroepdata die eronder ligt, en groeit hij mee zodra die dieper wordt uitgelezen. Een " +
        "onherkende campagne komt bewust als 'onbekend' terug in plaats van geraden te worden: bij " +
        "kanaalsynergie is een verkeerde gok duurder dan een eerlijk 'dit weten we nog niet'.",
    ],
  },
  {
    slug: "rsa-asset-dubbeltelling",
    titel: "De asset-valkuil in RSA-rapportages: wanneer je topregel een dubbeltelling is",
    samenvatting:
      "De meeste RSA-analyses stoppen op ad group-niveau. Ga je een laag dieper, naar losse assets, dan loop je zo een dubbeltelling in die je beste headline juist slechter laat lijken dan hij is.",
    datum: "2026-08-04",
    leesminuten: 6,
    inhoud: [
      "Een Responsive Search Ad bestaat niet uit één advertentietekst, maar uit een pool van headlines en " +
        "beschrijvingen die Google zelf combineert. De meeste rapportages stoppen op ad group-niveau: hoe " +
        "presteert deze RSA als geheel. Dat mist precies het niveau waarop de echte vraag zit, namelijk welke " +
        "individuele headline of beschrijving het werk doet.",
      "Ga je een laag dieper, naar performance per asset, dan is er een reden waarom weinig specialisten dat " +
        "structureel doen: dezelfde impressie, klik of conversie telt mee voor elke asset die in die specifieke " +
        "combinatie stond. Een headline die toevallig vaak samen met een sterke tweede headline werd getoond, " +
        "oogt beter dan hij op zichzelf is. Zonder een hierarchie die dat corrigeert, leidt 'onze best " +
        "presterende headline' zo tot een conclusie die vooral zegt iets over wie hij toevallig naast zich " +
        "had staan.",
      "De correctie is geen ingewikkelde statistiek, maar discipline in de volgorde van lezen: eerst de " +
        "combinaties die het vaakst voorkwamen apart houden van combinaties die zelden getoond zijn, en pas " +
        "daarna een asset op zijn eigen merites beoordelen, niet op het gemiddelde van elke combinatie waar " +
        "hij ooit in zat. Wie die hierarchie overslaat, optimaliseert op ruis die eruitziet als een patroon.",
      "Het is dezelfde reden waarom copy-analyse op asset-niveau (het equivalent op Meta heet creative " +
        "fatigue, een ander mechanisme met hetzelfde symptoom: een goed cijfer dat een verkeerd verhaal " +
        "vertelt) een apart soort aandacht verdient, los van de gewone ad group-rapportage. Het is niet " +
        "meer werk voor meer werk, het is de plek waar de dubbeltelling anders onopgemerkt blijft.",
    ],
  },
  {
    slug: "acht-kpi-relaties-die-rapportages-missen",
    titel: "Acht KPI-relaties die de meeste rapportages nooit tegen elkaar afzetten",
    samenvatting:
      "Een rapportage zet CPA, CTR en bereik meestal los van elkaar neer. Het signaal zit vaak niet in een van de twee, maar in de verhouding ertussen.",
    datum: "2026-08-10",
    leesminuten: 7,
    inhoud: [
      "De meeste rapportages behandelen elke KPI als een eigen rijtje: CPA deze maand, CTR deze maand, " +
        "bereik deze maand. Los bekeken zegt geen van de drie iets fout, en toch kan de combinatie een " +
        "probleem verbergen dat pas zichtbaar wordt zodra je twee KPI's expliciet tegen elkaar afzet.",
      "Een paar concrete voorbeelden. CPA-decompositie splitst een gestegen CPA uit naar zijn twee " +
        "mogelijke oorzaken, een gedaalde CTR of een gestegen CPC, want de vervolgstap is voor allebei " +
        "anders. Een belofte-kloof zet de boodschap in de advertentie af tegen wat de landingspagina " +
        "daadwerkelijk levert: een hoge CTR met een lage conversieratio is vaak geen targetingprobleem maar " +
        "een verwachtingenprobleem. Vanity-engagement herkent een campagne met veel interactie en weinig " +
        "waarde, het soort cijfer dat in een rapportage goed oogt en in de omzet niets doet.",
      "De andere vijf volgen dezelfde logica: verzadiging (herhaalde vertoning aan dezelfde mensen zonder " +
        "extra rendement), bereik-verdunning (een groeiend bereik met een dalende relevantie per persoon), " +
        "waarde-mix (conversies die in aantal stijgen maar in waarde dalen), herhaling-versus-bereik (frequency " +
        "die oploopt terwijl bereik stilstaat, een teken dat de doelgroep is uitgeput) en dure zichtbaarheid " +
        "(een topplek die meer kost dan hij aan extra conversies oplevert). Acht relaties, en geen ervan is " +
        "zichtbaar in een rapportage die elke KPI apart neerzet.",
      "Wat ze gemeen hebben: elke relatie draait om twee metrics die vrijwel nooit op dezelfde rij van een " +
        "rapportage staan, laat staan expliciet tegen elkaar afgezet worden. Dat is geen onwil van wie de " +
        "rapportage bouwt, het is gewoon niet waar een standaardoverzicht voor gebouwd is. Het is wel precies " +
        "waar de volgende beslissing vandaan komt.",
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
