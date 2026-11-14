<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Poorten draaien

Gebruik `scripts/gates.sh` en niet los `npx tsc` / `node scripts/run-tests.mjs` / `npm run build`.

Waarom dat uitmaakt, ook al doet het script hetzelfde:

- **Elke stap staat onder `timeout`.** Een run die blijft hangen kost geen rekentijd die iemand
  mist, maar houdt de sessie open, en elke afronding wekt de assistent met de volledige
  gespreksgeschiedenis erbij. Dat is waar het geld in gaat zitten, niet in CPU.
- **Er kan er maar een tegelijk draaien** (`flock`). Twee gelijktijdige builds schrijven in
  dezelfde `.next` en laten elkaar half af achter; dat heeft eerder een sessie gekost aan het
  najagen van een ontbrekende `required-server-files.json` die niets met de code te maken had.

Draai hem in de achtergrond en wacht op de afronding — nooit twee runs naast elkaar, en nooit
een wachttaak die zelf weer een volgende run start.

## Roep `npx` niet aan in een lus

De testsuite duurde ruim zeven minuten en dat was vrijwel volledig opstarttijd. Gemeten:

| | |
|---|---|
| `npx tsx` op een **leeg** bestand | 2264 ms |
| het tsx-binary rechtstreeks | 409 ms |
| een echt testbestand | 573 ms |

Het rekenwerk van een test is dus ongeveer 11 ms; de rest is `npx` dat bij elke aanroep opnieuw
uitzoekt waar het pakket staat. Bij 201 bestanden is dat ruim zes minuten die nergens heen gaan.
`scripts/run-tests.mjs` zoekt het binary daarom één keer op en draait vier processen naast
elkaar: **32 seconden** in plaats van 460.

Dezelfde regel geldt overal: `npx <iets>` in een lus is bijna altijd een fout.

## Bouw nooit onder een draaiende server

`npx next build` schrijft in `.next` terwijl `next start` daaruit serveert. De draaiende server
houdt het oude manifest vast en gaat 500's geven op chunks die niet meer bestaan — wat er
uitziet als een kapotte app terwijl er niets mis is. Stop de server eerst, op **PID**: `pkill -f`
matcht zijn eigen commandoregel en sloopt zijn eigen shell (exitcode 144).

En stop het **juiste** PID. `npx next start &` geeft het PID van de npx-wrapper; die spawnt een
kindproces `next-server` dat de poort vasthoudt. Een `kill` op de wrapper laat dat kind gewoon
doorlopen, en `pgrep -f "next start"` ziet het niet, want zijn commandoregel is `next-server (v16…)`.
Zo stond er na een nieuwe build een oude server op 3190 die 500's gaf op elke chunk, terwijl de
nieuwe server met EADDRINUSE was gestopt. Controleer na het starten met `pgrep -f next-server` en
bewaar dát PID.

## De hygienepoort

`scripts/gates.sh` begint met `check-hygiene.mjs`, en die vangt drie dingen die tsc, de tests
en de build per definitie niet zien:

1. **Een tweede definitie van een gedeeld hulpje.** `median` stond acht keer in de codebase, in
   drie smaken; `safeDiv` vijf keer, in drie gedragingen. Dat is geen stijlkwestie — het
   samenvoegen bracht twee echte fouten aan het licht. De MAD in `forecast.ts` was twee keer te
   groot omdat de lokale mediaan de nul-afwijkingen wegfilterde, waardoor uitschieters niet
   werden gerepareerd. En vier van de vijf `safeDiv`-varianten gaven `0` terug bij een oneindige
   noemer, wat als een gemeten nul leest.

2. **Modules die door niets worden geimporteerd.** Er lagen er elf. De uitzonderingen staan in
   `TOEGESTANE_WEZEN` met een reden per stuk; die lijst hoort te krimpen. Groeit hij, dan is er
   iets gebouwd dat nergens op aangesloten is, en dat is het moment om te beslissen of het af
   moet of weg.

