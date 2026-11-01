// Campagnes per kanaal (components/dashboard/campaigns-per-channel.tsx) telt met de selectie van de
// klant, net als de rest van het dashboard.
// Draaien: tsx lib/demo/__campagnes_per_kanaal_test.ts
//
// WAT ER MISGING (stap 0, item F)
//
// De tabel had een eigen, vaste selectie: Meta telde alleen "conversions", LinkedIn alleen
// one_click_leads, en de query haalde ook alleen die kolommen op. Het kanaaltabblad, de KPI-band en
// het Jaaroverzicht tellen dezelfde campagnes via sumSelectedConversions met wat de klant in
// Instellingen koos; standaard is dat bij LinkedIn lead-formulieren PLUS website-conversies. Een
// opgeslagen keuze kon de tabel bovendien nooit volgen: een veld dat niet in de select staat, telt
// als nul.

import { readFileSync } from "node:fs";
import * as cpc from "../../components/dashboard/campaigns-per-channel";
import { demoRows } from "./demo-rows";
import {
  conversionSourcesFor, resolveChannelConversionConfig, sumSelectedConversions,
  type ChannelConversionChannel, type ChannelConversionConfig,
} from "../analysis/channel-conversion-config";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const dicht = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;

// Namespace-import: op de oude code bestaan deze exports niet; dan per geval falen in plaats van
// op de import.
type Agg = { name: string; spend: number; conversions: number };
const { campagnesUitDagen, campagneDagSelect, CAMPAGNE_DAGBRON } = cpc as unknown as {
  campagnesUitDagen?: (namen: Array<Record<string, unknown>>, dagen: Array<Record<string, unknown>>, channel: ChannelConversionChannel, convConfig: ChannelConversionConfig) => Agg[];
  campagneDagSelect?: (channel: ChannelConversionChannel) => string;
  CAMPAGNE_DAGBRON?: Record<ChannelConversionChannel, { tabel: string; entiteit: string; namen: string; id: string }>;
};
const KANALEN: ChannelConversionChannel[] = ["meta_ads", "linkedin_ads", "microsoft_ads"];

check("campagnesUitDagen bestaat", typeof campagnesUitDagen === "function");
check("campagneDagSelect bestaat", typeof campagneDagSelect === "function");
check("CAMPAGNE_DAGBRON bestaat", CAMPAGNE_DAGBRON !== undefined);

console.log("De query haalt alle selecteerbare velden op, en die bestaan");
if (typeof campagneDagSelect === "function" && CAMPAGNE_DAGBRON) {
  // dbSelect valt buiten scripts/check-datagrond.mjs; een kolom die niet bestaat is in productie
  // een fout die als "geen campagnes" leest. Daarom hier tegen dezelfde schemafoto.
  const schema = JSON.parse(readFileSync(new URL("../../scripts/schema-snapshot.json", import.meta.url), "utf8")) as Record<string, string[]>;
  for (const ch of KANALEN) {
    const { tabel, entiteit, namen, id } = CAMPAGNE_DAGBRON[ch];
    const kolommen = campagneDagSelect(ch).split(",").map((k) => k.trim());
    for (const s of conversionSourcesFor(ch)) check(`${ch}: de select bevat ${s.field}`, kolommen.includes(s.field), campagneDagSelect(ch));
    check(`${ch}: de select bevat ${entiteit} en spend`, kolommen.includes(entiteit) && kolommen.includes("spend"));
    check(`${ch}: tabel ${tabel} staat in de schemafoto`, Array.isArray(schema[tabel]));
    for (const k of [...kolommen, "date", "client_id"]) check(`${ch}: kolom ${k} bestaat in ${tabel}`, (schema[tabel] ?? []).includes(k));
    for (const k of [id, "name", "client_id"]) check(`${ch}: kolom ${k} bestaat in ${namen}`, (schema[namen] ?? []).includes(k));
  }
}

