// Gedragstest: de blended historie leest in ÉÉN ronde, en de stand per kanaal komt uit dezelfde
// rijen (lib/api/blended-historical.ts). Draaien: tsx lib/api/__blended_rondes_test.ts
//
// Wat er was. fetchBlendedHistoricalData deed drie rondes na elkaar naar de database: de klant
// (accounts), dan de rijen, dan de stand per kanaal. De route is de poort voor het eerste
// kerncijfer op het Overzicht, dus elke ronde was wachttijd op het scherm (gemeten 676 tot 1000 ms
// voor de route). In de derde ronde las dagstandVoorKlant per dagkanaal de nieuwste 400 datums uit
// <kanaal>_account_daily, terwijl de tweede ronde ALLE rijen van dezelfde tabel al had.
//
// Wat hier vastligt:
// - alles wat op client_id filtert vertrekt meteen, vóór het eerste antwoord: ook de lezingen voor
//   de stand (ads_account_monthly, client_sync_status, <kanaal>_connections); alleen fact_core
//   wacht op het account-id;
// - de dagtabellen worden één keer gelezen (geen losse datumlezing meer);
// - de uitkomst is dezelfde als met de lezer die er stond: per dagkanaal dezelfde dataTot en
//   syncDraait als dagstandVoorKlant geeft, ook bij een uitgezette koppeling en een verse syncdag;
// - een kapotte koppelingstabel is de terugval van dat ene kanaal (zijn eigen nieuwste rij), zoals
//   voorheen, en geen fout van de route;
// - een klant die niet bestaat geeft null, ook als de andere lezingen falen, zonder onafgehandelde
//   afwijzing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlendedHistoricalData } from "./blended-historical";
import { FakeSupabase } from "../decision/__fake_supabase";
import { dagstandVoorKlant, dataTotVanDagbron, remtNietBijAchterstand, type Dagkanaal } from "../sync/datastand";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const onafgehandeld: unknown[] = [];
process.on("unhandledRejection", (e) => { onafgehandeld.push(e); });

const NU = "2026-11-02";
type Rij = Record<string, unknown>;

