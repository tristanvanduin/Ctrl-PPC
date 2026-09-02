// Deterministische beslisregels: per campagne, land en device één actierichting die als BINDEND
// de maandprompt ingaat (renderBindingFacts onderaan). Het model mag er niet tegenin.
//
// ── WAAROM ER EEN "GEEN DATA"-TOESTAND IS (herbouw 2 september 2026) ──────────────────────
//
// De vorige versie kende alleen getallen. Ontbrak iets, dan werd het nul of honderd:
//
//   - een campagne zonder rij in de vorige maand telde als "spend MoM +100%" -- en met een ROAS
//     onder target was dat direct REDUCE/high, voor een campagne die gewoon nieuw was;
//   - nul conversies gaf ROAS 0 en CPA 0, en CPA 0 ligt "onder target", dus een campagne zonder
//     één conversie maar met budgetverlies kreeg EXPAND;
//   - een campagne met €5 spend kreeg dezelfde bindende richting als een met €5.000;
//   - per land werd per rij gekozen tussen euro's (conversiewaarde) en aantallen (conversies),
//     zodat de som waaruit het conversie-aandeel kwam eenheden mengde;
//   - lege geo-/device-lijsten (die syncs lopen sinds april achter) lazen als "niets te melden".
//
// Omdat de uitkomst onder "NIET wijzigen" in de prompt staat, waren dit geen afrondingen maar
// verkeerde instructies. Nu: een volumedrempel vóór elk oordeel, null waar iets niet gemeten is
// (spendgroei zonder vorige maand, ROAS zonder conversiewaarde, CPA zonder conversies), één
// resultaatmetriek per account voor alle landen, en een `dekking`-blok dat zegt wat er ontbrak.
// De drempels zelf (0,8x en 1,3x target, lost IS 10/15/20, efficiency 0,7/1,2, CVR 0,5x/1,5x)
// zijn ongewijzigd.

import type { AccountType } from "@/lib/prompts/sop-prompts";
import { opsomming } from "@/lib/util/tekst";

export type ActionDirection =
  | "expand"
  | "reduce"
  | "investigate"
  | "monitor"
  | "geo_reduce"
  | "geo_expand"
  | "device_reduce"
  | "device_expand";

