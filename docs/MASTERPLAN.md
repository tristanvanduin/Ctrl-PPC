# Ctrl PPC Masterplan

Vastgesteld 14 augustus 2026, gemeten tegen de live database en deze repository. Dit document is
bindend voor alle bouwbeslissingen tot het expliciet wordt herzien.

## 0. Wat dit document is

De strategische documenten (Copilot v1-v3, Gemini v1-v3, CHANNEL_INTELLIGENCE_FRAMEWORK,
AGENCY_MEMORY_AND_PLAYBOOK_ENGINE, DECISION_ENGINE_ARCHITECTURE v1 en v2, GOD_VIEW_ARCHITECTURE,
CROSS_CHANNEL_INTELLIGENCE, DEMAND_INTELLIGENCE, CANONICAL_DATA_MODEL, AGENCY_IDENTITY,
REPORTING_ENGINE, INTEGRATION_ARCHITECTURE, MCP_SANDBOX) zijn geschreven zonder toegang tot de
code en de database. Ze bevatten samen ruim 19.000 regels visie waarvan het grootste deel juist
is, en een handvol aannames die niet met de werkelijkheid kloppen.

Dit document doet drie dingen en verder niets:

1. Het legt de besluiten vast die nu genomen zijn, zodat ze niet elke sessie opnieuw worden gevoerd.
2. Het corrigeert de plekken waar de documenten en de werkelijkheid uiteenlopen.
3. Het legt de bouwvolgorde vast met een expliciete poort per fase.

**Wat het niet doet:** de visie herschrijven. De strategische documenten blijven de bron voor het
waarom. Dit document is de bron voor het wat, in welke volgorde, en waarom niet nu.

Bij tegenspraak tussen dit document en een strategisch document wint dit document, want dit is het
enige dat tegen de database is gehouden.

---

## 1. Vastgelegde besluiten

Negen open vragen zijn beantwoord. Twee heb ik zelf ingevuld met motivering. Ze staan hier zodat ze
niet opnieuw ter discussie komen zonder dat iemand dit document wijzigt.

| # | Besluit | Gevolg voor de bouw |
|---|---|---|
| 1 | **pg_cron blijft uit tot na de testfase.** | Alle batchberekening draait in TypeScript achter Vercel Cron. Geen SQL-functie die zichzelf plant. Dit vereenvoudigt fase 1 tot en met 4 aanzienlijk: alles is testbaar met `scripts/run-tests.mjs` in plaats van alleen in de database. |
| 2 | **OpenRouter, meerdere modellen.** | `lib/analysis/llm-router.ts` gaat van het directe Gemini-endpoint naar OpenRouter. Dit is een voorwaarde voor AI Council, niet alleen een leveranciersvoorkeur: een adversariele review met modellen van dezelfde familie is geen review. |
| 3 | **Bouwfase, dan launching customer, dan sales.** | Geen enkele module wordt gebouwd voor een klant die er niet is. De poorten in fase 5 tot en met 7 zijn hierop afgestemd. |
| 4 | **Specialisten vullen targets; jij doet de testcases.** | `client_targets` (nu 0 rijen) krijgt een invoerscherm in fase 2. Dit is geen bijzaak: zonder targets is de hele universele analyselaag stuurloos. Zie sectie 3.4. |
| 5 | **De sync staat stil sinds 17 april 2026: verloren toegang tot de gekoppelde accounts, bevestigd door de opdrachtgever.** | Zie sectie 2.1. Geen codefout; blijft open tot de koppeling hersteld is (sectie 6 lost dit structureel op). |
| 6 | **Een applicatie-koppeling, OAuth per bureau.** | Zie sectie 6 voor het volledige connectormodel en de kostenbesparing. |
| 7 | **Sleutelkeuze: `agency_id` overal, `client_id` als bedrijfssleutel, `account_id` waar platformspecifiek.** | Zie sectie 1.1 voor de motivering. |
| 8 | **Search Console wordt gebouwd.** | Fase 2. Zonder GSC is Demand Intelligence half en is False Positive Prevention niet te bewijzen. |
| 9 | **Zoektermrijen zijn eindig, learnings zijn permanent.** | Zie sectie 8 voor het retentiemodel en het onderscheid tussen ruwe rijen en vastgelegde conclusies. |

### 1.1 De sleutelkeuze, met motivering

Er lopen vandaag twee identiteiten door elkaar. De feitenlagen zijn gesleuteld op `account_id`
(uuid), de outputlagen op `client_id` (text). Er is geen `clients`-tabel; `accounts` draagt beide
plus `agency_id`, met een UNIQUE-index op `client_id`.

**Besluit:**

- **`agency_id` (uuid) staat op elke nieuwe tabel.** Zonder uitzondering. Dit is de tenantgrens en
  de enige sleutel waar RLS, God View-dominantie en facturatie alle drie aan hangen.
- **`client_id` (text) is de bedrijfssleutel.** De outputlaag, de RLS-helper
  `app_zichtbare_klanten()` en dertig schrijfplekken draaien erop. Dat omzetten kost meer dan het
  oplevert.
- **`account_id` (uuid) komt erbij waar een rij over een specifiek advertentieaccount gaat.**

**Waarom niet alleen uuid:** de outputlaag is de laag die de gebruiker ziet en die het langst
meegaat. Die migreren is dertig schrijfplekken, twee RLS-helpers en een handvol views raken, voor
een correctheidswinst die vandaag nul is omdat de relatie 1-op-1 is.

**Waar dit gaat knellen, en dat gebeurt zeker:** `accounts.client_id` is UNIQUE. Dat betekent
letterlijk een advertentieaccount per klant. Een klant met een Google-account en een
Meta-account past er vandaag niet in, en dat is precies de klant die het product wil bedienen. De
huidige workaround is dat `meta_connections` en `linkedin_connections` ook op `client_id` zijn
gesleuteld, waardoor "klant" en "account" hetzelfde zijn geworden.

