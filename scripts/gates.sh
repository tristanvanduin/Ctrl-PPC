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
#   scripts/gates.sh            alles: code en database (zonder browser, zie hieronder)
#   scripts/gates.sh code       alles wat zonder database en server draait (hygiene, datagrond, tsc, tests, demo, build)
#   scripts/gates.sh database   de databasepoorten (rpc, views, grens, rls, analyses)
#   scripts/gates.sh browser    rookproef en cijfercontrole, tegen een draaiende server op BASIS_URL
#
# De volledige ronde is twee runs: eerst "scripts/gates.sh" (bouwt, zonder server), dan de server
# starten, dan "scripts/gates.sh browser". De browser zit bewust NIET in "alles": bouwen mag niet
# onder een draaiende server en de browser heeft er juist een nodig, dus in een run sloten ze elkaar
# uit en kon "alles" nooit groen worden. Een standaardcommando dat altijd op 3 eindigt, leert mensen
# exit 3 te negeren, en "overgeslagen is niet groen" is precies wat die 3 moet zeggen.
#   scripts/gates.sh analyses   alleen het slagingspercentage van de analyses
#   scripts/gates.sh hygiene    alleen de hygienecontrole
#   scripts/gates.sh datagrond  alleen de query-vs-schema-controle
#   scripts/gates.sh rpc        alleen de rechten op databasefuncties
#   scripts/gates.sh tsc        alleen typecheck
#   scripts/gates.sh test       alleen tests
#   scripts/gates.sh demo       alleen de detectorcontrole van de demo-scenario's (seed --check, geen database)
#   scripts/gates.sh build      alleen build
#
# Exitcode 0 als alles gedraaid heeft en slaagt, 124 bij een timeout, de code van de gefaalde stap
# bij een fout, en 3 als er geen fout is maar een of meer poorten niet gedraaid hebben.

set -uo pipefail

HYGIENE_TIMEOUT=${HYGIENE_TIMEOUT:-60}
RPC_TIMEOUT=${RPC_TIMEOUT:-30}
VIEW_TIMEOUT=${VIEW_TIMEOUT:-60}
GRENS_TIMEOUT=${GRENS_TIMEOUT:-60}
TSC_TIMEOUT=${TSC_TIMEOUT:-300}
# De suite doet er ~32s over sinds de runner het tsx-binary rechtstreeks aanroept en
# parallelliseert (was ~460s). 300s laat ruimte voor een tragere machine en vangt een
# vastloper drie keer zo snel als de oude 900s.
TEST_TIMEOUT=${TEST_TIMEOUT:-300}
BUILD_TIMEOUT=${BUILD_TIMEOUT:-900}
# Rookproef en cijfercontrole openen samen enkele tientallen pagina's met wachttijden erin.
BROWSER_TIMEOUT=${BROWSER_TIMEOUT:-900}

LOCK=/tmp/dashboard-gates.lock

# Twee gelijktijdige builds schrijven in dezelfde .next en laten elkaar half af achter; dat
# heeft eerder een uur gekost aan het najagen van een ontbrekende required-server-files.json.
# De lock is er dus niet alleen tegen verspilling maar ook tegen een echte kapotte build.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "POORTEN: er draait al een run (lock $LOCK). Afgebroken." >&2
  exit 75
fi

doel=${1:-alles}
falen=0
gedraaid=0
overgeslagen=()

# Exitcode 3 betekent "niet gedraaid" (scripts/poort-overslaan.mjs). Die telt NIET als geslaagd:
# de databasepoorten eindigden zonder sleutels met 0 en dan stond hier "POORTEN GROEN", terwijl
# de bureauscheiding niet getoetst was. Een overgeslagen poort staat nu bij naam in de slotregel.
OVERGESLAGEN=3

stap() {
  local naam=$1 limiet=$2; shift 2
  echo "── $naam (max ${limiet}s)"
  timeout --signal=TERM --kill-after=10 "$limiet" "$@"
  local code=$?
  if [ $code -eq 124 ]; then
    echo "POORT $naam: TIJD OP na ${limiet}s — afgebroken, niet blijven hangen." >&2
  fi
  if [ $code -eq $OVERGESLAGEN ]; then
    overgeslagen+=("$naam")
    return 0
  fi
  gedraaid=$((gedraaid + 1))
  return $code
}

