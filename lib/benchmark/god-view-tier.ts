import { heeftTenminste, type Licentie } from "@/lib/chat/toegang";

// Welke licentie ontgrendelt God View Premium (de cross-agency God View Premium/Tactical/Pulse-
// tiers uit lib/marketing/modules.ts, nog gebouwd:false als los af te nemen module). Er bestaat
// vandaag geen apart God-View-specifiek entitlement-veld -- alleen agencies.licentie, dezelfde
// basis-productladder die ook chat ontgrendelt (magChatten, lib/chat/toegang.ts). Een echt eigen
// God-View-abonnement (los van de basisladder, met de eigen Standard/Tactical/Pulse-prijzen) is
// nieuwe infrastructuur die nergens anders bestaat voor welke module dan ook (zie
// lib/analysis/credit-costs.ts: CREDIT_COSTS staat leeg, exact dezelfde reden). Tot die beslissing
// er is: 'scale' als placeholder-grens, één tier boven waar chat ontgrendelt ('growth') -- God
// View Premium is het duurdere, tweede-orde product, dus een hogere basisgrens dan chat is een
// redelijke eerste aanname, geen besloten prijszetting. Herijk zodra God View Premium een eigen
// afnamebeslissing is, net als magChatten's eigen grens-commentaar al voordoet.
const GOD_VIEW_PREMIUM_MINIMUM: Licentie = "scale";

export function magGodViewPremium(licentie: string | null | undefined): boolean {
  return heeftTenminste(licentie, GOD_VIEW_PREMIUM_MINIMUM);
}
