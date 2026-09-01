import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// INGEST-INVARIANTEN: WAT ELKE SYNCRUN OVER ZIJN EIGEN SCHRIJFSELS MOET KUNNEN ZEGGEN
// ============================================================================
//
// De analyses lezen de kanaaltabellen met stilzwijgende aannames die tsc, de tests en de
// build per definitie niet zien, omdat ze pas op ECHTE data kunnen breken:
//
//   - de lezers pinnen level-waarden (meta_breakdown_daily op "account",
//     linkedin_demographic_daily op "CAMPAIGN", microsoft_breakdown_daily op "account") --
//     een sync die een andere waarde schrijft, levert een analyse die stilzwijgend niets
//     of het dubbele leest;
//   - de IS-kolommen zijn ALS FRACTIE opgeslagen (0.46, niet 46) -- de klasse fout
//     procent-vs-fractie is op demo-data onzichtbaar omdat de demo per constructie klopt;
//   - metrics zijn nooit negatief -- een negatieve spend is altijd een parse- of
//     mappingfout, geen meting.
//
// Deze module beoordeelt dat direct NA de run, op de rijen die de run zelf schreef. Een
// schending maakt de run mislukt: een sync die scheve data als "completed" administreert is
// gevaarlijker dan een duidelijke fout (zelfde doctrine als de chunk-uitkomsten in de
// LinkedIn-sync). De beoordelingskern is puur en unit-getest; alleen het ophalen praat met
// de database.

export interface InvariantRegel {
  /** De tabel waarover deze regel gaat (voor de melding). */
  tabel: string;
  /** Kolom → toegestane waarden; elke andere waarde is een schending. */
  toegestaneWaarden?: { kolom: string; waarden: string[] };
  /** Kolommen die numeriek en niet negatief moeten zijn (null is toegestaan: null is eerlijk). */
  nietNegatief?: string[];
  /** Kolommen die als fractie in [0, 1] horen (impressieaandeel-familie). Null toegestaan. */
  fractie?: string[];
}

export interface InvariantUitkomst {
  ok: boolean;
  gecontroleerd: number;
  schendingen: string[];
}

/** De pure kern: beoordeelt opgehaalde rijen tegen één regel. */
export function beoordeelRijen(rijen: Record<string, unknown>[], regel: InvariantRegel): InvariantUitkomst {
  const schendingen: string[] = [];
  const meld = (tekst: string) => {
    // Eén melding per soort is genoeg om te handelen; duizend kopieën verstoppen het verslag.
    if (schendingen.length < 10 && !schendingen.includes(tekst)) schendingen.push(tekst);
  };

  for (const rij of rijen) {
    if (regel.toegestaneWaarden) {
      const waarde = String(rij[regel.toegestaneWaarden.kolom] ?? "");
      if (!regel.toegestaneWaarden.waarden.includes(waarde)) {
        meld(`${regel.tabel}.${regel.toegestaneWaarden.kolom} draagt "${waarde}" buiten [${regel.toegestaneWaarden.waarden.join(", ")}]`);
      }
    }
    for (const kolom of regel.nietNegatief ?? []) {
      const w = rij[kolom];
      if (typeof w === "number" && w < 0) meld(`${regel.tabel}.${kolom} is negatief (${w})`);
    }
    for (const kolom of regel.fractie ?? []) {
      const w = rij[kolom];
      if (typeof w === "number" && (w < 0 || w > 1)) {
        meld(`${regel.tabel}.${kolom} is geen fractie (${w}); procent in plaats van fractie geschreven?`);
      }
    }
  }
  return { ok: schendingen.length === 0, gecontroleerd: rijen.length, schendingen };
}

export interface IngestCheck {
  regel: InvariantRegel;
  /** Datumkolom + venster om de check tot de eigen run te beperken; weglaten = hele tabel. */
  venster?: { kolom: string; vanaf: string };
}

