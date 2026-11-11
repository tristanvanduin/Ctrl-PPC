// Laag (d) van de invariant "kanaaltab == Alle kanalen": de cross-channel-tabel per maand is de
// teller van perKanaal, en per maand opgeteld de blended maand.
// Draaien: tsx --tsconfig ./tsconfig.json lib/cross-channel/__kanaal_maandrijen_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De kanaaltabel, de staven en de kanaalring op "Alle kanalen" lazen de view
// blended_account_monthly; de kerncijfers, de pacing en het jaaroverzicht op hetzelfde tabblad
// lazen /api/blended/client-data. De view telt de STANDAARDselectie van conversies en kent geen
// Microsoft. Een klant die op Meta alleen leads telt, zag daardoor in de tabel meer conversies
// dan in de band erboven, en Microsoft ontbrak onder een kop die alle kanalen belooft. Geen test
// zag het: elk cijfer klopte met zijn eigen bron.
//
// Nu komen de rijen uit kanaalMaandRijen(perKanaal). Wat hier vastligt, op rijen die door de ECHTE
// routefunctie gaan (fetchBlendedHistoricalData op een nep-Supabase) en door JSON heen, zoals
// over de lijn:
//
//   - elke rij is één (kanaal, maand) van perKanaal, met dezelfde tellers, niets erbij of eraf;
//   - de conversies zijn die van de selectie van de klant (Meta: alleen leads), nageteld op de
//     dagrijen zelf en niet op de uitvoer van de route;
//   - Microsoft staat erin;
//   - per maand tellen de kanalen op tot de blended maand van dezelfde route;
//   - de kanaaltotalen van de tabel zijn de som van perKanaal;
//   - cross-channel-view.tsx bouwt zijn rijen zo, en leest de view niet meer (brontoets).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlendedHistoricalData, type BlendedKanaalReeks } from "../api/blended-historical";
import { FakeSupabase } from "../decision/__fake_supabase";
import { addDays } from "../reporting-date";
import { channelKeyVanKanaal, kanaalMaandRijen } from "./kanaal-maandrijen";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Record<string, unknown>;
const NU = "2026-11-01";
// Meta telt bij deze klant ALLEEN leads; de standaard (en dus de view) telt conversies + leads.
const SELECTIE = { meta_ads: ["leads"], linkedin_ads: ["one_click_leads"] };

function dagen(van: string, tot: string, maak: (d: string, dag: number, mnd: number) => Rij): Rij[] {
  const uit: Rij[] = [];
  for (let d = van; d <= tot; d = addDays(d, 1)) uit.push(maak(d, Number(d.slice(8, 10)), Number(d.slice(5, 7))));
  return uit;
}

// De maand telt mee in elk cijfer: anders zijn alle maanden van 31 dagen gelijk, en ziet de test
// een verwisselde maand niet.
const metaRijen = dagen("2025-12-10", "2026-03-31", (date, dag, mnd) => ({
  client_id: "klant-d", date, entity_id: "m1",
  impressions: 1000 + dag * 10 + mnd * 7, link_clicks: 20 + dag + mnd, spend: 40 + dag + mnd * 3,
  conversions: 3, leads: 1 + ((dag + mnd) % 3), conversion_value: 100 + dag,
}));
const linkedinRijen = dagen("2026-01-01", "2026-03-31", (date, dag, mnd) => ({
  client_id: "klant-d", date, entity_urn: "l1",
  impressions: 400 + dag, clicks: 6 + mnd, spend: 25 + mnd,
  one_click_leads: 1 + (dag % 2), external_website_conversions: 2, post_click_conversions: 1, conversion_value: 0,
}));
const microsoftRijen = dagen("2026-02-01", "2026-03-31", (date, dag, mnd) => ({
  client_id: "klant-d", date, entity_id: "b1",
  impressions: 300 + dag + mnd, clicks: 9 + mnd, spend: 12 + mnd, conversions: 1 + (dag % 2), conversion_value: 30,
}));
const googleMaanden: Rij[] = [
  ["2025-11", 90000, 3100, 4000, 80, 9000],
  ["2025-12", 95000, 3300, 4200, 85, 9500],
  ["2026-01", 100000, 3500, 4500, 90, 10000],
  ["2026-02", 110000, 3700, 4700, 95, 11000],
  ["2026-03", 120000, 3900, 4900, 99, 12000],
].map(([m, impressions, clicks, cost, conversions, conv_value]) => ({
  account_id: "acc-d", channel: "google", level: "account", grain: "month", period_start: `${m}-01`,
  impressions, clicks, cost, conversions, conv_value,
}));

