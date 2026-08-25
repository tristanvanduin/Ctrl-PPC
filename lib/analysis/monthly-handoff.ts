// De overdracht van de maandanalyse naar de kortere cadansen.
//
// ── WAAROM DIT BESTAAT ──────────────────────────────────────────────────────
//
// De drie SOP's zijn bedoeld als een geneste regelkring: de monthly stelt het plan op, de bi-weekly
// toetst halverwege of dat plan uitkomt, de weekly vangt wat niet tot die toetsing kan wachten.
// Die nesting brak op beide koppelingen.
//
// De bi-weekly LAS de maandanalyse wel, maar via `section: "full"` -- het narratieve
// deliverable-document, in zijn geheel, in de system prompt van alle vier de stappen. Het model
// kreeg dus proza waarin de beloftes ergens stonden, in plaats van de beloftes als velden. En de
// weekly las helemaal niets: van de drie lussen stond de vaakst draaiende volledig los.
//
// `structured_monthly_v2` draagt precies wat er nodig is, al gestructureerd: final_sop.primary_thread
// en root_cause (de diagnose om tegen te toetsen), en
// operating_detail.hypotheses_and_next_month_proof (de beloftes, mét het bewijs dat er tegen die
// tijd zichtbaar hoort te zijn). P7 zette de insights-leesweg al hard op die sectie; de bi-weekly
// bleef achter op de narratieve.
//
// ── WAAROM TWEE VORMEN ──────────────────────────────────────────────────────
//
// De bi-weekly moet toetsen en krijgt dus de hele redenering: diagnose, hypotheses en aanbevelingen.
// De weekly moet alleen kunnen zien of iets acuuts de maanddiagnose tegenspreekt, en is expliciet
// "geen diepe analyse" -- die krijgt de diagnose in één regel plus waar we op letten. Een weekly die
// de hele maandanalyse meekrijgt, gaat hem overdoen; dat is precies wat zijn eigen preambule verbiedt.
//
// Alles hier is puur: JSON in, tekst uit. Geen database, geen datum-van-vandaag.

export type HandoffBron = "structured" | "narratief" | "geen";

