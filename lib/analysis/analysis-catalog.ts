// De catalogus van analyses die dit dashboard kan draaien.
//
// De analyses stonden alleen als losse JSX-kaarten in de kanaal-tabbladen. Daardoor was er
// nergens een antwoord op de twee vragen die een gebruiker als eerste stelt: wát kan ik hier
// draaien, en wát heb ik al gedraaid. Wie op "Alle kanalen" binnenkwam zag één kaart en
// concludeerde dat er verder niets was.
//
// Deze lijst is die vraag beantwoord, op één plek. De `section` is de sleutel: elke analyse
// slaat haar uitvoer op in sop_analysis_output onder die naam, dus daarmee is per analyse te
// zien of en wanneer hij gedraaid heeft — met één query in plaats van twintig losse fetches.
//
// WAT HIER BEWUST NIET IN STAAT (sloop-audit 1 september 2026, contractvraag): analyses
// zonder sop_analysis_output-sectie kúnnen niet in deze lijst, want de sleutel is de sectie.
// - De vier scorecards (search/display/shopping/pmax): live GET-lezers zonder opslag; hun
//   "laatste stand" is per definitie nu.
// - search-terms: bewaart zijn oordelen in search_term_analysis (eigen tabel met historie).
// - meta-creatives: schrijft features/patronen (meta_creative_visual_features/_patterns);
//   zichtbaar via de creative-briefing die erop bouwt.
// - geo-clone: dynamische secties (geo_clone_<afkorting>_v1), per beursvariant — geen vaste
//   catalogusregel mogelijk.
// - channel-forecast en event-pacing: live berekeningen zonder opslag.
//
// IO-vrij en los getest.

export type AnalyseKanaal = "google" | "meta" | "linkedin" | "microsoft" | "blended";

export interface AnalyseDefinitie {
  /** De sectie in sop_analysis_output. Uniek; dit is de sleutel voor "is hij gedraaid". */
  section: string;
  titel: string;
  kanaal: AnalyseKanaal;
  /** Eén regel over wat de analyse beantwoordt — niet hoe hij werkt. */
  waarover: string;
}

export const KANAAL_LABEL: Record<AnalyseKanaal, string> = {
  google: "Google Ads",
  meta: "Meta",
  linkedin: "LinkedIn",
  microsoft: "Microsoft Ads",
  blended: "Alle kanalen",
};

