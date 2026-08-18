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
| 8 | **Search Console wordt gebouwd.** | **Gedaan (16 augustus, zie 13.3).** Zonder GSC was Demand Intelligence half en False Positive Prevention niet te bewijzen. |
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
| GA4 | Context | Veroorzaakt betaald verkeer downstream gedrag? | **Gebouwd (16 augustus, zie 13.3).** OAuth-koppeling + echte Data API-aanroep + client_settings.ga4_config-kolom staan er; wacht op een bureau dat via Instellingen verbindt en een propertyId invult. |
| Search Console | Context | Verschuift vraag tussen betaald en organisch, of krimpt de vraag zelf? | **Gebouwd (16 augustus, zie 13.3).** Vijf detectoren + de merk-cannibalisatie-beslistabel tegen `isBranded` draaien in `cross-channel/route.ts`; wacht op een bureau dat verbindt en een siteUrl/merktermen invult. |

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
Search Console). Dat blijft een apart, open probleem — uitgewerkt tot een bouwbare detector in
sectie 5.6.2. Master Synthesis werkt met wat er al is:
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

### 5.6 Nieuwe bronnen: het inzichtenplan op papier (16 augustus)

Uitgewerkt op verzoek, tegen de officiële API-documentatie van elk platform (Google Analytics
Data API, Google Search Console, Shopify Admin API, WooCommerce REST API, Microsoft Advertising
API, Bing Webmaster Tools API, TikTok Ads Marketing API, TikTok Shop Partner API) — niet tegen
aannames. Blijft documentatie: geen migratie, geen route, geen code. Live verifiëren kan pas met
echte OAuth-toegang per platform, en die ontbreekt vandaag ("blijft open", zie sectie 6).

**Dit is geen fase-6/7-poort.** Sectie 11 verbiedt bouwen voor een klant die er niet is — maar
deze zes bronnen dienen de klant die er al is, op dezelfde manier als Google/Meta/LinkedIn dat nu
doen. De poort hier is credentials, niet klantaantal. Waar bruikbaar wordt hieronder gebouwd op
wat al vastligt: sectie 5.2's drie False-Positive-Prevention-regels (betaald/organisch/vraag) en
de bestaande GA4-signalenlaag (`lib/ga4/signals.ts`).

#### 5.6.0 Architectuur: drie rollen, geen nieuwe machinerie

Zes bronnen, maar geen zes keer dezelfde vraag "hoe past dit in de pijplijn" — ze vallen in drie
rollen, en de rol bepaalt waar iets landt:

| Rol | Bronnen | Landt als | Voorbeeld dat al bestaat |
|---|---|---|---|
| **A. Verklarende/verificatielaag** | GA4, Search Console, Bing Webmaster Tools | Geen eigen kanaal — annoteert een bestaand betaald kanaal met een aparte, kleinere kanaal-union en een bewijsbasis-label | `Ga4Channel = "google"\|"meta"\|"linkedin"\|"other"` (`lib/ga4/types.ts`), losstaand van `ChannelKey` |
| **B. Betaald kanaal** | Microsoft Ads, TikTok Ads | Een echt nieuw kanaal — synctabel, adapter, opname in `ChannelKey` en `Channel` | `Channel` (`lib/decision/types.ts:36`) heeft `"microsoft"` en `"tiktok_ads"` al gereserveerd, bewust zonder provider |
| **C. Grondwaarheid over omzet** | Shopify, WooCommerce, TikTok Shop | Geen kanaal, geen verklaring van gedrag — een onafhankelijke check op wat een betaald kanaal zelf claimt te hebben opgeleverd | Nieuw patroon; dichtst bijstaand precedent is hoe GSC (rol A) een bestaande heuristiek verifieert, hier toegepast op omzet in plaats van ranking |

Twee dingen die uit deze indeling volgen en die de rest van deze sectie aanhoudt:

1. **Rol A en C breiden `ChannelKey` (`lib/cross-channel/lens-facts.ts:13`, vandaag hardcoded
   `"google_ads"\|"meta_ads"\|"linkedin_ads"`) niet uit.** Alleen rol B doet dat, en pas zodra er
   een synctabel is — exact de reden die `channel-provider.ts:17-21` al geeft voor waarom
   `microsoft`/`tiktok_ads` nog geen provider hebben.
2. **Geen van de zes heeft een nieuwe `SignalCategory` nodig.** De acht bestaande
   (`lib/signals/types.ts:8-16`) dekken alles hieronder: cross-channel-verificatie valt onder
   `cross_channel`, omzetwaarheid onder `conversie_meting`, videocompletion-vermoeidheid onder
   `creative`, Quality-Score-uitsplitsing onder `kwaliteit`. Dat is zelf een signaal dat het
   bestaande frame goed ontworpen is — het is niet gebouwd met deze zes bronnen in gedachten en
   dekt ze toch.

**Hoe een uitkomst verwerkt wordt — geen nieuwe wiring, hergebruik van wat al draait.** Elke
detector hieronder levert `SignalStory`/`DetectionResult` op, exact het frame dat
`lib/ga4/signals.ts` en `lib/cross-channel/funnel-overlap.ts` vandaag al gebruiken. Die stromen
automatisch mee in `groupDefs` (`app/api/analysis/cross-channel/route.ts`) →
`sop_analysis_output`'s `cross_channel_groups_v1` → `lib/decision/evidence/cross-channel-facts.ts`
voor Master Synthesis → de bestaande hypothese-paden → `sprint_hypotheses` →
`agency_memory_events`. Zodra een detector een `SignalStory` teruggeeft is er niets meer te
bedraden — dat is precies waarom deze architectuur zo is opgezet, en waarom het antwoord op "zijn
deze al verweven" voor rol A/B/C hetzelfde is als voor GA4 vandaag: ja, zodra de detector bestaat.

**Concreet: hoe een uitkomst tot een beslissing wordt — de merk-cannibalisatie-casus.** Dit werkt
sectie 5.2's derde regel ("betaald zoekverkeer daalt, alles stabiel: nu pas is het een
accountprobleem") uit tot iets dat ook zonder dalend verkeer al iets zegt, met Search Console als
onafhankelijke bron naast de bestaande `isBranded`-heuristiek in `funnel-overlap.ts`:

| Search Console zegt | `isBranded`-heuristiek zegt | Uitkomst |
|---|---|---|
| Merkterm rankt ≤ positie 1,3, CTR op of boven de eigen baseline, ≥ 90 dagen bewijs (drempels: 5.6.2) | Campagne draait op merktermen | **Bewezen binnen platform.** Beide bronnen zijn het eens; voorstel voor een brand-pause-test als hypothese. |
| Zelfde organische dominantie | Campagne draait NIET op merktermen | **Datakwaliteitssignaal, geen optimalisatieclaim.** De twee bronnen spreken elkaar tegen over wat dezelfde campagne is — dat gaat over campagnenaamgeving controleren, niet over budget verschuiven. |
| Onvoldoende GSC-volume (< drempel) | Campagne draait op merktermen | **Geen wijziging.** Afwezigheid van GSC-bewijs is geen bewijs van afwezigheid; de heuristiek-only-claim blijft op zijn eigen, lagere zekerheid staan — nooit stilzwijgend opgewaardeerd, nooit afgekeurd. |

Dezelfde vorm (bronnen die het eens zijn → hoge zekerheid; bronnen die botsen → datakwaliteit, niet
een claim; te weinig bewijs → geen wijziging) is het sjabloon voor elke rol-A/C-detector hieronder,
niet alleen deze ene casus.

**Eén concrete, bijna-gratis cross-kanaal-join, gevonden tijdens dit onderzoek.** Microsoft
Advertising's "Google Ads Import" (een bestaande, eerste-partij-functie van Microsoft zelf, geen
iets dat Ctrl PPC bouwt) kopieert campagne-/advertentiegroep-/zoekwoordstructuur 1-op-1 van Google
Ads naar Bing Ads, inclusief namen. Bureaus die dat gebruiken (en dat zijn de meeste die Bing
Ads naast Google Ads draaien) geven daarmee gratis een sleutel om Google- en Bing-campagnes op
naam te koppelen — geen fuzzy matching nodig. Dat maakt een "import-drift"-detector (5.6.4)
ongewoon goedkoop te bouwen zodra de Bing-adapter er is.

#### 5.6.1 GA4 — uitbreiding op de bestaande signalenlaag

De vier bestaande detectoren (`lib/ga4/signals.ts`) dekken alleen conversieverschillen. De GA4
Data API (`runReport`) ondersteunt veel meer: acquisitie-nieuw-vs-terugkerend, ecommerce-
funnelstappen, geografie, retentiecohorten, en GA4's eigen geïmporteerde Ads-kosten
(`advertiserAdCost`) — bruikbaar om een kapotte GA4↔Ads-koppeling te detecteren, een ander
faalpatroon dan de bestaande tracking-break-detector (die sessies-versus-key-events bekijkt, niet
de kostenimport zelf).

| Inzicht | Nieuwe velden nodig | Beslissing | Drempel |
|---|---|---|---|
| GA4-vs-platform-conversiekloof | `sessionDefaultChannelGroup` + `keyEvents`, naast al ingelezen platformconversies | Vertrouw je de gerapporteerde CPA van dit kanaal, of zit er een trackingprobleem onder | ≥300 GA4-sessies én ≥12 GA4-key-events, én ≥12 platformconversies, in hetzelfde venster |
| Nieuw vs. terugkerend per kanaal | `newVsReturning` + kanaal | Koopt dit kanaal nieuwe klanten of remarket het naar bestaande | 300-sessiedrempel, apart op de "nieuw"- en "terugkerend"-deelverzameling |
| Ecommerce-funnel-lek per kanaal | bestaande `Ga4Config.funnelSteps`, `eventName`/`eventCount` per stap | Op welke exacte stap lekt een kanaal — mediaprobleem of checkout-UX | ≥12 events op de laatste stap, hogere vloer op stap 1 |
| GA4↔Ads-koppeling-health | `advertiserAdCost` vs. eigen Ads-kosten | Kapotte cost-import onderscheiden van een echte prestatiedaling | Alleen relevant met recente Ads-spend en een actieve GA4↔Ads-koppeling; anders `insufficient_data` |
| Kanaal×device-matrix | geen nieuw veld — fijnere uitsplitsing van wat al opgehaald wordt | Vangt bv. Meta-mobiel dat onderpresteert terwijl blended mobiel er gezond uitziet | 300-sessiedrempel per cel — zal bij kleinere accounts vaak `insufficient_data` geven, en dat is correct |
| Retentiecohorten per kanaal | `cohortSpec`/`cohortActiveUsers` | LTV-bewuste budgetallocatie | Alleen realistisch bij grotere accounts (cohorten worden snel te dun) |

**Eerlijke grenzen.** GA4-UI-only "Explorations" (padanalyse, segment-overlap, cohort-Venn's) zijn
niet via `runReport` op te halen — dat vergt BigQuery-export (event-level, optioneel, gratis tot
~1M events/dag), een latere, apart te gaten uitbreiding, geen dag-1-feature. Bij grote
propertyvolumes kan GA4 zelf gaan samplen (`samplingMetadatas` in de response); elke detector moet
dat checken en het label meegeven — een gesamplede GA4-claim die zich voordoet als exact breekt
zonder dat expliciet de vertrouwensdoctrine.

#### 5.6.2 Search Console — verifieert een bestaande gok, werkt sectie 5.2 uit

De sterkste vondst van dit hele onderzoek. `funnel-overlap.ts`'s `isBranded` is vandaag een gok
op campagnenaamgeving; Search Console geeft een onafhankelijk, query-niveau signaal — rankt dit
merkzoekwoord al #1 organisch met hoge CTR terwijl er ook op betaald wordt geboden. De decision
tree in 5.6.0 legt vast hoe de twee bronnen samen tot een uitkomst komen; hier de rest van de
bouwbare inzichten.

| Inzicht | Velden | Beslissing | Drempel |
|---|---|---|---|
| **Merk-cannibalisatie** (5.6.0) | `query` (regex tegen een expliciete, door het bureau vastgelegde merktermenlijst — nooit afgeleid uit Ads-data, anders is het dezelfde gok verplaatst), `clicks`/`impressions`/`ctr`/`position`, `dataState=final` | Brand-pause-test voorstellen | ≥1.000 impressies over 90 dagen, aanwezig in ≥8 van de laatste 12 weekbuckets |
| Eigen-baseline CTR-anomalie | `query`/`page` gebucket op positie, 90-180 dagen | Titel/meta-rewrite-kandidaat — nooit tegen een generieke CTR-tabel, altijd tegen de eigen site-curve | ≥30 rijen per positiebucket voor de baseline, ≥500 impressies voor een individuele flag |
| Positie-drop-alert | `page`/`query` + `date`, trailing 7d/28d vs. voorgaand venster | Proactief klantsignaal vóór het als omzetdaling binnenkomt | Baseline-venster ≥1.000 impressies, drop ≥3 posities of paginaverschuiving, aangehouden in zowel 7d als 28d |
| Niet-merk-overlap | non-branded `query`+`page`, gejoined tegen bestaande Ads-zoektermdata | Budget verschuiven waar organisch al sterk staat, of net andersom | ≥100 impressies/90d, ≥1.000 voor een CTR-claim |
| Nieuwe/stijgende zoektermen | `query`, laatste 28d vs. voorgaand venster | Kandidatenlijst voor nieuwe advertentiegroepen | ≥50 impressies + ≥5 clicks, afwezig in de baseline |

**Eerlijke grenzen.** Search Console anonimiseert laagvolume zoekwoorden — querytotalen tellen
structureel niet op tot paginatotalen, geen bug maar een privacymaatregel van Google zelf, en
elke detector moet die kloof als verwacht behandelen. Data komt met 2-3 dagen vertraging; de
laatste dagen tellen niet mee (`dataState=final`).

#### 5.6.3 Ecommerce: Shopify en WooCommerce, twee aparte connectors

Grootste opbrengst, maar de sessie-eerlijkheid geldt hier het hardst: dit is geen signaallaag
boven een bestaande sync zoals GA4/GSC, maar een nieuw datadomein (orders, klanten, refunds) dat
vandaag nergens bestaat, ook niet als kale kolom. En het zijn structureel **twee** connectors, niet
één bullet: Shopify is een gehost platform met OAuth-app-install en een uniform GraphQL-schema
(REST is per 1 april 2025 gesloten voor nieuwe apps — dit moet GraphQL-only); WooCommerce is
zelf-gehost met handmatig uitgewisselde API-sleutels (geen OAuth-consent-scherm) en een schema
waarvan de VORM per klant verschilt — of attributiedata bestaat hangt af van of de winkel
WooCommerce ≥8.5 draait met Order Attribution aan, of een los trackingplugin gebruikt, of niets.

| Inzicht | Velden | Beslissing | Drempel |
|---|---|---|---|
| Refund-gecorrigeerde echte ROAS | `Order.totalPriceSet` + `Refund` (Shopify); order total + `refunds[]` (Woo), gejoined via UTM/kortingscode | Budget weg van kanalen wier ROAS materieel zakt zodra refunds meegeteld worden | ≥30 orders én ≥5 refund-events per kanaal; orders jonger dan de winkel se typische refundtermijn (14-30d) uitsluiten |
| Ad-platform-conversiereconciliatie | ordertotaal per transactie-id vs. platform-gerapporteerde conversiewaarde (GA4 draagt `transaction_id` al) | Vangt kapotte/dubbele/verkeerde-valuta trackingconfiguratie | ≥20 gematchte orders — laag, want dit is een integriteitscheck, geen trendclaim |
| Nieuw-vs-terugkerende-klantwaarde per kanaal | Shopify `Customer.numberOfOrders` (lifetime); Woo `orders_count` gededupliceerd op factuur-e-mail (guest checkout heeft `customer_id=0`) | Ontmaskert een kanaal met "goede ROAS" dat vooral bestaande klanten heractiveert | ≥30 orders per kanaal; volledige historie nodig om cold-start-vertekening te vermijden |
| Kortingscode-lekkage per kanaal | `discountApplications`/`coupon_lines`, gejoined per kanaal, storewide codes uitgesloten | Marge-erosie boven wat het platform se eigen ROAS toont | ≥30 orders per kanaal met kortingsdata |
| Product-niveau-mismatch | `LineItem` per kanaal vs. catalogusbrede omzetmix | Budget geconcentreerd op SKU's die ads niet verkopen, of andersom | ≥15-20 orders per SKU-kanaal-paar |

**Eerlijke grenzen — expliciet, niet verzwegen.** Marge-bewuste ROAS is meestal niet bouwbaar:
Shopify's `unitCost` is optioneel en vaak leeg (vooral dropshipping/POD), WooCommerce heeft
**geen** kernveld hiervoor, alleen losse plugins met elk hun eigen schema. Dit hoort achter een
dekkingscheck (bv. ≥80% van de omzet heeft een kostprijs) met `insufficient_data` als default,
niet als vlaggenschipfunctie. Shopify's `read_orders`-scope levert standaard maar 60 dagen
historie; volledige historie vergt de door Shopify apart goed te keuren `read_all_orders`-scope —
niet aannemen dat een eerste koppeling meteen alle historie geeft. Voorraadrisico-detectie
("product X raakt over 4 dagen op terwijl het geadverteerd wordt") is voor de helft eerlijk
bouwbaar (uitverkooptempo uit orderdata, wél deterministisch) en voor de helft niet: geen enkele
API koppelt automatisch welke campagne welke SKU adverteert — dat vergt een handmatige
campagne-naar-SKU-koppeling van het bureau, en de gecombineerde claim mag pas verschijnen als die
koppeling er is.

#### 5.6.4 Microsoft Advertising (Bing Ads) + Bing Webmaster Tools

`Channel` (`lib/decision/types.ts:36`) heeft `"microsoft"` al gereserveerd. Microsoft Advertising
API v13/REST spiegelt Google Ads structureel (campagne→advertentiegroep→zoekwoord→advertentie,
plus een los Reporting-endpoint) — de bestaande adapter-vorm is dus grotendeels herbruikbaar, niet
een nieuw patroon. Twee dingen zijn beter dan bij Google: de Quality-Score-subcomponenten
(verwachte CTR, advertentierelevantie, landingspagina-ervaring) komen los terug in plaats van
alleen het totaal, en de rapportagehistorie gaat 36 maanden terug tegen een genereuze, expliciet
gedocumenteerde limiet (40 req/sec, 60.000/min, 20 miljoen/dag).

| Inzicht | Velden | Beslissing | Drempel |
|---|---|---|---|
| Quality-Score-uitsplitsing | `QualityScore`, `ExpCtr`, `AdRelevance`, `LandingPageExperience` | Optimalisatie-inspanning routeren naar advertentietekst, landingspagina of bod | ≥100 impressies/zoekwoord over 30d, stabiel ≥7d |
| Zoekterm-mining (negatieven) | `SearchQueryPerformanceReport` | Negatieve zoekwoorden toevoegen | ≥20 clicks of ≥€50 spend, 0 conversies, 60d venster (ruimer dan Google — lager volume) |
| **Import-drift** (5.6.0) | Zoekwoordtekst gematcht tussen Google Ads en Bing Ads (bijna gratis dankzij Microsoft se eigen "Google Ads Import") | Signaleert wanneer een terugkerende import handmatig getunede Bing-biedingen overschrijft, of wanneer de twee platforms structureel uit elkaar zijn gegroeid | ≥80% zoekwoordtekst-overlap geldt als "geïmporteerd paar", ≥14 dagen prestatie na import op beide kanten |
| Device-mix-mismatch | Ad Performance Report per device | Vlagt niet-triviale mobiele biedaanpassingen als vermoedelijke Google-first-overblijfselen | ≥30d, ≥100 impressies per device-segment |

**Search Console-equivalent bestaat, maar is dunner — en de eerlijke uitkomst is een lagere
drempel, niet een geschrapt idee.** Bing Webmaster Tools API heeft geen vrije datumrange
(`GetQueryStats` geeft een vast ~6-maands blok, geen `startDate`/`endDate`) en Bing se
zoekaandeel ligt rond 4-9% van Google's — bij Search Console se eigen drempel (≥1.000 impressies/
90d) zou een Bing-merkterm typisch op 50-150 impressies uitkomen, ruim onder de lat. De
merk-cannibalisatie-detector uit 5.6.2 wordt daarom voor Bing een lagere-zekerheid-variant, niet
weggelaten: **≥150 impressies/90d, aanwezig in ≥6 van de laatste 12 weekbuckets**, en expliciet
gepositioneerd als iets dat bij de meeste MKB-klanten eerlijk op `insufficient_data` blijft staan
— dat is de vertrouwensdoctrine die doet wat hij moet doen, geen tekortkoming.

#### 5.6.5 TikTok Ads + TikTok Shop

`Channel` heeft ook `"tiktok_ads"` én, apart, `"tiktok_shop"` al gereserveerd — terecht apart:
TikTok Ads (`business-api.tiktok.com`) en TikTok Shop (`partner.tiktokshop.com`) zijn twee
volledig gescheiden developer-oppervlakken met eigen app-registratie en eigen goedkeuring.
**Rekenbudget: dit is niet een integratie van dezelfde dag.** TikTok se app-review is het
zwaarst-gepoorte van de grote advertentie-API's — reken op 3-7 dagen, langer voor
productievolume-toegang met een businessverificatie erbij.

Video is een eersteklas, servergeleverde metriek (kwartiel-completion p25/50/75/100, 2s/6s
watched) — geen proxy zoals Meta's hold-rate, die zelf al schat vanuit `1s-plays`/impressies. De
bestaande Meta-vermoeidheidsdetector (FTIR: vermoeidheid vs. verzadiging via
frequentie-versus-eerste-impressie) is als VORM herbruikbaar maar niet als formule: TikTok se
algoritmische feed-distributie maakt frequentie geen functie van budget/doelgroepgrootte zoals bij
Meta se forced-delivery, dus de onderliggende drempel moet op completion-rate-verval gebouwd
worden, niet op hold-rate.

| Inzicht | Velden | Beslissing | Drempel |
|---|---|---|---|
| Completion-rate-verval (vermoeidheid) | `video_views_p100`, `video_play_actions`, per advertentie over tijd | Creative-refresh-advies | ≥7 dagen, ≥1.000 video-plays/advertentie |
| 2s-vs-6s-hook-drop | `video_watched_2s`, `video_watched_6s` | Onderscheidt een slechte hook van een slechte opbouw halverwege — een signaaltype dat Meta niet kan leveren (geen sub-3-seconden-checkpoints) | ≥500 plays |
| Bereik-verzadiging-vs-vermoeidheid (TikTok-variant van FTIR) | `reach`, `frequency`, `video_views_p100` over tijd | Onderscheidt "algoritme heeft geen nieuw publiek meer" van "hetzelfde publiek haakt af" | ≥14 dagen dagelijkse reach+frequency |
| Placement-verspilling (TikTok vs. Pangle) | `placement`, spend, conversies, CPA | Pangle uitsluiten waar CPA materieel slechter is — geen in-familie-surface zoals Meta se Audience Network, dus drempels opnieuw ijken, niet overnemen | ≥100 conversies verdeeld over placements |
| **GMV Max organische-contaminatie-vlag** (TikTok Shop) | GMV Max-geattribueerde orders vs. Shop-ordertotalen voor dezelfde SKU's | Waarschuwt dat een gerapporteerde GMV Max-ROAS organische orders meetelt (TikTok se eigen attributieregel, geen bug) — een claim die een kanttekening nodig heeft, geen volle paid-attributiezekerheid | Vergt zowel Marketing-API- als Shop-Partner-API-toegang; tot beide er zijn blijft dit bewust `insufficient_data`, geen geschat cijfer |

**Eerlijke grenzen.** Spark Ads (advertenties op boosted organische content) hebben geen
bevestigd, eenduidig booleanveld in de standaard Reporting API dat "dit is boosted organisch"
zegt — elke Spark-inzicht zou identiteits-/autorisatiemetadata op advertentiegroepniveau moeten
joinen, niet zomaar uit reportingdata te lezen. TikTok se standaard attributievenster (7d klik/1d
view, GMV Max 1d klik) is korter dan wat de bestaande Meta-adapter aanhoudt — elke nieuwe
`insufficient_data`-drempel voor TikTok moet daarom krapper staan, niet hetzelfde Meta-getal
hergebruiken.

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
| **Demand Flow Intelligence** | Welk kanaal creeert vraag, welk kanaal oogst | GA4-koppeling gemodelleerd én gebouwd (16 augustus); funnelrolclassificatie gerepareerd |
| **Demand Intelligence** | Vraag, SEO, betaald of markt als oorzaak | **Search Console gebouwd (16 augustus).** Wacht op een bureau dat verbindt — zie 13.3. |
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

### Fase 2: analyses waar je op kunt bouwen — **KLAAR** (Search Console inmiddels ook, zie hieronder)
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
- ~~**Search Console** koppeling en signalen~~ — **gedaan (16 augustus), zie sectie 13.3.** Deze
  regel zei eerder "geen codewerk mogelijk zonder OAuth-credentials van de opdrachtgever" — dat
  bleek niet te kloppen. Vrijwel alles was zonder live credentials te bouwen en te testen (de vijf
  detectoren, de API-client, de config-laag, de beslistabel tegen `isBranded`); alleen de
  daadwerkelijke `runReport`/`searchAnalytics.query`-aanroep zelf wacht op een bureau dat via
  Instellingen verbindt. Dezelfde correctie gold voor GA4 (sectie 13.3).
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
  multi-hop-redeneren over stap 1-12) zijn gemigreerd. Een vierde laag, `strategic`, is er
  sindsdien bijgekomen (`lib/analysis/llm-router.ts:112-124`), niet apart bijgehouden in dit
  document tot de statusaudit van 17 augustus (sectie 14.6) dat corrigeerde — zie daar voor het
  volledige model-per-laag-overzicht en de volledige uitleg staat in `docs/
  ARCHITECTURE-MODEL-ROUTING.md`, geverifieerd tegen de live OpenRouter-catalogus. `callRouted()`
  blijft bestaan voor
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

**Het datamodel, uitgewerkt op papier (16 augustus).** Op verzoek verder uitgewerkt zodat het bij
de eerste opt-ins direct om te zetten is naar migraties. Dit blijft documentatie — er is vandaag
geen rij, geen tabel, geen schema-wijziging, en niets hieronder wordt gebouwd voordat deze poort
opengaat (sectie 11: "geen module die gebouwd wordt voor een klant die er niet is").

De keten heeft vier stappen, bewust in aparte tabellen omdat elke stap een ander toegangsniveau
heeft:

1. **`gv_source_qualification`** — per (account, periode): mag deze rij überhaupt meedoen. Dit is
   een poortbeslissing, geen aggregatie, en hij staat apart van `agencies.benchmark_optin_at`
   (migratie 064, al gebouwd) omdat toestemming op bureauniveau iets anders is dan "heeft dit
   account voor deze periode canonieke feiten die volledig genoeg zijn om mee te tellen" — een
   bureau kan toestemming geven terwijl een specifiek account die maand `insufficient_data` staat
   (regel 3, sectie 3.2). Voorgestelde velden: `agency_id`, `client_id`, `channel`, `period`
   (maand), `bedrijfsmodel` en `niche` (uit `client_settings`, op het moment van kwalificeren
   gekopieerd, niet live gejoined — een niche die later verandert mag een oude periode niet met
   terugwerkende kracht herschrijven), `gekwalificeerd boolean`, `reden` (tekst, waarom niet als
   dat zo is). Gevuld door een periodieke job die over `client_settings` × `fact_core` loopt, geen
   gebruikersactie.
