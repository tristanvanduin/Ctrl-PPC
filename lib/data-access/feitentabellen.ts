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
 * ── DE WAARDEN ZIJN NU NOG GELIJK AAN DE SLEUTELS ────────────────────────────
 *
 * Dat is geen overbodige laag maar de volgorde van een expand/contract-migratie: eerst het
 * aangrijppunt maken en bewijzen dat alles er doorheen loopt, dan pas omzetten. Andersom zou de
 * omzetting en de invoering van de indirectie in één stap zitten, en dan is bij een storing niet
 * te zien welke van de twee het deed.
 *
 * ── WAT HIER NIET IN STAAT ───────────────────────────────────────────────────
 *
 * Alleen de acht tabellen die een kandidaat-view hebben. `meta_adset_daily` en de dimensietabellen
 * niet: die krijgen (nog) geen view, dus daar verandert de schrijfbestemming niet. Een naam hier
 * neerzetten die nergens hernoemd wordt suggereert een verband dat er niet is.
 */

export const FEITENTABELLEN = {
  ads_account_monthly: "ads_account_monthly",
  ads_campaign_monthly: "ads_campaign_monthly",
  meta_account_daily: "meta_account_daily",
  meta_campaign_daily: "meta_campaign_daily",
  meta_ad_daily: "meta_ad_daily",
  linkedin_account_daily: "linkedin_account_daily",
  linkedin_campaign_daily: "linkedin_campaign_daily",
  linkedin_creative_daily: "linkedin_creative_daily",
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
