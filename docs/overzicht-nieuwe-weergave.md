# De nieuwe weergave van het Overzicht: uitrol

Stand: 12 november 2026, op de werkbranch. Hoort bij fase 6 van het bouwplan "een Overzicht dat niet statisch overkomt". Dit document zegt wat de schakelaar doet, waar elk blok gebleven is, wat er moet gebeuren voor de schakelaar standaard aan kan, en hoe je terugdraait.

De schakelaar staat standaard **uit**. Dat verandert niet zonder een besluit van de eigenaar (zie "Voor de schakelaar standaard aan kan").

## Wat de schakelaar doet

Rechtsboven op een klantpagina staat "Nieuwe weergave". Het is een keuze per kijker, niet per klant.

- **Uit**: het Overzicht toont wat het toonde, in dezelfde opmaak. Geen blok is verplaatst of ingekort. Wat er met de schakelaar uit toch anders is dan voor dit werk, staat onder "Wat er ook met de schakelaar uit draait".
- **Aan**: de merkregel met de periodekiezer, de kanaalkaarten als filter, de kerncijfers als tegels, de hoofdgrafiek met het logboek "Wat er gebeurde" ernaast, en daaronder de herschikte opbouw per tabblad. De knop "Zoeken" en de datum van vandaag verdwijnen uit de bovenbalk van een klantpagina (zoeken blijft via de zijbalk en Ctrl/Cmd+K).

Waar de keuze woont: in `localStorage` (`overzicht-weergave`), met een kopie in een cookie van dezelfde naam zodat de server meteen de juiste kop stuurt. `?weergave=nieuw` of `?weergave=oud` in het adres gaat voor zolang het er staat en overschrijft de bewaarde keuze niet; de meting en een gedeelde link gebruiken dat. De regels staan in `lib/weergave.ts`.

Geen inzicht is weg. Wat niet meer open staat, staat op een andere plek of achter een klik. De tabel hieronder is de checklist.

### Wat er ook met de schakelaar uit draait

De nieuwe weergave zit achter `nieuweWeergave` in het klantdashboard, de prop `nieuw` van de tabbladen en de context `SectieKopBijeen` voor de koppen. Een paar dingen draaien voor iedereen, omdat ze vóór React of buiten het dashboard werken. Ze veranderen niets aan wat je met de schakelaar uit ziet:

- Het script in de `<head>` (`lib/weergave-init.ts`) draait op elke pagina. Het zet alleen iets op een klantpagina voor wie de nieuwe weergave koos.
- De regel CSS bij `[data-chrome-oud]` in `app/globals.css` verbergt de knop "Zoeken" en de datum alleen als dat kenmerk op `<html>` staat.
- Een paar onzichtbare kenmerken voor de meting staan in beide weergaven in de HTML: `data-venster="stand"` op de bronrij, de to-do's en de notities, `data-paneel` op een uitklapblok.
- Een uitklapblok dat dicht is verwijst niet meer met `aria-controls` naar een paneel dat er niet staat. Dat is een reparatie voor schermlezers, in beide weergaven.
- De cookie `overzicht-weergave` wordt gezet zodra iemand de schakelaar aanraakt, en de serverpagina leest hem.

De cookie `kanaalbalk` hoort hier **niet** bij: alleen de nieuwe weergave schrijft en leest hem. De vertrouwde weergave onthoudt in `localStorage` of een klant een kanaalbalk had, zoals ze deed.

## Wat verhuisde, per tabblad

### Boven de tabbladen (elk tabblad)

