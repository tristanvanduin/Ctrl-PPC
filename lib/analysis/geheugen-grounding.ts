// Het geheugenblok van een SOP-run: alles wat we van deze klant weten uit eerdere runs.
//
// ── WAAROM DIT EEN EIGEN MODULE IS ──────────────────────────────────────────
//
// Negen aanroepplekken over drie routes: drie kanalen maal drie cadansen. Het blok stond eerst
// alleen in de monthly, daarna als lokale helper in monthly/route.ts, en de weekly en bi-weekly
// bouwden ondertussen hun eigen halve versie -- wél het client-geheugen, geen taken. Drie kopieën
// van dezelfde regels is precies de median/safeDiv-les uit AGENTS.md, en hier kost hij meer dan
// netheid: loopt één kopie achter, dan krijgt die cadans stilzwijgend minder context dan de rest
// en ziet niemand dat aan de uitvoer.
//
// ── WAT ERIN ZIT ────────────────────────────────────────────────────────────
//
//   client-geheugen   wat er in eerdere analyses is vastgesteld over deze klant. Kanaalneutraal:
//                     client_memory gaat over de klant, niet over een advertentieplatform.
//   taakstatus        de openstaande en afgeronde taken van de vorige cyclus, met de instructie
//                     afgeronde taken niet te herhalen tenzij de cijfers aantoonbaar terugvielen.
//
// Die tweede helft is waar het om gaat bij de vaak draaiende cadansen. Een weekly die niet weet
// dat een taak is afgerond, beveelt hem 52 keer per jaar opnieuw aan. Het openstaande-punten-blok
// uit monthly-handoff.ts dekt dat niet: dat toont de eigen nog OPEN aanbevelingen, niet wat er
// daadwerkelijk is uitgevoerd -- en juist "dit is gedaan" is wat herhaling voorkomt.
//
// ── WAAROM ÉÉN ARGUMENT EN GEEN TWEE ────────────────────────────────────────
//
// De twee bronnen beschrijven hetzelfde soort ding: wat er eerder is vastgesteld en wat er eerder
// is afgesproken. De promptbouwers laten een leeg blok al byte-identiek weg, dus een klant zonder
// historie krijgt precies dezelfde prompt als voordat dit bestond -- de eigenschap waar de
// prefix-cache op staat.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientMemory, buildClientMemoryGrounding } from "@/lib/memory/client-memory";
import { buildTaskStatusGrounding } from "@/lib/tasks/task-tracking";
import { priorTasksVoorGrounding } from "@/lib/tasks/prior-tasks";

/**
 * Hoeveel taken er per cadans mee de prompt in gaan.
 *
 * Niet één getal voor alles, want de drie prompts zijn niet even lang. De monthly heeft ruimte en
 * een cyclus van een maand om over te rapporteren; de weekly is expliciet "geen diepe analyse" en
 * draagt daarnaast al een maand-handoff en een openstaande-punten-blok. Veertig regels taakhistorie
 * zouden daar de rest verdringen.
 *
 * De verhouding volgt de cadans zelf: hoe vaker een analyse draait, hoe korter het venster waarover
 * "vorige cyclus" iets betekent. Twaalf is ruim twee weken aan taken bij de weekly, twintig dekt de
 * bi-weekly ruimschoots.
 *
 * Wat buiten de limiet valt wordt GEMELD en niet stil weggelaten -- zie buildTaskStatusGrounding.
 * Dit blok eindigt met "Verzin geen taken die hier niet staan"; een stille afkapping vertelt het
 * model dan dat een echte openstaande taak niet bestaat.
 */
export const TAAKLIMIET: Record<"weekly" | "biweekly" | "monthly", number> = {
  weekly: 12,
  biweekly: 20,
  monthly: 40,
};

export interface GeheugenOpties {
  supabase: SupabaseClient;
  clientId: string;
  /** Taken van vóór deze datum tellen mee. In de praktijk periodEnd van de run. */
  voorDatum: string;
  /** De sop_type-sleutel van deze run. Begrenst de taken tot het eigen kanaal (migratie 104). */
  sopType: string;
  /** Cadans, alleen voor de limiet. Zie TAAKLIMIET. */
  cadans: "weekly" | "biweekly" | "monthly";
}

/**
 * Bouwt het gecombineerde geheugenblok. Faalt zacht: beide bronnen geven bij een fout een lege
 * string terug, en dan draait de analyse zonder blok in plaats van helemaal niet.
 */
export async function buildGeheugenMetTaken(opts: GeheugenOpties): Promise<string> {
  const { supabase, clientId, voorDatum, sopType, cadans } = opts;
  const clientMemorySection = buildClientMemoryGrounding(await getClientMemory(supabase, clientId));
  const selectie = await priorTasksVoorGrounding(supabase, clientId, voorDatum, sopType, TAAKLIMIET[cadans]);
  const taakStatusSection = buildTaskStatusGrounding(selectie.taken, selectie.weggelaten);
  return [clientMemorySection, taakStatusSection].filter(Boolean).join("\n\n");
}

/**
 * Hetzelfde blok, met de lege regel ervoor die een contextketen van elk blok verwacht.
 *
 * De weekly en de bi-weekly plakken hun contextblokken achter elkaar ZONDER scheiding
 * (`${ketenContext}${geheugenMetTaken}${enrichment.strategicContext}...`), dus draagt elk blok zijn
 * eigen voorloop. fetchStrategicContext doet dat (`return `\n\n## Strategische context...``), en de
 * andere lagen ook -- buildClientMemoryGrounding als enige niet: die begint direct met `##`.
 *
 * Daardoor kwam de kop van het geheugenblok op dezelfde regel te staan als het laatste opsommings-
 * teken van het blok ervoor:
 *
 *   - [2026-08-01] Bod verlagen (meet op cpa)## Eerdere analyses en hypotheses (client-geheugen)
 *
 * Een `##` middenin een regel is geen kop meer; het model leest hem als staart van die bullet. Dat
 * gold al voor het kale geheugenblok en zou met de taakstatus erbij alleen langer worden.
 *
 * De monthly gebruikt dit NIET: buildMonthlyStepPrompt zet er zelf al een `\n\n` voor, en twee
 * voorlopen zouden daar een extra lege regel opleveren en dus een andere prompt.
 */
export function alsContextBlok(blok: string): string {
  return blok ? `\n\n${blok}` : "";
}
