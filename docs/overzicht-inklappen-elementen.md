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

## Ronde 2 (basis e135bac): compacter op de telefoon

Zelfde regel: niets verdwijnt, het mag verhuizen of achter een klik, wat afwijkt blijft open. Alle
wijzigingen zitten in onderdelen die alleen de nieuwe weergave rendert, of achter een prop die alleen
de nieuwe weergave meegeeft (`compact`, `samenvatten`). Getoetst in `lib/__overzicht_hoogte_ronde2_test.ts`;
met de schakelaar uit byte voor byte gelijk aan e135bac voor PacingMonitorView (op schema en sterk
achter, gewoon en stapelSmal), ChannelPacing (gewoon en stapelSmal) en CollapsiblePanel (open en
dicht), met dezelfde fixtures in beide bomen gerenderd.

| Blok | Element | Voor (390 px) | Na (390 px) | Klik of open |
|---|---|---|---|---|
| Bovenkant | kerncijfertegels | opvulling 12 px boven en onder | 10 / 8 px onder sm; getal, verloopje, delta ongewijzigd (Kerncijfer zelf niet geraakt: gedeeld) | open |
| Bovenkant | kanaalkaarten | veegstrook | ongewijzigd (was al een snap-strook) | open |
| Bijdrage per kanaal | per kanaal | kaartje met rand, twee balken onder elkaar, label "van de kosten" | rij in een lijst met een lijn eronder; de twee balken NAAST elkaar met kort label "kosten" / "conversies" (het volle label staat vanaf sm, beide in de DOM); kenmerk, CPA en CPA-verandering ongewijzigd | open |
| Na de klik (Alle kanalen) | per stap per kanaal aantal + verandering | kaartje per stap, per kanaal logo + naam + getal | onder sm een tabel: rij per stap, kolom per kanaal (logo in de kop; de legenda eronder zet elk logo naast de kanaalnaam, "G Google Ads · M Meta"), getal met de verandering eronder; "geen" waar een kanaal de stap niet meet; "per maand geteld" als * bij de kop met de legenda. Vanaf sm de kaartjes zoals voorheen. Merkteken `data-nadeklikstap` alleen op de kaartjes, de tabel heeft `data-nadeklikstap-telefoon`, zodat een telling elke stap één keer ziet | open |
| Na de klik (Alle kanalen) | noten, "Waarom niet opgeteld?", tabel voor een schermlezer | | ongewijzigd | open / klik |
| Trechter per kanaal | per stap aantal + "aantal ±%" | getal, daaronder de verandering, daaronder de kosten, balk van 24 px | onder sm: label, getal en verandering op één regel, balk van 8 px eronder | open |
| Trechter per kanaal | kosten per stap (per 1.000 vertoningen, per klik, per conversie) met hun verandering | bij elk getal | onder sm achter "Toon de kosten per stap" (in de DOM); OPEN als een stap minstens 15% duurder werd (`KOSTEN_STIJGING_AFWIJKEND_VANAF` = `CPA_MOVE_MATERIAL` uit lib/analysis/kpi-relations.ts, de grens die de analyses al voor een materiele CPA-beweging gebruiken; getoetst op de grens en 0,01 eronder), en OPEN als de kosten van een stap nu niet te berekenen zijn terwijl dat in de vergelijkingsperiode wel kon (`kosten.vorig`); vanaf sm bij elk getal zoals voorheen | klik (in DOM) / open bij afwijking |
| Trechter per kanaal | CTR en conversieratio (doorstroom) | eigen regel | eigen regel, strakkere regelhoogte | open |
| Na de klik (kanaal) | per stap aantal + verandering | verandering altijd op een eigen regel | naast het getal | open |
| Na de klik (kanaal) | opmerkingen (pas vanaf, per maand) | open | open: voorbehoud bij een getal | open |
| Na de klik (kanaal) | "Niet in de keten" met reden per stap | open | achter "Welke stappen niet in de keten staan (N)"; OPEN als de keten leeg is (dan is dat het verhaal), en OPEN met data-afwijkend als een stap die nu ontbreekt in de vergelijkingsperiode wel een waarde had (`wegAfwijkend`; bij die stap "In de vergelijkingsperiode nog 45: controleer of deze meting nog loopt") | klik (in DOM) / open bij afwijking |
| Gezondheid (Google, Meta, LinkedIn, Microsoft) | pacingringen (PacingMonitor, ChannelPacing) samengevat | ring van 88 px BOVEN de tekst | ring van 60 px NAAST de tekst (RINGCEL.samengevat); percentage, x / doel en oordeel ongewijzigd | open |
| Detail op aanvraag | koppen van de panelen | titel, ondertitel en vensterlabel op één rij die niet afbreekt: op 390 elk een smalle kolom | `compact`: titel met ondertitel over de volle breedte, vensterlabel eronder, pijl rechts; knop met aria-expanded, 44 px, focusring | klik (zoals voorheen) |

