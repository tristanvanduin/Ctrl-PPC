// =====================================================================
// W1.4 (Z1): per-klant data-health. GET /api/health/client?clientId=... verzamelt per
// kanaal de metrieken en laat de pure engine (lib/health.ts) er checks van maken. Google
// is volledig gegrond op de bestaande client_sync_status; Meta en LinkedIn worden
// defensief gedetecteerd via hun connections-tabellen (nog niet in productie) en leveren
// pas checks zodra die tabellen bestaan. LIVE-ONGETEST: de queries vergen de echte
// omgeving. De read valt onder viewer-niveau via de O1-middleware zodra die actief is.
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { evaluateChannelHealth, evaluateConversionTrackingQuality, assembleClientHealth, type ChannelHealth, type ChannelHealthInput, type HealthCheck, type HealthStatus } from "@/lib/health";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { datastandVoorKlant, dagstandVoorKlant } from "@/lib/sync/datastand";
import { eis } from "@/lib/analysis/db-veilig";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  // Demo-rijen voor de demo-klant; anders had de gezondheidsbadge in demo een 500 gegeven.
  const supabase = supabaseForClient(clientId) ?? getClient();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const channels: ChannelHealth[] = [];

  // Google: gegrond op client_sync_status (bestaande waarheid, niet herbouwd), aangevuld met
  // de conversietracking-kwaliteit (hefboom 4): trackingbreuk en config-compleetheid.
  try {
    const [{ data: sync }, { data: convRows }, { data: settings }] = await Promise.all([
      supabase
        .from("client_sync_status")
        .select("last_successful_sync_at, datasets_available, datasets_total")
        .eq("client_id", clientId)
        .maybeSingle(),
      supabase
        .from("ads_account_monthly")
        .select("month, conversions")
        .eq("client_id", clientId)
        .order("month", { ascending: true }),
      supabase.from("client_settings").select("conversion_actions, conversion_lag_days").eq("client_id", clientId).maybeSingle(),
    ]);
    const googleInput: ChannelHealthInput = {
      channel: "google_ads",
      connected: true,
      lastSuccessfulSyncAt: sync?.last_successful_sync_at ?? null,
      datasetsAvailable: sync?.datasets_available ?? null,
      datasetsTotal: sync?.datasets_total ?? null,
    };
    const googleHealth = evaluateChannelHealth(googleInput);

    const actions = Array.isArray(settings?.conversion_actions) ? (settings.conversion_actions as Array<Record<string, unknown>>) : [];
    const convChecks = evaluateConversionTrackingQuality({
      series: (convRows ?? []).map((r) => ({ period: String(r.month), conversions: typeof r.conversions === "number" ? r.conversions : 0 })),
      hasPrimaryAction: actions.some((a) => a.category === "primary"),
      conversionLagConfigured: settings?.conversion_lag_days != null,
      conversionLagDays: settings?.conversion_lag_days ?? null,
      asOfDate: today(),
    });

    // De datastand uit de data zelf (tot welke maand er rijen staan), naast de sync-versheid
    // uit client_sync_status: die laatste bleef "fresh" zeggen terwijl de data bij april stopte.
    const stand = await datastandVoorKlant(supabase, clientId);
    const standCheck: HealthCheck = {
      key: "data_stand",
      status: stand.toestand === "actueel" ? "ok" : stand.toestand === "achter" ? "warn" : "fail",
      detail: stand.tekst,
    };

    const allChecks = [...googleHealth.checks, standCheck, ...convChecks];
    const worstStatus: HealthStatus = allChecks.some((c) => c.status === "fail")
      ? "fail"
      : allChecks.some((c) => c.status === "warn")
        ? "warn"
        : "ok";
    channels.push({ channel: "google_ads", status: worstStatus, checks: allChecks });
  } catch (e) {
    // Een bron die faalt is geen "nooit gesynct": de check zegt welke bron het was.
    const detail = e instanceof Error ? e.message : String(e);
    channels.push({ channel: "google_ads", status: "fail", checks: [{ key: "bron", status: "fail", detail: `health-bron faalde: ${detail}` }] });
  }

  // Meta, LinkedIn en Microsoft: connected zodra er een koppelingsrij is die niet op disabled
  // staat (kanaalronde 3 september 2026). De sync-versheid komt uit last_sync_at op die rij
  // (alleen bij een geslaagde run gezet), de tokenstatus uit status, en de datastand uit de
  // dagtabel zelf. Een bron die faalt is een fail-check, geen "niet gekoppeld".
  for (const kanaal of ["meta", "linkedin", "microsoft"] as const) {
    const channel = `${kanaal}_ads`;
    try {
      const rijRes = await supabase.from(`${kanaal}_connections`).select("status, last_sync_at, last_error").eq("client_id", clientId).limit(1);
      const rij = (eis(rijRes, `${kanaal}_connections (health)`) as { status?: string | null; last_sync_at?: string | null; last_error?: string | null }[])[0] ?? null;
      const connected = rij !== null && rij.status !== "disabled";
      if (!connected) {
        channels.push(evaluateChannelHealth({ channel, connected: false }));
        continue;
      }
      const basis = evaluateChannelHealth({
        channel,
        connected: true,
        lastSuccessfulSyncAt: rij?.last_sync_at ?? null,
        tokenStatus: rij?.status === "expired" ? "expired" : "ok",
      });
      const stand = await dagstandVoorKlant(supabase, clientId, kanaal);
      const checks: HealthCheck[] = [
        ...basis.checks,
        { key: "data_stand", status: stand.toestand === "actueel" ? "ok" : stand.toestand === "achter" ? "warn" : "fail", detail: stand.tekst },
      ];
      if (rij?.status === "error" || rij?.last_error) {
        checks.push({ key: "koppeling", status: rij.status === "error" ? "fail" : "warn", detail: `koppeling ${rij.status ?? "?"}: ${rij.last_error ?? "zonder detail"}` });
      }
      const worst: HealthStatus = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
      channels.push({ channel, status: worst, checks });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      channels.push({ channel, status: "fail", checks: [{ key: "bron", status: "fail", detail: `health-bron faalde: ${detail}` }] });
    }
  }

  return Response.json(assembleClientHealth(clientId, channels));
}
