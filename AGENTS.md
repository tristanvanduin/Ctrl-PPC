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
