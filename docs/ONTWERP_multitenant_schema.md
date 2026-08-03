# Ontwerp: multi-tenant schema en kanaalneutrale feiten

**Status: VOORSTEL. Er is nog niets aan de database veranderd.**
Opgesteld 3 augustus 2026, op basis van metingen tegen de live database — niet op basis van
het schema zoals het bedoeld was, maar zoals het er staat.

Dit document beantwoordt drie vragen:

1. Hoe goed staat het er nu voor als er 20 bureaus met elk ~20 accounts komen?
2. Wat kost het om TikTok, Bing, Pinterest of Snapchat toe te voegen?
3. Kan een LLM-analyse per onderdeel precies de data ophalen die hij nodig heeft?

---

## 1. Wat er nu staat, gemeten

112 tabellen in `public`. De cijfers hieronder komen uit queries tegen de live database.

### 1.1 Er is geen bureau-laag

| | |
|---|---|
| tabellen met `client_id` | **99** |
| tabellen met `agency_id`, `tenant_id`, `org_id`, `workspace_id` | **0** |

De klant is het hoogste niveau dat bestaat. Er is geen entiteit die zegt "deze twintig accounts
horen bij bureau A". Twintig bureaus is daarmee geen instelling maar een kolom op 99 tabellen,
plus elke query, elk schrijfpad en elke analyse die er iets mee moet.