| Was | Is nu |
|---|---|
| Merkbanner van 94 px | Merkregel met logo, naam en beursaftelling op één regel |
| Kanaaltabs | Kanaalkaarten: per kanaal de conversies, de kosten, hun aandeel, de health en de datastand. Een klik filtert de pagina; nog een klik op dezelfde kaart is terug, en de gekozen kaart zegt dat zichtbaar ("× alle kanalen" naast de naam) |
| KPI-band | Vijf tegels met delta, "was" en een reeks per maand; de periode en de vergelijking in de voetregel |
| (bestond niet) | Hoofdgrafiek: conversies of kosten per maand, per kanaal gestapeld, met de CPA als lijn |
| (bestond niet) | Logboek "Wat er gebeurde": meldingen, syncs, analyses, voorstellen, hypothesen, notities van de laatste 30 dagen |
| Bronrij boven de cijfers | Bronrij onder de bovenkant, met de datastand erbij ("data t/m ...", rood als de data stilstaat) |
| Knop "Zoeken" en de datum in de bovenbalk | Weg op een klantpagina; zoeken via de zijbalk of de sneltoets |

### Alle kanalen

| Was | Is nu |
|---|---|
| Account Health per kanaal, met radar en factoren open | De rangschikking open; radar, factoren en toelichting achter "Toon onderbouwing" |
| Pacing (ringen, tempo, "op dit tempo") | In "Pacing & jaaroverzicht": de kolom "tegen vorig jaar", het gemiddelde per maand in de voetregel, de twee bedragen en "recht doorgetrokken" in de lade "Verloop en prognose" |
| Jaaroverzicht: vier kaarten | De rijen van de tabel in "Pacing & jaaroverzicht" (gerealiseerd, jaardoel, prognose, vs doel, voortgang) |
| Grafiek "Performance" (week, maand, vorig jaar) | In de lade "Verloop en prognose" |
| Budgetadvies in de grafiek | Open in de kaart "Pacing & jaaroverzicht", boven de tabel |
| "Spend per kanaal per maand" (staven) | De stand "Kosten" van de hoofdgrafiek bovenaan |
| Ring per kanaal | Blijft, open, volgt de periode |
| Kanaaltabel met voorbehouden en de maanden per kanaal | Achter "Toon als tabel"; staat open op Campagnes > Alle kanalen |
| Wereldkaart met de ranglijst eronder | De ranglijst naast de kaart, de eerste zes landen; de rest achter "Toon N landen meer" |
| Zes tegels "per land" | De totaalrij van "Toon als tabel" in de voet van de wereldkaart; het aantal landen in de kop |
| Tabel per land | "Toon als tabel" in de voet van de wereldkaart |
| De regel over Microsoft | "zonder Microsoft" in het vensterlabel van de wereldkaart; de hele zin in de uitleg van dat label, boven de tabel in de lade, en open in de kaart als er geen lade is (één land, of geen rijen voor de gekozen metriek) |
| Beurs: strook, weekvenster en drie weekkaarten | Strook en weekvenster blijven; de drie weekkaarten zijn één regel "Deze week" |

### Google Ads

| Was | Is nu |
|---|---|
| Kopkaart van het tabblad | Onderaan achter "Over dit tabblad" |
| Account Health, Pacing (ringen), landfilter | Blijven, open |
| Maand- of beursweergave met de keuzeknop | Blijft, open |
| Vier jaarkaarten en de grafiek | "Pacing & jaaroverzicht" met de lade "Verloop en prognose"; de grafiek opent per week, zoals hij deed |
| Ranglijst, landentegels, tabel per land, land x kanaal | Zoals op Alle kanalen: naast de kaart, in de totaalrij, achter "Toon als tabel"; land x kanaal blijft achter zijn knop |
| Ring per campagnetype | Blijft, open |
| CPA-lijn en conversiestaven als losse grafieken | Achter "CPA en conversies per maand" |
| Video en placements | Achter "Waar het budget landt" |
| Beursmodus (een gekozen beurs) | Ongewijzigd in beide weergaven |

### Meta, LinkedIn, Microsoft

| Was | Is nu |
|---|---|
| Kopkaart van het tabblad | Onderaan achter "Over dit tabblad". Een probleem met de koppeling staat open bovenaan, ook als de status zelf niet te lezen was; de koppelstatus staat in de kop van het dichte paneel (Meta) |
| Account Health, pacing tegen vorige maand | Blijven, open |
| Vier jaarkaarten en "Prognose per maand" | "Pacing & jaaroverzicht" met de lade "Verloop en prognose" |
| Landentegels, ranglijst, tabel per land | Zoals op Alle kanalen (Microsoft heeft geen landcijfers) |
| Verdelingsringen (levering, doelgroep) | Blijven, open |
| Maandverloop als eigen grafiek | Achter "Maandverloop als eigen grafiek" |
| Maandprestaties (28 dagen, en de maanden als tabel) | Achter "Maandprestaties" |
| Video | Achter "Waar het budget landt" |

