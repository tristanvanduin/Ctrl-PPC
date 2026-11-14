# Elementen: Overzicht, nieuwe weergave, hoogte (basis b529c9d, herstelronde patch-v2)

Regel van de eigenaar: geen inzicht verdwijnt; het mag verhuizen of achter een klik. "Klik" betekent
hier steeds een knop met aria-expanded, een label dat zegt wat erachter zit, een tikvlak van 44 px,
en (bij Uitklap) inhoud die IN de DOM blijft met `hidden`. Met de schakelaar uit verandert niets.

| Blok | Element | Voor | Na | Waar het nu staat | Klik of open |
|---|---|---|---|---|---|
| Bovenkant | kerncijfertegels (5) | label, getal, verloopje eronder, delta | ongewijzigd. De poging "verloopje naast het getal" uit de vorige ronde is teruggedraaid: € 117.000 in de grote maat plus 72 px verloop past niet in een halve kolom van ongeveer 155 px, dus het brak toch om en won niets | zelfde tegel | open |
| Bovenkant | kanaalkaarten | veegstrook op telefoon | ongewijzigd (was al een snap-strook) | zelfde | open |
| Bijdrage per kanaal | per kanaal: aandeel kosten, aandeel conversies, CPA, CPA-verandering, kenmerk | open | open, iets compacter op telefoon | zelfde kaart | open |
| Bijdrage per kanaal | uitleg (aandelen tellen tot 100, drempel kenmerk, CPA-verandering) | altijd open | achter "Waarom deze kenmerken en aandelen?" | zelfde kaart | klik (in DOM) |
| Na de klik | per stap per kanaal aantal + verandering | verandering op eigen regel | verandering naast het getal op telefoon | zelfde kaart | open |
| Na de klik | "niet opgeteld" | lange zin onder de kaart | kort "per kanaal, niet opgeteld" in de kop | kop van de kaart | open |
| Na de klik | noten per kanaal (dagcijfers niet geladen, pas vanaf, waarom geen vergelijking) | open | OPEN, onder de stappen: het voorbehoud bij een getal dat open staat | zelfde kaart | open |
| Na de klik | NIET_OPTELLEN-zin (voor elke klant dezelfde) | open | achter "Waarom niet opgeteld?" | zelfde kaart | klik (in DOM) |
| Wat er gebeurde | regels 1-3 | open | open | zelfde | open |
| Wat er gebeurde | regel 4 | open | op telefoon achter "Toon N regels meer" (vanaf lg open zoals voorheen); knop is het gedeelde MeerKnopPerBreedte | zelfde lijst | klik onder lg (in DOM) |
| Wat er gebeurde | regel 5+ | achter "Toon meer" | idem (knop met aria-expanded) | zelfde | klik |
| Waar komt het vandaan | ranglijst regio 1-3 | open | open | zelfde kaart | open |
| Waar komt het vandaan | ranglijst regio 4-6 | open | onder lg achter "Toon N landen meer" (in de boom, max-lg:hidden); vanaf lg open zoals voorheen | zelfde lijst | klik onder lg (in DOM) |
| Waar komt het vandaan | regio 7+ | achter "Toon N landen meer" | idem (knop nu met aria-expanded) | zelfde | klik |
| Waar komt het vandaan | projectie, kop, metriekkeuze, venster, VS-hint, tabel per land | open / lade | ongewijzigd | zelfde | open / klik |
| Account Health (Google, Meta, LinkedIn, Microsoft) | score | grote boog | kleinere boog met het getal | samenvatting | open |
| Account Health | oordeel | alleen kleur | woord: gezond / vraagt aandacht / zwak / te weinig beoordeeld | samenvatting | open |
| Account Health | zwakste factor + aantal signalen | niet apart | in de samenvattingsregel | samenvatting | open |
| Account Health | kritieke signalen (titel) | in de lijst rechts | in de samenvatting, rood icoon | samenvatting | open |
| Account Health | radar / staafjes, vijf factoren met uitleg, alle signalen met uitleg | open | achter "Toon onderbouwing: radar, factoren en alle signalen" | zelfde kaart | klik (in DOM); OPEN bij score < 50 |
| Account Health per kanaal (Alle kanalen) | rangschikking + onderbouwing | al samengevat (Lade) | ongewijzigd | zelfde | open / klik |
| Spend per kanaal (Alle kanalen) | kostenverdeling in % per kanaal | in de ring + legenda | één regel met kleurblokje, "Google 70% · Meta 20% · Microsoft 10% van de kosten", met dezelfde buildNetworkSplit en pct() als de legenda (getoetst: gelijk) | in de kaart zelf (CampaignTypeSplit samenvatten); één kop, één vensterlabel | open |
| Spend per kanaal | de twee ringen (kosten, conversies), legenda met aandelen, filter | open | achter "Toon de ringen: kosten en conversies per kanaal" | zelfde kaart | klik (in DOM) |
| Spend per kanaal | tabel per kanaal | achter "Toon de cijfers per kanaal" | ongewijzigd | zelfde kaart | klik |
| Spend per kanaal | voorbehoud "geen conversies, alleen kosten" | open | open, boven de knop | zelfde kaart | open |
| Pacing Google (PacingMonitor) | ring conversies + ring budget, met %, x / doel, oordeel | open, groot | open, kleiner (88 px) | samenvatting | open |
| Pacing Google | tempo conv/dag, tempo spend/dag, nodig per dag, op dit tempo, volgens prognose | open | achter "Toon tempo per dag en waar het jaar uitkomt" | zelfde kaart | klik (in DOM); OPEN bij "Sterk achter" (rood), getoetst met een fixture die sterk achterloopt en een op schema |
| Pacing Google | seizoensduiding ("de prognose ligt X% hoger/lager dan de rechte lijn") | open, alleen bij een afwijking | OPEN, onder de ringen, buiten de knop | samenvatting | open |
| Pacing kanaal (ChannelPacing) | ring spend + ring conversies, oordeel (In de pas / Loopt achter / voor) | open, groot | open, kleiner | samenvatting | open |
| Pacing kanaal | tempo spend/dag, tempo conv/dag, op dit tempo (2x), voetregel rechte lijn | open | achter "Toon tempo per dag en eindstand van de maand" | zelfde kaart | klik (in DOM); geen rood in deze kaart, het oordeel staat in de ring |
| Prestaties richting de beurs | deze week: waarde, verwacht, ratio, oordeel | open (Alle kanalen compact; kanalen/Google 3 weekkaarten) | open, compact op alle tabbladen | regel "Deze week" | open |
| Prestaties richting de beurs | vorige en volgende week (weekkaarten) | open op kanalen/Google | in de strook en in het venster "alle metrics" | strook / popover | klik |
| Prestaties richting de beurs | weekstrook W-8..W+2 met ratio's en uitleg oranje kolom | open | achter "Toon de weken rond de beurs (N)" | zelfde kaart | klik (in DOM); OPEN als deze week onder verwachting ligt (weekOnderVerwachting; getoetst met beide fixtures) |
| Prestaties richting de beurs | aftelling, metriekkeuze, afgeleide-datummelding, vensterlabel | open | open | kop van de kaart | open |
| Pacing & jaaroverzicht | per metriek: prognose + vs doel (%, icoon, gunstig/ongunstig) + doel | in de tabel | samenvattingslijst | samenvatting | open (een achterlopende metriek staat hier rood met icoon) |
| Pacing & jaaroverzicht | budgetadvies | open | open, vóór de knop | zelfde | open |
| Pacing & jaaroverzicht | tabel: gerealiseerd, tegen vorig jaar (+ deel), jaardoel, prognose, vs doel, voortgang/verwacht | open | achter "Toon de tabel: gerealiseerd, tegen vorig jaar, jaardoel en voortgang" | zelfde kaart | klik (in DOM) |
| Pacing & jaaroverzicht | voetregel: gemiddeld per maand, herkomst doel, kosten zonder oordeel, bovengrens, uitgesloten kanaal | open | in hetzelfde uitklapdeel | zelfde kaart | klik (in DOM) |
| Pacing & jaaroverzicht | grafiek + gelijk-voor-gelijk + recht doorgetrokken | achter "Verloop en prognose" | ongewijzigd | zelfde | klik (niet in DOM, zoals voorheen) |
| Kanaaltotalen (Alle kanalen) | tabel + voorbehouden | achter "Toon als tabel" | ongewijzigd | zelfde | klik |
| Verdeling (Google) | verdeling per campagnetype / campagne in % | ring + legenda | één regel, de grootste drie of vier en "en N andere" | in de kaart, onder de kiezer | open |
| Verdeling (Google) | ringen kosten en conversies, legenda, filter | open | achter "Toon de ringen: kosten en conversies per campagnetype" | zelfde kaart | klik (in DOM) |
| Verdeling (Meta levering en doelgroep, LinkedIn doelgroep) | scheefheid ("krijgt X% van het budget maar levert Y%") | open | open: dat is het oordeel | bovenaan de kaart | open |
| Verdeling (Meta, LinkedIn) | verdeling van de spend per segment in % | ring + strepenraster | één regel, grootste drie of vier en "en N andere" | onder de scheefheid | open |
| Verdeling (Meta, LinkedIn) | ring en strepenraster (spend tegen conversies per segment) | open | achter "Toon de ring en de aandelen in spend en conversies" | zelfde kaart | klik (in DOM) |
| Verdeling (alle) | tabel per segment, voorbehoud zonder conversies | lade / open | ongewijzigd | zelfde | klik / open |
| Detail op aanvraag, Wat nu, hoofdgrafiek | | | ongewijzigd in deze ronde | | |

Niet geraakt (en dus ook niet korter): de projectie van de wereldkaart, de hoofdgrafiek, Detail op
aanvraag, Wat nu, de kop van Kanaaltotalen, de kerncijfertegels en de kanaalkaarten.

Uitklap bewaart de keuze alleen bij een gewone stand (localStorage, onder het id). Bij een afwijking
wordt niets bewaard: wie een rode onderbouwing dichtklapt, ziet hem bij de volgende klant of de
volgende sessie weer open.

Schakelaar uit, gecontroleerd tegen b529c9d (zelfde fixtures, byte voor byte gelijk): PacingMonitor
(gewoon en stapelSmal, op schema en sterk achter), ChannelPacing (in de pas en achter), FairWeeksView,
HealthBadgeView, ChannelHealthBadge, CampaignTypeSplit (kanaal), GeoRanglijstInKaart onder de kaart.
Alleen PacingJaaroverzicht wijkt af, en die staat alleen in de nieuwe weergave. BreakdownDonuts is
niet zo vergeleken (leest zelf uit de database); de vertrouwde takken geven hem geen samenvatten mee
(getoetst op de bron).
