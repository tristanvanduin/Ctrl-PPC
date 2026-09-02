// Master Synthesis (Pijler 6), Fase B: het uitvoerschema voor de kanaaloverstijgende synthese.
// Zelfde discipline als StepOutputSchema (lib/schema/analysis-schema.ts) -- Zod-gevalideerd,
// geen vrije tekst -- maar een eigen vorm: geen top_3_findings/issue_cluster (dat is de
// per-stap-Finding-vorm van de kanaal-SOP's), wel hypotheses met contributing_channels zodat
// elke hypothese traceerbaar blijft naar de kanalen die hem voedden. action_type/priority/
// frequency hergebruiken de bestaande, kanaal-agnostische enums uit analysis-schema.ts in
// plaats van een eigen vocabulaire te verzinnen.

import { z } from "zod";
import { ActionTypeEnum, FrequencyEnum, IceTotalSchema, PriorityEnum } from "@/lib/schema/analysis-schema";

export const ContributingChannelEnum = z.enum(["google_ads", "meta_ads", "linkedin_ads", "microsoft_ads"]);
export type ContributingChannel = z.infer<typeof ContributingChannelEnum>;

export const MasterSynthesisHypothesisSchema = z.object({
  hypothesis: z.string().min(1),
  expected_result: z.string().min(1),
  measurement_metric: z.string().min(1),
  timeframe: z.string().min(1),
  rationale: z.string().min(1),
  // Minstens 1: een hypothese zonder bijdragend kanaal is geen kanaaloverstijgende synthese.
  contributing_channels: z.array(ContributingChannelEnum).min(1),
  ice_impact: z.number().min(1).max(10),
  ice_confidence: z.number().min(1).max(10),
  ice_ease: z.number().min(1).max(10),
  // Gedeeld met RecommendationSchema: normaliseert een som-van-drie (tot 30) naar het gemiddelde.
  // Deze kopie zonder die normalisatie was de ice_total-valkuil die de kanaal-SOP's op 1 september
  // al hadden gedicht -- hier stond hij nog open.
  ice_total: IceTotalSchema,
});
export type MasterSynthesisHypothesis = z.infer<typeof MasterSynthesisHypothesisSchema>;

export const MasterSynthesisTaskSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1),
  action_type: ActionTypeEnum,
  contributing_channels: z.array(ContributingChannelEnum).min(1),
  // Index (0-based) in de hypotheses-array die deze taak voedt. Zelfde rol als
  // recommendation_index op TaskSchema (analysis-schema.ts) voor de kanaal-SOP's: Fase C
  // (opslag) heeft dit nodig om een sprint_items-rij aan de juiste sprint_hypotheses-rij te
  // koppelen (hypothesis_id) zonder op tekstgelijkheid te hoeven vertrouwen.
  hypothesis_index: z.number().int().min(0),
  priority: PriorityEnum,
  frequency: FrequencyEnum,
  due_date_days: z.number().int().min(1).max(365),
});
export type MasterSynthesisTask = z.infer<typeof MasterSynthesisTaskSchema>;

export const MasterSynthesisOutputSchema = z.object({
  narrative: z.string().min(50),
  log_entries: z.array(z.string()).min(1),
  hypotheses: z.array(MasterSynthesisHypothesisSchema).min(1).max(5),
  tasks: z.array(MasterSynthesisTaskSchema).max(5),
  step_conclusion: z.string().min(10),
});
export type MasterSynthesisOutput = z.infer<typeof MasterSynthesisOutputSchema>;