function nepDatabase(): FakeSupabase {
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-d", client_id: "klant-d", name: "D", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("client_settings", [{ client_id: "klant-d", channel_conversion_config: SELECTIE }]);
  sb.seed("fact_core", googleMaanden);
  // Google: maandbron, gesynct op 2 april -> maart is vol.
  sb.seed("ads_account_monthly", googleMaanden.map((r) => ({ client_id: "klant-d", month: r.period_start })));
  sb.seed("client_sync_status", [{ client_id: "klant-d", last_successful_sync_at: "2026-04-02T05:00:00Z" }]);
  sb.seed("meta_account_daily", metaRijen);
  sb.seed("linkedin_account_daily", linkedinRijen);
  sb.seed("microsoft_account_daily", microsoftRijen);
  sb.seed("client_targets", []);
  return sb;
}

const som = (rijen: Rij[], maand: string, veld: string) =>
  rijen.filter((r) => String(r.date).startsWith(maand)).reduce((s, r) => s + Number(r[veld] ?? 0), 0);
const bijna = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function main() {
  const ruw = await fetchBlendedHistoricalData(nepDatabase() as unknown as SupabaseClient, "klant-d", NU);
  // Over de lijn: de browser krijgt JSON, geen objecten van de server.
  const antwoord = JSON.parse(JSON.stringify(ruw)) as NonNullable<typeof ruw>;
  const perKanaal: BlendedKanaalReeks[] = antwoord.perKanaal;
  const rijen = kanaalMaandRijen(perKanaal);

  console.log("Elke rij is één (kanaal, maand) van perKanaal");
  {
    const aantalMaanden = perKanaal.reduce((s, k) => s + k.maanden.length, 0);
    check("er zijn rijen, en evenveel als kanaal-maanden", rijen.length > 0 && rijen.length === aantalMaanden, `${rijen.length} rijen, ${aantalMaanden} kanaal-maanden`);
    check("geen (kanaal, maand) dubbel", new Set(rijen.map((r) => `${r.channel}|${r.month}`)).size === rijen.length);
    let gelijk = true; let eerste = "";
    for (const reeks of perKanaal) {
      for (const m of reeks.maanden) {
        const r = rijen.find((x) => x.channel === channelKeyVanKanaal(reeks.kanaal) && x.month === `${m.month}-01`);
        const ok = r !== undefined && r.spend === m.adSpend && r.conversions === m.conversions && r.conversion_value === m.revenue
          && r.impressions === m.impressions && r.clicks === m.clicks;
        if (!ok && gelijk) { gelijk = false; eerste = `${reeks.kanaal} ${m.month}: ${JSON.stringify(r)} tegen ${JSON.stringify(m)}`; }
      }
    }
    check("de tellers van elke rij zijn die van perKanaal (kosten, conversies, waarde, vertoningen, klikken)", gelijk, eerste);
    check("de kanaalsleutels zijn die van de cross-channel-laag",
      [...new Set(rijen.map((r) => r.channel))].sort().join(",") === "google_ads,linkedin_ads,meta_ads,microsoft_ads",
      [...new Set(rijen.map((r) => r.channel))].join(","));
    check("nieuwste maand eerst, en binnen een maand de volgorde van de route",
      rijen.every((r, i) => i === 0 || rijen[i - 1].month >= r.month)
        && rijen.filter((r) => r.month === "2026-03-01").map((r) => r.channel).join(",") === "google_ads,meta_ads,linkedin_ads,microsoft_ads",
      rijen.filter((r) => r.month === "2026-03-01").map((r) => r.channel).join(","));
  }

  console.log("De selectie van de klant, nageteld op de dagrijen");
  {
    const metaFeb = rijen.find((r) => r.channel === "meta_ads" && r.month === "2026-02-01");
    const leads = som(metaRijen, "2026-02", "leads");
    const standaard = leads + som(metaRijen, "2026-02", "conversions");
    check("Meta februari telt alleen leads", metaFeb?.conversions === leads, `${metaFeb?.conversions} tegen ${leads}`);
    check("en dat is niet de standaardselectie die de view telde (conversies + leads)", metaFeb?.conversions !== standaard && standaard > leads, `${standaard}`);
    check("Meta februari: kosten, klikken (link_clicks) en vertoningen uit de dagrijen",
      metaFeb !== undefined && bijna(metaFeb.spend, som(metaRijen, "2026-02", "spend")) && metaFeb.clicks === som(metaRijen, "2026-02", "link_clicks")
        && metaFeb.impressions === som(metaRijen, "2026-02", "impressions") && bijna(metaFeb.conversion_value, som(metaRijen, "2026-02", "conversion_value")),
      JSON.stringify(metaFeb));
    const liJan = rijen.find((r) => r.channel === "linkedin_ads" && r.month === "2026-01-01");
    check("LinkedIn januari telt alleen de lead-formulieren", liJan?.conversions === som(linkedinRijen, "2026-01", "one_click_leads"), String(liJan?.conversions));
    // De partiële eerste maand (Meta begint op 10 december) staat er gewoon in: de tabel telt
    // wat er gemeten is, het paren van maanden is iets van de vergelijking, niet van de tabel.
    const metaDec = rijen.find((r) => r.channel === "meta_ads" && r.month === "2025-12-01");
    check("de partiële eerste maand van Meta staat erin", metaDec !== undefined && bijna(metaDec.spend, som(metaRijen, "2025-12", "spend")), JSON.stringify(metaDec));
  }

  console.log("Microsoft staat erin");
  {
    const msMrt = rijen.find((r) => r.channel === "microsoft_ads" && r.month === "2026-03-01");
    check("Microsoft maart, met zijn eigen tellers uit de dagtabel",
      msMrt !== undefined && msMrt.conversions === som(microsoftRijen, "2026-03", "conversions") && msMrt.clicks === som(microsoftRijen, "2026-03", "clicks")
        && bijna(msMrt.spend, som(microsoftRijen, "2026-03", "spend")),
      JSON.stringify(msMrt));
    check("en niet in een maand waarin het niet liep", !rijen.some((r) => r.channel === "microsoft_ads" && r.month === "2026-01-01"));
    const google = rijen.find((r) => r.channel === "google_ads" && r.month === "2026-02-01");
    check("Google februari uit fact_core, vertoningen en klikken erbij",
      google?.spend === 4700 && google.conversions === 95 && google.conversion_value === 11000 && google.impressions === 110000 && google.clicks === 3700, JSON.stringify(google));
  }

  console.log("Per maand tellen de kanalen op tot de blended maand");
  {
    // De blended maanden van dezelfde route: dit jaar t/m de laatste volle maand, en de vorige jaren.
    const blended = new Map<string, { conversions: number; revenue: number; adSpend: number; impressions: number; clicks: number }>();
    for (const m of antwoord.currentYearMonthly) blended.set(`${antwoord.currentYear}-${String(m.month).padStart(2, "0")}`, m);
    for (const j of antwoord.historicalYears) for (const m of j.monthly) blended.set(`${j.year}-${String(m.month).padStart(2, "0")}`, m);
    check("de route geeft blended maanden in beide jaren", blended.has("2026-03") && blended.has("2025-12"), [...blended.keys()].join(","));
    let ok = true; let eerste = "";
    for (const [maand, b] of blended) {
      const van = rijen.filter((r) => r.month === `${maand}-01`);
      const t = van.reduce((s, r) => ({
        conversions: s.conversions + r.conversions, revenue: s.revenue + r.conversion_value, adSpend: s.adSpend + r.spend,
        impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks,
      }), { conversions: 0, revenue: 0, adSpend: 0, impressions: 0, clicks: 0 });
      // De blended maand is afgerond op hele conversies en euro's (de adapter); de tellers niet.
      const gelijk = Math.round(t.conversions) === b.conversions && Math.round(t.revenue) === b.revenue && Math.round(t.adSpend) === b.adSpend
        && t.impressions === b.impressions && t.clicks === b.clicks;
      if (!gelijk && ok) { ok = false; eerste = `${maand}: ${JSON.stringify(t)} tegen ${JSON.stringify(b)}`; }
    }
    check("de som van de tabelrijen per maand is de blended maand (conversies, waarde, kosten, vertoningen, klikken)", ok, eerste);
    check("geen blended maand zonder tabelrij", [...blended.keys()].every((m) => rijen.some((r) => r.month === `${m}-01`)));
  }

  console.log("De kanaaltotalen van de tabel zijn de som van perKanaal");
  {
    // Zoals de tabel ze optelt: alle rijen van een kanaal, over de hele historie.
    for (const reeks of perKanaal) {
      const eigen = rijen.filter((r) => r.channel === channelKeyVanKanaal(reeks.kanaal));
      const tabel = eigen.reduce((s, r) => ({ spend: s.spend + r.spend, clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions, waarde: s.waarde + r.conversion_value }),
        { spend: 0, clicks: 0, conversions: 0, waarde: 0 });
      const bron = reeks.maanden.reduce((s, m) => ({ spend: s.spend + m.adSpend, clicks: s.clicks + (m.clicks ?? 0), conversions: s.conversions + m.conversions, waarde: s.waarde + m.revenue }),
        { spend: 0, clicks: 0, conversions: 0, waarde: 0 });
      check(`${reeks.kanaal}: het kanaaltotaal van de tabel is dat van perKanaal`,
        bijna(tabel.spend, bron.spend) && tabel.clicks === bron.clicks && bijna(tabel.conversions, bron.conversions) && bijna(tabel.waarde, bron.waarde),
        `${JSON.stringify(tabel)} tegen ${JSON.stringify(bron)}`);
    }
  }

  console.log("Een antwoord zonder tellers (van vóór fase 1, stap 3) crasht niet");
  {
    const oud = kanaalMaandRijen([{ kanaal: "google", vanaf: null, maanden: [{ month: "2026-01", conversions: 10, revenue: 0, adSpend: 100 }] }]);
    check("vertoningen en klikken zijn dan nul, de rest staat er", oud.length === 1 && oud[0].impressions === 0 && oud[0].clicks === 0 && oud[0].spend === 100 && oud[0].month === "2026-01-01", JSON.stringify(oud));
    check("geen kanalen: geen rijen", kanaalMaandRijen([]).length === 0);
  }

  // ── De bedrading: het tabblad bouwt zijn rijen zo, en leest de view niet meer ───────────────
  console.log("De bedrading (cross-channel-view.tsx)");
  {
    const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bron = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "..", "components/dashboard/cross-channel-view.tsx"), "utf8"));
    check("de rijen komen uit kanaalMaandRijen(blended.perKanaal)", /kanaalMaandRijen\(blended\.perKanaal\)/.test(bron));
    check("uit de hook die het tabblad al had", /const blended = useBlendedClientData\(clientId, kanalen\.length > 1\)/.test(bron));
    check("geen eigen lezing meer: geen dbSelect, geen blended_account_monthly", !/dbSelect/.test(bron) && !/blended_account_monthly/.test(bron));
    check("de ring krijgt dezelfde rijen als de tabel", /<CampaignTypeSplit clientId=\{clientId\} toon=\{\["kanaal"\]\} kanaalRijen=\{rows\} \/>/.test(bron));
    check("de kolom Valuta is weg (de route draagt geen valuta per kanaal)", !/Valuta/.test(bron) && !/\.currency/.test(bron));
    check("de kolom Conv.waarde staat er nog, uit de waarde van perKanaal", /Conv\.waarde/.test(bron) && /r\.conversion_value/.test(bron));
    // De hook staat uit zolang er geen twee kanalen bekend zijn; de tabel zou dan "nog geen data"
    // zeggen over een klant waarvan de kanalen een tel later binnenkomen.
    check("de tabel staat er alleen bij meer dan één kanaal, zoals de hook", /\{kanalen\.length > 1 && \(\s*<Sectie\s+icoon=\{<Layers/.test(bron));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
