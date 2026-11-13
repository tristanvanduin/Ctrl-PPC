// Kanaal-agnostische renderer van een DetectionResult naar een prompt-sectie, in exact hetzelfde
// format als de Google-signaalsectie (lib/analysis/signal-section.ts): getriggerde verhalen met
// zekerheidslabel + bewijs + betekenis, plus de "gecontroleerd, niet getriggerd"-lijst zodat de
// lezer weet wat onderzocht is en stil bleef. Een lege detectie geeft een LEGE sectie, zodat een
// kanaal zonder signalen de prompt byte-identiek laat (net als bij Google).

import { type DetectionResult, type NotAssessable, type SignalStory } from "./types";

export const MAX_SIGNAL_STORIES = 6;

export function renderStory(story: SignalStory): string {
  const evidence = story.evidence
    .map((e) => `${e.metric}: ${e.value}${e.prev != null ? ` (vorige periode ${e.prev})` : ""}`)
    .join("; ");
  return `- [${story.certainty}] ${story.scope}: ${story.story} Bewijs: ${evidence}. Betekenis: ${story.actionDirection}`;
}

export interface SignalSectionResult {
  section: string;
  triggeredCount: number;
  checkedIds: string[];
  /** Verhalen die niet te beoordelen waren, met reden; leeg als alles te beoordelen was. */
  notAssessable: NotAssessable[];
}

const NIET_TE_BEOORDELEN_KOP = [
  "### Niet te beoordelen (meting ontbreekt)",
  'Over deze onderwerpen is GEEN uitspraak gedaan. Lees dit niet als "in orde".',
];

export function renderNotAssessable(items: NotAssessable[]): string[] {
  return items.map((n) => `- ${n.id}: ${n.reason}`);
}

export function renderSignalSection(merged: DetectionResult, channelLabel: string): SignalSectionResult {
  const stories = merged.triggered.slice(0, MAX_SIGNAL_STORIES);
  const notAssessable = merged.notAssessable ?? [];
  if (stories.length === 0 && notAssessable.length === 0) {
    return { section: "", triggeredCount: 0, checkedIds: merged.checked, notAssessable };
  }
  // Niets getriggerd, wel iets dat niet te beoordelen was: dat is geen lege sectie. Zwijgen
  // zou hier lezen als "onderzocht en in orde".
  if (stories.length === 0) {
    const kaal = [
      `## Deterministisch gedetecteerde signalen (${channelLabel})`,
      "",
      "Geen signalen getriggerd.",
      "",
      ...NIET_TE_BEOORDELEN_KOP,
      ...renderNotAssessable(notAssessable),
      "",
      "### Gecontroleerd, niet getriggerd",
      merged.checked.filter((id) => !notAssessable.some((n) => n.id === id)).join(", ") || "geen",
    ];
    return { section: kaal.join("\n"), triggeredCount: 0, checkedIds: merged.checked, notAssessable };
  }
  const lines: string[] = [
    `## Deterministisch gedetecteerde signalen (${channelLabel})`,
    "",
    "Deze bevindingen zijn vooraf uit de ruwe data berekend. VERPLICHT: adresseer elke getriggerde bevinding in de stap waar zij thuishoort, of weerleg haar beargumenteerd; stilzwijgend negeren is een kwaliteitsfout. Neem de zekerheidslabels letterlijk over en claim nooit meer zekerheid dan het label geeft.",
    "",
    "### Getriggerde signalen",
    ...stories.map(renderStory),
    "",
    "### Gecontroleerd, niet getriggerd",
    // Story-ids dragen soms een suffix op het gecontroleerde id (geo_country_geen_conversies_US
    // op check-id geo_country_geen_conversies); zonder de prefix-vergelijking stond een
    // getriggerde categorie hier óók als "niet getriggerd" — de sectie sprak zichzelf tegen.
    merged.checked
      // Wat deels niet te beoordelen was staat hieronder met reden; het hier ook als "niet
      // getriggerd" noemen zou die reden tegenspreken.
      .filter((id) => !notAssessable.some((n) => n.id === id))
      .filter((id) => !stories.some((s) => s.id === id || s.id.startsWith(`${id}_`)))
      .join(", ") || "geen",
    ...(notAssessable.length > 0 ? ["", ...NIET_TE_BEOORDELEN_KOP, ...renderNotAssessable(notAssessable)] : []),
  ];
  return { section: lines.join("\n"), triggeredCount: stories.length, checkedIds: merged.checked, notAssessable };
}
