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

~~`lib/cross-channel/funnel-overlap.ts` staat vandaag als wees met de reden dat
`classifyFunnelRole` het objective niet leest, waardoor Meta en LinkedIn als onbekend uit de
classificatie komen. Dat oplossen levert meer op dan welke nieuwe tabel dan ook.~~ — **gewired
(16 augustus), met een eerlijke beperking.** De beschrijving hierboven was zelf niet meer
precies: `classifyFunnelRole` las het objective al bewust niet (dat zegt wat je wilt bereiken,
niet wie je aanspreekt) — het echte gat was dat er nergens een `audienceKind` werd afgeleid, en
dat de hele lens nooit werd aangeroepen (alleen zijn eigen test importeerde hem). Beide zijn nu
opgelost voor Google en LinkedIn: `app/api/analysis/cross-channel/route.ts` bouwt
`CampaignFunnelInput[]` uit `ads_campaign_monthly` (Google, campagnetype + merknaam) en
`linkedin_campaigns` (LinkedIn, `deriveLinkedInAudienceKind()` uit `targeting_summary` — die
kolom wordt al gevuld door `lib/linkedin/entities.ts` bij elke sync), en toont het resultaat als
nieuwe groep "Kanaalrollen & overlap" naast de bestaande zeven.

**Meta blijft eerlijk grotendeels onbekend.** `meta_adsets.targeting_summary` bestaat als kolom
sinds migratie 007 maar wordt door geen enkele syncroute gevuld — in tegenstelling tot LinkedIn
is er nooit een condense-functie voor Meta-adset-targeting gebouwd. Dat bouwen vergt een nieuwe
sync tegen de Meta Ads API, en die is vandaag niet te verifiëren zonder werkende Meta-credentials
(dezelfde beperking als Search Console hierboven). Meta-campagnes classificeren daarom via alleen
merknaamherkenning; zonder merknaam blijven ze `onbekend`, zichtbaar in `unknownCount`.

Geverifieerd tegen een echte klant (`gads-8714777147`): de "geen prospecting"-detectie triggerde
correct op de enige gesyncte Google-campagne. Tegen echte LinkedIn-rijen (client_id
`demo-greentech`, niet de ingebouwde demo-modus maar echte productierijen): `targeting_summary`
staat er op `null` (nooit gesynct, consistent met de sync-stilstand sinds april), en
`deriveLinkedInAudienceKind()` geeft daar terecht `onbekend` op terug in plaats van te gokken.

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

### 5.4 Campaign Type Intelligence: per-campagnetype scorecards

Toegevoegd 15 augustus, gevalideerd tegen een externe prompt (Copilot) die voorstelde elk
campagnetype (Search, PMax, Meta, LinkedIn) een eigen scorecard, KPI-set en health-check te geven
in plaats van dezelfde generieke grafieken overal te tonen. Het onderliggende probleem klopt: een
Search-campagne en een PMax-campagne hebben andere succesfactoren, en dat verschil verdwijnt in een
generiek dashboard.

**Waarom dit een fase-2-achtig item is en geen fase-6-achtig item:** in tegenstelling tot God View
zit hier geen poort voor. Het is presentatie- en analyselaag bovenop data die al bestaat: `fact_core`/
`fact_dimension` (fase 1, klaar) en het `campaign_type`-veld dat nu al gebruikt wordt om PMax te
herkennen (`app/api/analysis/monthly/route.ts`). Geen externe afhankelijkheid, geen wachtende klant.

**Wel dezelfde inperking als de herziene fase-2-poort (sectie 9):** alleen bouwen voor kanalen met
echte data. Vandaag is dat Google Ads (Search en PMax hebben allebei echte historie). Meta- en
LinkedIn-scorecards blijven `insufficient_data`/uitgesteld tot die kanalen echte data hebben —
zelfde regel 3 van de vertrouwensdoctrine, nu toegepast op een nieuwe module in plaats van op de
analysepijplijn.

**Twee concrete regels voor de bouw, uit de validatie:**

1. **Aansluiten op de bestaande healthscore-conventie**, niet een eigen scoretaal per kanaal
   verzinnen. `lib/health-score.ts` heeft al een accountbreed patroon (5 factoren, 0–100, cijfer
   A–F, met een expliciete "te weinig data" state per factor in plaats van een gegokte score). Een
   per-campagnetype-scorecard is een verbijzondering van dit patroon, geen nieuw patroon.
