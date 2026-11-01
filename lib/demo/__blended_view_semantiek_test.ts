// De demo-mock van blended_account_monthly moet hetzelfde betekenen als de echte view.
// Draaien: tsx lib/demo/__blended_view_semantiek_test.ts
//
// WAAROM DEZE TEST BESTAAT (stap 0, item F)
//
// De echte view leest sinds migratie 080 uit fact_core, en die projectie (refresh_fact_from_legacy,
// migratie 078) schrijft conversions met de STANDAARDselectie, mét de leads: Meta = conversions +
// leads, LinkedIn = one_click_leads + external_website_conversions, en daarnaast leads =
// one_click_leads. Twee lezers (de cross-channel-KPI's en god-view-data) telden er nog eens
// "+ leads" bij op, uit de tijd van migratie 014, toen leads apart stonden.
//
// De mock had nog die 014-betekenis: LinkedIn conversions = alleen de website-conversies. Daardoor
// zag de demo de dubbeltelling niet die productie wel maakte. Deze test pint de betekenis vast
// tegen de dagrijen van de mock zelf, dus zonder vastgezette getallen die met de klok verschuiven.

import { demoRows } from "./demo-rows";
import { DEFAULT_CHANNEL_CONVERSION_CONFIG, sumSelectedConversions, type ChannelConversionChannel } from "../analysis/channel-conversion-config";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const t = demoRows() as Record<string, Record<string, unknown>[]>;
const view = t.blended_account_monthly ?? [];
const maand = (datum: unknown) => String(datum).slice(0, 7) + "-01";

const KANALEN: { kanaal: ChannelConversionChannel; tabel: string; leads: (r: Record<string, unknown>) => number }[] = [
  { kanaal: "meta_ads", tabel: "meta_account_daily", leads: (r) => Number(r.leads ?? 0) },
  { kanaal: "linkedin_ads", tabel: "linkedin_account_daily", leads: (r) => Number(r.one_click_leads ?? 0) },
];

for (const { kanaal, tabel, leads } of KANALEN) {
  console.log(`${kanaal}: de mock-view tegen de dagrijen van ${tabel}`);
  const dag = t[tabel] ?? [];
  const conv = new Map<string, number>();
  const lds = new Map<string, number>();
  for (const r of dag) {
    const m = maand(r.date);
    conv.set(m, (conv.get(m) ?? 0) + sumSelectedConversions(r, kanaal, DEFAULT_CHANNEL_CONVERSION_CONFIG));
    lds.set(m, (lds.get(m) ?? 0) + leads(r));
  }
  const rijen = view.filter((r) => r.channel === kanaal);
  check(`${kanaal}: er zijn maandrijen, één per maand met dagdata`, rijen.length > 0 && rijen.length === conv.size, `${rijen.length} vs ${conv.size}`);

  const afwijkend = rijen.filter((r) => Math.abs(Number(r.conversions) - (conv.get(String(r.month)) ?? 0)) > 1e-6);
  check(`${kanaal}: conversions = de standaardselectie over de dagrijen, zoals de SQL-projectie`, afwijkend.length === 0,
    afwijkend.slice(0, 2).map((r) => `${r.month}: view ${r.conversions} vs dag ${conv.get(String(r.month))}`).join("; "));

  const leadsAfwijkend = rijen.filter((r) => Math.abs(Number(r.leads) - (lds.get(String(r.month)) ?? 0)) > 1e-6);
  check(`${kanaal}: leads staat er apart naast, zoals in de view`, leadsAfwijkend.length === 0,
    leadsAfwijkend.slice(0, 2).map((r) => `${r.month}: view ${r.leads} vs dag ${lds.get(String(r.month))}`).join("; "));

  // De eigenschap waar de lezers op leunen: de leads zitten IN conversions. Daarom is
  // "conversions + leads" een dubbeltelling en geen optelling van twee soorten acquisitie.
  const leadsErbuiten = rijen.filter((r) => Number(r.leads) > Number(r.conversions) + 1e-6);
  check(`${kanaal}: geen maand heeft meer leads dan conversions`, leadsErbuiten.length === 0,
    leadsErbuiten.slice(0, 2).map((r) => `${r.month}: leads ${r.leads} > conversions ${r.conversions}`).join("; "));
}

// LinkedIn is het kanaal waar het verschil zichtbaar is: lead-formulieren zijn er de hoofdmoot.
// Zonder deze check zou een mock die leads overal op 0 zet de eigenschap hierboven ook halen.
{
  const li = view.filter((r) => r.channel === "linkedin_ads");
  check("linkedin_ads: de mock heeft echt lead-formulieren om dubbel te kunnen tellen", li.some((r) => Number(r.leads) > 0));
}

// Google heeft in de echte view leads 0 (de projectie schrijft daar een vaste 0).
{
  const g = view.filter((r) => r.channel === "google_ads");
  check("google_ads: leads is 0, zoals in de view", g.length > 0 && g.every((r) => Number(r.leads) === 0), `${g.length} rijen`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