Die UNIQUE moet weg, en wel voordat de tweede echte klant met twee kanalen binnenkomt. Dat is
fase 1.8 en het is de enige structurele wijziging in dit plan waar ik geen alternatief voor zie.

---

## 2. De gecorrigeerde werkelijkheid

### 2.1 De sync staat vier maanden stil — bevestigd, en de mechaniek erachter

**Update 14 augustus, na uitvoering van fase 0.1:** bevestigd door de opdrachtgever — de toegang
tot de gekoppelde Google Ads-accounts is verloren, en dat is de oorzaak. Wat volgt is hoe dat zich
in de database laat zien, en waarom dat spoor eerst zonder die bevestiging is nagelopen: het
verschil tussen "credentials ontbreken" en "de API-aanroep faalt" bepaalt namelijk of er ooit een
harde foutmelding was te zien geweest, en dat bepaalt op zijn beurt of hier nog een losse
alarmering nodig is.

`syncClient()` (`lib/sync/orchestrator.ts`) schrijft een `sync_runs`-rij met `status: "running"`
**voordat** er een Google Ads-aanroep gebeurt, en zet hem bij een mislukte aanroep op `"failed"`
met de foutmelding erbij. Sinds 17 april staat er geen enkele rij meer, ook geen mislukte. Dat
sluit uit dat de sync draaide en tegen een ongeldig token aanliep — die faalwijze laat altijd een
spoor na.

Wat wél bij de bevestigde oorzaak past: `credentialsVoorBureau()` in `lib/tenancy/credentials.ts`
geeft `null` terug zodra de omgevingsfallback (`GOOGLE_ADS_REFRESH_TOKEN`) ontbreekt of leeg is.
De aanroepende lus in `/api/sync/cron` (`app/api/sync/cron/route.ts`) doet dan `continue` **voordat
`syncClient()` wordt aangeroepen** — en dus voordat er een `sync_runs`-rij ontstaat. Een verlopen
of ingetrokken toegang die vertaald is naar een leeg of verwijderd token, produceert precies dit
beeld: geen enkel spoor in de database, wel een "geen credentials"-regel in de JSON-respons van de
cron, die niemand leest omdat het een cron is en geen scherm.

Dit is dus geen losstaand mysterie meer, maar het bevestigt wél iets structureels: **een
credentialsfout die vóór `syncClient()` optreedt, is vandaag onzichtbaar voor iedereen behalve wie
toevallig de cron-respons naleest.** Dat is een gat dat sectie 6 (OAuth per bureau, met een
zichtbare koppelstatus) dichtzet, en dat tot die tijd niet vanzelf verdwijnt.

Wat er verder werkelijk aan de hand is, gemeten vóór de bevestiging:

| Meting | Waarde |
|---|---|
| Laatste `sync_runs`-rij | **2026-04-17**, status success, 28 van 28 datasets geslaagd |
| `ads_account_monthly_legacy`, april | 47 klanten |
| `ads_account_monthly_legacy`, mei tot juli | **1 klant** (de demoklant) |
| `ads_search_terms_monthly`, laatste maand | 2026-04-01, 44 klanten |
| `client_sync_status.freshness_status` | **"fresh"** voor alle 11 klanten |
| Laatste succesvolle sync volgens diezelfde tabel | 2026-04-17 |

De projectie werkt prima. `fact_core` en `fact_dimension` zijn allebei even actueel als hun bron.
Het gat dat ik zag was de demoklant, die als enige mei, juni en juli heeft.

**Wat er wel aan de hand is:** de Google Ads-sync heeft na 17 april niet meer gedraaid. Niet
gefaald, want dan stond er een mislukte run. Hij is gestopt met starten, of hij crasht voordat hij
een `sync_runs`-rij aanmaakt, bijvoorbeeld bij het laden van credentials.

**Is dit ernstig?** De data is niet stuk en er is niets verloren dat niet opnieuw op te halen is:
Google Ads bewaart historie, dus zodra de koppeling terug is haalt een backfill de vier maanden op.

**Wat wel ernstig leek en genuanceerder bleek:** de gemeten kolom `client_sync_status.
freshness_status` staat op "fresh" voor alle elf klanten, terwijl de data voor tien van de elf vier
maanden oud is. Uitgezocht wie dat veld echt gebruikt: de twee productiepaden die specialisten en
gebruikers zien — `checkDataFreshness()` (de SOP-preflight) en `SyncStatusBadge` (de badge op het
klantdashboard) — **herrekenen de versheid allebei live uit `last_sync_at`** en negeren de
opgeslagen kolom. Die twee zouden vandaag al terecht "verouderd" tonen. De kolom zelf is dus wel
degelijk een geschreven leugen (hij claimt een momentopname te zijn en is dat niet), maar hij was
nog aan niemand doorgegeven. De ene plek die hem wél ongefilterd doorgaf — `GET /api/sync` — had
geen actieve aanroeper in de frontend. Gerepareerd in fase 0.1 zodat de volgende consument die wél
bouwt, geen bestaande leugen erft. Zie de commit van 14 augustus voor de precieze wijziging.

**Dit was fase 0.1 en ging voor alles.** Niet omdat de ontbrekende data zelf urgent was, maar omdat
elke analyse die hierna gebouwd wordt op een versheidsgarantie moet kunnen leunen die klopt — en nu
op de twee plekken die ertoe doen, klopt.

### 2.2 Wat de documenten fout hebben over de database