2. **Geen Search-logica hergebruiken voor PMax "omdat de code er staat"** — sectie 5.1 waarschuwt
   hier al expliciet voor bij Meta/LinkedIn, en dezelfde val geldt tussen Search en PMax. PMax
   krijgt een eigen opbouw (feed health, asset health, cannibalisatie met Search — waarvoor
   `lib/cross-channel/funnel-overlap.ts` al bestaat, zie sectie 5.2), geen kopie van de
   Search-scorecard met andere labels.

**Wat dit niet is:** een vervanging van de bestaande kaarten en grafieken. De scorecard is een
nieuwe, bovenliggende laag ("hoe gezond is dit campagnetype") die naar de bestaande detailschermen
doorverwijst, niet andersom.

~~*Klaar wanneer:* een Search-scorecard voor de echte klant toont vijf of meer van de factoren met
een cijfer, niet met een gok~~ — **gedaan.** `lib/search-scorecard.ts`: vijf factoren (Impression
Share, Search Quality, Conversion Efficiency, Auction Pressure, Demand Capture), waarvan drie
Copilot's prompt niet specificeerde welke kolom erachter zat — nagegaan tegen
`ads_campaign_impression_share` en `ads_keyword_performance_monthly`, en waar mogelijk bestaande
functies hergebruikt (`spendWeightedQualityScore` van de Math Gate, `trendOver` van de
Efficiency-factor) in plaats van dezelfde rekensom een derde keer te schrijven. Getoond via
`HealthBadgeView` (met een titel/icoon-parameter, geen tweede kopie van de presentatielaag), op
`GoogleCampagnes` (niet Overzicht — hoort bij "wat draait er", met een campagnetype-kiezer ernaast
in dezelfde pil-stijl als de bestaande kanaalkiezer; PMax/Shopping/Display tonen expliciet dat ze
nog niet gebouwd zijn). Geverifieerd tegen een echte klant (`scripts/verify-search-
scorecard.ts`, alle 5 factoren beoordeeld) en handmatig in de browser tegen de demo-omgeving
(2/5 beoordeeld, de rest eerlijk "—" i.p.v. gegokt — precies het gedrag dat de poort eiste).

~~*PMax-scorecard, klaar wanneer:* vijf factoren, eigen opbouw (geen Search-logica hergebruikt),
draait tegen echte PMax-campagnedata~~ — **gedaan, met een eerlijke kanttekening.**
`lib/pmax-scorecard.ts`: vijf factoren (Asset Health, Feed Health, Netwerkmix-efficiëntie,
Placement-efficiëntie, Cannibalisatie met Search/Shopping), vier ervan een herschaling van
functies die al bestonden voor de PMax-signalen en de assetdekkingskaart
(`analyseerAssetdekking`, `buildNetworkSplit`/`findImbalances`, `aggregateByEntity`) in plaats van
een tweede rekensom. `detecteerCannibalisatie()` losgetrokken uit signaal 7 van
`lib/analysis/pmax-expert-layer.ts` zodat scorecard en SOP-signaal dezelfde vergelijking gebruiken.

Geverifieerd tegen echte klanten (`scripts/verify-pmax-scorecard.ts`) en dat leverde een
bevinding op die niet in de aanname zat: `ads_pmax_asset_performance` en `ads_pmax_placements`
hebben **nul rijen, voor elke klant, altijd** — niet gesynct, ondanks dat `lib/pmax/
assetdekking.ts` en de assetdekkingskaart (`pmax-asset-coverage.tsx`) er al op gebouwd zijn. Alleen
`ads_pmax_network_breakdown` heeft echte data (bevestigd op `gads-4140363870`: 399 rijen, Netwerkmix
scoort 20/20 op een echte, geen gegokte, meting). Cannibalisatie gebruikt hetzelfde venster
(laatste 90 dagen) als het bestaande SOP-signaal en loopt daardoor tegen dezelfde sync-stilstand
aan als sectie 2.1 al beschreef (laatste echte maand april 2026) — vandaag dus bij elke klant
"te weinig maanden". Feed Health is zoals gepland altijd onbeoordeeld (geen Merchant Center-
koppeling). Resultaat: 1 van 5 factoren toont vandaag een echt cijfer, de overige vier tonen
eerlijk "niet beoordeeld" met de reden erbij — geen crash, geen gok, precies regel 3. Zodra de
asset-/placement-sync (opnieuw) gaat schrijven en de sync-stilstand is opgelost, lichten de
overige factoren vanzelf op zonder codewijziging.

PMax staat op de Campagnes-tab naast Search, met dezelfde `CampagneTypeTabs`-kiezer
(`components/dashboard/pmax-scorecard.tsx`). Meta- en LinkedIn-scorecards blijven ongebouwd tot
die kanalen echte data hebben.

