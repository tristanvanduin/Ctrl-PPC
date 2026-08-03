// Vergelijkt fact_core met de tabellen waaruit hij is gevuld.
//
// Gebruik: node scripts/verify-fact-core.mjs
// Exitcode 0 als alles klopt, 1 als er ook maar één som afwijkt.
//
// WAAROM DIT EEN SCRIPT IS EN GEEN EENMALIGE QUERY
//
// Dit is de poort tussen fase 2 en fase 3 uit docs/ONTWERP_multitenant_schema.md. Fase 3 hernoemt
// bestaande tabellen en zet er views overheen; dat mag pas als aantoonbaar is dat de nieuwe
// tabel dezelfde getallen bevat als de oude. "Ik heb het nagekeken" is daarvoor niet genoeg —
// het moet herhaalbaar zijn, want de sync blijft ondertussen draaien en elke nieuwe rij kan het
// beeld veranderen.
//
// WAT ER VERGELEKEN WORDT
//
// Per kanaal en niveau de som van de vijf kanonieke grootheden, uit de brontabel en uit
// fact_core. Niet per rij: een rij-voor-rij-diff zou struikelen over rijen die de sync tussen de
// twee queries door toevoegt, terwijl een som over een afgesloten periode stabiel is.
//
// De conversietelling voor Meta en LinkedIn volgt dezelfde standaard als de backfill (zie
// migratie 036). Wijkt een klant daarvan af via client_settings.channel_conversion_config, dan
// hoort deze controle dat te melden in plaats van stil te falen — vandaar de expliciete check
// onderaan.
//
// FILTEREN OP KORREL IS VERPLICHT, en dat is deze controle zelf komen aanwijzen. Sinds migratie
// 037 staan week- en maandrijen als AFGELEIDE naast de dagrijen in dezelfde tabel. Zonder
// `grain`-filter telt een som dag plus week plus maand bij elkaar op en komt er precies drie keer
// de bronwaarde uit. Het script meldde dat als veertien afwijkingen — terecht, maar de fout zat
// in het script en niet in de data.
//
// De korrel per bron is de korrel waarin de sync die tabel LEVERT: maand voor Google, dag voor
// Meta en LinkedIn. De afgeleide rijen worden apart gecontroleerd (zie de rollup-check onderaan).

import { sql } from "./supabase-sql.mjs";

