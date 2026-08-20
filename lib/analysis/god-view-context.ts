import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGodViewInvoerRijen } from "../benchmark/god-view-data";
import { bouwGodViewCellen, type GodViewCel } from "../benchmark/god-view";
import { TEST_DREMPELS } from "../benchmark/cel";
import { nicheLabel, type Bedrijfsmodel } from "../benchmark/segment";
import type { SopChannel } from "./sop-channel-config";

// Demo-/testklanten ("demo-" als clientId-prefix, zelfde conventie als elders in de codebase --
// o.a. components/dashboard/client-dashboard.tsx's tab-nav-scoping) draaien altijd met
// TEST_DREMPELS (lib/benchmark/cel.ts), nooit met de echte k-anonimiteitsgrens. Zelfde regel en
// herkomst als /api/platform/god-view/route.ts's ?testdrempel=true: "anonimiteit in de test fase
// boeit me niet... bij relevantie moet het gewoon getriggerd worden" (eigenaar, 17 aug 2026).
// Een echte klant-clientId raakt dit pad nooit -- geen enkele voorwaarde hier onderscheidt op
// tier of rol, alleen op het "demo-"-voorvoegsel dat uitsluitend seed-scripts uitgeven.
function isDemoClientId(clientId: string): boolean {
  return clientId.startsWith("demo-");
}

// God View als verklarende context voor de hypotheses-stap (masterplan 16.7), zelfde rol en
// plek als lib/analysis/cross-channel-context.ts (16.5): landt alleen in de hypotheses-stap van
// elke kanaal-SOP, verrijkt haar, vervangt niets.
//
// GEEN VALSE ZEKERHEID, STERKER DAN BIJ GA4/CROSS-CHANNEL: met de huidige, kleine bureaupool (zie
// masterplan 16.6/16.7) is `beoordeelCel()` in lib/benchmark/cel.ts vrijwel altijd "niet
// deelbaar" -- niet een tijdelijk datagat zoals bij GA4, maar de k-anonimiteitsregel die precies
// doet waarvoor hij bestaat. Deze functie degradeert dan ook stil naar promptContext = "" -- geen
// "onvoldoende data"-ruis in elke run, gewoon niets, exact hetzelfde patroon als een klant zonder
// GA4-koppeling. Zodra er 4+ opt-in-bureaus zijn licht dit vanzelf op, zonder codewijziging.

export interface GodViewContextBlock {
  available: boolean;
  promptContext: string;
}

interface GodViewMatch {
  label: string;
  cel: GodViewCel;
}

// Gedeelde celselectie tussen godViewContext() (prompt-tekst voor de LLM) en
// fetchGodViewComparison() (gestructureerde vergelijking voor de PDF) -- zelfde voorkeursvolgorde
// (combinatie eerst, dan niche, dan model), niet twee keer los onderhouden.
async function findBestGodViewCell(supabase: SupabaseClient, clientId: string, channel: SopChannel): Promise<GodViewMatch | null> {
  const { data: settings } = await supabase.from("client_settings").select("bedrijfsmodel, niche").eq("client_id", clientId).maybeSingle();
  const s = settings as { bedrijfsmodel: string | null; niche: string | null } | null;
  const bedrijfsmodel = (s?.bedrijfsmodel as Bedrijfsmodel | null) ?? null;
  const niche = s?.niche ?? null;
  if (!bedrijfsmodel && !niche) return null;

  const rijen = await fetchGodViewInvoerRijen(supabase);
  const cellen = bouwGodViewCellen(rijen, isDemoClientId(clientId) ? TEST_DREMPELS : undefined);

  const kandidaten: { model: Bedrijfsmodel | null; niche: string | null }[] = [
    ...(bedrijfsmodel && niche ? [{ model: bedrijfsmodel, niche }] : []),
    ...(niche ? [{ model: null, niche }] : []),
    ...(bedrijfsmodel ? [{ model: bedrijfsmodel, niche: null }] : []),
  ];

  for (const kandidaat of kandidaten) {
    const cel = cellen.find((c) =>
      c.sleutel.channel === channel && c.sleutel.model === kandidaat.model && c.sleutel.niche === kandidaat.niche);
    if (!cel?.metrics) continue;

    const label = kandidaat.model && kandidaat.niche
      ? `${kandidaat.model.toUpperCase()} + ${nicheLabel(kandidaat.niche)}`
      : kandidaat.niche ? (nicheLabel(kandidaat.niche) ?? kandidaat.niche) : kandidaat.model!.toUpperCase();

    return { label, cel };
  }
  return null;
}

