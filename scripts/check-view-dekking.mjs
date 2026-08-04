// Kan een view de tabel vervangen waar hij overheen komt?
//
// Gebruik: node scripts/check-view-dekking.mjs
// Exitcode 0 als elke kandidaat-view kolom voor kolom en rij voor rij gelijk is aan zijn tabel,
// 1 zodra er iets afwijkt. Zonder databasegegevens slaat hij over met exitcode 0.
//
// ── WAAROM DIT BESTAAT ──────────────────────────────────────────────────────
//
// Fase 3 uit docs/ONTWERP_multitenant_schema.md hernoemt de oude tabellen naar `<naam>_legacy` en
// zet er views met de oude naam overheen. Vanaf dat moment lezen alle bestaande grafieken en
// analyses door die views. Een view die één kolom mist of één waarde anders berekent geeft geen
// foutmelding — hij geeft een ander getal, en dat valt pas op als iemand het toevallig naslaat.
//
// Daarom staan de views eerst onder de naam `kandidaat_*` NAAST hun tabel, en vergelijkt dit
// script ze. De hernoeming mag pas als dit script schoon draait. Dat is het verschil tussen een
// migratie en een gok.
//
// ── WAT DIT AL EEN KEER HEEFT GEVANGEN ──────────────────────────────────────
//
// De eerste versie van de views (migratie 046) rekende ctr, conversion_rate en cost_per_conversion
// zelf uit, op grond van de regel "bewaar geen verhouding naast zijn componenten". 682 rijen
// weken af. Uitgesplitst bleek 48,6 % van de brede campagnes (PMax, video, display) te verschillen
// tegen 7,0 % van de smalle — omdat Google `Conv. rate` deelt door INTERACTIES en niet door
// klikken, en interacties slaan wij niet op.
//
// De opgeslagen waarde was dus niet afgedreven; hij had een noemer die wij niet hebben. Zonder
// deze vergelijking was elke PMax-conversieratio er twee tot tien keer te hoog in gaan staan.
// Migratie 047 heeft het rechtgezet.
//
// ── WAT ER BEWUST NIET VERGELEKEN WORDT ─────────────────────────────────────
//
// Per paar staat een `negeer`-lijst met een reden per kolom. Die lijst hoort kort te blijven: elke
// regel erbij is een stuk dat niet meer bewaakt wordt.

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";

{
  try { readFileSync(".env.local", "utf8"); } catch { /* geen bestand: dan de omgeving zelf */ }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !token) {
    console.log("view-dekking: overgeslagen (geen SUPABASE_ACCESS_TOKEN of project-URL).");
    process.exit(0);
  }
}

// `verouderd` is geen uitzondering maar een MEETPUNT: een kolom waarvan bewezen is dat de tabel
// hem zelf niet meer klopt. De uitdrukking telt de rijen waar de opgeslagen waarde niet overeenkomt
// met zijn eigen invoerkolommen. Die telling hoort te dalen als de sync draait, en zeker niet te
// groeien; daarom staat hij in het rapport in plaats van in stilte in een negeer-lijst.
const PAREN = [
  {
    tabel: "ads_account_monthly",
    view: "kandidaat_ads_account_monthly",
    negeer: {
      id: "synthetische primaire sleutel van de oude tabel; geen enkele lezer selecteert hem",
      created_at: "wanneer de RIJ is weggeschreven, niet wanneer de data geldt; de view geeft synced_at",
      roas: "de tabel klopt hier niet met zijn eigen kolommen; zie `verouderd` hieronder",
    },
    verouderd: {
      roas: "cost > 0 and roas <> round((conversions_value/cost)::numeric, 4)",
    },
  },
  {
    tabel: "ads_campaign_monthly",
    view: "kandidaat_ads_campaign_monthly",
    negeer: {
      id: "idem",
      created_at: "idem",
      roas: "idem",
    },
    verouderd: {
      roas: "cost > 0 and roas <> round((conversions_value/cost)::numeric, 4)",
    },
  },
  ...["account", "campaign", "ad"].map((n) => ({
    tabel: `meta_${n}_daily`,
    view: `kandidaat_meta_${n}_daily`,
    negeer: {
      created_at: "wanneer de RIJ is weggeschreven, niet wanneer de data geldt",
      updated_at: "idem",
      clicks_all: "leeg in de bron, 0 in fact_core; zie `nul_vs_leeg` hieronder",
    },
    nulVsLeeg: ["clicks_all"],
  })),
  ...["account", "campaign", "creative"].map((n) => ({
    tabel: `linkedin_${n}_daily`,
    view: `kandidaat_linkedin_${n}_daily`,
    negeer: {
      created_at: "idem",
      updated_at: "idem",
      ...(n === "creative" ? { conversion_value: "idem, zie `nul_vs_leeg`" } : {}),
    },
    nulVsLeeg: n === "creative" ? ["conversion_value"] : [],
  })),
];

