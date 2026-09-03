// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP EEN DEVELOPER TOKEN. De HTTP-vormen volgen de
// Microsoft Advertising API v13 REST-documentatie (Reporting en Campaign Management);
// pas tegen een echt account met een echt developer token te verifieren. De pure delen
// (zip-uitpak, CSV-parse, getalnormalisatie) zijn unit-getest in transform.ts.
//
// WAAROM REST EN GEEN SOAP: v13 bedient beide; de REST-endpoints praten JSON en passen
// daarmee op fetch zonder XML-envelop-machinerie. De SOAP-weg zou een tweede
// serialisatielaag in de codebase zetten voor exact dezelfde payloads.
// =====================================================================

import { inflateRawSync } from "node:zlib";

// De OAuth-scope voor Microsoft Advertising; offline_access levert het refresh token.
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = "https://ads.microsoft.com/msads.manage offline_access";

const REPORTING_BASE = "https://reporting.api.bingads.microsoft.com/Reporting/v13";
const CAMPAIGN_BASE = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";

export interface MicrosoftApiConfig {
  accessToken: string;
  developerToken: string;
  /** Het customer-id (de beheerlaag); vereist door beide services. */
  customerId: string;
  /** Het account-id waarvoor gesynct wordt. */
  accountId: string;
}

export interface MicrosoftTokenResult {
  accessToken: string;
  expiresIn: number;
  /** Microsoft ROTEERT refresh tokens: dit veld terugschrijven is verplicht (zie kanaal-credentials). */
  refreshToken: string | null;
}

/**
 * Wisselt een refresh token in voor een access token. Null bij een geweigerde refresh --
 * de aanroeper hoort de koppeling dan als verlopen te markeren, niet stil door te gaan.
 */
export async function refreshMicrosoftToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<MicrosoftTokenResult | null> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!data.access_token) return null;
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
    refreshToken: data.refresh_token ?? null,
  };
}

function headers(cfg: MicrosoftApiConfig): Record<string, string> {
  return {
    "Authorization": `Bearer ${cfg.accessToken}`,
    "DeveloperToken": cfg.developerToken,
    "CustomerId": cfg.customerId,
    "CustomerAccountId": cfg.accountId,
    "Content-Type": "application/json",
  };
}

async function postJson<T>(url: string, cfg: MicrosoftApiConfig, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: headers(cfg), body: JSON.stringify(body) });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`Microsoft API ${res.status} op ${url.slice(url.lastIndexOf("/") + 1)}: ${tekst.slice(0, 300)}`);
  try {
    return JSON.parse(tekst) as T;
  } catch {
    throw new Error(`Microsoft API gaf geen JSON op ${url}: ${tekst.slice(0, 200)}`);
  }
}

// ── Reporting ───────────────────────────────────────────────────────────────

interface DatumDeel { Day: number; Month: number; Year: number }

function naarDatumDeel(iso: string): DatumDeel {
  const [jaar, maand, dag] = iso.split("-").map(Number);
  return { Day: dag, Month: maand, Year: jaar };
}

/**
 * Bouwt de gedeelde romp van een report-request: CSV, zonder rapportkop/-voet zodat de
 * eerste regel de kolomkoppen is, en zonder ReturnOnlyCompleteData -- de daily herschrijft
 * de laatste dagen toch elke run opnieuw (zelfde attributie-argument als bij Meta/LinkedIn).
 */
export function bouwReportRequest(opts: {
  type: string; // bv. "CampaignPerformanceReportRequest"
  aggregation: "Daily" | "Monthly";
  columns: string[];
  accountId: string;
  since: string;
  until: string;
}): Record<string, unknown> {
  return {
    Type: opts.type,
    ExcludeReportHeader: true,
    ExcludeReportFooter: true,
    ExcludeColumnHeaders: false,
    Format: "Csv",
    FormatVersion: "2.0",
    ReturnOnlyCompleteData: false,
    Aggregation: opts.aggregation,
    Columns: opts.columns,
    Scope: { AccountIds: [Number(opts.accountId)] },
    Time: {
      CustomDateRangeStart: naarDatumDeel(opts.since),
      CustomDateRangeEnd: naarDatumDeel(opts.until),
      // Rapporteer in de tijdzone van het account is niet per request instelbaar; UTC houdt
      // de vensters consistent met de rest van de syncs.
      ReportTimeZone: "GreenwichMeanTimeDublinEdinburghLisbonLondon",
    },
  };
}

/**
 * Dient een rapport in en pollt tot het klaar is. Levert de CSV-tekst, of gooit met een
 * duidelijke reden: een timeout is geen bevestigde leegte (zelfde principe als het async
 * insights-pad van Meta).
 */
export async function draaiReport(cfg: MicrosoftApiConfig, reportRequest: Record<string, unknown>, maxPogingen = 30): Promise<string> {
  const submit = await postJson<{ ReportRequestId?: string }>(`${REPORTING_BASE}/GenerateReport/Submit`, cfg, { ReportRequest: reportRequest });
  if (!submit.ReportRequestId) throw new Error(`geen ReportRequestId voor ${String(reportRequest.Type)}`);

  for (let poging = 0; poging < maxPogingen; poging++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await postJson<{ ReportRequestStatus?: { Status?: string; ReportDownloadUrl?: string | null } }>(
      `${REPORTING_BASE}/GenerateReport/Poll`, cfg, { ReportRequestId: submit.ReportRequestId }
    );
    const status = poll.ReportRequestStatus?.Status;
    if (status === "Success") {
      const url = poll.ReportRequestStatus?.ReportDownloadUrl;
      // Success zonder download-url betekent: geen data in het venster. Een lege CSV is dan
      // de eerlijke weergave -- nul rijen door leegte, niet door een fout.
      if (!url) return "";
      const zipRes = await fetch(url);
      if (!zipRes.ok) throw new Error(`rapportdownload faalde met ${zipRes.status}`);
      return unzipEersteBestand(Buffer.from(await zipRes.arrayBuffer()));
    }
    if (status === "Error") throw new Error(`rapport ${String(reportRequest.Type)} faalde aan Microsoft-zijde`);
  }
  throw new Error(`polling voor ${String(reportRequest.Type)} timed out na ${maxPogingen} pogingen`);
}

