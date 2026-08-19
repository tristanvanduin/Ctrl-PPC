// ============================================================================
// GRT/GRA/GRN ALS 3 LOSSE KLANTEN — voor cross-account/portfolio-synthese op demo-data.
// ----------------------------------------------------------------------------
// Masterplan 17.20 deed dit één keer als wegwerpscript en ruimde het daarna volledig op --
// "bij een volgende testronde is het overwegen waard om dit als een echt, benoemd scriptpaar
// vast te leggen in plaats van elke keer opnieuw te schrijven en weer weg te gooien." Dit is dat
// scriptpaar (teardown-geoclone-clients.ts is de spiegel).
//
// De geo-clones (GRT/GRA/GRN) binnen demo-greentech blijven wat ze zijn: campagnenaam-prefixes
// binnen ÉÉN klant, gedetecteerd via lib/fair/geo-clone-catalog.ts (lib/analysis/cross-channel-
// context.ts leunt daarop). Dit script maakt DAARNAAST 3 eigen, aparte client_id's aan die
// dezelfde onderliggende Google-campagnedata dragen -- nodig omdat cross-account/portfolio-
// synthese (lib/analysis/portfolio-synthesis.ts) op client_id sleutelt, niet op geoClone.
//
// Bewust Google-only, zoals het origineel: de niet-geo-gebonden campagnes ("GreenTech | Brand",
// "GreenTech | Display | Prospecting") horen bij geen van de drie specifiek en blijven buiten
// alle drie. Meta/LinkedIn's eigen GRT/GRA/GRN-campagnes (scripts/demo/seed-demo-client.ts)
// blijven bij demo-greentech staan -- elke pseudo-klant draait zijn eigen (Google-)SOP, niet een
// volledig multi-kanaal account.
//
// Bron: de LIVE demo-greentech-rijen (ads_campaign_monthly, via de view op fact_core) -- dus
// altijd zo actueel als de laatste seed-demo-client.ts-run, nooit een eigen kopie van de cijfers.
//
// Twee schrijflagen (ontdekt in het origineel, masterplan 17.20 punt 1-2):
//   1. ads_campaign_monthly/ads_account_monthly zijn views over fact_core (migratie 054);
//      schrijven moet naar *_legacy (fysiekeTabel()), en fact_core wordt gevuld via de RPC
//      refresh_fact_from_legacy(p_client_id) -- normaal door de sync aangeroepen, hier expliciet.
//   2. checkDataFreshness() (lib/sync/freshness.ts) eist ook ads_account_weekly en een
//      client_sync_status-rij; zonder die twee geeft de echte SOP-route "Geen Google Ads data".
//
// Draaien:
//   npx tsx scripts/demo/seed-geoclone-clients.ts            # via supabase-js (env nodig)
//   npx tsx scripts/demo/seed-geoclone-clients.ts --check    # alleen bewijzen: leest de bron,
//                                                             # geen schrijfacties
// Opruimen: npx tsx scripts/demo/teardown-geoclone-clients.ts
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { fysiekeTabel } from "../../lib/data-access/feitentabellen";

type Row = Record<string, unknown>;

export const GEOCLONE_CLIENTS = [
  {
    clientId: "demo-grt", name: "DEMO — GreenTech Amsterdam (GRT)",
    campaigns: ["GRT | Search | NL", "GRT | Performance Max"],
    conversionsTarget: 320,
  },
  {
    clientId: "demo-gra", name: "DEMO — GreenTech Americas (GRA)",
    campaigns: ["GRA | Search | US"],
    conversionsTarget: 200,
  },
  {
    clientId: "demo-grn", name: "DEMO — GreenTech North America (GRN)",
    campaigns: ["GRN | Search | NA"],
    conversionsTarget: 70,
  },
] as const;

