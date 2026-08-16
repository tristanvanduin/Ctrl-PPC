// Master Synthesis (Pijler 6), Fase B: de prompt-laag voor de kanaaloverstijgende synthese-call.
// Zelfde grammatica als de kanaal-adapters (instructie + log-format + purity-contract
// aaneengehecht, VERBODEN-lijst, Nederlands), maar zelfstandig -- dit is geen ChannelAdapter
// (geen stepCount/stapnummers, één enkele call op het evidence_payload uit Fase A) en leunt dus
// bewust niet op buildMonthlyStepPrompt()/MONTHLY_BASE_ROLE (die zijn aan de per-stap-Finding-vorm
// van de kanaal-SOP's gekoppeld). De "geen cijfers verzinnen"-discipline staat hier expliciet in
// plaats van geimporteerd.

import { toPromptTable } from "@/lib/analysis/prompt-table";
import type { EvidencePayload } from "./evidence/build-payload";

export const MASTER_SYNTHESIS_LOG_FORMAT =
  'Log-formaat per hypothese: "Hypothese: {causale claim} - kanalen: {contributing_channels} - onderbouwing: {kanaal A: bevinding, kanaal B: bevinding} - evidence: deterministic/inferred/hypothesis."';

export const MASTER_SYNTHESIS_PURITY_CONTRACT = `### Step-Purity Contract
- Doel: kanaaloverstijgende hypotheses en sprinttaken synthetiseren uit reeds berekende Pijler 1-5-output en de deterministische cross-channel-feiten
- Leidende databronnen: uitsluitend het aangeleverde evidence_payload (per-kanaal aanbevelingen/taken plus cross-channel-groepen)
- Mag beoordelen: patronen die zich over minstens twee bronnen (kanalen, of een kanaal plus een cross-channel-groep) herhalen of elkaar verklaren
- Mag concluderen: hypotheses waarvan contributing_channels een subset is van de kanalen die daadwerkelijk in het evidence_payload voorkomen
- Mag NIET concluderen: een hypothese met een kanaal in contributing_channels dat niet in het evidence_payload zit; nieuwe cijfers, kanalen of bevindingen die niet letterlijk uit het evidence_payload komen; een hypothese die evenveel gewicht draagt als één los kanaal al zelf rapporteerde zonder dat er een cross-channel-verband is (dan hoort hij niet hier -- dat is het domein van het kanaal zelf)`;

export const MASTER_SYNTHESIS_INSTRUCTION = `## Pijler 6: Master Synthesis (kanaaloverstijgend)

Je krijgt het evidence_payload van deze klant: de sterkste aanbevelingen en taken uit de laatste
monthly-run van elk actief kanaal (Google Ads, Meta Ads, LinkedIn Ads), plus de deterministische
cross-channel-feiten (zaai-oogst, CPL-arbitrage, mix-shift, funnel, KPI-verhoudingen,
doelgroep-samenhang, GA4 CRO, data-volledigheid, bereikkosten/verzadiging).

### Werkwijze
1. Lees alle aangeleverde kanaal-aanbevelingen en cross-channel-groepen.
2. Zoek NIET naar wat elk kanaal al apart heeft gezegd -- zoek naar wat pas zichtbaar wordt
   OMDAT je meerdere bronnen naast elkaar legt: hetzelfde probleem dat in twee kanalen opduikt,
   een budgetverschuiving die de ene kanaal-bevinding verklaart, een cross-channel-signaal dat
   een kanaal-aanbeveling bevestigt of juist tegenspreekt.
3. Elke hypothese noemt expliciet welke kanalen (contributing_channels) hem voeden. Een
   hypothese met precies één bijdragend kanaal is alleen toegestaan als een cross-channel-groep
   hem mede onderbouwt (anders hoort hij bij dat ene kanaal, niet hier).
4. Formuleer sprinttaken die de aanbevolen actie combineren waar dat kan (bijvoorbeeld: één taak
   die een budgetverschuiving tussen twee kanalen behandelt, in plaats van twee losse taken).
5. Log in het voorgeschreven format, één regel per hypothese.

### Wat dit NIET is
Dit is geen zesde kanaalstap en geen samenvatting van de kanalen. Herhaal geen enkele
kanaal-aanbeveling letterlijk zonder een cross-channel-verband toe te voegen. Als het
evidence_payload geen enkel cross-kanaal-patroon laat zien, zeg dat expliciet in het narratief
en lever minder hypotheses (nooit kunstmatig opvullen tot het maximum).`;