3. **Stuurtekens in de bron.** Een letterlijke NUL-byte in `asset-breakdown.ts` maakte dat
   bestand binair voor elk tekstgereedschap. `grep` sloeg het stilzwijgend over — inclusief de
   zoekopdracht waarmee ik de median-kopieen inventariseerde. De achtste vond ik pas toen deze
   controle er was.

De poort draait in een seconde. Voeg je bewust een uitzondering toe, zet er dan de reden bij:
een uitzondering zonder reden is over drie maanden niet meer van een vergissing te
onderscheiden.

## De kaartoverloop-controle (niet in de poorten)

`scripts/check-kaartoverloop.mjs` zoekt tekst die BUITEN zijn eigen kaartrand rendert. Hij staat
bewust niet in `scripts/gates.sh`: hij heeft een draaiende server en een browser nodig, en de
poorten moeten snel blijven. Draai hem na opmaakwerk aan kaarten en rasters:

```
npx next build && npx next start -p 3190     # eerst bouwen, zonder draaiende server
node scripts/check-kaartoverloop.mjs
```

**Waarom hij er is.** Op Doelen & voortgang stonden "Doel: 1.650" en "Prognose: 1.246 (-24%)"
tweeentwintig pixels onder de onderrand van hun kaart, op de pagina-achtergrond. Op alle vijf de
kaarten. Tsc zag het niet, de tests niet, de build niet: `overflow` staat op `visible`, dus het
rendert gewoon en het leest als een ontwerpkeuze.

**De onderliggende val.** Een kind met `h-full` in een RASTERCEL. Rastercellen rekken naar de
hoogste van hun rij, dus krijgt de kaart een definitieve hoogte, lost `h-full` op naar die volle
hoogte, en wordt alles wat ná dat kind komt eruit geduwd. `Kerncijfer` rendert zo'n
`flex h-full flex-col` — met goede reden, hij moet een cel kunnen vullen als hij er los in staat.
Zet je er iets ná Kerncijfer in een kaart, wikkel hem dan in een `<div>` met automatische hoogte.

**De zelftest hoort erbij.** Aan het eind zet het script de bug in de browser terug en eist dat
de detector hem vindt. Vindt hij hem niet, dan faalt het script — want dan zei "OK" hierboven
niets. Dat is geen extraatje: deze codebase heeft eerder een controle gehad die iets anders
verifieerde dan hij beweerde, en die stond er maanden groen bij.

## Overgeslagen is niet groen

De vier databasepoorten (rpc-rechten, view-dekking, bureaugrens, rls-scheiding) eindigden zonder
sleutels met exitcode 0, en dan stond er "POORTEN GROEN" terwijl de scheiding tussen bureaus niet
getoetst was. Nu eindigt een poort die niet draait met **exitcode 3** (`scripts/poort-overslaan.mjs`),
noemt `scripts/gates.sh` hem bij naam in de slotregel, en eindigt de run dan zelf ook met 3:
"POORTEN NIET GROEN: 6 gedraaid zonder fout, 5 niet gedraaid: ...". Groen betekent: alles gedraaid
en alles geslaagd.

De poorten in groepen, zodat je weet wat je wel en niet gedraaid hebt:

```
scripts/gates.sh code       hygiene, datagrond, tsc, tests, demo-scenario's, build: geen database, geen server
scripts/gates.sh database   rpc, views, grens, rls, analyses: sleutels nodig
scripts/gates.sh browser    rookproef en cijfercontrole: een draaiende server nodig
scripts/gates.sh            alles = code + database; zonder sleutels dus NIET groen, en dat klopt
```

`alles` bevat de browser NIET. Bouwen mag niet onder een draaiende server en de browserpoorten hebben
er juist een nodig; toen beide in `alles` zaten, sloten ze elkaar uit en eindigde het standaardcommando
altijd op 3, ook met sleutels en een server. Een poort die altijd op 3 staat, leert je 3 te negeren.

