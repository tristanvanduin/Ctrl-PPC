export interface StepDataAvailability {
  step: number;
  dimensions: {
    name: string;
    available: boolean;
    rowCount: number;
    note?: string;
  }[];
  promptNote: string;
}

interface AvailabilityInput {
  audienceData: unknown[];
  deviceData: unknown[];
  checkoutData: unknown[];
  creativeData: unknown[];
  keywordData: unknown[];
  productData: unknown[];
  countryData: unknown[];
  networkData: unknown[];
  scheduleData: unknown[];
  /** Live testrun 17 augustus 2026 (masterplan 17.14): stap 7 kende alleen "Keyword data"
   *  (ads_keyword_performance_monthly) en "Product data", niet deze derde, aparte bron
   *  (ads_search_terms_wasteful). Bij een klant met wél zoektermdata maar geen keyword-/
   *  productdata gaf dat `allUnavailable: true` voor de hele stap -- en dus werd een
   *  zoekterm-bevinding die WEL op echte, beschikbare data rustte alsnog als inconsistent
   *  afgekeurd, puur omdat de validator deze bron niet kende. */
  searchTermData: unknown[];
}

function dimension(name: string, rows: unknown[], note?: string) {
  return {
    name,
    available: rows.length > 0,
    rowCount: rows.length,
    note,
  };
}

function renderPromptNote(step: number, dimensions: StepDataAvailability["dimensions"]): string {
  const missing = dimensions.filter((item) => !item.available);
  if (missing.length === 0) {
    return `Alle verwachte data voor stap ${step} is beschikbaar.`;
  }
  return `Let op: ${missing.map((item) => `${item.name} niet beschikbaar`).join(", ")}. Sla ontbrekende werkwijzen compact over zonder te hallucineren.`;
}

export function checkStepDataAvailability(opts: AvailabilityInput): StepDataAvailability[] {
  const byStep: Array<{ step: number; dimensions: StepDataAvailability["dimensions"] }> = [
    { step: 1, dimensions: [] },
    { step: 2, dimensions: [] },
    { step: 3, dimensions: [] },
    { step: 4, dimensions: [] },
    { step: 5, dimensions: [dimension("Keyword data", opts.keywordData)] },
    { step: 6, dimensions: [dimension("Product data", opts.productData)] },
    { step: 7, dimensions: [dimension("Keyword data", opts.keywordData), dimension("Product data", opts.productData), dimension("Search term waste data", opts.searchTermData)] },
    { step: 8, dimensions: [dimension("Creative data", opts.creativeData)] },
    // Live testrun 18 augustus 2026: stap 9 heet "Doelgroep- & Geosegmenten" sinds de fase4-
    // samenvoeging van oud-stap-9 (Audience) en oud-stap-11 (Geo) in één call
    // (lib/prompts/monthly-v2.ts, "F4 fase4"), maar deze lijst kende alleen de audience-bron. Bij
    // elke van de 4 echte klanten in die test ontbrak audience-data (heel gewoon) maar was
    // geo-data er wel -- `allUnavailable` viel dan alsnog op true uit voor de HELE stap, en de
    // validator keurde daardoor de wel-echte, wel-deterministische geo-findings (GB/NL/DE/BE) af
    // als "data niet beschikbaar terwijl evidence deterministic is". 100% reproductie, blokkeerde
    // elke maandanalyse. Zelfde bugklasse als de stap-7-fix van 17 augustus (masterplan 17.14).
    { step: 9, dimensions: [dimension("Audience data", opts.audienceData), dimension("Geo data", opts.countryData)] },
    {
      step: 10,
      dimensions: [
        dimension("Device data", opts.deviceData),
        dimension("Engagement KPI data", opts.deviceData.filter((row) => {
          const record = row as Record<string, unknown>;
          return record.bounce_rate != null || record.engagement_rate != null || record.avg_session_duration != null;
        })),
      ],
    },
    { step: 11, dimensions: [dimension("Geo data", opts.countryData)] },
    {
      step: 12,
      dimensions: [
        dimension("Checkout data", opts.checkoutData),
        dimension("Schedule data", opts.scheduleData),
        dimension("Network data", opts.networkData),
      ],
    },
    { step: 13, dimensions: [] },
  ];

  return byStep.map((entry) => ({
    step: entry.step,
    dimensions: entry.dimensions,
    promptNote: renderPromptNote(entry.step, entry.dimensions),
  }));
}
