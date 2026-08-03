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

### 1.7 Wat goed is en moet blijven

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

### 2.2 Feiten worden kanaalneutraal, per korrel

In plaats van tabellen per kanaal komen er tabellen per **korrel** — het niveau waarop een feit
geldt. De kanaalnaam wordt een kolom in plaats van een tabelnaam.

```sql
create table fact_daily (
  account_id    uuid not null references accounts(id) on delete cascade,
  channel       text not null,          -- 'google' | 'meta' | 'linkedin' | 'tiktok' | ...
  level         text not null,          -- 'account' | 'campaign' | 'adgroup' | 'creative'
  entity_id     text not null,          -- '' op accountniveau
  entity_name   text,
  date          date not null,

  -- Kanonieke metrieken: wat élk advertentieplatform levert.
  impressions   bigint  not null default 0,
  clicks        bigint  not null default 0,
  cost          numeric not null default 0,   -- altijd in de valuta van het account
  conversions   numeric not null default 0,
  conv_value    numeric not null default 0,

  -- Alles wat echt kanaalspecifiek is: hook_rate, one_click_leads, video_thruplay, ...
  extra         jsonb   not null default '{}',

  synced_at     timestamptz not null default now(),
  primary key (account_id, channel, level, entity_id, date)
);
```

**Waarom kanonieke kolommen én een jsonb, en niet één van beide.**

Volledig EAV — een rij per metriek met een `metric`/`value`-paar — is verleidelijk omdat elk
kanaal er dan in past zonder schemawijziging. Maar dan verliest elke som zijn type, wordt elke
aggregatie een pivot, en is er geen enkele constraint meer die zegt dat kosten een getal zijn.
Bij 1,6 miljoen rijen wordt dat traag én stil fout.

Alles als kolom werkt ook niet: dan groeit de tabel bij elk kanaal en staat hij vol met
kolommen die voor 80% van de rijen leeg zijn.

De middenweg: de vijf grootheden die élk platform levert krijgen een echte, getypeerde kolom —
daar draaien alle sommen, grafieken en vergelijkingen op. De rest gaat in `extra`, met een
GIN-index, en wordt alleen uitgepakt door het scherm dat er specifiek om vraagt.

**Afgeleide waarden staan er bewust niet in.** Geen `ctr`, geen `roas`, geen `conversion_rate`.
Die worden berekend waar ze getoond worden, uit de vijf kolommen hierboven. Dat maakt §1.4
structureel onmogelijk: er kunnen geen twee antwoorden meer zijn omdat er maar één bron is.

Waar een platform een eigen ratio levert die *afwijkt* van de eigen componenten — zoals de
PMax-conversieratio — hoort die in `extra` onder zijn eigen naam (`google_conversion_rate`), met
de expliciete betekenis "dit is wat Google zegt", naast de berekening die zegt "dit is wat de
componenten zeggen". Dan is het verschil zichtbaar in plaats van een raadsel.

### 2.3 De dimensietabellen blijven apart

Zoektermen, keywords, geo, device, netwerk, doelgroep, product: die hebben elk hun eigen
dimensiekolom en horen niet in `fact_daily`. Ze krijgen dezelfde vorm:

```sql
create table fact_dimension_daily (
  account_id  uuid not null references accounts(id) on delete cascade,
  channel     text not null,
  dimension   text not null,   -- 'search_term' | 'keyword' | 'country' | 'device' | ...
  key         text not null,   -- de waarde binnen die dimensie
  parent_id   text,            -- campagne of adgroup waar hij onder valt, mag leeg
  date        date not null,
  impressions bigint  not null default 0,
  clicks      bigint  not null default 0,
  cost        numeric not null default 0,
  conversions numeric not null default 0,
  conv_value  numeric not null default 0,
  extra       jsonb   not null default '{}',
  primary key (account_id, channel, dimension, key, parent_id, date)
);
```