De volledige ronde is twee runs: `scripts/gates.sh` zonder server (code en database, inclusief de
build), dan de server starten, dan `scripts/gates.sh browser`. Pas als beide groen zijn, is alles
gedraaid. De build slaat hardop over als er op `BASIS_URL` een server antwoordt.

Wie een poort toevoegt die soms niet kan draaien: gebruik `slaOver(naam, reden)` en nooit
`process.exit(0)`. Moet er opgeruimd worden (proefgebruikers), gooi dan `Overslaan` binnen de `try`
en roep `slaOver` pas na de `finally` aan: `process.exit` slaat de `finally` over, en zo bleef bij een
mislukte login een proefgebruiker met een echte rol in de database staan.

## De browser-rookproef

`scripts/rookproef.mjs` opent op 390 px elke hoofdpagina van de demo-klant: Vandaag, Portfolio,
Klanten, en per klant elk tabblad in de vertrouwde en de nieuwe weergave en elk kanaal. Hij faalt op
een pageerror, een consolefout, een antwoord van 500 of hoger, de foutpagina van Next of een melding
van een van onze error-grenzen (`data-foutgrens`), een pagina zonder een enkel kerncijfer waar er een
hoort, zijwaartse scroll, en een tabbladknop die niet te vinden is.

**Wanneer:** na elke wijziging aan een pagina, een tabblad, een datahook of de opmaak, en altijd voor
een merge. tsc, de tests en de build zien geen van deze fouten: een renderfout in een onderdeel haalde
de hele klantpagina onderuit terwijl alles groen stond.

```
npx next build && npx next start -p 3190      # eerst bouwen, zonder draaiende server
node scripts/rookproef.mjs                     # of scripts/gates.sh browser
node scripts/rookproef.mjs --zelftest          # alleen de zelftest, geen server nodig
ALLEEN="nieuw kanaal" node scripts/rookproef.mjs   # alleen pagina's waarvan de naam dit bevat
```

De zelftest serveert een reeks bewust kapotte pagina's via `page.route` op een nep-adres en eist dat
elk om de juiste reden wordt afgekeurd, en dat een gezonde pagina wordt goedgekeurd. Faalt de
zelftest, dan faalt het script.

Welke pagina's een kerncijfer moeten tonen staat in `schermen()` in het script. Die lijst is gemaakt
uit de code en nog niet tegen een draaiende server gelegd; de eerste echte run kan dus een pagina
afkeuren die terecht geen groot getal toont. Pas dan de lijst aan, met een reden erbij, en niet de
detector.

## De error-grenzen