| Aanname in de documenten | Werkelijkheid |
|---|---|
| `fact_core` moet een wide fact table worden | Is het al. Vijf metriekkolommen, geen EAV. Copilot v1 en v2 schrijven een migratie **weg** van deze goede vorm voor en zijn op dat punt ongeldig. |
| `fact_dimension` is de classificatietabel (vertical, country, funnel_stage) | Is een uitsplitsingsfeitentabel: 330.601 rijen, waarvan 243.666 zoektermen. Letterlijke uitvoering zou classificatievelden in een feitentabel met een negendelige primaire sleutel schrijven. |
| Er moeten vijftien nieuwe `gv_*` en `ctrl_*` tabellen komen | Drie bestaan al onder een andere naam: `generation_jobs` (182 rijen) is de action queue, `generation_job_events` (1.926 rijen) de eventlog, `sync_runs` de batchlog. |
| God View moet gebouwd worden | Kan geen enkele rij produceren: er is een bureau in de database en de drempel is vier. |
| pg_cron doet de nachtelijke berekening | Niet geinstalleerd, en bewust uitgesteld (besluit 1). |
| De kwalificatieregels voor benchmarks moeten ontworpen worden | Staan al in `lib/benchmark/cel.ts`, beter onderbouwd dan de documentversie, inclusief motivering per drempelwaarde. |

### 2.3 Wat er al staat en beter is dan de documenten aannemen

Dit is geen greenfield. Onderschat dit niet bij het plannen:

- 134 relaties, 75 migraties, 71 API-routes, 246 testbestanden.
- Een volwassen Google Ads-pijplijn met een 13-staps SOP.
- Twee gescheiden registries: `channel-adapter.ts` (prompt) en `channel-provider.ts` (signaal).
  Die scheiding is exact wat het kanaaldocument vraagt.
- Een RLS-model met vier helperfuncties en twee poortscripts die de grens actief toetsen.
- Een deterministische forecastmotor van 1.137 regels.
- Kostenbewaking per bureau per maand (`llm_usage` plus `uitgavenplafond.ts`).
- **Een marketingsite met een integriteitsconventie.** `lib/marketing/modules.ts` en `tiers.ts`
  dragen een `gebouwd`-vlag per module, met in het commentaar de verificatie tegen de codebase.
  `lib/marketing/loop.ts` bevat een notitie waarin twee claims uit aangeleverde referentiebeelden
  expliciet zijn afgewezen omdat ze de code niet overleefden.

Dat laatste is belangrijker dan het lijkt. Sectie 3 bouwt daarop voort.

---

## 3. De vertrouwensdoctrine

Dit is het onderdeel dat in geen van de negentien strategische documenten staat, en het is het
enige dat bepaalt of een bureau de analyses blind durft te vertrouwen.

### 3.1 Waarom de concurrentie faalt

Elk PPC-analysetool in de markt faalt op dezelfde drie punten:

1. **Ze vertellen wat er veranderde, niet waarom.** Een dashboard dat zegt "CPA +23%" heeft niets
   gezegd. De vraag is of dat komt door jou, door de markt, door seizoen, of door een kapotte pixel.
2. **Ze kunnen "jij" en "de markt" niet uit elkaar houden.** Zonder netwerkdata is elke
   marktverklaring een gok, en de meeste tools gokken toch.
3. **Hun aanbevelingen zijn onfalsifieerbaar.** "Overweeg je biedstrategie te herzien" kan nooit
   fout blijken. Daarom worden ze ook niet vertrouwd.

Het derde punt is het belangrijkste en het minst begrepen. Een aanbeveling die niet fout kan zijn,
kan ook niet goed zijn. Vertrouwen ontstaat niet door zelfverzekerde taal maar door een
aantoonbaar trackrecord.

### 3.2 De zes regels

Elke analyse die Ctrl PPC publiceert voldoet aan deze zes. Ze zijn geen richtlijn maar een poort:
wat er niet aan voldoet, wordt niet gepubliceerd.

**Regel 1: elk getal is herleidbaar.**
Elke cijfermatige claim in een output verwijst naar een rij in `fact_core` of `fact_dimension`, met
`source_table` erbij. Er is al machinerie voor: `__ongegrond_getal_test.ts`,
`metric-cross-checks.ts`, `claim-consistency.ts`, `weekly-number-gate.ts`. Die moet van shadow mode
naar blokkerend.

**Regel 2: elke bewering draagt zijn eigen weerlegging.**
Een insight vermeldt wat waar zou moeten zijn om hem onjuist te maken. Niet als juridische
disclaimer maar als onderdeel van de redenering: "Dit wijst op creative fatigue. Als de frequentie
stabiel was gebleven en alleen de CTR was gedaald, zou dit eerder op een aanbodprobleem wijzen."
Dat is wat een goede specialist zegt en wat geen enkel tool schrijft.

**Regel 3: het systeem zegt vaker "ik weet het niet" dan de concurrentie.**
`insufficient_data` is een volwaardige uitkomst, geen storing. Dit is contra-intuitief en het is de
sterkste vertrouwensbouwer die er is. Een tool dat in twintig procent van de gevallen toegeeft dat
het te weinig weet, wordt op de overige tachtig geloofd. Een tool dat altijd een antwoord heeft,
wordt op geen enkel geloofd zodra er een keer een fout uitkomt.

Concreet: `market_relation_type` staat vanaf dag een in het outputcontract met
`insufficient_data` als eerlijke standaard, ook zolang God View leeg is.

**Regel 4: confidence is een opbouw, geen getal.**
Een score van 78 zegt niets. De componenten wel:

| Component | Wat het meet |
|---|---|
| `sample_size` | Genoeg conversies of klikken om het verschil te zien |
| `tracking_quality` | Is de meting zelf betrouwbaar in deze periode |
| `effect_size` | Is het verschil groot genoeg om ertoe te doen |
| `consistency` | Doet het zich over meerdere periodes voor of eenmalig |
| `market_corroboration` | Bevestigt de markt het, spreekt hij het tegen, of is er geen markt |

Die vijf worden getoond, niet samengevat. Als er een laag is, staat er waarom. Dit is de
`confidence_breakdown` uit de documenten, en het is een van de weinige onderdelen daarvan dat
precies goed is bedacht.