`client_id` is bovendien overal `text` en er is geen `clients`-tabel. De waarden komen uit de
Google Ads MCC en uit `app_settings`. Dat was een bewuste keuze (zie migratie 032: "een FK zou
hier een tabel afdwingen die niet bestaat"), en voor één bureau is dat verdedigbaar. Voor twintig
niet: er is dan geen enkele plek waar staat welke accounts bestaan en van wie ze zijn.

### 1.2 Alle klantdata is nu voor iedereen leesbaar

Getest, niet aangenomen. Met de publieke anon-sleutel — die in elke browser zit die de app laadt:

```
GET /rest/v1/ads_campaign_monthly?select=client_id&limit=2000
→ 1000 rijen over 11 verschillende klanten, zonder inloggen
```

16 van de 112 tabellen hebben RLS aan. Bij één bureau is dit "interne data die intern blijft".
Bij twintig bureaus is dit bureau A dat de spend, campagnes en zoektermen van bureau B leest.

Dit is het ernstigste punt in dit document, en het is niet af te doen met een UI-filter: de
sleutel praat rechtstreeks met PostgREST.

### 1.3 Elk kanaal heeft zijn eigen woordenboek

`meta_campaign_daily` (34 kolommen) en `linkedin_campaign_daily` (29 kolommen) beschrijven
hetzelfde begrip — dagelijkse campagnecijfers — en delen **9 kolommen**.

| begrip | Google | Meta | LinkedIn |
|---|---|---|---|
| kosten | `cost` | `spend` | `spend` |
| klikken | `clicks` | `clicks_all`, `link_clicks` | `clicks`, `landing_page_clicks` |
| entiteit | `campaign_id` | `entity_id` | `entity_urn` |
| conversies | `conversions` | `conversions` | `one_click_leads`, `post_click_conversions` |

Meta en LinkedIn zijn het hier toevallig eens over `spend`, Google noemt het `cost`. Bij klikken
loopt het weer uiteen, en waar Google één `clicks` heeft, hebben de andere twee er twee met een
verschillende betekenis. Er is geen regel; het is per tabel gegroeid.

Tabellen per kanaal: Google 39, Meta 15, LinkedIn 12.

Dezelfde grootheid draagt ook binnen één kanaal meerdere namen. Geteld over alle tabellen:
`cost` in 29, `spend` in 11; `conversions_value` in 25, `conversion_value` in 10;
`cost_per_conversion` in 11, `cpa` in 6.

Gevolg: geen enkele generieke query kan bestaan. Elke analyse en elke grafiek moet per kanaal
weten hoe iets heet, en dat is precies waarom de code op 55 plekken per kanaal vertakt en waarom
`lib/analysis/channel-conversion-config.ts` bestaat.

### 1.4 Afgeleide waarden staan opgeslagen naast hun eigen invoer

`ctr` staat in 20 tabellen, `conversion_rate` in 16, `roas` in 15 — allemaal berekenbaar uit
impressies, klikken, kosten en conversies die in dezelfde rij staan.

Gemeten op `ads_campaign_monthly` (4707 rijen):

| | |
|---|---|
| rijen waar `ctr` niet klopt met `clicks/impressions`, in geen enkele eenheid | **104** |
| rijen waar `conversion_rate` niet klopt met `conversions/clicks`, in geen enkele eenheid | **552** |

Steekproef op de grootste afwijkingen:

| campagne | klikken | conversies | opgeslagen | berekend |
|---|---:|---:|---:|---:|
| PMax Shopping ROAS | 21.141 | 536,3 | 0,0117 | 0,0254 |
| PMax Shopping ROAS | 19.726 | 498,2 | 0,0072 | 0,0253 |

Dat is geen afronding maar een factor twee tot drie. De waarschijnlijke verklaring is een andere
noemer bij PMax (interacties in plaats van klikken) of een andere conversieset.

**Het probleem is niet welke van de twee klopt — het is dat het schema nergens vastlegt welke
leidend is.** Een grafiek die `conversion_rate` leest en een grafiek die hem uitrekent tonen
verschillende getallen voor dezelfde campagne in dezelfde maand. Beide zien er correct uit.

### 1.5 Bijna geen referentiële integriteit

6 foreign keys over 112 tabellen. Niets houdt een rij tegen die naar een niet-bestaande klant,
campagne of hypothese wijst. Dat is geen theoretisch bezwaar: de vier rijen met een hele
hypothesetekst in `sprint_items.owner` konden er precies daarom in.

### 1.6 Wat géén probleem is

**Volume.** Bij 400 accounts groeit de grootste tabel van 244.000 naar circa 1,6 miljoen rijen.
Daar draait Postgres zijn hand niet voor om.

Wel: van de 24 tabellen met meer dan 500 rijen hebben er **8 geen index op `client_id`** —
`sop_insights`, `search_term_analysis`, `sop_tasks`, `ads_product_performance_monthly`,
`ads_campaign_country_monthly`, `ads_pmax_network_breakdown`,
`ads_asset_group_performance_monthly`, `generation_job_events`. Nu onzichtbaar bij 60 klanten,
merkbaar bij 400. Dat is losstaand van dit hele ontwerp op te lossen en kost een middag.

### 1.7 Waar de eerste versie van dit ontwerp op faalde

De eerste versie van §2 stelde één `fact_daily` voor met vijf kanonieke metriekkolommen en een
`jsonb` voor de rest. Twee aannames daarin zijn getoetst en allebei onjuist gebleken. Ze staan
hier omdat ze het ontwerp bepalen — en omdat een ontwerp dat zijn eigen fouten verzwijgt
onbruikbaar is.

**Aanname 1: alles staat per dag. Onjuist — maar niet om de reden die ik eerst opschreef.**

| korrel | tabellen |
|---|---:|
| `month` | **29** |
| `date` | 13 |
| `week` / `week_start` | 4 |

De Google-data staat per **maand**. Mijn eerste conclusie daaruit was dat dagdetail "niet
bestaat". Dat is fout, en het is een belangrijke fout: de Google Ads API levert wél dagniveau.
Geteld in `lib/api/google-ads.ts`:

| | |
|---|---|
| `segments.date` | 37× — maar in de **WHERE**, als datumfilter |
| `segments.month` | 25× — in de **SELECT**, als groepering |
| `segments.week` | 1× |

We vragen de API dus om maandtotalen terwijl de dagen beschikbaar zijn. De korrel wordt
weggegooid bij het ophalen, niet door het platform. Dat is te herstellen door anders te syncen,
en het is bovendien de goede kant op: **je kunt altijd optellen naar boven, nooit uitsplitsen
naar beneden.** Wie maanden opslaat kan nooit meer een weektrend tonen; wie dagen opslaat kan
alles.

Wat het wél kost, doorgerekend op de huidige data en geëxtrapoleerd naar 400 accounts:

| niveau | rijen per jaar bij 400 accounts, dagkorrel |
|---|---:|
| account / campagne | 448.000 |
| creatives | 2,9 mln |
| keywords | 9,5 mln |
| **zoektermen** | **39 mln** |

Tot en met creatives is dag een non-discussie. Bij zoektermen wordt het een echte afweging: 39
miljoen rijen per jaar vraagt partitionering per maand, en de vraag is wat het oplevert. Een
zoekterm met twee klikken in een maand heeft geen zinvolle dagcurve; de zoektermanalyse kijkt
naar periodes, niet naar dagen.

De conclusie is dus niet "alles per dag" en ook niet "alles per maand", maar: **sla op in de
fijnste korrel die een analyse daadwerkelijk gebruikt.** Account, campagne en creative op dag —
daar draaien pacing, trends en fatigue op. Keywords en zoektermen op week of maand.

Precies daarom is `grain` als kolom de goede keuze, en niet een tabelnaam die de korrel vastlegt:
per niveau kan een andere korrel gelden, en dat kan later veranderen zonder schemawijziging.

**Aanname 2: vijf kanonieke metrieken dekken het meeste. Onjuist — het is een kwart.**

Geteld over de 14 grootste tabellen: 235 numerieke kolommen, waarvan **60 (25%)** binnen
impressies/klikken/kosten/conversies/waarde vallen. De overige **175** zouden in `jsonb`
belanden. Voor `meta_campaign_daily` is dat 24 van de 28 kolommen, voor
`linkedin_campaign_daily` 19 van de 23.

Daarmee vervalt het hele argument voor die opzet. `extra` zou niet de staart zijn maar de romp:
creative fatigue draait op `frequency`, `hook_rate` en `hold_rate`, LinkedIn op zijn
lead-varianten, video op `thruplay` en `video_3s_views`. Al die analyses zouden ongetypeerd door
jsonb moeten, en trager worden dan ze nu zijn.

De les zit niet in de twee fouten maar in de vorm ervan: beide waren generalisaties over data
die ik niet had geteld. De eerste is bovendien pas rechtgezet doordat er iemand tegenin ging —
ik had de maandopslag als een gegeven aangenomen in plaats van te kijken waar hij vandaan kwam.
§2 hieronder is herschreven op de gemeten werkelijkheid.

### 1.8 Wat goed is en moet blijven

Dit document is kritisch omdat dat de opdracht is, maar er staat veel dat deugt:

- de sync-laag schrijft idempotent en houdt `sync_runs` bij
- `schema_migrations` registreert elke migratie met checksum
- `analysis_prepared_context` is het begin van precies de laag die dit document voorstelt
- de scheiding tussen ruwe feiten (`ads_*`) en afgeleide analyses (`sop_*`) is er al
- migratie 032 doet de autorisatie al goed op rol- en scope-niveau

Het ontwerp hieronder gooit dat niet weg. Het zet er een niveau boven en eronder.

---

## 2. Het doelschema

### 2.1 Twee nieuwe niveaus bovenaan

```sql
-- Het bureau. De tenant.
create table agencies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Het advertentieaccount. Bestaat nu alleen als losse tekst in 99 tabellen.
create table accounts (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies(id) on delete restrict,
  client_id    text not null unique,   -- de bestaande sleutel, blijft geldig
  name         text not null,
  created_at   timestamptz not null default now()
);
```

`accounts.client_id` blijft de tekstsleutel die er nu al overal staat. Daardoor hoeft geen enkele
bestaande rij te veranderen: de koppeling naar een bureau is een join, geen migratie van data.

`on delete restrict` en niet `cascade`: een bureau verwijderen mag nooit stilzwijgend de
historie van twintig accounts meenemen.

### 2.2 Twee lagen feiten, niet één

De gemeten werkelijkheid (§1.7) dwingt een andere opzet dan één tabel voor alles. Er komen er
twee, met een duidelijke taakverdeling.

**Laag 1 — `fact_core`: de vijf grootheden die élk platform levert.**

Dit is de laag waar vergelijken op draait: portfolio-overzichten, cross-channel, bureau-totalen,
"waar gaat het budget heen". Precies de vragen die over kanalen heen gaan, en dus precies de
vragen die alleen de universele metrieken gebruiken — dat is waarom ze universeel zijn.

```sql
create table fact_core (
  account_id   uuid not null references accounts(id) on delete cascade,
  channel      text not null,          -- 'google' | 'meta' | 'linkedin' | 'tiktok' | ...
  level        text not null,          -- 'account' | 'campaign' | 'adgroup' | 'creative'
  entity_id    text not null default '',
  entity_name  text,

  -- De korrel staat in de data, niet in de tabelnaam. Google levert maand, Meta en LinkedIn dag.
  grain        text not null check (grain in ('day','week','month')),
  period_start date not null,

  impressions  bigint  not null default 0,
  clicks       bigint  not null default 0,
  cost         numeric not null default 0,
  conversions  numeric not null default 0,
  conv_value   numeric not null default 0,

  synced_at    timestamptz not null default now(),
  primary key (account_id, channel, level, entity_id, grain, period_start)
);
```

`grain` als kolom lost aanname 1 op: een maandrij is een maandrij en doet niet alsof hij een dag
is. Een query die maanden wil vraagt `grain = 'month'`; een query die over kanalen heen optelt
moet expliciet kiezen welke korrel hij wil, en kan niet per ongeluk dagen bij maanden optellen.

Het maakt bovendien mogelijk wat §1.7 voorstelt: per niveau een andere korrel. Account,
campagne en creative op `day`, keywords en zoektermen op `week` of `month`, zonder dat daar een
aparte tabel voor nodig is. En als een niveau later fijner moet, is dat een sync-wijziging plus
nieuwe rijen — geen migratie.

Bij dagkorrel over 400 accounts komt `fact_dimension` in de tientallen miljoenen rijen per jaar.
Dan hoort er partitionering per maand op `period_start` bij. Dat is geen bezwaar tegen deze
opzet — het is een gewone maatregel bij dit volume — maar het hoort in de planning en niet als
verrassing.

**Laag 2 — `<kanaal>_metrics`: de kanaaleigen metrieken, getypeerd.**

De 175 kolommen uit §1.7 gaan niet in jsonb maar blijven echte kolommen, in een tabel per
kanaal, met dezelfde sleutel als `fact_core`:

```sql
create table meta_metrics (
  account_id  uuid not null references accounts(id) on delete cascade,
  level       text not null,
  entity_id   text not null default '',
  grain       text not null,
  period_start date not null,

  frequency        numeric,
  hook_rate        numeric,
  hold_rate        numeric,
  link_clicks      bigint,
  landing_page_views bigint,
  video_thruplay   bigint,
  add_to_cart      numeric,
  initiate_checkout numeric,
  -- ... de rest van de Meta-specifieke kolommen zoals ze nu al bestaan

  primary key (account_id, level, entity_id, grain, period_start)
);
```

De sleutel is dezelfde als in `fact_core` op één veld na: `channel` ontbreekt, want die staat al
in de tabelnaam. Een echte foreign key naar `fact_core` kan niet omdat de kanaalkolom daar deel
van de sleutel is en hier een constante zou zijn; de samenhang wordt daarom bewaakt door de sync,
die beide tabellen in dezelfde transactie schrijft, plus een controlequery die wees-rijen
opspoort. Dat is zwakker dan een FK en dat hoort hier te staan.

Zo blijft alles getypeerd en snel, blijft creative fatigue een gewone kolomquery, en hoeft geen
enkele bestaande analyse door jsonb.

**Wat dit wél oplevert ten opzichte van nu**, ook al blijven er kanaaltabellen bestaan:

- de universele metrieken staan één keer, onder één naam — geen `cost` naast `spend` meer
- cross-channel en portfolio lezen één tabel in plaats van drie met vertaalregels
- de korrel is expliciet in plaats van verstopt in een tabelnaam
- afgeleide waarden verdwijnen (zie §2.4), dus §1.4 kan niet terugkomen
- een nieuw kanaal is: rijen in `fact_core` plus één eigen metriektabel — geen aanpassing aan
  bestaande tabellen, geen aanpassing aan cross-channel schermen

**Wat het níét oplevert, eerlijk gezegd:** het aantal tabellen daalt niet dramatisch. Google 39,
Meta 15, LinkedIn 12 wordt niet 3. Het wordt wel: één gedeelde kern plus een voorspelbare
kanaaltabel per platform, in plaats van elk kanaal een eigen wildgroei. Dat is minder
spectaculair dan mijn eerste voorstel en het is wat er daadwerkelijk kan.

### 2.3 De dimensietabellen

Zoektermen, keywords, geo, device, netwerk, doelgroep, product: elk met een eigen dimensiekolom.
Die krijgen dezelfde behandeling — één gedeelde vorm, want hier zijn de metrieken wél universeel
(het zijn overal impressies, klikken, kosten, conversies):

```sql
create table fact_dimension (
  account_id  uuid not null references accounts(id) on delete cascade,
  channel     text not null,
  dimension   text not null,   -- 'search_term' | 'keyword' | 'country' | 'device' | ...
  key         text not null,
  parent_id   text not null default '',
  grain       text not null,
  period_start date not null,
  impressions bigint  not null default 0,
  clicks      bigint  not null default 0,
  cost        numeric not null default 0,
  conversions numeric not null default 0,
  conv_value  numeric not null default 0,
  primary key (account_id, channel, dimension, key, parent_id, grain, period_start)
);
```

Dit vervangt negen tabellen met negen bijna-identieke vormen:
`ads_search_terms_monthly`, `ads_keyword_performance_monthly`, `ads_geo_performance_monthly`,
`ads_device_performance_monthly`, `ads_network_performance_monthly`,
`ads_audience_performance_monthly`, `ads_country_monthly`, `ads_region_monthly`,
`linkedin_demographic_daily`.

Hier is de winst wél groot, en het risico klein: deze tabellen hebben nu al bijna dezelfde
kolommen.

### 2.4 Afgeleide waarden verdwijnen

Geen `ctr`, `roas`, `conversion_rate`, `cpa` of `cost_per_conversion` meer als opgeslagen kolom.
Die worden berekend waar ze getoond worden, uit de vijf kolommen van `fact_core`. Daarmee wordt
§1.4 structureel onmogelijk: er kunnen geen twee antwoorden bestaan omdat er één bron is.

Waar een platform een eigen ratio levert die afwijkt van zijn eigen componenten — zoals de
PMax-conversieratio, factor drie ernaast — hoort die in de kanaaltabel onder een naam die zegt
waar hij vandaan komt (`google_conversion_rate`), naast de berekening. Dan is het verschil
zichtbaar in plaats van een raadsel, en kiest het scherm bewust welke het toont.

### 2.5 Indexen

```sql
create index on fact_core (account_id, channel, grain, period_start desc);
create index on fact_core (account_id, grain, period_start desc) where level = 'account';
create index on fact_dimension (account_id, channel, dimension, grain, period_start desc);
create index on fact_dimension (account_id, dimension, cost desc);
```

### 2.6 Toegang

Met `accounts.agency_id` wordt RLS eindelijk uitdrukbaar:

```sql
alter table fact_core enable row level security;

create policy leest_eigen_bureau on fact_core for select to authenticated
using (exists (
  select 1 from accounts a
  join user_agencies ua on ua.agency_id = a.agency_id
  where a.id = fact_core.account_id and ua.user_id = auth.uid()
));
```

`user_agencies` is het bureau-equivalent van het bestaande `user_clients` uit migratie 032. De
rollen uit 001/032 blijven ongewijzigd geldig; er komt één as bij.

---

## 3. Wat dit oplevert voor de LLM-analyses

Dit is het punt waar het ontwerp het meest verschil maakt.

**Nu.** Een analyse moet per kanaal weten in welke tabel iets staat en hoe de kolom heet.
`analysis_prepared_context` lost dat op door hele tekstblokken voor te bakken
(`campaign_table_text`, `binding_facts_text`). Dat werkt, maar het is één groot blok: je kunt er
geen deel uit halen, dus gaat het geheel mee in de prompt.

**Straks.** Elke analysestap trekt exact zijn eigen slice, met dezelfde query-vorm ongeacht het
kanaal:

```sql
-- Budgetanalyse: alleen campagneniveau, alleen deze maanden, alleen wat telt.
select entity_name, sum(cost) as cost, sum(conversions) as conversions
from fact_core
where account_id = $1 and channel = $2 and level = 'campaign'
  and grain = 'month' and period_start >= $3 and period_start < $4
group by entity_name order by cost desc limit 25;
```

Analyses die kanaaleigen metrieken nodig hebben joinen er één kanaaltabel bij, met een
expliciete kolomlijst — nooit `select *`:

```sql
-- Creative fatigue: alleen wat fatigue betekent, niets meer.
select c.entity_name, c.impressions, m.frequency, m.hook_rate, m.hold_rate
from fact_core c
join meta_metrics m using (account_id, level, entity_id, grain, period_start)
where c.account_id = $1 and c.channel = 'meta' and c.level = 'creative'
  and c.grain = 'day' and c.period_start >= $2;
```

Dat is een paar kilobyte, niet een voorgebakken tekstblok. Concreet betekent dit:

- **budgetverdeling** haalt campagnes met kosten en conversies, verder niets
- **zoektermverspilling** haalt `dimension = 'search_term'` met kosten en nul conversies
- **creative fatigue** haalt `level = 'creative'` plus drie kolommen uit `meta_metrics`
- **geo** haalt `dimension = 'country'`

Elk een aparte call met een aparte prompt en een aparte slice. Geen enkele call ziet de data van
een andere. Dat is precies de eis: per onderdeel een eigen API-call met eigen data, in batches,
zonder dat het contextvenster volloopt.

De `limit` en de periode staan in de query en niet in de prompt, dus de omvang is begrensd
vóórdat er een token wordt verstookt.

---

## 4. Wat een nieuw kanaal dan nog kost

**Nu:** een nieuwe set tabellen (Google 39, Meta 15, LinkedIn 12 — dus ergens tussen 10 en 20),
een sync-route, een conversie-mapping, en meedoen in de 55 plekken waar de code per kanaal
vertakt. Realistisch één tot twee weken per kanaal, en elk kanaal maakt het volgende duurder
omdat er weer een woordenboek bijkomt.

**Straks:** één adapter die het platform-antwoord op de vijf velden van `fact_core` mapt, plus
één `<kanaal>_metrics`-tabel voor wat dat platform eigen heeft. Geen wijziging aan bestaande
tabellen, en geen nieuwe vertakking in de cross-channel schermen en portfolio — die lezen
`fact_core` en zien er een kanaal bij staan.

Eerlijke schatting: twee tot vier dagen, waarvan het grootste deel in de API-koppeling van het
platform zelf zit. Dat is minder dan de een tot twee weken van nu, maar het is niet nul — en mijn
eerste versie van dit document beweerde ten onrechte dat er helemaal geen schemawijziging meer
nodig zou zijn.

Wat wél per kanaal werk blijft: de kanaalspecifieke schermen. TikTok heeft geen zoektermen en
LinkedIn geen shopping-feed. Dat is terecht werk — het gaat over wat het kanaal ís, niet over
hoe wij het opslaan.

---

## 5. Migratiepad

De harde eis: **op geen enkel moment mag een bestaande analyse of grafiek breken.** Daarom loopt
alles via views, en wordt er pas iets weggegooid als alle lezers om zijn.

### Fase 0 — losstaand, nu al veilig
De 8 ontbrekende indexen op `client_id`. Raakt geen enkel schema en geen enkele query, maakt
alleen bestaande queries sneller. Volledig terug te draaien.

### Fase 1 — de nieuwe niveaus, leeg naast het oude
`agencies`, `accounts`, `user_agencies` aanmaken en vullen: één bureau met de bestaande accounts
eronder. Er verandert niets aan bestaande tabellen. Niets leest deze tabellen nog, dus er kan
niets breken.

### Fase 2 — de feitentabellen ernaast, dubbel geschreven
`fact_core`, `fact_dimension` en de kanaaltabellen aanmaken. De sync schrijft vanaf dat moment naar **beide**
plekken. De oude tabellen blijven de waarheid; de nieuwe worden gevuld en gecontroleerd.

Controle voordat er iets omgaat: per tabel en per maand de sommen van impressies, klikken,
kosten en conversies vergelijken tussen oud en nieuw. Wijkt er iets af, dan gaat de fase niet
door. Dat is een script, geen inschatting.

### Fase 3 — views onder de oude namen
Elke oude tabel wordt hernoemd naar `<naam>_legacy` en er komt een view met de oude naam die uit
`fact_core` leest en de oude kolomnamen teruggeeft:

```sql
alter table ads_campaign_monthly rename to ads_campaign_monthly_legacy;

create view ads_campaign_monthly as
select
  a.client_id,
  f.entity_id   as campaign_id,
  f.entity_name as campaign_name,
  to_char(f.period_start, 'YYYY-MM') as month,
  sum(f.impressions) as impressions,
  sum(f.clicks)      as clicks,
  sum(f.cost)        as cost,
  sum(f.conversions) as conversions
from fact_core f join accounts a on a.id = f.account_id
where f.channel = 'google' and f.level = 'campaign' and f.grain = 'month'
group by 1,2,3,4;
```

**Dit is de verzekering.** Alle 46 `select("*")`-aanroepen, alle grafieken en alle analyses
blijven werken zonder één regel wijziging. Gaat er iets mis, dan is de terugweg één
`drop view` plus `alter table ... rename` — seconden werk, geen dataverlies.

Let op: een view is niet schrijfbaar. Schrijfpaden moeten in deze fase al naar de nieuwe tabellen
wijzen. Dat zijn er weinig (de sync en een handvol server-routes) en die staan al op één plek in
`lib/data-access/`.

### Fase 4 — lezers omzetten, één voor één
Per scherm de query van de view naar `fact_core` verleggen. Elk scherm apart, elk met de
poorten én een gerenderde controle — dezelfde werkwijze als bij de tabelconversie: vooraf de
sectiekoppen en waarden vastleggen, achteraf diffen.

### Fase 5 — RLS aan
Pas als er ingelogd kan worden, en pas nadat fase 1 tot 4 rond zijn. Volgorde: inloggen werkend
→ RLS op de nieuwe tabellen → controleren dat de app nog laadt → pas dan de anon-sleutel zijn
brede leesrecht ontnemen.

### Fase 6 — het oude weg
`*_legacy` droppen als er niets meer op wijst. Aantoonbaar te maken met `pg_stat_user_tables`:
een tabel die weken geen enkele sequential of index scan meer heeft gehad, wordt door niets
gelezen.

---

## 6. Wat er per fase kan breken, en waarom niet

| fase | risico | waarom het opgevangen is |
|---|---|---|
| 0 | geen | alleen indexen erbij |
| 1 | geen | nieuwe lege tabellen, niets leest ze |
| 2 | dubbel schrijven kan uit de pas lopen | somvergelijking oud vs nieuw per maand blokkeert de volgende fase |
| 3 | een view die anders telt dan de tabel | zelfde somvergelijking, nu view vs `_legacy`; terugweg is één rename |
| 4 | een scherm dat stilletjes andere getallen toont | per scherm vooraf/achteraf gerenderd vergelijken |
| 5 | iedereen buitengesloten | `service_role` omzeilt RLS altijd, dus de terugweg blijft open |
| 6 | een vergeten lezer | scan-statistieken bewijzen dat er niets meer leest |

---

## 7. Wat dit ontwerp bewust NIET doet

- **Geen volledige EAV.** Zie §2.2 — traag en typeloos bij dit volume.
- **Geen aparte database of schema per bureau.** Klinkt veilig, maar dan is elke migratie twintig
  migraties en elke portfolio-vraag over bureaus heen onmogelijk. RLS op één schema doet
  hetzelfde met minder bewegende delen.
- **Geen herberekening van historische data.** De bestaande rijen gaan over zoals ze zijn. Waar
  een opgeslagen ratio afweek van zijn componenten (§1.4) wordt de ratio niet gecorrigeerd maar
  bewaard onder zijn eigen naam in `extra`, zodat het verschil zichtbaar blijft in plaats van
  weggepoetst.
- **Geen hernoeming van `client_id`.** Die tekstsleutel blijft, ook in `accounts`. Hij staat op
  te veel plekken en werkt prima als natuurlijke sleutel.

---

## 8. Toetsing van het ontwerp zelf

De drie risico's uit §5 zijn gemeten voordat er iets gebouwd is. Alles read-only tegen de live
database; er is geen enkel object aangemaakt of gewijzigd.

### 8.1 Passen de kanaalkolommen in één tabel per kanaal? — Ja, ruimer dan verwacht

| tabel | metrieken | korrel |
|---|---:|---|
| `linkedin_account_daily` | 23 | date |
| `linkedin_campaign_daily` | 23 | date |
| `linkedin_creative_daily` | 23 | date |
| `meta_account_daily` | 28 | date |
| `meta_campaign_daily` | 28 | date |
| `meta_ad_daily` | 28 | date |

Binnen een kanaal draagt **elk niveau dezelfde metriekenset op dezelfde korrel**. Eén
`<kanaal>_metrics` met `level` in de sleutel dekt account, campagne en creative in één keer — en
vervangt daarmee drie tabellen per kanaal in plaats van er één bij te zetten.
`linkedin_demographic_daily` heeft er 6 en is een dimensie; die hoort bij `fact_dimension`.

### 8.2 Zijn aggregerende views snel genoeg? — Ja, mits begrensd

Gemeten op `ads_search_terms_monthly` (243.666 rijen):

| query | tijd |
|---|---:|
| aggregeren over álle klanten | 1.882 ms |
| aggregeren voor één klant (de grootste) | **137 ms** |
| voorgeaggregeerde maandtabel lezen, één klant | 30 ms |

Een view is dus ongeveer 4,5× duurder dan een voorgeaggregeerde tabel, en 137 ms is ruim
voldoende voor een scherm.

**De voorwaarde staat in de tweede regel van die tabel.** Die 137 ms scande de héle historie van
die klant. Op dagkorrel bij 400 accounts is dat een veelvoud. Views zijn daarom houdbaar op
precies één voorwaarde: **elke query is begrensd op klant én periode**, met een index
`(account_id, grain, period_start desc)` die dat ondersteunt. Een ongefilterde query door een
aggregerende view is een volledige scan van een klanthistorie.

### 8.3 Zijn de bestaande lezers begrensd? — Grotendeels, en het restant is telbaar

| | |
|---|---:|
| `select("*")`-aanroepen | **100** |
| waarvan met een `client_id`-filter | 97 |
| waarvan óók met een periode- of maandfilter | **64** |

De 36 zonder periodefilter zijn het werk dat vóór fase 3 af moet, en ze raken precies de tabellen
die view worden: `ads_account_weekly`, `ads_account_monthly`, `ads_campaign_monthly`,
`ads_keyword_performance_monthly`, `ads_creative_performance` en verwanten.

Dat is geen ontdekking meer maar een lijst: 36 plekken een periodefilter geven, vóór de omzetting
en los ervan te testen.

### 8.4 Wat nog steeds niet getoetst is

PostgREST geeft bij `select("*")` op een view terug wat de view heeft. Ontbreekt er een kolom die
de code verwacht, dan is dat in JavaScript `undefined` en geen foutmelding — dus stil verkeerd.
Dat is geen risico dat een test wegneemt maar een eigenschap van de opzet.

De maatregel hoort daarom in fase 3 zelf: per view een kolom-diff tegen de `_legacy`-tabel, en
die diff moet leeg zijn voordat de rename doorgaat. Geen inschatting, een script.

### 8.5 Conclusie

Geen van de drie toetsen heeft het ontwerp gekraakt. Eén kwam er beter uit dan verwacht, twee
leverden een voorwaarde op die telbaar en vooraf af te vinken is in plaats van een onbekende.

Dat is genoeg om te beginnen — met de fases die aantoonbaar omkeerbaar zijn, en met een expliciet
go/no-go vóór de eerste onomkeerbare stap.