export async function godViewContext(supabase: SupabaseClient, clientId: string, channel: SopChannel): Promise<GodViewContextBlock> {
  const match = await findBestGodViewCell(supabase, clientId, channel);
  if (!match) return { available: false, promptContext: "" };
  const { label, cel } = match;
  if (!cel.metrics) return { available: false, promptContext: "" };
  const metrics = cel.metrics;
  const testMode = isDemoClientId(clientId);

  const lines: string[] = [
    "## GOD VIEW-CONTEXT (anonieme cross-agency benchmark — verklarende laag; vervangt de eigen cijfers van dit account NIET)",
    "",
    ...(testMode ? [
      "TESTMODUS: drempel verlaagd voor demo-data, dit is NIET k-anoniem en mag nooit als echte marktuitspraak worden gepresenteerd.",
      "",
    ] : []),
    `Segment: ${label}, kanaal ${channel}. Gebaseerd op ${cel.telling.accounts} accounts bij ${cel.telling.bureaus} verschillende bureaus (anoniem — geen enkel account is hieruit individueel te herleiden).`,
    "",
  ];
  if (metrics.medianCpa !== null) lines.push(`- Mediane CPA in dit segment: €${metrics.medianCpa.toFixed(2)} (n=${metrics.accountsMetCpa} accounts).`);
  if (metrics.medianRoas !== null) lines.push(`- Mediane ROAS in dit segment: ${metrics.medianRoas.toFixed(2)} (n=${metrics.accountsMetRoas} accounts).`);
  lines.push(
    "",
    "INSTRUCTIE: gebruik dit alleen om te DUIDEN of dit account beter of slechter presteert dan de markt in hetzelfde segment.",
    "- Verzin geen cross-agency-cijfers die hier niet staan.",
    "- Claim nooit dat een los account uit dit getal te herleiden is — dat is precies wat de anonimisering voorkomt.",
  );
  return { available: true, promptContext: lines.join("\n") };
}

export interface GodViewComparison {
  available: boolean;
  segmentLabel: string | null;
  channel: SopChannel | null;
  accountsCount: number | null;
  bureausCount: number | null;
  medianCpa: number | null;
  medianRoas: number | null;
  /** true als dit op TEST_DREMPELS draaide (demo-clientId) i.p.v. de echte k-anonimiteitsgrens --
   *  de renderer moet dit altijd zichtbaar labelen, nooit stilzwijgend als een echte,
   *  k-anonieme marktuitspraak tonen. */
  testMode: boolean;
}

// Gestructureerde variant van godViewContext() voor de PDF-export -- geen prompt-tekst voor een
// LLM, maar velden om als vergelijkingskaart te renderen. Zelfde k-anonimiteitsgrens voor een
// echte clientId, zelfde stille degradatie naar available:false (geen "onvoldoende data"-ruis);
// voor een demo-clientId draait findBestGodViewCell op TEST_DREMPELS (zie isDemoClientId
// hierboven) en komt testMode:true mee terug.
export async function fetchGodViewComparison(supabase: SupabaseClient, clientId: string, channel: SopChannel): Promise<GodViewComparison> {
  const testMode = isDemoClientId(clientId);
  const match = await findBestGodViewCell(supabase, clientId, channel);
  if (!match || !match.cel.metrics) {
    return { available: false, segmentLabel: null, channel: null, accountsCount: null, bureausCount: null, medianCpa: null, medianRoas: null, testMode };
  }
  return {
    available: true,
    segmentLabel: match.label,
    channel,
    accountsCount: match.cel.telling.accounts,
    bureausCount: match.cel.telling.bureaus,
    medianCpa: match.cel.metrics.medianCpa,
    medianRoas: match.cel.metrics.medianRoas,
    testMode,
  };
}