### 5.5 Master Synthesis (Pijler 6): kanaaloverstijgende synthese op al-berekende SOP-output

Toegevoegd 16 augustus, buiten deze bouwvolgorde ontstaan (het is Pijler 6 van de zesdelige
monthly-SOP-consolidatie, niet aangevraagd via een fase-poort hierboven) en hier alsnog
vastgelegd omdat sectie 0 dit document bindend maakt voor wat er staat — en dit stond er nog
niet.

**Wat het niet is:** de False Positive Prevention uit sectie 5.2 (betaald-vs-organisch via
Search Console). Dat blijft een apart, open probleem. Master Synthesis werkt met wat er al is:
de per-kanaal monthly-SOP's van Google, Meta en LinkedIn draaien allemaal al (elk hun eigen zes
pijlers, zie de adapter-consolidatie in Fase 3 hierboven) en leveren `sop_recommendations`/
`sop_tasks` op. Master Synthesis leest die output terug, samen met de deterministische
cross-channel-signalen die `app/api/analysis/cross-channel/route.ts` al berekent
(`sop_analysis_output`, sectie `cross_channel_groups_v1`), en laat één LLM-call daar
kanaaloverstijgende hypotheses en sprint-taken uit synthetiseren — een budgetverschuiving tussen
Google en Meta verklaren, niet los per kanaal rapporteren.

**Drie ontwerpkeuzes die de vertrouwensdoctrine (sectie 3) hier dwingt:**

1. **Hard-skip zonder LLM-call bij een lege evidence_payload** — geen kanaaldata en geen
   getriggerde cross-channel-signalen betekent geen aanroep, niet een gegokte synthese. Zelfde
   regel 3 als overal elders.
2. **Schema-validatie met een repair-lus die nooit verslechtert**: `contributing_channels` moet
   binnen de daadwerkelijk aangeleverde kanalen blijven — een hallucinatie van een
   niet-aangeleverd kanaal wordt afgekeurd, ook na de repair-poging als die dezelfde fout
   teruggeeft (`pickBetterAttempt`, gelijke fouten houdt het origineel vast).
3. **Geen halve/foute wachtrij-rijen**: blijft de validatie na de repair-poging alsnog ongeldig,
   dan wordt er niets opgeslagen — wel het resultaat teruggegeven zodat zichtbaar is waarom.

**Opslag:** `sprint_hypotheses` (`source: "master_synthesis"`, status `pending`,
`metadata.contributing_channels`) en `sprint_items` (gekoppeld via `hypothesis_id`, metadata met
`action_type`/`priority`/`frequency`/`due_date_days`), plus `sop_analysis_output` voor de
catalogus-tracking. Migratie 088 gaf beide tabellen de `metadata jsonb`-kolom die dit draagt.

**Geverifieerd, tweevoudig:**
- Eind-to-end-integratietest (`lib/decision/__master_synthesis_integration_test.ts`, 28/28): de
  échte Fase A–C-code tegen een in-memory FakeSupabase, inclusief de hallucinatie- en
  hard-skip-paden.
- Live tegen de productiedatabase: een wegwerpbaar, duidelijk gemarkeerd test-account gezaaid met
  multi-channel SOP-data, de echte `/api/analysis/monthly-decision`-route aangeroepen (echte
  OpenRouter-call, `google/gemini-3.7-flash`), de resulterende `sprint_hypotheses`/
  `sprint_items`-rijen en de `hypothesis_id`-koppeling geverifieerd, en daarna volledig
  opgeruimd. Onderweg bleek `ads_account_monthly`/`meta_account_daily` niet rechtstreeks
  schrijfbaar (view over `fact_core`, niet over `*_legacy` zoals voor de overige zes
  feitentabellen) — geen documentatiefout, `feitentabellen.ts` blijft correct voor waar de sync
  schrijft; de projectie via `refresh_fact_from_legacy()` (migratie 044/054) doet de rest.

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
| **God View Standard** | Markt zien: benchmarks, trends | Vier bureaus met opt-in, segmentdekking boven zestig procent. Alleen geanonimiseerde, gekwalificeerde marktdata (`gv_private_contributions`/`gv_market_signals`) — geen ruwe klantdata. |
| **God View Tactical** | Markt vertalen naar actie | God View Standard levert rijen **én** `agency_memory_events` heeft historie (fase 4). Marktdata alleen wordt generieke dashboardinformatie; leercontext zonder marktdata is een gok over wat markt is versus account. Beide nodig, niet een van beide. |
| **God View Pulse** | Hoogfrequente marktverandering | God View Tactical draait **én** twaalf maanden gevulde marktsignalen **én** playbook-evaluaties/trackrecorddata (fase 4, sectie 3.3) om te zien of een signaaltype nog voorspellende waarde heeft. |
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