**Regel 5: elke aanbeveling is een weddenschap met een meetdatum.**
Een aanbeveling zonder verwachte uitkomst en zonder moment waarop we kijken, is een mening.
`sprint_hypotheses` heeft de velden al: `expected_result`, `measurement_metric`, `timeframe`,
`outcome`, `result_met`, `learning`, `verdict_metrics`. Er draait een wekelijkse cron die ze
evalueert. Wat ontbreekt is dat de uitkomst terugkoppelt naar het systeem.

**Regel 6: de LLM rekent nooit, ook niet een beetje.**
SQL en TypeScript berekenen prioriteit, impact, confidence en marktrelatie. De LLM krijgt een
compacte `evidence_payload` en schrijft de uitleg. Dit is al beleid en al deels afgedwongen; het
moet compleet worden.

### 3.3 De functie die niemand durft te bouwen

Dit is de belangrijkste zin in dit document.

> **Ctrl PPC publiceert zijn eigen trackrecord.**

Niet als marketingclaim maar als scherm in het product en als sectie in het maandrapport:

```
Van de 47 hypotheses die Ctrl PPC de afgelopen zes maanden voor jouw accounts
voorstelde, zijn er 31 uitgevoerd. Daarvan haalden er 22 de voorspelde uitkomst.
Voorspelde CPA-verbetering gemiddeld 12 procent, gerealiseerd 9 procent.

Waar we het het vaakst mis hadden: creative fatigue op Meta (4 van 9 raak).
Waar we het het vaakst goed hadden: budget lost impression share (11 van 12 raak).
```

Geen enkele concurrent doet dit, en de reden is simpel: hun aanbevelingen zijn niet meetbaar
geformuleerd, dus ze kunnen het niet. Wij kunnen het wel zodra de leerlus draait.

Wat dit oplevert:

- **Verkoop.** Dit is de demo. Niet een dashboard laten zien maar een trackrecord.
- **Vertrouwen.** Een bureau dat ziet dat we vier van de negen keer misgokken op creative fatigue,
  vertrouwt de andere elf van twaalf op impression share des te meer.
- **Kalibratie.** Als het systeem weet waar het misgokt, kan de confidence op dat signaaltype
  omlaag. Dat is loop 5 uit sectie 4 en het is hoe de analyses echt slimmer worden.
- **Een moat.** Een concurrent kan dit scherm namaken. Het trackrecord erachter niet.

Dit maakt `agency_memory_events` de belangrijkste nieuwe tabel in het hele plan, en het is de reden
dat hij in fase 4 staat en niet in fase 7 zoals de documenten voorstellen.

### 3.4 Waarom targets niet optioneel zijn

Vier van de zes regels hierboven leunen op een doel. Zonder target is er geen "achterlopen",
geen "gap to target", geen "required pace", en geen manier om te zeggen of een gerealiseerde
verandering goed of slecht was.

`client_targets` heeft nul rijen. De universele analyselaag uit het kanaaldocument (ahead,
on_track, behind, critical) is vandaag dus overal een afgeleide zonder anker.

Besluit 4 zegt dat specialisten dit invullen. Dan is het invoerscherm een productonderdeel van
fase 2 en geen bijzaak, en het moet minimaal aankunnen:

- Doel per klant, per kanaal, per metriek, met geldigheidsperiode (de tabel kan dit al)
- Een jaardoel dat over maanden verdeeld wordt naar historische bijdrage (sectie 5.3)
- Het onderscheid tussen volumedoel en efficientiedoel, want die kunnen tegelijk goed en fout staan

---

## 4. De vijf loops

De documenten beschrijven een loop. Er zijn er vijf, ze draaien op verschillende snelheden, en ze
hebben elk een eigen faalwijze.

### Loop 1: de analyselus (per periode, week tot maand)

```
sync -> canonieke laag -> kanaalsignalen -> beslislaag -> werkvoorraad
     -> LLM-narratief -> outputtabellen -> scherm
```

Dit is de lus die vandaag draait. Faalwijze: stille datafouten stroomopwaarts, zoals de
versheidsindicator uit sectie 2.1. Beheersing: poorten aan het begin, niet aan het eind.

### Loop 2: de leerlus (per hypothese, weken tot maanden)

```
aanbeveling -> geaccepteerd of afgewezen -> uitgevoerd -> gemeten
            -> bevestigd of weerlegd -> agency_memory_event
            -> confidence-kalibratie op dat signaaltype
```

Dit is de lus die het product slim maakt en die vandaag halverwege stopt: uitkomsten worden
vastgelegd maar nergens teruggelezen. `lib/marketing/loop.ts` is daar al eerlijk over.

Faalwijze: alleen positieve uitkomsten vastleggen. Een afgewezen hypothese met een
`decision_reason` is een negatief leermoment en die zijn waardevoller dan de bevestigingen, want ze
zijn zeldzamer en ze corrigeren scherper.

### Loop 3: de marktlus (netwerk, maandelijks)

```
gekwalificeerde accounts -> gehashte bijdragen -> marktsignalen
                         -> marktpatronen -> intersection context -> terug in loop 1
```

Faalwijze: te weinig aanbod, en dan de drempels verlagen om toch iets te tonen. Zie sectie 7.

### Loop 4: de identiteitslus (bureau, per kwartaal)

```
agency_memory_events -> waar bewijst dit bureau structureel waarde
                     -> agency identity -> Proof Engine -> verkoopmateriaal
```

Faalwijze: identity bouwen zonder geheugen. Dan is het een tabel met meningen.

### Loop 5: de productlus (Ctrl PPC zelf, doorlopend)

```
trackrecord over alle bureaus -> waar voorspelt het systeem goed en waar slecht
                              -> drempels, prompts en confidence-wegingen bijstellen
                              -> betere analyses
```

**Dit is de lus die niemand bouwt en die het verschil maakt.** Loop 2 leert per bureau. Loop 5
leert over alle bureaus heen: als creative fatigue op Meta structureel te vaak wordt voorspeld,
gaat de drempel omhoog, voor iedereen.