### Herstelronde na de review van ronde 2

- **Hoog: een stap die wegviel stond dicht.** Aankoop telde in de vergelijkingsperiode 45 en heeft nu
  "geen data in deze periode": de keten werd korter en de reden stond achter een gesloten knop. Nu
  berekent `ketenNaDeKlik` welke weggevallen stappen toen wel een waarde hadden (`wegAfwijkend`,
  gelezen uit de vergelijkingsperiode zoals die binnenkwam, ook als de verandering zelf niet eerlijk
  te tonen is), en dan staat de lijst open met `data-afwijkend="ja"` en de waarde van toen bij de stap.
  Getoetst: toen 45 en nu null geeft aria-expanded=true en data-afwijkend; toen ook null, of zonder
  vergelijkingsperiode, blijft dicht.
- **Overwogen en niet gedaan:** "geen data in deze periode" bij een stap met een gekozen bron ZONDER
  vergelijkingsperiode als afwijkend tellen. Zonder vergelijking is niet te zien of de meting stopte of
  nooit liep (een net ingestelde stap); dan zou de lijst bij elke nieuwe instelling openstaan. De
  reden staat letterlijk in de lijst achter de knop met het aantal; zodra er een vergelijkingsperiode
  met data is, telt hij wel.
- **Laag: de kostengrens.** 20% was een losse drempel; het is nu `CPA_MOVE_MATERIAL` (15%) uit de
  analyses, en "nu niet te berekenen, toen wel" telt ook als afwijkend.
- **Laag: dubbel merkteken.** `data-nadeklikstap` stond per stap twee keer in de DOM (telefoontabel en
  kaartje); de tabel heeft nu `data-nadeklikstap-telefoon`. Geen script las het merkteken (gezocht in
  scripts/, lib/ en components/).
- **Laag: legenda.** De kolomkoppen tonen alleen het logo; de legenda zet nu elk logo naast de naam.
- **Info: hoogtes.** Nog steeds geschat en niet gemeten: in deze ronde mocht er geen build en geen
  server draaien. Het openstaan bij een afwijking voegt alleen hoogte toe als er iets afwijkt (een
  regel per weggevallen stap, of de drie kostenregels, ongeveer 40 tot 60 px).

### Geschatte hoogte na ronde 2 (390 px, NIET gemeten)

Geschat uit de klassen, niet in een browser gemeten: er draaide in deze ronde geen server en geen
build. De eerstvolgende run van `scripts/meet-overzicht.mjs` hoort deze tabel te vervangen.

| Blok | Na ronde 1 | Schatting na ronde 2 |
|---|---|---|
| Alle kanalen: bovenkant (tegels + kaarten) | tot y=1.201 | ongeveer 1.180 |
| Alle kanalen: Bijdrage per kanaal | 675 | 450 tot 500 |
| Alle kanalen: Na de klik | 650 | 380 tot 430 |
| Alle kanalen: Gezondheid en pacing | 1.281 | ongewijzigd (geen pacingringen op dit tabblad) |
| Alle kanalen: Wat er gebeurde, Conversies per maand, Waar komt het vandaan, beurs, Wat nu | 437 / 433 / 747 / 396 / 301 | ongewijzigd |
| **Alle kanalen totaal** | 6.865 | **ongeveer 6.350 tot 6.450** (doel 5.300 niet gehaald) |
| Google: Trechter Google Ads (met Na de klik) | 773 | 600 tot 650 |
| Google: Gezondheid en pacing | 1.691 | ongeveer 1.600 |
| Google: Detail op aanvraag (3 panelen) | 465 | 320 tot 360 |
| **Google totaal** | 6.835 | **ongeveer 6.400 tot 6.500** |
| Meta: Trechter Meta (met Na de klik) | 815 | 600 tot 650 |
| Meta: Gezondheid en pacing | 1.376 | ongeveer 1.300 |
| Meta: Detail op aanvraag (4 panelen) | 629 | 430 tot 480 |
| **Meta totaal** | 7.027 | **ongeveer 6.550 tot 6.650** |
| 1440 px | Alle kanalen 3.792, Google 4.361 | vrijwel ongewijzigd: bijna alles in deze ronde geldt onder sm |

Niet gedaan in deze ronde, en waarom: de kanaalkaarten (al een snap-strook), Kerncijfer zelf
(gedeeld met andere pagina's), Waar komt het vandaan, Conversies per maand, Wat er gebeurde,
Gezondheid op Alle kanalen en de 1440-breedte. Daar zit het verschil met het doel.