## Wat je moet weten voor je de cijfers vergelijkt

**De hoofdgrafiek en de kanaaltabel lezen Google uit een andere bron.** De tegels, de kanaalkaarten en de hoofdgrafiek lezen Google live bij Google. De ring en de kanaaltabel op "Alle kanalen" lezen de gesynchroniseerde database. Loopt de Google-sync achter, dan tonen die twee voor dezelfde maand andere kosten. Dat staat er dan: in de kaart "Kanaaltotalen en maanden per kanaal" verschijnt een regel met de maanden waarin het uiteenloopt en beide totalen. Lopen ze gelijk, dan staat er niets. De oplossing zit in de sync, niet in het scherm.

**Het budgetadvies staat nu op elk tabblad open**, ook op Meta, LinkedIn en Microsoft, waar het eerder niet stond. Het rekent op het conversiedoel van het kanaal, en dat is vaak een schatting (vorig jaar plus tien procent). De zin zegt dat erbij. Of je het advies per kanaal wilt zien is een keuze voor de eigenaar; zie de open punten.

**De kanaaltabbladen hebben een weekweergave en "Vorig jaar" in de lade** die ze eerder niet hadden. Ze openen per maand.

## Voor de schakelaar standaard aan kan

In deze volgorde. Niets hiervan doet de code zelf.

1. **`O1_AUTH_ENFORCED=true` op elke omgeving die van buiten bereikbaar is.** De route van het logboek (`/api/overzicht/logboek`) toetst het klant-id zelf, maar alleen als deze vlag aan staat. Staat hij uit, dan leest de route met de service-rol het logboek van elke klant, zonder sessie. Dat is dezelfde stand als de andere leesroutes, maar het logboek bevat vrije tekst: notities, redenen van een Code Rood, foutmeldingen van syncs. Zet de vlag aan voordat de schakelaar breed aangaat.
2. **Migratie 107 (`107_microsoft_sync_administratie.sql`) en 073 (`073_code_rood_meldingen.sql`) toegepast.** Zonder 107 ontbreekt `microsoft_sync_runs`; het logboek zegt dan "niet volledig te lezen: de syncs (Microsoft Ads)" in plaats van om te vallen. Zonder 073 zegt het "niet te lezen: de meldingen". Het werkt, maar het is geen stand om mee uit te rollen.
3. **Controleer `client_notes` één keer tegen het schema.** Het logboek leest `id, title, content, created_at, is_todo, done`. Voor deze tabel staat geen `create table` in `scripts/`; de kolommen zijn alleen via de code bevestigd. Draai `select column_name from information_schema.columns where table_name = 'client_notes'`. Wijkt er iets af, dan valt alleen de bron "notities" weg, niet het logboek.
4. **Migratie 109 (`109_klant_bezoeken.sql`) is niet nodig.** Hij is klaargezet en op niets aangesloten: "sinds je vorige bezoek" woont in de browser. Toepassen verandert niets aan wat iemand ziet. Pas hem toe als het ijkpunt over apparaten heen moet gelden, en sluit hem dan eerst aan.
5. **De Google-sync loopt weer en de generatiejobs draaien dagelijks.** Zonder nieuwe data toont het logboek niets nieuws en loopt de grafiek uiteen met de tabel (zie hierboven). Dit is het grootste risico van de uitrol en het zit niet in de code: `CRON_SECRET` op Vercel, tegoed bij de modelaanbieder, en de Google-credentials.
6. **De demo leeft.** `scripts/demo/herseed-demo.mjs --uitvoeren` zet de demodata op de lopende maand. Zonder herseed stopt de demo op de dag van de laatste seed; het logboek toont dan alleen zijn voorbeelden (per regel gemerkt als "voorbeeld").
7. **De meting herhaald, en het oordeel gelezen.** Zie hieronder.
8. **De proef met twee mensen** (zes taken, tijd en fouten, oud tegen nieuw). Dat is fase 6 van het bouwplan en kan niet in code.

