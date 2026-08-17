// Cross-channel als VERKLARENDE CONTEXT voor de hypotheses-stap van elke kanaal-SOP. Zelfde rol en
// vorm als lib/ga4/context.ts (channelGa4Context): één call -> een gelabeld promptContext-blok dat
// alleen in de hypotheses-stap wordt geschoven (Google stap 13 "Hypotheses & Sprintplanning",
// Meta/LinkedIn stap 6 "Hypotheses en Sprintplanning"). Cross-channel VERRIJKT die ene stap; de
// bestaande stap-logica en de andere stappen blijven ongemoeid.
//
// AANLEIDING (17 augustus 2026, masterplan 16.4/16.5): app/api/analysis/cross-channel/route.ts
// draaide volledig los van de kanaal-SOP's -- getriggerde signalen (dubbele warme pool,
// zaai-oogst, KPI-arbitrage, doelgroep-samenhang) landden wel in de hypothese-wachtrij
// (saveSignalHypotheses), maar geen enkele kanaal-LLM-stap wist dat ze bestonden. Een
// Meta-hypothese werd dus gegenereerd zonder te weten dat LinkedIn dezelfde warme pool retarget --
// "cross-channel" alleen in naam, niet in de redenering. Sectie 16.4 loste de TRIGGER-kant al op
// (cross-channel draait nu automatisch mee bij elke monthly-run); dit bestand lost de
// CONSUMPTIE-kant op.
//
// Geen valse versheid: de laatst opgeslagen run kan van een eerdere cyclus zijn dan deze analyse
// (cross-channel draait pas NA een monthly-SOP, zie app/api/cron/trigger-sops/route.ts -- de
// allereerste kanaal-run van een cyclus vindt dus nog geen verse cross-channel-data). De
// analysedatum staat daarom altijd expliciet in het blok, nooit stilzwijgend als "actueel"
// gepresenteerd.
//
// Geen valse zekerheid:
//  - nog nooit gedraaid -> promptContext = "" (nul promptwijziging; de hypotheses-stap draait
//    ongewijzigd door, zoals vóór deze koppeling).
//  - wel gedraaid -> de opgeslagen markdown-sectie plus een instructie over hoe te wegen.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CrossChannelContextBlock {
  available: boolean;
  analysisDate: string | null;
  promptContext: string;
}

const SOP_TYPE = "cross_channel";
const SECTION = "cross_channel_v1";
// Ruim genoeg voor de volledige sectie in het normale geval; een harde bovengrens tegen een
// uitzonderlijk lange run (veel getriggerde signalen) die de promptcontext laat ontsporen.
const MAX_CHARS = 6000;

export async function crossChannelContext(supabase: SupabaseClient, clientId: string): Promise<CrossChannelContextBlock> {
  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const output = data?.output ? String(data.output) : null;
  if (!output) {
    return { available: false, analysisDate: null, promptContext: "" };
  }

  const analysisDate = String((data as { analysis_date: string }).analysis_date);
  const truncated = output.length > MAX_CHARS
    ? `${output.slice(0, MAX_CHARS)}\n\n[…afgekapt; volledige cross-channel-analyse in Bestanden > SOP's]`
    : output;

  const lines: string[] = [
    "## CROSS-CHANNEL-CONTEXT (tussen de kanalen — verklarende laag; vervangt de eigen bevindingen van dit kanaal NIET)",
    "",
    `Laatst gedraaid: ${analysisDate} (kan van een eerdere cyclus zijn dan deze analyse — check de datum voordat je 'm als actueel citeert).`,
    "",
    truncated,
    "",
    "INSTRUCTIE — gebruik dit uitsluitend om hypotheses te VERRIJKEN of te NUANCEREN, niet om cijfers van dit kanaal te herschrijven:",
    "- Een hypothese die een patroon hierboven bevestigt of verklaart is sterker; noem de cross-channel-vinding er expliciet bij.",
    "- Een hypothese die dit blok tegenspreekt mag alsnog, maar benoem de tegenspraak — verzwijg 'm niet.",
    "- Verzin geen cross-channel-cijfers die niet hierboven staan.",
  ];

  return { available: true, analysisDate, promptContext: lines.join("\n") };
}
