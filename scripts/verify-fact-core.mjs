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

import { sql } from "./supabase-sql.mjs";

const BRONNEN = [
  {
    naam: "google / account",
    kanaal: "google", niveau: "account",
    bron: `select sum(impressions) i, sum(clicks) c, sum(cost) k,
                  sum(conversions) v, sum(conversions_value) w
           from ads_account_monthly s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "google / campaign",
    kanaal: "google", niveau: "campaign",
    bron: `select sum(impressions) i, sum(clicks) c, sum(cost) k,
                  sum(conversions) v, sum(conversions_value) w
           from ads_campaign_monthly s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "meta / account",
    kanaal: "meta", niveau: "account",
    bron: `select sum(impressions) i, sum(clicks_all) c, sum(spend) k,
                  sum(coalesce(conversions,0) + coalesce(leads,0)) v, sum(conversion_value) w
           from meta_account_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "meta / campaign",
    kanaal: "meta", niveau: "campaign",
    bron: `select sum(impressions) i, sum(clicks_all) c, sum(spend) k,
                  sum(coalesce(conversions,0) + coalesce(leads,0)) v, sum(conversion_value) w
           from meta_campaign_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "linkedin / account",
    kanaal: "linkedin", niveau: "account",
    bron: `select sum(impressions) i, sum(clicks) c, sum(spend) k,
                  sum(coalesce(one_click_leads,0) + coalesce(external_website_conversions,0)) v,
                  sum(conversion_value) w
           from linkedin_account_daily s join accounts a on a.client_id = s.client_id`,
  },
  {
    naam: "linkedin / campaign",
    kanaal: "linkedin", niveau: "campaign",
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
     from fact_core where channel = '${b.kanaal}' and level = '${b.niveau}'`,
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

console.log(`\n${gecontroleerd} sommen vergeleken, ${gefaald} afwijking(en).`);
if (gefaald > 0) {
  console.log("\nFase 3 mag NIET door zolang hier iets rood staat.");
  process.exit(1);
}
console.log("fact_core komt overeen met de bron.");