Daarna: twee weken als keuze, dan de standaard om, en de oude weergave nog een maand bereikbaar via de schakelaar. De standaard staat op één plek: `STANDAARD_WEERGAVE` in `lib/weergave.ts`. De pagina (`kiesWeergave`) en het script in de `<head>` (`lib/weergave-init.ts`) lezen allebei die constante; je hoeft het script niet apart aan te passen. `useNieuweChrome` in `lib/use-weergave.ts` begint op `"oud"` als beginwaarde vóór het lezen; dat is geen standaard en blijft staan.

## Meten en oordelen

```
npx next build && npx next start -p 3190        # nooit bouwen onder een draaiende server
FASE=6-oud node scripts/meet-overzicht.mjs
FASE=6-nieuw WEERGAVE=nieuw node scripts/meet-overzicht.mjs
node scripts/oordeel-overzicht.mjs scripts/metingen/<datum>-6-oud.json scripts/metingen/<datum>-6-nieuw.json
node scripts/check-kaartoverloop.mjs
```

`scripts/oordeel-overzicht.mjs` legt een meting naast de normen van het bouwplan en zegt per norm "gehaald", "niet gehaald", "meting mislukt" of "niet gemeten". Met twee bestanden toont het ook welke normen van uitkomst veranderden. De normen staan in `scripts/overzicht-normen.mjs`.

- **Meting mislukt** is een wissel of herlaad die in de meting fout ging. Dat telt voor de afsluitcode als niet gehaald: een periodewissel die helemaal niet werkt geeft geen schoon oordeel. Een kanaal dat de klant niet heeft is geen fout; het meetscript slaat het over en noemt het.
- **De zelftest** draait bij elke aanroep. Per norm zet hij in een verzonnen goede meting één waarde op de grens (moet gehaald zijn) en één stap erover (moet niet gehaald zijn), en eist dat geen andere norm mee omslaat. De drie runs van die meting verschillen, zodat een norm die uit de verkeerde run leest door de mand valt. Als proef zijn 46 fouten in de normen ingebracht (verkeerde run, verschoven grens, hoogste in plaats van laagste wissel, een fout die genegeerd wordt); de zelftest ving ze alle 46.

**Niets van deze ronde is in een browser gemeten.** Er mocht geen build en geen server draaien. De laatste meting is die van 12 november (`2026-11-12-4-5-nieuw.json`), van vóór de wijzigingen: 6 gehaald, 13 niet gehaald, 5 niet gemeten. Niet gehaald onder meer: verspringen op desktop (0,215), de paginahoogte (3184 en 5814 px), de plek van het eerste kerncijfer (356 en 425 px), de tijd tot het eerste cijfer (1,8 s), en "volgt periode" (50 procent). Een deel daarvan is aangepakt; **of het daarmee gehaald is, weet niemand tot de meting opnieuw gedraaid is.** Dat geldt voor het verspringen, de hoogte, de vensters en de opmaak op een telefoon. De tests leggen vast welke klassen en welke structuur er in de HTML staan, niet hoe het eruitziet.

### Wat het meetscript anders telt, en waar dat van het bouwplan afwijkt

