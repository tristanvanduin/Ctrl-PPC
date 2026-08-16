// De ENIGE plek die de echte GA4 Data API aanraakt (naast data-access.ts, die dit orchestreert).
// Docs: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
//
// ── TWEE APARTE RAPPORTEN, NIET ÉÉN ─────────────────────────────────────────────────────────
//
// sessions/engagedSessions zijn sessiegebonden metrics; eventCount is gebeurtenisgebonden. Zet je
// eventName als dimensie bij een sessiegebonden metric, dan telt GA4 "sessies waarin deze
// gebeurtenis voorkwam" — sommeer je dat over meerdere keyEvents-namen in dezelfde sessie, dan tel
// je die sessie meerdere keren mee. Vandaar twee losse aanroepen die na het ophalen samengevoegd
// worden op (datum, kanaalbron, device, landingpagina): report A voor sessies/engagement, report B
// voor gebeurtenistellingen (veilig te sommeren, event-scoped).
//
// ── SAMPLING ─────────────────────────────────────────────────────────────────────────────────
//
// Bij grote propertyvolumes kan GA4 zelf gaan samplen; metadata.samplingMetadatas is dan gezet.
// Een gesamplede claim die zich voordoet als exact breekt de vertrouwensdoctrine — daarom geeft
// deze module dat expliciet door als `sampled`, en data-access.ts labelt de dataset als "partial".

const GA4_BASE = "https://analyticsdata.googleapis.com/v1beta";

export interface Ga4ReportRow {
  dimensionValues: string[];
  metricValues: number[];
}

export interface Ga4ReportResult {
  rows: Ga4ReportRow[];
  sampled: boolean;
}

interface RunReportBody {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions: { name: string }[];
  metrics: { name: string }[];
  limit?: string;
}

async function runReport(propertyId: string, accessToken: string, body: RunReportBody): Promise<Ga4ReportResult> {
  const property = propertyId.startsWith("properties/") ? propertyId : `properties/${propertyId}`;
  const response = await fetch(`${GA4_BASE}/${property}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GA4 Data API-fout (${response.status}): ${error}`);
  }

  const data = await response.json();
  const rows: Ga4ReportRow[] = (data.rows ?? []).map((r: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }) => ({
    dimensionValues: (r.dimensionValues ?? []).map((d) => d.value),
    metricValues: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
  }));
  const sampled = Array.isArray(data.metadata?.samplingMetadatas) && data.metadata.samplingMetadatas.length > 0;
  return { rows, sampled };
}

function isoDate(ga4Date: string): string {
  // GA4 geeft datums terug als "YYYYMMDD".
  if (/^\d{8}$/.test(ga4Date)) return `${ga4Date.slice(0, 4)}-${ga4Date.slice(4, 6)}-${ga4Date.slice(6, 8)}`;
  return ga4Date;
}

/** Sessies/engagement per (datum, bron, medium, device, landingpagina) — geen eventName-dimensie. */
export async function fetchGa4SessionReport(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Ga4ReportResult> {
  const result = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" },
      { name: "deviceCategory" }, { name: "landingPagePlusQueryString" },
    ],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
    limit: "100000",
  });
  return { rows: result.rows.map((r) => ({ ...r, dimensionValues: [isoDate(r.dimensionValues[0]), ...r.dimensionValues.slice(1)] })), sampled: result.sampled };
}

/** Gebeurtenistellingen per (datum, bron, medium, device, landingpagina, eventName) — wél veilig te sommeren. */
export async function fetchGa4EventReport(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Ga4ReportResult> {
  const result = await runReport(propertyId, accessToken, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" },
      { name: "deviceCategory" }, { name: "landingPagePlusQueryString" }, { name: "eventName" },
    ],
    metrics: [{ name: "eventCount" }],
    limit: "100000",
  });
  return { rows: result.rows.map((r) => ({ ...r, dimensionValues: [isoDate(r.dimensionValues[0]), ...r.dimensionValues.slice(1)] })), sampled: result.sampled };
}