export interface CampaignDecision {
  campaignName: string;
  campaignId?: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface GeoDecision {
  country: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
  efficiencyRatio: number;
}

export interface DeviceDecision {
  device: string;
  direction: ActionDirection;
  reason: string;
  evidence: string;
}

/**
 * Wat er NIET beoordeeld is, en waarom. Hoort bij de uitkomst, want "geen richting" betekent
 * zonder dit blok twee dingen tegelijk: "niets aan de hand" en "niets gemeten".
 */
export interface DecisionRulesDekking {
  /** Campagnes onder MIN_CAMPAGNE_SPEND: staan als monitor/low in campaignDecisions, maar
   *  worden in de bindende feiten als één regel genoemd in plaats van als oordeel. */
  campagnesOnderDrempel: string[];
  /** False als er geen enkele geo-rij voor de analysemaand was (sync achter of ontbreekt). */
  geoData: boolean;
  /** Idem voor devices. */
  deviceData: boolean;
  /** Landen die er wel waren maar onder MIN_GEO_SPEND bleven en dus geen richting kregen. */
  landenOnderDrempel: number;
  /** Vrije opmerkingen: targets die niet toetsbaar waren, ontbrekende accountrij, enz. */
  opmerkingen: string[];
}

export interface DecisionRulesOutput {
  accountStatus: "OP SCHEMA" | "NIET OP SCHEMA" | "KRITIEK";
  campaignDecisions: CampaignDecision[];
  geoDecisions: GeoDecision[];
  deviceDecisions: DeviceDecision[];
  dekking: DecisionRulesDekking;
  bindingFacts: string;
}

export interface DecisionRulesTargets {
  roasTarget?: number;
  cpaTarget?: number;
  conversionsTarget?: number;
}

export interface DecisionRuleCampaignRow {
  campaign_id?: string | null;
  campaign_name: string;
  roas?: number | null;
  cost_per_conversion?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
  search_budget_lost_is?: number | null;
}

export interface DecisionRuleGeoRow {
  country: string;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
  spend_share?: number | null;
}

export interface DecisionRuleDeviceRow {
  device: string;
  cost?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  conversion_rate?: number | null;
}

/** De teller van het geo-aandeel: euro's voor e-commerce, aantallen voor leadgen. */
export type ResultMetric = "conversion_value" | "conversions";

export interface DecisionRulesInput {
  accountType: AccountType;
  currentAccount: Record<string, unknown>;
  previousAccount?: Record<string, unknown> | null;
  campaignRows: DecisionRuleCampaignRow[];
  previousCampaignRows?: DecisionRuleCampaignRow[];
  geoRows: DecisionRuleGeoRow[];
  deviceRows: DecisionRuleDeviceRow[];
  targets: DecisionRulesTargets;
  /**
   * Eén teller voor ALLE landen. Ontbreekt hij, dan volgt hij het accounttype via
   * standaardResultMetric. Nooit per rij kiezen: een land zonder conversiewaarde maar met
   * conversies telt bij conversion_value als 0, niet als zijn aantal conversies.
   */
  resultMetric?: ResultMetric;
}

// ── Volumedrempels ─────────────────────────────────────────────────────────────────────────
//
// Onder deze grenzen is een ratio geen meting maar ruis: één conversie op €8 spend is een
// ROAS van 12 of van 0, afhankelijk van de dag. De getallen zijn bewust laag gekozen (het gaat
// om een maand), zodat ze alleen de echte restcampagnes en testlanden wegfilteren.

/** Campagnes onder dit maandbedrag krijgen geen richting, alleen "monitor: onvoldoende volume". */
export const MIN_CAMPAGNE_SPEND = 50;
/** Landen onder dit maandbedrag worden overgeslagen (wel geteld in dekking.landenOnderDrempel). */
export const MIN_GEO_SPEND = 25;
/** Een device-CVR op minder klikken dan dit is geen vergelijking met het accountgemiddelde. */
export const MIN_DEVICE_CLICKS = 100;
/** device_expand vereist bovendien een materieel spend-aandeel: 1% van het budget opschalen
 *  op basis van een goede CVR is geen richting die het model mag afdwingen. */
export const MIN_DEVICE_SPEND_SHARE = 0.05;

/**
 * De standaardteller per accounttype. Staat hier en niet (opnieuw) in de aanroeper, zodat de
 * geo-regels en de KPI-keten van monthly-prepared-context dezelfde keuze maken.
 */
export function standaardResultMetric(accountType: AccountType): ResultMetric {
  return accountType.startsWith("ecommerce") ? "conversion_value" : "conversions";
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Procentueel verschil, of null als de vorige waarde geen basis is (ontbreekt of nul). */
function pctVerschil(cur: number, prev: number | null): number | null {
  if (prev === null || prev <= 0) return null;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

function normalizeDirectionCase(direction: ActionDirection): string {
  return direction.toUpperCase();
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function cleanDecisionText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+\|/g, " |")
    .replace(/\|\s+\|/g, "|")
    .replace(/[.;:]+\s*$/g, "")
    .trim();
}

// ── Meetbaarheid ───────────────────────────────────────────────────────────────────────────
//
// ROAS bestaat alleen als er conversiewaarde is, CPA alleen als er conversies zijn. De vorige
// versie maakte van "niet gemeten" een 0, en 0 is in beide gevallen een uitgesproken oordeel:
// ROAS 0 is "verliest alles", CPA 0 is "gratis conversies". Null hier betekent "niet meetbaar"
// en de regels hieronder slaan een ratio over die null is.

interface RatioBron {
  roas?: unknown;
  cost_per_conversion?: unknown;
  cost?: unknown;
  conversions?: unknown;
  conversions_value?: unknown;
}

/** De opgeslagen ROAS als die er is, anders berekend; null zonder conversiewaarde of spend. */
function meetbareRoas(rij: RatioBron): number | null {
  const waarde = num(rij.conversions_value);
  const cost = num(rij.cost);
  if (waarde <= 0 || cost <= 0) return null;
  const opgeslagen = num(rij.roas);
  return opgeslagen > 0 ? opgeslagen : waarde / cost;
}

/** De opgeslagen CPA als die er is, anders berekend; null zonder conversies. */
function meetbareCpa(rij: RatioBron): number | null {
  const conversions = num(rij.conversions);
  if (conversions <= 0) return null;
  const opgeslagen = num(rij.cost_per_conversion);
  return opgeslagen > 0 ? opgeslagen : num(rij.cost) / conversions;
}

function ratioTekst(waarde: number | null): string {
  return waarde === null ? "n.v.t." : String(roundTwo(waarde));
}

// ── Accountstatus ──────────────────────────────────────────────────────────────────────────

function computeAccountStatus(opts: {
  currentAccount: Record<string, unknown>;
  targets: DecisionRulesTargets;
}): { status: DecisionRulesOutput["accountStatus"]; opmerkingen: string[] } {
  const acc = opts.currentAccount;
  const opmerkingen: string[] = [];
  // De aanroeper geeft {} door als de maandrij ontbreekt. Dan is elke uitkomst hieronder een
  // uitspraak over niets; de status blijft (het type kent geen "onbekend"), de opmerking niet.
  if (Object.keys(acc).length === 0) {
    opmerkingen.push("Geen accountrij voor de analysemaand: de accountstatus is niet op gemeten cijfers gebaseerd");
  }
  const conversions = num(acc.conversions);
  const roas = meetbareRoas(acc);
  const cpa = meetbareCpa(acc);
  const conversionsTarget = num(opts.targets.conversionsTarget);
  const roasTarget = num(opts.targets.roasTarget);
  const cpaTarget = num(opts.targets.cpaTarget);

  // Een target die niet gemeten kan worden is niet gefaald; hij telt niet mee en wordt genoemd.
  const roasToetsbaar = roasTarget > 0 && roas !== null;
  const cpaToetsbaar = cpaTarget > 0 && cpa !== null;
  if (roasTarget > 0 && roas === null) {
    opmerkingen.push(num(acc.conversions_value) > 0
      ? "ROAS-target gezet maar ROAS niet meetbaar (geen spend in de accountrij)"
      : "ROAS-target gezet maar geen conversiewaarde gemeten");
  }
  if (cpaTarget > 0 && cpa === null) {
    opmerkingen.push("CPA-target gezet maar geen conversies gemeten");
  }

  const conversionPass = conversionsTarget > 0 ? conversions >= conversionsTarget * 0.95 : conversions > 0;
  const conversionWarn = conversionsTarget > 0 ? conversions >= conversionsTarget * 0.8 : conversions > 0;
  const roasPass = roasToetsbaar && (roas as number) >= roasTarget * 0.95;
  const cpaPass = cpaToetsbaar && (cpa as number) <= cpaTarget * 1.05;
  const geenToetsbareTarget = !roasToetsbaar && !cpaToetsbaar;

  if (conversionPass && (roasPass || cpaPass || geenToetsbareTarget)) return { status: "OP SCHEMA", opmerkingen };
  if (conversionWarn) return { status: "NIET OP SCHEMA", opmerkingen };
  return { status: "KRITIEK", opmerkingen };
}

// ── Campagnes ──────────────────────────────────────────────────────────────────────────────

function evaluateCampaignDirection(opts: {
  accountType: AccountType;
  current: DecisionRuleCampaignRow;
  previous?: DecisionRuleCampaignRow;
  targets: DecisionRulesTargets;
}): { decision: CampaignDecision; onderDrempel: boolean } {
  const basis = { campaignName: opts.current.campaign_name, campaignId: opts.current.campaign_id ?? undefined };
  const cost = num(opts.current.cost);
  const conversions = num(opts.current.conversions);
  const conversionsValue = num(opts.current.conversions_value);

  if (cost < MIN_CAMPAGNE_SPEND) {
    return {
      onderDrempel: true,
      decision: {
        ...basis,
        direction: "monitor",
        reason: `Onvoldoende volume voor een oordeel (spend €${roundTwo(cost)} < €${MIN_CAMPAGNE_SPEND})`,
        evidence: `spend €${roundTwo(cost)} | ${roundTwo(conversions)} conversies`,
        confidence: "low",
      },
    };
  }

  // Materiële spend zonder één conversie: ROAS en CPA zijn dan niet meetbaar, en dat is precies
  // het geval waarin de oude regels EXPAND (CPA 0 "onder target") of REDUCE (ROAS 0) gaven.
  // Het enige eerlijke antwoord is onderzoeken -- tracking, landingspagina, zoektermen.
  if (conversions <= 0 && conversionsValue <= 0) {
    return {
      onderDrempel: false,
      decision: {
        ...basis,
        direction: "investigate",
        reason: "Materiële spend zonder conversies",
        evidence: `spend €${roundTwo(cost)} | 0 conversies | ROAS en CPA niet meetbaar`,
        confidence: "medium",
      },
    };
  }

  const roas = meetbareRoas(opts.current);
  const cpa = meetbareCpa(opts.current);
  const lostIsRuw = num(opts.current.search_budget_lost_is);
  const lostIs = lostIsRuw * (lostIsRuw <= 1 ? 100 : 1);
  // Zonder rij in de vorige maand is de groei onbekend, niet +100%. Een vorige maand zonder
  // spend is evenmin een basis: 0 -> 500 is een herstart, geen groei van 500%.
  const prevCost = opts.previous ? num(opts.previous.cost) : null;
  const spendGrowth = pctVerschil(cost, prevCost);
  const mom = spendGrowth !== null
    ? `${spendGrowth > 0 ? "+" : ""}${spendGrowth}%`
    : prevCost === null ? "onbekend (geen vorige maand)" : "onbekend (vorige maand zonder spend)";
  const roasTarget = num(opts.targets.roasTarget);
  const cpaTarget = num(opts.targets.cpaTarget);

  const klaar = (decision: Omit<CampaignDecision, "campaignName" | "campaignId">) => ({
    onderDrempel: false,
    decision: { ...basis, ...decision },
  });

  if ((opts.accountType === "ecommerce_roas" || opts.accountType === "hybrid") && roasTarget > 0 && roas !== null) {
    const roasEvidence = `ROAS ${roundTwo(roas)} vs target ${roundTwo(roasTarget)}`;
    if (roas < roasTarget * 0.8 && spendGrowth !== null && spendGrowth > 40) {
      return klaar({
        direction: "reduce",
        reason: "ROAS ligt ruim onder target terwijl spend te hard groeit.",
        evidence: `${roasEvidence} | spend MoM ${mom}`,
        confidence: "high",
      });
    }
    if (roas < roasTarget * 0.8) {
      return klaar({
        direction: "investigate",
        reason: spendGrowth === null
          ? "ROAS ligt ruim onder target; spendgroei is zonder vorige maand niet te meten, dus geen directe reductie."
          : "ROAS ligt ruim onder target, maar spendgroei is niet hoog genoeg voor directe reductie.",
        evidence: `${roasEvidence} | spend MoM ${mom}`,
        confidence: "medium",
      });
    }
    if (roas >= roasTarget * 1.3 && lostIs > 10) {
      return klaar({
        direction: "expand",
        reason: "ROAS ligt ruim boven target en demand capture verliest volume op budget.",
        evidence: `${roasEvidence} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "high",
      });
    }
    if (roas >= roasTarget && lostIs > 20 && (cpaTarget <= 0 || cpa === null || cpa < cpaTarget)) {
      return klaar({
        direction: "expand",
        reason: "Campagne haalt target en verliest nog demand door budgetlimiet.",
        evidence: `${roasEvidence} | Search Lost IS (Budget) ${roundTwo(lostIs)}% | CPA ${ratioTekst(cpa)}`,
        confidence: "high",
      });
    }
    if (roas >= roasTarget && lostIs <= 20) {
      return klaar({
        direction: "monitor",
        reason: "Campagne haalt target zonder duidelijke budgetcap.",
        evidence: `${roasEvidence} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "medium",
      });
    }
  }

  if ((opts.accountType === "ecommerce_cpa" || opts.accountType === "leadgen_cpa" || opts.accountType === "hybrid") && cpaTarget > 0 && cpa !== null) {
    const cpaEvidence = `CPA ${roundTwo(cpa)} vs target ${roundTwo(cpaTarget)}`;
    if (cpa > cpaTarget * 1.3 && spendGrowth !== null && spendGrowth > 30) {
      return klaar({
        direction: "reduce",
        reason: "CPA ligt te ver boven target terwijl spend te hard stijgt.",
        evidence: `${cpaEvidence} | spend MoM ${mom}`,
        confidence: "high",
      });
    }
    if (cpa > cpaTarget * 1.3) {
      return klaar({
        direction: "investigate",
        reason: spendGrowth === null
          ? "CPA ligt te ver boven target; spendgroei is zonder vorige maand niet te meten, dus geen directe reductie."
          : "CPA ligt te ver boven target, maar spendgroei rechtvaardigt geen directe reductie.",
        evidence: `${cpaEvidence} | spend MoM ${mom}`,
        confidence: "medium",
      });
    }
    if (cpa < cpaTarget * 0.8 && lostIs > 15) {
      return klaar({
        direction: "expand",
        reason: "CPA ligt duidelijk onder target en de campagne verliest volume op budget.",
        evidence: `${cpaEvidence} | Search Lost IS (Budget) ${roundTwo(lostIs)}%`,
        confidence: "high",
      });
    }
    if (cpa >= cpaTarget * 0.8 && cpa <= cpaTarget * 1.1) {
      return klaar({
        direction: "monitor",
        reason: "CPA beweegt binnen de bandbreedte rond target.",
        evidence: cpaEvidence,
        confidence: "medium",
      });
    }
  }

  const nietMeetbaar = [
    roas === null ? "ROAS niet meetbaar (geen conversiewaarde)" : null,
    cpa === null ? "CPA niet meetbaar (geen conversies)" : null,
  ].filter((t): t is string => t !== null);
  return klaar({
    direction: "monitor",
    reason: "Geen harde trigger voor expand, reduce of investigate op basis van de deterministische regels.",
    evidence: [`ROAS ${ratioTekst(roas)}`, `CPA ${ratioTekst(cpa)}`, `spend MoM ${mom}`, ...nietMeetbaar].join(" | "),
    confidence: "low",
  });
}

// ── Geo ────────────────────────────────────────────────────────────────────────────────────

function evaluateGeoDecisions(
  geoRows: DecisionRuleGeoRow[],
  resultMetric: ResultMetric
): { decisions: GeoDecision[]; landenOnderDrempel: number; opmerking: string | null } {
  if (geoRows.length === 0) return { decisions: [], landenOnderDrempel: 0, opmerking: null };
  // Eén teller voor alle landen. Het aandeel van een land is alleen zinnig als teller en noemer
  // van elke rij dezelfde eenheid hebben.
  const teller = (row: DecisionRuleGeoRow) =>
    resultMetric === "conversion_value" ? num(row.conversions_value) : num(row.conversions);
  const totalSpend = geoRows.reduce((sum, row) => sum + num(row.cost), 0);
  const totalResult = geoRows.reduce((sum, row) => sum + teller(row), 0);
  const beoordeelbaar = geoRows.filter((row) => num(row.cost) >= MIN_GEO_SPEND);
  const landenOnderDrempel = geoRows.length - beoordeelbaar.length;

  if (totalResult <= 0) {
    // Zonder enig resultaat is elk conversie-aandeel 0 en zou elk land geo_reduce krijgen.
    const label = resultMetric === "conversion_value" ? "conversiewaarde" : "conversies";
    return { decisions: [], landenOnderDrempel, opmerking: `Geo-data zonder ${label}: geo-efficiency niet meetbaar, geen geo-richtingen` };
  }

  const decisions = beoordeelbaar.map((row): GeoDecision => {
    const spendShare = num(row.spend_share) > 0 ? num(row.spend_share) : (totalSpend > 0 ? num(row.cost) / totalSpend : 0);
    const conversionShare = teller(row) / totalResult;
    const efficiencyRatio = spendShare > 0 ? conversionShare / spendShare : 0;
    const evidence = `Spend share ${roundTwo(spendShare * 100)}% | conversion share ${roundTwo(conversionShare * 100)}%`;
    if (efficiencyRatio < 0.7) {
      return {
        country: row.country,
        direction: "geo_reduce",
        reason: "Land absorbeert meer spend dan het teruggeeft in conversie-aandeel.",
        evidence,
        efficiencyRatio: roundTwo(efficiencyRatio),
      };
    }
    if (efficiencyRatio > 1.2) {
      return {
        country: row.country,
        direction: "geo_expand",
        reason: "Land levert disproportioneel veel conversiewaarde voor zijn spend-aandeel.",
        evidence,
        efficiencyRatio: roundTwo(efficiencyRatio),
      };
    }
    return {
      country: row.country,
      direction: "monitor",
      reason: "Land zit binnen de neutrale efficiency-bandbreedte.",
      evidence,
      efficiencyRatio: roundTwo(efficiencyRatio),
    };
  });
  return { decisions, landenOnderDrempel, opmerking: null };
}

// ── Devices ────────────────────────────────────────────────────────────────────────────────

function evaluateDeviceDecisions(
  deviceRows: DecisionRuleDeviceRow[],
  currentAccount: Record<string, unknown>
): { decisions: DeviceDecision[]; opmerking: string | null } {
  if (deviceRows.length === 0) return { decisions: [], opmerking: null };
  const accountCvr = num(currentAccount.conversion_rate) || (() => {
    const totalClicks = deviceRows.reduce((sum, row) => sum + num(row.clicks), 0);
    const totalConversions = deviceRows.reduce((sum, row) => sum + num(row.conversions), 0);
    return totalClicks > 0 ? totalConversions / totalClicks : 0;
  })();
  const totalSpend = deviceRows.reduce((sum, row) => sum + num(row.cost), 0);
  if (accountCvr <= 0) {
    return { decisions: [], opmerking: "Device-data zonder conversies: device-CVR niet te vergelijken, geen device-richtingen" };
  }

  const decisions = deviceRows
    .filter((row) => num(row.cost) > 0)
    .map((row): DeviceDecision => {
      const clicks = num(row.clicks);
      const spendShare = totalSpend > 0 ? num(row.cost) / totalSpend : 0;
      const spendShareTekst = `spend share ${roundTwo(spendShare * 100)}%`;
      if (clicks < MIN_DEVICE_CLICKS) {
        return {
          device: row.device,
          direction: "monitor",
          reason: `Onvoldoende klikken voor een oordeel (${roundTwo(clicks)} < ${MIN_DEVICE_CLICKS})`,
          evidence: `clicks ${roundTwo(clicks)} | ${spendShareTekst}`,
        };
      }
      const deviceCvr = num(row.conversion_rate) || (clicks > 0 ? num(row.conversions) / clicks : 0);
      const cvrEvidence = `CVR ${roundTwo(deviceCvr * 100)}% vs account ${roundTwo(accountCvr * 100)}%`;
      if (deviceCvr < accountCvr * 0.5 && spendShare > 0.2) {
        return {
          device: row.device,
          direction: "device_reduce",
          reason: "Device converteert veel slechter dan het accountgemiddelde terwijl het materieel spend krijgt.",
          evidence: `${cvrEvidence} | ${spendShareTekst}`,
        };
      }
      if (deviceCvr > accountCvr * 1.5) {
        if (spendShare >= MIN_DEVICE_SPEND_SHARE) {
          return {
            device: row.device,
            direction: "device_expand",
            reason: "Device converteert duidelijk beter dan het accountgemiddelde.",
            evidence: `${cvrEvidence} | ${spendShareTekst}`,
          };
        }
        return {
          device: row.device,
          direction: "monitor",
          reason: `Device converteert beter dan het accountgemiddelde, maar het spend-aandeel (${roundTwo(spendShare * 100)}%) is te klein voor een richting.`,
          evidence: `${cvrEvidence} | ${spendShareTekst}`,
        };
      }
      return {
        device: row.device,
        direction: "monitor",
        reason: "Device zit binnen de neutrale bandbreedte ten opzichte van het accountgemiddelde.",
        evidence: cvrEvidence,
      };
    });
  return { decisions, opmerking: null };
}

// ── Bindende feiten ────────────────────────────────────────────────────────────────────────

function renderBindingFacts(output: DecisionRulesOutput, geoOpmerking: string | null, deviceOpmerking: string | null): string {
  const { dekking } = output;
  const lines: string[] = [];
  lines.push("## BINDENDE ACTIERICHTINGEN (door data bepaald, NIET wijzigen)");
  lines.push("");
  lines.push(`Account status: ${output.accountStatus}`);
  lines.push("");
  lines.push("### Campagne-richtingen");
  const onderDrempel = new Set(dekking.campagnesOnderDrempel);
  const beoordeeld = output.campaignDecisions.filter((decision) => !onderDrempel.has(decision.campaignName));
  if (beoordeeld.length === 0 && onderDrempel.size === 0) {
    lines.push("- Geen campagne-richtingen beschikbaar.");
  }
  beoordeeld.forEach((decision) => {
    lines.push(`- ${cleanDecisionText(decision.campaignName)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)} | Data: ${cleanDecisionText(decision.evidence)}`);
  });
  if (onderDrempel.size > 0) {
    lines.push(`- Onder de volumedrempel, geen richting: ${opsomming(dekking.campagnesOnderDrempel.map(cleanDecisionText))} (spend < €${MIN_CAMPAGNE_SPEND})`);
  }
  lines.push("");
  lines.push("### Geo-richtingen");
  if (!dekking.geoData) {
    lines.push("- Geen geo-data voor de analysemaand (ads_country_monthly loopt achter of ontbreekt): geen geo-richtingen.");
  } else if (output.geoDecisions.length === 0) {
    lines.push(`- Geen geo-richtingen: ${geoOpmerking ?? `alle ${dekking.landenOnderDrempel} landen onder de volumedrempel (spend < €${MIN_GEO_SPEND})`}.`);
  } else {
    output.geoDecisions.forEach((decision) => {
      lines.push(`- ${cleanDecisionText(decision.country)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)} | Efficiency ratio: ${decision.efficiencyRatio.toFixed(2)}`);
    });
    if (dekking.landenOnderDrempel > 0) {
      lines.push(`- Onder de volumedrempel (spend < €${MIN_GEO_SPEND}), geen richting: ${dekking.landenOnderDrempel} ${dekking.landenOnderDrempel === 1 ? "land" : "landen"}.`);
    }
  }
  lines.push("");
  lines.push("### Device-richtingen");
  if (!dekking.deviceData) {
    lines.push("- Geen device-data voor de analysemaand (ads_device_performance_monthly loopt achter of ontbreekt): geen device-richtingen.");
  } else if (output.deviceDecisions.length === 0) {
    lines.push(`- Geen device-richtingen: ${deviceOpmerking ?? "geen device met spend"}.`);
  } else {
    output.deviceDecisions.forEach((decision) => {
      lines.push(`- ${cleanDecisionText(decision.device)}: ${normalizeDirectionCase(decision.direction)} | ${cleanDecisionText(decision.reason)}`);
    });
  }
  if (dekking.opmerkingen.length > 0) {
    lines.push("");
    lines.push("### Dekking");
    dekking.opmerkingen.forEach((opmerking) => lines.push(`- ${cleanDecisionText(opmerking)}.`));
  }
  lines.push("");
  lines.push("REGEL: Formuleer GEEN acties die tegengesteld zijn aan bovenstaande richtingen.");
  lines.push("REDUCE = je mag NIET \"verhoog budget\" adviseren voor deze entiteit.");
  lines.push("EXPAND = je mag NIET \"verlaag budget\" adviseren voor deze entiteit.");
  lines.push("INVESTIGATE = formuleer alleen onderzoeksacties, geen directe wijzigingen.");
  lines.push("MONITOR = formuleer geen budget/bid wijzigingen, alleen monitoring.");
  return lines.join("\n");
}

export function computeDecisionRules(input: DecisionRulesInput): DecisionRulesOutput {
  const resultMetric = input.resultMetric ?? standaardResultMetric(input.accountType);
  const previousCampaignMap = new Map((input.previousCampaignRows ?? []).map((row) => [row.campaign_name, row]));
  const campaignResults = input.campaignRows
    .filter((row) => row.campaign_name)
    .map((row) => evaluateCampaignDirection({
      accountType: input.accountType,
      current: row,
      previous: previousCampaignMap.get(row.campaign_name),
      targets: input.targets,
    }));
  // Eén oordeel per campagnenaam (de laatste wint), zodat dezelfde campagne nooit EXPAND en
  // REDUCE tegelijk krijgt; de drempellijst volgt dezelfde dedupe.
  const dedupedCampaigns = Array.from(new Map(campaignResults.map((r) => [r.decision.campaignName, r])).values());
  const campaignDecisions = dedupedCampaigns.map((r) => r.decision);
  const campagnesOnderDrempel = dedupedCampaigns.filter((r) => r.onderDrempel).map((r) => r.decision.campaignName);

  const geo = evaluateGeoDecisions(input.geoRows, resultMetric);
  const device = evaluateDeviceDecisions(input.deviceRows, input.currentAccount);
  const account = computeAccountStatus({ currentAccount: input.currentAccount, targets: input.targets });

  const output: DecisionRulesOutput = {
    accountStatus: account.status,
    campaignDecisions,
    geoDecisions: geo.decisions,
    deviceDecisions: device.decisions,
    dekking: {
      campagnesOnderDrempel,
      geoData: input.geoRows.length > 0,
      deviceData: input.deviceRows.length > 0,
      landenOnderDrempel: geo.landenOnderDrempel,
      opmerkingen: [
        ...account.opmerkingen,
        ...(geo.opmerking ? [geo.opmerking] : []),
        ...(device.opmerking ? [device.opmerking] : []),
      ],
    },
    bindingFacts: "",
  };
  output.bindingFacts = renderBindingFacts(output, geo.opmerking, device.opmerking);
  return output;
}