- Een blok buiten elke sectie leent geen venster meer van een buurblok. De bronrij, de to-do's en de notities telden daardoor als "volgt periode, maar beweegt niet" terwijl ze dat label nooit droegen. Ze zeggen nu zelf dat ze de stand van nu tonen (`data-venster="stand"`). Dit is een rechtzetting.
- Een dichtgeklapt blok telt niet mee in de noemer van een gewone periodewissel: het toont dicht geen cijfer dat kan veranderen. **Dit wijkt af van het bouwplan**, dat "de blokken die 'volgt periode' dragen" zegt en niet "de open blokken". Met de oude telling waren dit precies de blokken die de norm onder de 90 procent hielden (de kanaaltabel, "CPA en conversies per maand", "Maandverloop als eigen grafiek"). Daarom meet het script ze nu apart: aan het eind opent het op elk tabblad de dichte blokken met dat label, wisselt twee keer van periode en legt vast of elk geopend blok verandert. Het oordeel toetst dat als norm A1b (minstens 90 procent, een blok dat niet openging telt als stil). Alleen A1 en A1b samen zijn de norm van het bouwplan. Dat deel van het meetscript is geschreven zonder het te kunnen draaien; reken erop dat het bij de eerste run een correctie nodig kan hebben.

Een blok dat "volgt periode" draagt, open staat en stil blijft, telt nog precies zoals het telde.

### Wat er gemeten moet worden voor de schakelaar breed aangaat

1. Oud en nieuw op de demo, met de opdrachten hierboven, en het oordeel naast elkaar.
2. De nieuwe weergave op een **echte klant met één kanaal** en op een **echte klant met meer kanalen**, bij een eerste bezoek (schone browser) en bij een tweede. Zie "De kanaalrij" hieronder.
3. Een adres met `?kanaal=meta` in een schone browser: verspringt er iets bij het laden?
4. `node scripts/check-kaartoverloop.mjs`, en de vertrouwde en de nieuwe weergave bekijken op 390, 1024 en 1280 px breed: de koppen van de secties, het logboek in de smalle kolom, de gekozen kanaalkaart.

### De kanaalrij: wat er gekozen is en wat dat kost

De rij kanaalkaarten staat er alleen bij een klant met meer dan één kanaal, en dat weet de pagina pas na het laden. Volgens de telling in de code (`components/dashboard/kanaalkaarten.tsx`) hebben 62 van de 71 klanten alleen Google; die telling is in deze ronde niet opnieuw gedaan.

- **Bekend uit een eerder bezoek**: de hoogte wordt vrijgehouden of niet, en klopt. De server weet het uit een cookie per klant (`kanaalbalk`, alleen geldig onder `/client/<id>`, dus hij gaat niet mee met API-verzoeken en er is geen grens aan het aantal klanten).
- **Onbekend (eerste bezoek in deze browser)**: er wordt niets vrijgehouden. Bij een klant met één kanaal verspringt er dan niets. Bij een klant met meer kanalen verschijnt de rij één keer na het laden en schuift de pagina omlaag; daarna weet de cookie het.
- **De demo** is de uitzondering: daar staat vast dat er vier kanalen zijn, dus de rij wordt ook bij een eerste bezoek vrijgehouden. De meting draait op de demo. **Een goede CLS op de demo zegt dus niets over het eerste bezoek aan een echte klant met meer kanalen**; meet die apart (punt 2 hierboven).

Een eerdere opzet hield de rij bij elke onbekende klant vrij. Dat haalde de sprong weg bij de demo en bracht hem naar bijna negen op de tien echte klanten, waar het vlak na het laden wegviel. Die is teruggedraaid.

## Wat er in deze ronde veranderde

- Het logboek noemt een bron die maar deels te lezen was (één runtabel van de vier), stuurt de melding van de database niet meer naar de browser, filtert de jobs in de query zelf en telt de wachtende voorstellen in de database, zonder de rijen met een lege hypothese (die toont het logboek ook niet).
- De kaart van het logboek is bedoeld leesbaar te zijn in de smalle kolom naast de grafiek: twee regels titel, de chip eronder, de titel voluit in het uitgeklapte paneel. Niet in een browser bekeken.
- De rij kanaalkaarten: zie "De kanaalrij" hierboven.
- De weg terug naar alle kanalen staat zichtbaar in de gekozen kaart. Een losse regel onder de rij, uit een eerdere versie, is weg: die schoof de tegels omlaag bij elke filterklik.
- De bovenbalk hoort niet meer te verspringen voor wie de nieuwe weergave koos: een script in de `<head>` zet het kenmerk vóór de eerste verf.
- De kop van een sectie houdt in de nieuwe weergave het icoon en de titel bij elkaar (op een telefoon stond het icoon alleen op een regel). Alleen in de nieuwe weergave: met de schakelaar uit, en op Campagnes en Second Opinion, is de kop letterlijk dezelfde HTML als voorheen.
- De kanaaltabel zegt wanneer hij afwijkt van de hoofdgrafiek.
- De voetregel van de pacing spreekt de kolom "jaardoel" niet meer tegen.
- De ranglijst naast de wereldkaart begint met zes landen.
- Elk uitklapblok op een kanaaltabblad noemt zijn venster.