const BRONNEN = [
  {
    naam: "google / account",
    kanaal: "google", niveau: "account", korrel: "month",
    bron: `select sum(impressions) i, sum(clicks) c, sum(cost) k,
                  sum(conversions) v, sum(conversions_value) w
           from ads_account_monthly s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "google / campaign",
    kanaal: "google", niveau: "campaign", korrel: "month",
    bron: `select sum(impressions) i, sum(clicks) c, sum(cost) k,
                  sum(conversions) v, sum(conversions_value) w
           from ads_campaign_monthly s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "meta / account",
    kanaal: "meta", niveau: "account", korrel: "day",
    bron: `select sum(impressions) i, sum(clicks_all) c, sum(spend) k,
                  sum(coalesce(conversions,0) + coalesce(leads,0)) v, sum(conversion_value) w
           from meta_account_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "meta / campaign",
    kanaal: "meta", niveau: "campaign", korrel: "day",
    bron: `select sum(impressions) i, sum(clicks_all) c, sum(spend) k,
                  sum(coalesce(conversions,0) + coalesce(leads,0)) v, sum(conversion_value) w
           from meta_campaign_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "linkedin / account",
    kanaal: "linkedin", niveau: "account", korrel: "day",
    bron: `select sum(impressions) i, sum(clicks) c, sum(spend) k,
                  sum(coalesce(one_click_leads,0) + coalesce(external_website_conversions,0)) v,
                  sum(conversion_value) w
           from linkedin_account_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "linkedin / campaign",
    kanaal: "linkedin", niveau: "campaign", korrel: "day",
    bron: `select sum(impressions) i, sum(clicks) c, sum(spend) k,
                  sum(coalesce(one_click_leads,0) + coalesce(external_website_conversions,0)) v,
                  sum(conversion_value) w
           from linkedin_campaign_daily s join accounts a on a.client_id = s.client_id`,
  },
];

const VELDEN = [
  ["i", "impressies"],
  ["c", "klikken"],
  ["k", "kosten"],
  ["v", "conversies"],
  ["w", "waarde"],
];

// Kosten en conversies zijn numeric; een verschil onder een cent is afronding en geen fout.
const MARGE = 0.01;

function getal(v) {
  return v == null ? 0 : Number(v);
}

let gefaald = 0;
let gecontroleerd = 0;

console.log("fact_core vergeleken met de brontabellen\n");

for (const b of BRONNEN) {
  const [bron] = await sql(b.bron);
  const [nieuw] = await sql(
    `select sum(impressions) i, sum(clicks) c, sum(cost) k,
            sum(conversions) v, sum(conv_value) w
     from fact_core where channel = '${b.kanaal}' and level = '${b.niveau}' and grain = '${b.korrel}'`,
  );

  const afwijkingen = [];
  for (const [sleutel, label] of VELDEN) {
    const o = getal(bron[sleutel]);
    const n = getal(nieuw[sleutel]);
    gecontroleerd++;
    if (Math.abs(o - n) > MARGE) afwijkingen.push(`${label}: bron ${o} vs fact_core ${n}`);
  }

  if (afwijkingen.length === 0) {
    console.log(`  OK    ${b.naam}`);
  } else {
    gefaald += afwijkingen.length;
    console.log(`  FOUT  ${b.naam}`);
    for (const a of afwijkingen) console.log(`          ${a}`);
  }
}

// De conversie-selectie is per klant instelbaar. Wijkt iemand af van de standaard, dan klopt de
// backfill van migratie 036 niet meer voor die klant — en dat mag niet stil gebeuren.
const [{ afwijkend }] = await sql(
  `select count(*) as afwijkend from client_settings where channel_conversion_config is not null`,
);
if (Number(afwijkend) > 0) {
  gefaald++;
  console.log(
    `\n  FOUT  ${afwijkend} klant(en) hebben een eigen conversie-selectie. De backfill past de\n` +
      `        standaard toe, dus fact_core.conversions klopt voor hen niet. Zie migratie 036.`,
  );
}

// De afgeleide rijen moeten optellen tot hun eigen dagen. Kunnen ze niet afwijken? In theorie
// niet, want ze worden berekend — maar precies dat werd van de opgeslagen ctr en conversion_rate
// ook gedacht, en daar staan 552 rijen die het tegendeel bewijzen. Dus meten.
const [rollup] = await sql(`
  with dag as (
    select account_id, channel, level, entity_id, date_trunc('month', period_start)::date m,
           sum(impressions) i, sum(clicks) c, sum(cost) k, sum(conversions) v
    from fact_core where grain = 'day' group by 1,2,3,4,5
  )
  select count(*) as vergeleken,
         count(*) filter (where abs(d.i - f.impressions) > 0 or abs(d.c - f.clicks) > 0
                            or abs(d.k - f.cost) > 0.005 or abs(d.v - f.conversions) > 0.005) as afwijkend
  from dag d join fact_core f
    on f.account_id = d.account_id and f.channel = d.channel and f.level = d.level
   and f.entity_id = d.entity_id and f.grain = 'month' and f.period_start = d.m`);
gecontroleerd += Number(rollup.vergeleken);
if (Number(rollup.afwijkend) > 0) {
  gefaald += Number(rollup.afwijkend);
  console.log(`  FOUT  ${rollup.afwijkend} maandrij(en) tellen niet op tot hun eigen dagen`);
} else {
  console.log(`  OK    rollups (${rollup.vergeleken} maandrijen tellen op tot hun dagen)`);
}

// Wezen: een kanaalmetriek zonder rij in fact_core.
//
// Dit is de controle die ontbrak toen het misging. De metriektabellen dragen geen impressies,
// klikken of kosten — die staan alleen in fact_core. Een creative-metriek zonder kern-rij is
// daarom onbruikbaar: je weet dan de hook_rate maar niet waarvan.
//
// Migratie 036 vulde fact_core op account- en campagneniveau, 041 vulde de metriektabellen op
// alle drie de niveaus, en niemand merkte dat er 348 creative-rijen zonder tegenhanger stonden.
// Rijaantallen klopten, sommen klopten, en toch was de join leeg. Alleen die join liet het zien —
// dus die staat nu hier.
for (const [tabel, kanaal] of [["meta_metrics", "meta"], ["linkedin_metrics", "linkedin"]]) {
  const [{ wezen }] = await sql(`
    select count(*) as wezen from ${tabel} m
    where not exists (
      select 1 from fact_core f
      where f.account_id = m.account_id and f.channel = '${kanaal}'
        and f.level = m.level and f.entity_id = m.entity_id
        and f.grain = m.grain and f.period_start = m.period_start)`);
  gecontroleerd++;
  if (Number(wezen) > 0) {
    gefaald++;
    console.log(`  FOUT  ${tabel}: ${wezen} rij(en) zonder tegenhanger in fact_core`);
  } else {
    console.log(`  OK    ${tabel} heeft geen wezen`);
  }
}

console.log(`\n${gecontroleerd} sommen vergeleken, ${gefaald} afwijking(en).`);
if (gefaald > 0) {
  console.log("\nFase 3 mag NIET door zolang hier iets rood staat.");
  process.exit(1);
}
console.log("fact_core komt overeen met de bron.");