**Verduidelijkt 15 augustus, gevalideerd tegen een externe prompt (Copilot):** God View Standard,
Tactical en Pulse zijn geen oplopende reeks waarbij elke laag alleen de vorige nodig heeft. Tactical
en Pulse hebben BEIDE zowel de marktdata (Standard) als het geheugen (`agency_memory_events`, fase
4) nodig — marktdata zonder leercontext is een generiek dashboard, leercontext zonder marktdata kan
"jij" en "de markt" niet uit elkaar houden (sectie 3.1, punt 2). Dat zat al impliciet in loop 3 en 4
(sectie 4), maar stond niet expliciet op modulenveau. Geen van beide tabellen (`gv_*`,
`agency_memory_events`) bestaat vandaag (geverifieerd tegen `information_schema.tables`, 15
augustus) — dit is dus nog puur documentatie, geen schema-wijziging.

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

### Fase 1: de canonieke laag afmaken — **KLAAR** (commits `596dc35`..`6505634`)
**Poort: fase 0 groen.**

- ~~`fact_core` verbreden~~ / ~~`fact_dimension` dezelfde tenantkolommen~~ — gedaan (075/076):
  `agency_id`, `client_id`, `currency`, `leads`, `data_quality_score`, `source_table`, NOT NULL
  waar altijd afleidbaar.
- ~~Projectie uitbreiden~~ — gedaan, maar de kernvondst was groter dan gepland: `fact_dimension`
  had sinds migratie 043 **geen doorlopend onderhoud**, los van de sync-status. Migratie 078
  geeft `refresh_fact_from_legacy()` de negen dimensies uit 043 terug, nu als `on conflict do
  update`. Google week-grain toegevoegd op accountniveau (`ads_account_weekly`). Impression
  share, PMax, producten en ad schedule zijn bewust **niet** meegenomen — expliciete
  productbeslissing voor een latere migratie, niet vergeten.
- Onderweg gevonden en gerepareerd: `refresh_rollups()` (dag naar week/maand) brak op de nieuwe
  NOT NULL-kolommen omdat hij ze niet zette. Migratie 079.
- ~~Batchgewijze backfill met hervatpunt~~ — nodig gebleken op de eerste, ongebatchte poging: die
  vulde de schijf van het toenmalige nano-compute-project en liet de database crashen (WAL kon
  niet meer wegschrijven, 92 seconden crash-recovery, geen dataverlies). Daarna in batches van
  50.000 rijen per verzoek, na een upgrade naar Pro met micro compute.
- ~~`blended_account_monthly` herschrijven op `fact_core`~~ — gedaan (080). Geverifieerd tegen de
  oude view: Google en Meta exact gelijk. LinkedIn-conversies weken af (209 oud, 369 nieuw) — geen
  fout, de oude view telde alleen `external_website_conversions` en miste `one_click_leads`, die
  `fact_core` al sinds migratie 044/050 meetelt als vastgelegde standaard. De nieuwe view is de
  correctere van de twee.
- **Onvoorzien, niet gepland maar wel gebouwd:** een rollende bewaartermijn van twee maanden op
  zoekterm-niveau data (`prune_zoekterm_historie()`, migratie 077), verankerd per klant op diens
  eigen laatste maand. Ontstond uit een schaalgesprek over 10.000 accounts en de disk-crash
  hierboven. Bracht de database van 373 MB naar 178 MB.
- **De UNIQUE op `accounts.client_id` opheffen** — blijft bewust uitgesteld. Herijkt tijdens fase
  1: hij blokkeert niet "Google + Meta voor één klant" (dat werkt al via de los op `client_id`
  gesleutelde `meta_connections`/`linkedin_connections`), alleen twee Google-accounts onder één
  klant. Smaller probleem, groter blast radius (minstens vier plekken met `.maybeSingle()` op
  `accounts.client_id`) dan aanvankelijk gedacht. Apart besluit zodra een klant het nodig heeft.

*Klaar wanneer:* elke bestaande grafiek toont dezelfde cijfers als ervoor, aangetoond met een test
en niet met een steekproef. Gedaan voor Google en Meta (exact gelijk); voor LinkedIn bewust een
ander (correcter) cijfer, hierboven verklaard in plaats van stilzwijgend doorgevoerd.

