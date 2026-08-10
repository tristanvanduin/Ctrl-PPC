// Fase 7, Task 3: voorbeeldcontent voor /blog. Er is geen CMS in deze codebase en dat wordt met
// deze drie posts ook niet geintroduceerd: een vaste lijst is genoeg voor een grid-overzicht en
// een artikel-template, en een echte redactieworkflow is een aparte beslissing voor later. De
// inhoud is door mij geschreven als representatief voorbeeld van het soort technische analyse dat
// deze rubriek zou dragen; het bevat bewust geen verzonnen klantcijfers of onderzoeksclaims.

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
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
