/**
 * Waar de sync zijn feitenrijen NEERZET.
 *
 * Eén plek, en dat is het hele punt. Fase 3 uit docs/ONTWERP_multitenant_schema.md hernoemt acht
 * tabellen naar `<naam>_legacy` en zet views met de oude naam erover. Vanaf dat moment lezen alle
 * grafieken door die views, en dat werkt — maar een view is niet schrijfbaar. Een sync die
 * `.from("ads_campaign_monthly").upsert(...)` doet, schrijft dan naar de view en krijgt
 * `cannot insert into view`.
 *
 * De namen stonden verspreid over vijf bestanden als losse tekst. Zolang dat zo is, is de
 * hernoeming een zoek-en-vervang waarbij één vergeten plek de nachtelijke sync stilletjes laat
 * falen — stilletjes, want de sync vangt fouten per dataset af en gaat door met de volgende.
 *
 * Nu staan ze hier. De hernoeming is dan acht regels in dit bestand, en de test ernaast bewaakt
 * dat er geen negende plek terugsluipt.
 *
 * ── DE WAARDEN WIJZEN NU NAAR `*_legacy` ─────────────────────────────────────
 *
 * Migratie 054 heeft de acht tabellen hernoemd en er views onder de oude naam overheen gezet.
 * Lezers komen daardoor op de view uit; schrijvers moeten om die view heen, want een view is niet
 * schrijfbaar. Dat is precies waarvoor deze module is gemaakt: de omzetting was acht regels hier,
 * en de test ernaast bewees dat er geen negende plek was blijven staan.
 *
 * ── WAT HIER NIET IN STAAT ───────────────────────────────────────────────────
 *
 * Alleen de acht tabellen die een kandidaat-view hebben. `meta_adset_daily` en de dimensietabellen
 * niet: die krijgen (nog) geen view, dus daar verandert de schrijfbestemming niet. Een naam hier
 * neerzetten die nergens hernoemd wordt suggereert een verband dat er niet is.
 */

export const FEITENTABELLEN = {
  ads_account_monthly: "ads_account_monthly_legacy",
  ads_campaign_monthly: "ads_campaign_monthly_legacy",
  meta_account_daily: "meta_account_daily_legacy",
  meta_campaign_daily: "meta_campaign_daily_legacy",
  meta_ad_daily: "meta_ad_daily_legacy",
  linkedin_account_daily: "linkedin_account_daily_legacy",
  linkedin_campaign_daily: "linkedin_campaign_daily_legacy",
  linkedin_creative_daily: "linkedin_creative_daily_legacy",
} as const;

export type Feitentabel = keyof typeof FEITENTABELLEN;

/**
 * De fysieke tabel om naar te schrijven.
 *
 * Lezen gaat NIET via deze functie: lezers gebruiken de oude naam en komen na fase 3 op de view
 * uit. Dat verschil is de kern van de opzet — als lezen en schrijven allebei hierlangs zouden
 * lopen, zou de view nooit gebruikt worden en had de hele fase geen zin.
 */
export function schrijftabel(naam: Feitentabel): string {
  return FEITENTABELLEN[naam];
}

/**
 * Vertaalt een tabelnaam naar de fysieke schrijfbestemming, of laat hem staan.
 *
 * Voor plekken die met een LIJST van tabelnamen werken en niet met losse aanroepen: de demo-seeder
 * en -teardown lopen een record van tabel → rijen af. Die zouden na migratie 054 naar de views
 * schrijven en `cannot insert into view` krijgen -- en de seeder logt fouten per tabel en gaat
 * door, dus dat zou een half gevulde demoklant opleveren zonder dat iets faalt.
 */
export function fysiekeTabel(naam: string): string {
  return (FEITENTABELLEN as Record<string, string>)[naam] ?? naam;
}
