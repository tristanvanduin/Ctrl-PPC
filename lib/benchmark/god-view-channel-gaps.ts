import type { GodViewInvoerRij, GodViewCel } from "./god-view";
import { bouwGodViewCellen } from "./god-view";
import type { Celdrempels } from "./cel";
import type { Bedrijfsmodel } from "./segment";
import { nicheLabel } from "./segment";

// Kanaalaanbeveling: signaleert dat een kanaal goed scoort in het segment (niche/bedrijfsmodel)
// van dit account, terwijl het account dat kanaal zelf nog niet gebruikt. Upsell-waarde voor het
// bureau (masterplan 17.64/17.65: de eigenaar koos expliciet voor bouwen, ondanks dat het bij
// weinig bureaus vandaag vrijwel altijd insufficient_data teruggeeft -- zelfde stille degradatie
// als lib/analysis/god-view-context.ts, geen aparte foutmelding).
//
// Puur deterministisch, geen LLM: dit is precies het soort "SQL berekent de waarheid"-vraag dat
// de vertrouwensdoctrine (masterplan sectie 3) aan een taalmodel verbiedt. bouwGodViewCellen()
// bestaat al en is niet aan één kanaal gebonden -- findBestGodViewCell() in god-view-context.ts
// filtert PAS op canaal-gelijkheid; deze functie doet het omgekeerde filter.

export interface ChannelGap {
  channel: string;
  segmentLabel: string;
  accountsCount: number;
  bureausCount: number;
  medianCpa: number | null;
  medianRoas: number | null;
}

/**
 * Kanalen die goed scoren in het segment van dit account, maar niet in `actieveKanalen` staan.
 * Gesorteerd op accounttelling (meest onderbouwde signaal eerst) — geen "best presterend"-ranking,
 * want CPA/ROAS zijn niet kanaal-vergelijkbaar (een CPA van €40 op Google zegt niets over of €60
 * op LinkedIn goed of slecht is voor dat kanaal).
 *
 * Retourneert een lege lijst als er geen deelbare cel is voor dit segment op enig ontbrekend
 * kanaal (insufficient_data, geen fout) — zelfde stilte als de rest van de God View-laag.
 */
export function findChannelGaps(
  rijen: readonly GodViewInvoerRij[],
  actieveKanalen: readonly string[],
  bedrijfsmodel: Bedrijfsmodel | null,
  niche: string | null,
  drempels?: Celdrempels,
): ChannelGap[] {
  if (!bedrijfsmodel && !niche) return [];
  const actief = new Set(actieveKanalen);

  const cellen = bouwGodViewCellen(rijen, drempels);

  // Zelfde voorkeursvolgorde als findBestGodViewCell in god-view-context.ts: combinatie eerst,
  // dan niche, dan model — maar hier per ONTBREKEND kanaal, niet per aangevraagd kanaal.
  const kandidatenPerKanaal = new Map<string, GodViewCel>();
  const volgorde: { model: Bedrijfsmodel | null; niche: string | null }[] = [
    ...(bedrijfsmodel && niche ? [{ model: bedrijfsmodel, niche }] : []),
    ...(niche ? [{ model: null, niche }] : []),
    ...(bedrijfsmodel ? [{ model: bedrijfsmodel, niche: null }] : []),
  ];

  for (const cel of cellen) {
    if (!cel.metrics) continue;
    if (actief.has(cel.sleutel.channel)) continue;
    if (kandidatenPerKanaal.has(cel.sleutel.channel)) continue; // eerste (beste) match per kanaal wint
    const rang = volgorde.findIndex((k) => k.model === cel.sleutel.model && k.niche === cel.sleutel.niche);
    if (rang === -1) continue;
    kandidatenPerKanaal.set(cel.sleutel.channel, cel);
  }

  const resultaat: ChannelGap[] = [];
  for (const [channel, cel] of kandidatenPerKanaal) {
    const label = cel.sleutel.model && cel.sleutel.niche
      ? `${cel.sleutel.model.toUpperCase()} + ${nicheLabel(cel.sleutel.niche)}`
      : cel.sleutel.niche ? (nicheLabel(cel.sleutel.niche) ?? cel.sleutel.niche) : cel.sleutel.model!.toUpperCase();
    resultaat.push({
      channel,
      segmentLabel: label,
      accountsCount: cel.telling.accounts,
      bureausCount: cel.telling.bureaus,
      medianCpa: cel.metrics!.medianCpa,
      medianRoas: cel.metrics!.medianRoas,
    });
  }
  return resultaat.sort((a, b) => b.accountsCount - a.accountsCount);
}
