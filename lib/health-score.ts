/**
 * Account Health Score (0–100) + Anomaly Detection
 *
 * Score is gebaseerd op 5 factoren (elk 0–20 punten):
 *
 * 1. TARGET TRACKING (20pt)
 *    Hoe dicht zit de prognose bij het jaardoel?
 *    100% = 20pt, 80% = 16pt, <50% = 0pt
 *
 * 2. SPEND EFFICIENCY (20pt)
 *    Wordt het budget efficiënt besteed? (CPA trend, ROAS vs target)
 *    Stabiel of dalend CPA = goed, stijgend = slecht
 *
 * 3. TREND (20pt)
 *    Volwassen account: hoe verhoudt het gerealiseerde zich tot de verwachting, die het jaardoel
 *    volgt? (prestatiefactor + laatste maand; de teksten zeggen "boven/op/onder verwachting")
 *    Opschalend account: verbetert of verslechtert de efficiency? (dat is wel een trend)
 *
 * 4. BUDGET UTILIZATION (20pt)
 *    Loopt de besteding op het budgettempo? 90% tot 110% = 20pt, daaronder minder (onderbesteding),
 *    daarboven ook minder (overbesteding); een jaarbudget dat al op is krijgt hooguit 4.
 *
 * 5. ACCOUNT HYGIENE (20pt)
 *    Zoekterm verspilling en ad group bleeders, als aandeel van de besteding over DEZELFDE 30 dagen.
 *    Geen waste = 20pt, veel waste = 0pt. Zonder verspillingsdata: niet beoordeeld.
 *
 * Anomalies zijn events die buiten normaal patroon vallen:
 * - MoM verandering > 30% in een metric
 * - CPC stijging > 25%
 * - Conversieratio daling > 25%
 * - Campagne stopt met spend
 * - Nieuw account zonder targets
 */

import type { ClientForecast } from "./forecast";
import type { ImpressionShareData, WastefulSearchTermData, AdGroupBleederData, ClientDataState } from "./use-client-data";
import { cpaTrendVanForecast, MIN_CONVERSIES_CPA_TREND } from "./analysis/trend";
import { formatPercent } from "@/lib/forecast-format";
import { jaardoelTekst, metToelichting } from "./analysis/standaard-jaardoel";

export interface HealthScore {
  /** 0–100, geschaald over de factoren die beoordeeld konden worden. */
  total: number;
  /** "?" wanneer er te weinig factoren beoordeeld zijn om een cijfer te geven. */
  grade: "A" | "B" | "C" | "D" | "F" | "?";
  color: string;               // tailwind color class
  factors: HealthFactor[];
  anomalies: Anomaly[];
  /** Hoeveel van de vijf factoren daadwerkelijk beoordeeld zijn. */
  assessedCount: number;
}

export interface HealthFactor {
  name: string;
  score: number;               // 0–20
  maxScore: number;            // always 20
  description: string;
  /**
   * False als er te weinig data is om deze factor te beoordelen. Zo'n factor telt NIET mee in
   * het totaal, ook niet als nul: ontbrekende kennis is geen slechte score en al helemaal geen
   * goede. Eerder kreeg een account zonder jaardoel de volle 20 punten op "Doelstelling",
   * waardoor een account dat WEL een doel had en er 90 procent van haalde (18 punten) lager
   * uitkwam dan een account waar niemand een doel had ingesteld. Het instellen van een doel
   * werd zo bestraft.
   */
  assessed: boolean;
}