/**
 * Pakt het eerste (en bij rapporten: enige) bestand uit een zip.
 *
 * Bewust met de hand en niet met een zip-dependency: het rapport-zipje bevat één CSV, en de
 * centrale directory plus inflateRaw dekken dat volledig. De End-of-Central-Directory wordt
 * van achteren gezocht (het commentaarveld kan hem van het vaste einde wegduwen).
 */
export function unzipEersteBestand(buf: Buffer): string {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: geen End of Central Directory gevonden");
  const centraalOffset = buf.readUInt32LE(eocd + 16);

  if (buf.readUInt32LE(centraalOffset) !== 0x02014b50) throw new Error("zip: centrale directory niet op verwachte plek");
  const methode = buf.readUInt16LE(centraalOffset + 10);
  const compressedSize = buf.readUInt32LE(centraalOffset + 20);
  const lokaalOffset = buf.readUInt32LE(centraalOffset + 42);

  if (buf.readUInt32LE(lokaalOffset) !== 0x04034b50) throw new Error("zip: lokaal header-signature klopt niet");
  // De lokale header kan andere naam/extra-lengtes dragen dan de centrale; lees ze lokaal.
  const naamLen = buf.readUInt16LE(lokaalOffset + 26);
  const extraLen = buf.readUInt16LE(lokaalOffset + 28);
  const dataStart = lokaalOffset + 30 + naamLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + compressedSize);

  const inhoud = methode === 0 ? data : methode === 8 ? inflateRawSync(data) : null;
  if (inhoud === null) throw new Error(`zip: compressiemethode ${methode} niet ondersteund`);
  // Rapporten beginnen soms met een UTF-8 BOM; die hoort niet in de eerste kolomkop terecht
  // te komen (een kolomkop met onzichtbare BOM ervoor matcht nergens op).
  return inhoud.toString("utf8").replace(/^\uFEFF/, "");
}

// ── Campaign Management ─────────────────────────────────────────────────────

export interface MicrosoftCampagne {
  Id?: number;
  Name?: string;
  CampaignType?: string;
  Status?: string;
  DailyBudget?: number;
  BiddingScheme?: { Type?: string };
}

export interface MicrosoftAdGroup {
  Id?: number;
  Name?: string;
  Status?: string;
}

export async function fetchMicrosoftCampaigns(cfg: MicrosoftApiConfig): Promise<MicrosoftCampagne[]> {
  const data = await postJson<{ Campaigns?: MicrosoftCampagne[] | null }>(
    `${CAMPAIGN_BASE}/Campaigns/QueryByAccountId`, cfg,
    { AccountId: Number(cfg.accountId), CampaignType: "Search Shopping DynamicSearchAds Audience PerformanceMax" }
  );
  return data.Campaigns ?? [];
}

export async function fetchMicrosoftAdGroups(cfg: MicrosoftApiConfig, campaignId: number): Promise<MicrosoftAdGroup[]> {
  const data = await postJson<{ AdGroups?: MicrosoftAdGroup[] | null }>(
    `${CAMPAIGN_BASE}/AdGroups/QueryByCampaignId`, cfg, { CampaignId: campaignId }
  );
  return data.AdGroups ?? [];
}

// ── Customer Management: de accounts onder een customer (voor de koppelflow) ─
//
// LIVE-ONGETEST, zelfde grens als de rest van dit bestand. GetAccountsInfo levert de
// accountnummers waar microsoft_connections.account_id naar verwijst; het customer-id komt uit
// de kluis-payload van het bureau. Geen CustomerAccountId-header: die hoort bij een account, en
// dat is precies wat hier nog gekozen moet worden.

const CUSTOMER_BASE = "https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13";

export interface MicrosoftAccountInfo {
  Id?: number;
  Name?: string;
  Number?: string;
  AccountLifeCycleStatus?: string;
  PauseReason?: number | null;
}

export async function fetchMicrosoftAccounts(cfg: Omit<MicrosoftApiConfig, "accountId">): Promise<MicrosoftAccountInfo[]> {
  const url = `${CUSTOMER_BASE}/AccountsInfo/Query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.accessToken}`,
      "DeveloperToken": cfg.developerToken,
      "CustomerId": cfg.customerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ CustomerId: Number(cfg.customerId), OnlyParentAccounts: false }),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`Microsoft API ${res.status} op AccountsInfo/Query: ${tekst.slice(0, 300)}`);
  let data: { AccountsInfo?: MicrosoftAccountInfo[] | null };
  try {
    data = JSON.parse(tekst) as { AccountsInfo?: MicrosoftAccountInfo[] | null };
  } catch {
    throw new Error(`Microsoft API gaf geen JSON op AccountsInfo/Query: ${tekst.slice(0, 200)}`);
  }
  return data.AccountsInfo ?? [];
}