### Fase 2: analyses waar je op kunt bouwen — **KLAAR** (Search Console bewust buiten scope, zie hieronder)
**Poort: fase 1 groen.**

- ~~Het gedeelde kanaaloutputcontract als TypeScript-type, met validatietests~~ — gedaan.
  `lib/analysis/channel-output-contract.ts`, met een echte mapper voor Google
  (`mapGoogleMonthlyToSharedOutput`). Geverifieerd tegen een echte klant/maand: alle rijen landen,
  niets zoekgeraakt (`scripts/verify-channel-output-contract.ts`).
- ~~Bestaande Google-output erop mappen via een maplaag~~ — gedaan, zie hierboven. De monthly-route
  van 2.913 regels is ongemoeid gebleven.
- ~~**Targetinvoer** voor specialisten, `client_targets` gevuld~~ — gedaan (migratie 082). Bleek
  groter dan gepland: `client_targets` lag al bekabeld maar was functioneel dood (0 rijen) terwijl
  `client_settings.kpi_targets` via een aparte weg de echte analyse dreef voor de 3 klanten die een
  target hadden. `client_targets` is nu de enige bron voor cpa/roas in `monthly/route.ts` en 4 van
  de 7 overige lezers (`bid-strategy`, `budget-allocation`, `biweekly`, `meta-briefing`); 2 lezers
  gebruiken `conversionsAbsolute` (geen client_targets-equivalent, bewust niet aangeraakt), 1
  gebruikt alleen een boolean-vlag. De invoer-UI (bestaande CPA/ROAS-velden in de instellingenpagina)
  schrijft voortaan naar beide bronnen tegelijk.
- **Search Console** koppeling en signalen — **blijft open.** Vergt Google Cloud OAuth-credentials
  van de opdrachtgever; geen codewerk mogelijk zonder die stap.
- ~~De kwaliteitspoorten van shadow mode naar blokkerend~~ — **herzien.** Onderzocht: de negen
  poorten (`lib/decision/quality-gates.ts`) hingen nergens aan de echte, live pijplijn — alleen aan
  een admin-diagnosescherm en een niet-blootgestelde skeleton-route. Shadow mode op de live
  pijplijn bestond dus niet, en "naar blokkerend" had op dat moment niets om van te promoveren.
  Migratie 083 + `monthly/route.ts` roepen de negen poorten nu wél aan, op elke echte run, puur
  observerend (`quality_gate_observations`, fire-and-forget, nooit blokkerend). Geverifieerd tegen
  een echte klant/maand: alle 9 poorten leverden een resultaat op. Daadwerkelijk blokkerend maken
  wacht bewust op een periode aan verzamelde observaties — geen technische blokkade, een
  kalibratievraag.
- ~~`confidence_breakdown` als vijf componenten in het contract~~ — gedaan, deels. Twee van de vijf
  eerlijk gevuld met echte data: `effectSize` uit `sop_insights.change_pct` (2.650 van 3.462 rijen
  gevuld), `sampleSize` via dezelfde `buildCanonicalMetricMap` die de Evidence Gate al gebruikt.
  Drie blijven bewust `null`: `trackingQuality` omdat `fact_core.data_quality_score` op 1.0 staat
  voor alle 9.543 rijen zonder uitzondering (een dode default, geen gemeten signaal -- die tonen
  zou zelf de fake precisie zijn die regel 3 verbiedt), `consistency` omdat er geen multi-maand-
  lezing bestaat, `marketCorroboration` omdat God View leeg is. Geverifieerd tegen twee echte
  klant/maand-combinaties.
- ~~`market_relation_type` met `insufficient_data` als eerlijke standaard~~ — stond al zo in het
  contract vanaf de eerste versie.
- ~~**Campaign Type Intelligence** (per-campagnetype scorecards)~~ — **gedaan voor Search en PMax**,
  zie sectie 5.4. Shopping en Display blijven open (geen aparte campagnetype-data bekeken; PMax
  bleek zelf al twee van zijn vijf factoren zonder echte data te zitten, zie de kanttekening in
  5.4 — de asset-/placement-sync draait al langer niet).

*Klaar wanneer (herzien 15 augustus):* de zes regels uit sectie 3.2 aantoonbaar gehaald voor elk
kanaal dat echte data heeft — vandaag uitsluitend Google Ads, de enige historie die ooit echt
gesynct is. Voor kanalen zonder data (Meta, LinkedIn, GA4, Search Console) is `insufficient_data`
het bewijs dat de poort werkt, niet een teken dat hij dichtblijft: regel 3 van de vertrouwensdoctrine
zegt letterlijk dat dit een eerlijk antwoord is, geen storing.

