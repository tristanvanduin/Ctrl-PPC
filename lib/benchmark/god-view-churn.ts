import { beoordeelCel, type Celdrempels, type Celsleutel, type Celtelling } from "./cel";
import type { Bedrijfsmodel } from "./segment";
import type { Licht } from "@/lib/adoptie/account-stoplicht";

// ============================================================================
// GOD VIEW-CHURNLAAG: WAAR ZIT HET CHURNRISICO GECONCENTREERD
// ============================================================================
//
// god-view.ts beantwoordt "wat is de mediane CPA/ROAS in deze cel". Dit bestand beantwoordt een
// andere vraag over dezelfde cellen: "hoeveel accounts in dit segment staan op rood/amber". Geen
// cijfers over individuele accounts, alleen een telling per licht -- dezelfde reden als
// god-view.ts's mediaan-in-plaats-van-som: een telling is niet naar één account terug te rekenen,
// een naam wel.
//
// Licht komt uit lib/adoptie/code-rood.ts (beoordeelCodeRood), dezelfde beoordeling die het
// Today-paneel en de per-klant dashboardbanner al tonen -- dit is geen nieuw churnmodel, alleen
// een nieuwe optelling van een bestaand oordeel over de cellen heen die god-view.ts ook al
// gebruikt (channel/bedrijfsmodel/niche), zodat "welk account staat er slecht voor" wordt
// "in welke niches komt dat vaker voor dan elders".
//
// Zelfde k-anonimiteitsgrens als god-view.ts, hergebruikt via beoordeelCel: een telling van 2
// rode accounts op 3 totaal verraadt bij een klein segment net zo goed wie het is als een
// CPA-cijfer dat zou doen. "channel" is hier altijd "account" (zie GodViewChurnInvoerRij) --
// churn is een oordeel over het ACCOUNT, niet over een los kanaal daarbinnen, in tegenstelling
// tot god-view.ts's CPA/ROAS die wel per kanaal verschilt.

export const CHURN_CHANNEL = "account";

export interface GodViewChurnInvoerRij {
  clientId: string;
  agencyId: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  licht: Licht;
}

export interface GodViewChurnTelling {
  rood: number;
  amber: number;
  groen: number;
  onbekend: number;
}

export interface GodViewChurnCel {
  sleutel: Celsleutel;
  telling: Celtelling;
  /** null als de cel als geheel niet deelbaar is (zie beoordeelCel) -- zelfde regel, geen aparte. */
  churn: GodViewChurnTelling | null;
}

function sleutelTekst(s: Celsleutel): string {
  return `${s.channel}|${s.model ?? ""}|${s.niche ?? ""}`;
}

/**
 * Bouwt de churn-cellen uit een verzameling accountrijen (al beperkt tot opt-in-bureaus door de
 * aanroepende route, zelfde bron als fetchGodViewInvoerRijen). Eén rij per account: een tweede
 * rij met dezelfde clientId overschrijft de eerste niet stilzwijgend maar telt als
 * programmeerfout in de aanroeper (dezelfde aanname als bouwGodViewCellen in god-view.ts).
 */
export function bouwGodViewChurnCellen(
  rijen: readonly GodViewChurnInvoerRij[],
  drempels?: Celdrempels,
): GodViewChurnCel[] {
  const groepen = new Map<string, { sleutel: Celsleutel; accounts: Map<string, { agencyId: string; licht: Licht }> }>();

  const voegToe = (sleutel: Celsleutel, rij: GodViewChurnInvoerRij) => {
    const k = sleutelTekst(sleutel);
    let g = groepen.get(k);
    if (!g) { g = { sleutel, accounts: new Map() }; groepen.set(k, g); }
    g.accounts.set(rij.clientId, { agencyId: rij.agencyId, licht: rij.licht });
  };

  for (const r of rijen) {
    if (r.bedrijfsmodel) voegToe({ channel: CHURN_CHANNEL, model: r.bedrijfsmodel, niche: null }, r);
    if (r.niche) voegToe({ channel: CHURN_CHANNEL, model: null, niche: r.niche }, r);
    if (r.bedrijfsmodel && r.niche) voegToe({ channel: CHURN_CHANNEL, model: r.bedrijfsmodel, niche: r.niche }, r);
  }

  return [...groepen.values()]
    .map((g) => {
      const accountsArr = [...g.accounts.values()];
      const telling: Celtelling = { accounts: accountsArr.length, bureaus: new Set(accountsArr.map((a) => a.agencyId)).size };
      const oordeel = beoordeelCel(g.sleutel, telling, drempels);
      if (!oordeel.deelbaar) return { sleutel: g.sleutel, telling, churn: null };

      const churn: GodViewChurnTelling = { rood: 0, amber: 0, groen: 0, onbekend: 0 };
      for (const a of accountsArr) {
        if (a.licht === "rood") churn.rood++;
        else if (a.licht === "amber") churn.amber++;
        else if (a.licht === "groen") churn.groen++;
        else churn.onbekend++;
      }
      return { sleutel: g.sleutel, telling, churn };
    })
    .sort((a, b) => (b.churn ? b.churn.rood + b.churn.amber : 0) - (a.churn ? a.churn.rood + a.churn.amber : 0));
}