Let op de privacygrens: loop 5 gebruikt uitsluitend de trefzekerheid per signaaltype, niet de
onderliggende klantdata. Dat is geaggregeerde meta-informatie over het systeem zelf, niet over
accounts, en valt daarmee buiten de opt-in die loop 3 wel nodig heeft.

---

## 5. Analyse-architectuur

### 5.1 De gedeelde vorm, het gescheiden pad

Elk kanaal levert dezelfde uitvoervorm, via een eigen route ernaartoe. Dit is precies wat de
bestaande twee registries al doen en het blijft zo.

Gedeeld: signal, pattern, cause, impact, recommendation, hypothesis, confidence, next action, plus
`market_relation_type` en de vijfdelige `confidence_breakdown`.

Niet gedeeld: hoe je daar komt.

| Kanaal | Rol | Kernvraag | Status |
|---|---|---|---|
| Google Ads | Vraag oogsten | Vangen we bestaande vraag efficient, en missen we vraag door budget, rang of structuur? | Volwassen, niet herbouwen |
| Microsoft Ads | Intentie met professionele context | Is dit incrementeel of een duplicaat van Google? | Alleen contract, geen data |
| Meta | Vraag creeren | Ligt het aan creative, doelgroep, aanbod, landingspagina of markt? | Adapter aanwezig, provider stub, MDP-goedkeuring blokkeert |
| LinkedIn | B2B-vraag creeren | Bereiken we de juiste buying committee, en is de leadkwaliteit het waard? | Adapter aanwezig, demografische as deels in `fact_dimension` |
| GA4 | Context | Veroorzaakt betaald verkeer downstream gedrag? | Modules aanwezig, koppeling niet gemodelleerd |
| Search Console | Context | Verschuift vraag tussen betaald en organisch, of krimpt de vraag zelf? | Te bouwen, fase 2 |

**De val die vermeden moet worden:** de Google-zoektermlogica hergebruiken voor Meta en LinkedIn
omdat de code er staat. Meta heeft geen zoektermen maar creatives en frequentie. LinkedIn heeft
functietitels en senioriteit. Wat gedeeld hoort te worden is de kwaliteitsmachinerie
(purity-contracten, claim-consistentie, ongegronde-getallencontrole) en nooit de analysestap zelf.

### 5.2 Cross-channel is geen module maar de reden dat de rest klopt

Het sterkste verkoopargument in de hele documentstapel, en tegelijk het onderdeel met de grootste
kloof tussen ambitie en data.

De echte waarde zit in False Positive Prevention: voorkomen dat een bureau een campagne uitzet die
werkte. Concreet:

- Betaald zoekverkeer daalt, organisch stijgt, totale vraag stabiel: geen probleem, kannibalisatie.
- Betaald zoekverkeer daalt, organisch stabiel, totale vraag daalt: markt, geen accountfout.
- Betaald zoekverkeer daalt, alles stabiel: nu pas is het een accountprobleem.

Zonder Search Console kun je alleen de derde regel schrijven, en dat is de regel die het vaakst
fout is. Dat is de reden dat GSC in fase 2 staat en niet later.

`lib/cross-channel/funnel-overlap.ts` staat vandaag als wees met de reden dat `classifyFunnelRole`
het objective niet leest, waardoor Meta en LinkedIn als onbekend uit de classificatie komen. Dat
oplossen levert meer op dan welke nieuwe tabel dan ook.

### 5.3 Forecasting: twee kolommen, geen een

De opdracht en de code beschrijven verschillende dingen, en ze zijn allebei nodig.

| | Doelverdeling (uit de opdracht) | Prognose (`lib/forecast.ts`) |
|---|---|---|
| Vertrekpunt | Het jaardoel | De historische realisatie |
| Methode | Doel over maanden verdelen naar historische bijdrage, corrigeren met de ratio tot nu toe | Verwachting per maand uit gewogen voorgaande jaren (50/30/20), dan performance factor en spend-adjusted efficiency |
| Beantwoordt | Halen we het doel? | Waar komen we uit? |
| Vereist | `client_targets` | Historie |

Beide kolommen tonen, plus een derde: verwachte impact van geaccepteerde hypotheses, gewogen met
het gerealiseerde trefpercentage uit `agency_memory_events`. Die derde kolom is meteen de
zichtbaarste toepassing van het trackrecord uit sectie 3.3.

Deterministisch, geen AI. De AI mag de forecast uitleggen en nooit berekenen.

**Eerst repareren:** `REALIZED_THROUGH_MONTH = 3` en `CURRENT_YEAR = 2026` staan hardgecodeerd in
`lib/types.ts` en sturen `components/dashboard/monthly-overview.tsx`. Het is augustus; het dashboard
denkt dat maart de laatste gerealiseerde maand is. De rekenkern in `forecast.ts` leidt het wel uit
de data af, dus dit is een presentatiefout met een reparatie van twee regels.

---

## 6. Connectorarchitectuur

Besluit 6: een applicatiekoppeling, klanten loggen in met OAuth, per bureau. Dat is de juiste
keuze en hij is beter dan wat er nu staat.

### 6.1 Het model

Vandaag: een developer token, een manager customer ID en een refresh token in omgevingsvariabelen.
Dat is een "onze MCC beheert alles"-model. Bureau twee kan zijn accounts niet koppelen zonder onder
hetzelfde managerbeheer te vallen.

Het doelmodel per platform:

1. Ctrl PPC heeft **een** developer token. Dat is per applicatie en dat kan ook niet anders.
2. Elk bureau doorloopt **een keer** OAuth met zijn eigen Google-account.
3. Het refresh token gaat in `supabase_vault` (geinstalleerd, migratie 063 legde de functies aan).
4. Met dat token vraagt Ctrl PPC de toegankelijke klantaccounts op en toont ze ter selectie.
5. `agency_connections` (bestaat, nul rijen) legt de koppeling vast.