export interface MonthlyHandoff {
  tekst: string;
  bron: HandoffBron;
  /** Hoeveel hypotheses er uit de maandanalyse zijn meegenomen. 0 bij een narratieve fallback. */
  aantalHypotheses: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tekst(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function lijst(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

/** Parseert de opgeslagen structured_monthly_v2-string. Kapotte JSON telt als afwezig. */
function parseStructured(ruw: string | null | undefined): Record<string, unknown> | null {
  if (!ruw || typeof ruw !== "string") return null;
  try {
    const v: unknown = JSON.parse(ruw);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

export interface HandoffOpts {
  /** De output van sop_analysis_output waar section = "structured_monthly_v2". */
  structured?: string | null;
  /** De output waar section = "full". Alleen als terugval, en dan expliciet gelabeld. */
  narratief?: string | null;
  /** analysis_date van de maandanalyse, zodat het model weet hoe oud de diagnose is. */
  analysisDate?: string | null;
  cadans: "weekly" | "biweekly";
}

export function buildMonthlyHandoff(opts: HandoffOpts): MonthlyHandoff {
  const structured = parseStructured(opts.structured);
  const datumRegel = opts.analysisDate
    ? `De maandanalyse waar dit uit komt is van ${opts.analysisDate}.`
    : "De datum van deze maandanalyse is niet vastgelegd.";

  if (structured) {
    const finalSop = isRecord(structured.final_sop) ? structured.final_sop : {};
    const operating = isRecord(structured.operating_detail) ? structured.operating_detail : {};
    const hypotheses = lijst(operating.hypotheses_and_next_month_proof);
    const aanbevelingen = lijst(finalSop.recommendations);
    const thread = tekst(finalSop.primary_thread);
    const rootCause = tekst(finalSop.root_cause);

    // Een structured-rij zonder diagnose én zonder hypotheses draagt niets om tegen te toetsen.
    // Dan is de narratieve terugval eerlijker dan een blok met lege kopjes.
    if (!thread && !rootCause && hypotheses.length === 0) {
      return narratieveTerugval(opts, datumRegel);
    }

    const r: string[] = [];
    r.push("## Uit de laatste maandanalyse (gestructureerd overgenomen — dit zijn geen nieuwe bevindingen)");
    r.push(datumRegel);
    r.push("");
    if (thread) r.push(`**Hoofdlijn:** ${thread}`);
    if (rootCause) r.push(`**Oorzaak volgens de maandanalyse:** ${rootCause}`);

    if (hypotheses.length > 0) {
      r.push("");
      r.push(
        opts.cadans === "biweekly"
          ? "**De beloftes uit die analyse.** Toets per stuk of het verwachte effect nu zichtbaar is. Is het te vroeg, zeg dat dan; dat is een geldige uitkomst en geen ontwijking."
          : "**Waar we deze maand op letten.** Alleen relevant als je iets ziet dat hier acuut tegenin gaat — je hoeft ze niet te evalueren, dat doet de bi-weekly."
      );
      for (const h of hypotheses) {
        const nummer = h.hypothesis_number ?? "?";
        const route = tekst(h.route);
        const stelling = tekst(h.hypothesis);
        const bewijs = tekst(h.success_next_month);
        if (!stelling) continue;
        r.push(`- [H${nummer}${route ? ` · ${route}` : ""}] ${stelling}`);
        if (bewijs && opts.cadans === "biweekly") r.push(`    Zichtbaar bij succes: ${bewijs}`);
        const waarom = tekst(h.why_we_think_this);
        if (waarom && opts.cadans === "biweekly") r.push(`    Onderbouwing toen: ${waarom}`);
      }
    }

    // Aanbevelingen alleen voor de bi-weekly: die vraagt of de doorgevoerde optimalisaties effect
    // tonen. De weekly hoort niet te beoordelen of een advies is opgevolgd.
    if (opts.cadans === "biweekly" && aanbevelingen.length > 0) {
      r.push("");
      r.push("**Wat er toen is geadviseerd.** Ontwikkelt dit zich zoals verwacht?");
      for (const a of aanbevelingen) {
        const titel = tekst(a.title) || tekst(a.recommendation) || tekst(a.action);
        if (titel) r.push(`- ${titel}`);
      }
    }

    r.push("");
    r.push(
      opts.cadans === "biweekly"
        ? "Verwijs in elke stap expliciet naar deze punten. Wijkt de werkelijkheid af, benoem dat als afwijking van de maandanalyse en niet als nieuwe ontdekking."
        : "Gebruik dit alleen als context. Vind je niets dat hiermee botst, laat het dan met rust."
    );
    return { tekst: r.join("\n"), bron: "structured", aantalHypotheses: hypotheses.length };
  }

  return narratieveTerugval(opts, datumRegel);
}

function narratieveTerugval(opts: HandoffOpts, datumRegel: string): MonthlyHandoff {
  const narratief = tekst(opts.narratief);
  if (!narratief) {
    return {
      // Bewust geen instructie om "dan maar zonder referentie" te werken: dat leidde tot een
      // bi-weekly die zich als maandanalyse gedroeg. Zeggen dat de referentie ontbreekt is genoeg.
      tekst:
        "## Uit de laatste maandanalyse\nEr is geen eerdere maandanalyse voor dit kanaal beschikbaar.\n" +
        "Doe dus geen uitspraak over ontwikkeling ten opzichte van de maandanalyse — die vergelijking bestaat niet.\n" +
        "Beoordeel alleen wat de data van deze periode zelf laat zien.",
      bron: "geen",
      aantalHypotheses: 0,
    };
  }
  // De narratieve tekst wordt bewust begrensd. Hij ging voorheen ongetruncateerd de system prompt
  // in, vier keer per run: het volledige deliverable-document. Wat we ervan nodig hebben staat
  // vooraan (de executive samenvatting); de bijlage erachter voegt tokens toe, geen toetsbaarheid.
  const begrensd = narratief.length > 6000 ? `${narratief.slice(0, 6000)}\n\n[…afgekapt: alleen het begin van de maandanalyse is meegegeven.]` : narratief;
  return {
    tekst: [
      "## Uit de laatste maandanalyse (NARRATIEVE TERUGVAL)",
      datumRegel,
      "De gestructureerde versie van deze analyse ontbreekt, dus hieronder staat de lopende tekst.",
      "De hypotheses staan daar niet als losse velden in — haal ze eruit als je ze nodig hebt, en",
      "zeg erbij dat je ze uit het verhaal hebt gelezen.",
      "",
      begrensd,
    ].join("\n"),
    bron: "narratief",
    aantalHypotheses: 0,
  };
}

// ── De eigen openstaande punten van de vorige run ───────────────────────────
//
// De weekly draait 52x per jaar per kanaal en begon elke keer blanco: hij las geen enkele eerdere
// SOP-output, ook niet die van zichzelf. Daardoor kon hij drie weken achter elkaar dezelfde bleeder
// als nieuw melden, zonder ooit te zeggen dat het de derde week was -- en dat is precies het signaal
// dat het verschil maakt tussen een incident en een patroon.
//
// sop_recommendations draagt een sop_type-kolom, dus dit blijft binnen hetzelfde kanaal én dezelfde
// cadans. Geen migratie nodig -- en sop_tasks draagt sinds migratie 104 dezelfde kolom, dus daar is
// de kanaalvermenging inmiddels ook weg.

export interface OpenPunt {
  hypothesis?: unknown;
  expected_result?: unknown;
  measurement_metric?: unknown;
  timeframe?: unknown;
  analysis_date?: unknown;
  status?: unknown;
}

export function buildOpenPointsBlock(rijen: OpenPunt[], maxItems = 8): string {
  const open = rijen.filter((r) => {
    const s = tekst(r.status).toLowerCase();
    return s === "" || s === "open" || s === "pending";
  });
  if (open.length === 0) return "";

  const regels = open.slice(0, maxItems).map((r) => {
    const wat = tekst(r.hypothesis);
    const datum = tekst(r.analysis_date);
    const metric = tekst(r.measurement_metric);
    const verwacht = tekst(r.expected_result);
    const staart = [metric && `meet op ${metric}`, verwacht && `verwacht: ${verwacht}`].filter(Boolean).join("; ");
    return `- ${datum ? `[${datum}] ` : ""}${wat}${staart ? ` (${staart})` : ""}`;
  });

  const rest = open.length > maxItems ? `\n(en nog ${open.length - maxItems} andere)` : "";
  return [
    "",
    "## Nog open van je vorige runs in deze cadans",
    "Dit heb je eerder zelf gesignaleerd en het staat nog open. Kom je hetzelfde punt opnieuw tegen,",
    "meld het dan als AANHOUDEND met vermelding van sinds wanneer — niet als nieuwe bevinding. Een",
    "probleem dat drie weken terugkomt is een ander verhaal dan een probleem dat één keer opduikt.",
    ...regels,
    rest,
  ].filter(Boolean).join("\n");
}
