#!/usr/bin/env bash
# De poorten: typecheck, tests, build. Een ingang, met een harde bovengrens per stap.
#
# WAAROM DIT BESTAAT
#
# Een achtergrondtaak die blijft hangen kost geen rekentijd die iemand mist, maar hij houdt
# de sessie wel open en elke afronding wekt de assistent met de volledige gespreksgeschiedenis
# erbij. Dat is de dure kant. Een run die nooit eindigt, of drie runs die elkaar overlappen,
# betalen zich dus in context en niet in CPU.
#
# Daarom: elke stap staat onder `timeout`, en een tweede run kan niet naast een eerste starten.
#
# Gebruik:
#   scripts/gates.sh            alles
#   scripts/gates.sh hygiene    alleen de hygienecontrole
#   scripts/gates.sh rpc        alleen de rechten op databasefuncties
#   scripts/gates.sh tsc        alleen typecheck
#   scripts/gates.sh test       alleen tests
#   scripts/gates.sh build      alleen build
#
# Exitcode 0 als alles slaagt, 124 bij een timeout, anders de code van de gefaalde stap.

set -uo pipefail

HYGIENE_TIMEOUT=${HYGIENE_TIMEOUT:-60}
RPC_TIMEOUT=${RPC_TIMEOUT:-30}
VIEW_TIMEOUT=${VIEW_TIMEOUT:-60}
TSC_TIMEOUT=${TSC_TIMEOUT:-300}
# De suite doet er ~32s over sinds de runner het tsx-binary rechtstreeks aanroept en
# parallelliseert (was ~460s). 300s laat ruimte voor een tragere machine en vangt een
# vastloper drie keer zo snel als de oude 900s.
TEST_TIMEOUT=${TEST_TIMEOUT:-300}
BUILD_TIMEOUT=${BUILD_TIMEOUT:-900}

LOCK=/tmp/dashboard-gates.lock

# Twee gelijktijdige builds schrijven in dezelfde .next en laten elkaar half af achter; dat
# heeft eerder een uur gekost aan het najagen van een ontbrekende required-server-files.json.
# De lock is er dus niet alleen tegen verspilling maar ook tegen een echte kapotte build.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "POORTEN: er draait al een run (lock $LOCK). Afgebroken." >&2
  exit 75
fi

stap() {
  local naam=$1 limiet=$2; shift 2
  echo "── $naam (max ${limiet}s)"
  timeout --signal=TERM --kill-after=10 "$limiet" "$@"
  local code=$?
  if [ $code -eq 124 ]; then
    echo "POORT $naam: TIJD OP na ${limiet}s — afgebroken, niet blijven hangen." >&2
  fi
  return $code
}

doel=${1:-alles}
falen=0

# Eerst, want hij is klaar in een seconde en vangt wat de andere drie poorten per definitie
# niet zien: dubbele definities van gedeelde hulpjes, modules die door niets worden
# geimporteerd, en stuurtekens die een bestand onvindbaar maken voor code-search. Dat zijn
# precies de dingen die stilzwijgend teruggroeien omdat niets ze tegenhoudt.
if [ "$doel" = "alles" ] || [ "$doel" = "hygiene" ]; then
  stap hygiene "$HYGIENE_TIMEOUT" node scripts/check-hygiene.mjs || falen=$?
fi

# Vlak na de hygiene, want hij is net zo snel en vangt iets dat de andere poorten per definitie
# niet zien: rechten staan in de DATABASE en niet in de code. PostgREST publiceert elke functie in
# public als endpoint en Postgres geeft nieuwe functies standaard EXECUTE aan PUBLIC — twee
# defaults die samen betekenen dat wie een functie aanmaakt, hem op internet zet. Dat is hier
# gebeurd met verwijder_klant_data; zie migratie 040. Slaat zichzelf over zonder databasegegevens.
if [ "$doel" = "alles" ] || [ "$doel" = "rpc" ]; then
  stap rpc-rechten "$RPC_TIMEOUT" node scripts/check-rpc-rechten.mjs || falen=$?
fi

# Zelfde soort poort, zelfde reden: dit staat in de DATABASE en niet in de code. Fase 3 van
# docs/ONTWERP_multitenant_schema.md zet views onder de oude tabelnamen, en een view die een kolom
# mist of een waarde anders berekent geeft geen fout maar een ander getal. De kandidaat-views staan
# daarom eerst NAAST hun tabel zodat de vergelijking te maken is; deze poort maakt hem, elke run.
# Heeft al een keer gewerkt: de eerste versie rekende conversion_rate zelf uit en zat er op 48,6 %
# van de PMax-rijen naast. Slaat zichzelf over zonder databasegegevens.
if [ "$doel" = "alles" ] || [ "$doel" = "views" ]; then
  stap view-dekking "$VIEW_TIMEOUT" node scripts/check-view-dekking.mjs || falen=$?
fi

if [ "$doel" = "alles" ] || [ "$doel" = "tsc" ]; then
  stap tsc "$TSC_TIMEOUT" npx tsc --noEmit || falen=$?
fi

if [ "$doel" = "alles" ] || [ "$doel" = "test" ]; then
  stap tests "$TEST_TIMEOUT" node scripts/run-tests.mjs || falen=$?
fi

if [ "$doel" = "alles" ] || [ "$doel" = "build" ]; then
  stap build "$BUILD_TIMEOUT" npm run build || falen=$?
fi

if [ $falen -eq 0 ]; then
  echo "POORTEN GROEN"
else
  echo "POORTEN GEFAALD (code $falen)" >&2
fi
exit $falen
