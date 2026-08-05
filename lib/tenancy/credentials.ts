import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { leesKoppeling, leesRefreshToken } from "./koppelingen";
import { klantVanId } from "./klanten";

// ============================================================================
// DE GOOGLE ADS-CREDENTIALS: DEELS VAN HET PRODUCT, DEELS VAN HET BUREAU
// ============================================================================
//
// Er bestaan drie dingen die vaak op één hoop gaan, en het verschil bepaalt waar ze horen:
//
//   developer token          van het PRODUCT, één stuk, draagt de API-quota   → omgeving
//   OAuth client id/secret   van het PRODUCT, één stuk                        → omgeving
//   refresh token            van het BUREAU, uit zijn eigen toestemming       → agency_connections
//   manager customer id      van het BUREAU, zijn eigen MCC                   → agency_connections
//
// Van de vijf omgevingsvariabelen blijven er dus drie staan en verhuizen er twee. Dat is het
// verschil tussen "één sleutel van mij" en "bring your own key": bij dat laatste moet elk bureau
// zélf een developer token aanvragen bij Google, en dat is geen invulveld maar een
// aanvraagprocedure van dagen tot weken met kans op afwijzing.
//
// ── DIT VERVING TWAALF KOPIEËN ─────────────────────────────────────────────
//
// `function getCredentials()` stond letterlijk twaalf keer in de codebase, allemaal op dezelfde
// vijf omgevingsvariabelen. Twaalf plekken die één voor één omgezet zouden moeten worden zodra
// er een tweede bureau komt, met twaalf kansen om er één te vergeten -- en een vergeten plek
// betekent dat bureau B met de sleutels van bureau A praat.
//
// ── DE TERUGVAL OP DE OMGEVING IS TIJDELIJK, EN ZICHTBAAR ──────────────────
//
// Zolang er nog geen enkel bureau gekoppeld is, valt dit terug op GOOGLE_ADS_REFRESH_TOKEN en
// GOOGLE_ADS_MANAGER_CUSTOMER_ID uit de omgeving -- precies het gedrag van vandaag. Zonder die
// terugval zou deze wijziging alles breken op het moment dat hij landt.
//
// Maar de terugval is WEL zichtbaar: `bron` zegt of de credentials van het bureau kwamen of uit
// de omgeving. Een stille terugval zou betekenen dat je op de dag dat bureau B erbij komt, niet
// merkt dat zijn sync met jouw token draait -- en dat is precies het soort fout waar deze hele
// verbouwing voor bedoeld is.

export type CredentialBron = "bureau" | "omgeving";

export interface BureauCredentials {
  credentials: GoogleAdsCredentials;
  bron: CredentialBron;
  /** Het bureau waar dit voor geldt, als dat bekend is. */
  agencyId: string | null;
}

/**
 * De product-eigen delen uit de omgeving. Null als er iets ontbreekt: zonder developer token of
 * OAuth-client valt er niets te praten, ongeacht welk bureau het is.
 */
function productDeel(): { developerToken: string; clientId: string; clientSecret: string } | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!developerToken || !clientId || !clientSecret) return null;
  return { developerToken, clientId, clientSecret };
}

/**
 * De credentials zoals ze vandaag zijn: alles uit de omgeving.
 *
 * Blijft bestaan voor paden zonder bureau-context (het backfill-script, een handmatige aanroep)
 * en als terugval. Geeft null zodra één van de vijf ontbreekt.
 */
export function credentialsUitOmgeving(): GoogleAdsCredentials | null {
  const p = productDeel();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!p || !refreshToken) return null;
  return { ...p, refreshToken, managerCustomerId: process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID };
}

/**
 * De credentials voor één bureau: product-deel uit de omgeving, bureau-deel uit zijn koppeling.
 *
 * Valt terug op de omgeving als het bureau (nog) geen actieve koppeling heeft. `bron` zegt welke
 * van de twee het werd; loggen op basis daarvan is de bedoeling.
 *
 * Null betekent: er zijn helemaal geen bruikbare credentials. Dat is iets anders dan "dit bureau
 * heeft niet gekoppeld", en de aanroeper hoort dat verschil te kunnen maken -- vandaar `bron` in
 * plaats van een enkel resultaat.
 */
export async function credentialsVoorBureau(
  supabase: SupabaseClient,
  agencyId: string | null | undefined
): Promise<BureauCredentials | null> {
  const p = productDeel();
  if (!p) return null;

  if (agencyId) {
    const koppeling = await leesKoppeling(supabase, agencyId, "google_ads");
    if (koppeling && koppeling.status === "actief" && koppeling.heeftToken) {
      const refreshToken = await leesRefreshToken(supabase, agencyId, "google_ads");
      if (refreshToken) {
        return {
          credentials: {
            ...p,
            refreshToken,
            // Het MCC-id van het bureau. Ontbreekt het, dan geen terugval op dat van de
            // omgeving: dan zou dit bureau via ÉÉN ander manager-account praten, en dat is
            // erger dan een mislukte call.
            managerCustomerId: koppeling.externalId ?? undefined,
          },
          bron: "bureau",
          agencyId,
        };
      }
    }
  }

  const omgeving = credentialsUitOmgeving();
  if (!omgeving) return null;
  return { credentials: omgeving, bron: "omgeving", agencyId: agencyId ?? null };
}

/**
 * Hetzelfde, maar vanaf een klant. De meeste routes kennen een clientId en geen agencyId.
 *
 * Onbekende klant: terugval op de omgeving, niet weigeren. De aanroeper heeft dan een andere
 * reden om te stoppen (de klant bestaat niet), en die hoort niet als "geen credentials" te
 * lezen -- dat stuurt iemand naar de verkeerde instelling.
 */
export async function credentialsVoorKlant(
  supabase: SupabaseClient,
  clientId: string | null | undefined
): Promise<BureauCredentials | null> {
  const agencyId = clientId ? (await klantVanId(supabase, clientId))?.agencyId ?? null : null;
  return credentialsVoorBureau(supabase, agencyId);
}