Het bureau hoeft ons dus geen toegang te geven tot zijn MCC. Dat is minder wrijving en juridisch
schoner.

**Dit is de poort die God View opent.** Zonder OAuth per bureau komt bureau vier nooit binnen, en
zonder bureau vier is God View per definitie leeg. Het staat daarom voor fase 5 in de bouwvolgorde,
niet erna.

### 6.2 De kostenbesparing waar je om vroeg

Je vroeg om ideeen om API-calls en dataverbruik te beperken. Vier dingen, op volgorde van opbrengst:

**1. Getrapte synchronisatie in plaats van alles dagelijks.**
Dit is verreweg de grootste besparing. Niet elke dataset heeft dezelfde versheid nodig:

| Cadans | Datasets | Waarom |
|---|---|---|
| Dagelijks | Account- en campagneniveau, gisteren | Klein, en dit is wat pacing en code rood nodig hebben |
| Wekelijks | Adgroup, device, netwerk, geo, impression share | Beslissingen op deze assen worden niet dagelijks genomen |
| Maandelijks | Zoektermen, keywords, producten, PMax-assets | Dit zijn de grote datasets en ze worden in de maandanalyse gebruikt |

Zoektermen zijn nu 243.666 rijen tegen 61 MB en het is de duurste dataset in aanroepen en opslag.
Die maandelijks ophalen in plaats van dagelijks scheelt ordegrootte dertig keer.

**2. Incrementeel ophalen, niet dertien maanden per keer.**
`scripts/backfill-google-ads.ts` haalt dertien maanden op. Dat hoort een backfill te zijn, niet de
dagelijkse route. De reguliere sync haalt alleen op sinds de laatste geslaagde run per dataset.
`sync_runs` heeft de velden al.

**3. Aggregatie opvragen in plaats van rijen optellen.**
Google Ads GAQL kan segmenten en aggregaties aan de API-kant. Een query per account per maand met
de juiste segmentatie is goedkoper dan per campagne per dag ophalen en zelf optellen. Dit raakt
zowel het aantal operaties als het aantal rijen dat de database in gaat.

**4. Let op de accessgrens van het developer token.**
Basic access op de Google Ads API is 15.000 operaties per dag over alle klanten heen. Bij tien
bureaus met elk zeventig accounts is dat de eerste harde muur, niet de database. Standard access
aanvragen is een goedkeuringstraject met een doorlooptijd en het moet aangevraagd zijn **voordat**
bureau drie binnenkomt, niet erna.

Search Console en GA4 zijn hierin goedkoop: GSC heeft ruime quota en levert direct geaggregeerde
data, GA4 werkt met tokens per dag die bij maandaggregatie niet knellen.

---

## 7. De modules, gekoppeld aan wat ze nodig hebben

Uit de modulescorecard, met per module wat er echt voor moet bestaan. De volgorde is die van de
scorecard; de kolom "poort" is wat dit plan eraan toevoegt.

| Module | Wat het doet | Poort die open moet |
|---|---|---|
| **Foundation** (gratis) | Datafundering, dashboarding, forecasting | Fase 1 en 2. Dit is de instap en de bron van netwerkdata. |
| **God View Standard** | Markt zien: benchmarks, trends | Vier bureaus met opt-in, segmentdekking boven zestig procent |
| **God View Tactical** | Markt vertalen naar actie | God View Standard levert rijen |
| **God View Pulse** | Hoogfrequente marktverandering | Twaalf maanden gevulde marktsignalen |
| **Second Opinion** | Onafhankelijke accountbeoordeling | Draait al. Wordt markt-aware zodra God View er is. |
| **AI Council** | Meerdere modellen dagen de aanbeveling uit | OpenRouter met meerdere modellen (besluit 2), plus harde rondelimiet en kostenplafond per review |
| **Demand Flow Intelligence** | Welk kanaal creeert vraag, welk kanaal oogst | GA4-koppeling gemodelleerd, funnelrolclassificatie gerepareerd |
| **Demand Intelligence** | Vraag, SEO, betaald of markt als oorzaak | **Search Console gebouwd.** Zonder GSC is dit niet te leveren. |
| **Proof Engine** | Verkoopbewijs uit marktproblemen en eigen data | `agency_memory_events` met zes maanden historie |
| **White Label Portal** | Gebrande klantomgeving | Draait deels (`agencies.whitelabel_actief`, migratie 068) |
| **Volume Compute** | Extra verwerkingscapaciteit | Kredietgrootboek bestaat (migratie 070); zelfbedieningsflow niet |

**De regel die hierbij hoort:** `lib/marketing/modules.ts` draagt per module een `gebouwd`-vlag,
geverifieerd tegen de codebase. Die conventie blijft en wordt strenger: een module gaat pas op
`gebouwd: true` als er een productieconsument is die echte data leest, niet als de tabel bestaat.

---

## 8. Retentie

Besluit 9: zoektermrijen zijn eindig, learnings zijn permanent. Dat onderscheid is de kern van het
retentiemodel en het is scherper dan wat de documenten voorstellen.

| Termijn | Wat | Waarom |
|---|---|---|
| **Permanent** | Canonieke maandfeiten, segmentclassificatie, `agency_memory_events`, marktsignalen en -patronen, agency identity, definitieve outputs, `llm_usage` | Dit is het geheugen en de kostengeschiedenis. Niets hiervan is herberekenbaar. |
| **36 maanden** | Canonieke week- en dagfeiten, intersection context | Dagniveau over vier kanalen en 10.000 accounts is de tabel die als eerste onhandelbaar wordt. Permanent bewaren is de duurste beslissing in het hele schema. |
| **12 maanden** | Zoektermen, keyworddetail, creativedetail, plaatsingen | Vandaag 118 MB over twee tabellen bij een bureau. Dit is de enige laag die echt hard groeit. |
| **90 dagen** | Volledige prompts en responses, verwerkte queue-jobs, debugpayloads | Geen analytische waarde na afronding. |

