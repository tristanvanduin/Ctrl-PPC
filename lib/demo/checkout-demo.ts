// De Google-checkoutstappen per dag voor de demo (google_ads_checkout_funnel_daily, migratie 111),
// voor de conversietrechter op het Overzicht in de nieuwe weergave. ÉÉN generator voor twee
// consumenten: de seed (scripts/demo/seed-demo-client.ts) schrijft ze naar de echte database, waar
// de browser ze via /api/data leest, en demoRows() (lib/demo/demo-rows.ts) serveert ze aan de mock.
// Twee losse kopieën zouden uit elkaar lopen (zie lib/demo/microsoft-demo.ts).
//
// VOORBEELDEN, geen metingen van deze fictieve klant. Wel samenhangend met de demo-totalen: per
// campagne per maand afgeleid van de conversies in ads_campaign_monthly. De winkelwagens zijn
// ongeveer 1,2 keer de conversies van de maand, over de dagen verdeeld met splitInt (doordeweeks
// zwaarder dan in het weekend); per dag gaat iets meer dan de helft door naar afrekenen, en daarvan
// 60% naar een aankoop (een ticket). Naar beneden afgerond, zodat winkelwagen >= afrekenen >= aankoop
// op elke dag, en de aankopen altijd onder de conversies van de maand blijven: niet elke conversie
// van deze beurs is een aankoop (een standaanvraag gaat via een formulier).

import { splitInt } from "./split";

type Row = Record<string, unknown>;

/** De dagen van een maand ("2026-11") tot en met `tot`. */
function dagenVan(maand: string, tot: string): string[] {
  const uit: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const datum = `${maand}-${String(d).padStart(2, "0")}`;
    if (new Date(`${datum}T00:00:00Z`).toISOString().slice(0, 10) !== datum || datum > tot) continue;
    uit.push(datum);
  }
  return uit;
}

/**
 * De checkoutrijen per campagne en dag, uit de maandrijen per campagne (campaign_id, campaign_name,
 * month, conversions), vanaf `vanafMaand` ("2025-11") tot en met `vandaag`.
 */
export function checkoutPerDagUitCampagnes(
  clientId: string,
  campagneMaanden: readonly Row[],
  vandaag: string,
  vanafMaand: string,
): Row[] {
  const uit: Row[] = [];
  for (const r of campagneMaanden) {
    const maand = String(r.month).slice(0, 7);
    if (maand < vanafMaand) continue;
    const dagen = dagenVan(maand, vandaag);
    if (!dagen.length) continue;
    const gewicht = dagen.map((d) => ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) ? 0.7 : 1.2));
    const winkelwagens = splitInt(Math.round(Number(r.conversions ?? 0) * 1.2), gewicht);
    dagen.forEach((datum, i) => {
      const afrekenen = Math.floor(winkelwagens[i] * 0.55);
      const aankoop = Math.floor(afrekenen * 0.6);
      uit.push({
        client_id: clientId, date: datum, campaign_id: r.campaign_id, campaign_name: r.campaign_name, device: "UNSPECIFIED",
        add_to_cart_count: winkelwagens[i], begin_checkout_count: afrekenen, purchase_count: aankoop,
      });
    });
  }
  return uit;
}