export interface Anomaly {
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * De Trend-factor voor een volwassen account: de gewogen prestatiefactor en de laatste maand, allebei
 * tegen de verwachting. Los van computeHealthScore zodat lib/__tests__/health-trend.test.ts deze
 * drempels zelf toetst; daar stond een kopie die bij een wijziging hier gewoon groen bleef.
 */
export function trendOpVerwachting(pf: number, lastRatio: number): {
  score: number;
  achterstand: { severity: "critical" | "warning"; title: string } | null;
} {
  let base: number;
  if (pf > 1.15) base = 18;
  else if (pf > 1.05) base = 16;
  else if (pf > 0.95) base = 12;
  else if (pf > 0.85) base = 8;
  else if (pf > 0.75) base = 4;
  else base = 2;

  const modifier = lastRatio >= 1.0 ? 2 : lastRatio >= 0.85 ? 0 : -2;
  const achterstand = pf < 0.80 && lastRatio < 0.80
    ? { severity: "critical" as const, title: "Sterk achter op verwachting" }
    : pf < 0.90 && lastRatio < 0.90
      ? { severity: "warning" as const, title: "Achter op verwachting" }
      : null;
  return { score: clamp(base + modifier, 0, 20), achterstand };
}

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

export function computeHealthScore(
  forecast: ClientForecast,
  impressionShare?: ImpressionShareData[],
  wastefulTerms?: WastefulSearchTermData[],
  adGroupBleeders?: AdGroupBleederData[],
  /** De besteding over dezelfde 30 dagen als de verspillingslijsten; de noemer van Hygiëne. */
  besteding30d?: number | null,
  /**
   * De campagnes waarover besteding30d gaat. De noemer komt uit de accountstructuur, en die kent
   * alleen campagnes die nu aan staan; de lijsten tellen ook kosten van campagnes die in die 30
   * dagen gepauzeerd zijn. Zonder deze grens viel de verhouding bij een pauze te hoog uit.
   */
  noemerCampagnes?: ReadonlySet<string> | null,
): HealthScore {
  const factors: HealthFactor[] = [];
  const anomalies: Anomaly[] = [];

  const conv = forecast.conversions.kpi;
  const rev = forecast.revenue.kpi;
  const spend = forecast.adSpend.kpi;
  const realizedMonths = forecast.conversions.points.filter((p) => p.realized !== null);

  // ── 1. TARGET TRACKING (20pt) ──
  // How close is the adjusted annual to the target?
  //
  // Was: uitsluitend conv.annualTarget. Een omzet/ROAS-gedreven klant heeft doorgaans geen
  // conversiedoel maar wel een omzetdoel (zelfde onderscheid als getVocab in dgm-view.tsx) --
  // die kreeg deze factor dus altijd als "niet beoordeeld" (assessed: false), en scoorde
  // daardoor op maar 4 van de 5 factoren, ook al was er wel degelijk een doel om tegen af te
  // rekenen. Val terug op omzet zodra er geen conversiedoel is.
  const doelMetric = conv.annualTarget > 0 ? "conversions" : "revenue";
  const doelKpi = doelMetric === "conversions" ? conv : rev;
  const heeftDoel = doelKpi.annualTarget > 0;
  const targetRatio = heeftDoel ? doelKpi.adjustedAnnual / doelKpi.annualTarget : 0;
  const targetScore = heeftDoel ? clamp(Math.round(targetRatio * 20), 0, 20) : 0;
  // HERKOMST ERBIJ. Het doel waar deze factor tegen afrekent is óf ingevoerd in Instellingen (vast
  // of als groei), óf het standaarddoel: vorig jaar × 1,10 uit de route. Dat laatste is een
  // extrapolatie met een groeiaanname erin, geen afspraak, en wie vorig jaar exact herhaalt scoort
  // hier per constructie slecht; daar hoort "geschat" bij, anders leest een berekening als een
  // belofte. Hier stond die schatting ALTIJD, ook naast een ingevoerd doel ("Prognose 48% van het
  // geschatte jaardoel (...; er is nog geen doel ingevoerd)" naast 751 / 2.600 op de demo). De
  // herkomst komt nu met de prognose mee (mergeKpiTargets, ClientForecast.doelHerkomst).
  const doel = jaardoelTekst(forecast.doelHerkomst?.[doelMetric], { metric: doelMetric });
  const doelLang = jaardoelTekst(forecast.doelHerkomst?.[doelMetric], {
    metric: doelMetric, lidwoord: true, lang: true,
    // Staat het andere doel wel in Instellingen, dan "nog geen conversiedoel" en niet "nog geen doel".
    ander: forecast.doelHerkomst?.[doelMetric === "conversions" ? "revenue" : "conversions"],
  });
  factors.push({
    name: "Doelstelling",
    score: targetScore,
    maxScore: 20,
    description: heeftDoel
      ? `Prognose ${Math.round(targetRatio * 100)}% van ${metToelichting(doel)}`
      : "Geen jaardoel ingesteld — niet beoordeeld",
    assessed: heeftDoel,
  });

  if (targetRatio < 0.5 && heeftDoel) {
    anomalies.push({
      severity: "critical",
      title: doel.ingevoerd ? "Jaardoel in gevaar" : "Geschat jaardoel in gevaar",
      description: `Prognose is slechts ${Math.round(targetRatio * 100)}% van ${metToelichting(doelLang)}. Zonder ingrijpen wordt ${doel.ingevoerd ? "het" : "dat niveau"} niet gehaald.`,
    });
  }

  // ── 2. SPEND EFFICIENCY (20pt) ──
  const cpaPoints = forecast.cpa.points.filter((p) => p.realized !== null);
  // Zonder twee gerealiseerde maanden valt er geen trend te zien. Hier stond 14 als
  // "standaard: redelijk", en dat is een oordeel over een account waarover niets bekend is.
  //
  // Een maand met kosten en geen enkele conversie (geenNoemer) heeft geen CPA en viel daardoor uit
  // de trend: na juni gepauzeerd en juli € 2.000 zonder conversie zei de score "CPA stabiel of
  // dalend". Valt zo'n maand in het recente venster van de trend, dan is de efficiency op zijn
  // slechtst, en dat zegt een waarschuwing erbij. Die regel staat in cpaTrendVanForecast
  // (lib/analysis/trend.ts), zodat de inzichten en aanbevelingen hetzelfde zeggen; daar ook dat een
  // maand met restkosten onder één gewone CPA niet meetelt.
  const t = cpaTrendVanForecast(forecast);
  const zonderConversies = t.zonderConversies;
  // Te weinig conversies in een van beide vensters: geen oordeel. Hier stond dan t.pct ?? 0,
  // en dat is "stabiel", 16 van de 20 punten, over een vergelijking die toeval is.
  const efficiencyBeoordeeld = zonderConversies.length > 0 || (cpaPoints.length >= 2 && !t.teWeinigConversies);
  let efficiencyScore = 0;

  if (zonderConversies.length > 0) {
    efficiencyScore = 4;
    const maanden = zonderConversies.join(", ");
    anomalies.push({
      severity: "warning",
      title: "Kosten zonder conversies",
      description: `In ${maanden} waren er kosten zonder één conversie: daar is geen CPA te berekenen, en slechter wordt de efficiency niet.`,
    });
  } else if (efficiencyBeoordeeld) {
    // Gedeelde berekening en drempels (lib/analysis/trend.ts). Hier stond een eigen kopie die
    // de eerste maand met de laatste vergeleek; zes plekken deden dat, met vier verschillende
    // drempels, waardoor twee blokken op hetzelfde scherm elkaar konden tegenspreken.
    const firstCpa = t.vorig;
    const lastCpa = t.huidig;
    const cpaTrend = t.pct ?? 0;

    if (cpaTrend < -10) efficiencyScore = 20;       // CPA dalend = excellent
    else if (cpaTrend < 5) efficiencyScore = 16;     // Stabiel
    else if (cpaTrend < 20) efficiencyScore = 10;    // Licht stijgend
    else efficiencyScore = 4;                         // Sterk stijgend

    if (cpaTrend > 25) {
      anomalies.push({
        severity: "warning",
        title: "CPA stijgt snel",
        description: `CPA steeg ${Math.round(cpaTrend)}% van ${fmt(firstCpa)} naar ${fmt(lastCpa)}.`,
      });
    }
    if (cpaTrend < -25) {
      anomalies.push({
        severity: "info",
        title: "CPA daalt sterk",
        description: `CPA daalde ${Math.round(Math.abs(cpaTrend))}%. Efficiency verbetert.`,
      });
    }
  }

  factors.push({
    name: "Efficiency",
    score: efficiencyScore,
    maxScore: 20,
    description: !efficiencyBeoordeeld
      ? t.teWeinigConversies
        ? `Minder dan ${MIN_CONVERSIES_CPA_TREND} conversies in een van de vergeleken perioden: de CPA-verandering is toeval — niet beoordeeld`
        : "Te weinig maanden voor een CPA-trend — niet beoordeeld"
      : zonderConversies.length > 0 ? "Kosten zonder conversies"
      : efficiencyScore >= 16 ? "CPA stabiel of dalend" : efficiencyScore >= 10 ? "CPA licht stijgend" : "CPA stijgt significant",
    assessed: efficiencyBeoordeeld,
  });

  // ── 3. TREND (20pt) ──
  //
  // Two modes:
  //   A) Mature client: projectionFactor + lastRatio (standard)
  //   B) Scaling/limited data client: efficiency trend (conv/spend) is the real signal
  //      because raw conversion growth just reflects spend scaling, not account health.
  //
  // The forecast engine's dataMaturity tells us which mode to use.
  // Zonder twee gerealiseerde maanden is er geen trend om te zien.
  const trendBeoordeeld = realizedMonths.length >= 2;
  let trendScore = 10;
  // Welke modus de score bepaalde: bij een opschalend account meet hij de efficiency, en dat IS een
  // trend; bij een volwassen account meet hij de afstand tot de verwachting (zie hieronder).
  let opVerwachting = false;
  // De factor rekent op conversies (conv.projectionFactor), dus het doel van conversies.
  const trendDoel = jaardoelTekst(forecast.doelHerkomst?.conversions, { lidwoord: true });
  {
    const dm = forecast.dataMaturity;
    const pf = conv.projectionFactor;
    const lastRatio = realizedMonths.length > 0
      ? realizedMonths[realizedMonths.length - 1].monthRatio
      : 1.0;

    if (dm.isScaling && !dm.isMature) {
      // ── Scaling client: judge on EFFICIENCY trend, not raw conversions ──
      // If spend doubles and conversions double → neutral (efficiency stable)
      // If spend doubles and conversions triple → great (efficiency improving)
      // If spend doubles and conversions stay flat → bad (efficiency declining)
      const et = dm.efficiencyTrend;  // >1 = improving, <1 = declining

      let base: number;
      if (et > 1.10) base = 20;       // efficiency improving 10%+
      else if (et > 1.02) base = 16;  // slightly improving
      else if (et > 0.95) base = 12;  // stable efficiency while scaling
      else if (et > 0.85) base = 8;   // declining efficiency
      else base = 4;                   // significant efficiency loss

      // Small modifier for absolute last-month performance
      const modifier = lastRatio >= 1.0 ? 2 : lastRatio >= 0.85 ? 0 : -2;
      trendScore = clamp(base + modifier, 0, 20);

      // Anomaly: efficiency dropping while scaling
      if (et < 0.80) {
        anomalies.push({
          severity: "warning",
          title: "Efficiency daalt bij opschaling",
          description: `Conversieratio per € spend daalde ${Math.round((1 - et) * 100)}% terwijl budget groeit. CPA stijgt.`,
        });
      }
    } else {
      // ── Mature client: use projectionFactor as primary signal ──
      opVerwachting = true;
      const opVerw = trendOpVerwachting(pf, lastRatio);
      trendScore = opVerw.score;

      // Anomalies: only flag genuinely concerning situations
      //
      // WAT HIER GEMETEN WORDT. pf en lastRatio zijn gerealiseerd gedeeld door de VERWACHTING, en die
      // verwachting is het jaardoel over de maanden verdeeld (forecastCoreMetric schaalt hem naar het
      // doel). Een lage waarde zegt dus dat het account achterloopt op dat doel, niet dat de
      // conversies dalen. Hier stond "Sterke neerwaartse trend" en "Dalende trend": met een hoog
      // ingevoerd doel (de demo: 2.600 tegen een tempo van ongeveer 1.300) leek een vlak account zo
      // in vrije val. De drempels en de ernst blijven; alleen de woorden zeggen nu wat er gemeten is.
      const verwachting = `Gewogen prestatiefactor ${formatPercent(pf, 0)}, laatste maand ${formatPercent(lastRatio, 0)} van verwachting. `
        + `De verwachting volgt ${metToelichting(trendDoel)}: dit meet de achterstand op dat doel, niet of de conversies dalen.`;
      if (opVerw.achterstand) {
        anomalies.push({ ...opVerw.achterstand, description: verwachting });
      }
    }

    // MoM anomalies — only flag if it's both a big drop AND below expectations
    if (realizedMonths.length >= 2) {
      for (let i = 1; i < realizedMonths.length; i++) {
        const prev = realizedMonths[i - 1];
        const curr = realizedMonths[i];
        if (prev.realized && curr.realized && prev.realized > 0) {
          const momChange = ((curr.realized - prev.realized) / prev.realized) * 100;
          if (momChange < -30 && curr.monthRatio < 0.80) {
            anomalies.push({
              severity: "warning",
              title: `Scherpe daling ${prev.monthLabel}→${curr.monthLabel}`,
              description: `Conversies daalden ${Math.round(Math.abs(momChange))}% in één maand.`,
            });
          }
        }
      }
    }
  }

  factors.push({
    name: "Trend",
    score: trendBeoordeeld ? trendScore : 0,
    maxScore: 20,
    // Dezelfde drempels op de score als altijd. Bij een volwassen account zegt de tekst wat er gemeten
    // is: "Neerwaartse trend" stond er ook bij een vlak account onder een hoog doel.
    //
    // Zonder conversiedoel is er geen verwachting: forecastCoreMetric schaalt de verwachting naar dat
    // doel, dus is hij overal nul, de factor 1,0 en de score 14. Daar stond "Op verwachting (de
    // verwachting volgt het geschatte jaardoel)" naast "Geen jaardoel ingesteld" van de Doelstelling-
    // factor. "Stabiel" (de oude tekst) is ook niet gemeten: een dalend account zonder doel kreeg het.
    description: !trendBeoordeeld
      ? "Te weinig maanden voor een trend — niet beoordeeld"
      : opVerwachting && conv.annualTarget <= 0
        ? "Geen jaardoel, dus geen verwachting om tegen te meten — neutraal"
      : opVerwachting
        ? `${trendScore >= 16 ? "Boven verwachting" : trendScore >= 10 ? "Op verwachting" : "Onder verwachting"} (de verwachting volgt ${trendDoel.naam})`
        : trendScore >= 16 ? "Opwaartse trend" : trendScore >= 10 ? "Stabiel" : "Neerwaartse trend",
    assessed: trendBeoordeeld,
  });

  // ── 4. BUDGET UTILIZATION (20pt) ──
  // Zonder budgetdoel valt er niets te benutten. Hier stond een terugval op ratio 1, wat de
  // volle 20 punten en de tekst "Budget wordt goed benut" opleverde voor een account waar
  // niemand een budget had ingesteld.
  const budgetBeoordeeld = spend.annualTarget > 0 && spend.ytdExpected > 0;
  let budgetScore = 0;
  const spendRatio = budgetBeoordeeld ? spend.ytdRealized / spend.ytdExpected : 0;

  // Een bovengrens. Hier gaf alles boven 0,90 de volle 20 met "Budget wordt goed benut", ook 150%
  // en ook een jaarbudget dat in oktober al op was (de demo: € 117.300 van € 117.000, terwijl het
  // pacingblok eronder "Inefficiënt" zei). Overbesteding is net zo goed een afwijking van het plan.
  const jaarbudgetOp = budgetBeoordeeld && spend.ytdRealized >= spend.annualTarget;
  if (spendRatio > 1.50) budgetScore = 4;
  else if (spendRatio > 1.25) budgetScore = 8;
  else if (spendRatio > 1.10) budgetScore = 14;
  else if (spendRatio > 0.90) budgetScore = 20;
  else if (spendRatio > 0.75) budgetScore = 16;
  else if (spendRatio > 0.50) budgetScore = 10;
  else if (spendRatio > 0.25) budgetScore = 4;
  else budgetScore = 0;
  if (jaarbudgetOp) budgetScore = Math.min(budgetScore, 4);

  if (impressionShare && impressionShare.length > 0) {
    const highBudgetLost = impressionShare.filter((is) => is.searchBudgetLostIS > 0.30);
    if (highBudgetLost.length > 0) {
      budgetScore = Math.max(budgetScore - 4, 0);
      anomalies.push({
        severity: "warning",
        title: `${highBudgetLost.length} campagne(s) budget-gelimiteerd`,
        description: `Campagnes verliezen >30% IS door budget. Direct groeipotentieel.`,
      });
    }
  }

  factors.push({
    name: "Budget",
    score: budgetBeoordeeld ? budgetScore : 0,
    maxScore: 20,
    description: !budgetBeoordeeld
      ? "Geen budgetdoel ingesteld — niet beoordeeld"
      : jaarbudgetOp ? `Jaarbudget is al op: ${fmt(spend.ytdRealized)} van ${fmt(spend.annualTarget)} besteed`
      : spendRatio > 1.10 ? `Overbesteding: ${Math.round((spendRatio - 1) * 100)}% boven het budgettempo`
      : spendRatio > 0.85 ? "Budget loopt op tempo" : `Onderbesteding: ${Math.round(spendRatio * 100)}% van het budgettempo besteed`,
    assessed: budgetBeoordeeld,
  });

  // ── 5. ACCOUNT HYGIENE (20pt) ──
  // Zonder besteding is er niets om te verspillen. Een leeg account kreeg hier de volle 20
  // punten met de tekst "Weinig verspilling" — een uitspraak over een account waar niets in
  // omgaat.
  //
  // Teller en noemer over HETZELFDE venster. De verspillingslijsten gaan over de laatste 30 dagen;
  // de noemer was de besteding van het hele jaar tot nu. Dezelfde verspilling gaf zo in februari
  // 10% (score 10) en in november 1% (score 17, "Weinig verspilling"): de score werd in de loop
  // van het jaar vanzelf groener. Zonder besteding over die 30 dagen geen oordeel.
  //
  // En geen dubbeltelling: een advertentiegroep zonder conversies bevat alleen zoektermen zonder
  // conversies, en die stonden ook in de zoektermlijst. Hun kosten tellen nu een keer, via de groep.
  //
  // Zonder verspillingsdata (de lijsten zijn niet meegegeven) is er niet gekeken: dat is geen
  // "weinig verspilling". Zo gaf de kanaalkaart Google 57 en het tabblad 66, voor hetzelfde account.
  let hygieneScore = 20;

  const wasteAmount = wastefulTerms?.reduce((s, t) => s + t.cost, 0) ?? 0;
  const bleederAmount = adGroupBleeders?.reduce((s, b) => s + b.cost, 0) ?? 0;
  const bleederGroepen = new Set((adGroupBleeders ?? []).map((b) => JSON.stringify([b.campaignName, b.adGroupName])));
  const wasteBuitenBleeders = (wastefulTerms ?? [])
    .filter((t) => !bleederGroepen.has(JSON.stringify([t.campaignName, t.adGroupName])))
    .reduce((s, t) => s + t.cost, 0);
  const totalWaste = wasteBuitenBleeders + bleederAmount;
  // Alleen voor de verhouding: verspilling in campagnes buiten de noemer telt daar niet, maar blijft
  // in de meldingen hieronder en wordt in de omschrijving genoemd.
  const inNoemer = (c: string) => !noemerCampagnes || noemerCampagnes.has(c);
  const wasteInNoemer = (wastefulTerms ?? [])
    .filter((t) => inNoemer(t.campaignName) && !bleederGroepen.has(JSON.stringify([t.campaignName, t.adGroupName])))
    .reduce((s, t) => s + t.cost, 0)
    + (adGroupBleeders ?? []).filter((b) => inNoemer(b.campaignName)).reduce((s, b) => s + b.cost, 0);
  const wasteBuitenNoemer = totalWaste - wasteInNoemer;
  const verspillingBekend = wastefulTerms !== undefined || adGroupBleeders !== undefined;
  const totalSpend = typeof besteding30d === "number" && Number.isFinite(besteding30d) ? besteding30d : 0;
  const wasteRatio = totalSpend > 0 ? Math.min(wasteInNoemer / totalSpend, 1) : 0;

  if (wasteRatio > 0.15) hygieneScore = 4;
  else if (wasteRatio > 0.08) hygieneScore = 10;
  else if (wasteRatio > 0.03) hygieneScore = 14;
  else if (wasteRatio > 0.01) hygieneScore = 17;

  if (wasteAmount > 200) {
    anomalies.push({
      severity: "warning",
      title: "Zoekterm verspilling",
      description: `${fmt(wasteAmount)} uitgegeven aan zoektermen met 0 conversies (30d).`,
    });
  }
  if (bleederAmount > 200) {
    anomalies.push({
      severity: "warning",
      title: "Ad group bleeders",
      description: `${fmt(bleederAmount)} in ad groups met 0 conversies (30d).`,
    });
  }

  const hygieneBeoordeeld = verspillingBekend && totalSpend > 0;
  factors.push({
    name: "Hygiëne",
    score: hygieneBeoordeeld ? hygieneScore : 0,
    maxScore: 20,
    description: !verspillingBekend
      ? "Geen verspillingsdata (zoektermen, ad groups) — niet beoordeeld"
      : !hygieneBeoordeeld
      ? "Geen besteding in de laatste 30 dagen bekend — niet beoordeeld"
      : (hygieneScore >= 17 ? `Weinig verspilling (${formatPercent(wasteRatio, 1)} van de besteding, 30d)` : `${Math.round(wasteRatio * 100)}% van de besteding naar 0-conversie items (30d)`)
        + (wasteBuitenNoemer > 0.5 ? `; ${fmt(wasteBuitenNoemer)} in campagnes die nu niet aan staan telt niet mee` : ""),
    assessed: hygieneBeoordeeld,
  });

  // Sort anomalies by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { factors, anomalies, ...samenvatFactoren(factors) };
}

/**
 * Alleen beoordeelde factoren tellen mee, en het totaal wordt geschaald naar 100 zodat de
 * grenzen voor A tot en met F blijven kloppen. Zou een niet-beoordeelde factor als nul
 * meetellen, dan zakt een account met weinig data naar een F terwijl er niets mis is; telde
 * hij als vol mee, dan kreeg een leeg account een B. Geen van beide is waar: het antwoord
 * is dat we het niet weten.
 *
 * Los van computeHealthScore geëxporteerd zodat een aanroeper achteraf een factor kan
 * herbeoordelen (bijv. channel-health-badge.tsx dat Hygiëne voor Meta/LinkedIn op "niet
 * beoordeeld" zet) zonder deze rekensom een tweede keer te schrijven.
 */
export function samenvatFactoren(factors: readonly HealthFactor[]): Pick<HealthScore, "total" | "grade" | "color" | "assessedCount"> {
  const beoordeeld = factors.filter((f) => f.assessed);
  const behaald = beoordeeld.reduce((s, f) => s + f.score, 0);
  const haalbaar = beoordeeld.reduce((s, f) => s + f.maxScore, 0);
  const total = haalbaar > 0 ? Math.round((behaald / haalbaar) * 100) : 0;

  // Onder de helft van de factoren is een cijfer niet vol te houden. Dat is geen slechte score
  // maar een onbekende, en die hoort als zodanig in beeld te komen.
  const genoegBasis = beoordeeld.length >= 3;

  const grade: HealthScore["grade"] =
    !genoegBasis ? "?" :
    total >= 85 ? "A" :
    total >= 70 ? "B" :
    total >= 55 ? "C" :
    total >= 40 ? "D" : "F";

  const color =
    !genoegBasis ? "text-muted-foreground" :
    total >= 85 ? "text-green-600" :
    total >= 70 ? "text-green-500" :
    total >= 55 ? "text-amber-500" :
    total >= 40 ? "text-orange-500" : "text-red-500";

  return { total, grade, color, assessedCount: beoordeeld.length };
}

/**
 * De health-score van Google uit de toestand van de klantdata, voor ELKE plek die hem toont.
 *
 * De kanaalkaart en de ranking riepen computeHealthScore zonder verspillingsdata aan en haalden
 * Hygiëne er daarna uit (57); het tabblad en Doelen & voortgang gaven de lijsten wel mee (66).
 * Twee getallen voor hetzelfde account en hetzelfde jaar, die als een rekenfout lazen. Met een
 * aanroep met dezelfde invoer is er een getal: met Hygiëne als de lijsten er zijn, zonder (en dan
 * "niet beoordeeld") als ze er niet zijn.
 */
export type GoogleHealthInvoer = Pick<ClientDataState, "impressionShare" | "wastefulSearchTerms" | "adGroupBleeders" | "accountStructure">;

export function googleHealthScore(forecast: ClientForecast, staat?: GoogleHealthInvoer | null): HealthScore {
  const campagnes = staat?.accountStructure?.campaigns;
  const besteding30d = campagnes ? campagnes.reduce((s, c) => s + (Number.isFinite(c.cost30d) ? c.cost30d : 0), 0) : null;
  const noemer = campagnes ? new Set(campagnes.map((c) => c.name)) : null;
  return computeHealthScore(forecast, staat?.impressionShare, staat?.wastefulSearchTerms, staat?.adGroupBleeders, besteding30d, noemer);
}

/**
 * Voor kanalen zonder Google-specifieke verspillingsdata (Meta, LinkedIn). computeHealthScore zet
 * Hygiëne zonder lijsten al op "niet beoordeeld" ("Geen verspillingsdata"); dit vervangt alleen de
 * omschrijving, zodat er staat dat dit kanaal zo'n lijst niet kent in plaats van dat hij ontbreekt,
 * en herschaalt het totaal. Elke aanroep van computeHealthScore zonder lijsten (ook
 * detecteer-code-rood, dat alleen de anomalieën gebruikt) krijgt dezelfde "niet beoordeeld".
 */
export function zonderKanaalSpecifiekeHygiene(health: HealthScore): HealthScore {
  const factors = health.factors.map((f) => f.name === "Hygiëne"
    ? { ...f, assessed: false, score: 0, description: "Niet beoordeeld voor dit kanaal — geen equivalent van Google's zoekterm-/ad group-verspilling." }
    : f
  );
  return { ...health, factors, ...samenvatFactoren(factors) };
}