`app/(app)/foutgrens.tsx` heeft de melding en `OnderdeelGrens` (Next's `unstable_catchError`). Er zijn
drie lagen: om de inhoud van een klanttabblad (kop, navigatie en andere tabbladen blijven werken),
`error.tsx` per routegroep (de zijbalk blijft), en `app/global-error.tsx` voor een kapotte
root-layout. De melding zegt wat er misging, waar, de foutcode voor de serverlogs, en heeft een knop
om opnieuw te proberen. Een nieuw zelfstandig onderdeel dat eigen data ophaalt, kan in een eigen
`<OnderdeelGrens onderdeel="...">`.

## De cijfercontrole

`scripts/check-cijfers-gelijk.mjs` leest dezelfde cijfers op meerdere pagina's af, allemaal op
`?periode=last_12m`: Overzicht oud tegen nieuw, de kanaalkaarten opgeteld tegen de totaaltegel,
Overzicht tegen Campagnes, Prognose tegen Doelen (het jaardoel), Portfolio tegen het Overzicht.
Elk verschil groter dan de afronding van de minst precieze weergave is een fout, met beide plekken
erbij. Een cijfer dat op een van de twee plekken niet af te lezen is, is NIET GEMETEN (exit 3).
Draai hem na elke wijziging aan een totaal, een venster of een conversieselectie. Ook met
`--zelftest`.

De rij van de klant op Portfolio wordt gekozen op de link naar `/client/<id>`, niet op de tekst: het
scorebord toont de naam, het id staat alleen in de href. Wat niet als tegel staat, leest hij op een
merkteken dat de pagina zelf zet: `data-cijfer="jaardoel"` met `data-kpi` en `data-reeks` (Prognose en
Doelen; alleen dezelfde reeks wordt vergeleken), en
`data-cijfer="kanaaltotaal-conversies"`/`"kanaaltotaal-kosten"` op de totaalrij van de kanaaltotalen
(Campagnes, alleen in de nieuwe weergave: de campagnetabellen eronder hebben een vast venster en
tellen niet mee). Haal zo'n merkteken niet weg; `lib/__cijfer_merktekens_test.ts` bewaakt ze. Alles
staat in de zelftest met een nep-pagina die goed-, af- of niet-gemeten wordt.

## De evaluatieset van de analyses

`lib/eval/demo-scenarios.ts` legt per demoscenario (S1 tot S20 uit de kop van
`scripts/demo/seed-demo-client.ts`, plus het stille scenario) vast welke bevinding een analyse hoort
te geven en waar hij moet zwijgen (GRA op koers, Inkoop onder de volumegrens, "kas kopen
tweedehands" te vroeg, de gezonde brandcampagne). `scripts/score-evaluatieset.mjs` scoort een
uitvoer daartegen: gevonden, gemist, vals, per scenario.

```
node scripts/score-evaluatieset.mjs --bestand analyse.md     # opgeslagen uitvoer, geen model
node scripts/score-evaluatieset.mjs --uit-db                 # laatste analyses van de demo (alleen lezen)
node scripts/score-evaluatieset.mjs --vers --bevestig-kosten # VERSE run: kost geld, alleen localhost
```

Draai hem na elke wijziging aan een prompt, een poort of de modelroutering, en vergelijk met de
vorige uitslag.

De mag-niet's toetsen op actie of de SLECHTE richting (kosten omhoog, opbrengst omlaag), niet op
"stijgt" of "daalt" los: een eerdere versie rekende "GRA stijgt +10% in conversies", precies de
ontworpen uitkomst, als vals af. Een lat die juiste uitvoer afrekent, stuurt prompts de verkeerde
kant op. Elke tegenvoorbeeldzin staat in `lib/eval/__demo_scenarios_test.ts`; voeg er een toe als
je een nieuwe vindt. Een verse run legt zijn prompts vast in `eval_fixtures`; `/api/eval/replay` speelt
ze af tegen een ander model en zet voor een fixture-set van demo-greentech de scenarioscore in de
scorekaart.

## Slagingspercentage van de analyses

`scripts/check-analyse-slagingen.mjs` (ook `scripts/gates.sh analyses`) leest uit `generation_jobs`
per cadans hoeveel runs afrondden, mislukten of vastliepen (running zonder update na
`STALE_RUNNING_MINUTES`), en faalt onder de grens (standaard 80%, `--grens`). Alleen lezen. Een
vastgelopen run telt als mislukt: hij leverde niets op en zei dat niet.

Hij faalt ook als er in het venster **niets** gestart is (dan noemt hij per cadans de datum van de
laatste afgeronde run), en als een vaste cadans langer dan zijn termijn niet afrondde
(`MAX_DAGEN_ZONDER_AFRONDING` in `lib/eval/analyse-slagingen.ts`). Een keten die stilvalt, levert geen
mislukkingen op maar stilte; een lege tabel mag niet als in orde lezen.

## CI

`.github/workflows/pr-poorten.yml` draait op elke pull request hygiene, datagrond, tsc, de tests en de
detectorcontrole van de demo (`seed-demo-client.ts --check`).
Niet de build (geheimen), niet de databasepoorten (echte database), niet de browserpoorten (server)
en nog niet lint; dat staat in de samenvatting van elke run, zodat groen daar niet gelezen wordt als
"alle poorten groen".