De oorspronkelijke formulering ("handmatig nagelopen op een echte maand", zonder kanaal te
specificeren) was op dit punt onsluitbaar en is daarom herzien. Meta/LinkedIn/GA4/Search Console
krijgen pas echte data via een klant die ze gebruikt, en die klant komt bewust niet binnen voordat
het product waarmaakt wat het belooft (besluit, herbevestigd 15 augustus) — een cirkel die zichzelf
nooit doorbreekt als de poort alle kanalen tegelijk eist. Zie sectie 12, die dit risico al benoemde
voordat het zich voordeed, en fase 5 hieronder voor wat dit betekent voor "een klant die wil".

### Fase 3: uitvoering en werkvoorraad — **KLAAR (infrastructuur), ontkoppelen van echte SOP's is een aparte, latere beslissing**
**Poort: fase 2 groen.**

- ~~**`llm-router` omzetten naar OpenRouter met meerdere modellen** (besluit 2)~~ — **gedaan**
  (`622ea81`, `7646638`). `callRouted()` draait op echt OpenRouter; ernaast staat nu `callLayer()`
  met een laagroutering (`LAYER_MODEL`: triage/narrative/reasoning) die een model kiest per soort
  werk in plaats van per analysestap. Narrative-aanroepen (bid-strategy, budget-allocation,
  impression-share, period-evaluation, quality-score, rsa-insights, client-reports,
  `runAnalysis`), de search-terms-batches (triage) en monthly step 13 (reasoning, want dat is
  multi-hop-redeneren over stap 1-12) zijn gemigreerd. `callRouted()` blijft bestaan voor
  aanroepers die er nog op steunen — geen brede migratie in dezelfde wijziging als de laag zelf.
- ~~`generation_jobs` uitbreiden tot volwaardige action queue~~ / ~~Claim-logica met
  `FOR UPDATE SKIP LOCKED`~~ / ~~Verwerking via Vercel Scheduled Route~~ — **gedaan, met een
  bewuste scope-beperking.** `generation_jobs` bleek vandaag geen queue maar een SYNCHRONE
  progress-tracker: elke SOP-route (`monthly`/`weekly`/`biweekly`/`second_opinion`/
  `report_generation`/`pdf_generation`) schrijft de jobrij en doet het werk in dezelfde
  HTTP-request; niets pollde ooit op `status = 'queued'` om werk te *starten*. Migratie 004 had
  `attempts`/`scheduled_for`/`triggered_by` al klaarstaan maar ongebruikt.

  Sessiebeslissing: **infrastructuur eerst, ontkoppelen later.** `claim_generation_job()`
  (migratie 089, gefixt in 090) claimt atomisch met `FOR UPDATE SKIP LOCKED` — select en update
  in dezelfde PL/pgSQL-functie, dus dezelfde impliciete transactie. `app/api/cron/
  process-action-queue/route.ts` is de werker (zelfde skelet als
  `evaluate-hypotheses`/`evaluate-code-rood`: fail-closed op `CRON_SECRET`, `?dry_run=true`,
  per-item try/catch), aangesloten op zowel `callLayer()` als `controleerPlafond()`
  (uitgavenplafond) vóór elke verwerking. Retry-beleid is exact 004's kolomcommentaar: `attempts`
  telt mislukkingen, eerste mislukking krijgt 30 minuten backoff, een tweede is definitief
  (`lib/analysis/action-queue.ts`, puur en apart getest).

  Bewust NOG GEEN echt job_type hierlangs: de zes bestaande SOP-routes blijven volledig
  synchroon. Bewezen met het aparte job_type `queue_smoke_test` (migratie 089) — geen consument
  buiten deze route en zijn verificatie. Welk echt job_type ooit ontkoppeld wordt van zijn
  synchrone pad is een aparte beslissing; dat vergt het herschrijven van de aanroepende route zelf
  (nu: job aanmaken + synchroon uitvoeren; straks: job aanmaken + queued laten staan).

  **`vercel.json` bevat bewust GEEN cron-entry voor deze route** — expliciet besluit (16 augustus):
  geen enkele automatische planning tot het product live is. De route zelf is onschadelijk zonder
  planning (geen enkel job_type buiten `queue_smoke_test` heeft een handler, en niets maakt
  `queue_smoke_test`-rijen aan buiten wegwerpbare verificatiescripts), maar dat is geen reden om
  hem al te plannen. Handmatig aanroepen (met `CRON_SECRET`) blijft mogelijk voor verificatie; een
  cron-entry toevoegen is een aparte, expliciete stap zodra dat gewenst is.

  **Twee bugs gevonden via live verificatie tegen productie, allebei gefixt in migratie 090:**
  1. `claim_generation_job` (089) had `returns generation_jobs` (composiet) met `return null` bij
     een lege queue — PL/pgSQL/PostgREST serialiseert dat als een rij-van-nulls, geen JSON null.
     In JavaScript is dat object truthy, dus de stoplogica in de route sloeg nooit aan: een echte
     testrun verwerkte 24 fantoomjobs voordat de eigen veiligheidscap (25) hem stopte. Gefixt met
     `setof generation_jobs` (een echte lege result-set) plus een tweede, onafhankelijke check in
     de route zelf.
  2. **Pre-existing, niet door dit werk veroorzaakt:** `generation_job_events` had nooit een
     unique constraint op `(job_id, phase_key)`, terwijl `lib/progress/server.ts`'s
     `upsertEvent()` daar al sinds het bestaan van het progress-systeem van uitgaat.
     `onConflict:"job_id,phase_key"` faalde daardoor stil (gelogd, nooit doorgegooid) bij elke
     fase-overgang in elke echte SOP-run — de zichtbare voortgangsbalk werkt (aparte, losse
     update), maar de fijnmazige gebeurtenissengeschiedenis is al die tijd niet weggeschreven.
     Migratie 090 voegt de ontbrekende constraint toe (geverifieerd: 1.926 bestaande rijen, nul
     duplicaten op dat paar — veilig additief).

  Geverifieerd tegen productie met wegwerpbare `queue_smoke_test`-rijen: gelijktijdige claims op
  twee rijen leveren gegarandeerd verschillende ids op (geen dubbele claim), een lege queue geeft
  na de fix een echte null, een volledige run (claim → echte `callLayer`-call → `markProgress
  Completed`, inclusief fase-events) slaagt, een kunstmatig laag uitgavenplafond blokkeert de
  verwerking en zet de job terug naar queued zonder een mislukking te boeken, en een bekend maar
  niet-geregistreerd job_type (`pdf_generation`) faalt expliciet in plaats van stil te blijven
  hangen. Alles opgeruimd na de test, geen sporen achtergebleven.