/** De nep-Supabase met een logboek: welke tabel, met welke select, in welke volgorde. */
function metLogboek(sb: FakeSupabase): { client: SupabaseClient; log: { tabel: string; select: string }[] } {
  const log: { tabel: string; select: string }[] = [];
  const client = {
    rpc: sb.rpc.bind(sb),
    from(tabel: string) {
      const b = sb.from(tabel);
      const proxy: unknown = new Proxy(b, {
        get(doel, prop) {
          const v = doel[prop];
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "select") log.push({ tabel, select: String(args[0] ?? "") });
            const uit = v.apply(doel, args);
            return uit === doel ? proxy : uit;
          };
        },
      });
      return proxy;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

function klant(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-r", client_id: "klant-r", name: "R", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("client_settings", [{ client_id: "klant-r", channel_conversion_config: null }]);
  sb.seed("fact_core", Array.from({ length: 10 }, (_, i) => ({
    account_id: "acc-r", channel: "google", level: "account", grain: "month", period_start: `2026-${String(i + 1).padStart(2, "0")}-01`,
    impressions: 100, clicks: 10, cost: 100, conversions: 5, conv_value: 50,
  })));
  sb.seed("ads_account_monthly", Array.from({ length: 10 }, (_, i) => ({ client_id: "klant-r", month: `2026-${String(i + 1).padStart(2, "0")}-01` })));
  sb.seed("client_sync_status", [{ client_id: "klant-r", last_successful_sync_at: "2026-11-02T05:00:00Z" }]);
  const dag = (date: string, extra: Rij) => ({ client_id: "klant-r", date, impressions: 10, spend: 5, conversion_value: 0, ...extra });
  // Meta: actueel, de nieuwste rij is die van de syncdag zelf (telt t/m de dag ervoor).
  sb.seed("meta_account_daily", ["2026-09-15", "2026-10-30", "2026-10-31", "2026-11-02"].map((d) => dag(d, { entity_id: "m1", link_clicks: 1, conversions: 1, leads: 0 })));
  sb.seed("meta_connections", [{ client_id: "klant-r", last_sync_at: "2026-11-02T05:00:00Z", status: "active" }]);
  // LinkedIn: uitgezet in Instellingen, de data stopte in maart.
  sb.seed("linkedin_account_daily", ["2026-02-10", "2026-03-20"].map((d) => dag(d, { entity_urn: "l1", clicks: 1, one_click_leads: 1, external_website_conversions: 0, post_click_conversions: 0 })));
  sb.seed("linkedin_connections", [{ client_id: "klant-r", last_sync_at: "2026-03-21T05:00:00Z", status: "disabled" }]);
  // Microsoft: de sync slaagde na de nieuwste rij (dagen zonder levering zijn dan gemeten).
  sb.seed("microsoft_account_daily", ["2026-10-01", "2026-10-28"].map((d) => dag(d, { entity_id: "ms1", clicks: 1, conversions: 1 })));
  sb.seed("microsoft_connections", [{ client_id: "klant-r", last_sync_at: "2026-11-01T05:00:00Z", status: "active" }]);
  return sb;
}

const DAGKANALEN: Dagkanaal[] = ["meta", "linkedin", "microsoft"];
type Bron = { bron: string; dataTot: string | null; syncDraait?: boolean; laatsteRij?: string | null };

async function main() {
  console.log("Eén ronde: alles op client_id vertrekt vóór het eerste antwoord");
  {
    const { client, log } = metLogboek(klant());
    const lopend = fetchBlendedHistoricalData(client, "klant-r", NU);
    // Synchroon na de aanroep: er is nog geen enkel antwoord verwerkt.
    const meteen = log.map((l) => l.tabel);
    for (const tabel of ["accounts", "client_settings", "client_targets", "meta_account_daily", "linkedin_account_daily", "microsoft_account_daily",
      "ads_account_monthly", "client_sync_status", "meta_connections", "linkedin_connections", "microsoft_connections"]) {
      check(`${tabel} vertrekt in de eerste ronde`, meteen.includes(tabel), meteen.join(","));
    }
    check("alleen fact_core wacht op het account-id", !meteen.includes("fact_core"));
    const uit = await lopend;
    check("fact_core is daarna gelezen", log.some((l) => l.tabel === "fact_core"));
    check("de route geeft een antwoord met een datastand", !!uit?.dataStand, JSON.stringify(uit?.dataStand));

    console.log("De dagtabellen worden één keer gelezen, niet nog eens voor de stand");
    for (const k of DAGKANALEN) {
      const lezingen = log.filter((l) => l.tabel === `${k}_account_daily`);
      check(`${k}_account_daily: één lezing`, lezingen.length === 1, `${lezingen.length}: ${lezingen.map((l) => l.select).join(" | ")}`);
      check(`${k}_account_daily: geen losse datumlezing`, !lezingen.some((l) => l.select.trim() === "date"));
      check(`${k}_connections: één lezing`, log.filter((l) => l.tabel === `${k}_connections`).length === 1);
    }

    console.log("Dezelfde stand per kanaal als de lezer die er stond (dagstandVoorKlant)");
    const bronnen = (uit?.dataStand as unknown as { bronnen?: Bron[] } | null)?.bronnen ?? [];
    const referentie = klant();
    for (const k of DAGKANALEN) {
      const s = await dagstandVoorKlant(referentie as unknown as SupabaseClient, "klant-r", k, NU);
      const b = bronnen.find((x) => x.bron === k);
      check(`${k}: dezelfde dataTot`, b?.dataTot === dataTotVanDagbron(s), `${b?.dataTot} tegen ${dataTotVanDagbron(s)}`);
      check(`${k}: dezelfde syncDraait`, b?.syncDraait === (remtNietBijAchterstand(s) || !s.gekoppeld), `${b?.syncDraait}`);
      check(`${k}: dezelfde nieuwste rij`, b?.laatsteRij === s.laatsteDag, `${b?.laatsteRij} tegen ${s.laatsteDag}`);
    }
    check("Meta: de rij van de syncdag telt niet, t/m de dag ervoor", bronnen.find((x) => x.bron === "meta")?.dataTot === "2026-11-01", JSON.stringify(bronnen));
    check("Microsoft: gemeten t/m de dag vóór de laatste sync", bronnen.find((x) => x.bron === "microsoft")?.dataTot === "2026-10-31", JSON.stringify(bronnen));
    check("LinkedIn (uitgezet) staat in uitgesloten en remt het venster niet",
      (uit?.dataStand?.uitgesloten ?? []).some((u) => (typeof u === "string" ? u : (u as { bron?: string }).bron) === "linkedin")
      && uit?.dataStand?.dataTot === "2026-10-31", JSON.stringify(uit?.dataStand));
  }

  console.log("Een kapotte koppelingstabel: de terugval van dat ene kanaal, geen fout van de route");
  {
    const sb = klant();
    sb.faalOp("meta_connections", "permission denied");
    const { client } = metLogboek(sb);
    const uit = await fetchBlendedHistoricalData(client, "klant-r", NU);
    const bronnen = (uit?.dataStand as unknown as { bronnen?: Bron[] } | null)?.bronnen ?? [];
    const meta = bronnen.find((x) => x.bron === "meta");
    check("de route antwoordt", !!uit);
    check("Meta valt terug op zijn eigen nieuwste rij en remt mee", meta?.dataTot === "2026-11-02" && meta.syncDraait === false && meta.laatsteRij === "2026-11-02", JSON.stringify(meta));
    check("de andere kanalen houden hun stand", bronnen.find((x) => x.bron === "microsoft")?.dataTot === "2026-10-31");
  }

  console.log("Een kapotte Google-stand: Google valt terug op zijn nieuwste maand");
  {
    const sb = klant();
    sb.faalOp("client_sync_status", "kapot");
    const { client } = metLogboek(sb);
    const uit = await fetchBlendedHistoricalData(client, "klant-r", NU);
    const google = ((uit?.dataStand as unknown as { bronnen?: Bron[] } | null)?.bronnen ?? []).find((x) => x.bron === "google");
    check("Google: het eind van de nieuwste maand, en hij remt mee", google?.dataTot === "2026-10-31" && google.syncDraait === false, JSON.stringify(google));
  }

  console.log("Een klant die niet bestaat: null, ook als de andere lezingen falen");
  {
    const sb = klant();
    sb.faalOp("client_settings", "kapot");
    sb.faalOp("meta_account_daily", "kapot");
    sb.faalOp("ads_account_monthly", "kapot");
    const { client } = metLogboek(sb);
    let gooit = false;
    const uit = await fetchBlendedHistoricalData(client, "bestaat-niet", NU).catch(() => { gooit = true; return undefined; });
    check("null, geen fout", uit === null && !gooit, String(uit));
    await new Promise((r) => setTimeout(r, 30));
    check("geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  console.log("Een bestaande klant met een kapotte rijenlezing blijft een fout (geen 'geen data')");
  {
    const sb = klant();
    sb.faalOp("meta_account_daily", "kapot");
    const { client } = metLogboek(sb);
    let fout: unknown = null;
    await fetchBlendedHistoricalData(client, "klant-r", NU).catch((e) => { fout = e; });
    check("de fout noemt de bron", fout instanceof Error && /meta_account_daily/.test(fout.message), String(fout));
    await new Promise((r) => setTimeout(r, 30));
    check("en nog steeds geen onafgehandelde afwijzing", onafgehandeld.length === 0, String(onafgehandeld[0]));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
