// De ENIGE plek die de echte Search Console API aanraakt. Docs:
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
//
// dataState altijd "final": GSC se laatste 2-3 dagen zijn nog niet definitief (2-3 dagen
// vertraging is normaal, geen bug — MASTERPLAN sectie 5.6.2). Een "all"-aanvraag zou voorlopige
// cijfers meenemen die later nog veranderen, en dat past niet bij deterministische detectoren.

const GSC_BASE = "https://www.googleapis.com/webmasters/v3";
const ROW_LIMIT = 25000; // GSC se maximum per aanroep

export interface GscApiRow {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryResult {
  rows: GscApiRow[];
  /** true als het aantal rijen precies op de limiet uitkwam — er kunnen meer rijen bestaan dan opgehaald. */
  mogelijkAfgekapt: boolean;
}

export async function runSearchAnalyticsQuery(
  siteUrl: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<GscQueryResult> {
  const encodedSite = encodeURIComponent(siteUrl);
  const response = await fetch(`${GSC_BASE}/sites/${encodedSite}/searchAnalytics/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ["date", "query", "page"],
      dataState: "final",
      rowLimit: ROW_LIMIT,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Search Console API-fout (${response.status}): ${error}`);
  }

  const data = await response.json();
  const rawRows: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[] = data.rows ?? [];
  const rows: GscApiRow[] = rawRows
    .filter((r) => Array.isArray(r.keys) && r.keys.length === 3)
    .map((r) => ({
      date: r.keys![0],
      query: r.keys![1],
      page: r.keys![2],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));

  return { rows, mogelijkAfgekapt: rows.length >= ROW_LIMIT };
}