**De brug tussen de twaalf maanden en permanent:** een zoekterm die tot een conclusie leidde,
verdwijnt niet met de rij. De conclusie gaat als `agency_memory_event` naar de permanente laag, met
een samenvatting van het bewijs erbij. De 243.666 ruwe rijen verdwijnen; het feit dat "merkbescherming
op concurrentietermen in deze niche structureel loont" blijft.

Dat is exact het onderscheid dat je maakte en het verdient een eigen mechanisme, niet alleen een
bewaartermijn: bij het opruimen van een periode wordt eerst gecontroleerd of er conclusies aan
hingen die nog niet zijn vastgelegd.

`ads_search_terms_wasteful` (199.647 rijen, 57 MB) is vermoedelijk een afgeleide van
`ads_search_terms_monthly`. Als dat klopt is het herberekenbaar en kan de termijn korter. Dat moet
geverifieerd worden voordat er een opruimjob op komt.

---

## 9. Bouwvolgorde

Elke fase heeft een poort. De poort is geen formaliteit: als hij dicht is, wordt de fase niet
gebouwd, ook niet "alvast een beetje".

### Fase 0: de werkelijkheid betrouwbaar maken — **KLAAR** (commit `2f9093d`)
**Poort: geen. Ging voor alles.**

- ~~`REALIZED_THROUGH_MONTH` en `CURRENT_YEAR` uit `lib/types.ts`, afleiden uit de data~~ —
  gedaan. `monthly-overview.tsx` leidt de grens nu af uit `result.points` (het laatste punt met
  `realized !== null`); de twee dode constanten en de ongebruikte import zijn verwijderd.
- ~~Vaststellen waarom de sync stilstaat~~ — bevestigd: verloren toegang tot de gekoppelde
  accounts, geen codefout. `sync_runs` krijgt sinds 17 april geen enkele rij meer, ook geen
  mislukte, wat past bij een credentialscontrole die faalt vóór `syncClient()` wordt aangeroepen
  (zie sectie 2.1 voor het mechanisme). Blijft open tot de koppeling hersteld is — sectie 6 lost
  dit structureel op met OAuth per bureau en een zichtbare koppelstatus.
- ~~`freshness_status` moet de waarheid vertellen~~ — genuanceerd. De twee productiepaden die
  gebruikers zien (`checkDataFreshness`, `SyncStatusBadge`) herrekenen al live en toonden nooit
  de leugen. `GET /api/sync` gaf de rauwe kolom wel ongefilterd door, zonder actieve aanroeper;
  nu gerepareerd zodat de volgende consument geen bestaande fout erft.
- Geen apart poortscript voor versheid gebouwd: dat zou een levende operationele toestand
  (staat de sync aan) meten met hetzelfde mechanisme als de code-juistheidspoorten (staat de
  rechtenstructuur goed), en dat zijn andere soorten waarheid. De juiste bewaking hiervan is een
  zichtbare koppelstatus per bureau, niet een build-gate — zie sectie 6.

Geen migratie nodig gebleken. Alle poorten (`hygiene`, `tsc`, `test`) groen.

### Fase 1: de canonieke laag afmaken
**Poort: fase 0 groen.**

- `fact_core` verbreden: `agency_id`, `client_id`, `currency`, `leads`, `data_quality_score`, `source_table`
- `fact_dimension` dezelfde tenantkolommen
- Projectie uitbreiden naar Google week en dag, impression share, PMax, producten, geo, netwerk, schema
- Batchgewijze backfill met hervatpunt
- `blended_account_monthly` herschrijven op `fact_core` zodat er een waarheid is in plaats van twee
- **De UNIQUE op `accounts.client_id` opheffen** (sectie 1.1)

*Klaar wanneer:* elke bestaande grafiek toont dezelfde cijfers als ervoor, aangetoond met een test
en niet met een steekproef.

### Fase 2: analyses waar je op kunt bouwen
**Poort: fase 1 groen.**

- Het gedeelde kanaaloutputcontract als TypeScript-type, met validatietests
- Bestaande Google-output erop mappen via een maplaag; de monthly-route van 2.913 regels blijft ongemoeid
- **Targetinvoer** voor specialisten, `client_targets` gevuld
- **Search Console** koppeling en signalen
- De kwaliteitspoorten van shadow mode naar blokkerend
- `confidence_breakdown` als vijf componenten in het contract
- `market_relation_type` met `insufficient_data` als eerlijke standaard

*Klaar wanneer:* een analyse voor een testklant voldoet aan alle zes regels uit sectie 3.2,
handmatig nagelopen op een echte maand.

### Fase 3: uitvoering en werkvoorraad
**Poort: fase 2 groen.**

- `generation_jobs` uitbreiden tot volwaardige action queue
- Claim-logica met `FOR UPDATE SKIP LOCKED`
- Verwerking via Vercel Scheduled Route, aangesloten op `llm-router` en `uitgavenplafond`
- **`llm-router` omzetten naar OpenRouter met meerdere modellen** (besluit 2)

### Fase 4: het geheugen
**Poort: fase 3 groen.**

- `agency_memory_events`, append-only, tien eventtypes
- Aansluiten op de bestaande hypothese-evaluatiecron
- Retroactief vullen vanuit de 127 rijen in `sprint_hypotheses`
- Negatieve leermomenten expliciet uit `decision_reason`
- **Het trackrecordscherm uit sectie 3.3**

*Klaar wanneer:* het trackrecordscherm echte cijfers toont over echte hypotheses. Dit is het moment
waarop het product demonstreerbaar wordt.

### Fase 5: launching customer
**Poort: fase 4 groen, en een klant die wil.**

