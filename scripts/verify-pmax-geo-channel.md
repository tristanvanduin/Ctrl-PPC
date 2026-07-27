# Kan PMax-kanaal gekruist worden met land?

Dit is de enige open vraag onder "PMax channel performance per land". De rest van het ontwerp
hangt eraan, en hij is met twee queries te beantwoorden. Draaien tegen een echt account — in de
Google Ads-interface via **Tools → Query-tool (GAQL)**, of via de API met de credentials die de
sync gebruikt.

## Wat we zeker weten

Sinds **API v23** (januari 2026) geeft `segments.ad_network_type` voor Performance Max de echte
kanalen terug in plaats van één verzamelwaarde `MIXED`: `SEARCH`, `SEARCH_PARTNERS`, `CONTENT`,
`YOUTUBE`, `DISCOVER`, `GMAIL`, `MAPS`, `GOOGLE_TV`. Dat is precies de uitsplitsing uit het
"Where your conversions come from"-rapport.

Twee dingen om te onthouden:

- **Kanaaldata bestaat pas vanaf 1 juni 2025.** Oudere maanden blijven `MIXED`, ook op v23.
- Deze codebase staat al op v23 (`lib/api/google-ads.ts`), dus dit werkt zodra je synct.

## Query 1 — de kernvraag

Mag het kanaal-segment op de geo-resource?

```sql
SELECT
  geographic_view.country_criterion_id,
  segments.ad_network_type,
  metrics.cost_micros,
  metrics.conversions
FROM geographic_view
WHERE segments.date DURING LAST_30_DAYS
  AND metrics.impressions > 0
```

**Komt er data uit** → land × kanaal is meetbaar. Dan is het één syncfunctie plus een kolom in de
matrix, en beantwoordt het dashboard al je voorbeeldvragen, inclusief die over PMax.

**Krijg je een fout over incompatibele velden** → de combinatie bestaat niet. Ga naar query 2.

## Query 2 — de terugvaloptie controleren

Als geo × kanaal niet mag, is de vraag of het kanaal-segment tenminste per campagne werkt (dat
weten we zeker) én of `user_location_view` zich anders gedraagt dan `geographic_view`:

```sql
SELECT
  user_location_view.country_criterion_id,
  segments.ad_network_type,
  metrics.cost_micros
FROM user_location_view
WHERE segments.date DURING LAST_30_DAYS
```

`geographic_view` gaat over waar Google denkt dat iemand geïnteresseerd in is; `user_location_view`
over waar iemand fysiek was. Het zijn andere resources met een andere segmentcompatibiliteit, dus
het is de moeite waard om beide te proberen voordat je concludeert dat het niet kan.

## Als beide niet werken

Dan is land × kanaal binnen PMax **niet meetbaar** en heb je twee eerlijke opties.

**Toerekenen — afgeraden.** PMax-spend per land verdelen volgens de accountbrede kanaalmix levert
een model op dat er precies uitziet als een meting. Wie het scherm leest kan het verschil niet
zien. Doe je het toch, label het dan als schatting en nooit naast echte cijfers zonder markering.

**PMax opsplitsen per land — de structurele oplossing.** Eén PMax-campagne per markt maakt de
campagne de landdimensie, en dan geeft het bestaande kanaalrapport per campagne automatisch
kanaal × land. Dat kost je de optimalisatie over landen heen en vraagt genoeg volume per markt om
uit de leerfase te komen, maar het is de enige route naar échte cijfers.

Dat is een afweging over accountstructuur, geen dashboardkeuze — en daarom hoort hij bij jou en
niet bij de code.