export const ANALYSE_CATALOGUS: AnalyseDefinitie[] = [
  // ── Google ────────────────────────────────────────────────────────────────
  { section: "google_funnel_v1", titel: "Funnel-drop-off", kanaal: "google", waarover: "waar in vertoning → klik → conversie het weglekt" },
  { section: "kpi_relations_google_v1", titel: "KPI-verhoudingen", kanaal: "google", waarover: "of een duurdere CPA aan de klik of aan de conversie ligt" },
  { section: "google_video_v1", titel: "Video & Performance Max", kanaal: "google", waarover: "kijkdiepte, placements zonder conversie en de PMax-netwerkverdeling" },
  { section: "geo_markets_v1", titel: "Landen & staten", kanaal: "google", waarover: "welke markten kosten zonder te converteren" },
  { section: "impression_share_v1", titel: "Impression Share", kanaal: "google", waarover: "zichtbaarheid en verlies: budget versus rang" },
  { section: "budget_allocation_v1", titel: "Budgetallocatie", kanaal: "google", waarover: "herverdeling naar campagnes die het bewezen omzetten" },
  { section: "bid_strategy_v1", titel: "Biedstrategie", kanaal: "google", waarover: "of de biedstrategie past bij wat de campagne doet" },
  { section: "quality_score_v1", titel: "Quality Score", kanaal: "google", waarover: "kwaliteitsscore per keyword en campagne" },
  { section: "rsa_insights_v1", titel: "RSA copy", kanaal: "google", waarover: "welke koppen en beschrijvingen het gewicht trekken" },
  { section: "landing_audit_v1", titel: "Landing-audit", kanaal: "google", waarover: "of de landingspagina de belofte van de advertentie waarmaakt" },

  // ── Meta ──────────────────────────────────────────────────────────────────
  { section: "meta_funnel_v1", titel: "Funnel-drop-off", kanaal: "meta", waarover: "waar klik → landing → winkelwagen → checkout afhaakt" },
  { section: "kpi_relations_meta_v1", titel: "KPI-verhoudingen", kanaal: "meta", waarover: "of een duurdere CPA aan de klik of aan de conversie ligt" },
  { section: "meta_signals_v1", titel: "Meta-signalen", kanaal: "meta", waarover: "creative fatigue, frequentie-verzadiging, ranking en budgetconcentratie" },
  { section: "meta_briefing_v1", titel: "Creative-briefing", kanaal: "meta", waarover: "welke creatives vervangen moeten en met wat" },

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  { section: "linkedin_icp_v1", titel: "ICP-fit", kanaal: "linkedin", waarover: "welk deel van de spend binnen het ideale klantprofiel landt" },
  { section: "linkedin_funnel_v1", titel: "Funnel-drop-off", kanaal: "linkedin", waarover: "waar vertoning → klik → form-open → lead afhaakt" },
  { section: "kpi_relations_linkedin_v1", titel: "KPI-verhoudingen", kanaal: "linkedin", waarover: "of een duurdere CPL aan de klik of aan het formulier ligt" },
  { section: "linkedin_signals_v1", titel: "LinkedIn-signalen", kanaal: "linkedin", waarover: "form-drop-off, CPL-druk, demografie-drift en budgetconcentratie" },

  // ── Microsoft ─────────────────────────────────────────────────────────────
  // Eén losse analyse: het kanaaleigen rekenwerk (import-pariteit, netwerk-lek, volumerem) zit
  // als prepared facts in de maand-SOP zelf, niet in aparte deterministische kaarten.
  { section: "kpi_relations_microsoft_v1", titel: "KPI-verhoudingen", kanaal: "microsoft", waarover: "of een duurdere CPA aan de klik of aan de conversie ligt" },

  // ── Over de kanalen heen ──────────────────────────────────────────────────
  { section: "cross_channel_v1", titel: "Cross-channel-analyse", kanaal: "blended", waarover: "zaai/oogst, arbitrage, mix, doelgroep-samenhang en GA4-CRO" },
  { section: "period_evaluation_v1", titel: "Periode-evaluatie", kanaal: "blended", waarover: "wat de vorige periode opleverde tegen wat ervan verwacht werd" },
  // Pijler 6: synthetiseert de al-berekende kanaal-aanbevelingen (Pijler 1-5) samen met de
  // cross-channel-feiten hierboven tot kanaaloverstijgende hypotheses en sprinttaken.
  { section: "master_synthesis_v1", titel: "Master Synthesis", kanaal: "blended", waarover: "welke hypotheses en sprinttaken alleen zichtbaar worden door kanalen samen te lezen" },
];

export interface AnalyseStatus extends AnalyseDefinitie {
  /** De datum van de laatste run, of null als hij nog nooit gedraaid heeft. */
  laatst: string | null;
}

export interface GegroepeerdeAnalyses {
  /** Al gedraaid, meest recent eerst — dit is wat je als eerste wilt zien. */
  uitgevoerd: AnalyseStatus[];
  /** Nog nooit gedraaid, in catalogusvolgorde. */
  open: AnalyseStatus[];
}

/**
 * De catalogus tegen de laatste runs, gesplitst in uitgevoerd en open. Een analyse zonder run
 * verdwijnt niet — juist die lijst laat zien wat er nog te halen valt.
 *
 * @param laatsteRuns sectie → datum van de laatste run
 * @param kanaal beperk tot één kanaal; weglaten geeft alles
 */
export function groepeerOpStatus(
  laatsteRuns: Map<string, string>,
  kanaal?: AnalyseKanaal
): GegroepeerdeAnalyses {
  const relevant = kanaal ? ANALYSE_CATALOGUS.filter((a) => a.kanaal === kanaal) : ANALYSE_CATALOGUS;
  const metStatus: AnalyseStatus[] = relevant.map((a) => ({ ...a, laatst: laatsteRuns.get(a.section) ?? null }));

  const uitgevoerd = metStatus
    .filter((a): a is AnalyseStatus & { laatst: string } => a.laatst !== null)
    // Recentste bovenaan; bij een gelijke datum de catalogusvolgorde aanhouden, zodat de lijst
    // niet van volgorde wisselt tussen twee renders.
    .sort((a, b) => b.laatst.localeCompare(a.laatst));

  return { uitgevoerd, open: metStatus.filter((a) => a.laatst === null) };
}