/**
 * Haalt per check de rijen op (beperkt tot het venster van de run) en beoordeelt ze.
 * Faalt een FETCH, dan telt dat zelf als schending: "kon niet controleren" mag nooit als
 * "gecontroleerd en in orde" lezen -- deze codebase heeft eerder een controle gehad die iets
 * anders verifieerde dan hij beweerde, en die stond er maanden groen bij.
 */
export async function controleerIngest(
  supabase: SupabaseClient,
  clientId: string,
  checks: IngestCheck[]
): Promise<InvariantUitkomst> {
  let totaal = 0;
  const schendingen: string[] = [];
  for (const check of checks) {
    let query = supabase.from(check.regel.tabel).select("*").eq("client_id", clientId).limit(2000);
    if (check.venster) query = query.gte(check.venster.kolom, check.venster.vanaf);
    const { data, error } = await query;
    if (error) {
      schendingen.push(`${check.regel.tabel}: controle kon niet lezen (${error.message})`);
      continue;
    }
    const uitkomst = beoordeelRijen((data ?? []) as Record<string, unknown>[], check.regel);
    totaal += uitkomst.gecontroleerd;
    schendingen.push(...uitkomst.schendingen);
  }
  return { ok: schendingen.length === 0, gecontroleerd: totaal, schendingen };
}

// ── De per-kanaal specs: exact de aannames van de lezers ────────────────────

const METRIEK_KOLOMMEN = ["impressions", "clicks", "spend", "conversions", "conversion_value"];

export function metaIngestChecks(vanaf: string): IngestCheck[] {
  return [
    {
      regel: {
        tabel: "meta_breakdown_daily",
        // De assemblage leest uitsluitend level "account" (lib/meta/analysis-data.ts).
        toegestaneWaarden: { kolom: "level", waarden: ["account"] },
        nietNegatief: ["impressions", "clicks_all", "link_clicks", "spend", "conversions"],
      },
      venster: { kolom: "date", vanaf },
    },
    {
      regel: { tabel: "meta_account_daily", nietNegatief: ["impressions", "spend", "conversions"] },
      venster: { kolom: "date", vanaf },
    },
  ];
}

export function linkedinIngestChecks(vanaf: string): IngestCheck[] {
  return [
    {
      regel: {
        tabel: "linkedin_demographic_daily",
        // De lezers pinnen level "CAMPAIGN" (som over campagnes = accountbeeld); een sync
        // die ook MEMBER/account-niveau schrijft zou dubbel tellen.
        toegestaneWaarden: { kolom: "level", waarden: ["CAMPAIGN"] },
      },
      venster: { kolom: "date", vanaf },
    },
    {
      regel: { tabel: "linkedin_campaign_daily", nietNegatief: ["impressions", "clicks", "spend", "leads"] },
      venster: { kolom: "date", vanaf },
    },
  ];
}

export function microsoftIngestChecks(vanaf: string, maandVanaf: string): IngestCheck[] {
  return [
    {
      regel: {
        tabel: "microsoft_breakdown_daily",
        toegestaneWaarden: { kolom: "level", waarden: ["account"] },
        nietNegatief: METRIEK_KOLOMMEN,
      },
      venster: { kolom: "date", vanaf },
    },
    {
      regel: { tabel: "microsoft_account_daily", nietNegatief: METRIEK_KOLOMMEN },
      venster: { kolom: "date", vanaf },
    },
    {
      regel: {
        tabel: "microsoft_campaign_impression_share",
        // budget_utilization staat hier bewust NIET bij: overlevering boven het dagbudget
        // is legitiem (Microsoft mag tot ~2x per dag overleveren), dus >1 is geen fout.
        fractie: ["impression_share", "budget_lost_is", "rank_lost_is"],
        nietNegatief: ["impressions", "clicks", "cost", "conversions", "budget_utilization"],
      },
      venster: { kolom: "month", vanaf: maandVanaf },
    },
  ];
}