sla_over() {
  local naam=$1 reden=$2
  echo "── $naam"
  echo "$naam: OVERGESLAGEN ($reden). Niet gedraaid is niet geslaagd."
  overgeslagen+=("$naam")
}

# Of er op BASIS_URL een server antwoordt. Alleen dan heeft de browserpoort iets om naar te kijken,
# en alleen dan is bouwen gevaarlijk (zie AGENTS.md: bouwen onder een draaiende server laat hem
# 500's geven op chunks die niet meer bestaan).
BASIS_URL=${BASIS_URL:-http://localhost:3190}
export BASIS_URL
server_antwoordt() {
  curl -s -o /dev/null --max-time 5 "$BASIS_URL/" 2>/dev/null
}

# "code" is alles wat zonder database en zonder server draait: wat CI ook draait.
is_doel() {
  local d
  for d in "$@"; do [ "$doel" = "$d" ] && return 0; done
  return 1
}

# Eerst, want hij is klaar in een seconde en vangt wat de andere drie poorten per definitie
# niet zien: dubbele definities van gedeelde hulpjes, modules die door niets worden
# geimporteerd, en stuurtekens die een bestand onvindbaar maken voor code-search. Dat zijn
# precies de dingen die stilzwijgend teruggroeien omdat niets ze tegenhoudt.
if is_doel alles code hygiene; then
  stap hygiene "$HYGIENE_TIMEOUT" node scripts/check-hygiene.mjs || falen=$?
fi

# Even snel en offline als de hygiene, en hij vangt de klasse waarmee de deep dives maanden
# onzichtbaar kapot stonden: een query met een kolom die niet bestaat is geen compilefout en
# geen testfout, maar een runtime-400 die als "geen data" leest. Elke .from()-keten wordt
# tegen scripts/schema-snapshot.json gelegd (verversen: check-datagrond.mjs --vernieuw). Zo
# ving hij de dode bidding_strategy-kolom waarop bid-strategy élke run in een 404 smoorde.
if is_doel alles code datagrond; then
  stap datagrond "$HYGIENE_TIMEOUT" node scripts/check-datagrond.mjs || falen=$?
fi

# Vlak na de hygiene, want hij is net zo snel en vangt iets dat de andere poorten per definitie
# niet zien: rechten staan in de DATABASE en niet in de code. PostgREST publiceert elke functie in
# public als endpoint en Postgres geeft nieuwe functies standaard EXECUTE aan PUBLIC — twee
# defaults die samen betekenen dat wie een functie aanmaakt, hem op internet zet. Dat is hier
# gebeurd met verwijder_klant_data; zie migratie 040. Slaat zichzelf over zonder databasegegevens.
if is_doel alles database rpc; then
  stap rpc-rechten "$RPC_TIMEOUT" node scripts/check-rpc-rechten.mjs || falen=$?
fi

# Zelfde soort poort, zelfde reden: dit staat in de DATABASE en niet in de code. Fase 3 van
# docs/ONTWERP_multitenant_schema.md zet views onder de oude tabelnamen, en een view die een kolom
# mist of een waarde anders berekent geeft geen fout maar een ander getal. De kandidaat-views staan
# daarom eerst NAAST hun tabel zodat de vergelijking te maken is; deze poort maakt hem, elke run.
# Heeft al een keer gewerkt: de eerste versie rekende conversion_rate zelf uit en zat er op 48,6 %
# van de PMax-rijen naast. Slaat zichzelf over zonder databasegegevens.
if is_doel alles database views; then
  stap view-dekking "$VIEW_TIMEOUT" node scripts/check-view-dekking.mjs || falen=$?
fi

# Kan bureau A bij de data van bureau B? Ook dit staat in de DATABASE en niet in de code, en het is
# de enige soort fout die GEEN foutmelding geeft: te veel toegang laat de app juist beter werken.
# De proef maakt echt een gebruiker aan bij het ene bureau en laat hem naar het andere vragen; met
# de oude, bureau-blinde functie gaf dat `true`. Ruimt zichzelf op, ook bij een fout. Slaat over
# zonder service-sleutel of met minder dan twee bureaus.
if is_doel alles database grens; then
  stap bureaugrens "$GRENS_TIMEOUT" node scripts/check-bureaugrens.mjs || falen=$?
fi

# Een laag dieper dan de vorige. check-bureaugrens toetst of de FUNCTIES het goede antwoord geven;
# dit toetst of de DATABASE ook echt rijen tegenhoudt -- met een echte login, een echt token en
# echte HTTP naar PostgREST, precies wat de browser doet. Een functie die "false" zegt bewijst nog
# niet dat er een policy op de goede kolom staat.
if is_doel alles database rls; then
  stap rls-scheiding "$GRENS_TIMEOUT" node scripts/check-rls-scheiding.mjs || falen=$?
fi

if is_doel alles code tsc; then
  stap tsc "$TSC_TIMEOUT" npx tsc --noEmit || falen=$?
fi

if is_doel alles code test; then
  stap tests "$TEST_TIMEOUT" node scripts/run-tests.mjs || falen=$?
fi

# Triggeren de twintig demoscenario's hun detector nog? De demo-klant is waar alles op getoetst
# wordt, en deze controle bestond, maar stond in geen poort: een detectorwijziging die een scenario
# stil uitzette, viel pas op als iemand hem met de hand draaide. --check raakt geen database (de
# kop van het script). Het tsx-binary rechtstreeks, zoals run-tests, en EXACT --check: zonder dat
# argument gaat het script seeden.
if is_doel alles code demo; then
  TSX=node_modules/.bin/tsx
  [ -x "$TSX" ] || TSX="npx tsx"
  stap demo-scenarios "$HYGIENE_TIMEOUT" $TSX scripts/demo/seed-demo-client.ts --check || falen=$?
fi

# Hoe vaak rondt een analyse af, per cadans? Leest generation_jobs, schrijft niets. Een maandanalyse
# die in ruim de helft van de pogingen stil wegvalt, gaf hier eerder geen enkel signaal. Slaat over
# (code 3) zonder databasegegevens.
if is_doel alles database analyses; then
  stap analyses "$RPC_TIMEOUT" node scripts/check-analyse-slagingen.mjs || falen=$?
fi

# Niet bouwen onder een draaiende server: hij houdt het oude manifest vast en geeft daarna 500's
# op chunks die niet meer bestaan, wat eruitziet als een kapotte app (AGENTS.md). Antwoordt er een,
# dan slaat de build hardop over en is de run niet groen.
if is_doel alles code build; then
  if server_antwoordt; then
    sla_over build "er antwoordt een server op $BASIS_URL; stop hem eerst (op PID, zie AGENTS.md)"
  else
    stap build "$BUILD_TIMEOUT" npm run build || falen=$?
  fi
fi

# De browserpoorten: de rookproef (elke hoofdpagina van de demo-klant, oud en nieuw, op 390 px) en
# de cijfercontrole (hetzelfde kerncijfer op meerdere pagina's). Ze hebben een draaiende server
# nodig; zonder server slaan ze hardop over, en dat telt niet als groen. Alleen met het doel
# "browser", niet in "alles" (zie de kop): volgorde voor een volledige ronde is scripts/gates.sh
# (bouwt), dan next start -p 3190, dan scripts/gates.sh browser.
if is_doel browser; then
  if server_antwoordt; then
    stap rookproef "$BROWSER_TIMEOUT" node scripts/rookproef.mjs || falen=$?
    stap cijfers-gelijk "$BROWSER_TIMEOUT" node scripts/check-cijfers-gelijk.mjs || falen=$?
  else
    sla_over rookproef "geen server op $BASIS_URL"
    sla_over cijfers-gelijk "geen server op $BASIS_URL"
  fi
fi

if [ $falen -ne 0 ]; then
  echo "POORTEN GEFAALD (code $falen)" >&2
  exit $falen
fi
if [ ${#overgeslagen[@]} -gt 0 ]; then
  echo "POORTEN NIET GROEN: $gedraaid gedraaid zonder fout, ${#overgeslagen[@]} niet gedraaid: ${overgeslagen[*]}" >&2
  echo "  Overgeslagen is niet geslaagd. Databasepoorten: zet de sleutels; build: stop de server; browserpoorten: start de server." >&2
  exit $OVERGESLAGEN
fi
if is_doel alles; then
  echo "POORTEN GROEN ($gedraaid gedraaid). De browserronde zit niet in 'alles': start de server en draai 'scripts/gates.sh browser'."
else
  echo "POORTEN GROEN ($gedraaid gedraaid)"
fi
exit 0
