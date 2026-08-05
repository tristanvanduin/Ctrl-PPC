import { NextRequest } from "next/server";
import {
  getAccountMetricsByMonth,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { googleAdsMonthlyToApiData } from "@/lib/api/adapter";
import { today } from "@/lib/reporting-date";
import { addMonths, isValidMonth, monthIndex, type Month } from "@/lib/period/period-range";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";

/** De laatste dag van een maand, als YYYY-MM-DD. Dag 0 van de volgende maand. */
function laatsteDag(m: Month): string {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
}

/** De periode uit de query, of het oude gedrag (dit jaar tot nu) als hij ontbreekt. */
function periodeUit(params: URLSearchParams): { start: Month; end: Month; cmpStart: Month; cmpEnd: Month } {
  const nu = today().slice(0, 7);
  const vorigeVolle = addMonths(nu, -1);
  const s = params.get("start"), e = params.get("end");
  const cs = params.get("compareStart"), ce = params.get("compareEnd");

  const start = isValidMonth(s) ? s : `${nu.slice(0, 4)}-01`;
  const end = isValidMonth(e) ? e : vorigeVolle;
  // Zonder expliciete vergelijking: dezelfde maanden een jaar terug. Dat is wat het scorebord
  // altijd al deed, nu alleen expliciet in plaats van ingebakken.
  const cmpStart = isValidMonth(cs) ? cs : addMonths(start, -12);
  const cmpEnd = isValidMonth(ce) ? ce : addMonths(end, -12);

  // Omgedraaide grenzen rechtzetten in plaats van een lege periode teruggeven.
  return monthIndex(start) <= monthIndex(end)
    ? { start, end, cmpStart, cmpEnd }
    : { start: end, end: start, cmpStart: cmpEnd, cmpEnd: cmpStart };
}


/**
 * Fetch overview KPIs for multiple Google Ads accounts in parallel.
 * Query: ?customerIds=123,456,789
 * Returns a lightweight summary per account for the overview table.
 */
export async function GET(request: NextRequest) {
  // De parameter eerst: een verzoek zonder customerIds is een fout van de aanroeper (400) en
  // niet van de server (500), ongeacht of de koppeling geconfigureerd is.
  const idsParam = request.nextUrl.searchParams.get("customerIds");
  if (!idsParam) {
    return Response.json({ error: "customerIds required" }, { status: 400 });
  }

  const credentials = credentialsUitOmgeving();
  if (!credentials) {
    return Response.json({ error: "Not configured" }, { status: 500 });
  }

  const customerIds = idsParam.split(",").filter(Boolean);
  const { start, end, cmpStart, cmpEnd } = periodeUit(request.nextUrl.searchParams);

  // Het bereik loopt tot de laatste dag van de eindmaand; anders snijdt een .lte op de eerste
  // van de maand de hele maand eraf.
  const results = await Promise.allSettled(
    customerIds.map(async (customerId) => {
      try {
        const [monthlyRaw, prevYearRaw] = await Promise.all([
          getAccountMetricsByMonth(credentials, customerId, `${start}-01`, laatsteDag(end)),
          getAccountMetricsByMonth(credentials, customerId, `${cmpStart}-01`, laatsteDag(cmpEnd)),
        ]);

        const monthly = googleAdsMonthlyToApiData(monthlyRaw);
        const prevYear = googleAdsMonthlyToApiData(prevYearRaw);

        // Alles binnen het gevraagde bereik telt mee; de lopende maand valt er al buiten omdat
        // de kiezer hem niet aanbiedt.
        const completeMonths = monthly;
        const ytdConv = completeMonths.reduce((s, m) => s + m.conversions, 0);
        const ytdRev = completeMonths.reduce((s, m) => s + m.revenue, 0);
        const ytdSpend = completeMonths.reduce((s, m) => s + m.adSpend, 0);

        const prevSamePeriod = prevYear;
        const prevConv = prevSamePeriod.reduce((s, m) => s + m.conversions, 0);
        const prevRev = prevSamePeriod.reduce((s, m) => s + m.revenue, 0);
        const prevSpend = prevSamePeriod.reduce((s, m) => s + m.adSpend, 0);

        // De laatste maand van de gekozen periode.
        const lastMonth = completeMonths[completeMonths.length - 1];
        const prevLastMonth = prevYear.find((m) => m.month === (lastMonth?.month ?? 0));

        return {
          customerId,
          ytd: {
            conversions: ytdConv,
            revenue: ytdRev,
            adSpend: ytdSpend,
            roas: ytdSpend > 0 ? parseFloat((ytdRev / ytdSpend).toFixed(2)) : 0,
            cpa: ytdConv > 0 ? parseFloat((ytdSpend / ytdConv).toFixed(2)) : 0,
          },
          yoy: {
            convChange: prevConv > 0 ? parseFloat((((ytdConv - prevConv) / prevConv) * 100).toFixed(1)) : null,
            revChange: prevRev > 0 ? parseFloat((((ytdRev - prevRev) / prevRev) * 100).toFixed(1)) : null,
            spendChange: prevSpend > 0 ? parseFloat((((ytdSpend - prevSpend) / prevSpend) * 100).toFixed(1)) : null,
          },
          lastMonth: lastMonth ? {
            month: lastMonth.month,
            conversions: lastMonth.conversions,
            revenue: lastMonth.revenue,
            adSpend: lastMonth.adSpend,
            prevYearConv: prevLastMonth?.conversions ?? 0,
          } : null,
          monthlyConversions: monthly.map((m) => m.conversions),
        };
      } catch (err) {
        return { customerId, error: err instanceof Error ? err.message : "Failed" };
      }
    })
  );

  const accounts = results.map((r) =>
    r.status === "fulfilled" ? r.value : { customerId: "unknown", error: "Failed" }
  );

  return Response.json({ accounts, period: { start, end, compareStart: cmpStart, compareEnd: cmpEnd } });
}
