// Master Synthesis (Pijler 6), Fase B: validatie bovenop de Zod-schemacontrole
// (master-synthesis-schema.ts). Zod toetst de VORM; dit toetst de INHOUD tegen het evidence_payload
// -- het kan syntactisch geldige JSON zijn die toch een kanaal noemt dat niet is aangeleverd, en
// dat is precies de hallucinatie die het purity-contract verbiedt (zie master-synthesis-prompt.ts).
// Zelfde rol als validateStepOutput() in lib/analysis/step-validator.ts, maar voor deze eigen vorm.

import type { MasterSynthesisOutput } from "./master-synthesis-schema";
import { MASTER_SYNTHESIS_LOG_FORMAT } from "./master-synthesis-prompt";

export interface MasterSynthesisValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Losjes afgeleid van het log-format zelf (net als LOG_FORMAT_SKELETONS per kanaal): een
// log_entry hoort "Hypothese:" en een kanaalnaam te bevatten.
const LOG_FORMAT_SKELETON = [/hypothese/i, /google_ads|meta_ads|linkedin_ads|microsoft_ads/i];

export function validateMasterSynthesisOutput(
  output: MasterSynthesisOutput,
  availableChannels: readonly string[]
): MasterSynthesisValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const availableSet = new Set(availableChannels);

  // De kernregel: contributing_channels mag nooit een kanaal noemen dat niet is aangeleverd.
  for (const h of output.hypotheses) {
    const onbekend = h.contributing_channels.filter((c) => !availableSet.has(c));
    if (onbekend.length > 0) {
      errors.push(`Hypothese "${h.hypothesis.slice(0, 60)}" noemt kanaal/kanalen buiten het evidence_payload: ${onbekend.join(", ")}`);
    }
  }
  for (const t of output.tasks) {
    const onbekend = t.contributing_channels.filter((c) => !availableSet.has(c));
    if (onbekend.length > 0) {
      errors.push(`Taak "${t.title}" noemt kanaal/kanalen buiten het evidence_payload: ${onbekend.join(", ")}`);
    }
    if (t.hypothesis_index >= output.hypotheses.length) {
      errors.push(`Taak "${t.title}" heeft hypothesis_index ${t.hypothesis_index}, maar er zijn maar ${output.hypotheses.length} hypothese(s).`);
    }
  }

  // Purity: een hypothese met precies 1 bijdragend kanaal is geen kanaaloverstijgende synthese
  // op zichzelf (het purity-contract staat dit alleen toe als een cross-channel-groep meehielp,
  // wat we hier niet kunnen verifieren -- dus dit blijft een warning, geen harde fout).
  const singleChannel = output.hypotheses.filter((h) => h.contributing_channels.length === 1);
  if (singleChannel.length === output.hypotheses.length && output.hypotheses.length > 0) {
    warnings.push("Geen enkele hypothese noemt meer dan 1 bijdragend kanaal -- controleer of dit echt kanaaloverstijgend is.");
  }

  // AC-08-achtige log-format-check: minstens 60% van de log_entries conformeert.
  if (output.log_entries.length > 0) {
    const conform = (entry: string) => LOG_FORMAT_SKELETON.every((skeleton) => skeleton.test(entry));
    const conformCount = output.log_entries.filter(conform).length;
    if (conformCount / output.log_entries.length < 0.6) {
      warnings.push(`Log-format: minder dan 60% van de log_entries volgt "${MASTER_SYNTHESIS_LOG_FORMAT.slice(0, 40)}..." (${conformCount}/${output.log_entries.length} conform).`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