const DEMO_GREENTECH = "demo-greentech";
// EIGEN bureau, niet het bestaande "demo"-bureau waar demo-greentech zelf onder hangt. Portfolio-
// synthese (lijstAccountsMetSops) pakt ALLE sops_enabled-accounts van één bureau; demo-greentech
// staat daar met sops_enabled=true (nodig, want anders blokkeren de monthly/weekly/biweekly-
// routes zijn eigen SOP-knoppen, zie magSopDraaien() in lib/tenancy/sop-dekking.ts). Onder
// hetzelfde bureau zou een portfolio-run dus 4 "klanten" zien waarvan er één letterlijk de som
// van de andere drie is -- geen cross-account-demo maar een dubbeltelling. Een eigen bureau
// (zelfde licentie 'growth', anders ontgrendelt portfolio-synthese niet) houdt de twee demo's
// gescheiden zonder aan demo-greentech te komen.
const DEMO_AGENCY_SLUG = "demo-portfolio";
const DEMO_AGENCY_NAME = "Demo — Cross-account portfolio";

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Van campagnerijen (al op de pseudo-client_id) naar accountmaandtotalen + weekrijen -- zelfde
 * afleiding als seed-demo-client.ts: weekrijen zijn een deterministisch kwart van de maand. */
function deriveAccountRows(clientId: string, campaignRows: Row[]): { monthly: Row[]; weekly: Row[] } {
  const byMonth = new Map<string, { imp: number; clicks: number; cost: number; conv: number; value: number }>();
  for (const r of campaignRows) {
    const month = String(r.month);
    const a = byMonth.get(month) ?? { imp: 0, clicks: 0, cost: 0, conv: 0, value: 0 };
    a.imp += Number(r.impressions ?? 0); a.clicks += Number(r.clicks ?? 0); a.cost += Number(r.cost ?? 0);
    a.conv += Number(r.conversions ?? 0); a.value += Number(r.conversions_value ?? 0);
    byMonth.set(month, a);
  }
  const monthly: Row[] = [...byMonth.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([month, a]) => ({
    client_id: clientId, month, impressions: a.imp, clicks: a.clicks, cost: a.cost, conversions: a.conv,
    conversions_value: a.value, ctr: a.imp > 0 ? r2(a.clicks / a.imp) : 0, avg_cpc: a.clicks > 0 ? r2(a.cost / a.clicks) : 0,
    cost_per_conversion: a.conv > 0 ? r2(a.cost / a.conv) : null, conversion_rate: a.clicks > 0 ? r2(a.conv / a.clicks) : 0,
    roas: a.cost > 0 ? r2(a.value / a.cost) : 0,
  }));
  // Laatste maand in vier weekrijen -- checkDataFreshness() vraagt alleen "is er recente data",
  // geen exacte week-tempo-reeks (die bestaat op dit niveau elders al, zie de kaartoverloop-nuance
  // hierover niet: dit is geen kaart, puur een freshness-vereiste).
  const last = monthly[monthly.length - 1] as (Row & { month: string }) | undefined;
  const weekly: Row[] = [];
  if (last) {
    const base = new Date(String(last.month));
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(base); weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
      weekly.push({
        client_id: clientId, week_start: weekStart.toISOString().slice(0, 10),
        impressions: Math.round(Number(last.impressions) / 4), clicks: Math.round(Number(last.clicks) / 4),
        cost: r2(Number(last.cost) / 4), conversions: Math.round(Number(last.conversions) / 4),
        conversions_value: r2(Number(last.conversions_value) / 4),
        ctr: last.ctr, avg_cpc: last.avg_cpc, cost_per_conversion: last.cost_per_conversion, conversion_rate: last.conversion_rate,
        roas: last.roas,
      });
    }
  }
  return { monthly, weekly };
}