Geen nieuwe bouw. Draaien, meten, bijstellen. Dit is de fase waar het plan zich bewijst of niet, en
de enige fase waarvan de uitkomst het plan mag wijzigen.

### Fase 6: de markt
**Poort: vier bureaus met opt-in, segmentdekking boven zestig procent.**

- OAuth per bureau volledig (sectie 6), want zonder dat gaat deze poort nooit open
- `gv_source_qualification` op de bestaande regels uit `lib/benchmark/cel.ts`
- `gv_private_contributions`, service-role only, geen policy
- `gv_market_signals`, een tabel met `period_type`
- `ctrl_intersection_context`

### Fase 7: de betaalde modules
**Poort: module verkocht.**

- AI Council met harde rondelimiet en kostenplafond per review
- Proof Engine op het patroon van `second_opinion_runs`
- `ctrl_agency_identity` uit het geheugen
- `gv_market_patterns` na twaalf maanden gevulde signalen

---

## 10. De marketingsite

De site bestaat al: prijzen met zes tiers, een modulewinkel, een zesstaps loop, 21 blogposts, een
vergelijkingspagina, how-it-works, faq en demo. De opgave is niet bouwen maar herrichten rond de
vertrouwensdoctrine.

### 10.1 Wat er verandert

**De belofte gaat van capaciteit naar trackrecord.** Nu verkoopt de site wat het product doet. Na
fase 4 kan het verkopen wat het product heeft aangetoond, en dat is een andere en veel sterkere
pagina. Dit is de reden dat de siteherziening na fase 4 staat en niet ervoor.

**De demo wordt de "markt of jij"-vraag.** Een interactief moment dat in dertig seconden laat zien
wat geen enkel dashboard kan: dezelfde CPA-stijging, drie keer, met drie verschillende oorzaken en
drie verschillende adviezen. Dat is het product in een scherm.

**Foundation wordt de instap en niets anders.** Permanent gratis, geen trialtaal. Foundation levert
de netwerkdata waar God View op draait; dat is de ruil en die mag expliciet zijn.

**De `gebouwd`-conventie blijft en wordt strenger.** De site zegt vandaag al eerlijk welke modules
nog niet bestaan. Dat is zeldzaam en het is een verkoopargument op zich: een leverancier die op de
prijspagina toegeeft wat er nog niet is, wordt geloofd over wat er wel is. Dat is dezelfde regel 3
uit sectie 3.2, toegepast op de marketing.

### 10.2 De volgorde

1. **Nu:** niets aan de site. Elke claim die nu wordt toegevoegd, moet straks worden teruggenomen.
2. **Na fase 2:** de how-it-works herschrijven rond de zes regels. Dit kan zodra de analyses
   aantoonbaar aan de regels voldoen.
3. **Na fase 4:** het trackrecord als hero. De demopagina met de "markt of jij"-vraag.
4. **Na fase 5:** de launching customer als case, met echte cijfers en met naam als het mag.
5. **Na fase 6:** God View-secties activeren; `gebouwd` op true zetten wanneer dat waar is.

Volle gas op sales hoort na stap 4, niet eerder. Een demo die converteert op een belofte die het
product nog niet waarmaakt, kost meer dan hij oplevert: het eerste bureau dat afhaakt vertelt het
door in een markt waar iedereen elkaar kent.

---

## 11. Wat we niet bouwen

Even belangrijk als de rest. Dit is de lijst die voorkomt dat het plan uitdijt.

- **Geen `fact_performance_core`.** `fact_core` is al wide; een tweede canonieke laag verdubbelt de
  migratie-, view- en poortkosten voor niets.
- **Geen `dim_segment`.** Bedrijfsmodel, niche, aov en landen staan in `client_settings` met een
  doordachte keuzelijst in `lib/benchmark/segment.ts`.
- **Geen tabel per platformsignaal.** Signalen zijn afleidingen, geen feiten. Ze horen in
  TypeScript boven de canonieke laag.
- **Geen tweede queue naast `generation_jobs`.** Twee queues is twee claim-implementaties en twee
  plekken waar een job kan blijven hangen.
- **Geen `out_*`-familie.** De bestaande outputtabellen werken en hebben dertig schrijfplekken.
- **Geen hernoeming van de bronlaag.** Dat is met migratie 054 al een keer gedaan.
- **Geen n8n, geen externe workflowtool, geen Edge Functions.** Vercel plus Supabase, meer niet.
- **Geen module die gebouwd wordt voor een klant die er niet is.** Poorten in fase 6 en 7.
- **Geen verlaagde benchmarkdrempels om God View eerder te kunnen tonen.** De motivering staat in
  `lib/benchmark/cel.ts` en anticipeert die verleiding letterlijk.
- **Geen lege provider die nul signalen teruggeeft.** Dat leest als "gemeten en niets gevonden" en
  dat verschil is bewust bewaakt in de bestaande code.

---

## 12. Wat er van dit plan afhangt

Drie dingen kunnen dit plan omgooien en het is eerlijk om ze te benoemen.

**De sync.** Als de Google Ads-toegang niet terugkomt, is er geen data om op te bouwen en verandert
fase 0 van een reparatie in een blokkade. Dit moet als eerste worden vastgesteld.

**De Meta MDP-goedkeuring.** `lib/meta/sync.ts` wacht erop. Zolang die er niet is, blijft Meta in
elke analyse een kanaal met een adapter en geen data. Dat raakt Demand Flow Intelligence direct,
want die module gaat juist over het samenspel tussen kanalen.

**Bureau twee, drie en vier.** De hele God View-planning hangt hieraan. Komen ze binnen zes
maanden, dan is fase 6 realistisch. Duurt het langer, dan verschuift de waarde van dit product naar
loop 2 en loop 5, en die staan gelukkig al vooraan in de volgorde. Dat is geen toeval: het plan is
zo gebouwd dat het ook zonder netwerk een product oplevert dat een bureau wil hebben.