2. **`gv_private_contributions`**, service-role only, geen policy — de rij per gekwalificeerd
   account per periode met de eigen cijfers erin (de metrieken die de benchmark meet). Dit is de
   enige tabel in de keten waar een individueel bureau zijn eigen getal in herkent, en dat is
   precies waarom hij nul policies krijgt: geen enkele gebruiker, ook niet de eigenaar van de rij,
   leest hem rechtstreeks. Alleen de aggregatiejob (service role) leest hem om `gv_market_signals`
   te bouwen. Zonder deze scheiding is "geanonimiseerd" een claim in plaats van een eigenschap van
   het systeem.
3. **`gv_market_signals`**, een tabel met `period_type` — de uitkomst van `celoverzicht()`
   (`lib/benchmark/cel.ts`, al gebouwd en getest, puur) toegepast op `gv_private_contributions`:
   per `Celsleutel` (channel, model, niche) de samengevatte cijfers, maar alleen als
   `beoordeelCel()` `deelbaar: true` teruggeeft. Een cel die de drempel niet haalt krijgt geen rij
   — geen rij met nullen, gewoon afwezig, zodat "geen data" nooit met "slecht scorend" te
   verwarren is. `period_type` (week/maand/kwartaal) omdat God View Pulse (sectie 7) een hogere
   cadans nodig heeft dan Standard. Dit is de enige tabel die God View Standard rendert.
4. **`ctrl_intersection_context`** — geen marktdata, maar de brug tussen één klantaccount en de
   cel waar het in valt: per (account, periode) een verwijzing naar de van toepassing zijnde
   `gv_market_signals`-rij, plus het eigen cijfer ernaast (uit `fact_core`, niet gedupliceerd uit
   `gv_private_contributions` — twee plekken met hetzelfde getal is twee plekken die uit elkaar
   kunnen lopen). Dit is wat sectie 10.1's "markt of jij"-demo en God View Tactical rechtstreeks
   zouden lezen: één rij, geen live join over drie tabellen bij elke paginalaad.

De volgorde waarin dit gebouwd zou worden als de poort opengaat: 1 en 2 kunnen zodra bureau twee
is aangesloten (ze hebben geen vier bureaus nodig, alleen een tweede bron om te bewijzen dat de
kwalificatie- en scheidingslogica standhoudt met echte, verschillende data). 3 kan pas rijen
opleveren zodra `MIN_BUREAUS` (vier) en `MIN_ACCOUNTS` (tien) gehaald zijn — dat is letterlijk de
poort. 4 volgt op 3, per klant, in dezelfde cadans als 1.

**Agency twee: het onboardingplan (16 augustus).** Fase 6 vraagt om vier bureaus met opt-in; dat
begint bij één, en de volgorde daarvan is waar de fouten zitten:

1. **De `app_settings`-klantenlijst moet vervangen zijn vóórdat bureau twee een account aanmaakt**
   — niet erna. De noodgreep uit migratie 087 werkt met één bureau per ongeluk goed (er is niemand
   om mee te verwarren); zodra er een tweede is, ziet elk bureau in de zijbalk het complete
   klantmenu van het andere. Dit is daarom de eerste stap van agency twee, niet een los werkpunt
   dat "ooit voor fase 6" moet gebeuren.
2. **OAuth voor bureau twee's eigen Google-account, end-to-end, met een echt tweede account** —
   niet een tweede rij onder het eerste bureau's MCC. Dit is het eerste échte gebruik van
   `agency_connections` (migratie 062, nul rijen vandaag) en van de vault-functies (migratie 063);
   tot dan is die code ongebruikt in productie en kan hij subtiel stuk zijn zonder dat het opvalt.
3. **RLS-bureaugrens narekenen, niet aannemen.** Sectie 2.3 en de migraties 057-059 leggen de
   bureaugrens vast op basis van één bureau se data; met een tweede bureau moet bevestigd worden
   dat niemand van bureau A een rij van bureau B kan lezen, over alle tabellen, niet alleen
   `accounts`. Zelfde discipline als dit hele traject al gebruikte voor elke nieuwe migratie: een
   wegwerpbaar `zztest-`-verificatiescript tegen productie, met een echte tweede `agency_id`, dat
   expliciet probeert een grens te overtreden en verwacht dat het faalt.
4. **`gv_source_qualification` en `gv_private_contributions` (hierboven) kunnen zodra agency
   twee's eerste klant meedoet**, zodat de scheiding tussen "eigen data" en "marktbijdrage" met
   twee echte bronnen getest is voordat een derde en vierde bureau volgen. Niet nodig om agency
   twee te laten draaien, wel de goedkoopste manier om de God View-keten te bewijzen zonder op
   vier bureaus te wachten.
5. **Geen `gv_market_signals`-rijen tot bureau vier.** Punt 4 vult tabellen die niets naar buiten
   brengen; met twee of drie bureaus faalt elke cel op `MIN_BUREAUS` (vier) en dat hóórt zo —
   `beoordeelCel()` bestaat juist om dat af te dwingen, niet om na drie bureaus alsnog "even te
   kijken hoe het eruitziet."

### Fase 7: de betaalde modules
**Poort: module verkocht.**

- AI Council met harde rondelimiet en kostenplafond per review
- Proof Engine op het patroon van `second_opinion_runs`
- `ctrl_agency_identity` uit het geheugen
- `gv_market_patterns` na twaalf maanden gevulde signalen

**Uitgewerkt op papier (16 augustus).** Zelfde regel als bij fase 6: dit legt de vorm vast, niet
de prijs of de limiet zelf. `lib/analysis/credit-costs.ts` laat precies zien waarom dat
onderscheid ertoe doet — `CREDIT_COSTS` staat daar al sinds migratie 070 leeg, met de reden in het
bestand zelf: een verzonnen getal zou "straks als een afgesproken prijs ogen terwijl niemand hem
heeft vastgesteld." Diezelfde tucht geldt hier.

- **AI Council: rondelimiet en kostenplafond.** Het mechanisme bestaat al twee keer in dit
  product, alleen nog niet samengevoegd voor dit doel: `lib/analysis/uitgavenplafond.ts`'s
  `controleerPlafond()` (per-bureau EUR-plafond, zacht bij 80%, hard bij 100% — hetzelfde patroon
  dat fase 3's `process-action-queue`-route al aanroept vóór elke verwerking) en
  `lib/analysis/llm-router.ts`'s `callLayer()` met zijn kostenschatting per laag. Een AI
  Council-review zou een reeks `callLayer("reasoning" | "strategic", ...)`-aanroepen zijn die
  elkaar uitdagen; de rondelimiet is dan een simpele teller die stopt bij een nog te bepalen
  maximum, het kostenplafond is dezelfde `controleerPlafond()`-aanroep die fase 3 al gebruikt,
  toegepast per review in plaats van per queue-run. Het getal zelf — hoeveel rondes, hoeveel euro
  — is een productbeslissing die wacht op een verkochte module, geen technisch detail.
- **Proof Engine op het patroon van `second_opinion_runs`.** Een Second Opinion-run (draait al,
  RLS via migratie 065) legt per run een probleem, het bewijs en een oordeel vast. Proof Engine
  zou dezelfde vorm toepassen op verkoop: een prospect noemt een probleem, en de engine zoekt in
  `agency_memory_events` naar `hypothesis_outcome_met`-rijen met een vergelijkbare `reason` — niet
  om een gegarandeerde uitkomst te beloven, maar om te laten zien wat er bij vergelijkbare
  problemen eerder daadwerkelijk gebeurd is. Vandaar de eis van zes maanden historie (sectie 7's
  tabel): minder dan dat is te weinig om "vergelijkbaar" nog eerlijk te kunnen zeggen. Geen nieuwe
  tabel — een leesfunctie boven wat fase 4 al schrijft.
- **`ctrl_agency_identity` uit het geheugen.** Geen los formulier waar een bureau zichzelf
  beschrijft — dat is een claim, geen bewijs, en deze architectuur is gebouwd om dat verschil
  serieus te nemen (sectie 3, de vertrouwensdoctrine). In plaats daarvan een periodieke
  samenvatting, berekend over de `agency_memory_events` van dat ene bureau: welke `source`
  (sectie 3.3) het vaakst een geaccepteerde hypothese oplevert, welk kanaal het vaakst een
  `outcome_met` haalt, waar `hypothesis_rejected` clustert. Een profiel dat het bureau over
  zichzelf ontdekt in plaats van intypt — en precies de reden dat deze module ná fase 4 staat en
  niet ervoor: zonder geheugen is er niets om samen te vatten.
- **`gv_market_patterns` na twaalf maanden gevulde signalen.** Bouwt op `gv_market_signals`
  (fase 6) zoals `ctrl_agency_identity` bouwt op `agency_memory_events`: geen nieuwe databron, een
  trendberekening over periodes van een tabel die al bestaat. Twaalf maanden is geen ronde
  marketingclaim maar het minimum om een seizoenspatroon van een eenmalige uitschieter te kunnen
  onderscheiden — een cel met acht maanden data kan een zomerdip niet van een structurele daling
  onderscheiden. Dezelfde `Celsleutel`-indeling als `gv_market_signals`; de nieuwe as is de tijd,
  niet het segment.

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
- **Geen BI-API/webhook-exports als standaard tier-inclusie.** Herhaaldelijk door de eigenaar
  bevestigd (laatst 16 augustus 2026): dit wordt nooit een standaardfeature van een tier, alleen
  op aanvraag en alleen als het genoeg oplevert. Staat op de Enterprise-regel in
  `lib/marketing/tiers.ts` als "available on request... not a standard inclusion" — dat is de
  vergrendelde tekst, geen tussenstap naar een standaard rollout.

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

---

## 13. Implementatieplan: coming-soon-correcties en het mobile/huisstijl-traject (16 augustus)

Geen fase-poort — dit werk dient de klant die er al is, niet een klant die er nog niet is, en heeft
geen credential-afhankelijkheid. Het is puur ingepland werk, in twee delen.

### 13.1 Marketing-copy-correcties

Een audit van elke `gebouwd`-vlag op de marketing site tegen wat deze sessie live tegen de
database en de codebase heeft vastgesteld, leverde twee echte overclaims op — dingen die als
`gebouwd: true` stonden terwijl een klant ze vandaag niet kan gebruiken. Beide gecorrigeerd:

- **`lib/marketing/tiers.ts` (Foundation-tier) en `app/(marketing)/how-it-works/page.tsx`**:
  "Microsoft Ads" stond gebundeld met Google/Meta/LinkedIn op `gebouwd: true`, terwijl
  `channel-provider.ts` zelf zegt dat er geen synctabel en geen rij voor bestaat — en de
  kanalenbalk (`trust-banner.tsx`) op dezelfde site "Bing Ads" al correct als niet-gebouwd toonde.
  Losgetrokken in een eigen regel, `gebouwd: false`.
- **`lib/marketing/tiers.ts` (Core-tier)**: "GA4 integration" stond op `gebouwd: true` op grond van
  "de code bestaat" (`lib/ga4/`), niet op grond van "een klant krijgt hier live data uit" — en dat
  laatste is precies de maatstaf die sectie 7 van dit document zelf stelt. Live geverifieerd
  tijdens sectie 5.6's onderzoek: `fetchGa4Dataset` geeft voor een echt account altijd `"absent"`
  terug, en `client_settings.ga4_config` bestaat niet eens in productie. Gezet op `gebouwd: false`.

**Bewust NIET gewijzigd, na verificatie:** de Whitelabel Portal-module (`whitelabel_actief`
blijkt echt gewired — admin-toggle, instellingenscherm, sidebar-logo-swap draaien allemaal echt,
zie `app/api/admin/whitelabel/route.ts` en `components/layout/sidebar-logo.tsx`) en Volume
Compute (`credit-costs.ts`'s eigen redenering — de infrastructuur blokkeert echt, alleen de prijs
per analyse is nog een open beslissing — is een verdedigbaar standpunt, geen overclaim, en is niet
opnieuw opengetrokken zonder sterker bewijs dan er nu is).

**BI-API/webhook-exports blijft expliciet op "alleen op aanvraag" staan** (sectie 11) — geen
onderdeel van dit of enig ander implementatieplan als standaardfeature, ongeacht welke tier.

### 13.2 Mobile-friendly en huisstijl-eenmaking

**Bevinding, tegen de code onderzocht, niet aangenomen:** marketing en dashboard delen één
`app/globals.css` maar gebruiken hem als twee losse woordenboeken die elkaar nul keer raken —
marketing's `midnight-slate`/`off-white`/`neon-indigo`-tokens plus Plus Jakarta Sans staan naast
het dashboard se `rm-blue`/`rm-gray`/`text-micro`-t/m-`text-hero`-schaal plus Ubuntu, met vier
bestanden aan onbedoelde overlap. Het dashboard is bovendien architecturaal desktop-only: een
vaste, niet-inklapbare `w-72`-sidebar die alle content permanent met `ml-72` opzijschuift, nergens
een mobiele navigatie, en maar 40% van de bestanden met ook maar één responsive Tailwind-prefix
(tegen 62% op marketing). Marketing heeft wél al een gedateerde, gemeten mobiele audit
(12 augustus, `tier-grid.tsx`/`mobile-nav.tsx`) — de "toonaangevend"-status is dus geen indruk maar
een feit. Omvang: ~113 dashboardbestanden in de plausibele scope tegen ~34 marketingbestanden,
waarvan het merendeel al klaar is.

**Richting gekozen (16 augustus):** marketing's identiteit wordt leidend. Het dashboard neemt het
`midnight-slate`/`off-white`/`neon-indigo`-palet en Plus Jakarta Sans over, niet andersom.

**Fase 1 — gedaan.** Expliciete `viewport`-export in `app/layout.tsx` (`app/layout.tsx`, deze
sessie). Kostte niets, geen risico, onafhankelijk van de rest.

**Fase 2 — gedaan, twee rondes.** De pilot (op `/settings`, lokaal, niet gecommit) bevestigde snel
dat losse componentklassen ombouwen fout is: één donker kaartje op een verder lichte pagina oogt
als een fout, geen huisstijl. De echte hefboom bleek één punt: de `--brand-primary`/
`--brand-accent`-fallback in `app/globals.css`, waar élk bestaand gebruik van `rm-blue`/`rm-orange`
al naar wijst (zijbalk, koppen, knoppen, actieve staten) — whitelabel per bureau overschrijft
dezelfde variabelen en bleef dus ongewijzigd werken. Eerste ronde verving alleen de TINT
(`#08288C`/`#F16B37` → `#4f46e5`/`#f5960b`, contrastveilig op wit, marketing's letterlijke
`#818cf8` is daar te licht voor). Live review daarna: de sidebar-vulling bleef een EFFEN
merkkleurvlak, en dat was het echte probleem, niet de tint. Tweede ronde: een apart
`--sidebar-panel`-token (alleen op de twee `<aside>`-elementen, niet op de ~50 knoppen/badges
elders die de effen kleur wél moeten houden) — 26% merkkleur gemengd in `#121820`
(`midnight-slate`), marketing's eigen "bijna-zwart met een accent erdoorheen" in plaats van een
blok in de huisstijlkleur. `lib/branding/theme.ts`'s `DEFAULT_THEME` (de JS-mirror die
`BrandThemeProvider` gebruikt zonder brand guide) en twee losse `var(--brand-primary, ...)`-
fallbacks (`sparkline.tsx`, `data-table.tsx`) meeverhuisd, anders herintroduceren die het oude
blauw op specifieke plekken. `__theme_test.ts` bijgewerkt. Bewust niet aangeraakt: kaartkleuren
(aparte tokenfamilie), het avatarpalet.

**Fase 3, de gedeelde chrome — gedaan.** De vaste `w-72`-sidebar was het scherpste mobiele
probleem (zie de pilot-screenshot: op 390px bleef 288px aan de zijbalk hangen, tekst letterlijk
afgekapt) en is gedeeld over élk scherm — dus eerst dít, vóór een per-scherm IA-ronde.
`SidebarMobileProvider` (`components/layout/sidebar-mobile-context.tsx`) deelt de open/dicht-
status tussen de hamburger-knop in de TopBar en het paneel zelf; onder `lg` is de zijbalk
`hidden` (bewust `display:none`, niet een transform — dat haalt hem ook uit de tabvolgorde en de
accessibility-tree als hij dicht is, iets een transform niet doet) met een sluitknop en een
klik-wegvallende backdrop; elke navigatie sluit hem automatisch. `app/(app)/layout.tsx`'s `ml-72`
werd `lg:ml-72` zodat er op een smal scherm niets meer opzijschuift.

**Geverifieerd, met een kanttekening over de methode.** Getypecheckt, 276/276 tests groen, en
gecontroleerd tegen de ruwe server-gerenderde HTML (`curl`) én de volledige DOM-stapelvolgorde
(`document.elementsFromPoint`, niet alleen het bovenste element) op zowel de openstaande als de
dichte stand — beide kloppen, van de eerste HTML-byte tot vijf seconden na hydratatie. De
screenshot-tool in deze sandbox liet bij de DICHTE stand desondanks een oude blauwe balk zien die
in geen enkele DOM-controle bestond (elementFromPoint vindt er niets, het element is `0×0` en
`display:none`) — een bekende categorie renderbug in headless Chromium met `position:fixed`-
lagen, niet een app-fout. De OPENSTAANDE stand screenshot wél correct (donkere zijbalk, sluitknop,
verdonkerde achtergrond) en bevestigt de vorm.

**De echte grondoorzaak van de resterende horizontale overflow bleek dieper te zitten dan de
TopBar.** Losse aanpassingen daar (de datum verbergen onder `md`, de gap verkleinen) hielpen maar
gedeeltelijk en de resterende overflow bleef precies even groot bij elke volgende TopBar-wijziging
— een teken dat de oorzaak ergens anders zat. Bleek: `app/(app)/layout.tsx`'s contentkolom had
`flex-1` maar nooit `min-w-0`, en zonder die regel mag een flex-item van de browser niet krimpen
onder het min-content van zijn eigen inhoud — de TopBar's eigen (niet meer inkrimpende) inhoud
duwde daardoor de hele kolom, en daarmee header ÉN main, breder dan de viewport. Eén regel
(`min-w-0` op die kolom) loste het merendeel in één keer op; de datum-hiding en gap-verkleining
bleven staan omdat ze op zichzelf ook juist zijn, en één laatste plek (het "Aanmaken"-inputveld
bij klantgroepen, ontbrak zelf ook `min-w-0`) is losstaand gefixt.

**Live doorgemeten op 390px na deze fix, niet aangenomen:** `/settings`, `/vandaag`, `/portfolio`,
`/insights`, `/decision-terminal`, `/admin`, `/scripts` en `/client/demo-greentech` (de dichtste
pagina) geven allemaal `document.documentElement.scrollWidth === 390` — geen horizontale overflow
meer, nul uitzonderingen. Dat is een groter deel van de geplande "per-scherm IA-ronde" dan verwacht:
de vaste sidebar en deze ene ontbrekende `min-w-0` waren kennelijk de dominante oorzaak op vrijwel
elk scherm, niet losse per-pagina problemen. De grids die al `grid-cols-1 sm:...`/`md:...` gebruiken
(geconstateerd in de oorspronkelijke pilot-analyse) bleken dat dus ook daadwerkelijk correct te doen
zodra de container zelf niet meer kunstmatig te breed werd geduwd.

**Wat hiermee nog niet gezegd was, en inmiddels wél gecontroleerd (16 augustus, vervolgronde):**
afwezigheid van horizontale overflow is geen garantie dat alles ook prettig bruikbaar is op een
klein scherm. Nagegaan, niet aangenomen:

- **Brede tabellen.** Alle tabelcomponenten in het dashboard (20 bestanden, o.a.
  `campaign-table.tsx`, `forecast-table.tsx`) bouwen op de gedeelde `components/dashboard/
  data-table.tsx`, die zijn `<table>` al in een `overflow-x-auto`-vlak zet. De ene uitzondering
  (`components/insights/sprint-planning.tsx`, een eigen `<table>` buiten die component om) bleek
  zelf ook al correct in `overflow-x-auto` te staan. Geen enkele tabel duwt de pagina breder dan
  het scherm.
