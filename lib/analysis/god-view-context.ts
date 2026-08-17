import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGodViewInvoerRijen } from "../benchmark/god-view-data";
import { bouwGodViewCellen } from "../benchmark/god-view";
import { nicheLabel, type Bedrijfsmodel } from "../benchmark/segment";
import type { SopChannel } from "./sop-channel-config";

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

export async function godViewContext(supabase: SupabaseClient, clientId: string, channel: SopChannel): Promise<GodViewContextBlock> {
  const { data: settings } = await supabase.from("client_settings").select("bedrijfsmodel, niche").eq("client_id", clientId).maybeSingle();
  const s = settings as { bedrijfsmodel: string | null; niche: string | null } | null;
  const bedrijfsmodel = (s?.bedrijfsmodel as Bedrijfsmodel | null) ?? null;
  const niche = s?.niche ?? null;
  if (!bedrijfsmodel && !niche) return { available: false, promptContext: "" };

  const rijen = await fetchGodViewInvoerRijen(supabase);
  const cellen = bouwGodViewCellen(rijen);

  // Voorkeur voor de diepste deelbare cel die bij deze klant past: combinatie eerst, dan niche,
  // dan model -- specifieker is waardevoller zodra het mag (zelfde volgorde als de
  // "verdiepen"-gedachte in cel.ts).
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

    const lines: string[] = [
      "## GOD VIEW-CONTEXT (anonieme cross-agency benchmark — verklarende laag; vervangt de eigen cijfers van dit account NIET)",
      "",
      `Segment: ${label}, kanaal ${channel}. Gebaseerd op ${cel.telling.accounts} accounts bij ${cel.telling.bureaus} verschillende bureaus (anoniem — geen enkel account is hieruit individueel te herleiden).`,
      "",
    ];
    if (cel.metrics.medianCpa !== null) lines.push(`- Mediane CPA in dit segment: €${cel.metrics.medianCpa.toFixed(2)} (n=${cel.metrics.accountsMetCpa} accounts).`);
    if (cel.metrics.medianRoas !== null) lines.push(`- Mediane ROAS in dit segment: ${cel.metrics.medianRoas.toFixed(2)} (n=${cel.metrics.accountsMetRoas} accounts).`);
    lines.push(
      "",
      "INSTRUCTIE: gebruik dit alleen om te DUIDEN of dit account beter of slechter presteert dan de markt in hetzelfde segment.",
      "- Verzin geen cross-agency-cijfers die hier niet staan.",
      "- Claim nooit dat een los account uit dit getal te herleiden is — dat is precies wat de anonimisering voorkomt.",
    );
    return { available: true, promptContext: lines.join("\n") };
  }

  return { available: false, promptContext: "" };
}
