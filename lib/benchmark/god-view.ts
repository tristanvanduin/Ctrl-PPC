import { beoordeelCel, type Celsleutel, type Celtelling } from "./cel";
import { median } from "@/lib/util/stats";
import type { Bedrijfsmodel } from "./segment";

// ============================================================================
// GOD VIEW-KERNLAAG: DE ECHTE CIJFERS ACHTER DE CEL-BESLISSING
// ============================================================================
//
// cel.ts beslist OF een segment gedeeld mag worden (genoeg accounts, genoeg bureaus). Dat bestand
// bevat met opzet geen cijfer -- "Geen data, geen database, geen aggregatie. Alleen de beslissing."
// Dit bestand is de volgende stap: gegeven rijen die AL door die beslissing heen mogen (opt-in
// bureaus, zie de aanroepende route), de daadwerkelijke benchmarkwaarde per cel berekenen.
//
// Gemarket als "God View" (lib/marketing/modules.ts, drie tiers, nog `gebouwd: false`) --
// dit bestand is de fundering waar alle drie tiers op moeten rusten, nog zonder UI, zonder
// tier-gating, zonder trend/churn/opportunity-lagen erbovenop. Eerst de kernvraag goed
// beantwoorden ("wat is de mediane CPA voor b2b-accounts op Google") voordat er iets bovenop komt.
//
// ── WAAROM MEDIAAN VAN PER-ACCOUNT VERHOUDINGEN, NIET SOM/SOM ──────────────
//
// lib/macro/aggregate.ts (het single-agency-equivalent) telt ruwe totalen op -- terecht daar: een
// bureau ziet zijn eigen boek, dus "totale spend / totale conversies" is een eerlijk portfoliocijfer.
// Hier niet: totale spend/conversies over meerdere bureaus heen is precies het getal waarmee één
// account met een uitzonderlijk grote spend de hele cel domineert EN, erger, waarmee een bureau dat
// zijn eigen cijfers kent kan terugrekenen wat de rest van de cel gemiddeld deed. Eerst per account
// een CPA/ROAS berekenen, dan de MEDIAAN van die verhoudingen nemen: robuust tegen een dominant
// account, en geen enkel individueel account is uit het resultaat terug te rekenen.
//
// ── WAAROM ELKE METRIC ZIJN EIGEN DREMPEL-CHECK KRIJGT, NIET ALLEEN DE CEL ──
//
// Een cel kan als geheel de drempel halen (10 accounts, 4 bureaus) terwijl maar 3 van die accounts
// ooit een conversie hadden -- de rest droeg alleen bij aan "accounts" en "bureaus", niet aan de
// CPA-mediaan zelf. Zonder een aparte check op de subset die de mediaan VOEDT, zou zo'n mediaan op
// 3 accounts rusten terwijl de cel-telling 10 belooft. Elke metric loopt daarom zelf nog een keer
// door beoordeelCel(), met de subset die 'm daadwerkelijk voedt -- dezelfde regel, hergebruikt,
// nooit een tweede, losse drempel ernaast.

export interface GodViewInvoerRij {
  clientId: string;
  agencyId: string;
  channel: string;
  bedrijfsmodel: Bedrijfsmodel | null;
  niche: string | null;
  /** Al geaggregeerd over de gekozen periode (bijv. de laatste volledige maand) — deze functie
   *  kent geen datums, dat is aan de aanroepende route, zelfde scheiding als macro/aggregate.ts. */
  spend: number;
  conversions: number;
  conversionValue: number;
}

export interface GodViewMetrics {
  medianCpa: number | null;
  medianRoas: number | null;
  /** Hoeveel accounts daadwerkelijk in de mediaan zaten — null-metric ⇒ 0, want de subset zelf
   *  haalde de drempel niet (en het getal wordt dus nooit teruggegeven). */
  accountsMetCpa: number;
  accountsMetRoas: number;
}

export interface GodViewCel {
  sleutel: Celsleutel;
  telling: Celtelling;
  /** null als de cel als geheel niet deelbaar is (zie beoordeelCel). Is de cel wel deelbaar, dan
   *  kunnen individuele metrics ALSNOG null zijn — zie de koptekst hierboven. */
  metrics: GodViewMetrics | null;
}