// ── WAT nulVsLeeg IS, EN WAAROM HET GEEN NEGEER-LIJST IS ────────────────────
//
// fact_core declareert zijn vijf grootheden als `not null default 0` en migratie 036 vulde ze met
// coalesce(bron, 0). Waar de bron NULL had staat nu een nul, en die twee zijn daarna niet meer uit
// elkaar te houden. Dat raakt precies deze kolommen:
//
//   meta_*_daily.clicks_all              160 + 128 + 256 rijen, alle leeg in de bron
//   linkedin_creative_daily.conversion_value    92 rijen, alle leeg in de bron
//
// De informatie is weg uit fact_core, dus de view KAN de NULL niet teruggeven. Daarom staat het
// hier als vastgestelde eigenschap in plaats van als iets wat nog te repareren valt.
//
// Maar niet als vrijbrief. De controle hieronder eist dat het verschil PRECIES dit is: de tabel
// leeg én de view nul. Staat er in de tabel een getal waar de view iets anders zegt, dan is dat een
// fout en geen bekende beperking. Zonder die eis zou "clicks_all overslaan" betekenen dat er
// helemaal niet meer naar clicks_all gekeken wordt, en dan dekt de uitzondering de volgende fout af.
//
// Voor de app maakt het vandaag niets uit: sum() slaat NULL over en telt 0 als niets, en de lezers
// schrijven `Number(x ?? 0)`. Voor avg() maakt het wél uit — NULL telt niet mee in de noemer, 0 wel.
// Zolang deze kolommen in de bron volledig leeg zijn is er geen gemiddelde om te vertekenen; wordt
// er ooit echt gesynct, dan vult de bron ze en verdwijnt het verschil vanzelf.

// ── WAAROM roas ANDERS LIGT DAN conversion_rate ─────────────────────────────
//
// Allebei zijn het verhoudingen die de tabel opslaat en die van de view afwijken, maar de reden
// verschilt, en die reden bepaalt wat er moet gebeuren. Het onderscheid is niet "afgeleid of
// niet" maar: kunnen wij hem uit onze eigen kolommen terugrekenen?
//
//   conversion_rate   NEE. Google deelt door interacties en die slaan wij niet op. De opgeslagen
//                     waarde is de enige die we hebben, dus de view DRAAGT hem (migratie 047).
//
//   roas              JA. De sync rekent hem zelf uit, uit cost en conversions_value die allebei
//                     in dezelfde rij staan: `cost > 0 ? (value/cost).toFixed(4) : 0`.
//
// En juist omdat roas reproduceerbaar is, is aantoonbaar dat de tabel hem fout heeft. Op 1049 van
// 4707 campagnerijen en 58 van 775 accountrijen komt de opgeslagen roas niet uit op zijn eigen
// cost en conversions_value. Nagerekend op één rij: opgeslagen 21,8437 hoort bij een waarde van
// 313,02 terwijl er nu 313,01 staat.
//
// Dat is de afdrijving uit §1.4 van het ontwerp, en nu met de oorzaak erbij: Google kent conversies
// toe aan de KLIKDATUM, dus conversions_value van een afgesloten maand verandert nog maanden na
// dato. De losse roas-kolom is een momentopname van een waarde die daarna is bijgesteld.
//
// De view rekent met de huidige cijfers en heeft dus gelijk waar de tabel dat niet heeft. Exacte
// gelijkheid eisen zou betekenen dat de view de fout moet nabouwen.

