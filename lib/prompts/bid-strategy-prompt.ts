// Hefboom 3: de promptbouwer voor de fit van de biedstrategie. De classificatie per campagne
// is al deterministisch gemaakt; het model prioriteert en formuleert het advies, het
// herclassificeert niet. Puur en los getest.
//
// De campagneregels dragen sinds de herbouw (1 september 2026) de maandschaal expliciet:
// de leerdrempels zijn per-maand-vuistregels, dus zonder venster in de tekst kan het model
// volume niet wegen. Kosten dragen een euroteken; doel en realisatie staan naast elkaar
// zodat de targethoogte-diagnose (review_target) navolgbaar is.

import type { BidFact, BidStrategySummary, BidGoal } from "@/lib/analysis/bid-strategy-facts";

function euro(n: number): string {
  return `€${n.toFixed(n >= 100 ? 0 : 2)}`;
}

function campaignLine(f: BidFact): string {
  const delen = [
    `strategie ${f.strategy}`,
    `${f.conversionsPerMaand} conversies/maand`,
    `${euro(f.cost)} kosten`,
  ];
  if (f.cpa !== null) delen.push(`CPA ${euro(f.cpa)}`);
  if (f.roas !== null && f.hasValue) delen.push(`ROAS ${f.roas}`);
  if (f.target !== null) {
    const doel = f.strategy.toUpperCase() === "TARGET_ROAS" ? `doel-ROAS ${f.target}` : `doel ${euro(f.target)}`;
    delen.push(f.targetRatio !== null ? `${doel} (realisatie ${Math.round(f.targetRatio * 100)}% van doel)` : doel);
  }
  if (!f.hasValue) delen.push("zonder conversiewaarde");
  return `- ${f.campaignName}: ${delen.join(", ")}. Diagnose: ${f.fit}. ${f.recommendation}.`;
}

function campaignLines(facts: BidFact[]): string {
  if (facts.length === 0) return "- geen";
  return facts.map(campaignLine).join("\n");
}

export function buildBidStrategyPrompt(input: {
  summary: BidStrategySummary;
  campaigns: BidFact[];
  goal: BidGoal;
  goalsSection?: string;
}): string {
  const doel = input.goal.hasRoasTarget
    ? `ROAS-doel${input.goal.roasTarget ? ` (${input.goal.roasTarget})` : ""}`
    : input.goal.hasCpaTarget
      ? `CPA-doel${input.goal.cpaTarget ? ` (${euro(input.goal.cpaTarget)})` : ""}`
      : "geen expliciet doel";
  const venster = `${input.summary.maandenInVenster} afgesloten maand${input.summary.maandenInVenster === 1 ? "" : "en"}`;
  return `Je bent een senior Google Ads-specialist. Beoordeel of de biedstrategieen per campagne passen bij het conversievolume, de waarde-tracking en het doel. De fit per campagne is al deterministisch voorgerekend; jouw taak is prioriteren en een concreet advies formuleren, niet herclassificeren.

## Voorgerekende samenvatting
Venster: de laatste ${venster} (lopende maand telt niet mee). Campagnes (actief): ${input.summary.campaignsAnalysed}. Passend: ${input.summary.fit}. Mismatches: ${input.summary.mismatches}. Doel van het account: ${doel}.

## Campagnes, mismatches vooraan, hoogste kosten eerst (voorgerekend)
${campaignLines(input.campaigns)}
${input.goalsSection ? `\n\n## Doelstellingen en targets\n${input.goalsSection}` : ""}

## Jouw analyse
- Behandel de mismatches op volgorde van impact (kosten door de verkeerde strategie) en leg per campagne uit waarom de huidige instelling knelt en wat de betere is.
- Bij diagnose review_target gaat het gesprek over de DOELWAARDE (tCPA/tROAS), niet over de strategie: benoem de kloof tussen doel en realisatie en adviseer een herijking in stappen van hooguit 15-20% tegelijk.
- Wees concreet over de overstap: van handmatig naar smart alleen bij genoeg volume; naar waarde-bieden alleen met conversiewaarde en genoeg volume.

## Regels
- Adviseer smart bidding UITSLUITEND bij campagnes met genoeg conversievolume om te leren (vuistregel: 15 per maand); raad het af bij te weinig volume.
- Adviseer waarde-bieden UITSLUITEND als de conversiewaarde betrouwbaar getrackt wordt.
- Alle volumes in de campagneregels zijn per maand, gemiddeld over het venster. Rapporteer tegen het doel uit de doelstellingen. Verzin geen cijfers; gebruik alleen de voorgerekende feiten.`;
}