interface AccountAgg {
  agencyId: string;
  spend: number;
  conversions: number;
  conversionValue: number;
}

function sleutelTekst(s: Celsleutel): string {
  return `${s.channel}|${s.model ?? ""}|${s.niche ?? ""}`;
}

/** Mediaan van een subset, maar alleen als de subset zelf de k-anonimiteitsdrempel van deze
 *  celdiepte haalt — anders null, ook als de cel als geheel wel deelbaar is. */
function metricMediaan(
  sleutel: Celsleutel,
  accounts: ReadonlyArray<{ agencyId: string; waarde: number }>,
): { mediaan: number | null; n: number } {
  if (accounts.length === 0) return { mediaan: null, n: 0 };
  const telling: Celtelling = { accounts: accounts.length, bureaus: new Set(accounts.map((a) => a.agencyId)).size };
  if (!beoordeelCel(sleutel, telling).deelbaar) return { mediaan: null, n: 0 };
  return { mediaan: median(accounts.map((a) => a.waarde)), n: accounts.length };
}

/**
 * Bouwt de God View-cellen uit een verzameling accountrijen (al beperkt tot opt-in-bureaus door
 * de aanroepende route, zie app/api/admin/benchmarkdekking/route.ts voor hetzelfde patroon).
 *
 * Zelfde segmentatieregel als celoverzicht() in cel.ts: elke rij telt mee op elk niveau waarop hij
 * is afgebakend (model, niche, en de combinatie als beide aanwezig zijn).
 */
export function bouwGodViewCellen(rijen: readonly GodViewInvoerRij[]): GodViewCel[] {
  const groepen = new Map<string, { sleutel: Celsleutel; accounts: Map<string, AccountAgg> }>();

  const voegToe = (sleutel: Celsleutel, rij: GodViewInvoerRij) => {
    const k = sleutelTekst(sleutel);
    let g = groepen.get(k);
    if (!g) { g = { sleutel, accounts: new Map() }; groepen.set(k, g); }
    // Eén rij per (account, cel) is de aanname (de route aggregeert eerst over de periode); een
    // dubbele clientId hier is een programmeerfout in de aanroeper. Optellen i.p.v. overschrijven
    // houdt zo'n bug zichtbaar in de accounttelling in plaats van cijfers stil te laten verdwijnen.
    const bestaand = g.accounts.get(rij.clientId);
    if (bestaand) {
      bestaand.spend += rij.spend;
      bestaand.conversions += rij.conversions;
      bestaand.conversionValue += rij.conversionValue;
    } else {
      g.accounts.set(rij.clientId, { agencyId: rij.agencyId, spend: rij.spend, conversions: rij.conversions, conversionValue: rij.conversionValue });
    }
  };

  for (const r of rijen) {
    if (r.bedrijfsmodel) voegToe({ channel: r.channel, model: r.bedrijfsmodel, niche: null }, r);
    if (r.niche) voegToe({ channel: r.channel, model: null, niche: r.niche }, r);
    if (r.bedrijfsmodel && r.niche) voegToe({ channel: r.channel, model: r.bedrijfsmodel, niche: r.niche }, r);
  }

  return [...groepen.values()]
    .map((g) => {
      const accountsArr = [...g.accounts.values()];
      const telling: Celtelling = { accounts: accountsArr.length, bureaus: new Set(accountsArr.map((a) => a.agencyId)).size };
      const oordeel = beoordeelCel(g.sleutel, telling);
      if (!oordeel.deelbaar) return { sleutel: g.sleutel, telling, metrics: null };

      const cpaAccounts = accountsArr.filter((a) => a.conversions > 0).map((a) => ({ agencyId: a.agencyId, waarde: a.spend / a.conversions }));
      const roasAccounts = accountsArr.filter((a) => a.spend > 0).map((a) => ({ agencyId: a.agencyId, waarde: a.conversionValue / a.spend }));
      const cpa = metricMediaan(g.sleutel, cpaAccounts);
      const roas = metricMediaan(g.sleutel, roasAccounts);

      return {
        sleutel: g.sleutel,
        telling,
        metrics: { medianCpa: cpa.mediaan, medianRoas: roas.mediaan, accountsMetCpa: cpa.n, accountsMetRoas: roas.n },
      };
    })
    .sort((a, b) => b.telling.accounts - a.telling.accounts);
}
