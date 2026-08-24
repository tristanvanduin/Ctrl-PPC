// Kanaal-specifieke inhoud voor buildBiWeeklyPrompt (fase C, vervolg op weekly, 12 aug 2026).
// Bi-weekly toetst continu terug op de maandanalyse, dus Stap 3 en Stap 4 moeten verwijzen naar een
// laag die de bijbehorende monthly-adapter ook daadwerkelijk kent.
//
// BIJGEWERKT: deze kop verwees naar een stappenstructuur die niet meer bestaat -- "lib/meta/
// step-message.ts (11 stappen, stap 3 en stap 9)" en "lib/linkedin/step-message.ts (9 stappen,
// stap 4 en stap 8)". Beide adapters zijn sinds F5 fase3 geconsolideerd naar ZES pijlers. De
// verwijzing klopte dus niet meer, en dat is het soort commentaar dat een lezer op het verkeerde
// been zet omdat het gezaghebbend oogt.
//
// De INHOUD hieronder mapt nog wel, en zo hoort het gelezen te worden:
//   Meta stap 3 "Ad Set & Doelgroep"      -> pijler 2 "Structuur & Budget", NIVEAU B
//   Meta stap 4 "Frequency & Verzadiging" -> pijler 5 "Funnel, Verzadiging & Schedule", NIVEAU B
//   LinkedIn stap 3 "Creative Performance"-> pijler 3 "Creative Performance"
//   LinkedIn stap 4 "Bidding & Pacing"    -> pijler 2 "Structuur, Budget & Bidding", NIVEAU C
//
// De bi-weekly houdt bewust zijn eigen nummering 1 t/m 4: hij is een check-in met vier stappen, geen
// verkorte maandanalyse. Wat moet kloppen is dat elk onderwerp bestaat in de maandanalyse waarnaar
// wordt teruggekoppeld -- niet dat de nummers gelijklopen.
//
// Google's "Ad Group"/"Device & Engagement" bestaan in geen van beide structuren: Meta heeft geen ad
// groups (ad sets zijn het niveau eronder) en LinkedIn heeft die laag uberhaupt niet; device-only
// performance is voor geen van beide een onderwerp dat de maandanalyse apart bijhoudt.
//
// Stap 1 en Stap 2 blijven inhoudelijk hetzelfde format (Account/Campagne Performance, "ontwikkelt
// dit zich zoals verwacht") -- alleen de "Gebruik:"-databronregel verandert per kanaal.

export interface BiWeeklyChannelContent {
  step1Dataset: string;
  step2Dataset: string;
  step3Title: string;
  step3Dataset: string;
  step3Body: string;
  step4Title: string;
  step4Dataset: string;
  step4Body: string;
}

export const META_BIWEEKLY: BiWeeklyChannelContent = {
  step1Dataset: "meta_account_daily (deze maand + vorige 2 maanden, per maand samengevat), meta_account_daily (laatste 30 dagen)",
  step2Dataset: "meta_campaign_daily (deze maand + vorige 2 maanden, per maand samengevat), conclusie stap 1",
  step3Title: "Ad Set & Doelgroep Performance",
  step3Dataset: "meta_adset_daily (deze maand + vorige 2 maanden), conclusies stap 1 + 2",
  step3Body: `### Werkwijze
1. Ontwikkelen de ad sets uit de maandanalyse zich zoals verwacht?
2. Effect van optimalisaties zichtbaar (bijv. doelgroep verbreed, budget herverdeeld, learning phase afgerond)?

### Output format
"Ad set X (geïdentificeerd in maandanalyse) ontwikkelt zich [conform verwachting / afwijkend]:
[beschrijving met concrete cijfers en vergelijking met maandanalyse verwachting]."`,
  step4Title: "Frequency & Verzadiging",
  step4Dataset: "meta_account_daily en meta_adset_daily (frequency-kolom), conclusies stap 1 t/m 3",
  step4Body: `### Werkwijze
1. Stijgt frequency richting of over de benchmark-drempel (zie Meta-benchmarks hierboven) sinds de maandanalyse?
2. Verklaart verzadiging een dalende CTR/hook rate of stijgende CPA uit stap 1-3?

### Output format
"Frequency in [ad set/account] is [gestegen/gestabiliseerd] naar [waarde] sinds de maandanalyse
([+/-X] t.o.v. toen) — dit [verklaart/verklaart niet] de ontwikkeling uit stap 1-3."`,
};

export const LINKEDIN_BIWEEKLY: BiWeeklyChannelContent = {
  step1Dataset: "linkedin_account_daily (deze maand + vorige 2 maanden, per maand samengevat), linkedin_account_daily (laatste 30 dagen)",
  step2Dataset: "linkedin_campaign_daily (deze maand + vorige 2 maanden, per maand samengevat), conclusie stap 1",
  step3Title: "Creative Performance",
  step3Dataset: "linkedin_creative_daily (deze maand + vorige 2 maanden), conclusies stap 1 + 2",
  step3Body: `### Werkwijze
1. Ontwikkelen de creatives uit de maandanalyse zich zoals verwacht?
2. Effect van optimalisaties zichtbaar (bijv. nieuwe creative live, format gewisseld)?

### Output format
"Creative X (geïdentificeerd in maandanalyse) ontwikkelt zich [conform verwachting / afwijkend]:
[beschrijving met concrete cijfers en vergelijking met maandanalyse verwachting]."`,
  step4Title: "Bidding & Pacing",
  step4Dataset: "linkedin_campaign_daily (spend-pacing t.o.v. budget), conclusies stap 1 t/m 3",
  step4Body: `### Werkwijze
1. Ligt de budget-pacing op schema, of loopt een campagne vroeg leeg dan wel blijft onderbesteed?
2. Wijst een CPL-stijging op een te laag bod in de B2B-auctie sinds de maandanalyse?

### Output format
"[Campagne X] pacing is [op schema / te snel / te langzaam] — [beschrijving]. CPL-ontwikkeling
[wijst wel/niet] op een biedprobleem sinds de maandanalyse."`,
};