Dit vervangt in één klap `ads_search_terms_monthly`, `ads_keyword_performance_monthly`,
`ads_geo_performance_monthly`, `ads_device_performance_monthly`,
`ads_network_performance_monthly`, `ads_audience_performance_monthly`,
`ads_country_monthly`, `ads_region_monthly` en `linkedin_demographic_daily` — negen tabellen met
negen bijna-identieke vormen.

### 2.4 Indexen

```sql
create index on fact_daily (account_id, channel, level, date desc);
create index on fact_daily (account_id, date desc) where level = 'account';
create index on fact_dimension_daily (account_id, channel, dimension, date desc);
create index on fact_dimension_daily (account_id, dimension, cost desc);  -- "duurste zoektermen"
create index on fact_daily using gin (extra);
```

### 2.5 Toegang

Met `accounts.agency_id` wordt RLS eindelijk uitdrukbaar:

```sql
alter table fact_daily enable row level security;

create policy leest_eigen_bureau on fact_daily for select to authenticated
using (exists (
  select 1 from accounts a
  join user_agencies ua on ua.agency_id = a.agency_id
  where a.id = fact_daily.account_id and ua.user_id = auth.uid()
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
-- Budgetanalyse: alleen campagneniveau, alleen deze twee maanden, alleen wat telt.
select entity_name, sum(cost) as cost, sum(conversions) as conversions
from fact_daily
where account_id = $1 and channel = $2 and level = 'campaign'
  and date >= $3 and date < $4
group by entity_name order by cost desc limit 25;
```

Dat is een paar kilobyte, niet een voorgebakken tekstblok. Concreet betekent dit:

- **budgetverdeling** haalt campagnes met kosten en conversies, verder niets
- **zoektermverspilling** haalt `dimension = 'search_term'` met kosten en nul conversies
- **creative fatigue** haalt `level = 'creative'` plus `extra->>'frequency'`
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

**Straks:** één adapter die het platform-antwoord op de vijf kanonieke velden mapt en de rest in
`extra` zet. Geen schemawijziging, geen nieuwe tabel, geen nieuwe vertakking in de grafieken —
die lezen `fact_daily` en zien een kanaal meer. Schatting: een dag of twee, waarvan het meeste
in de API-koppeling van het platform zelf zit en niet in ons schema.

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
`fact_daily` en `fact_dimension_daily` aanmaken. De sync schrijft vanaf dat moment naar **beide**
plekken. De oude tabellen blijven de waarheid; de nieuwe worden gevuld en gecontroleerd.

Controle voordat er iets omgaat: per tabel en per maand de sommen van impressies, klikken,
kosten en conversies vergelijken tussen oud en nieuw. Wijkt er iets af, dan gaat de fase niet
door. Dat is een script, geen inschatting.

### Fase 3 — views onder de oude namen
Elke oude tabel wordt hernoemd naar `<naam>_legacy` en er komt een view met de oude naam die uit
`fact_daily` leest en de oude kolomnamen teruggeeft:

```sql
alter table ads_campaign_monthly rename to ads_campaign_monthly_legacy;

create view ads_campaign_monthly as
select
  a.client_id,
  f.entity_id   as campaign_id,
  f.entity_name as campaign_name,
  to_char(f.date, 'YYYY-MM') as month,
  sum(f.impressions) as impressions,
  sum(f.clicks)      as clicks,
  sum(f.cost)        as cost,
  sum(f.conversions) as conversions
from fact_daily f join accounts a on a.id = f.account_id
where f.channel = 'google' and f.level = 'campaign'
group by 1,2,3,4;
```

**Dit is de verzekering.** Alle 46 `select("*")`-aanroepen, alle grafieken en alle analyses
blijven werken zonder één regel wijziging. Gaat er iets mis, dan is de terugweg één
`drop view` plus `alter table ... rename` — seconden werk, geen dataverlies.

Let op: een view is niet schrijfbaar. Schrijfpaden moeten in deze fase al naar `fact_daily`
wijzen. Dat zijn er weinig (de sync en een handvol server-routes) en die staan al op één plek in
`lib/data-access/`.

### Fase 4 — lezers omzetten, één voor één
Per scherm de query van de view naar `fact_daily` verleggen. Elk scherm apart, elk met de
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