- **Grafieken.** Elke grafiek in `components/dashboard/` gebruikt Recharts' `ResponsiveContainer
  width="100%"` — al vloeibaar van opzet, geen vaste pixelbreedte om op vast te lopen.
- **Interactieve staten op 390px, live doorgeklikt:** het meldingenpaneel, het gebruikersmenu en
  de command palette (Cmd+K) openen alle drie binnen de viewport, leesbaar en zonder overflow; de
  hoofdtabs op een klantpagina (Prestaties/Analyse & advies/Planning & rapportage/Instellingen)
  vouwen al netjes naar een 2×2-rooster en wisselen correct van inhoud en subtabs bij een tik.

Geen van deze checks vroeg om een codewijziging — het was zuiver verificatie, en de uitkomst is
dat de per-scherm content-kwaliteit al in orde bleek te zijn zodra de layout-grondoorzaak en de
zijbalk waren opgelost. Resteert: dezelfde soort check op een klantaccount met echte gesynchte
data (kon niet in deze sandbox, geen live Google Ads/Meta-credentials) — vooral relevant voor
rijke tabellen zoals de zoektermenlijst, die met honderden echte rijen anders ogen dan de lege
demo-staat hierboven liet zien.

**Timing.** Geen fase-poort, dus geen vaste datum. Fase 1, fase 2 en de gedeelde chrome van fase 3
(inclusief de layout-grondoorzaak) staan er nu, breed doorgemeten. Resterend werk is losse
content-kwaliteit per scherm, geen structureel probleem meer — op te pakken zodra concreet nodig,
met als uiterste richtpunt rond of vlak na fase 5 (launching customer).

### 13.3 OAuth-koppelknoppen + GA4/Search Console van ontwerp naar code (16 augustus)

**Aanleiding.** Twee losse constateringen kwamen samen. Eén: geen enkel platform had een echte
"verbind account"-knop — ook Google Ads/Meta/LinkedIn niet, alleen env-var-instructies op de
settingspagina, terwijl de OAuth-architectuur ervoor (`agency_connections` + Supabase Vault,
migraties 062/063) al bestond maar dode code was zonder callback-route. Twee: GA4 had een complete
signaal-/detectorlaag zonder echte API-koppeling (`data-access.ts` zei het zelf: "raakt de echte
GA4-API aan (straks)"), en Search Console bestond helemaal niet in code — alleen als volledig
uitgewerkt ontwerp op papier in sectie 5.6, tegen de officiële API-documentatie van elk platform.
De vraag was scherp: kan de "eerste 80%" — alles behalve de daadwerkelijke live aanroep, die een
geregistreerde OAuth-app vergt — nu al gebouwd worden, zodat er bij een launching customer geen
"coming soon" meer hoeft te staan?

**Antwoord: ja, en het meeste ervan stond al op papier klaar.** Drie fases, elk apart getypecheckt,
getest en gecommit:

- **Fase A — OAuth-koppelknoppen, alle vijf platforms.** `Provider` (`lib/tenancy/koppelingen.ts`)
  uitgebreid met `google_analytics`/`search_console` (niet "ga4" — de vault-naamregex uit migratie
  063 staat geen cijfers toe in het providersegment; de bestaande test ving dit meteen).
  `lib/api/google-oauth.ts`/`meta-oauth.ts`/`linkedin-oauth.ts` voor de drie tokenwisselvormen
  (Google: standaard refresh-token-grant, nu gecached per bureau i.p.v. in een kale
  module-singleton die fout was zodra een tweede bureau meedraait; Meta: kortlevend→langlevend;
  LinkedIn: standaard met refresh token). `app/api/oauth/[provider]/{start,callback,disconnect}`
  met CSRF-state via een httpOnly-cookie — het bureau komt in de callback vers uit de ingelogde
  sessie, nooit uit de state-parameter (zie de opmerking in die route over waarom). Settingspagina
  kreeg een gedeelde `KoppelingKaart`-component met echte Verbinden/Ontkoppelen-knoppen; de
  env-var-instructies blijven staan als fallback, niet als enige pad.
- **Fase B — GA4 van mock naar live.** Migratie 094 sloot een kolom-gat dat `lib/marketing/
  tiers.ts` al had gesignaleerd (`client_settings.ga4_config` bestond niet eens in productie).
  `lib/ga4/api-client.ts` doet de echte `runReport`-aanroepen, in twee rapporten (sessies apart
  van gebeurtenistellingen — anders tellen sessies dubbel over meerdere key events in dezelfde
  sessie) en detecteert GA4's eigen sampling. De vier bestaande detectoren (`signals.ts`) en de
  SOP-promptinjectie (`context.ts`) zijn **ongewijzigd** — ze werken al op `Ga4DailyRow[]` en
  krijgen nu echte rijen.
- **Fase C — Search Console vanaf nul.** `lib/search-console/` spiegelt `lib/ga4/` qua vorm: vijf
  detectoren uit de sectie-5.6.2-tabel (merk-cannibalisatie, eigen-baseline-CTR-anomalie,
  positie-drop, niet-merk-overlap, nieuwe zoektermen), plus `beoordeelMerkCannibalisatie` — de
  driewegs-beslistabel uit sectie 5.6.0 die het GSC-signaal onafhankelijk naast de
  `isBranded`-naamgevingsheuristiek (`funnel-overlap.ts`) legt en in
  `app/api/analysis/cross-channel/route.ts` is gewired. `brandTerms` is met opzet handmatige
  invoer, nooit afgeleid uit Ads-campagnenamen — anders is het dezelfde gok verplaatst, niet een
  verificatie.

**Wat dit concreet bewijst over de "80%"-aanname.** Klopte, met een nuance: GA4 had al
analyselogica zónder API-koppeling, Search Console had nog geen van beide, en de connectieknoppen
zelf ontbraken voor alle vijf kanalen — de indeling was scheef, niet de schatting. Alles behalve de
daadwerkelijke live API-aanroep is nu gebouwd en getest zonder live credentials: 33 nieuwe checks
voor de detectoren/beslistabel/responsparsing (mocked fetch, geen netwerk), en de demo-dataset
(`lib/demo/search-console-demo.ts`) triggert de ontworpen detectoren aantoonbaar, niet aangenomen.
`npm run typecheck`, de volledige testsuite (281 bestanden) en `next build` zijn na elke fase
gecontroleerd, niet pas aan het eind.

**Wat nog moet gebeuren, en door wie.** Puur mensenwerk, geen code meer:
- Een Google Cloud-project met de Analytics Data API en de Search Console API ingeschakeld (Google
  Ads staat er al; dezelfde OAuth-client dekt alle drie).
- Een Meta-app en een LinkedIn-app (of uitbreiding van bestaande developer-toegang) met de juiste
  redirect-URI.
- De migraties 094 (`ga4_config`) en 095 (`search_console_config`) zijn als bestand gecommit maar
  **nog niet tegen de live database gedraaid** in deze sessie — er is bewust geen migratierunner in
  deze sandbox aangetroffen om een productie-schemawijziging autonoom door te voeren. Draaien vóór
  een bureau de nieuwe instellingenformulieren gebruikt.
- Per klant: GA4-propertyId + key events, Search Console-siteUrl + merktermen invullen (de
  formulieren staan er; dit is klantspecifieke invoer, geen ontwikkelwerk).

**Niet in deze ronde, expliciet niet stil laten vallen:** de zes overige bronnen uit sectie
5.6.3–5.6.5 (Shopify/WooCommerce, Microsoft Ads, TikTok) en de zes extra GA4-detectoren uit de
5.6.1-tabel (nieuw-vs-terugkerend, ecommerce-funnel-lek, GA4↔Ads-koppeling-health, kanaal×device-
matrix, retentiecohorten) — een volgende, vergelijkbaar grote bouwronde.

### 13.4 Twee productiebugs, gevonden en gefixt zodra ze zichtbaar werden (16 augustus)

**Aanleiding.** Direct na het draaien van de migraties (13.3) meldde de opdrachtgever twee dingen
vanaf de live site (`ctrlppc.com/settings`): een ruwe JSON-foutmelding bij het klikken op
"Verbinden met Meta Ads", en een algemene klacht dat het ontwerp niet responsive is, met een
screenshot op ~954px breed — geen mobiel formaat, een heel gewoon laptopscherm.

**Bug 1 — ruwe JSON i.p.v. een nette foutmelding.** De "Verbinden"-knop doet een volledige
paginanavigatie (`window.location.href`), geen `fetch`. `app/api/oauth/[provider]/start/route.ts`
retourneerde bij een ontbrekende OAuth-client (Meta had inderdaad geen `META_ADS_APP_ID`/`_SECRET`
gezet) een `Response.json(...)` — die dus letterlijk als paginabron in de browser verscheen:
`{"error":"Meta Ads: geen OAuth-client geconfigureerd..."}`. De callback-route (Fase A, 13.3)
redirecte al netjes terug naar `/settings?oauth_error=...` bij elke fout; de start-route deed dat
niet. Gefixt: elke foutsituatie in `start/route.ts` redirect nu terug naar de settingspagina, met
dezelfde foutcode-conventie. Bijvangst tijdens het fixen: de foutbanner-parser in
`settings/page.tsx` splitste op de eerste underscore om de providernaam uit de foutcode te lezen —
fout voor `google_analytics`/`search_console`, die zelf een underscore bevatten. Nu matcht hij
tegen de langste bekende providernaam die past.

**Bug 2 — een blauwe streep van 24px liep over de volle paginahoogte onder 1024px breed.**
Nagegaan in plaats van aangenomen: eerst gereproduceerd op 954px (exact de gemelde breedte), toen
bleek de eerste visuele indruk ("een brede blauwe baan van ~290px") bij precieze pixelsampling
(Python/Pillow op een 1:1-crop, niet op het oog) een 24px-brede streep te zijn — precies de
`p-6`-marge van `<main>`, niet breder. `app/globals.css` se `body`-achtergrondverloop (de merkkleur
achter de vaste zijbalk, `repeat-y` zodat de kleur op een lange pagina niet halverwege ophoudt —
zie de bestaande opmerking daar) stond **onvoorwaardelijk** aan, terwijl de zijbalk zelf pas vanaf
`lg` (1024px, `sidebar.tsx`/`layout.tsx`) getoond wordt. Op elk smaller scherm bleef die
24px-marge de merkkleur laten doorschijnen zonder dat er een zijbalk was om hem te verklaren — een
navrant understatement voor "niet responsive": het was verificeerbaar, herleidbaar tot één regel,
en al die tijd zichtbaar geweest op elk laptop-/tabletformaat onder 1024px. Gefixt met
`@media (min-width: 1024px)` om de body-achtergrond, in de pas met de `lg:`-klassen die de zijbalk
zelf tonen. Geverifieerd vóór/na met `getComputedStyle` en pixelsampling op 954/1024/1280px, niet
alleen visueel beoordeeld.

**Wat dit zegt over de eerdere sectie-13.2-conclusie.** Sectie 13.2 concludeerde na uitgebreide
DOM-verificatie dat er geen horizontale overflow was en dat interactieve staten op 390px (mobiel)
werkten — dat blijft waar, en is niet wat hier fout zat. Deze bug zat op een BREDERE band
(desktop/laptop, 700–1023px) die niet in die eerdere ronde is getest: de aanname was steeds "smal
= mobiel = getest op 390px, breed = desktop = de zijbalk staat er gewoon" — de tussenliggende band,
waar de zijbalk al verborgen is maar de decoratieve achtergrond nog niet, viel buiten beide
categorieën. Geen reden om sectie 13.2's bevindingen te herzien, wel een aanwijzing dat "getest op
390px en op ≥1024px" niet hetzelfde is als "getest over de hele breedte" — de volgende
mobiel/responsive-check moet expliciet een paar tussenliggende breedtes (700–1023px) meenemen, niet
alleen de twee uiterste ankerpunten.

Typecheck schoon, volledige testsuite (281 bestanden) en `next build` slagen na beide fixes.

**Naschrift, zelfde dag: de opdrachtgever had gelijk, en het was groter dan de gradient.** Na het
draaien van de migraties meldde hij vanaf `ctrlppc.com/admin` dezelfde blauwe streep, plus de
scherpe vraag: "waarom is er uberhaupt een blauwe lijn hier, dat blauw is niet eens een kleur die
we hanteren." Eerst de verwarring opgehelderd die daarbij ontstond: hij keek op GitHub naar de
commit-geschiedenis van een branch genaamd `claude/ctrl-ppc-masterplan` en concludeerde dat dat
"de enige masterplan op main" was — dat is een andere, losstaande branch van een eerdere/andere
sessie (laatste commit 15 augustus, nooit gemerged), niet `main`. Geverifieerd: `main` op GitHub
wees exact naar het laatste commit van deze sessie. Los daarvan bleek zijn kernvraag over de kleur
volledig terecht:

- De responsive-fix zelf stond al goed live (bevestigd door de gecompileerde CSS van
  `www.ctrlppc.com` rechtstreeks op te halen en te doorzoeken op de media-query).
- Maar **acht andere plekken** in `app/globals.css` se klassieke `:root{}`-blok (het shadcn-
  conventieblok, niet de nieuwere `@theme`-laag) hadden de ingetrokken merkkleur (#08288C/
  #F16B37/#0a35b0) nog letterlijk hardgecodeerd staan: `--primary`, `--secondary-foreground`,
  `--accent`, `--ring`, `--chart-1`, `--chart-2`, `--sidebar`, `--sidebar-primary`,
  `--sidebar-accent`, `--sidebar-ring`, plus `--kaart-hoog`/`--kaart-hover` voor de wereldkaart/
  VS-kaart. Sectie 13.2's kleurcorrectie (verderop in dit document) had eerder vandaag alleen de
  `@theme`-laag en het nieuwe `--sidebar-panel`-token geraakt — dit oudere blok was gewoon
  gemist. `.dark{}` had het juiste patroon (`var(--brand-primary, ...)`) al overal, op één
  vergeten `--accent`-fallback na.
- **Waarom dit specifiek op `/settings` en `/admin` zichtbaar was, en niet overal**:
  `BrandThemeProvider` (`components/branding/brand-theme-provider.tsx`) zet `--primary`/
  `--sidebar`/etc. als **inline style** op de document-root, en draait alleen op klantpagina's
  (`clientId` is een verplichte prop). Bureau-brede pagina's zonder klantcontext — settings,
  admin — hebben die provider niet, en vielen dus terug op de kale `:root{}`-stylesheet-waarden.
  Klantpagina's toonden intussen al gewoon de juiste kleur (inline style wint altijd van een
  stylesheet), wat verklaart waarom dit niet eerder was opgevallen: het was niet overal stuk,
  alleen op de bureau-brede schermen.
- Concreet zichtbaar gevolg: de standaardknop (`bg-primary`, `button.tsx` se default-variant —
  de meestgebruikte knopstijl in de hele app) rendert op elke bureau-brede pagina in het oude
  navy. "Verbinden met Google Ads" in de eerdere schermafdruk was daar een voorbeeld van, niet
  een OAuth-bug.

Gefixt: alle acht naar `var(--brand-primary, #4f46e5)` / `var(--brand-accent, #f5960b)`, exact
hetzelfde patroon als `--sidebar-panel` en `.dark{}` al gebruikten. De twee kaartcomponenten
(`world-map.tsx`, `us-states-map.tsx`) kregen dezelfde correctie op hun eigen defensieve
CSS-fallback. Bewust ongemoeid gelaten: een placeholder-tekst in het klant-brandingformulier (een
voorbeeldwaarde in een vrij invoerveld, geen productclaim) en een vierkleurig avatarpalet
(decoratief, geen merkclaim). Geverifieerd met `getComputedStyle` op `--primary`/
`--sidebar-panel` én de daadwerkelijke knopkleur, niet alleen visueel — typecheck, volledige
testsuite en `next build` slagen.

**De les:** een kleurcorrectie "op verzoek van de eigenaar" die maar één van twee plekken raakt
waar diezelfde token-namen gedefinieerd staan, is geen voltooide correctie — hij verplaatst het
zichtbaarheidsprobleem naar de paginacategorie die toevallig niet getest werd. Bij een volgende
merk-/kleurwijziging: zoek op de letterlijke oude hexwaarde over het HELE bestand (`:root` én
`.dark` én elke component-eigen fallback), niet alleen in de laag waar de wijziging bedoeld was.

---

## 14. Statusaudit en openstaande punten (17 augustus 2026)

De eigenaar vroeg een brede statuscheck ("zijn we 100% zeker... is alles al gebouwd... nog logica
vraagstukken?") en expliciet **een single source of truth** — dus geen los rapport in de chat,
alles hier. Onderzocht met drie parallelle, read-only research-passes tegen de codebase (niet
tegen dit document, om cirkelredenering te voorkomen) plus een losse live-verificatie. Elke claim
hieronder heeft een bestand:regel-bron; waar iets niet vastgesteld kon worden staat dat er
letterlijk bij in plaats van een educated guess.

### 14.1 Campagnetype-dekking per kanaal

Nieuw vastgesteld, stond nog nergens: alleen **Google Ads** is per campagnetype gedifferentieerd.
`lib/campaign-types.ts:206` en verder kennen Search/Shopping/PMax/Display/Video, elk met een eigen
`PURPOSE_EVAL_CRITERIA`-blok; `DEMAND_GEN`/`DISCOVERY` komen apart terug in `lib/api/
google-ads.ts` en `lib/geo/channel-matrix.ts:65`. **App-campagnes (UAC) zijn niet gevonden** —
geen enkele match op "app_campaign"/"UAC" in `lib/`, dus niet gebouwd, niet gedocumenteerd als
bewust weggelaten.

**Meta en LinkedIn worden generiek/geblend behandeld**, niet per campagnetype:
`lib/analysis/meta-funnel-facts.ts` en `linkedin-funnel-facts.ts` wrappen allebei dezelfde
`funnel-core.ts` met alleen andere veldnamen — geen objective- of campagnetype-branching. Dit is
geen bug (het is nooit als zodanig gebouwd), maar wel een reëel verschil in analysediepte tussen
Google Ads en de andere twee kanalen dat nergens expliciet stond. Open vraag, geen actie
ondernomen: is dit een bewuste volgorde (Google eerst, dieper) of een gat dat ooit dichtgroeit.

### 14.2 Kanaaldata tegen developer-documentatie: alleen Google Ads is echt nagekeken

Sectie 5.6 documenteert al uitgebreid welke NIEUWE bronnen tegen officiële API-docs zijn
uitgewerkt (GA4, GSC, Shopify, WooCommerce, Microsoft, Bing Webmaster, TikTok). Wat daar niet
stond: van de **drie kanalen die al draaien**, is alleen Google Ads' veldbetekenis expliciet tegen
`developers.google.com` gecheckt (`lib/api/google-ads.ts:3257`, 5 augustus — met de eigen,
eerlijke kanttekening: "de vorm klopt met de documentatie; dat is iets anders dan bewezen tegen
een live account") plus de PMax-assetvereisten apart (`lib/pmax/assetdekking.ts:20`, tegen
`developers.google.com/google-ads/api/performance-max/asset-requirements`).

**Voor Meta Marketing API en LinkedIn Ads API bestaat geen vergelijkbare documentcheck.** De
verify-scripts (`scripts/verify-channel-output-contract.ts`, `verify-pmax-scorecard.ts`,
`verify-search-scorecard.ts`) checken interne consistentie tegen echte productie-database-rijen —
dat bewijst dat de pijplijn intern klopt, niet dat een veld betekent wat de Meta/LinkedIn-docs
zeggen dat het betekent. **Open punt, niet 100% zeker**, precies de vraag die de eigenaar stelde.

**Bijgewerkt (17 augustus, alsnog uitgevoerd):** Meta en LinkedIn nu wél tegen hun officiële docs
gelegd (developers.facebook.com en learn.microsoft.com/linkedin), met drie uitkomsten:

1. **Een echte, urgente bug gevonden en gefixt: LinkedIn's API-versie was verlopen.**
   `LINKEDIN_API_VERSION` stond op `202506` (juni 2025) — bevestigd in LinkedIn's eigen
   migratietabel als **"Deprecated"** sinds 15 juni 2026, twee maanden vóór deze check. Een
   verlopen versieheader geeft een foutrespons terug, geen stille terugval — elke live
   LinkedIn-sync-aanroep zou hierop hebben gefaald. Gecheckt vóór het bumpen dat er geen breaking
   changes zitten tussen 202506 en 202608 op de velden die deze module opvraagt, en gebumpt naar
   202608 (nieuwste, sunset 17 augustus 2027). `lib/linkedin/sync.ts`. Dit is precies het lot dat
   `lib/meta/api-version.ts` zelf al beschreef over de vorige Meta-versieveroudering ("Meta zet
   oude Marketing API-versies hard uit") — hier gebeurde het daadwerkelijk, ongemerkt, aan de
   LinkedIn-kant.
2. **Meta's conversietelling (`lib/meta/transform.ts`, `mapActions`/`firstActionValue`) klopt in
   opzet, met één genoteerde onzekerheid.** De code telt bewust maar één bron per doelveld (eerste
   match in de API-respons, `purchase`/`omni_purchase`/`offsite_conversion.fb_pixel_purchase`
   tellen niet samen) — expliciet ontworpen om dubbeltelling te voorkomen, en dat klopt. Volgens
   Meta's documentatie is `omni_purchase` echter een geaggregeerd, kanaaloverstijgend signaal
   (online + in-store), specifiek voor accounts die Meta's "Omni Ads"-campagnetype gebruiken
   (sinds april 2025) — niet gegarandeerd hetzelfde als `purchase`/de pixel-variant voor zulke
   accounts. De code kiest nu willekeurig welke van de drie het eerst in de API-array staat, in
   plaats van bewust `omni_purchase` te verkiezen wanneer aanwezig. Voor de meeste klanten (geen
   Omni Ads) maakt dit niets uit, want dan verschijnt er toch maar één van de drie. Laag risico,
   niet urgent, wel genoteerd — mocht een klant ooit Omni Ads gaan draaien.
3. **LinkedIn's `externalWebsiteConversions` vs. `externalWebsitePostClickConversions`: geverifieerd
   correct, geen bug.** De officiële docs bevestigen een derde, verwant veld
   (`externalWebsitePostViewConversions`) dat samen met de post-click-variant optelt tot het totaal
   — exact zoals `externalWebsiteConversions` al wordt gebruikt in migratie 050's formule
   (`conversions = one_click_leads + external_website_conversions`). De losse
   `postClickConversions`-kolom (`lib/linkedin/transform.ts:104`) wordt nergens opgeteld bovenop
   het totaal, dus geen dubbeltelling. Bevestiging, geen fix nodig.

### 14.3 Het Decision Engine-skelet en `EXECUTION_PLAN.md` — een tweede document, nu hier verankerd

Dit is de belangrijkste bevinding van de audit voor "1 single source of truth": er bestaat een
**tweede planningsdocument**, `EXECUTION_PLAN.md` (geschreven 9 augustus, voor een
uitvoeringsagent), met zijn eigen **"Fase 1: Decision Intelligence Core"** — dat is NIET dezelfde
Fase 1 als sectie 9 hierboven ("de canonieke laag afmaken", **KLAAR**). Zelfde naam, andere
inhoud, geen enkele kruisverwijzing tot vandaag. Vastgelegd zodat niemand dit later nog eens
verwarrend vindt.

Wat het is: `lib/decision/channel-provider.ts` + `lib/decision/decision-skeleton.ts`, en de routes
`weekly-decision`/`biweekly-decision`/`monthly-decision`. `EXECUTION_PLAN.md` zelf is expliciet
over de scope: *"Raak deze bestanden niet aan: `weekly/route.ts`, `biweekly/route.ts`,
`monthly/route.ts`... Nieuwe routes komen ernaast, met een eigen padsegment."* En
`decision-skeleton.ts`'s eigen kop zegt wat het NIET doet: geen `createProgressJob`, geen
`saveAnalysisOutputSection`, geen OpenRouter-aanroep, "deze routes horen nog niet in de UI."

**Wat dit betekent voor de Meta/LinkedIn-stubs die in deze skeleton zitten**
(`lib/decision/providers/meta-provider.ts`, `linkedin-provider.ts` — `collectSignals()` geeft
altijd `[]`, met de reden in de eigen bestandskop): dit is **geen gat in de live productanalyse**.
De echte, klant-bedienende Meta/LinkedIn-analyse loopt via de bestaande, werkende SOP-routes
(`meta-funnel`, `meta-briefing`, `meta-creatives`, `meta-signals`, `linkedin-funnel`,
`linkedin-signals`, `linkedin-icp-fit` — dezelfde die de SOP-cron en de handmatige knoppen al
aanroepen) — die zijn niet gestubd en nooit aangeraakt door dit skelet.

**Status: onafgemaakt, bewust geïsoleerd experiment, geen klantimpact.** Prioriteit hangt af van
waar het naartoe moet — dat is nog niet besloten en hoort in een apart gesprek, niet stilzwijgend
verder gebouwd vanuit deze auditregel.

### 14.4 H1-evaluator vs. de trackrecord-belofte op de homepage — geverifieerd, met een correctie op mezelf

De homepage (`components/marketing/why-trust.tsx`, sinds 17 augustus) claimt: elke aanbeveling
krijgt een meetbare voorspelling, een succescriterium, een vaste reviewdatum, een gelogde uitkomst,
en een learning die het volgende resultaat voedt. Bij het schrijven daarvan werd dit geverifieerd
tegen `analysis_hypotheses` (migratie 005) — **fout bewijs**: die tabel heeft 0 rijen en wordt
door niets gelezen of geschreven (dode tabel, bevestigd in `EXECUTION_PLAN.md` sectie 0).

**De claim zelf klopt, via de juiste, live tabel:** `sprint_hypotheses` +
`app/api/cron/evaluate-hypotheses/route.ts`. `writeVerdict()` (regel 208-222) schrijft
`outcome`/`result_met`/`learning`/`evaluated_at` in productie. De "vaste reviewdatum" is
`windowEnd = accepted_at + timeframe` (regel 122-125 van diezelfde route) — geen aparte
`evaluate_after`-kolom, maar functioneel identiek: pas als dat venster om is telt de uitkomst mee.

**Wat de verwarring veroorzaakte:** `lib/analysis/period-evaluation.ts` (SI3, een apart, nieuw
kwartaal/campagne-niveau rapport) heeft een letterlijke comment "de H1-evaluator is nog niet
gekoppeld" (regel 180). Dat gaat over een heel ANDERE, niet-live functie (dit specifieke rapport
roept `evaluateHypothesisOutcome` nog niet aan) — niet over de evaluator zelf, die al sinds Fase 3
(hierboven) draait en verifieerbaar echte verdicts schrijft. SI3 zelf is nergens op de
marketingsite beloofd, dus dit is een openstaand, laag-urgent punt op zichzelf, geen dreiging voor
de trackrecord-claim.

### 14.5 Modules: twee kanttekeningen bovenop de tabel in sectie 7

- **Proof Engine** heeft vandaag nul coderegels — geen enkele match in `lib/` of `app/` op iets
  dat er ook maar naar verwijst. Sectie 7 noemt de poort (zes maanden `agency_memory_events`) maar
  niet dat er letterlijk nog niets staat.
- **Volume Compute** staat in sectie 7 als "kredietgrootboek bestaat, zelfbedieningsflow niet" —
  klopt, met de precisering uit `lib/analysis/credit-costs.ts`: `CREDIT_COSTS` is een bewuste
  placeholder (prijsbeslissing, geen technisch gat), `verbruikCredit()` is daardoor vandaag een
  no-op op de 7 van de 22 deep-dive-routes waar hij wél is aangesloten. Automatische SOP's
  (monthly/weekly/biweekly) zijn hier sinds 11 augustus bewust van uitgesloten — dat gold al,
  alleen nu expliciet hier bevestigd.

### 14.6 LLM-modelkeuze per module/deep dive — al besloten, hier pas echt vastgelegd

Zie ook de aanvulling bij Fase 3 hierboven. Volledig overzicht (`lib/analysis/llm-router.ts:112-124`,
gedetailleerd in `docs/ARCHITECTURE-MODEL-ROUTING.md`, geverifieerd tegen de live
OpenRouter-catalogus):

| Laag | Model | Fallback |
|---|---|---|
| triage | `google/gemini-2.5-flash-lite` | — |
| reasoning | `x-ai/grok-4.6` | — |
| narrative | `anthropic/claude-sonnet-5` | — |
| strategic | `anthropic/claude-opus-5` | `openai/gpt-5.6-sol` |

Eén keuze is zelf gemarkeerd als onbewezen: *"Laag 3 (Grok 4.6) is de enige keuze die nog niet
gemeten is"* (`ARCHITECTURE-MODEL-ROUTING.md:61`) — een redelijke, niet-willekeurige keuze, maar
nog niet in de praktijk bevestigd. Geen open beslissing verder in sectie 5/7 over modelkeuze zelf.

### 14.7 Design-consistentie: geen gedeeld kaartcomponent

Sectie 13.2 loste de merk-/kleurinconsistentie en de mobiele sidebar op, maar raakte dit niet:
er bestaat geen gedeeld `Card`-component. `components/ui/` heeft geen `card.tsx`. Wel gedeeld:
`components/ui/sectie.tsx` (`Sectie`, in 7 bestanden) voor sectieritme, `chart-chrome.tsx` (in 8
chartcomponenten) voor grafiekchroom, en `components/ui/kerncijfer.tsx` (in 11 bestanden) voor het
grote-metriek-primitive. Maar losse "kaart"-divs zijn grotendeels handgerold:
`rounded-xl border border-border` komt letterlijk terug in **48 bestanden** onder
`components/dashboard`. Geen bug, wel opgehoopte inconsistentie — een toekomstige
kaart-stijlwijziging moet vandaag op 48 plekken los worden doorgevoerd.

### 14.8 Kaartoverloop: de twee gemelde "bugs" waren fout-positieven in de checker, niet in het product

**Bijgewerkt, zelfde dag.** `scripts/check-kaartoverloop.mjs` meldde op 17 augustus 6 bevindingen op
`bevindingen` en 25 op `app-instellingen`. Voor beide eerst een screenshot en volledige
DOM-inspectie gedaan voordat er iets aangepast werd — geen van beide bleek een echte
kaartoverloop:

- **`bevindingen`**: een takenlijst met `max-h-[400px] overflow-y-auto`
  (`components/dashboard/client-dashboard.tsx`'s `TasksBlock`) knipt zijn eigen inhoud al netjes af
  — bevestigd met `clientHeight`/`scrollHeight` én een screenshot met een schone onderrand. De
  detector checkte alleen het `overflow` van de buitenste kaart, niet van deze tussenliggende
  scrollcontainer.
- **`app-instellingen`**: de env-var-instructies zitten in een gesloten `<details>`
  (`components/settings/koppeling-kaart.tsx`, "Alternatief: handmatig via .env.local"). Chromium
  geeft `getBoundingClientRect()` op verborgen `<details>`-inhoud een echte, niet-nul positie
  terug — anders dan bij `display: none` — terwijl er niets te zien is (bevestigd met
  `getComputedStyle` en een screenshot). De detector had geen uitzondering voor een gesloten
  `<details>`-voorouder.

**Gefixt in de detector zelf** (`scripts/check-kaartoverloop.mjs`, niet in de productcode, want
daar zat de fout): twee nieuwe uitsluitingen — een tussenliggende voorouder met
`overflow-y: auto/scroll` of `overflow: hidden/clip`, en een gesloten `<details>`-voorouder. Beide
pagina's zijn nu schoon; de zelftest (de echte `h-full`-in-rastercel-bug teruggezet) vindt hem nog
steeds. Geen productwijziging nodig — het scherm was altijd al goed.

### 14.9 Mobile: resterende verificatiegaten (herbevestiging van sectie 13.2's eigen voorbehoud)

Geen nieuwe bevinding, wel expliciet hier herhaald omdat het anders makkelijk vergeten wordt: (1)
nooit getest tegen een echt gekoppeld account met live synced data — geen credentials in de
sandbox, met name risicovol voor brede tabellen zoals de zoektermenlijst; (2) de tussenliggende
breedtes 700–1023px zijn nooit systematisch getest, en precies daar zat de blauwe-streep-bug uit
13.4. Beide staan al in sectie 13.2/13.4; hier alleen samengevat zodat sectie 14 als geheel
leesbaar is zonder terug te bladeren.

---

## 15. Vergelijking met EXECUTION_PLAN.md (17 augustus 2026)

Op verzoek van de eigenaar ("ik wil 1 single source of truth"): `EXECUTION_PLAN.md` is een
**tweede, los planningsdocument** in deze repo (draaiboek voor een uitvoeringsagent, geschreven 9
augustus tegen commit `54072fa`, met zijn eigen "Fase 1: Decision Intelligence Core" — zie 14.3
voor de naamsbotsing met de Fase 1 hierboven). Dit document (`MASTERPLAN.md`) is het meest
actuele; deze sectie legt vast wat `EXECUTION_PLAN.md` had dat hier nog ontbrak, na verificatie
tegen de live code — niet klakkeloos overgenomen.

### 15.1 RLS-dekking: eerdere versie van deze sectie was te alarmerend, hier gecorrigeerd binnen dezelfde sessie

**Zelfcorrectie, direct bij het uitvoeren van de eerste stap hieronder.** De eerste versie van deze
sectie beweerde, op basis van `EXECUTION_PLAN.md` se 9-augustus-meting en de kop van
`scripts/migrations/065_rls_sop_intelligence.sql` ("NIET UITGEVOERD TEGEN DE DATABASE"), dat het
RLS-gat op de acht SOP/intelligence-tabellen nog volledig open stond. Dat bleek een te snelle
conclusie: één bestandskop is aangenomen als waarheid zonder de eropvolgende migratie te lezen, en
zonder te checken of de betrokken schermen zelf al waren omgebouwd. Beide checks weerspreken de
oorspronkelijke claim.

**Wat er echt staat, gecheckt tegen drie onafhankelijke bronnen:**

1. `scripts/migrations/067_rls_granulaire_kanalen_en_appdata.sql` (**TOEGEPAST op 10 augustus**,
   dat staat letterlijk in zijn eigen kop) meet als uitgangspositie: *"Gemeten na migratie 065: 45
   van de 122 tabellen in public hebben RLS."* Dat cijfer is alleen haalbaar als migratie 065 al
   was toegepast op het moment dat 067 geschreven werd — 065's eigen "NIET UITGEVOERD"-regel is
   dus zelf verouderd, nooit bijgewerkt nadat de migratie alsnog draaide. Na 067 zelf: 103 van de
   122.
2. Alle twintig componenten die migratie 065's eigen kop noemt als rechtstreekse browser-lezer van
   de acht tabellen (`dgm-view.tsx`, `insights-block.tsx`, `use-today-feed.ts`,
   `analysis-overview.tsx`, `sop-trigger-buttons.tsx`, `tasks-block.tsx`,
   `recommendations-block.tsx`, `proposal-queue.tsx`, `sprint-planning.tsx`,
   `brand-theme-provider.tsx`, `event-settings.tsx`, `branding-view.tsx`,
   `geo-clone-settings.tsx`, `channel-performance.tsx`, `channel-forecast.tsx`,
   `forecast-table.tsx`, `channel-conversion-settings.tsx`, `use-upcoming-edition.ts`,
   `client-settings.ts`, `task-impact-reminder.tsx`) zijn nagelopen op 17 augustus: **geen enkele
   leest de acht tabellen nog rechtstreeks.** Allemaal via `dbSelect`/`dbUpdate`
   (`lib/data-access/client-read.ts`/`client-write.ts`) → `GET /api/data/[table]`
   (`app/api/data/[table]/route.ts`) → service role. Die brug bestaat, is compleet aangesloten, en
   bestaat met als expliciet doel (staat in de kop van `read-policy.ts`) migratie 065 veilig te
   maken.
3. Er is een **derde** RLS-migratie die nergens in dit document stond: `081_rls_negentien_tabellen.sql`
   (commit `1fde60a`, 15 augustus) — negentien tabellen die volledig zonder policy stonden, waaronder
   `generation_jobs`, `sync_runs`, `analysis_hypotheses`, `analysis_tasks`, `app_settings`,
   `alerts_log`, acht `*_legacy`-brontabellen. Draagt geen "TOEGEPAST"/"NIET UITGEVOERD"-markering,
   dus toepassingsstatus is voor déze migratie **niet met zekerheid vast te stellen zonder
   databasetoegang** (deze sandbox heeft geen `SUPABASE_ACCESS_TOKEN`; `scripts/
   check-rls-scheiding.mjs` — het script dat dit met een echte login zou bewijzen — slaat zichzelf
   over zonder die sleutel, `"rls-scheiding: overgeslagen"`, en heeft dat de hele sessie gedaan
   zonder dat een groene `gates.sh` dat liet zien).

**Conclusie, eerlijk gegradeerd:** het gat op de acht SOP/intelligence-tabellen (migratie 065) is
zeer waarschijnlijk gedicht — sterk bewijs uit twee onafhankelijke bronnen, geen tegenbewijs. De
status van migratie 081's negentien tabellen is onbekend, niet "open" — dat moet iemand met
databasetoegang bevestigen met `node scripts/check-rls-scheiding.mjs` of een directe query op
`pg_tables`/`pg_policies`, niet aangenomen in welke richting dan ook.

**Wat wél overeind bleef, en inmiddels is opgelost (17 augustus, zelfde sessie):** zes tabellen
droegen een oude, tenant-blinde policy — drie letterlijk `auth_read` uit migratie 012
(`ads_leading_indicators`, `ads_portfolio_analysis`, `benchmark_sectors`), twee met
"Allow all for authenticated" uit een niet-genummerd ad-hoc bestand
(`scripts/geo-layer2-tables.sql`: `ads_region_monthly`, `channel_geo_monthly`), één uit een tweede
zulk bestand (`scripts/video-placements.sql`: `ads_video_placements`). Geen van de drie
RLS-migraties (065/067/081) raakte ze. **Correctie op de eigen eerdere telling:** het waren geen
zes gelijke tenant-lekken — `benchmark_sectors` heeft geen `client_id`-kolom (generieke
branchebenchmarks, geen klantdata), dus geen tenant-lek, alleen een opgeschoonde policy-naam
nodig.

**Gedaan, en inmiddels ook echt toegepast (17 augustus, later dezelfde dag).**
`scripts/migrations/096_rls_auth_read_opruiming.sql` dicht alle zes, met het
`app_zichtbare_klanten()`-patroon uit 065/067/081 voor de vijf echte klanttabellen. De ene
tabel met een rechtstreekse browser-lezer (`ads_video_placements`, via
`components/dashboard/video-placements.tsx`) is eerst omgebouwd naar
`lib/data-access/client-read.ts` (`dbSelect`) → `GET /api/data/[table]`, en toegevoegd aan
`READABLE_TABLES` in `lib/data-access/read-policy.ts` — dezelfde volgorde (leeskant eerst, dan de
policy) als 065/067 zelf voorschrijven. De overige vijf hadden geen browser-lezer, dus voor die
vijf kon de policy direct.

De eigenaar deelde `SUPABASE_ACCESS_TOKEN` en de project-URL later dezelfde dag. Vóór het
toepassen eerst de live status nagekeken (niet aangenomen): alle acht tabellen uit migratie 065
en alle negentien uit 081 bleken al écht RLS te dragen met precies één beleidsregel — bevestigt
de correctie hierboven definitief, met een live query, niet alleen redenatie. De zes tabellen uit
096 stonden nog op hun oude policy (`auth_read`/"Allow all for authenticated", exact zoals
verwacht). Migratie uitgevoerd, direct erna geverifieerd met de eigen controlequery: elke tabel
heeft nu precies de nieuwe `_zichtbaar`-policy plus (waar van toepassing) `service_role_all` — geen
enkele tabel zonder policy. **Resultaat, met een aparte query gemeten: 127 van de 127 tabellen in
`public` hebben nu RLS — volledige dekking.** Migraties 094 en 095 bleken bij diezelfde
gelegenheid al eerder toegepast (`ga4_config`/`search_console_config` bestonden al als kolommen op
`client_settings`) — niet door deze sessie gedaan, wel nu bevestigd in plaats van aangenomen.

**Correctie op de correctie in sectie 7:** de eerdere versie van deze sectie corrigeerde
`"Een Second Opinion-run (draait al, RLS via migratie 065)"` in sectie 7 als onjuist. Gegeven het
bewijs hierboven was die oorspronkelijke regel in sectie 7 waarschijnlijk WEL correct. Sectie 7
blijft daarom ongewijzigd; deze sectie is de plek waar de geschiedenis van de vergissing staat,
niet sectie 7 zelf.

**Voor Bureau twee blijft gelden:** RLS-dekking is nu voor alle 127 tabellen bevestigd (hierboven,
live gemeten). Wat nog steeds ontbreekt is het functionele bewijs: `scripts/check-rls-scheiding.mjs`
echt inloggen als twee verschillende bureaus en meten dat rijen daadwerkelijk gescheiden blijven —
dat vraagt `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `SUPABASE_SERVICE_ROLE_KEY`, die deze sessie niet
kreeg (alleen `SUPABASE_ACCESS_TOKEN` en de project-URL, genoeg voor DDL maar niet voor een
ingelogde sessie). Een policy die bestaat is niet hetzelfde als een policy die bewezen de juiste
rijen tegenhoudt — dat blijft de juiste stap vóór een tweede bureau een klant koppelt.

### 15.2 Correctie op sectie 14.3: het skelet is niet overal even dood

Sectie 14.3 hierboven zegt dat het Decision Engine-skelet (`channel-provider.ts`,
`decision-skeleton.ts`, de `*-decision`-routes) volledig geïsoleerd is van de live pijplijn. Dat
klopt voor die drie bestanden. Het klopt **niet** meer voor `lib/decision/quality-gates.ts` — ooit
hetzelfde skelet-effort (EXECUTION_PLAN.md Stap 2, "Tien Quality Gates in shadow mode"), maar
inmiddels gegradueerd: Fase 2 hierboven (regel ~996) documenteert dat migratie 083 +
`monthly/route.ts` de poorten nu wél op elke echte run aanroepen, puur observerend
(`quality_gate_observations`, fire-and-forget), geverifieerd tegen een echte klant/maand. Twee
tellingen wijken af van elkaar, en dat is geen fout maar een evolutie: `EXECUTION_PLAN.md` stelde
tien poorten voor (inclusief een aparte "Publish"-meta-poort en drie poorten — Rejected Cause,
Thread Stability, Recommendation Continuity — die nooit zo gebouwd zijn); de live
`GATES`-array in `quality-gates.ts` heeft negen, waarvan twee met een andere naam en andere logica
dan het oorspronkelijke plan (Step Purity Gate, Coverage Gate). Het plan is dus niet 1-op-1
uitgevoerd, het is herontworpen tijdens de bouw — de huidige negen zijn de juiste, levende
bron, niet het tien-poorten-voorstel.

### 15.3 Onopgenomen conceptwerk: Behavioral Funnel Classifier, Playbook Engine, Portfolio Trend Engine

`EXECUTION_PLAN.md` Stap 1 definieert TypeScript-interfaces voor drie concepten die nergens anders
in deze repo voorkomen: een gewogen `FunnelClassification` (vier signalen: `api_intent` 20%,
`conversion_routing` 20%, `audience_logic` 30%, `output_reality` 30%), een `Playbook`
("het IP van één bureau, nooit gedeeld") en een `MacroTrendCell` (portfolio-brede trends per
bureau/kanaal/niche). Dit is **niet hetzelfde** als de al-live rolclassificatie in sectie 5.2
(`classifyFunnelRole`/`funnel-overlap.ts`, prospecting/retargeting/branded capture) — een andere
as, voor een ander doel (Playbook Engine, niet cross-channel-synergie).

De interfaces zijn overgenomen uit "hoofdstuk 13 van de master blueprint" — een extern document
dat, net als de negentien strategische documenten uit sectie 0, **niet in deze repo bestaat**.
Wel echt gemeten op 9 augustus, tegen 71 accounts: API Intent-dekking 54/71
(`ads_campaign_metadata.bidding_strategy`), Audience Logic 18/71 (`ads_audience_performance_monthly`,
alleen Google — `meta_adsets` heeft 0 rijen), Conversion Routing 8/71 op klantniveau en 0 op
campagneniveau, Output Reality volledig. Bij een `coverage`-drempel van 0,5 haalt de classifier dat
vandaag niet: de twee zwakke signalen, Audience Logic (30%) en Conversion Routing (20%), tellen
samen voor 50% van de weging en rusten op data die bij de meeste accounts ontbreekt — precies de
helft van het oordeel hangt op wat er het minst is.

**Status: geen gebouwde functionaliteit, geen geplande poort, puur gemeten voorwerk dat nergens
anders is vastgelegd.** Of dit concept wordt overgenomen is een productbeslissing voor de
eigenaar, geen automatische toevoeging — hier alleen vastgelegd zodat het niet nogmaals "ontdekt"
hoeft te worden.

### 15.4 Onopgenomen: Business Event Context (rai_events → BusinessEvent)

`EXECUTION_PLAN.md` Stap 5 beschrijft een mapping van `client_settings.rai_events` (JSONB,
migratie 024, al gevuld: beurzen met cadans en edities, gelezen door
`lib/rai/use-upcoming-edition.ts` en de geo-clone-route) naar een generieke `BusinessEvent`-vorm
voor de Decision Engine, plus de constatering dat `sop_client_context` (met precies de juiste
kolommen: `valid_from`/`valid_until`/`impact_on_analysis`) wél bestaat maar **0 rijen** heeft —
bruikbaar, nooit gevuld. Nergens in dit document vastgelegd. Geen actie ondernomen, alleen
verankerd: als "waarom weet de analyse niet dat er een beurseditie aankomt" ooit een vraag wordt,
is dit waar het antwoord al lag.

### 15.5 Kleine, niet-blokkerende afwijkingen — EXECUTION_PLAN.md's cijfers zijn hier de verouderde

Twee plekken waar `EXECUTION_PLAN.md` een getal noemt dat inmiddels afwijkt van de live code, en
waar **dit document en de code gelijk lopen** (dus geen actie, alleen vastgelegd zodat niemand
straks het verkeerde document als bron pakt): het God View-drempelgetal — `EXECUTION_PLAN.md`
noemt "`totalCount >= 50` én ≥5 bureaus én ≥20 accounts," de live code
(`lib/benchmark/cel.ts`) en sectie 6/7 hierboven zeggen `MIN_BUREAUS = 4` met
`MIN_ACCOUNTS = 10` per cel — `EXECUTION_PLAN.md` is hier de verouderde bron, dit document en de
code kloppen.

## 16. Koersbepaling: cron-beleid en "niet wachten op een klant" (17 augustus 2026)

Twee besluiten van de eigenaar die eerder impliciet/losstaand waren en nu expliciet en blijvend
vastliggen, zodat ze niet opnieuw hoeven te worden "ontdekt" of per ongeluk worden teruggedraaid.

### 16.1 Cron-beleid: niets draait automatisch tenzij het expliciet in `vercel.json` staat

De fix van `isCronPath()` (sectie 14 vermeldt 'm nog niet expliciet — hier alsnog vastgelegd)
loste een echte productiebug op: `/api/cron/*` werd door de login-wall van `middleware.ts`
geblokkeerd omdat `isCronPath()` alleen `/api/sync/cron` matchte. Bijwerking van diezelfde fix:
zodra hij live ging, werden de al in `vercel.json` geregistreerde crons (`evaluate-hypotheses`,
`evaluate-code-rood`) weer daadwerkelijk bereikbaar voor Vercel's scheduler.

De eigenaar wees dat expliciet af: **"cron mag niet live draaien. ik wil geen api kosten maken in
de nacht en ik wil zelf testen kunnen draaien."** Dit is dezelfde regel die eerder al gold voor de
SOP-trigger-cron ("ik wil handmatig kunnen triggeren voor tests en niet onnodig elke nacht
betalen") — nu bevestigd als een generiek beleid, niet een uitzondering per route.

**Het beleid, concreet:** een cron-route bestaat en werkt (bereikbaar via
`Authorization: Bearer $CRON_SECRET`, handmatig te triggeren, ook met `?dry_run=true`), maar komt
pas in `vercel.json` te staan op het moment dat automatisch draaien bewust gewenst is. Tot die tijd
staat er in de kop van de routefile zelf waarom hij bewust buiten `vercel.json` is gehouden.
Uitgevoerd voor `evaluate-hypotheses/route.ts` en `evaluate-code-rood/route.ts`; `vercel.json` bevat
nu alleen `/api/sync/cron` (05:00 dagelijks). Nieuwe crons volgen dezelfde regel: eerst bouwen en
handmatig testen, pas registreren als automatisch draaien expliciet is afgesproken.

### 16.2 Koerscorrectie: niet wachten op een echte klant om analysediepte te bouwen

Eerder deze sessie is een eigen, eerder door de eigenaar gestelde regel ("Fase 5 = klant live,
geen nieuwe bouw meer") herhaaldelijk aangehaald als reden om module-uitbreiding en
analysediepte-werk uit te stellen. De eigenaar heeft dat expliciet en met klem afgewezen:

> "waarom wachten op een klant???? [...] we kunnen toch op basis van developer documentation kijken
> wat de api kan ophalen? dan eventueel mock data plaatsen en op basis van documentation perfecte
> sops neerzetten en koppelen?? [...] tussentijds kunnen we extra mock data per kanaal toevoegen
> aan het demo account."

**Vastgelegd besluit, geldt vanaf nu structureel:** de "geen nieuwe bouw"-regel uit Fase 5 gaat
over het *live zetten bij een echte, betalende klant* — niet over analysewerk in het algemeen.
Analysediepte, nieuwe modules en kanaallogica mogen en moeten doorontwikkeld worden op basis van
officiële developer-documentatie plus (uitgebreide) mockdata in het demo-account, zonder op een
klantkoppeling te wachten. Verificatie tegen een echt, live account blijft een aparte, latere stap
(zoals nu ook al met andere open punten in secties 14/15) — maar is geen blokkade om te bouwen.

Twee harde randvoorwaarden die daarbij gelden, letterlijk van de eigenaar:

1. **Nooit hardcoden naar een specifieke bekende klant** ("het is nooit zomaar rai of ranking
   masters... het moet echt op basis van de klantnaam zijn"). Nieuwe logica, voorbeelden en
   mockdata moeten generiek per klant werken, nooit een specifieke naam als aanname bevatten.
2. **Design per kanaal moet de eigen logische structuur van dat kanaal volgen, niet blind het
   Google-patroon kopiëren** ("design moet wel kloppen met de logische keuzes per kanaal. niet
   blind doorvoeren"). `lib/campaign-types.ts` is de referentie om van te léren, niet een sjabloon
   om te klonen — Meta's ODAX-objectives en LinkedIn's campagnestructuur zijn structureel anders
   dan Google's Search/Shopping/PMax-indeling en verdienen een eigen vorm.

### 16.3 Actieve roadmap: campagnetype-diepte per kanaal (Google klaar, Meta/LinkedIn in opbouw)

Vervolg op de bevinding in sectie 14.1 (Meta en LinkedIn worden generiek/geblend behandeld, geen
objective- of campagnetype-branching). Op basis van 16.2 is dit nu een actief bouwpunt, geen open
vraag meer. Stand per 17 augustus:

**Meta — gebouwd: `lib/meta/campaign-types.ts`.** ODAX-objectives geverifieerd tegen
`developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/`: zes actuele objectives
(`OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`,
`OUTCOME_APP_PROMOTION`, `OUTCOME_SALES`), elk met een eval-criteria-lijst getoetst tegen de
daadwerkelijk bestaande kolommen in `meta_campaign_daily` (niet aangenomen — nagelopen tegen
`scripts/migrations/007_meta.sql:68-108`). App-promotie heeft daarin **geen enkele gedekte
metric** (geen installs/CPI/in-app-events-kolom) — eerlijk vier keer `available: false` in plaats
van gepadde criteria. `detectMetaObjective()` gebruikt in de eerste plaats het al aanwezige,
al ingevulde `objective`-veld (`meta_campaigns.objective`) en valt alleen op campagnenaam terug als
dat veld ontbreekt — het omgekeerde van Google Ads, waar naamdetectie de hoofdroute moet zijn
omdat er geen equivalent apiveld bestaat. Dat verschil is met opzet: het is precies de "niet blind
Google's patroon kopiëren"-eis uit 16.2.

**LinkedIn — gebouwd: `lib/linkedin/campaign-types.ts`.** Objectives geverifieerd tegen
`learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/
create-and-manage-campaigns`: zeven actuele `objectiveType`-waarden (`BRAND_AWARENESS`,
`ENGAGEMENT`, `JOB_APPLICANTS`, `LEAD_GENERATION`, `WEBSITE_CONVERSIONS`, `WEBSITE_VISITS`,
`VIDEO_VIEWS`), getoetst tegen `linkedin_campaign_daily`
(`scripts/migrations/008_linkedin.sql:132-165`). Job Applicants is hier het eerlijke gat
(vergelijkbaar met Meta's App-promotie, andere oorzaak: LinkedIn's job-board-metrics komen niet
mee via de standaard Analytics-API) — vier criteria met `available: false`, plus twee kliks-based
proxymetrics die expliciet gelabeld zijn als "indicatief", geen vervanging.
`detectLinkedInObjective()` volgt dezelfde regel als Meta: het al gevulde
`linkedin_campaigns.objective_type`-veld eerst, naamdetectie alleen als terugval.

**Bevindingen-engines gebouwd: `lib/meta/campaign-analysis.ts` en
`lib/linkedin/campaign-analysis.ts`.** Consumeren de taxonomiebestanden hierboven en produceren
`CampaignFinding`-achtige bevindingen (severity/category/actie/impactScore), met dezelfde
dedupe-op-hoogste-impact-logica als Google's `campaign-analysis.ts`. Eén bewust verschil, niet
overgenomen van Google: CPA/ROAS/CPL-baselines worden alleen BINNEN hetzelfde objective berekend,
nooit account-breed. Bij Google zijn "generic"/"category"/"shopping" onderling vergelijkbaar
(allemaal omzet-gedreven acquisitie), maar een cost-per-lead (LinkedIn Leadgeneratie) en een
cost-per-purchase (Meta Verkoop) zijn geen twee punten op dezelfde schaal — ze samen middelen zou
een vals signaal opleveren. Beide bestanden hebben een eigen test
(`__meta_campaign_analysis_test.ts`/`__linkedin_campaign_analysis_test.ts`) die dat specifieke
scenario vastlegt: een campagne met een niet-relevante metric-waarde voor haar eigen objective mag
de baseline van een ander objective niet beinvloeden.

**Alle vier bestanden staan bewust in `TOEGESTANE_WEZEN`** (`scripts/check-hygiene.mjs`, 17
augustus): de taxonomie- en de regel-laag zijn compleet en getest, maar hebben nog geen eigen
consument (route/UI) — exact dezelfde status als Google's `lib/campaign-analysis.ts` al langer
heeft. Open productbeslissing, geen automatische vervolgstap: worden deze bevindingen een los
scherm (zoals Google's `campaign-analysis.ts` kennelijk ooit bedoeld was), of voedt de al-live
SOP-pijplijn (`app/api/analysis/monthly/route.ts`, LLM-stap-gedreven, structureel anders dan deze
regelmachine) ze rechtstreeks? Die keuze raakt ook Google's al langer wachtende bestand en is dus
groter dan alleen Meta/LinkedIn — bewust hier alleen vastgelegd, niet zelfstandig beslist.

**Bijgewerkt (17 augustus, mockdata):** vier demo-campagnes toegevoegd (Meta: `OUTCOME_TRAFFIC`,
`OUTCOME_LEADS`; LinkedIn: `WEBSITE_VISITS`, `VIDEO_VIEWS`) zodat de demo-klant de nieuwe engines
over meer dan de oorspronkelijke twee/een objective test. `scripts/demo/seed-demo-client.ts
--check` bouwt de maandaggregatie nu rechtstreeks uit de dag-data en roept
`analyzeMetaCampaigns`/`analyzeLinkedInCampaigns` aan — live bewijs: 10 Meta-bevindingen over 4
objectives, 7 LinkedIn-bevindingen over 3 objectives. Losstaande constatering hierbij, niet
veroorzaakt door deze wijziging: het `[S10]` GRT-beursanalyse-scenario faalt in de huidige
`--check`-run (delta -0,06 i.p.v. de ontworpen ~-35%), vermoedelijk datumdrift in de
`TODAY`-relatieve rampfunctie van `googleMonthly()` — niet Meta/LinkedIn-gerelateerd, niet
opgelost, hier alleen vastgelegd.

### 16.4 Cross-channel-analyse liep buiten de maandcyclus om — nu automatisch gekoppeld

De eigenaar vroeg expliciet: *"vraag, zit hier dan ook direct de cross platform op? is dit al goed
gewired?"* en, na het antwoord, *"cross channel moet de basis zijn in de maandanalyse."* Nagelopen
en bevestigd: **nee, dat was het niet.** `app/api/analysis/monthly/route.ts` (de daadwerkelijke
maandelijkse SOP-run, drie losse aanroepen — één per kanaal, `body.channel`) riep nergens
cross-channel-code aan. `/api/analysis/cross-channel` was uitsluitend een **handmatige knop**
(`components/dashboard/cross-channel-analyses.tsx`, "Draai cross-channel-analyse"). Niets in de
trigger-keten (`app/api/cron/trigger-sops`, zelf nog niet actief in `vercel.json`) riep hem aan —
`lib/analysis/sop-channel-config.ts`'s `CHANNEL_CONFIG` kent alleen google/meta/linkedin_ads ×
weekly/biweekly/monthly, geen `cross_channel`-combinatie. Als een klant nooit zelf op die knop
drukte, werd overlap tussen kanalen (dubbele warme pool, ontbrekende prospecting, zaai-oogst,
KPI-arbitrage) dus nooit gecheckt, ook niet bij een reguliere maandelijkse SOP-run.

**Gefixt: cross-channel draait nu automatisch mee bij elke maandanalyse**, op twee plekken —
dezelfde logica, want de handmatige knoppen en de (nog niet actieve) cron draaien al dezelfde
routes op dezelfde manier (zie de koptekst van `trigger-sops/route.ts`):

1. `components/insights/sop-trigger-buttons.tsx`: zodra een `monthly`-knop voor een willekeurig
   kanaal slaagt, vuurt een achtergrond-`fetch` naar `/api/analysis/cross-channel` mee. Een fout
   daarin logt alleen naar de console — de al geslaagde kanaalanalyse blijft een succes.
2. `app/api/cron/trigger-sops/route.ts`: dezelfde koppeling, plus een `Set` die binnen één
   cron-invocatie voorkomt dat cross-channel drie keer draait als meerdere kanalen op dezelfde dag
   `monthly`-due zijn voor dezelfde klant.

**Waarom dit geen kostenrisico toevoegt:** `/api/analysis/cross-channel` is volledig
deterministisch, geen LLM-aanroep (`model_used: "deterministisch"`, `tokens_used: 0`, zie de
eigen koptekst van dat bestand) — alleen een handvol extra Supabase-reads per run. Dat is precies
waarom er geen dedupe-logica over meerdere cron-invocaties heen nodig was: opnieuw draaien
overschrijft dezelfde `sop_analysis_output`-rij (`sop_type "cross_channel"`) voor die dag, geen
stapelende kosten.

**Cross-account/portfolio, het tweede deel van de vraag ("kan zelfs automatisch zijn"): bleek al
zo.** `app/api/platform/agency-macrotrends/route.ts` en `app/api/platform/god-mode/route.ts` zijn
gewone GET-routes die live herberekenen bij elke paginabezoek (`runMacrotrends`, geen opgeslagen
SOP-output, geen trigger-knop) — geen handmatige stap om te vergeten, geen wijziging nodig.

**Nog niet gestart (in sectie 16.4's eerste versie):** of de cross-channel-bevindingen ook
rechtstreeks de per-kanaal LLM-promptcontext moeten voeden. Zie 16.5 — dat gat is dezelfde sessie
nog gedicht.

### 16.5 Cross-channel voedt nu ook de hypotheses zelf, niet alleen de trigger

Direct vervolg op 16.4. De eigenaar, na het antwoord over de automatische trigger: *"cross channel
moet absoluut voeden. hoe kan je anders je hypotheses daadwerkelijk cross channel maken?"* — terecht.
16.4 loste alleen op DAT cross-channel draait; niet dat een kanaal-hypothese er ook echt op rust.
Getriggerde cross-channel-signalen landden al in de hypothese-wachtrij (`saveSignalHypotheses`),
maar geen enkele kanaal-LLM-stap kreeg de cross-channel-bevindingen als promptcontext. Een
Meta-hypothese werd dus gegenereerd zonder te weten dat LinkedIn dezelfde warme pool retarget —
"cross-channel" in de trigger, niet in de redenering.

**Gefixt: `lib/analysis/cross-channel-context.ts` (nieuw), zelfde vorm als `lib/ga4/context.ts`
(`channelGa4Context`) — een call die de laatst opgeslagen cross-channel-markdown ophaalt
(`sop_analysis_output`, `sop_type "cross_channel"`, sectie `cross_channel_v1`) en er een
promptblok van maakt, met een expliciete analysedatum (kan van een eerdere cyclus zijn — de
allereerste kanaal-run van een maand vindt nog geen verse cross-channel-data, want die draait pas
ná een monthly-run, zie 16.4) en een instructie: gebruik dit om hypotheses te verrijken/nuanceren,
niet om kanaalcijfers te herschrijven of cross-channel-cijfers te verzinnen. Degradeert net als
GA4 stil naar `""` (nul promptwijziging) als er nog geen cross-channel-run bestaat.

**Landt uitsluitend in de hypotheses-stap, niet in de eerdere stappen** — bewust smal, om de
rest van elke kanaal-SOP ongemoeid te laten:
- Meta (`runMetaMonthlyAnalysis`) en LinkedIn (`runLinkedinMonthlyAnalysis`): stap 6, "Hypotheses
  en Sprintplanning" (beide `stepCount: 6`, bevestigd in `lib/analysis/adapters/{meta,linkedin}-
  ads.ts`).
- Google (hoofd-`POST`-handler, nog op de oudere 13-stappenstructuur): stap 13, "Hypotheses &
  Sprintplanning" — een andere plek in de code (`runStep` direct in de handler, niet via een
  gedeelde `buildXStepMessage`-helper), zelfde principe.

Alle drie volgen exact het bestaande GA4-patroon (`ga4ContextText`, alleen naar stap 1 geschoven)
— geen nieuw patroon uitgevonden, hetzelfde toegepast op een andere stap. Getest
(`__cross_channel_context_test.ts`, gemockte Supabase): geen eerdere run → lege promptContext;
wel een run → analysedatum expliciet in de tekst, nooit stilzwijgend als actueel gepresenteerd;
een uitzonderlijk lange cross-channel-sectie (veel getriggerde signalen) wordt afgekapt in plaats
van de prompt te laten ontsporen.

**Nog niet gestart:** of de per-campagne bevindingen uit sectie 16.3 (`lib/meta/
campaign-analysis.ts`, `lib/linkedin/campaign-analysis.ts` — zelf nog zonder consument) ooit
dezelfde weg naar de hypotheses-stap moeten vinden als de cross-channel-laag hier. Dat is een
aparte vraag: deze twee lagen zitten op een ander niveau (per-campagne-efficiency vs.
tussen-kanalen-overlap) en verdienen een eigen afweging, niet automatisch dezelfde behandeling.

### 16.6 Toegangscontrole voor cross-channel, cross-account en God View — nagelopen, één gat gefixt

De eigenaar stelde drie harde eisen tegelijk, vóór verder bouwen: *"cross channel moet alleen
geactiveerd worden als een account meer dan 1 kanaal heeft. cross account/portfolio alleen als de
module is afgenomen of de juiste tier betaald wordt. God view (of een van de andere varianten) mag
alleen als de module is afgenomen. maar allemaal moeten automatisch zijn."* Alle drie nagelopen
tegen de live code, niet aangenomen:

1. **Cross-channel bij >1 kanaal — ontbrak, nu gefixt.** `/api/analysis/cross-channel` draaide tot
   nu toe ook op accounts met precies 1 gekoppeld kanaal, en zou daar een lege of misleidende
   sub-analyse opleveren (`kpiRelations` bijvoorbeeld vergelijkt kanalen onderling — met één kanaal
   is er niets om te vergelijken). Gefixt **bij de bron**, niet alleen bij de aanroepers: de POST-
   handler zelf telt nu de distincte kanalen in de al-opgehaalde `blended_account_monthly`-rijen en
   geeft `409` met een expliciete reden terug als dat er minder dan 2 zijn — zodat elke huidige én
   toekomstige caller automatisch dezelfde regel krijgt, niet drie losse kopieën van dezelfde check.
   Aanvullend kregen de twee automatische triggers uit 16.4 ook een vroege check, zodat ze niet eens de
   nutteloze aanroep doen: `app/api/cron/trigger-sops/route.ts` hergebruikt de `kanalen`-lijst die
   het toch al ophaalt (`laadBeschikbareKanalen`) per klant; `components/insights/
   sop-trigger-buttons.tsx` kreeg een nieuwe `multiChannel`-prop, doorgegeven vanuit
   `client-dashboard.tsx`'s bestaande `kanalen`-state (dezelfde die de kanaaltabbladen al stuurt,
   zie `lib/kanalen/beschikbaar.ts`) — geen nieuwe databron, hergebruik van wat er al was.

2. **Cross-account/portfolio bij tier — bleek al correct.** `app/api/platform/agency-macrotrends/
   route.ts` (de "Macro"-view, UI-component heet verwarrend `agency-god-view.tsx` maar is dat niet
   — zie de eigen koptekst van die route) gate't al hard op `heeftTenminste(bureau.licentie,
   "growth")`, met een duidelijke upgrade-melding. Niets aangepast.

3. **God View bij module — bleek al correct, om een striktere reden dan gevraagd.** Twee dingen
   heten hier "God View" en geen van beide vergt een fix:
   - `app/api/platform/god-mode/route.ts` (het echte "God Mode": ongefilterd, platform-breed) is
     hard gegated op `auth.scope === ALL_CLIENTS` (platform-beheerders-lidmaatschap) — géén bureau
     of klant kan hier ooit bij, op geen enkele tier of module. Strenger dan "module afgenomen",
     want geen enkel bedrag koopt dit los; het is een intern platformtool.
   - Het GEMARKETE "God View"-module (`lib/marketing/modules.ts`, anonieme marktdata over bureaus
     heen) staat er expliciet met `gebouwd: false` en een koptekst die het onderscheid al vastlegt:
     "God View as described here... is a materially bigger feature than what exists". Er is dus
     geen route om per ongeluk ongegated te laten — de feature bestaat nog niet.

**Alle drie automatisch, zoals gevraagd** ("allemaal moeten automatisch zijn zodat de inzichten
daadwerkelijk op slimheid gebaseerd zijn"): cross-channel triggert automatisch bij elke monthly-run
(16.4) mits >1 kanaal (hierboven); Macro en God Mode zijn gewone GET-routes die al bij elke
paginabezoek live herberekenen (16.4's constatering), geen trigger-stap, alleen een toegangs-gate.
Niets hiervan vergt een handmatige "activeer dit voor deze klant"-stap ergens in een instellingen-
scherm — de gates zitten in de route zelf, op basis van live data (kanalen, tier, scope), niet op
een los te vergeten vlaggetje.

### 16.7 God View-kernlaag: de echte cijfers achter de cel-beslissing

Vervolg op 16.6's constatering dat het gemarkete "God View"-module (anonieme marktdata over
bureaus heen, `lib/marketing/modules.ts`) nog `gebouwd: false` is. De eigenaar: *"laten we dit
bouwen"* — verduidelijkt naar: alles uit 16.4-16.6 moet kloppen, én de God View-kernlaag mag
gestart worden. Gekozen startpunt, expliciet: **kernlaag eerst**, geen UI, geen tier-gating, geen
trend/churn/opportunity-lagen — eerst de rekenkern zelf goed en getest, dan pas een consument.

**Wat al bestond, hergebruikt in plaats van herbouwd:** `lib/benchmark/cel.ts` (de
k-anonimiteitsregel — 10 accounts EN 4 bureaus voor een los model/niche-segment, 25/8 voor de
combinatie, bewust zonder cijfers: "alleen de beslissing") en het opt-in-mechanisme
(`agencies.benchmark_optin_at`, migratie 064, al gebruikt door `app/api/admin/
benchmarkdekking/route.ts`). Wat ontbrak was de stap ERNA: gegeven rijen die door de
opt-in/k-anonimiteitspoort heen mogen, de daadwerkelijke benchmarkwaarde per cel uitrekenen.
`app/api/platform/god-mode/route.ts`'s eigen koptekst noemde `lib/benchmark/cel.ts` al "een
bouwsteen... nog niet klantzijdig ontsloten" — dat is precies het gat dat dit dicht.

**Nieuw: `lib/benchmark/god-view.ts`.** Twee ontwerpkeuzes die de rest van dit bestand rechtvaardigen:

1. **Mediaan van per-account CPA/ROAS, niet som/som.** `lib/macro/aggregate.ts` (het single-agency-
   equivalent) telt terecht ruwe totalen op — een bureau ziet zijn eigen boek. Cross-agency niet:
   totale spend/totale conversies over meerdere bureaus is precies het getal waarmee één
   account met uitzonderlijke spend de hele cel domineert, én waarmee een bureau dat zijn eigen
   cijfers kent de rest van de cel kan terugrekenen. Eerst per account een verhouding, dan de
   mediaan van die verhoudingen — bewezen in de test met een expliciete "som/som ZOU hier wél
   gedomineerd zijn"-vergelijking naast de mediaan-uitkomst.
2. **Elke metric zijn eigen k-anonimiteitscheck, niet alleen de cel als geheel.** Een cel kan de
   drempel halen (10 accounts, 4 bureaus) terwijl maar een handvol van die accounts ooit een
   conversie had — de rest telde alleen mee voor de accounttelling, niet voor de CPA-mediaan zelf.
   Zonder een aparte check op de subset die de mediaan daadwerkelijk voedt, zou die mediaan op een
   kleinere, herkenbaardere groep rusten dan de celtelling belooft. Elke metric loopt daarom zelf
   nog een keer door `beoordeelCel()` — dezelfde functie hergebruikt, geen tweede, losse drempel
   ernaast. Getest: een cel met 10 accounts waarvan er 2 een conversie hadden geeft `medianCpa:
   null` (subset te klein) maar wél een `medianRoas` (alle 10 hadden spend, die subset haalt de
   drempel gewoon).

**Getest (`__god_view_test.ts`):** onder de accountdrempel → geen metrics; genoeg accounts maar te
weinig bureaus → geen metrics (een cel mag niet aan één of twee bureaus herleidbaar zijn, ook niet
als het aantal accounts groot genoeg lijkt); op de drempel → metrics verschijnen; combinatie
model+niche heeft een eigen, hogere drempel dan het losse model; elke rij telt mee op elk niveau
waarop hij is afgebakend (model, niche, combinatie) — zelfde regel als `celoverzicht()`.

**Bijgewerkt (17 augustus, zelfde dag): de rest van de mechaniek is gebouwd.** De eigenaar, na de
vraag waarom dit nog niet verder ging: *"waarom is de rest nog niet gebouwd?? we hebben in theorie
2 agencies erin... in theorie kunnen we cross account/portfolio en god view doen."* Genuanceerd en
akkoord bevonden: met 2 bureaus kan `beoordeelCel()` (≥4 bureaus) wiskundig nooit een cel
deelbaar maken — geen "nog niet af", maar de k-anonimiteitsregel die precies doet waarvoor hij
bestaat. De eigenaar bevestigde dat expliciet ("ik weet dat het niet anoniem is") en gaf groen
licht om de MECHANIEK toch volledig te bouwen en te testen, puur voor de testfase: *"het kan wel
getest worden... de werking zelf kan wel uitgevoerd worden... puur in de test fase is dit gegrond
en goedgekeurd."*

Gebouwd, in dezelfde sessie:

1. **`lib/benchmark/god-view-data.ts`** — de IO-laag. Haalt opt-in-bureaus
   (`agencies.benchmark_optin_at`), accounts, `client_settings.bedrijfsmodel`/`niche` en de
   laatste volledige maand uit `blended_account_monthly` op, en filtert tot rijen die zowel
   opt-in als afgebakend zijn (zonder afbakening telt een account in geen enkele cel mee — zelfde
   regel als `bouwGodViewCellen()` zelf). Kanaal komt uit de data (`blended_account_monthly` heeft
   al een channel-kolom), geen vaste "google"-aanname zoals `benchmarkdekking/route.ts` die om een
   andere, daar wel geldige reden maakt (dat scherm telt alleen, heeft geen prestatiecijfers
   nodig). Conversies en leads tellen samen als acquisitie-actie, dezelfde conventie als
   `cross-channel/route.ts`'s KPI-verhoudingen — anders krijgt een leadgen-account stelselmatig
   CPA "oneindig". Getest (`__god_view_data_test.ts`): opt-in én afbakening moeten allebei kloppen
   voordat een account meetelt, los getest van elkaar.

2. **`app/api/platform/god-view/route.ts`** — testroute, hard gegated op `ALL_CLIENTS`-scope
   (zelfde gate als God Mode, geen tier-check: er is nog geen klant-tier die dit zou mogen
   ontsluiten, en met de huidige bureaupool zou een echte agency-gebruiker hier toch nooit iets
   zien). Retourneert de volledige celtabel plus een eerlijke stand (hoeveel bureaus, hoeveel
   cellen deelbaar) — bewijst de mechaniek zonder te doen alsof het al een productfunctie is.

3. **`lib/analysis/god-view-context.ts`** — de koppeling naar de maandanalyse, letterlijk
   *"hoe een maandanalyse zich verhoudt tot de god view tabel... en daar inzichten van
   vertalen"*: zoekt de diepste deelbare cel die bij de klant past (combinatie > niche > model),
   en zet die om in een promptblok voor de hypotheses-stap — zelfde patroon en zelfde plek als
   cross-channel (16.5): Meta/LinkedIn stap 6, Google stap 13. **Degradeert vandaag vrijwel altijd
   stil naar `""`** — met 2 bureaus is er gewoonweg nooit een deelbare cel, en dat moet geen
   "onvoldoende data"-ruis in elke run worden, net zomin als bij een klant zonder GA4. Getest
   (`__god_view_context_test.ts`) met **drie** scenario's: (a) vier bureaus/tien accounts →
   een echt promptblok met mediane CPA/ROAS en een expliciete anonimiteitsvermelding — het bewijs
   dat de mechaniek werkt; (b) een klant zonder eigen bedrijfsmodel/niche → stil leeg, geen
   lookup nodig; (c) de HUIDIGE realiteit (2 bureaus) → stil leeg, geen ruis — het scenario dat
   vandaag in productie daadwerkelijk geldt.

4. **Bijvangst: een echte tijdzonebug gefixt tijdens het dedupliceren.** `god-mode/route.ts` had
   zijn eigen lokale `laatsteVolledigeMaand()` op `new Date()`/`setUTCDate` — exact de valkuil die
   `lib/reporting-date.ts`'s eigen koptekst al documenteert (tussen 00:00 en 02:00 Amsterdamse
   tijd op de 1e van de maand zegt UTC nog de vorige dag, dus "laatste volledige maand" wees dan
   een maand te ver terug). Vervangen door het al bestaande, al Amsterdam-bewuste `monthsAgo(1)` —
   geen nieuwe functie nodig, `monthsAgo` deed dit al exact goed. Hergebruikt in `god-view-data.ts`.

**`lib/benchmark/god-view.ts` staat niet langer in `TOEGESTANE_WEZEN`** — heeft nu een echte
consument (`god-view-context.ts`, en daarmee de live maandanalyse-pijplijn).

**Nog steeds niet gestart, bewust:** een tier-/module-gate op de God View-route zelf (wacht op
echte multi-bureau-dekking, zoals 16.6 al vastlegde voor Macro/God Mode); een testfixture die
echt meerdere synthetische bureaus in de database zet om de admin-route ook live (niet alleen via
de unit tests) een gevulde cel te laten tonen — dat vergt schrijfrechten op de `agencies`-tabel
zelf, een andere en groter ingreep dan de gequarantainede single-tenant demo-klant, en is bewust
niet zonder expliciete toestemming gedaan; de trend/churn-risk/opportunity-lagen die de
marketingtekst belooft.

## 17. Live testrun tegen productie: echte bevindingen, echte fixes (17 augustus 2026)

De eigenaar vroeg letterlijk een monthly SOP te draaien op de demo-klant, alle kanalen, om te
zien hoe cross-channel/God View zich in de praktijk gedragen en hoe kwalitatief de output is. Dit
is voor het eerst deze sessie dat de LLM-pijplijn zelf (niet alleen de deterministische lagen)
tegen echte productie-infrastructuur is gedraaid, met echte OpenRouter- en Supabase-sleutels die
de eigenaar zelf aanleverde (zie 17.1 voor de herkomst).

### 17.1 Twee sleutels in de chat, één hergebruikt, twee routes om ze te krijgen

De eigenaar gaf een OpenRouter-sleutel direct, en voor Supabase opnieuw dezelfde
`SUPABASE_ACCESS_TOKEN` (Management API personal access token) als eerder deze sessie — al
gemarkeerd als "moet geroteerd worden" en nu een tweede keer in de chatgeschiedenis beland. Om
de app zelf (die een service-role JWT nodig heeft, geen Management-API-token) lokaal te kunnen
draaien is de Management API's `GET /v1/projects/{ref}/api-keys`-endpoint gebruikt om de
bijbehorende `anon`/`service_role`-JWT's op te halen — een legitieme, bestaande Supabase-
mogelijkheid, geen omweg. Alles kwam in een lokale `.env.local` (gegarandeerd genegeerd door git,
`.gitignore:34`), nooit gecommit, en na afloop verwijderd. **Beide sleutels — OpenRouter en
Supabase — moeten geroteerd worden**, expliciet aan de eigenaar gemeld.

### 17.2 Twee losstaande, echte bugs in de demo-seed gevonden tijdens de eerste échte insert-run

`scripts/demo/seed-demo-client.ts` en `teardown-demo-client.ts` waren tot vandaag nooit met
succes tegen de live database gedraaid — alleen via `--check` (in-memory, JS-getallen, ziet geen
van beide problemen):

1. **`delete` gebruikte de logische tabelnaam i.p.v. `fysiekeTabel()`.** Sommige tabellen zijn
   hernoemd naar een fysieke `_legacy`-naam met een view eroverheen (bijv. `meta_ad_daily` ->
   `meta_ad_daily_legacy`); de insert gebruikte al wel `fysiekeTabel()`, de delete ervoor niet.
   Gevolg: oude rijen bleven stilzwijgend staan (seed) of de delete faalde hard ("cannot delete
   from view", teardown). Beide bestanden gefixt; `insertViaSupabase` controleert nu ook de fout
   van de delete zelf, die stond er niet.
2. **Fractionele dag-snelheden (bijv. 0,25 leads/dag, voor lage-volume LinkedIn-scenario's) gingen
   naar `bigint`-kolommen** (`one_click_leads`, `external_website_conversions`,
   `linkedin_demographic_daily.leads`) die geen decimalen accepteren. Losse `Math.round()` per dag
   zou zulke snelheden structureel naar 0 afronden (0,25 rondt élke dag naar 0) en de
   S5/S6/S8/S9-scenario's leegtrekken; nieuwe `heelGetal()`-helper rondt cumulatief af
   (Bresenham-achtig) zodat de bedoelde som exact bewaard blijft. Geverifieerd met `--check` na de
   wijziging: alle scenario's triggeren nog identiek.

Resultaat: demo-greentech staat voor het eerst volledig en correct geseed in productie.

### 17.3 Cross-channel-koppeling werkt — met een echte, nu gefixte logicafout

Drie monthly-SOP-runs (Meta, LinkedIn, Google) tegen demo-greentech, plus een handmatige
cross-channel-trigger vooraf zodat stap 6/13 verse context had. Cross-channel-citaten kwamen
expliciet terug in zowel Meta's als LinkedIn's hypotheses-stap ("Blended cross-channel signaal",
de LinkedIn-vs-Google-conversieratiovergelijking) — de koppeling uit 16.5 werkt.

**Maar Meta's stap 6 beval "verruiming van het budget binnen Google Ads" aan — bínnen de
Meta-analyse.** LinkedIn's stap 6 gebruikte in dezelfde run hetzelfde cross-channel-blok wél
correct: alleen als onderbouwing, acties bleven LinkedIn-eigen. **Gefixt:**
`crossChannelContext()` (`lib/analysis/cross-channel-context.ts`) kreeg een verplicht
`channel`-argument; de instructie noemt nu expliciet het eigen kanaal als enige toegestane
actie-scope, met een letterlijk verboden voorbeeldzin ("verhoog het budget van Google Ads")
zodat een ander kanaal noemen nooit meer hetzelfde is als er een actie voor aanbevelen. Getest
(`__cross_channel_context_test.ts`): Meta- en LinkedIn-promptteksten verschillen nu aantoonbaar
op exact dit punt.

### 17.4 Google faalde de kwaliteitspoort — een echt gat in het repair-mechanisme, niet in de regel

Google's run werd geblokkeerd bij stap 7 ("Demand & Search Intelligence", de samengevoegde 7a+7b
zoektermanalyse): het model claimde `"deterministic"` bewijsniveau op findings die het narratief
zelf al "niet beschikbaar" noemde, plus een verboden woord ("Onderzoek...") in een actiepunt. De
kwaliteitspoort deed hier precies zijn werk — dit is geen valse-positiefbug in de regel zelf.

**Het echte gat:** stap 7a/7b was, anders dan elke andere stap in zowel de Google- als de
Meta/LinkedIn-route, de ENIGE zonder repair/retry-mechanisme. Elke andere stap krijgt bij een
validatiefout een herkansing (`shouldRepairStep`/`buildStepRepairUserMessage`/
`pickBetterStepAttempt`, al overal elders gebruikt); stap 7 blokkeerde in één keer, zonder dat het
model ooit de kans kreeg zichzelf te corrigeren. Gefixt: dezelfde repair-cyclus toegepast op de
SAMENGEVOEGDE 7a+7b-output (de validatie draait al op de merge, niet op de losse helften) — één
extra `runStep()`-aanroep in JSON-modus met de exacte foutmeldingen als feedback, alleen
overgenomen als het resultaat niet slechter is dan het origineel. Tokens en retries van de repair
tellen nu mee in de opgeslagen/gerapporteerde totalen (stonden er eerst niet in).

### 17.5 God View-testmodus: expliciete, gelabelde drempeloverschrijving — nooit de standaard

De eigenaar, met klem: *"anonimiteit in de test fase boeit me niet... bij relevantie moet het
gewoon getriggerd worden."* Met de huidige, kleine bureaupool is de echte drempel nooit haalbaar
(16.6/16.7), en de vraag was niet "verzwak de regel" maar "laat de mechaniek zien werken".

`lib/benchmark/cel.ts`'s `beoordeelCel()` en `lib/benchmark/god-view.ts`'s `bouwGodViewCellen()`
kregen een optioneel `Celdrempels`-argument (`{minAccounts, minBureaus,
minAccountsCombinatie, minBureausCombinatie}`), standaard `undefined` — zonder dit argument
gelden altijd de echte module-constanten, voor élke bestaande aanroeper ongewijzigd, inclusief de
live SOP-hypotheses-stap via `god-view-context.ts`. Alleen `/api/platform/god-view` (al
`ALL_CLIENTS`-gegated) kreeg een `?testdrempel=true`-query-parameter die de drempel expliciet naar
1 account/1 bureau zet (2/1 voor de combinatie) en de respons `testMode: true` plus een
waarschuwing meegeeft, zodat dit nooit met een echte, k-anonieme uitkomst te verwarren is. Getest:
dezelfde celdata is `metrics: null` zonder het argument en `metrics: {...}` mét — de standaard
blijft aantoonbaar ongewijzigd.

### 17.6 Een echte, live merknaam-lek gevonden: "Ranking Masters" in elke OpenRouter-aanroep

Bij het bekijken van de OpenRouter-kostendashboard bleek "Top Apps" de aanroepende app te tonen
als `https://ranking-masters-dashboard.vercel.app` — een naam die de eigenaar deze sessie
herhaaldelijk en met klem heeft afgewezen als hardcoding-voorbeeld. Gevonden:
`lib/analysis/openrouter-client.ts:210` had een hardgecodeerde `HTTP-Referer:
"https://ranking-masters-dashboard.vercel.app"` in ELKE OpenRouter-aanroep die dit product ooit
doet — een restant van vóór de rebrand naar Ctrl PPC, nooit meegenomen toen de rest van het
product wél werd hernoemd. Gefixt naar `https://www.ctrlppc.com` plus een `X-Title: "Ctrl PPC"`
-header (ontbrak, hoort er ook bij).

**Breder gecheckt, de rest bleek legitiem.** Elke andere plek waar "Ranking Masters" in de
codebase voorkomt is een BEWUSTE, al langer bestaande bescherming tegen precies dit probleem, geen
lek: `lib/branding/brand.ts`'s `LEGACY_OWNER_TEAM` en `lib/schema/analysis-schema.ts`'s
Owner-schema normaliseren historische databasewaarden (rijen van vóór de naamswijziging naar RAI
Amsterdam, en daarvoor) bij het LEZEN, zodat oude rijen nooit ongeldig worden of verkeerd
meetellen — met het expliciete voornemen dat die lijst "hoort te krimpen, niet te groeien".
`lib/clients.ts` heeft een interne `id: "ranking-masters"` als STABIELE opslagsleutel (de comment
zegt letterlijk waarom: "dat is een sleutel waar opgeslagen rijen naar verwijzen"), met als
zichtbare naam al "RAI Amsterdam" — nergens toont de UI de oude naam. Niets hiervan aangepast;
alleen de daadwerkelijke, zichtbare lek (de OpenRouter-header) was een echt gat.

### 17.7 Kosten: hoger dan geschat, en waarom — de "reasoning-laag" (Grok 4.6) werd niet meegeteld

Eerste schatting (louter op `tokensUsed` × Gemini 3.7 Flash-prijzen): €0,09–€0,42, realistisch
~€0,17. Werkelijke OpenRouter-rekening over dezelfde periode: **$0,41** (na correctie van een
eerder gedeeld, verkeerd screenshot). Verklaring gevonden: `lib/analysis/llm-router.ts` kent naast
de tier-gebaseerde `MODEL_CATALOG` (alleen Gemini) een APARTE `LAYER_MODEL`-tabel met een
`reasoning`-laag die `x-ai/grok-4.6` als primair model gebruikt (fallback: Gemini 3.7 Flash) —
zichtbaar bevestigd in de OpenRouter-grafiek (Grok 4.6-balken binnen exact het testvenster) en in
`lib/analysis/o2-targets-cost.ts`'s eigen prijstabel: Grok 4.6 kost $2,00 in / $6,00 uit per 1M
tokens, ruim 5x zo duur als Gemini 3.7 Flash. De checkpoint-/synthese-stappen ("redeneren over
eerder werk, geen los datapunt", `lib/analysis/helpers.ts:388`) gebruiken deze laag — mijn
schatting nam alleen de tier-keten mee en miste deze aparte, duurdere laag volledig. Geen bug,
een onvolledige kostenschatting van mijn kant.

### 17.8 Nog niet gestart: de kwaliteitslat naar 9/10, en de kanaaloverstijgende synthese-output

De eigenaar zette een harde kwaliteitslat: *"prima start, maar die 5/10 moet naar een steady 9/10
voordat we kunnen verkopen."* En een structurele eis, herhaald en aangescherpt: cross-channel moet
niet alleen per kanaal geïnjecteerde context zijn (16.5, nu kanaal-scoped, 17.3), maar een eigen,
gesynthetiseerde, kanaaloverstijgende output — *"het beste van alle kanaal inzichten omgetoverd
naar 1 concrete goede output."* Vandaag gefixt: de directe logicafout (17.3) en het repair-gat
(17.4). Nog niet gebouwd: de eigenlijke cross-channel-synthese-stap (een nieuwe, LLM-gedreven laag
bovenop de al-deterministische signalen) — te groot en te architectuurbepalend om er zonder
scope-bevestiging aan te beginnen. Ook nog niet gestart: GreenTech's drie sub-accounts (Amsterdam/
GRT, North America/GRN, Americas/GRA) als aparte eenheden behandelen in cross-account-analyse —
vandaag bestaat die scheiding alleen als naamgevingsconventie in campagnenamen en
`geo_clone_settings`, niet als aparte account-rijen; welke van de twee de eigenaar wil (echte
scheiding vs. een vergelijkingslaag bovenop de bestaande geo-clone-dimensie) is nog niet
vastgesteld.

### 17.9 17.6 was te vroeg tevreden — een tweede, bredere sweep met een strengere maatstaf

De eigenaar wees 17.6's conclusie expliciet af: *"zichtbare naam moet ctrl ppc zijn. niet rai,
niet rai Amsterdam, niet ranking masters, niet rm"* — vier met naam genoemde verboden vormen, "RAI
Amsterdam" nadrukkelijk inbegrepen. 17.6 had die naam nog als "nergens toont de UI de oude naam"
beoordeeld; dat bleek een te lage lat. Herzocht met de brede grep uit 17.6 zelf, dit keer elke
hit individueel gelezen in plaats van op bestandsniveau aangenomen:

**Echte, zichtbare lekken gevonden en gefixt:**
- `components/dashboard/dgm-view.tsx`: twee letterlijke, gerenderde UI-strings — "Open RM" (een
  statkaart-label) en "...kan RM niet verder met afhankelijke taken" (een waarschuwingszin). Beide
  verwezen naar de interne kant van een taak (tegenover "klant"), niet naar de tool. Gefixt door
  het bestaande `ownerLabel()`/`OWNER_TEAM` uit `lib/branding/brand.ts` te gebruiken — hetzelfde
  mechanisme dat `sprint-planning.tsx` en `eigenaar-kiezer.tsx` al gebruiken — in plaats van de
  letterlijke afkorting. Geen nieuwe abstractie, hergebruik van wat er al stond.
- `lib/prompts/sop-prompts.ts` (regels 225-231): de LLM-promptvoorbeelden voor
  verantwoordelijkheidstoewijzing gebruikten "RM bouwt campagne" / "RM optimaliseert..." — zeven
  keer — terwijl de regel direct erboven (216-217) al correct "**Bureau**" als rolnaam
  introduceert. Dit is het gevaarlijkste type lek van de twee: een promptvoorbeeld dat het model
  voordoet hoe het zelf mag praten, met reëel risico dat "RM" letterlijk terugkomt in een
  gegenereerde hypothese of taak die een klant te zien krijgt. Alle zeven naar "bureau" gefixt,
  consistent met de al-bestaande rolnaam.
- `lib/clients.ts`: de demo-klant `id: "ranking-masters"` (sleutel blijft, zie 17.6) toonde als
  naam "RAI Amsterdam" — een echte, bestaande, herkenbare locatie (Amsterdam RAI), en dus precies
  het soort naam die de eigenaar nu expliciet uitsluit, los van of hij toevallig ook aan het oude
  merk deed denken. Gewijzigd naar "Beursgroep Amsterdam": fictief, past bij de stijl van de
  overige demo-klanten (Broedservice, Wobblez, Sabe, ...), en de onderliggende
  beurs/geo-clone-machinery (`lib/rai/*`, `RAI_GEO_CLONES`) blijft functioneel ongewijzigd — dat is
  interne modulenaamgeving, niet een zichtbare klantnaam.

**Nagekeken en bewust ongewijzigd gelaten (geen zichtbare tekst, alleen interne naamgeving):**
`rmLogoDataUri`/`rmLogoUrl`-variabelen en `// RM logo`-comments in de drie PDF-renderers
(`lib/client-reports/pdf-renderer.ts`, `lib/second-opinion/pdf-renderer.ts`,
`lib/analysis/sop-pdf-renderer.ts`, plus de route die ze aanroept) laden allemaal al correct
`BRAND_LOGO_FILE` = `"ctrl-ppc-logo.png"` — het daadwerkelijk ingesloten logo is al goed, alleen de
variabelenaam is verouderd. Hernoemen zou ~25 aanroepplekken raken voor nul zichtbaar effect; niet
gedaan. Dezelfde afweging voor de "RM-blauw"/"RM-huisstijl"-comments in
`components/branding/brand-theme-provider.tsx` en `brand-header-bar.tsx` (puur documentatie van
wélke kleur de CSS-fallback is, geen tekst die ooit rendert) en voor de testbestanden die de
`LEGACY_OWNER_TEAM`-normalisatie testen (interne dekking van 17.6's bewust blijvende mechanisme).

**Les:** "geen van de UI-bestanden toont het" (17.6) was de verkeerde toets. De juiste toets is per
string: rendert dit ooit, direct of via een LLM die het prompt-voorbeeld overneemt, op een scherm
dat een klant ziet? Bij twijfel de string lezen in volledige context, niet het bestand op naam
beoordelen.

### 17.10 De lat gaat nog een keer omhoog: geen enkele referentie meer, ook niet intern — IP-risico

Meteen na 17.9, met klem: *"ook intern, er mag nergens een link naar ranking masters (rm) of de
rai zijn! mocht het ooit tot een ip issue komen mag er nergens in mijn code een referentie naar
deze partijen zijn."* Dat is een principieel andere maatstaf dan 17.6 en 17.9 — niet meer "toont
dit aan een klant", maar "staat dit ergens in de broncode, zichtbaar of niet". Alles wat 17.9 nog
bewust liet staan (variabelenamen, kleurcommentaar, de LEGACY_OWNER_TEAM-lijst) valt hier alsnog
onder. Vier categorieën, in aflopende ernst:

**1. Een publiek, live bereikbaar logobestand — het grootste lek van de hele sessie.**
`public/images/ranking-masters-logo.png` bleek een echt, 159KB PNG-bestand: het volledige
"Ranking Masters"-woordmerk met mascotte én de oude tagline ("Dé #1 SEM specialist in de
Benelux"), rechtstreeks downloadbaar vanaf de live productie-URL, zonder login, voor iedereen. Dit
stond niet in enige code-referentie (`BRAND_LOGO_FILE` wees er nooit naartoe) en was dus door geen
enkele eerdere grep-op-code te vinden — alleen door het `BEKENDE_GATEN`-spoor in
`lib/branding/__brand_test.ts` te volgen ("het logobestand ontbreekt") tot het daadwerkelijke
bestand op schijf. Verwijderd. Er is nu geen enkel logobestand meer op die plek — een bekend,
genoteerd gat (zie de test) totdat er een echt Ctrl PPC-logo aangeleverd wordt.

**2. De module-naamgeving: `lib/rai/` → `lib/fair/`.** Een hele submap (28 bestanden, ~130
importplekken) heette naar de reële, bestaande RAI Amsterdam-beursorganisatie waarvoor dit product
oorspronkelijk is gebouwd — inclusief `RAI_GEO_CLONES`, `RaiEdition`, `RaiDataPoint`,
`RaiEventCfg`, en tientallen commentaren die "RAI" met naam noemden als de echte partij achter het
ontwerp (bijv. "is de afkorting bevestigd tegen RAI's conventie?"). Hernoemd naar het al
aanwezige, generieke domeinwoord "beurs"/"fair" (dat woord stond al overal in dezelfde bestanden:
`FairCadence`, `FairWeek`, `fairWeekLabel`). Twee losstaande, echte bugs gevonden tijdens het
hernoemen: een `import()` met een relatief pad in `scripts/demo/seed-demo-client.ts` gebruikte nog
het oude pad (zou pas bij uitvoering gefaald zijn, niet bij tsc) en `scripts/check-hygiene.mjs`'s
`TOEGESTANE_WEZEN`-allowlist verwees nog naar de oude bestandsnamen (zou de hygiënepoort ten
onrechte hebben laten falen). Beide gefixt vóórdat de poorten opnieuw draaiden.

**3. De opgeslagen eigenaarsrol: `LEGACY_OWNER_TEAM` geleegd, met een echte, live database-
afhankelijkheid.** Deze constante in `lib/branding/brand.ts` hield elke historische productnaam
aan zodat 38 bestaande `sprint_items`-rijen (geteld 3 augustus 2026) bij het lezen als teamtaak
bleven tellen. De lijst is nu leeg — geen naam van een externe partij staat nog in de broncode.
`scripts/migrations/097_owner_role_normalize.sql` (nieuw, genummerd, idempotent) zet de kolom zelf
om naar de rol ("Bureau") — **uitgevoerd tegen productie op 17 augustus 2026** via de Supabase
Management API (credentials door de eigenaar zelf aangeleverd, met expliciete instructie ze deze
sessie te onthouden tot hij zegt "vergeet ze"). Geverifieerd: alle 38 rijen tonen nu "Bureau", geen
enkele rij met een oude naam meer. Het oude, ongenummerde
`scripts/rename-owner-to-rai.sql` (STATUS: UITGEVOERD 28 juli 2026, bevatte de naam in zijn
bestandsnaam) is verwijderd; zijn geschiedenis staat nu alleen nog hier.
`lib/branding/__brand_test.ts`'s zelftest ("geen losse vermelding meer") controleerde tot nu toe
via `LEGACY_OWNER_TEAM` zelf — een lege lijst had die controle stilzwijgend uitgeschakeld, precies
het soort test-die-niets-meer-test waar de hygiënepoort op let. Losgekoppeld: de test heeft nu zijn
eigen, vaste lijst verboden namen, onafhankelijk van wat LEGACY_OWNER_TEAM bevat.

**4. Tientallen kleinere referenties**, gevonden via herhaalde brede greps tot er niets meer over
was: een letterlijk zichtbare "RAI-template" in de audit-UI (`second-opinion-view.tsx`), een
tweede demo-klantnaam met de echte locatienaam (`lib/feed/owners-mock.ts`, naast de al in 17.9
gefixte `lib/clients.ts`), en tientallen commentaren in `lib/auth/roles.ts`,
`lib/branding/theme.ts`, `lib/security/sanitize-llm-payload.ts`,
`lib/analysis/search-term-guardrails.ts`, `components/dashboard/event-settings.tsx`,
`lib/events/account-event-analysis.ts`, `app/globals.css`, en de PDF-renderers
(`rmLogoUrl`/`rmLogoDataUri` → `brandLogoUrl`/`brandLogoDataUri`, "RM logo" → "Brand logo") die de
oude namen als toelichting gebruikten. Overal generiek gemaakt ("beursklant", "beursorganisatie",
"standaardblauw", "standaard huisstijl") zonder betekenis te verliezen.

**Bewust nog niet aangepakt, met reden:**
- De `--rm-`/`text-rm-*`/`bg-rm-*`-naamgeving in `app/globals.css` en Tailwind-klassen: 112
  bestanden gebruiken deze twee-letterige prefix als kleurtoken (bijv. `text-rm-blue-ink`). Dit is
  een interne afkorting, geen herkenbare naam op zichzelf, en zit te diep verweven (CSS-variabelen
  + honderden losse klassenamen) om zonder een aparte, voorzichtige sessie te hernoemen zonder het
  risico op een visuele regressie over het hele dashboard. Gerapporteerd, niet gedaan.
- `lib/clients.ts`'s interne sleutel `id: "ranking-masters"` (de zichtbare `name` is al in 17.9
  gefixt naar "Beursgroep Amsterdam"): dezelfde categorie risico als punt 3 hierboven — een
  opgeslagen sleutel waar demodata mogelijk naar verwijst. Niet aangeraakt zonder een vergelijkbare,
  gecoördineerde migratie.
- `scripts/migrations/024_rai_events.sql` en de kolomnaam `client_settings.rai_events` die het
  toevoegt: een al toegepaste, genummerde migratie (bijgehouden op bestandsnaam in
  `schema_migrations`, dus niet zomaar te hernoemen) plus een echte, live productie-kolomnaam.
  Hernoemen vereist een gecoördineerde schema-migratie (ALTER TABLE ... RENAME COLUMN) plus een
  gelijktijdige code-wijziging op alle ~16 plekken die de kolom aanspreken — niet iets om zonder
  productietoegang en zonder overleg te doen. Genummerde, al toegepaste migraties (`024`, `035`)
  zijn sowieso nooit herschreven: net als git-geschiedenis zijn het onveranderlijke records van wat
  er al tegen productie is uitgevoerd.
- Git-geschiedenis: elke eerdere commit in deze branch bevat de oude namen nog letterlijk. Dat is
  met normale, niet-destructieve middelen niet op te lossen — alleen een volledige
  geschiedenis-herschrijving (force-push, breekt elke andere kloon) zou dat doen, en dat vereist
  aparte, expliciete toestemming.

### 17.11 De twee grootste openstaande punten uit 17.10 alsnog gedaan, dezelfde dag

**Migratie 097 uitgevoerd.** De eigenaar deelde de OpenRouter-sleutel en de Supabase Management-
credentials opnieuw, met de expliciete instructie ze deze sessie te blijven onthouden tot hij zegt
"vergeet ze" — een bewuste uitzondering op de standaard "vergeet secrets zodra ze niet meer nodig
zijn"-reflex. Met die credentials `scripts/migrations/097_owner_role_normalize.sql` rechtstreeks
tegen productie gedraaid via de Supabase Management API (`POST .../database/query`): eerst een
SELECT ter controle (bevestigde exact de 38 "RAI Amsterdam"-rijen uit 17.10), dan de UPDATE, dan
een tweede SELECT ter verificatie — alle 38 rijen tonen nu "Bureau". Geen tijdelijke
weergaveregressie meer.

**De `rm-`-CSS/Tailwind-naamgeving alsnog gedaan.** De eigenaar, direct na 17.10: *"de kleuren en
letters in de context van ranking masters moeten er ook uit."* Twee onderdelen, geen van beide een
visuele wijziging voor een echte gebruiker:

- De kleuren zelf (`#4f46e5`/`#f5960b`) zijn al sinds 16 augustus (sectie 13.2) de nieuwe, gekozen
  huisstijl — niet de oude Ranking Masters-tint (`#08288C`/`#F16B37`, die al verving is). Alleen de
  TOKENNAMEN (`--rm-*`, `text-rm-*`, `bg-rm-*`, ...) droegen de oude afkorting nog, verspreid over
  112 bestanden. Hernoemd naar `--brand-*`/`text-brand-*`/etc. — zelfde kleurwaarden, andere naam,
  dus geen enkel pixel verandert. Ook `lib/branding/brand-header-bar.tsx`'s illustratieve
  code-comment gecorrigeerd: die citeerde nog letterlijk de OUDE hex-waarden (`#08288C → #F16B37`)
  als voorbeeld van "het standaardpalet" — dat was al sinds 16 augustus feitelijk onjuist, nu
  vervangen door de echte huidige standaardkleuren.
- "Gilroy" (het commerciële lettertype in `--font-heading`) bleek bij nader inzien nooit
  daadwerkelijk te laden voor een echte bezoeker: de `@font-face`-regels hadden alleen
  `local()`-bronnen, geen gehost bestand — het rendert dus alleen bij een bezoeker die het toevallig
  zelf al geïnstalleerd heeft (typisch: de oorspronkelijke ontwerper op zijn eigen machine, nooit
  een echte site-bezoeker). `--font-heading` viel voor vrijwel iedereen al stil terug op "Ubuntu".
  Verwijderd: de twee `@font-face`-regels, "Gilroy" uit `--font-heading` en uit
  `lib/branding/theme.ts`'s `DEFAULT_THEME.headingFont`. Geen zichtbaar verschil voor een echte
  bezoeker, wel een minder unlicensed-fontverwijzing in de broncode. Bewust NIET aangeraakt:
  "Gilroy" als voorbeeldwaarde in de GreenTech-demo-brandguide en het invoerveld-placeholder in
  `branding-view.tsx` — dat is een klant die zelf voor dit lettertype kiest in zijn eigen brand
  guide, niet een verwijzing naar de oude Ranking Masters-identiteit.

Onderweg nog een gemiste identifier gevonden en gefixt: `interface RaiEvent` (lokaal gedefinieerd
in zowel `event-settings.tsx` als `geo-clone-settings.tsx`, buiten de `lib/fair/`-module en dus
niet meegenomen door de eerdere identifier-rename) → `FairEvent`.

Van de vier punten die 17.10 bewust liet staan, resteren nu alleen de twee met een echte,
gecoördineerde database-afhankelijkheid (`lib/clients.ts`'s interne `id: "ranking-masters"` en de
kolomnaam `client_settings.rai_events`) en git-geschiedenis zelf.

## 17.12 De twee grootste openstaande punten: kanaaloverstijgende synthese + geo-clones als unieke eenheden

De eigenaar, direct na 17.11: *"tijd om dit op te pakken lijkt me"* (de synthese-stap) en, over
GreenTech's sub-accounts: *"voor nu mag je [ze] als 3 losse eenheden beschouwen (ik wil ze wel bij
elkaar krijgen in het totaal overzicht van greentech zelf) maar de afkortingen en aparte accounts
moeten als uniek gezien worden in deze analyses."* Beide gebouwd, getest, groen door de poorten.

### 17.12.1 Kanaaloverstijgende synthese

**Architectuur-onderzoek eerst.** Er bleek geen enkele plek te bestaan die "alle kanalen voor deze
klant deze cyclus zijn klaar" bijhoudt — de cron (`trigger-sops`, niet actief) en de handmatige
knoppen behandelen elk kanaal als een op zichzelf staande trigger. Nieuw gebouwd:

- `lib/analysis/cross-channel-synthesis.ts`: haalt per kanaal de al opgeslagen
  `structured_monthly_v2` op (dezelfde tabel/sectie als elke kanaalanalyse al schrijft), plus de
  bestaande deterministische `cross_channel_v1`-signalen. `readyForSynthesis()` eist dat ALLE
  beschikbare kanalen deze cyclus al klaar zijn — één ontbrekend kanaal betekent wachten, nooit een
  synthese over een deel van de kanalen die zich als compleet presenteert. `alreadySynthesized()`
  voorkomt een dubbele, kostbare call als meerdere kanalen dezelfde dag na elkaar afronden.
- De LLM-call loopt via de bestaande "reasoning"-laag (Grok 4.6) — precies het gebruik waarvoor die
  laag al bedoeld was ("redeneren over eerder werk, geen los datapunt"). De prompt eist expliciet
  ÉÉN samenhangend verhaal (niet drie kanalen na elkaar samengevat), benoemt tegenspraken tussen
  kanalen als die er zijn, en staat een actie alleen toe met een ECHT, aangeleverd kanaal als label
  — een verzonnen kanaal wordt bij het parsen weggefilterd, niet vertrouwd.
- Nieuwe route `app/api/analysis/cross-channel-synthesis` (GET voor de laatste synthese, POST om 'm
  te draaien) — dezelfde skip-als-409-stijl als de bestaande cross-channel-route.
- Orkestratie: zowel de handmatige knoppen (`sop-trigger-buttons.tsx`) als de cron
  (`trigger-sops/route.ts`) triggeren de synthese nu ná de deterministische cross-channel-call, bij
  elke afgeronde maandanalyse. De route zelf beslist of het al zover is (skip anders) — elk kanaal
  dat afrondt mag 'm dus altijd aanroepen, alleen het laatste kanaal doet daadwerkelijk de call.
- UI: een nieuwe kaart bovenaan `cross-channel-analyses.tsx`, boven de bestaande deterministische
  sub-analyses.
- Getest zonder een echte LLM-call nodig te hebben: `runCrossChannelSynthesis` accepteert een
  injecteerbare `callFn` (zelfde patroon als `callRouted`/`callLayer` al hadden), dus zowel de
  skip-paden als het volledige succespad zijn gedekt met een gemockte call.

### 17.12.2 Geo-clones als unieke eenheden, met een accounttotaal ernaast

**Bevinding, tegen de code gecontroleerd:** geen enkele plek in `app/api/analysis/monthly/route.ts`
kende `lib/fair/geo-clone-catalog.ts` — campagnedata van een account met meerdere geo-clones (zoals
GreenTech Amsterdam/Americas/North America) werd stilzwijgend geblend tot één accounttotaal, zonder
dat de LLM ooit wist dat het om aparte sub-accounts ging.

- `lib/fair/geo-clone-aggregate.ts`: nieuwe `aggregateAllGeoClones(rows, catalog?)` bovenop de
  al-bestaande, ongewijzigde `aggregateCampaignMonthlyByGeoClone()`. Levert alle drie tegelijk: een
  losse `GeoCloneSummary` per gevonden geo-clone (`perGeoClone`), campagnes die geen enkele
  afkorting matchen apart (`unmatched`, nooit stilzwijgend meegeteld — dezelfde regel als de
  catalogus zelf al had), en het accounttotaal (`total`, gewoon alle rijen samen) — precies de twee
  dingen die de eigenaar allebei wilde, naast elkaar in plaats van een keuze ertussen.
- `lib/analysis/geo-clone-context.ts`: nieuw promptblok, zelfde rol en vorm als
  cross-channel-context.ts/god-view-context.ts. Haalt de laatste 3 maanden campagnedata op, en bij
  GEEN geo-clone-afkortingen in de campagnenamen (verreweg de meeste klanten) — `available: false`,
  `promptContext: ""`, nul wijziging. Bij wél geo-clones: elk sub-account met naam, afkorting en
  kerncijfers, het accounttotaal ernaast, en een expliciete instructie om sub-accounts nooit te
  mengen maar wel te vergelijken.
- Gewired in Google's stap 13 (Hypotheses & Sprintplanning), zelfde injectiepunt als de
  cross-channel- en God View-context. Alleen Google: `ads_campaign_monthly` is de tabel met
  campagnenamen waar de geo-clone-afkortingen in staan; Meta/LinkedIn hebben vandaag geen
  equivalente, geo-clone-getagde databron.
- Bewust NIET gedaan: GreenTech fysiek opsplitsen in drie aparte `client_id`/accounts-rijen. De
  eigenaar bevestigde expliciet dat de bestaande geo-clone-dimensie (campagnenaam-afkorting) de
  juiste laag is, niet een structurele accountsplitsing — minder ingrijpend, en de sub-accounts
  blijven zo automatisch "bij elkaar in het totaaloverzicht van GreenTech zelf".

### 17.13 Live testrun tegen productie: geo-clones bevestigd werkend, één echte bug gevonden en gefixt

Op verzoek van de eigenaar ("absoluut") getest tegen echte productie-infrastructuur
(demo-greentech), zelfde patroon als de eerdere live test (17.1-17.8): lokale server tegen de
echte Supabase/OpenRouter-credentials.

**Geo-clone-segmentatie: bevestigd werkend, met bewijs in de ruwe output.** Stap 13 van Google's
monthly-analyse citeerde letterlijk: *"Sub-account GRN (3 maanden: €2.700, 24 conversies, CPA
€112,50) draagt de Display-lekkage; GRT (€20.400, 130 conversies, CPA €156,92) draagt de gekapte
Search-winnaar. Overig blijft de goedkoopste pocket (CPA €27,66) en mag niet worden weggemiddeld."*
Die laatste zin is vrijwel een citaat uit de instructie in `geo-clone-context.ts`. Sub-accounts
worden dus daadwerkelijk als unieke eenheden behandeld, niet blind geblend.

**Een echte, bestaande bug (niet van vandaag) opnieuw tegengekomen.** Google's eerste run
blokkeerde op de kwaliteitspoort: stap 7 beweerde "deterministic" bewijsniveau op een zoekterm-
bevinding terwijl het narratief zei dat keyword-databeschikbaarheid ontbrak — zelfde bugklasse als
17.4, nu op een andere bevinding. De repair-poging (17.4's fix) triggerde wel, maar loste het niet
op. Nagekeken of dit een dataprobleem was (`ads_search_terms_wasteful` had wel degelijk 5 echte
rijen voor deze klant) — dus geen ontbrekende testdata, een echte modelinconsistentie die de poort
terecht ving. Tweede poging: quality gate `passed: true`, geen invalid steps. Dit bevestigt dat de
17.4-repair de faalkans verkleint maar geen garantie is — verwacht, niet een nieuwe regressie.

**Cross-channel-synthese: sterke inhoud, één echte parseerbug gevonden en gefixt.** De eerste
synthese-run leverde een oprecht gesynthetiseerd verhaal op (Google's slechtste klik→conversie
tegenover LinkedIn's beste, tegen SEA's eigen wens voor meer budget in) met drie expliciet benoemde
tegenstrijdigheden — precies het "1 concrete goede output" dat gevraagd was. Maar
`synthesized_actions` kwam leeg terug terwijl de markdown wél drie acties toonde: het model schreef
de leesbare headerLabel ("SEA", "Meta Ads") in het `channel`-veld in plaats van de interne sleutel
("google_ads"), en de oude, strikte validatie zag dat als een verzonnen kanaal en filterde alles
weg. Gefixt in `cross-channel-synthesis.ts`: `parseSynthesisOutput` normaliseert nu elke headerLabel
(case-ongevoelig) terug naar zijn interne sleutel vóór de validatie, en de systeemprompt noemt nu
expliciet de verwachte sleutels i.p.v. alleen "een echt kanaal". Beide verdedigingslagen tegelijk —
prompt strakker én parser toleranter — in plaats van te vertrouwen op één van de twee.

**Herverificatie van de fix**: rechtstreeks tegen de al opgeslagen productiedata gedraaid (niet via
de route, die `analysisDate: today()` hardcodeert — de sessie liep inmiddels over middernacht heen,
dus de automatische poort weigerde terecht een synthese op niet-matchende datums; zelf bewijs dat
die datumcontrole werkt). Resultaat: alle drie `synthesized_actions` kwamen correct terug met de
juiste interne kanaalsleutels, identiek aan de markdown. Nieuwe test toegevoegd
(`__cross_channel_synthesis_test.ts`) die exact dit scenario dekt, zodat de bug niet terugkomt.

**Niet getest vandaag**: de kanaaloverstijgende synthese mét God View- of cross-account/portfolio-
signalen erbij — die twee blijven losstaande mechanismen, niet meegenomen in deze synthese-stap
(zie de vraag/het antwoord hierover, 17 augustus).

### 17.14 De echte oorzaak van de stap-7-terugkerende fout gevonden en gefixt

De eigenaar: *"moeten we dit voor eens en altijd fixen en daarna door naar cross account?"* Bleek
geen vage modelgril maar een concreet te herleiden scoping-bug.

**De oorzaak.** `lib/analysis/data-availability.ts`'s `checkStepDataAvailability()` kende stap 7
maar twee databronnen: "Keyword data" (`ads_keyword_performance_monthly`) en "Product data". De
bevinding die in 17.13 (en eerder, 17.4) telkens de kwaliteitspoort blokkeerde komt uit een
**derde, aparte** tabel: `ads_search_terms_wasteful`. Voor demo-greentech is die derde tabel wél
gevuld (5 echte rijen), maar de eerste twee niet. Het model zei dus terecht "Keyword Performance:
data niet beschikbaar" en citeerde er terecht een zoekterm-bevinding naast uit de wél-beschikbare
bron — maar de validator zag alleen `dimensions.every(d => !d.available)` (beide bekende bronnen
leeg) en verklaarde daarmee de HELE stap "geen data", wat elke bevinding erin diskwalificeerde,
inclusief een die prima onderbouwd was. Geen hallucinatie-detectie die faalde: een blinde vlek in
wélke bronnen de validator van stap 7 kende.

**De fix.** `AvailabilityInput` kreeg een derde veld, `searchTermData`, en stap 7's
dimensielijst een derde `dimension("Search term waste data", opts.searchTermData)`. Zodra
minstens één van de drie bronnen data heeft, is `allUnavailable` niet meer waar en blijft de
diskwalificatie-cascade uit — geen aparte scope-classificatie per bevinding nodig, de simpelste
correcte fix. Twee aanroepplekken gefixt: `app/api/analysis/monthly/route.ts`'s directe pad én
`lib/analysis/monthly-prepared-context.ts`'s cache-opbouwpad (`preparedContext`) — de tweede werd
bijna gemist; zonder die zou een klant die via de prepared-context-cache draait de oude bug
gewoon behouden. Nieuwe test (`__data_availability_test.ts`) dekt: de precieze
demo-greentech-situatie (search-termdata wél, keyword/product niet → niet meer allUnavailable),
de echt-lege situatie (blijft terecht allUnavailable), en dat stap 5/6 ongemoeid blijven.
Geverifieerd tegen de daadwerkelijk vastgelegde narratieftekst uit de 17.13-testrun dat de
resterende regex-route (`/geen data beschikbaar|niet uitvoerbaar/i`) niet alsnog zou triggeren.

**Volgende stap, met deze afgerond**: cross-account.

### 17.15 Portfolio-synthese: dezelfde synthese-stap, nu tussen klanten van hetzelfde bureau

De eigenaar koos expliciet voor "portfolio-synthese (zoals cross-channel, maar tussen klanten)"
boven het alternatief (de bestaande Macro-portfoliogating alleen verstevigen).

**Nieuwe tabel, bewust niet client_id hergebruikt.** `sop_analysis_output.client_id` is
`not null`; een portfolio-synthese gaat over meerdere klanten tegelijk en heeft geen eigen
client_id. Nieuwe, kleine tabel `agency_analysis_output` (migratie
`098_agency_analysis_output.sql`, **live gedraaid tegen productie** met dezelfde
Management-API-credentials als migratie 097), agency_id als sleutel i.p.v. client_id. RLS bewust
nog niet aangezet — exact dezelfde, al getrackte status als `sop_analysis_output` zelf (zie
065_rls_sop_intelligence.sql's eigen "NIET UITGEVOERD"-notitie); geen nieuw gat, hetzelfde gat.

**Architectuur, tegen de code gecontroleerd vóór het bouwen.** `lib/macro/aggregate.ts` (de
bestaande portfolio-aggregatie) telt alleen ruwe metrics op — geen enkele agency-brede opslag van
"de eindconclusie per klant" bestond al. De tier-gate bestaat wél al en is echt: Macro/Agency God
View zit al achter `heeftTenminste(licentie, "growth")`
(`app/api/platform/agency-macrotrends/route.ts`) — hergebruikt, geen nieuwe gate verzonnen. Een
"welke klanten horen in de portfolio"-lijst-helper bestond niet (alleen een COUNT,
`telAccountsMetSops`); `lijstAccountsMetSops` toegevoegd in `lib/tenancy/sop-dekking.ts` als het
lijst-equivalent, dezelfde regel (agency_id + sops_enabled=true) hergebruikt in plaats van een
tweede definitie.

**Waarom geen exacte-datum-gate (bewust anders dan cross-channel-synthesis.ts).**
Cross-channel-synthese eist dat alle kanalen van ÉÉN klant dezelfde analysis_date dragen — logisch
want ze worden na elkaar in dezelfde sessie getriggerd. Klanten van een bureau draaien elk op hun
eigen cadans; een exacte-dag-match over een hele portfolio zou vrijwel nooit halen. In plaats
daarvan een VERSHEIDSVENSTER van 35 dagen per klant, met de eigen analysis_date altijd expliciet
in de prompt (zelfde "kan van eerdere cyclus zijn"-discipline als cross-channel-context.ts).

**Per klant het beste beschikbare eindverhaal, niet de ruwe kanaaldata.** Voor een klant met 2+
kanalen: zijn eigen `cross_channel_synthesis_v1` (al samengevoegd). Voor een klant met 1 kanaal
(geen cross-channel-synthese mogelijk, dat vergt 2+): het meest recente kanaal se
`structured_monthly_v2.final_sop`. Geen k-anonimiteit nodig — anders dan God View (cross-agency)
blijft dit binnen één bureau over zijn EIGEN klanten; er is niets te anonimiseren dat de synthese
niet ook los al zou tonen.

**Dezelfde les uit 17.13 direct toegepast.** `parsePortfolioSynthesisOutput` normaliseert
`clientId` op zowel de echte id als de klantnaam (een model dat de leesbare naam teruggeeft die
het zelf net las, is geen hallucinatie) — de label/sleutel-bug uit de cross-channel-synthese-live-
test is hier dus vóór de eerste live run al voorkomen, niet er weer ingebouwd.

**UI**: nieuwe `PortfolioSynthesisCard` bovenaan `components/terminal/agency-god-view.tsx` (de
bestaande Agency God View-pagina, exacte tegenhanger van hoe `SynthesisCard` bovenaan
`cross-channel-analyses.tsx` staat) — headline, narratief, terugkerende patronen, uitschieters, en
per-klant (of "hele portfolio") gelabelde acties.

**Niet getest tegen productie vandaag** (in tegenstelling tot cross-channel-synthese in 17.13):
geen live agency met 2+ klanten en verse eindverhalen voorhanden binnen deze sessie om tegen te
draaien. Unit-getest (`__portfolio_synthesis_test.ts`, 31 assertions): voorkeur voor cross-
channel-synthese boven los kanaal, terugval-pad, versheidsvenster-gating, naam/id-normalisatie,
skip-paden, en het volledige succespad met een gemockte LLM-call.

### 17.16 Alsnog live getest — met echte, oude portfoliodata, zoals de eigenaar voorstelde

De eigenaar wees de "geen geschikte data" conclusie af: *"niet zo simpel af doen als kan niet.
graag out of the box mee denken. dus of met oude data wat oke is."* Terecht: het echte bureau
"Ranking Masters" (agency_id `04189c5d-...`, 70 accounts) had allang bruikbare, oude
`structured_monthly_v2`-data staan — nooit gecontroleerd voordat "geen data" werd geconcludeerd.

**Opzet.** Drie echte klanten met de meeste historie (Broedservice, Fit-fysiotherapie, Minismus,
elk 2-4 afgeronde Google-analyses, laatste rond 16-17 april 2026) rechtstreeks opgehaald —
zonder het versheidsvenster te omzeilen in de productiecode zelf (dat blijft een terechte regel),
maar door voor deze test buiten de gate om de rijen op te halen en vanaf daar de ECHTE,
ongewijzigde functies aan te roepen: `buildPortfolioSynthesisPrompt`, de echte reasoning-laag-call
(Grok 4.6), `parsePortfolioSynthesisOutput`.

**Resultaat: sterk, genuine cross-account-inzicht.** Drie totaal verschillende problemen (Broedservice:
budgetplafond houdt bewezen vraag tegen; Minismus: Duitsland trekt budget bij een efficiency van
0,54 zonder rendement; Fit-fysiotherapie: hoge CTR maar ingestorte CVR op een creative) werden
samengevoegd tot één niet-voor-de-hand-liggend patroon: alle drie krijgen hetzelfde "niet schalen
tot de KPI herstelt"-herstelrecept, terwijl het onderliggende probleem per klant tegenovergesteld
is (te weinig budget vs. te veel budget zonder rendement vs. een conversieprobleem). De synthese
stelde zelf een triage voor (vraag>budget / budget-zonder-rendement / verkeer-zonder-conversie) en
gaf 5 acties: 2 bureau-brede ("portfolio"), 3 per klant — geen enkele verzonnen clientId, de
naam/id-normalisatie uit 17.15 werkte meteen goed (het model gaf zelfs consequent de echte
clientId's terug, niet de namen, dus die normalisatie-tak werd dit keer niet eens nodig).

**Opgeslagen als echt, inspecteerbaar record**: rechtstreeks in `agency_analysis_output` voor de
echte Ranking Masters-agency (analysis_date 2026-04-17, matchend met de brondata), niet alleen in
een testlog. Te bekijken via de bestaande GET-route/UI-kaart door iemand met Growth+ toegang tot
dat bureau. Tijdelijke scripts (`scripts/_livetest_*.ts`) na afloop verwijderd — geen wijziging aan
productiecode nodig, dit bewees alleen dat de al-geschreven code werkt.

**Les**: "geen geschikte data" was een te snelle conclusie. Bij twijfel eerst de database
bevragen (agencies/accounts/sop_analysis_output) voordat een testbeperking als blokkade wordt
gemeld.

### 17.17 Bedrijfsmodel-bewustzijn: de 17.16-testselectie was zelf het probleem

De testklanten in 17.16 (Broedservice, Minismus, Fit-fysiotherapie) mengden zonder dat de code of
ikzelf dat wist e-commerce met lead-gen. De eigenaar corrigeerde dit met echte kennis: *"Minismus
en broedserveicd zijn ecom, fit fysio is een lead gen. kijk naar mpc en mobiliteitexpert voor meer
ecom. bruidsmode is lead gen. alles met goedeinnovatie is ecom, maar heeft tracking issues gehad."*
Dat is geen losse testfout — een e-commerce-klant en een lead-gen-klant hebben structureel andere
CVR-normen en KPI's; een portfolio-synthese die budget-/CPA-/CVR-patronen tussen die twee zonder
onderscheid vergelijkt trekt een misleidende conclusie, ook als de trend toevallig hetzelfde lijkt.

**Databaseonderzoek eerst.** `bedrijfsmodel` (b2b/b2c) en `ecommerce vs. lead-gen` zijn twee
verschillende assen — er bestaat geen schoon "ecom/leadgen"-veld in `client_settings`. Het
dichtstbijzijnde gestructureerde signaal is `niche` (17-waarden legacy-sector-enum via
`uitOudeSector()` in `lib/benchmark/segment.ts`), en die bleek voor de meeste echte klanten
(Broedservice, Mobiliteitexpert, MPC-UK, GoedeInnovaties-subklanten) leeg te staan — alleen
Bruidsmode Haarlem, Fit-fysiotherapie en Minismus hadden gedeeltelijke data. Automatisch filteren
op business-model is dus onbetrouwbaar zolang die data grotendeels ontbreekt; de robuuste fix is
promptniveau-bewustzijn, niet stille auto-filtering die op lege data zou instorten.

**Gebouwd in het product, niet alleen in de test.** `ClientSummary` kreeg twee nieuwe, verplichte
velden (`bedrijfsmodel: Bedrijfsmodel | null`, `niche: string | null`). `fetchPortfolioSummaries`
haalt ze nu in één gebundelde query op uit `client_settings` (i.p.v. per klant een extra query) en
geeft ze door aan `fetchClientSummary`. `buildPortfolioSynthesisPrompt` toont per klant expliciet
"Bedrijfsmodel: ... (niche)" of "onbekend", en de systeemprompt kreeg een expliciete regel: budget-
/CPA-/CVR-vergelijkingen alleen rechtstreeks tussen klanten met hetzelfde of vergelijkbaar
bedrijfsmodel; bij onbekend bedrijfsmodel moet de onzekerheid benoemd worden in plaats van
stilzwijgend gelijk behandeld.

**Herhaalde live-test, nu bedrijfsmodel-zuiver.** Vier bevestigde e-commerce-klanten van hetzelfde
bureau (Broedservice, Minismus, MPC-UK, Mobiliteitexpert) — zelfde aanpak als 17.16 (echte,
ongewijzigde functies, buiten het versheidsvenster om de rijen zelf opgehaald). Resultaat was
merkbaar scherper dan de gemengde 17.16-run: een schone tweekamp-opsplitsing met bijna identieke
cijfers tussen twee van de vier klanten (~23% gemiste vraag bij zowel Broedservice als MPC-UK),
in plaats van drie losstaande, niet onderling vergelijkbare verhalen. Niet opgeslagen als
productierecord (test met los script, niet via de POST-route/echte agency_id) — bevestigt alleen
dat een homogene groep een scherpere synthese oplevert, wat de aanleiding was voor deze fix.

**Testfixtures bijgewerkt**: `__portfolio_synthesis_test.ts`'s `ClientSummary`-fixtures kregen de
nieuwe verplichte velden; nieuwe assertions bevestigen dat de systeemprompt de
bedrijfsmodel-waarschuwing bevat en dat de userMessage het bedrijfsmodel (of "onbekend") per klant
toont. `npx tsc --noEmit` schoon, alle 34 assertions slagen (was 31; 3 nieuwe checks toegevoegd).

**Echte data ingevuld voor 7 klanten (18 augustus), rechtstreeks in `client_settings`, geen
codewijziging.** De eigenaar gaf de echte bedrijfsmodellen en niches voor de klanten die in 17.16
en hierboven getest zijn — precies het veld dat grotendeels leeg bleek te staan. Rechtstreeks
weggeschreven via een wegwerpscript met de service-role-key (niet via de Management-API dit keer,
gewoon een PostgREST-update — geen migratie nodig voor een databewerking):

| Klant | Bedrijfsmodel | Niche | Op basis van |
|---|---|---|---|
| Broedservice | b2c | `huisdieren` | broedmachines (geen exacte match in de vaste lijst, dichtstbijzijnde gekozen) |
| Minismus | b2c | `wonen` | badkamer-/huisgadgets (douchedeurafdichtingen, wc-rolhouders) |
| MPC - UK | b2c | `elektronica` | telefoonhoesjes |
| Mobiliteitexpert | b2c | `zorg_overig` | mobiliteitshulpmiddelen (rolstoelen, rollators, wc-verhogers) |
| GoedeInnovaties - Confidenceforal | b2c | `mode` | anti-zweet kleding |
| GoedeInnovaties - Zeemeerminnenfeest ("Ocean Queens") | b2c | `sport` | zeemeerminnenstaarten |
| GoedeInnovaties - Wobblez | b2c | `wonen` | ergonomische wiebelkrukken |

Geen van deze zeven had al een niche; twee (MPC-UK, Minismus) hadden via de oude `sector`-kolom al
`bedrijfsmodel: b2c` staan, de rest kreeg het nu pas. Dit zijn precies de klanten die de 17.16/17.17
live-tests gebruikten, dus de portfolio-synthese voor Ranking Masters ziet vanaf nu bij de
eerstvolgende run een echt bedrijfsmodel/niche in plaats van "onbekend" voor deze zeven.

### 17.18 Een echte eind-tot-eind-testrun legt een structurele stap-9-bug bloot, gefixed

De eigenaar vroeg om een volledige, echte testrun: verse 13-staps maandanalyses van vandaag (niet
de oude april-data via een omzeiling zoals 17.16), op de al bestaande, gesyncte data van 4 echte
klanten (Broedservice, Minismus, MPC-UK, Mobiliteitexpert), gevolgd door de echte
portfolio-synthese-functie erover heen — om te zien hoe goed de analyse werkelijk is.

**Twee blokkades vóór de eerste LLM-call, beide echte productieconfiguratie, geen testartefact.**

1. `sops_enabled` stond op `false` voor alle 4 klanten. `magSopDraaien()` (de gate die de route
   echt gebruikt) checkt alleen deze vlag, niet de licentie — dus aangezet voor deze 4 klanten.
2. De echte Ranking Masters-licentie is `basis`, en `SOP_DEKKING.basis = 0`. Dat is een aparte,
   los-van-`sops_enabled`-staande tier-check (`controleerDekking()`, gebruikt voor een banner elders,
   niet door `magSopDraaien()` zelf) — voor déze test dus geen blokkade, maar wel een eerlijke
   constatering: het echte bureau zit vandaag op een tier waar automatische SOP's per
   licentie-ontwerp niet bij horen.

**De HTTP-authenticatielaag van de portfolio-synthese-route bewust niet omzeild via een
werk-around, maar opgelost door het te benoemen.** `/api/analysis/portfolio-synthesis` checkt
`requireCapability` + Growth-tier in de routecode zelf, en daar is geen testsessie voor. In overleg
met de eigenaar gekozen: `runPortfolioSynthesis()` — exact dezelfde functie die de route zelf
aanroept — rechtstreeks aanroepen. De 13-staps maandanalyses zelf liepen wél via de echte
`/api/analysis/monthly`-route (die heeft geen routeniveau-auth, alleen `magSopDraaien()`), dus de
kernpijplijn is zo écht getest, alleen de dunne auth-wrapper van de synthese-route niet.

**Bevinding: 100% reproductie van een structurele bug, niet een LLM-hobbel.** Alle 4 klanten
faalden bij de eerste run op exact dezelfde plek — stap 9 ("Doelgroep- & Geosegmenten") — met exact
dezelfde foutklasse: `Evidence-level "deterministic" op finding "GB::ROAS" terwijl het narratief
aangeeft dat data niet beschikbaar is`. Root cause: stap 9 heet zo sinds een eerdere samenvoeging
(fase4) van oud-stap-9 (Audience) en oud-stap-11 (Geo) tot één LLM-call
(`lib/prompts/monthly-v2.ts`), maar `lib/analysis/data-availability.ts` kende stap 9 nog maar één
databron ("Audience data"). Audience-data ontbreekt bij vrijwel elke klant (heel gewoon); zodra dat
zo was, viel `allUnavailable` op `true` uit voor de HELE stap, ook al was er echte, bruikbare
geo-data — en dus werden de wél-echte, wél-deterministische geo-findings (GB/NL/DE/BE) afgekeurd.
Zelfde bugklasse als de stap-7-fix van 17 augustus (17.14): een stap met twee databronnen, een
check die er maar één van kende.

**Fix, tweeledig.** (1) De ontbrekende "Geo data"-dimensie (`opts.countryData`, dezelfde bron als
stap 11 al gebruikt) toegevoegd aan stap 9 in `data-availability.ts` — de daadwerkelijke oorzaak.
(2) Bijkomend, echt gat gevonden tijdens het natrekken: de `explicitlyUnavailableScopes`-regex in
`step-validator.ts` matchte nooit de exacte frase die de prompt zelf voorschrijft ("Niveau 1
(Audience): data niet beschikbaar.", niet "audience data niet beschikbaar"), en er bestond
helemaal geen "geo"-scope — dus een echt lege geo-scope kon niet worden onderscheiden van een echt
lege audience-scope. Beide regexen gecorrigeerd naar de echte promptfrasering, plus
`entity_type "country" → "geo"` toegevoegd. Nieuwe regressietests
(`__data_availability_test.ts`, `__step9_geo_availability_test.ts`) reproduceren zowel het
oorspronkelijke faalpad als de tegenproef (een écht lege geo-scope blokkeert een geo-finding nog
steeds terecht — de fix opent de poort niet blind).

**Eigen fout onderweg, meteen gevangen door de eigen hygiënepoort.** Bij het schrijven van de
regressietest zette ik zelf per ongeluk de letterlijke merknaam in testcommentaar
(`__data_availability_test.ts`) — precies het soort lek waar `__brand_test.ts` op let. De poort
faalde terecht, meteen gecorrigeerd naar een generieke omschrijving. Geen falen van de controle;
dit is exact waarom hij bestaat.

**Herhaald, ditmaal 4/4 geslaagd.** Met de fix: alle 4 klanten opnieuw gedraaid tegen dezelfde,
echte, ongewijzigde data — dit keer geen `qualityGate`-blokkade, `structured.saved: true` bij alle
vier.

### 17.19 De echte portfolio-synthese over 4 verse analyses: business-model-bewustzijn zichtbaar in de output

Met 4 geslaagde, verse maandanalyses (Broedservice, Minismus, MPC-UK, Mobiliteitexpert — alle vier
inmiddels bevestigd e-commerce, zie 17.17) de echte `runPortfolioSynthesis()` gedraaid voor het
echte Ranking Masters-bureau, opgeslagen in `agency_analysis_output`
(`analysis_date: 2026-08-18`, geverifieerd met een leesquery na afloop — geen aanname).

**De 17.17-fix is zichtbaar aan het werk in echte modeloutput, niet alleen in een test.** Zonder
dat er iets in de prompt naar gevraagd werd, schreef het model zelf: *"hun CPA- of ROAS-niveaus
zijn niet onderling vergelijkbaar"* (over Minismus vs. MPC-UK, andere niche) en *"geen cross-niche
CPA-vergelijking met elektronica, huisdieren of zorg"* — exact de waarschuwing die
`buildPortfolioSynthesisPrompt()` sinds 17.17 meegeeft. Dit is het eerste directe bewijs dat de
bedrijfsmodel-bewustzijn-fix niet alleen de teststructuur haalt, maar het daadwerkelijke gedrag
van het model beïnvloedt.

**Inhoudelijk een sterke, niet-triviale synthese.** Kernvinding: drie van de vier klanten
(Minismus/DE, MPC-UK/GB, Broedservice/PMAX) delen hetzelfde onderliggende mechanisme —
budget stroomt naar een "expansievlak" (land of PMAX) zonder rendementsmatch — terwijl
Mobiliteitexpert het tegenovergestelde probleem heeft (ondergefinancierd, 83,71% Lost IS bij een
€5-dagbudget). De synthese herkende dit als hetzelfde bureaubrede patroon in drie verschillende
vermommingen, stelde een concrete, herbruikbare poort voor ("verplichte geo-expansiepoort"), én
waarschuwde expliciet tegen het toepassen van dat recept op de uitzondering (Mobiliteitexpert) —
precies het soort onderscheid dat losse per-klant-analyses niet kunnen maken.

**Niet omzeild, wel eerlijk begrensd.** De 13-staps analyses liepen via de echte route op oude,
al-gesyncte data (géén live Google Ads-aanroep nodig, zie 17.19's aanleiding hierboven); de
synthese zelf via de echte, ongewijzigde `runPortfolioSynthesis()`-functie, alleen buiten de
HTTP-auth-wrapper om waar geen testsessie voor was (zie 17.18). Kernpijplijn dus volledig echt
getest; alleen de dunne routelaag niet.

### 17.20 GRT/GRA/GRN als 3 losse klanten: de sync-onafhankelijke testroute

De eigenaar accepteerde de aprilse sync-stilstand als permanent ("de sync gaat nooit gefixt
worden") en vroeg om vanaf nu op de demo/mock-data te testen in plaats van te wachten op een
sync-herstel: de geo-clones van de bestaande demo-klant (GRT/GRA/GRN, GreenTech Amsterdam/
Americas/North America) als 3 losse klanten door de volledige pijplijn — eigen SOP per klant,
daarna cross-account — met de aanname dat ze in dezelfde sector/niche zitten.

**GRT/GRA/GRN bestonden niet als aparte `client_id`'s.** Het zijn campagnenaam-prefixes binnen
één demo-klant (`demo-greentech`), gedetecteerd via `lib/fair/geo-clone-catalog.ts` — precies het
mechanisme dat `geo-clone-context.ts` (17.14) al gebruikt om ze BINNEN één klant-SOP apart te
houden. Voor 3 losse SOP's + een echte cross-account-synthese (die op `client_id` sleutelt) was dat
onvoldoende; er moesten 3 echte, aparte `client_id`'s komen.

**Eerst de bron ververst, niet de oude rijen hergebruikt.** `scripts/demo/seed-demo-client.ts`
bleek al te bestaan — een volwaardig, op "vandaag" verankerd seed-script voor `demo-greentech`,
per-detector ontworpen (S1–S13, zie het bestand zelf). Opnieuw gedraaid vóór het splitsen, zodat de
brondata voor GRT/GRA/GRN maximaal actueel is (vandaag, 18 augustus) in plaats van de dag-of-twee
oudere rijen die al in de database stonden — direct het "zo actueel mogelijk"-verzoek.

**Splitsing en de twee schrijflagen die dat blootlegde.** Een nieuw, wegwerpbaar script
(`_seed_geoclone_clients.ts`, verwijderd na afloop) maakte 3 `accounts`-rijen aan (bureau: "Demo",
licentie growth) met `client_settings.bedrijfsmodel: "b2b"` en `niche: "industrie"` voor alle drie
identiek — de expliciete "zelfde sector en niche"-aanname, niet gegokt. Campagnerijen gesplitst op
campagne-ID (GRT: Search NL + Performance Max; GRA: Search US; GRN: Search NA; de twee
niet-geo-gebonden campagnes "GreenTech | Brand" en "GreenTech | Display | Prospecting" bewust
buiten alle drie gehouden — die horen bij geen van de geo-clones specifiek). Twee schrijflagen
bleken nodig, ontdekt via een eerste mislukte poging:
1. `ads_campaign_monthly`/`ads_account_monthly` zijn views over `fact_core` (migratie 054, zie
   `lib/data-access/feitentabellen.ts`); schrijven moet naar `*_legacy`, en de projectie naar
   `fact_core` gebeurt via de RPC `refresh_fact_from_legacy(p_client_id)` — normaal door de sync
   zelf aangeroepen, hier expliciet per pseudo-klant gedraaid.
2. `checkDataFreshness()` (de preflight vóór elke analyse) eist ook `ads_account_weekly` en een
   `client_sync_status`-rij; zonder die twee gaf de echte route terecht "Geen Google Ads data",
   ook al stonden de campagnerijen er al. Beide alsnog gezaaid (weekrijen afgeleid uit de eigen
   maandrijen van elke pseudo-klant, niet uit iets anders).

**Resultaat: 3/3 geslaagd via de echte route, geen enkele workaround in de analysecode zelf** — de
twee ontbrekende stukken waren allebei echte, al bestaande vereisten van de pijplijn die de test
alsnog moest vervullen, niet iets dat omzeild is.

**De cross-account-synthese vond zelf het onderscheid dat de sectoraanname mogelijk maakte.**
`runPortfolioSynthesis()` (rechtstreeks aangeroepen, zelfde auth-beperking als 17.18/17.19) leverde
een scherpe, niet-triviale synthese: GRA en GRN bleken een IDENTIEKE meetfout te delen
(`conversions_value: 0` in de demo-brondata → ROAS 0,00x bij beide), terwijl GRT een heel ander,
wél diagnosticeerbaar probleem heeft (97% dagbudgetbenutting, 28% impression share verloren op
budget). Het model gebruikte de "zelfde sector"-aanname expliciet en correct: *"Alle drie de
klanten zijn B2B in industrie & productie, dus de vergelijking is inhoudelijk geldig"* — en
trok vervolgens zelf de scheidslijn niet langs sector (die was overal gelijk) maar langs
oorzaak (meting vs. vraag), inclusief een expliciete waarschuwing om Amsterdam niet in dezelfde
schaalstop mee te trekken als de twee Amerika-accounts.

**Volledig opgeruimd na afloop**, zelfde discipline als 5.5/17.16: alle 3 pseudo-`accounts`-rijen,
hun `client_settings`, alle campagne-/account-/weekrijen, `client_sync_status`,
`sop_analysis_output` én de bijbehorende `agency_analysis_output`-rij verwijderd. Geen spoor
achtergebleven; de brondata van `demo-greentech` zelf is ongemoeid (alleen ververst, niet
gesplitst — de geo-clone-context-detectie binnen die ene klant blijft ongewijzigd werken).

**Wat dit structureel oplevert**: een sync-onafhankelijke testroute voor de volledige pijplijn
(los SOP + cross-account) die niet wacht op een echte klantkoppeling. Het seed/split/projecteer/
opruim-patroon hierboven is een keer uitgevoerd, niet (nog) een herbruikbaar script — bij een
volgende testronde is het overwegen waard om dit als een echt, benoemd scriptpaar
(`scripts/demo/seed-geoclone-clients.ts` + teardown) vast te leggen in plaats van elke keer
opnieuw te schrijven en weer weg te gooien.

### 17.21 Decision Brief: een compacte export naast het volledige SOP-rapport, geen vervanging

De eigenaar kreeg via Gemini het voorstel om de bestaande synthese-formatter te VERVANGEN door
een nieuwe, gestroomlijnde systeemprompt die direct een compact 2-pagina beslisdocument voor
Head of PPC/specialisten oplevert. Voordat dat gebouwd werd: eerst gecontroleerd of dat voorstel
zelf klopt, en dat bleek niet zo te zijn.

**Waarom vervangen de verkeerde keuze was.** Elk veld dat het compacte format nodig heeft —
primary thread, root cause, de containment/validation/recovery/controlled-scale-indeling,
accept_if/reject_if — staat al structureel in `FinalSopSynthesis`/`OperatingDetailLayer`
(`lib/analysis/monthly-structured.ts`), de output die de bestaande pijplijn toch al produceert en
opslaat. Vervangen zou drie echte dingen kosten: (1) een nieuwe LLM-call voor iets dat al als
data bestaat, (2) de evidence traces en hypotheses-met-succescriteria die de leerlus voeden
(§3.3/§4) alleen behouden als iemand dat apart blijft opslaan, en (3) `cross-channel-synthesis.ts`
en `portfolio-synthesis.ts` breken, die zelf rechtstreeks uit `final_sop.primary_thread`/
`root_cause`/`recommendations` lezen.

**Gebouwd: een nieuwe, pure render-transformatie, geen nieuwe analysestap.**
`lib/analysis/decision-brief.ts` zet bestaande `final_sop`/`operating_detail`-data (en optioneel
een portfolio-synthese) deterministisch om naar precies het gevraagde format — geen LLM-call,
geen dataverlies aan de bron. Drie afleidingen die het waard zijn te noemen omdat ze een echt
veld hergebruiken in plaats van iets nieuws te verzinnen:
- **Fase** komt uit de `route` van de eerste (dus meest urgente) aanbeveling
  (validation→"Validatie", containment→"Beperking (rem)", enz.) — het dichtstbijzijnde bestaande
  structurele veld voor "in welke fase zit dit account".
- **Prioriteit** komt uit `qa_self_check.why_score_estimate`/`actionability_score_estimate`
  (al berekend door de bestaande pijplijn), gedrempeld naar Hoog/Midden/Laag — geen nieuwe scoring.
- **Beslisregel & Falsificatie** komt rechtstreeks uit de eerste hypothese in
  `operating_detail.hypotheses_and_next_month_proof` — die droeg `evaluation_window`/`accept_if`/
  `reject_if` al.

**Niet elk account heeft alle drie de sprint-actie-routes, en dat wordt eerlijk getoond.** Het
GRA/GRN-scenario uit 17.20 (geen "controlled scale" zolang de meting kapot is) is het echte,
terugkerende geval: `buildSprintActions()` laat zo'n ontbrekende route `null`, en de renderer
toont "Niet gedefinieerd" in plaats van een verzonnen actie. Een eigen test reproduceert dit
scenario expliciet.

**Woordlimiet (max 120 per sub-account) is een echt afgedwongen grens, geen toevallige.** Elk veld
kreeg een eigen woordbudget (som = 120), afgekapt op woordgrens met "…". Getest met opzettelijk
lange (40+ woorden per veld) brontekst — niet met toevallig korte testfixtures — zodat de test
ook echt bewijst dat de afkapping werkt.

**Een echte bug gevonden tijdens het eerste keer echt renderen, niet in een test met verzonnen
namen.** Campagnenamen als "GRT | Search | NL" bevatten letterlijke pipe-tekens; ongeëscaped in
een Markdown-tabelcel splitst dat de rij in extra kolommen en breekt de tabel. Gevonden door de
renderer tegen echte content uit de 17.20-testrun te draaien (een tijdelijk, achteraf verwijderd
script), niet door de code te lezen. Gefixed (`escapeTableCell()`) en vastgelegd in een
regressietest die exact deze naam gebruikt — de PDF-renderer was hier nooit gevoelig voor (echte
layout via @react-pdf/renderer, geen tekst-delimiters), alleen de Markdown-export.

**PDF-renderer volgt de bestaande conventie.** `lib/analysis/decision-brief-pdf-renderer.ts`
hergebruikt dezelfde bibliotheek en hetzelfde merkpalet als `sop-pdf-renderer.ts`
(`@react-pdf/renderer`, `React.createElement` in een `.ts`-bestand, geen JSX/`.tsx` — zelfde
conventie als de rest van de PDF-laag).

**Nieuwe route, geen wijziging aan bestaande.** `GET /api/analysis/decision-brief?client_ids=a,b,c
&agency_id=xxx&format=pdf|md` — leest dezelfde `structured_monthly_v2`/`portfolio_synthesis_v1`
die de bestaande routes ook al lezen, met dezelfde toegangscontrole
(`requireCapability("client:read")` + `canAccessClient` per klant, onbevoegde klanten vallen
stil weg in plaats van een verklappende 403). `/api/analysis/pdf` blijft ongewijzigd het
volledige rapport leveren; dit is een tweede, aparte exportoptie.

Getest (`__decision_brief_test.ts`, 32 assertions): woordlimiet-afkapping op opzettelijk lange
brontekst, route-mapping voor beide echte scenario's (GRT-met-controlled-scale,
GRA/GRN-zonder), prioriteit/fase-afleiding, geen verzonnen beslisregel zonder
`operating_detail`, portfolio-synthese aanwezig/afwezig, markdown-structuur, en de
pipe-escape-regressie. `npx tsc --noEmit` schoon, volledige `scripts/gates.sh` groen (294/294
tests, inclusief deze 32).

### 17.22 Decision Brief opgesplitst: klantdocument en bureaudocument mogen niet hetzelfde type delen

17.21's `DecisionBrief` combineerde Deel 1 (macro matrix + portfolio-synthese, over alle klanten)
en Deel 2 (per-klant diagnose/acties) in één document/type. De eigenaar liet dit opsplitsen in
twee strikt gescheiden functies: `generateClientDecisionBrief(clientId)` — precies 1 A4, veilig om
rechtstreeks met díe klant te delen — en `generateAgencyPortfolioBrief(agencyId)` —
bureaubreed overzicht voor Head of PPC/Agency Lead.

**Waarom een gedeeld type de verkeerde keuze was.** Niet alleen stijl: een gedeeld
`DecisionBrief`-type betekent dat een toekomstige wijziging aan het bureaudocument (bijv. een
extra veld met klantdetails in de macro matrix) per ongeluk in het klantdocument kan lekken, dat
juist NOOIT data van andere accounts mag tonen. Losse types (`ClientDecisionBrief`,
`AgencyPortfolioBrief`), losse markdown-/PDF-renderers, losse generate*-functies — elk met hun
eigen Supabase-fetch — maken die twee documenten structureel onafhankelijk in plaats van
toevallig gelijk.

**Anonimisering is echte redactie, geen parafrase.** "Injecteer portfolio-context uitsluitend
anoniem" (bijv. "Patroon wijst op een structureel tracking-sjabloonprobleem binnen gekoppelde
accounts") kon op twee manieren: een taalmodel de portfolio-tekst laten herschrijven (een tweede
LLM-call, en een parafrase kan alsnog een naam laten staan als het model niet perfect is), of
deterministisch elke bekende klantnaam/-id van het bureau vervangen door een neutrale term
voordat de tekst het klantdocument in gaat. Gekozen voor het laatste: `anonymizePatternText()`
kent de volledige klantroster van het bureau (nodig om uberhaupt te weten wát weg moet) en
vervangt exact die namen, langste eerst zodat "MPC - UK" niet half blijft staan doordat "MPC"
al elders geraakt is. Dat is verifieerbaar veilig; een parafrase is dat niet.

**Een relevantiebug gevonden en gefixed vóórdat hij live ging.** De eerste versie van
`buildPortfolioContext()` toonde een patroon aan een klant zodra het patroon een ANDER account
noemde — precies omgekeerd van de bedoeling. Een test die expliciet controleerde dat GRT (niet
genoemd in een GRA/GRN-patroon) géén portfolio-context te zien zou moeten krijgen, ving dit meteen
(`__decision_brief_test.ts`, "GRT zelf ziet geen portfolio-context"). Gefixed: een patroon wordt nu
alleen getoond als het aantoonbaar OVER dit account zelf gaat (eigen naam/id erin), niet zodra het
toevallig een ander account noemt.

**Getest, inclusief het scenario dat de eerdere bug had opgeleverd**: 43 assertions
(`__decision_brief_test.ts`) — woordlimiet-afkapping, beide route-scenario's, prioriteit/fase,
geen verzonnen beslisregel, de anonimiseringsketen end-to-end (een echte GRA/GRN-patroontekst,
bewezen dat "GRN"/"North America" nergens in het gerenderde klantdocument van GRA voorkomt, ook
niet in de uiteindelijke markdown-output), en dat het bureaudocument geen per-klant
Diagnose/Sprint-Acties-secties bevat. Visueel geverifieerd tegen overgetypte echte content uit de
17.20-testrun (twee PDF's, klant + bureau) vóór het committen. `npx tsc --noEmit` schoon,
volledige `scripts/gates.sh` groen.

**Routes**: `GET /api/analysis/decision-brief/client?client_id=...` (client:read + per-klant
scope-check, `requireClientAccess` — zelfde patroon als andere klant-specifieke routes) en
`GET /api/analysis/decision-brief/agency?agency_id=...` (client:read + eigen-bureau-check). De
oude, gecombineerde `/api/analysis/decision-brief`-route is vervangen, niet ernaast gehouden.

### 17.23 De anonimisering uit 17.22 alsnog verwijderd: cross-account binnen één bureau hoeft niet anoniem

Een vervolgvraag legde een verkeerde aanname in 17.22 bloot. Die sectie beschreef de
anonimisering in `ClientDecisionBrief` als iets dat "andere cross-account-features (God View,
benchmarks)" zouden moeten hergebruiken — te ruim gesteld. De echte regel, die al vastligt in
`portfolio-synthesis.ts` zelf sinds 17.15: **cross-account-analyse BINNEN één bureau hoeft niet
anoniem** (het bureau heeft al volledige inzage in zijn eigen klanten); **alleen God View en
eventuele toekomstige cross-BUREAU-features hebben k-anonimiteit nodig** (die combineren data van
meerdere, van elkaar onafhankelijke bureaus).

**De vervolgvraag die dit blootlegde**: gaat Document 1 (Client Decision Brief) letterlijk naar de
eindklant, of blijft het intern? Beantwoord: intern, naslagwerk voor de specialist. Reden,
eigen woorden van de eigenaar: de bestaande maandrapportage is al 100% voor de klant en verschijnt
in dezelfde week — soms dezelfde dag. Een los, extra klantexportformaat van de SOP-uitkomst zou
grotendeels dubbelop zijn. Bijkomend punt, zelf opgeworpen tijdens het gesprek: als er ooit wél een
rechtstreeks-naar-de-klant-variant komt, moet niet alleen de anonimisering terugkomen maar ook de
taal zelf herschreven worden — "Primary Thread"/"Containment"/"Accept if" is interne
decision-engine-terminologie, en dat hoort een klant net zo min te zien als de rest van "de echte
werking" (dezelfde regel als voor de website). Dat is bewust NIET nu gebouwd: een hypothetische
toekomstige klantvariant vraagt eigen eisen, en wordt pas gebouwd als een bureau er echt om vraagt.

**Gevolg voor de code**: `anonymizePatternText()` en `AgencyRosterEntry` volledig verwijderd uit
`lib/analysis/decision-brief.ts` — geen dode/ongebruikte anonimiseringscode achterlaten "voor
later". `buildPortfolioContext()` toont nu de patroontekst van het bureau ongewijzigd, met alleen
de relevantiefilter behouden (een patroon wordt alleen getoond als het aantoonbaar OVER dit
account gaat — dat filter bestaat om het document gefocust te houden, niet om te anonimiseren).
`generateClientDecisionBrief()` hoeft niet langer de volledige klantroster van het bureau op te
halen — één Supabase-round-trip minder.

Test bijgewerkt: het anonimiseringsbewijs is vervangen door een test die bevestigt dat de
patroontekst nu ongewijzigd (met échte klantnamen) doorkomt, met de relevantiefilter nog intact.
40 assertions (was 43 — de 3 puur-anonimiseringsspecifieke checks vervielen met de functie zelf).
`npx tsc --noEmit` schoon, volledige `scripts/gates.sh` groen.

### 17.24 Loop 5 gebouwd: de kalibratieberekening die migratie 091 al reserveerde

Op verzoek de leerlus als eerste prioriteit opgepakt. Eerst grondig uitgezocht wat er al stond
(zie het onderzoeksverslag in deze sessie) voordat er iets gebouwd werd — de bevindingen weken op
twee punten af van wat het masterplan zelf tot nu toe zei.

**Het echte beeld, preciezer dan de oude masterplan-tekst.** Loop 2 (aanbeveling → geaccepteerd →
uitgevoerd → gemeten → `agency_memory_event`) bleek al functioneel compleet:
`app/api/cron/evaluate-hypotheses/route.ts` reconstrueert baseline/measured-vensters, detecteert
uitvoering via `ads_change_history`, en schrijft correct events — maar staat níét in
`vercel.json`'s cron-schema (bewust, eerdere instructie van de eigenaar: geen nachtelijke
API-kosten, zelf willen testen). En `app/api/insights/trackrecord/route.ts` +
`components/terminal/trackrecord-view.tsx` blijken een volledig werkend, al-in-de-UI-gehangen
leesscherm — geen stub. De oude tekst "uitkomsten worden vastgelegd maar nergens teruggelezen"
klopte dus niet meer letterlijk: ze wórden teruggelezen, door een mens.

**Het echte gat zat elders**: niets — geen enkel bestand — leest `agency_memory_events` terug om
er zelf iets mee te doen. Het event-type `confidence_recalibrated` stond al gereserveerd in
migratie 091 met de eigen aantekening "dat vergt een kalibratieberekening die nog niet bestaat" —
nul schrijvers, nul lezers. Dát is Loop 5's daadwerkelijk ontbrekende stuk.

**Scope-beslissingen, met de eigenaar afgestemd voordat er gebouwd werd:**
- **Geen automatische cron** — expliciet: "zolang ctrl ppc in de testfase zit geen automatische
  crons want dan maak ik kosten op test data." De evaluator blijft handmatig triggerbaar, zoals hij
  al was. Dit is dus bewust NIET aangepakt, niet vergeten.
- **Kalibratie per bron, nooit gemengd** — expliciete eis van de eigenaar ("second opinions etc
  zijn eigen modules, hou daar rekening mee"). `source` (de 22 `ProposalSource`-waarden) is de
  enige vandaag bestaande structurele proxy voor "signaaltype" uit het masterplan.
- **Bijstelling, geen vervanging** — de aangeleverde `ice_confidence` van één voorstel blijft het
  vertrekpunt; de historische trefzekerheid van de bron als geheel mag dat hoogstens ±2 (op de
  1-10-schaal) bijsturen, begrensd op wat er al staat.

**`lib/learning/signal-calibration.ts`, nieuw, puur:**
- `computeSourceHitRates()`: leest `agency_memory_events` + `sprint_hypotheses.source` (via de FK,
  embedded-select), telt `hypothesis_outcome_met`/`hypothesis_outcome_missed` per bron op.
  Cross-bureau, zoals het masterplan voor loop 5 zelf voorschrijft — en dat is hier al veilig
  zonder anonimisering nodig, want een geaggregeerd percentage per bron abstraheert vanzelf al
  weg van individuele klantdata.
- `calibrateConfidence()`: bij minder dan 5 uitkomsten voor een bron: geen effect (te weinig
  bewijs). Bij exact 50% trefzekerheid: geen effect (geen voorspellende waarde boven kansniveau).
  Anders een lineaire bijstelling tot maximaal ±2, die pas bij 20+ uitkomsten voor 100% meeweegt.

**Gewired op de ENE echte schrijfplek voor alle 22 bronnen**: `saveProposalsReplacingPending()`
in `lib/second-opinion/findings-to-hypotheses.ts` (al zo geconsolideerd sinds SI6/SI7, zie de
code-comments daar) past nu de kalibratie toe vlak vóór de insert, herberekent `ice_total`, en
schrijft een `confidence_recalibrated`-memory-event (met bron, oude en nieuwe waarde) naast het
bestaande `hypothesis_proposed`-event — alleen als er ook echt iets is bijgesteld, geen ruis bij
elke run. De detail-tekst en de oude/nieuwe waarden landen ook in `metadata` op de rij zelf
(migratie 088's generieke jsonb-kolom, gemerged, niet overschreven — een bestaande
`master_synthesis`-metadata-sleutel op dezelfde rij blijft intact), zodat de UI het kan tonen
zonder een extra join met `agency_memory_events`.

**Zichtbaar gemaakt**: `components/insights/proposal-queue.tsx` toont een klein "confidence
bijgesteld"-label met de reden in een tooltip, wanneer van toepassing — puur uit `metadata`, geen
nieuwe databronnen nodig in het scherm dat al bestond.

**Getest**: 16 assertions op de pure kalibratieberekening (`__signal_calibration_test.ts`,
inclusief de neutrale 50%-grens, de begrenzing op 1 en 10, en dat verschillende bronnen nooit
gemengd worden) + 14 op de daadwerkelijke wiring in `saveProposalsReplacingPending`
(`__save_proposals_calibration_test.ts`, met een gemockte Supabase: de confidence wordt echt
aangepast, het event verschijnt alleen bij een echte bijstelling, bestaande metadata blijft
intact, en twee bronnen in dezelfde batch worden onafhankelijk beoordeeld). `npx tsc --noEmit`
schoon, volledige `scripts/gates.sh` groen.

**Wat dit niet doet, bewust**: geen drempel in decision-gating aangepast, geen prompt aangepast,
geen automatische cron toegevoegd. Dit is de kalibratieberekening zelf en de plek waar hij
toegepast wordt op nieuwe voorstellen — het eerste, kleinste, veiligste stuk van loop 5, niet de
hele lus in één keer.

### 17.25 Cross-channel-synthese daadwerkelijk aan de maandanalyse gekoppeld

De eigenaar vroeg naar de status van monthly / cross-channel / cross-account / God View, en wees
er scherp op dat cross-channel-synthese amper getest was — met de eis: "elke maand analyse moet
cross channel pakken als cross channel mogelijk is."

**Grondoorzaak**: `runCrossChannelSynthesis()` (masterplan 17.12) bestond en werkte, maar was
alleen bereikbaar via een losse, handmatig aan te roepen route
(`/api/analysis/cross-channel-synthesis`). Niets in `app/api/analysis/monthly/route.ts` — waar de
drie kanalen (Google inline, `runMetaMonthlyAnalysis()`, `runLinkedinMonthlyAnalysis()`) hun
maandanalyse afronden — riep die functie ooit aan. Cross-channel-synthese gebeurde dus alleen als
iemand er expliciet aan dacht een tweede, aparte aanroep te doen — vandaar dat hij in de praktijk
zelden liep, ook wanneer alle kanalen van een klant allang klaar waren.

**Fix**: nieuw bestand `lib/analysis/auto-cross-channel-trigger.ts` met
`triggerCrossChannelSynthesisIfReady(supabase, clientId)`, aangeroepen vanaf alle drie de
plekken waar een kanaal zijn maandanalyse succesvol afrondt. Geen nieuwe voorwaarde toegevoegd —
`runCrossChannelSynthesis()` controleert zelf al, goedkoop en vóór elke LLM-call: minder dan 2
gekoppelde kanalen, al gesynthetiseerd vandaag, of nog niet alle kanalen deze cyclus klaar. Welk
kanaal toevallig als laatste afrondt, is degene bij wie de synthese echt gebeurt; de eerdere
kanalen krijgen een goedkope skip. Faalt zacht met eigen try/catch en logging — een mislukte of
overgeslagen synthese mag de hoofdanalyse van het kanaal nooit blokkeren of laten falen.

**Tier-gating, ter verduidelijking bij dezelfde vraag**: cross-channel-synthese loopt mee zodra
technisch mogelijk, ongeacht licentie — dat is de resource die deze fix nu overal aanzet.
Cross-account (portfolio-synthese, al gated op Growth+, masterplan eerder in de sessie) en God
View komen er pas bij op een betaald/hoger niveau. Deze fix raakt alleen de gratis-beschikbare
cross-channel-laag.

**Getest**: `lib/analysis/__auto_cross_channel_trigger_test.ts`, 3 assertions — geen enkele
databaseaanroep zonder API-sleutel (bewezen met een mock die hard faalt als `.from()` toch wordt
aangeroepen), geen exception bij het normale skip-pad (minder dan 2 kanalen), en geen exception
bij een gesimuleerde databasefout in `laadBeschikbareKanalen` — precies het scenario waar de
wrapper voor bestaat. `npx tsc --noEmit` schoon, volledige `scripts/gates.sh` groen.

**Wat dit niet doet**: geen wijziging aan `runCrossChannelSynthesis()` zelf, geen nieuwe
readiness-logica — die bestond al en wordt nu alleen daadwerkelijk bereikt.

### 17.26 Weekly en biweekly live getest: drie structurele bugs gevonden en gefixt

De eigenaar eiste dat weekly en biweekly net zo grondig live getest worden als monthly eerder
deze sessie ("weekly en bi weekly moeten absoluut getest worden"). Getest tegen `demo-greentech`
(enige klant met verse data op alle drie de kanalen) via de echte routes
(`/api/analysis/weekly`, `/api/analysis/biweekly`), niet gemockt. Drie echte bugs gevonden,
alledrie meteen gefixt en opnieuw live geverifieerd — niet slechts gerapporteerd.

**Bug 1 — een leeg dimension-availability-profiel werd gelezen als "alles ontbreekt".**
De allereerste weekly-run tegen demo-greentech kwam terug met alle drie de secties op "Niet
beschikbaar — analyseer NIET", ook al was de aangeleverde data in dezelfde prompt compleet en
vers. Oorzaak: `ads_dimension_availability` had nul rijen voor demo-greentech (die tabel wordt
gevuld door de echte Google Ads-sync-orchestrator, en demo-accounts lopen daar nooit doorheen),
en `buildAvailabilitySummary()` in `lib/analysis/dimension-availability.ts` las "nul rijen" als
"elke dimensie is expliciet gecontroleerd en ontbreekt" in plaats van "onbekend". Dat is precies
het omgekeerde van de eigen, net ernaast gedocumenteerde filosofie in `enrichment.ts`
("ontbrekende laag ≠ niets te melden, maar moet wel benoemd worden"). Fix: bij nul rijen een
expliciete "geen signaal, baseer je oordeel op de daadwerkelijk aangeleverde data"-melding in
plaats van de "niet beschikbaar"-lijst. Raakt niet alleen demo-accounts — elk net gekoppeld
account zonder eerste sync zou hetzelfde probleem hebben gehad. Getest:
`__dimension_availability_test.ts`, 7 assertions (leeg profiel geen blokkade, `evaluateSopSections`
zelf blijft intern ongewijzigd, een normaal profiel met echte rijen ongewijzigd gedrag).

**Bug 2 — het demo-seedscript liet acht tabellen structureel stale, ook meteen na een verse run.**
Na de fix hierboven bleven Meta en LinkedIn nog steeds op "Data is actueel" falen met een lege
periode — de freshness-check klopte (er stond wél data, ooit), maar het venster van de laatste 14
dagen was leeg. Onderzoek wees uit: `meta_account_daily`, `linkedin_account_daily` en zes andere
tabellen zijn views over `fact_core` (migratie 054); `scripts/demo/seed-demo-client.ts` schrijft
correct naar hun `*_legacy`-tegenhanger, maar riep nooit de projectie-RPC
`refresh_fact_from_legacy()` aan. Het script meldde dus "✓ meta_account_daily: 160 rijen" terwijl
de app een maand oude data bleef tonen — precies hetzelfde gat dat 17.20 destijds handmatig moest
omzeilen voor de GRT/GRA/GRN-split, alleen nooit teruggebracht in het herbruikbare script zelf.
Fix: `insertViaSupabase()` roept de RPC nu zelf aan als laatste stap, na alle upserts. Elke
toekomstige her-seed van de demo-klant is hierdoor in één run weer volledig actueel op alle
kanalen, zonder de handmatige RPC-aanroep die 17.20 nog apart moest onthouden.

**Bug 3 — een leeg LLM-antwoord werd stilzwijgend als geslaagde analyse opgeslagen.**
De LinkedIn weekly-run gaf `output: ""` terug — 54.188 tokens verbruikt (vermoedelijk vrijwel
volledig in reasoning), maar nul zichtbare tekst — en toch `"saved": true`, 0 findings, geen
foutmelding. `callOpenRouter()` (`lib/analysis/openrouter-client.ts`) retryt alleen bij een JSON-
parsefout in JSON-mode; een leeg antwoord buiten JSON-mode (de narratieve hoofdrapportage van elke
SOP) had geen eigen signaal en werd als elk ander geslaagd antwoord behandeld. Fix: een leeg
antwoord buiten JSON-mode retryt nu net als de bestaande JSON-parsefout, en gooit na uitputting
van de retries een leesbare fout in plaats van een lege string terug te geven — waardoor
`callLayer()`'s bestaande fallback-naar-tweede-model-logica automatisch aanslaat. Meteen
geverifieerd: de herhaalde LinkedIn weekly-run viel automatisch terug op
`google/gemini-3.7-flash` en leverde een volwaardig rapport (3 findings, 2 aanbevelingen).
Getest: `__openrouter_client_test.ts`, 8 assertions (normaal antwoord ongewijzigd, retry herstelt
een leeg antwoord, blijvend leeg gooit een leesbare fout met label, JSON-mode-pad blijft
ongewijzigd voor callers die zelf `parseStatus` uitlezen).

**Resultaat**: alle 6 combinaties (weekly + biweekly × Google/Meta/LinkedIn) tegen
demo-greentech geverifieerd met echte, inhoudelijke output en bevestigde databaseschrijvingen
(`sop_analysis_output`, sectie "full", alle 6 rijen met substantiële tekst, geen enkele leeg).
`npx tsc --noEmit` schoon, volledige `scripts/gates.sh` groen.

### 17.27 God View live getest met de 2 echte bureaus — geen "te weinig data" excuus

De eigenaar, met klem, herhaald: *"2 agencies is precies wat je nodig hebt om minimaal cross
agency inzichten op te halen"* — een expliciete herhaling van de 17.16-les (niet te snel
"onvoldoende data" concluderen). Eerder deze sessie werd God View afgedaan als "kan vandaag
structureel geen enkele rij produceren" omdat er maar 2 bureaus bestaan tegenover een
k-anonimiteitsdrempel van 4 — precies de fout die 17.16 al identificeerde, nu herhaald.

**Testroute bestond al, was nog nooit tegen echte data gedraaid.** 17.5 bouwde
`/api/platform/god-view?testdrempel=true` — een expliciet gelabelde, ALL_CLIENTS-gated
drempelverlaging (1 account/1 bureau) speciaal voor deze situatie — maar de masterplan-tekst
bewees destijds alleen dat het MECHANISME het argument doorgeeft (`metrics: null` zonder,
`metrics: {...}` mét), niet dat het iets zinnigs oplevert op de 2 bureaus die vandaag echt bestaan.

**Drie aparte blokkades, geen van alle "te weinig bureaus".** Bij het daadwerkelijk proberen
bleken er drie losse, elkaar niet overlappende gaten te zijn: (1) `agencies.benchmark_optin_at`
staat op `null` voor zowel Ranking Masters als Demo — een aparte opt-in-poort, los van de
k-anonimiteitsdrempel; (2) Ranking Masters' laatste volledige sync-maand is april 2026 (de
"permanente sync-stilstand" die 17.20 al accepteerde), dus een enkele kalendermaand-query vindt
nooit data van beide bureaus tegelijk; (3) van de 70 echte Ranking Masters-accounts hebben er maar
8 ooit een `bedrijfsmodel`/`niche` in `client_settings` gekregen, en `demo-greentech` zelf géén
(alleen de tijdelijke GRT/GRA/GRN-pseudoklanten uit 17.20 hadden er een, en die zijn opgeruimd).

**Zelfde patroon als 17.19/17.20: de echte kernfunctie rechtstreeks aangeroepen, niet de HTTP-laag
omzeild in de analysecode zelf.** Een wegwerpscript (verwijderd na afloop, geen databaseschrijving)
riep `bouwGodViewCellen()` — volledig ongewijzigd — aan met: de 8 echte, gesegmenteerde Ranking
Masters-klanten en hun echte april-cijfers uit `blended_account_monthly`, plus `demo-greentech`
met zijn echte julicijfers en het bedrijfsmodel/niche waarvoor de klant is ONTWORPEN
(`b2b`/`industrie`, letterlijk zo gedocumenteerd in `scripts/demo/seed-demo-client.ts` sinds
17.20) als testinvoer — niet naar de database geschreven, alleen als functieargument. Dezelfde
testdrempel als `?testdrempel=true` (1 account/1 bureau).

**Resultaat: het mechanisme werkt, bewezen op echte cijfers.** 10 van de 18 gevonden cellen
leverden een echte mediane CPA/ROAS op — o.a. mediane CPA €26,25 over 8 echte b2c-klanten
(Ranking Masters), en per-niche cijfers als €10,39 CPA voor "wonen" en €264,65 voor
"retail-lokaal", stuk voor stuk uit echte spend/conversieverhoudingen, nooit uit een enkel account
terug te rekenen (de hele reden voor mediaan-van-verhoudingen i.p.v. som/som, zie de koptekst van
`god-view.ts`). **Eerlijke, bruikbare bijvangst**: 0 van de 18 cellen combineerden daadwerkelijk 2
bureaus in dezelfde cel — niet omdat het mechanisme het niet zou toestaan (de testdrempel staat
dat al bij 1 bureau toe), maar omdat Ranking Masters' 8 gesegmenteerde klanten stuk voor stuk b2c
zijn terwijl Demo als b2b is ontworpen: er is vandaag geen natuurlijke segment-overlap tussen de
twee bureaus. Zodra een klant bij een van beide bureaus een niche/model deelt met een klant bij de
ander, activeert een echte cross-agency-cel zich vanzelf — dat is al aangetoond te werken op
losse cellen. De praktische hefboom is dus niet "wacht op meer bureaus" maar "breid de
segmentatiedekking uit": 62 van de 70 Ranking Masters-accounts hebben nog nooit een
`bedrijfsmodel`/`niche` gekregen.

**Wat dit niet doet**: geen wijziging aan `god-view.ts`, `god-view-data.ts` of de testroute zelf —
dit was uitsluitend verificatie met echte cijfers, geen enkele databaseschrijving, geen
opt-in-vlag aangeraakt. Geen enkel bestand overgebleven na afloop.
