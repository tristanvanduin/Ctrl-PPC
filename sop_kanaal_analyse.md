# SOP Kanaalanalyse — weekly, bi-weekly en monthly over drie kanalen

Codeaudit, 24 augustus 2026. Broncode-analyse: geen SOP gedraaid, geen opgeslagen runs gelezen.
Elke bevinding is nagelopen in het genoemde bestand op de genoemde regel. Regelnummers verwijzen
naar de staat van `claude/sop-kanaal-analyse-9na6v3` op het moment van lezen.

Conventie: **Deterministic** = in de code geverifieerd. **Inferred** = redenering op basis daarvan.

---

## 1. Wat er staat

Deterministic:

- Drie kanalen (`lib/analysis/sop-channel-config.ts:20-34`), drie cadansen
  (`lib/scheduler/sop-cadence.ts:44`), negen combinaties. Alle negen bestaan end-to-end: elke route
  dispatcht op `channel` naar een eigen functie.
- Monthly per kanaal: Google 13 stap-labels waarvan er acht daadwerkelijk draaien
  (`adapters/google-ads.ts:14-20`, `expectedStepNumbers: [1, 6, 7, 8, 9, 10, 12, 13]`), Meta 6
  pijlers (was 11), LinkedIn 6 pijlers (was 9) — beide `F5 fase3`.
- Weekly: 3 stappen, gedeelde preambule, kanaaleigen bodies voor stap 2 en 3
  (`lib/prompts/weekly-channel-content.ts`).
- Bi-weekly: 4 stappen, kanaaleigen titels en datasets voor stap 3 en 4
  (`lib/prompts/biweekly-channel-content.ts`).

---

## 2. Scorekaart (1–10)

| As | Systeem | Weekly | Bi-weekly | Monthly |
| --- | --- | --- | --- | --- |
| Logica | 6 | 4 | 5 | 8 |
| Kwaliteit | 7 | 5 | 5 | 8 |
| Consistentie | 6 | 5 | 5 | 7 |
| Leercyclus | 4 | 1 | 4 | 6 |
| Agency memory | 4 | 1 | 3 | 6 |
| Volwassenheid | 5 | 5 | 5 | 7 |
| Dekking | 6 | 3 | 6 | 8 |

### Per kanaal

| Kanaal | Logica | Kwaliteit | Consistentie | Leercyclus | Memory | Volwassenheid | Dekking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| google_ads | 7 | 7 | 7 | 6 | 6 | 7 | 8 |
| meta_ads | 6 | 7 | 5 | 3 | 3 | 5 | 6 |
| linkedin_ads | 6 | 7 | 5 | 3 | 3 | 4 | 4 |

Inferred: de monthly verdient de hoge cijfers, de weekly trekt elk gemiddelde omlaag. Meta en
LinkedIn verliezen niet op analysekwaliteit maar op alles eromheen — context, geheugen, handhaving.

---

## 3. Bevindingen, gerangschikt op impact gedeeld door inspanning

### P0-1 — De LinkedIn-weekly kan op live data niet draaien

Deterministic:
- `app/api/sync/linkedin/route.ts:52-57,135` — `lastCompleteMonthEnd()` levert de laatste dag van de
  vorige afgesloten kalendermaand, en dat is de `endDate` voor backfill én dagelijkse sync.
- `lib/linkedin/sync-windows.ts:26-30` — `trailingWindow(endDate, 30)` is 30 dagen *eindigend* op die
  datum.
- `app/api/analysis/weekly/route.ts:545-548` — de LinkedIn-weekly vraagt `daysAgo(14)` tot vandaag.
- `app/api/analysis/weekly/route.ts:576-585` — bij nul rijen: 404 met "Sync de data via POST /api/sync".

Inferred: op 24 augustus vult de sync 2–31 juli en vraagt de weekly 10–24 augustus. Geen overlap.
Alleen in de eerste twee weken van een maand is er gedeeltelijke dekking; de rest van de maand geeft
deze SOP een 404 die de gebruiker vertelt te syncen terwijl de sync correct heeft gedraaid.