## Terugdraaien

Van klein naar groot.

1. **Eén kijker**: de schakelaar uitzetten. Of `?weergave=oud` achter het adres.
2. **Iedereen, zonder uitrol**: zolang de standaard "oud" is, ziet niemand de nieuwe weergave die hem niet zelf aanzette. Staat de standaard al om, zet dan in `lib/weergave.ts` de laatste terugval van `kiesWeergave` terug naar `"oud"`. Wie de schakelaar zelf aanzette, houdt de nieuwe weergave tot hij hem uitzet.
3. **De nieuwe weergave onbereikbaar maken**: laat `kiesWeergave` altijd `"oud"` teruggeven. De schakelaar doet dan niets meer; haal hem weg in `components/dashboard/client-dashboard.tsx` (de const `schakelaar`). De nieuwe weergave zelf staat achter `nieuweWeergave`, de prop `nieuw` en de context `SectieKopBijeen` en wordt dan niet meer gerenderd. Wat blijft draaien staat onder "Wat er ook met de schakelaar uit draait": het script in de `<head>` (zet dan nooit meer iets), de regel CSS, en de kenmerken voor de meting.
4. **De code weg**: de commits van fase 2 tot en met 6 op deze branch terugdraaien. De nieuwe bestanden: `lib/weergave.ts`, `lib/weergave-init.ts`, `lib/use-weergave.ts`, alles onder `lib/overzicht/`, `components/dashboard/overzicht-*.tsx`, `components/dashboard/kanaalkaarten.tsx`, `components/dashboard/pacing-jaaroverzicht.tsx`, `components/dashboard/kanaal-overzicht-nieuw.tsx`, `components/dashboard/weergave-schakelaar.tsx`, `app/api/overzicht/`, de scripts `scripts/meet-overzicht.mjs`, `scripts/oordeel-overzicht.mjs` en `scripts/overzicht-normen.mjs` met de metingen in `scripts/metingen/`, en de tests `lib/__overzicht_*_test.ts`. Het script in `app/layout.tsx` en de regel in `app/globals.css` gaan mee terug.

Er valt geen data terug te draaien: de nieuwe weergave schrijft niets naar de database. De cookies `overzicht-weergave` en `kanaalbalk` (één per bezochte klant) en de sleutels in `localStorage` verlopen vanzelf of blijven zonder gevolg staan.

## Open punten voor de eigenaar

- Wil je het budgetadvies op de kanaaltabbladen? Het stond daar niet.
- Mogen de kanaaltabs definitief wijken voor de kaarten? Tot de proef blijven ze in de vertrouwde weergave.
- De paginahoogte op een telefoon ligt ruim boven het doel (5814 tegen 4500 px, gemeten vóór deze ronde). Wat er nog dicht kan zonder iets te verbergen wat je dagelijks leest, is een keuze: de ring per kanaal, de beurssectie of de to-do's en notities.
- Geen van de opmaakwijzigingen van deze ronde is in een browser bekeken, en er is na de wijzigingen niet gemeten. Zie "Wat er gemeten moet worden".
- Bij een eerste bezoek aan een echte klant met meer kanalen verschijnt de kanaalrij na het laden (één keer per browser). Wil je dat ook weg, dan moet de server het aantal kanalen kennen voordat hij de pagina stuurt; dat is een leesactie op de database in de serverpagina en een eigen besluit.
- De telling "62 van de 71 klanten hebben alleen Google" komt uit een opmerking in de code. Tel opnieuw voor je er een besluit op bouwt.