const MASTER_SYNTHESIS_OUTPUT_SCHEMA_TEXT = `
Retourneer UITSLUITEND valid JSON. Geen markdown, geen backticks, geen extra tekst.

{
  "narrative": "string (minstens 300 woorden, Nederlands, legt uit WELK cross-kanaal-patroon je vond en WAAROM dat kanaaloverstijgend is)",
  "log_entries": ["string conform het log-format, 1 per hypothese"],
  "hypotheses": [
    {
      "hypothesis": "string (de causale claim)",
      "expected_result": "string (concreet, meetbaar)",
      "measurement_metric": "string",
      "timeframe": "string",
      "rationale": "string (verwijst expliciet naar de kanaal-bevindingen en/of cross-channel-groep die deze hypothese voedt)",
      "contributing_channels": ["google_ads"|"meta_ads"|"linkedin_ads", "..."],
      "ice_impact": "number 1-10",
      "ice_confidence": "number 1-10",
      "ice_ease": "number 1-10",
      "ice_total": "number 1-10"
    }
  ],
  "tasks": [
    {
      "title": "string (max 80 tekens)",
      "description": "string",
      "action_type": "budget|bid|targeting|creative|structure|tracking|audit|negative|website|content|feed",
      "contributing_channels": ["google_ads"|"meta_ads"|"linkedin_ads", "..."],
      "hypothesis_index": "number (0-based index van de hypothese in de hypotheses-array hierboven die deze taak voedt)",
      "priority": "critical|high|medium|low",
      "frequency": "direct|weekly|biweekly|monthly",
      "due_date_days": "number 1-365"
    }
  ],
  "step_conclusion": "string (1-2 zinnen samenvatting)"
}

REGELS:
- hypotheses: minimaal 1, maximaal 5. Minder is beter dan kunstmatig opvullen.
- tasks: maximaal 5, mogen leeg zijn als er geen concrete kanaaloverstijgende actie is.
- contributing_channels bevat UITSLUITEND kanalen die in het aangeleverde evidence_payload voorkomen. Nooit een kanaal noemen dat niet is aangeleverd.
- narrative en rationale MOETEN concreet verwijzen naar de aangeleverde kanaal- of cross-channel-bevindingen, nooit naar cijfers die niet in het evidence_payload staan.
`;

export function buildMasterSynthesisSystemPrompt(): string {
  return [
    "Je bent de Master Synthesis-laag van Ctrl PPC: je ontvangt GEEN ruwe advertentiedata, alleen al-berekende kanaalaanbevelingen en deterministische cross-channel-feiten. Reken zelf niets voor, verzin geen cijfers die niet zijn aangeleverd.",
    "",
    MASTER_SYNTHESIS_INSTRUCTION,
    "",
    MASTER_SYNTHESIS_LOG_FORMAT,
    "",
    MASTER_SYNTHESIS_PURITY_CONTRACT,
    "",
    "---",
    "",
    "## Verplicht output format",
    MASTER_SYNTHESIS_OUTPUT_SCHEMA_TEXT,
  ].join("\n");
}

export function buildMasterSynthesisUserMessage(payload: EvidencePayload): string {
  return [
    `Client: ${payload.clientId}. Periode t/m ${payload.periodEnd}.`,
    `Beschikbare kanalen in dit evidence_payload: ${payload.availableChannels.join(", ") || "geen"}.`,
    "",
    "## Evidence payload",
    "Reken uitsluitend met de onderstaande, al voorgerekende gegevens. Verzin geen kanalen, cijfers of bevindingen die hier niet in staan.",
    "",
    toPromptTable(payload),
  ].join("\n");
}