Kans: laat de *dagelijkse* sync tot gisteren lopen; alleen de backfill heeft een maandgrens nodig.
Eén aanroep op regel 135. Zolang dat niet kan, hoort de combinatie niet als beschikbaar in de UI.

Aanpalend (deterministic): `lib/meta/sync.ts` heeft nul productie-imports en staat als toegestane
wees in `scripts/check-hygiene.mjs:163` — "gated op MDP-approval". De Meta-entiteitstabellen worden
door niets gevuld, dus `fetchNameMap` komt leeg terug en de Meta-analyses noemen campagnes bij hun
kale Facebook-ID. Externe blokkade, geen fout — maar het betekent dat het Meta-oordeel hieronder over
de code gaat, niet over live output.

### P0-2 — De verrijkingslaag bereikt alleen Google, in alle negen combinaties

Deterministic:

| Route | Regel | `sharedContext` |
| --- | --- | --- |
| weekly google | 148 | strategicContext + targets + dimAvail + reliability + leadingIndicators + sectorBenchmarks + changeHistory + geoContext |
| weekly meta | 385 | targets + reliability |
| weekly linkedin | 611 | targets + reliability |
| biweekly google | 205 | idem weekly google + hypothesisTracking |
| biweekly meta | 469 | targets + reliability |
| biweekly linkedin | 736 | targets + reliability |

- `app/api/analysis/monthly/route.ts:1876` — `buildEnrichmentContext` staat ná de returns van Meta
  (`:1597`) en LinkedIn (`:1600`), dus ook de monthly verrijkt alleen Google.
- `lib/analysis/enrichment.ts:65-97` — de matrix is op *cadans* gesleuteld, niet op kanaal. De laag is
  kanaalneutraal geschreven; hij wordt alleen niet aangeroepen.

Kans: til de aanroep uit de Google-tak naar de gedeelde voorbereiding van elke route en voeg de
uitkomst toe aan de bestaande `sharedContext` van alle drie de kanalen. Lagen zonder bron voor een
kanaal geven al een lege string terug.

### P0-3 — Drie stappen vragen om cijfers die hun route nooit meestuurt

Deterministic:

1. **Google weekly stap 3.** Prompt vraagt >30% spend-afwijking WoW per campagne
   (`sop-prompts.ts:1845`) en budgetbenutting <50% (`:1847`). Geleverd: `ads_campaign_monthly`
   (`weekly/route.ts:82,215`) — maandrijen, geen budgetkolom. De prompt geeft het zelf toe met
   "(laatste 2 maanden als proxy)" (`:1842`).
2. **Google bi-weekly stap 4.** Heet "Device & Engagement", vraagt om waarden voor en na
   (`sop-prompts.ts:1630`). De userMessage bevat alleen de conclusies van stap 1–3
   (`biweekly/route.ts:280-293`) — geen device-rij. `monthly/route.ts:1663` haalt
   `ads_device_performance_monthly` wél op.
3. **LinkedIn bi-weekly stap 4.** "Bidding & Pacing" vraagt of een campagne vroeg leegloopt
   (`biweekly-channel-content.ts:61-69`). Geleverd: `campaignMonthly`, maandaggregatie
   (`biweekly/route.ts:817-820`). `daily_budget`, `unit_cost` en `bid_strategy` bestaan in
   `linkedin_campaigns` (`lib/linkedin/entities.ts:107-110`) en worden nergens geselecteerd.

