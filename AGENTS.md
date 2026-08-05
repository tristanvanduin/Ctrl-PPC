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
