import { NextRequest } from "next/server";
import {
  getAccountMetricsByMonth,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { googleAdsMonthlyToApiData } from "@/lib/api/adapter";
import { HISTORIE_JAREN, googleMaandReeks, jaarOpJaar } from "@/lib/api/google-vergelijking";
import { today } from "@/lib/reporting-date";
import { addMonths, isValidMonth, monthIndex, type Month } from "@/lib/period/period-range";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { eis } from "@/lib/analysis/db-veilig";
import { dashboardConversionActionIds } from "@/lib/analysis/channel-conversion-config";

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
  // De vergelijking wordt opgehaald vanaf het historiebegin van het dashboard, niet vanaf
  // cmpStart: de paarregel zoekt de eerste maand met data, en die hoort dezelfde te zijn als op het
  // klantdashboard (zie lib/api/google-vergelijking.ts).
  const historieBegin: Month = `${Number(today().slice(0, 4)) - HISTORIE_JAREN}-01`;
  const vanaf = monthIndex(cmpStart) < monthIndex(historieBegin) ? cmpStart : historieBegin;
  const binnen = (van: Month, tot: Month) => (datum: string) => {
    const i = monthIndex(datum.slice(0, 7));
    return i >= monthIndex(van) && i <= monthIndex(tot);
  };
  const inPeriode = binnen(start, end);
  const inVergelijking = binnen(cmpStart, cmpEnd);

  // Welke conversieacties meetellen, per account uit client_settings.conversion_actions: dezelfde
  // lezing als de client-data-route. Zonder deze stap telde het portfolio ALLE acties en het
  // dashboard alleen de aangevinkte, en stond één klant in hetzelfde venster op twee getallen. Eén
  // lezing voor alle accounts in plaats van één per account. Een leesfout wordt een 500 en geen
  // stille terugval op "alles": ongefilterde cijfers zien er net zo geloofwaardig uit. Zonder
  // Supabase-configuratie (lokaal zonder database) is er geen selectie om te lezen.
  const selectie = new Map<string, string[] | undefined>();
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const rijen = eis(
        await sb.from("client_settings").select("client_id, conversion_actions").in("client_id", customerIds.map((id) => `gads-${id}`)),
        "client_settings (conversieacties)",
      ) as { client_id?: string; conversion_actions?: unknown }[];
      for (const rij of rijen) {
        if (rij.client_id?.startsWith("gads-")) selectie.set(rij.client_id.slice(5), dashboardConversionActionIds(rij.conversion_actions));
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Onbekende fout" }, { status: 500 });
    }
  }

  // Het bereik loopt tot de laatste dag van de eindmaand; anders snijdt een .lte op de eerste
  // van de maand de hele maand eraf.
  const results = await Promise.allSettled(
    customerIds.map(async (customerId) => {
      try {
        const convActionIds = selectie.get(customerId);
        const [monthlyRaw, historieRaw] = await Promise.all([
          getAccountMetricsByMonth(credentials, customerId, `${start}-01`, laatsteDag(end), convActionIds),
          getAccountMetricsByMonth(credentials, customerId, `${vanaf}-01`, laatsteDag(cmpEnd), convActionIds),
        ]);
        const prevYearRaw = historieRaw.filter((r) => inVergelijking(r.date));

        const monthly = googleAdsMonthlyToApiData(monthlyRaw);
        const prevYear = googleAdsMonthlyToApiData(prevYearRaw);

        // Alles binnen het gevraagde bereik telt mee. De kiezer biedt de lopende maand niet aan
        // (period-range); een eigen bereik dat hem toch bevat, telt hem hier wel mee.
        const completeMonths = monthly;
        const ytdConv = completeMonths.reduce((s, m) => s + m.conversions, 0);
        const ytdRev = completeMonths.reduce((s, m) => s + m.revenue, 0);
        const ytdSpend = completeMonths.reduce((s, m) => s + m.adSpend, 0);

        // Het percentage paart maand voor maand, zoals het klantdashboard: een maand van vóór de
        // eerste maand met data telt aan geen van beide kanten mee. Eerst stond hier som tegen som,
        // en een account dat in juni vorig jaar begon, groeide dan over januari t/m mei uit het
        // niets. De historie gaat mee voor de start; geteld wordt alleen binnen de twee perioden.
        const yoy = jaarOpJaar(
          // Elke maand één keer: de gekozen periode uit zijn eigen aanroep, de rest uit de historie.
          googleMaandReeks("google", [...historieRaw.filter((r) => !inPeriode(r.date)), ...monthlyRaw]),
          { start, end },
          { start: cmpStart, end: cmpEnd },
        );

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
          yoy,
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