### Fase 4: het geheugen — **KLAAR**
**Poort: fase 3 groen.**

- ~~`agency_memory_events`, append-only, tien eventtypes~~ — **gedaan (migratie 091, gefixt in
  092/093).** De tien eventtypes stonden nergens gespecificeerd — de negentien strategische
  documenten die sectie 0 noemt (waaronder vermoedelijk AGENCY_MEMORY_AND_PLAYBOOK_ENGINE)
  bestaan niet in deze repo — en zijn opnieuw ontworpen tegen wat al bestond:
  `hypothesis_proposed/accepted/rejected/executed/not_executed/outcome_met/outcome_missed/
  unmeasurable/expired` hebben allemaal een echte schrijver; `confidence_recalibrated` (loop 5,
  sectie 4) bewust nog niet — dat vergt een kalibratieberekening die nog niet bestaat.
  Append-only wordt op databaseniveau afgedwongen (triggers, niet alleen een RLS-conventie: de
  app schrijft via de service role, die RLS omzeilt).
- ~~Aansluiten op de bestaande hypothese-evaluatiecron~~ — **gedaan.**
  `evaluate-hypotheses/route.ts`'s `writeVerdict()` schrijft nu ook memory-events, idempotent
  gekoppeld aan dezelfde `.is("evaluated_at", null)`-guard als het verdict zelf.
- ~~Retroactief vullen vanuit de 127 rijen in `sprint_hypotheses`~~ — **gedaan**
  (`scripts/backfill-agency-memory-events.ts`, idempotent, 163 events voor de 127 rijen: 127
  proposed, 31 accepted, 5 rejected, 0 outcome-gerelateerd — de evaluatiecron heeft in productie
  nog niets geëvalueerd, dus dat laatste getal is eerlijk nul, geen bug).
