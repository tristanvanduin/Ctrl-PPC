# Architectuur: AI-modelroutering en kostenbeheersing

Vastgelegd 15 augustus 2026, masterplan Fase 3 ("llm-router omzetten naar OpenRouter met meerdere
modellen"). Dit document beschrijft wat er staat, niet wat ooit de bedoeling was: elk model-ID en
elke prijs hieronder is geverifieerd tegen de live OpenRouter-catalogus (`GET
https://openrouter.ai/api/v1/models`) op de datum hierboven, niet aangenomen uit een prompt of uit
trainingsdata. Dat onderscheid is expliciet omdat er die dag ook een extern (Copilot-)voorstel voor
deze indeling langskwam met modelnamen die te nieuw waren om uit eigen kennis te herkennen --
gecontroleerd in plaats van vertrouwd of afgewezen.

## 1. Kernprincipes

- **OpenRouter is de gateway voor elke nieuwe LLM-aanroep.** `LLM_BASE_URL` staat op
  `https://openrouter.ai/api/v1`. Eén factuur, één plek voor model-fallback, geen verspreide
  provider-sleutels.
- **De LLM rekent niet.** Deterministische wiskunde, budgetbewaking, schemavalidatie en
  databasecontroles blijven SQL en TypeScript. Dit is geen nieuwe regel -- staat al in
  `EXECUTION_PLAN.md` sectie 1.6 ("De LLM rekent niet. Alle wiskunde deterministisch in
  TypeScript") en wordt hier bevestigd, niet opnieuw uitgevonden.
- **Lokale anonimisering vóór dispatch: nog niet gebouwd, wel een echte volgende stap.**
  `lib/security/sanitize-llm-payload.ts` maskeert vandaag secrets en e-mailadressen bij elke call
  (het ene chokepoint, `openrouter-client.ts`). Volledige PII-anonimisering van klant- en
  campagnenamen is een grotere wijziging: de bestaande prompts (`lib/prompts/`) verwijzen
  doorlopend naar echte klant- en campagnenamen, dus dit raakt de opbouw van vrijwel elke prompt,
  niet alleen het verzendpunt. Bewust niet in deze stap meegenomen -- zie sectie 5.

## 2. Twee routeringssystemen, naast elkaar

`lib/analysis/llm-router.ts` kent twee onafhankelijke manieren om een model te kiezen. Ze bestaan
naast elkaar met opzet: het bestaande systeem heeft vijftien productie-aanroepers die vandaag prima
werken, en een stilzwijgende overstap van al die routes naar andere modellen (met andere kosten,
latency en gedrag) hoort niet in dezelfde wijziging als "het endpoint klopt weer".

### 2.1 Het bestaande Tier-systeem (`callRouted`, ongewijzigd gedrag)

Routeert op **stapnummer** binnen een analyse (`resolveTier`/`STEP_TIER`). Drie tiers, elk met een
modelketen (primair + fallback):

| Tier | Rol | Model |
|---|---|---|
| `heavy` / `medium` | standaard, het overgrote deel van de aanroepen | Gemini 3.7 Flash → Gemini 2.5 Flash |
| `light` | kostenbesparing op specifieke stappen, pas na verificatie | Gemini 2.5 Flash-Lite → Gemini 3.7 Flash |

Alleen het **endpoint** is gewijzigd (echt OpenRouter i.p.v. de directe Gemini-API) en de
**model-ID's** zijn bijgewerkt naar hun OpenRouter-equivalent, inclusief een upgrade van 3.6 naar
3.7 Flash (nieuwer én goedkoper: $0,38/$1,88 per 1M tokens tegen $0,75/$3,75 voor 3.6). Welke tier
een aanroeper krijgt, blijft ongewijzigd.

### 2.2 Het nieuwe Layer-systeem (`callLayer`, voor nieuwe code)

Routeert op **taaksoort**, niet op stapnummer. Voor Fase 3's actiequeue en verder:

| Laag | Taak | Model | Prijs (in/uit per 1M tokens) |
|---|---|---|---|
| 1 | Data & validatie | geen LLM -- SQL + TypeScript, kosten €0,00 | -- |
| 2 | Triage & categorisatie | Gemini 3.7 Flash | $0,38 / $1,88 |
| 3 | Redeneren & hypothesevorming | Grok 4.6 | $2,00 / $6,00 |
| 4 | Narratief & claim-discipline (klantgerichte tekst) | Claude Sonnet 5 | $2,00 / $10,00 |
| 5 | Strategische raad (extreme inzet, bv. God View) | Claude Opus 5 → GPT-5.6 Sol | $5,00/$25,00 → $5,00/$30,00 |

**Laag 3 (Grok 4.6) is de enige keuze die nog niet gemeten is.** De andere modellen sluiten aan bij
al bestaand gedrag (Gemini-familie: zelfde als de bestaande tiers) of bij een principe dat elders in
dit project al leidend is (Claude Sonnet 5 voor claim-discipline, dezelfde precisie-eis als de
vertrouwensdoctrine in sectie 3.2 van `docs/MASTERPLAN.md`). Grok 4.6 voor redenering is een
redelijke eerste keuze, geen bewezen beste keuze -- volg de output de eerste weken, niet alleen de
poorten.

**Laag 5 heeft vandaag geen consument.** God View kan structureel niets tonen (zie
`docs/MASTERPLAN.md` sectie 12: te weinig bureaus). De laag staat klaar voor als dat verandert.

## 3. Kostenregistratie

Bestaat al, hergebruikt hier: `lib/analysis/o2-targets-cost.ts` (`MODEL_PRICES`, `computeCallCost`)
rekent elke call om naar euro's op basis van het exacte model-ID dat de call teruggeeft. Onbekend
model: `null`, nooit een schatting. `MODEL_PRICES` is bijgewerkt met alle modellen uit sectie 2,
prijzen rechtstreeks uit de OpenRouter-catalogus (niet van een providerpagina overgetypt).

`recordUsage`/`recordCredit` (dezelfde module, en `lib/analysis/credit-costs.ts`) schrijven dit weg
per run. `uitgavenplafond.ts` (het EUR-maandplafond) en `credit-costs.ts` (het creditsysteem voor
handmatige deep-dives) zijn twee aparte mechanismen met een eigen reden voor bestaan -- zie de kop
van elk bestand. Geen van beide is in deze stap gewijzigd; ze rekenen nu alleen met de bijgewerkte,
correcte prijzen.

## 4. Wat hier bewust niet is gebeurd

- **Geen handhaving over alle routes in `app/api/`.** Deze stap levert de routeringslaag zelf. De
  vijftien bestaande aanroepers van `callRouted` zijn ongewijzigd gelaten (zelfde tiers, alleen het
  endpoint is nu echt OpenRouter). Welke routes op `callLayer` overgaan is een keuze per route, niet
  een verplichte migratie in deze stap.
- **Geen volledige PII-anonimisering.** Zie sectie 1.
- **Geen creditprijzen ingevuld.** `CREDIT_COSTS` in `credit-costs.ts` staat bewust leeg -- dat is
  een prijsbeslissing voor de eigenaar, geen technisch detail van deze stap (zie de kop van dat
  bestand voor de volledige toelichting).