async function run(check: boolean) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Zet NEXT_PUBLIC_SUPABASE_URL en een key in de omgeving."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: sourceCampaigns, error: sourceErr } = await db
    .from("ads_campaign_monthly")
    .select("campaign_id, campaign_name, campaign_status, month, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", DEMO_GREENTECH);
  if (sourceErr || !sourceCampaigns || sourceCampaigns.length === 0) {
    console.error(`✗ Geen bron-campagnedata voor ${DEMO_GREENTECH} (${sourceErr?.message ?? "leeg"}). Draai eerst scripts/demo/seed-demo-client.ts.`);
    process.exit(1);
  }

  let { data: agency } = await db.from("agencies").select("id").eq("slug", DEMO_AGENCY_SLUG).maybeSingle();
  if (!agency) {
    // 'growth': de laagste tier die portfolio-synthese ontgrendelt (app/api/analysis/portfolio-
    // synthesis/route.ts leest agencies.licentie), anders draait dit bureau technisch prima maar
    // krijgt elke synthese-poging 403 "vanaf Growth-tier".
    const { data: created, error: createErr } = await db.from("agencies").insert({ slug: DEMO_AGENCY_SLUG, name: DEMO_AGENCY_NAME, licentie: "growth" }).select("id").single();
    if (createErr || !created) {
      console.error(`✗ Demo-portfolio-bureau aanmaken mislukt: ${createErr?.message ?? "onbekend"}.`);
      process.exit(1);
    }
    agency = created;
    console.log(`✓ bureau '${DEMO_AGENCY_SLUG}' aangemaakt (licentie growth)`);
  }

  if (check) {
    for (const g of GEOCLONE_CLIENTS) {
      const campaigns: readonly string[] = g.campaigns;
      const rows = (sourceCampaigns as Row[]).filter((r) => campaigns.includes(String(r.campaign_name)));
      console.log(`${rows.length > 0 ? "✓" : "✗"} ${g.clientId}: ${rows.length} campagnerijen uit ${g.campaigns.join(" + ")}`);
    }
    return;
  }

  for (const g of GEOCLONE_CLIENTS) {
    const campaigns: readonly string[] = g.campaigns;
    const own = (sourceCampaigns as Row[]).filter((r) => campaigns.includes(String(r.campaign_name)));
    if (own.length === 0) { console.error(`✗ ${g.clientId}: geen bronrijen, overgeslagen`); continue; }

    const campaignRows: Row[] = own.map((r) => {
      const imp = Number(r.impressions ?? 0), clicks = Number(r.clicks ?? 0), cost = Number(r.cost ?? 0);
      const conv = Number(r.conversions ?? 0), value = Number(r.conversions_value ?? 0);
      return {
        client_id: g.clientId, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        campaign_status: r.campaign_status ?? "ENABLED", month: r.month,
        impressions: imp, clicks, cost, conversions: conv, conversions_value: value,
        ctr: imp > 0 ? r2(clicks / imp) : 0, avg_cpc: clicks > 0 ? r2(cost / clicks) : 0,
        cost_per_conversion: conv > 0 ? r2(cost / conv) : null, conversion_rate: clicks > 0 ? r2(conv / clicks) : 0,
        roas: cost > 0 ? r2(value / cost) : 0,
      };
    });
    const { monthly, weekly } = deriveAccountRows(g.clientId, campaignRows);

    // Idempotent: eerst opruimen wat een vorige run van dit script achterliet, zelfde patroon als
    // seed-demo-client.ts.
    for (const t of ["ads_campaign_monthly", "ads_account_monthly", "ads_account_weekly", "client_settings", "client_sync_status"]) {
      await db.from(fysiekeTabel(t)).delete().eq("client_id", g.clientId);
    }

    // accounts-rij EERST: refresh_fact_from_legacy() (migratie 078) joint fact_core tegen
    // accounts op client_id om account_id/agency_id te vinden -- zonder deze rij matcht die join
    // nul rijen en blijft fact_core (dus de ads_campaign_monthly/ads_account_monthly-VIEWS) leeg,
    // ook al staan de *_legacy-rijen er al lang. upsert op client_id (unique) i.p.v. delete+insert,
    // want accounts.id wordt elders (RLS/joins) niet hergebruikt.
    const { error: acctRowErr } = await db.from("accounts").upsert(
      { agency_id: agency.id, client_id: g.clientId, name: g.name, source: "demo" },
      { onConflict: "client_id" }
    );
    if (acctRowErr) { console.error(`✗ ${g.clientId}: accounts-rij (${acctRowErr.message}), overgeslagen`); continue; }

    const { error: campErr } = await db.from(fysiekeTabel("ads_campaign_monthly")).insert(campaignRows);
    const { error: acctErr } = await db.from(fysiekeTabel("ads_account_monthly")).insert(monthly);
    const { error: weekErr } = await db.from(fysiekeTabel("ads_account_weekly")).insert(weekly);
    if (campErr || acctErr || weekErr) {
      console.error(`✗ ${g.clientId}: schrijffout (${campErr?.message ?? acctErr?.message ?? weekErr?.message})`);
      continue;
    }

    // Projectie naar fact_core -- zonder deze stap lezen ads_campaign_monthly/ads_account_monthly
    // (de views) niets, want die staan over fact_core, niet over de *_legacy-tabellen hierboven.
    const { error: rpcErr } = await db.rpc("refresh_fact_from_legacy", { p_client_id: g.clientId });
    if (rpcErr) console.error(`  ⚠ ${g.clientId}: projectie naar fact_core mislukt (${rpcErr.message}) -- rijen staan er, maar de leeskant kan ze nog niet zien.`);

    const { error: settingsErr } = await db.from("client_settings").insert({
      client_id: g.clientId,
      // Zelfde sector/niche voor alle drie, met opzet -- de expliciete aanname waarop de
      // cross-account-synthese leunt (masterplan 17.20), niet gegokt.
      bedrijfsmodel: "b2b", niche: "industrie",
      kpi_targets: { conversionsMode: "absolute", conversionsAbsolute: g.conversionsTarget, conversionsGrowthPct: 0, revenueMode: "absolute", revenueAbsolute: 0, revenueGrowthPct: 0, roasTarget: 0, cpaTarget: 45 },
    });
    const { error: syncErr } = await db.from("client_sync_status").insert({
      client_id: g.clientId, last_sync_at: new Date().toISOString(), last_sync_status: "demo",
      last_successful_sync_at: new Date().toISOString(), datasets_available: 3, datasets_total: 3, freshness_status: "fresh",
    });
    if (settingsErr || syncErr) console.error(`  ⚠ ${g.clientId}: instellingen/sync-status (${settingsErr?.message ?? syncErr?.message})`);

    // Klantenlijst: zelfde plek als seed-demo-client.ts, zodat het account in de UI kiesbaar is.
    const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "api_clients").maybeSingle();
    const list = Array.isArray(settingsRow?.value) ? (settingsRow!.value as { id?: string; name?: string; source?: string }[]) : [];
    if (!list.some((c) => c.id === g.clientId)) {
      list.push({ id: g.clientId, name: g.name, source: "demo" });
      await db.from("app_settings").upsert({ key: "api_clients", value: list, updated_at: new Date().toISOString() });
    }

    console.log(`✓ ${g.clientId}: ${campaignRows.length} campagnerijen, ${monthly.length} maanden, ${weekly.length} weekrijen`);
  }

  console.log("\nKlaar. Opruimen kan met: npx tsx scripts/demo/teardown-geoclone-clients.ts");
}

// Guard: teardown-geoclone-clients.ts importeert GEOCLONE_CLIENTS hierboven. Zonder deze guard
// voert Node/tsx bij die import ALSNOG de module top-level uit, dus ook run() -- en teardown zou
// zichzelf dan bij elke run stiekem opnieuw laten zaaien vlak voordat het opruimt (ontdekt toen
// een "opgeruimd"-run daarna weer volle rijen bleek te hebben: twee run()'s liepen tegelijk tegen
// dezelfde database).
const isMain = typeof process.argv[1] === "string" && /seed-geoclone-clients\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const mode = process.argv[2];
  run(mode === "--check");
}