- ~~Negatieve leermomenten expliciet uit `decision_reason`~~ — **gedaan, met een bijvangst-fix.**
  `monthly-hypotheses/route.ts` berekende `decision_reason` via `decideTransition()` maar
  schreef die nooit weg (de reden bleef verstopt in `rationale`'s `rejected_reason`-veld) — nu
  gefixt. De backfill leest voor bestaande rijen daarom beide bronnen.
- ~~**Het trackrecordscherm uit sectie 3.3**~~ — **gedaan.** Nieuwe tab in de Decision Terminal
  (`components/terminal/trackrecord-view.tsx`), gevoed door `/api/insights/trackrecord`.
  Uitsplitsing "waar hadden we het vaakst mis" gebruikt `sprint_hypotheses.source`
  (analysis/second_opinion/search_terms/...) — de fijnste indeling die vandaag echt bestaat;
  sectie 3.3's voorbeeld ("creative fatigue op Meta") suggereert een fijnmaziger categorie die
  nergens als apart veld is vastgelegd, en die verzinnen zou de gok zijn die de
  vertrouwensdoctrine verbiedt.

**Twee bugs gevonden via live verificatie tegen productie, allebei uit dezelfde wortel:**
`hypothesis_id` had `on delete cascade`, en een cascade-delete implementeert Postgres zelf als
een DELETE tegen de kindtabel — die de append-only-trigger net zo hard weigerde als een
handmatige delete. Eerste fix (092): `on delete set null` — een memory-event is een historisch
feit dat niet hoort te verdwijnen omdat de bronrij later wordt opgeruimd. Bleek zelf ook een
UPDATE te zijn (de FK zet het veld intern op null), die dezelfde trigger óók blokkeerde. Tweede
fix (093): de trigger onderscheidt nu expliciet "alleen `hypothesis_id` wordt null, verder
niets" (toegestaan, dat is de FK-machinerie zelf) van elke andere UPDATE (verboden). Beide keren
rolde de transactie netjes terug bij het falen — geen corruptie, alleen een mislukte delete.

*Klaar wanneer:* het trackrecordscherm echte cijfers toont over echte hypotheses. **Gehaald** —
geverifieerd tegen een echt account (`gads-8714777147`): 48 voorgesteld, 8 geaccepteerd, correct
uitgesplitst naar bron. Trefpercentage toont eerlijk `null` zolang de evaluatiecron nog niets
geëvalueerd heeft, in plaats van een gegokt getal. Dit is het moment waarop het product
demonstreerbaar wordt.

### Fase 5: launching customer
**Poort: fase 4 groen, en een klant die wil.**

**"Een klant die wil" (herzien 15 augustus):** een klant op wat het product vandaag aantoonbaar
waarmaakt — de Google Ads-analyse volgens de zes regels uit sectie 3.2 — niet op de volledige
multi-kanaal-visie uit de negentien strategische documenten. Meta/LinkedIn/GA4/Search Console
blijven `insufficient_data` tot ze dat eerlijk niet meer zijn, en dat wordt niet voor de klant
verzwegen: het IS de vertrouwensdoctrine in werking (regel 3, sectie 3.2). Vastgelegd naar
aanleiding van de vraag hoe dit product ooit een eerste klant kan krijgen als elk kanaal eerst
tegen een klant getest moet worden die er nog niet is — dezelfde cirkel als bij de fase-2-poort
hierboven, en met dezelfde oplossing: positioneren op wat bewezen is, eerlijk zijn over wat dat niet
is, in plaats van wachten op een validatie die nooit vanzelf komt.

Geen nieuwe bouw. Draaien, meten, bijstellen. Dit is de fase waar het plan zich bewijst of niet, en
de enige fase waarvan de uitkomst het plan mag wijzigen.

### Fase 6: de markt
**Poort: vier bureaus met opt-in, segmentdekking boven zestig procent.**

- **`app_settings`-klantenlijst uitfaseren voordat het tweede bureau aansluit.** Live incident
  15 augustus: de zijbalk-klantenlijst (`lib/clients.ts` sleutel `api_clients`, `lib/visible-
  clients.ts` sleutel `visible_client_ids`) is één platte, gedeelde `app_settings`-rij zonder
  `agency_id` -- letterlijk dezelfde lijst voor alle gebruikers, van elk bureau. Migratie 087 gaf
  de tabel een policy (`auth.uid() is not null`, was RLS-aan-zonder-policy, zelfde bugvorm als
  `platform_beheerders` in 084/086) zodat de zijbalk vandaag weer werkt met één echt bureau. Dat
  is een noodgreep: zodra bureau twee aansluit, ziet bureau A's gebruiker bureau B's klantnamen
  in zijn menu en omgekeerd, ook al blijft de onderliggende data afgeschermd via RLS op
  `accounts`. Moet voor die tijd vervangen zijn door een zijbalk die rechtstreeks uit `accounts`
  leest via `app_zichtbare_klanten()`, dezelfde bureaugrens die de rest van de app al gebruikt.
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