console.log("\nOp de demo-rijen: de tabel telt wat de selectie zegt");
if (typeof campagnesUitDagen === "function") {
  const t = demoRows() as Record<string, Record<string, unknown>[]>;
  const som = (rows: Agg[]) => rows.reduce((s, r) => s + r.conversions, 0);
  const veld = (rows: Record<string, unknown>[], f: string) => rows.reduce((s, r) => s + Number(r[f] ?? 0), 0);
  const standaard = resolveChannelConversionConfig(null);

  // LinkedIn: het kanaal waar het zichtbaar was.
  const liDag = t.linkedin_campaign_daily ?? [];
  const liNamen = t.linkedin_campaigns ?? [];
  const ocl = veld(liDag, "one_click_leads");
  const ewc = veld(liDag, "external_website_conversions");
  check("demo: LinkedIn heeft lead-formulieren én website-conversies", ocl > 0 && ewc > 0, `${ocl} / ${ewc}`);
  const li = campagnesUitDagen(liNamen, liDag, "linkedin_ads", standaard);
  check("LinkedIn zonder opgeslagen keuze: lead-formulieren + website-conversies (niet alleen de formulieren)",
    dicht(som(li), ocl + ewc), `${som(li)} vs ${ocl} + ${ewc}; de oude tabel telde ${ocl}`);
  check("LinkedIn: hetzelfde als sumSelectedConversions over dezelfde dagrijen",
    dicht(som(li), liDag.reduce((s, r) => s + sumSelectedConversions(r, "linkedin_ads", standaard), 0)));
  const alleenFormulieren = campagnesUitDagen(liNamen, liDag, "linkedin_ads", resolveChannelConversionConfig({ linkedin_ads: ["one_click_leads"] }));
  check("LinkedIn met opgeslagen keuze [lead-formulieren]: alleen die", dicht(som(alleenFormulieren), ocl), `${som(alleenFormulieren)} vs ${ocl}`);
  const namen = new Set(liNamen.map((c) => String(c.name)));
  check("LinkedIn: campagnes komen op hun naam door, niet op hun urn", li.length > 0 && li.every((c) => namen.has(c.name)), li.map((c) => c.name).join(", "));
  check("LinkedIn: spend telt op, los van de selectie", dicht(li.reduce((s, c) => s + c.spend, 0), veld(liDag, "spend")));

  // Meta: de standaard is aankopen + leads; een keuze voor alleen leads telt alleen leads.
  const mDag = (t.meta_campaign_daily ?? []).map((r, i) => ({ ...r, leads: i % 4 })); // demo-leads zijn 0
  const mNamen = t.meta_campaigns ?? [];
  const m = campagnesUitDagen(mNamen, mDag, "meta_ads", standaard);
  check("Meta zonder opgeslagen keuze: aankopen + leads", dicht(som(m), veld(mDag, "conversions") + veld(mDag, "leads")), `${som(m)}`);
  const mLeads = campagnesUitDagen(mNamen, mDag, "meta_ads", resolveChannelConversionConfig({ meta_ads: ["leads"] }));
  check("Meta met opgeslagen keuze [leads]: alleen leads", dicht(som(mLeads), veld(mDag, "leads")), `${som(mLeads)} vs ${veld(mDag, "leads")}`);

  // Microsoft: één veld, dezelfde route.
  const msDag = t.microsoft_campaign_daily ?? [];
  const ms = campagnesUitDagen(t.microsoft_campaigns ?? [], msDag, "microsoft_ads", standaard);
  check("Microsoft: de conversiekolom", msDag.length > 0 && dicht(som(ms), veld(msDag, "conversions")), `${som(ms)}`);

  // Een entiteit zonder naamrij blijft zichtbaar onder zijn id, zoals voorheen.
  const wees = campagnesUitDagen([], [{ entity_urn: "urn:li:x", spend: 5, one_click_leads: 1, external_website_conversions: 2 }], "linkedin_ads", standaard);
  check("zonder naamrij: de urn als naam", wees.length === 1 && wees[0].name === "urn:li:x" && wees[0].conversions === 3, JSON.stringify(wees));
}

console.log("\nDe component laadt de selectie van de klant en heeft geen eigen selectie meer");
{
  const bron = readFileSync(new URL("../../components/dashboard/campaigns-per-channel.tsx", import.meta.url), "utf8");
  check("client_settings.channel_conversion_config wordt geladen", /dbSelectOne<[^>]*>\(\s*"client_settings",\s*\{\s*select:\s*"channel_conversion_config"/.test(bron));
  check("en in dezelfde Promise.all als de campagnerijen", /Promise\.all\(\[[\s\S]*kanaal\("linkedin_ads"\)[\s\S]*"client_settings"[\s\S]*\]\)/.test(bron));
  check("geen vaste LinkedIn-telling op one_click_leads", !/num\(r\.one_click_leads\)/.test(bron) && !/"entity_urn, spend, one_click_leads"/.test(bron));
  check("geen vaste Meta-telling op conversions", !/"entity_id, spend, conversions"/.test(bron));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