/** Kolomnamen van een relatie, in volgorde. Werkt voor zowel tabellen als views. */
async function kolommen(naam) {
  const r = await sql(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = '${naam}' order by ordinal_position`);
  return r.map((c) => c.column_name);
}

let fouten = 0;

for (const paar of PAREN) {
  console.log(`\n${paar.tabel}  ←  ${paar.view}`);

  const inTabel = await kolommen(paar.tabel);
  const inView = await kolommen(paar.view);

  if (inTabel.length === 0 || inView.length === 0) {
    console.log(`  FOUT  ${inTabel.length === 0 ? paar.tabel : paar.view} bestaat niet`);
    fouten++;
    continue;
  }

  // Een kolom die de tabel wel heeft en de view niet, breekt elke lezer die hem opvraagt --
  // inclusief select("*"), waar het verschil pas zichtbaar wordt als een veld undefined blijkt.
  const ontbreekt = inTabel.filter((c) => !inView.includes(c));
  const extra = inView.filter((c) => !inTabel.includes(c));

  if (ontbreekt.length > 0) {
    console.log(`  FOUT  de view mist ${ontbreekt.length} kolom(men): ${ontbreekt.join(", ")}`);
    fouten++;
  }
  if (extra.length > 0) {
    // Geen fout: een view mag meer geven dan de tabel had. Wel het vermelden waard, want het is
    // meestal een typefout in een alias.
    console.log(`  let op  de view heeft ${extra.length} kolom(men) extra: ${extra.join(", ")}`);
  }

  const teVergelijken = inTabel.filter((c) => inView.includes(c) && !(c in paar.negeer));
  const overgeslagen = inTabel.filter((c) => c in paar.negeer);

  // `except all` vergelijkt hele rijen inclusief duplicaten, in beide richtingen. Dat vangt een
  // ontbrekende rij, een rij te veel en een afwijkende waarde in één keer -- en het maakt geen
  // onderscheid naar type, dus er is geen kolom waar de vergelijking stilletjes langs kan lopen.
  const lijst = teVergelijken.join(", ");
  const [{ rijen_tabel, rijen_view, tabel_niet_in_view, view_niet_in_tabel }] = await sql(`
    select
      (select count(*) from ${paar.tabel}) as rijen_tabel,
      (select count(*) from ${paar.view})  as rijen_view,
      (select count(*) from ((select ${lijst} from ${paar.tabel})
                       except all (select ${lijst} from ${paar.view})) x) as tabel_niet_in_view,
      (select count(*) from ((select ${lijst} from ${paar.view})
                       except all (select ${lijst} from ${paar.tabel})) y) as view_niet_in_tabel`);

  const gelijk = Number(tabel_niet_in_view) === 0 && Number(view_niet_in_tabel) === 0;
  console.log(`  ${rijen_tabel} rijen in de tabel, ${rijen_view} in de view`);
  console.log(`  ${teVergelijken.length} kolommen vergeleken, ${overgeslagen.length} overgeslagen`);
  for (const c of overgeslagen) console.log(`      ${c.padEnd(14)}${paar.negeer[c]}`);

  if (gelijk) {
    console.log("  OK  elke rij komt in beide voor, met dezelfde waarden.");
  } else {
    console.log(`  FOUT  ${tabel_niet_in_view} rij(en) alleen in de tabel, ${view_niet_in_tabel} alleen in de view`);
    fouten++;
  }

  // De kolommen die overgeslagen zijn omdat de TABEL ze niet meer kloppend heeft. Twee dingen
  // worden hier vastgesteld: hoeveel rijen dat betreft, en dat de view wel klopt. Dat tweede is
  // wat de uitzondering verdedigbaar maakt -- zonder die controle zou "roas negeren" betekenen dat
  // niemand meer naar roas kijkt.
  // De kolommen die fact_core niet als "onbekend" kan bewaren. Eis: de tabel is er leeg EN de view
  // geeft nul. Elke andere combinatie is een echte afwijking en geen bekende beperking.
  for (const kolom of paar.nulVsLeeg ?? []) {
    const [{ leeg_in_bron, anders }] = await sql(`
      select
        (select count(*) from ${paar.tabel} where "${kolom}" is null) as leeg_in_bron,
        (select count(*) from ${paar.tabel} t where t."${kolom}" is not null) as anders`);
    const [{ view_niet_nul }] = await sql(`
      select count(*) as view_niet_nul from ${paar.view} where coalesce("${kolom}", 0) <> 0`);
    console.log(`  ${kolom}: ${leeg_in_bron} leeg in de bron → 0 in de view`);
    if (Number(anders) > 0 || Number(view_niet_nul) > 0) {
      console.log(`  FOUT  ${kolom} is niet louter leeg-tegen-nul: ${anders} gevuld in de tabel, ${view_niet_nul} niet-nul in de view`);
      fouten++;
    }
  }

  for (const [kolom, uitdrukking] of Object.entries(paar.verouderd ?? {})) {
    const [{ scheef, view_fout }] = await sql(`
      select
        (select count(*) from ${paar.tabel} where ${uitdrukking}) as scheef,
        (select count(*) from ${paar.view}
          where coalesce(${kolom}, -1) <> coalesce(case when cost > 0
                then round((conversions_value / cost)::numeric, 4) else 0 end, -1)) as view_fout`);
    console.log(`  ${kolom}: ${scheef} rij(en) in de tabel kloppen niet met hun eigen kolommen`);
    if (Number(view_fout) > 0) {
      console.log(`  FOUT  de view heeft ${kolom} op ${view_fout} rij(en) ook verkeerd`);
      fouten++;
    }
  }
}

if (fouten === 0) {
  console.log("\n  OK  elke kandidaat-view dekt zijn tabel volledig.");
  process.exit(0);
}
console.log(`
  ${fouten} paar(en) wijken af. De hernoeming uit fase 3 mag NIET gedraaid worden zolang dit
  rood staat: de app zou dan door een view lezen die iets anders zegt dan de tabel eronder.

  Herstellen: pas de view aan in een nieuwe migratie (niet de oude bewerken, die is al gedraaid)
  en draai deze controle opnieuw.`);
process.exit(1);