Inferred: onder `NUMBER_DISCIPLINE` moet het model dan weigeren of getallen verzinnen. Omgekeerd
krijgen Meta en LinkedIn in de weekly juist wél dagrijen (`weekly/route.ts:440,666`, "voor
spend-anomalie WoW-check") — het is dus geen kanaalprobleem maar een koppelingsprobleem tussen prompt
en route.

### P0-4 — De kwaliteitspoort blokkeert niet bij opslaan, en bij export alleen voor Google

Deterministic:
- `monthly/route.ts:1079` berekent de poort; `:1092,1099,1100,1125` schrijven
  `quality_gate_monthly_v2`, `full`, `structured_monthly_v2` en de findings/recs/tasks
  **onvoorwaardelijk** weg. Er staat nergens `if (!qualityGate.passed)`.
- `app/api/analysis/pdf/route.ts:102-133` blokkeert wél, met 409 — maar achter
  `if (sopType === "monthly")`. Meta en LinkedIn schrijven onder `meta_monthly` en
  `linkedin_monthly`, dus die tak vuurt voor hen nooit.
- `monthly/route.ts:828,1116,1118` — Meta/LinkedIn geven `checkpoints: []` en `step_validations: []`
  mee, dus de `blocked_invalid_steps`-tak van `buildMonthlyQualityGate`
  (`lib/analysis/monthly-acceptance.ts:162-176`) kan bij hen structureel niet afgaan.

Inferred: de P0 uit `sop_audit.md` ("maak step validation hard-blocking voor structured save en
PDF-export") is voor één kanaal en één van de twee uitgangen geïmplementeerd.

Kans: laat de PDF-poort op de drie monthly-sleutels uit `CHANNEL_CONFIG` matchen in plaats van op de
letterlijke string, en geef Meta/LinkedIn per-stap-validaties — de adapters dragen
`logFormatSkeletons` en `purityRules` al.

### P1-5 — De weekly heeft geen enkel geheugen

Deterministic:
- Geen enkele treffer op `sop_analysis_output`, `getClientMemory` of `recordMemoryEvent` in
  `app/api/analysis/weekly/route.ts`.
- `lib/analysis/enrichment.ts:81-88` — `weekly: { hypothesisTracking: false, portfolioAnalysis: false }`.
- `sop-prompts.ts:1862` vraagt "[Indien change history]: Mogelijk gerelateerd aan [wijziging] op
  [datum]" — maar `changeHistory` zit alleen in Google's contextblok (zie P0-2).
- Ter vergelijking: `monthly/route.ts:1187,1400,1680` roept `getClientMemory` voor alle drie de
  kanalen aan.

Inferred: 52 runs per jaar per kanaal die elke keer blanco beginnen. Een bleeder die vorige week ook
al gevlagd werd, komt terug als nieuw.

Kans: één extra query op de vorige weekly-conclusie plus de open acties, en een regel in de preambule
dat herhaling expliciet benoemd moet worden.

### P1-6 — De bi-weekly leest de verkeerde bron en injecteert die vier keer ongefilterd

Deterministic:
- `biweekly/route.ts:106,427,695` — `.eq("section", "full")`: het narratieve markdown-document.
- `:220,240,258,279` — `previousMonthlyOutput` gaat ongetruncateerd in de **systemPrompt** van alle
  vier de stappen.
- `:106,427,695` selecteren `analysis_date` mee, maar `:142,446,714` lezen alleen `.output` — er is
  geen enkele controle op de ouderdom van de referentie.
- `p7_hypotheses_insights_push_pass.md` zette de insights-leespad juist hard op
  `structured_monthly_v2`.

Inferred: `sop_audit.md` noemt de monthly-PDF 21 pagina's. Vier keer dat document per kanaal per run
staat haaks op de kostenzorg in `AGENTS.md`.

Kans: lees `structured_monthly_v2` en geef alleen `hypotheses`, `final_sop.primary_thread` en de open
`recommendations` mee. Zet de datum in de kop, met een verouderingsmelding boven een drempel.

### P1-7 — De bi-weekly rekent naïef vooruit en vergelijkt met de verkeerde maand

Deterministic:
- `sop-prompts.ts:1486` — "Prognose maandeinde = (huidige waarde / verstreken dagen) × totaal dagen in
  maand"; `:1492` waarschuwt in dezelfde preambule voor het maandeinde-effect zonder correctie.
- `lib/forecast.ts:719,752-761` — `monthlyExpected` is seizoensgewogen en expliciet gecorrigeerd zodat
  een groeicurve niet als seizoen leest.
- `biweekly/route.ts:162,192` — `computeComparisonFacts` krijgt `lastCompleteMonth: lastMonth`, de
  vorige *afgesloten* maand, terwijl de bi-weekly over de *lopende* maand gaat.
  `lib/analysis/comparison-facts.ts:1-11`: "so the LLM does NOT need to compute arithmetic".

Kans: lever de prognose deterministisch aan uit de forecast-engine, en voeg een
month-to-date-vergelijkingsblok toe (deze maand tot dag N tegen vorige maand tot dag N).

### P1-8 — Vier cron-routes, nul actief

Deterministic:
- `vercel.json` bevat alleen `/api/sync/cron`.
- `app/api/cron/trigger-sops/route.ts:1` — "Klaargezet, bewust NIET actief (17 augustus, op verzoek
  van de eigenaar…)".
- `app/api/cron/evaluate-hypotheses/route.ts:30` — "NIET IN vercel.json (17 augustus 2026…)" plus
  "LIVE-ONGETEST".
- `app/api/analysis/period-evaluation/route.ts:7` — "zolang de hypothese-evaluator niet gewired is,
  levert deze route geen outcomes mee".

Inferred: gedocumenteerde eigenaarskeuze, geen vergissing. Maar het gevolg is dat de hele cadanslogica
ongebruikt is en de leercyclus wel gebouwd maar nooit gedraaid. Dat is de reden dat leercyclus en
agency memory op 4 staan: de architectuur verdient een 7, de werkelijkheid een 2.

Kans: `evaluate-hypotheses` doet geen analyse — het legt bestaande weekcijfers naast eerder aangenomen
hypotheses. Zet die als eerste aan, wekelijks, met `dry_run` als eerste stap. Sluit de leercyclus tegen
verwaarloosbare kosten zonder aan de SOP-triggering te raken.

### P2-9 — Drie nummeringsstelsels en een verwijzing naar een structuur die niet meer bestaat

Deterministic:
- `biweekly-channel-content.ts:4-9` onderbouwt stap 3 en 4 met "Meta stap 3 en stap 9 van elf" en
  "LinkedIn stap 4 en stap 8 van negen".
- `lib/meta/step-message.ts:7` en `lib/linkedin/step-message.ts:6` — beide zijn `F5 fase3` naar zes
  pijlers geconsolideerd.
- `adapters/google-ads.ts:14-20` — `stepCount: 13` met `expectedStepNumbers: [1, 6, 7, 8, 9, 10, 12, 13]`,
  tegenover Meta en LinkedIn die aaneengesloten 1..6 tellen.

Inferred: de inhoud mapt nog wel (Meta's ad set-analyse zit in pijler 2 niveau B, frequency in pijler 5
niveau B), maar de onderbouwing is niet meer na te lopen en "stap N" is over kanalen heen dubbelzinnig.

### P2-10 — Elke prompt zegt "SEA", en de hypothese-instructie is puur Google

Deterministic:
- `sop-prompts.ts:281,1226,1463,1686` — "Je bent een senior SEA specialist / strateeg", ongeacht kanaal.
- `sop-prompts.ts:196-276` — `HYPOTHESE_INSTRUCTIES` bepaalt de bureau/klant-verdeling en somt Merchant
  Center, Tag Manager, PMax, tROAS, Shopping Labelizer en DSA op.
- `sop-prompts.ts:1663` — gaat ongefilterd mee in bi-weekly stap 4, voor alle drie de kanalen.

Kans: maak de rolregel en de voorbeeldenlijst kanaalafhankelijk, langs dezelfde lijn die
`weekly-channel-content.ts` al hanteert. Het hypotheseformaat en de ICE-scoring zijn wél kanaalneutraal.

### P2-11 — Twee kleinere scheefheden

Deterministic:
- `weekly/route.ts:759` en `biweekly/route.ts:915` — `channel = body.channel || "google_ads"`, daarna
  alleen gelijkheidstests op `"meta_ads"` en `"linkedin_ads"`. Een onbekend kanaal draait stilzwijgend
  de volledige Google-analyse op Google-tabellen. `monthly/route.ts:1578` doet het beter via
  `getAdapter()`.
- `monthly/route.ts:3035` — `validClusters: adapter.channel === "google_ads" ? undefined : adapter.issueClusters`.
  Google's negentien clusters staan wel in de prompt maar worden nergens tegen getoetst; die van Meta en
  LinkedIn wel.

Kans: valideer `channel` tegen `ALLE_SOP_CHANNELS` en geef een 400. Geef Google zijn eigen
`issueClusters` als validatieset mee — de lijst staat er al.

---

## 4. Wat aantoonbaar goed zit

Deterministic:

1. **De monthly is per kanaal echt kanaal-eigen.** Meta kent hook en hold rate, learning-status per
   adset, Advantage+ versus lookalike, Audience Network-lekkage en een FTIR-verzadigingsclassificatie
   (`adapters/meta-ads.ts:77-136`). LinkedIn kent ICP-fit per functie en senioriteit, form completion
   rate, document ads, en benoemt expliciet dat LinkedIn geen frequency per creative geeft zodat
   tijdsverval de proxy is (`adapters/linkedin-ads.ts:75-137`).
2. **De determinismelaag is serieus.** `lib/analysis/llm-router.ts:94,157` — temperatuur 0 als default.
   `lib/analysis/openrouter-client.ts:216-217` — echt strict JSON Schema via `response_format`.
   `lib/eval/replay-core.ts:1-6` — replay met string-gelijke prompts en een expliciet model, bewust
   langs de keten-fallback heen omdat die de vergelijking zou corrumperen.
3. **Beperkingen staan in de code, niet in een la.** De hypothese-evaluator schrijft zelf op dat hij
   alleen op accountniveau kan meten en waarom. De dekkingsgetallen staan als "indicatief, niet
   definitief" met datum. Een niet-uitgevoerde hypothese levert `niet_uitgevoerd` op in plaats van een
   verworpen verdict. Die eerlijkheid is precies waarom de bevindingen hierboven zo scherp te maken zijn.

---

## 5. Wat niet is vastgesteld

- **Feitelijke outputkwaliteit.** Codeanalyse: geen SOP gedraaid, geen opgeslagen runs gelezen. Alle
  uitspraken gaan over wat de code vraagt en aanlevert.
- **Meta is op code beoordeeld, niet op output** — zie de aanpalende noot bij P0-1.
- **De feitelijke tokenomvang van de bi-weekly-injectie.** Dat `section = "full"` vier keer ongefilterd
  meegaat is hard; de 21 PDF-pagina's komen uit `sop_audit.md`, niet uit een eigen meting.
- **De overige P0's uit `sop_audit.md`.** De gating-P0 is nagelopen en deels open. Threadselectie-
  stabiliteit en diagnose-naar-actie-continuïteit zijn niet opnieuw getoetst; daar is een run voor nodig.
- **Of de weekly/bi-weekly-drempels empirisch kloppen.** Dat 20% WoW en 30% spend kanaalneutraal zijn
  terwijl LinkedIn-volumes structureel lager liggen, is een redenering — of het valse alarmen geeft
  volgt alleen uit echte runs.

---

## 6. Voorgestelde volgorde

Inferred:

1. LinkedIn-sync tot gisteren laten lopen (P0-1) — één regel, en zonder dit is de LinkedIn-weekly dood.
2. Verrijkingslaag naar Meta en LinkedIn (P0-2) — grootste effect per regel code.
3. De drie data-koppelingen dichten (P0-3).
4. PDF-poort op alle drie de monthly-sleutels, plus step-validations voor Meta/LinkedIn (P0-4).
5. `evaluate-hypotheses` wekelijks aanzetten (P1-8) — sluit de leercyclus.
6. Bi-weekly op `structured_monthly_v2` en een deterministische prognose (P1-6, P1-7).
7. Weekly-geheugen (P1-5).
8. De rest.
