import { createClient } from "@supabase/supabase-js";
import { celoverzicht } from "@/lib/benchmark/cel";
import { nicheLabel, type Bedrijfsmodel } from "@/lib/benchmark/segment";

// ============================================================================
// HOE VER IS DE BENCHMARKPOOL?
// ============================================================================
//
// Deze route beantwoordt één vraag: welke segmenten zouden vandaag gedeeld mógen worden, en wat
// ontbreekt er bij de rest.
//
// ── WAAROM DIT ER NU AL IS, VÓÓR DE POOL ZELF ──────────────────────────────
//
// De drempels in lib/benchmark/cel.ts bepalen of laag 5 iets oplevert of niets. Zonder dit
// scherm is dat een abstractie: je zet een veld in de instellingen en hoopt dat het ergens toe
// leidt. Mét dit scherm zie je per segment hoeveel accounts en bureaus er nog bij moeten, en
// dus of het invullen van niches ergens toe leidt.
//
// Gemeten op 5 augustus 2026: 5 van de 71 accounts hadden een sector, en géén enkel bureau had
// toestemming gegeven. Dat is de stand die dit scherm laat zien, en dat hoort ook zo -- een
// dekkingsoverzicht dat "alles in orde" meldt terwijl er niets is ingevuld, is erger dan geen
// overzicht.
//
// ── ALLEEN DE TELLING, NOOIT DE CIJFERS ────────────────────────────────────
//
// Deze route leest labels en bureau-ids en telt. Er komt geen enkele prestatiemeting aan te pas.
// Dat is met opzet: een dekkingsoverzicht heeft die niet nodig, en wat je niet ophaalt kun je
// niet per ongeluk teruggeven.

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const supabase = db();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  // Welke bureaus doen mee. Zonder toestemming levert een bureau NIETS aan de pool -- ook niet
  // als zijn klanten keurig een niche hebben ingevuld. Zie migratie 064.
  const { data: bureaus } = await supabase
    .from("agencies").select("id, name, benchmark_optin_at");
  const meedoen = new Set(
    (bureaus ?? []).filter((b) => b.benchmark_optin_at).map((b) => String(b.id))
  );

  const { data: accounts } = await supabase
    .from("accounts").select("client_id, agency_id");
  const { data: instellingen } = await supabase
    .from("client_settings").select("client_id, bedrijfsmodel, niche");

  const perKlant = new Map(
    (instellingen ?? []).map((r) => [String(r.client_id), r as { bedrijfsmodel: string | null; niche: string | null }])
  );

  // Het kanaal staat niet in accounts; voor een dekkingsoverzicht is dat ook niet nodig. Google
  // is vandaag het enige kanaal met breedte, dus dat is de aanname -- expliciet, zodat hij
  // opvalt zodra Meta en LinkedIn meetellen.
  const KANAAL = "google";

  const rijen = (accounts ?? []).map((a) => {
    const s = perKlant.get(String(a.client_id));
    return {
      channel: KANAAL,
      agencyId: String(a.agency_id ?? ""),
      model: (s?.bedrijfsmodel as Bedrijfsmodel | null) ?? null,
      niche: s?.niche ?? null,
      meedoen: meedoen.has(String(a.agency_id ?? "")),
    };
  });

  const inDePool = rijen.filter((r) => r.meedoen);
  const cellen = celoverzicht(inDePool).map((c) => ({
    channel: c.sleutel.channel,
    model: c.sleutel.model,
    niche: c.sleutel.niche,
    nicheLabel: nicheLabel(c.sleutel.niche),
    accounts: c.telling.accounts,
    bureaus: c.telling.bureaus,
    deelbaar: c.oordeel.deelbaar,
    reden: c.oordeel.deelbaar ? null : c.oordeel.reden,
    tekort: c.oordeel.deelbaar ? null : c.oordeel.tekort,
  }));

  return Response.json({
    stand: {
      bureaus: (bureaus ?? []).length,
      bureausMetToestemming: meedoen.size,
      accounts: rijen.length,
      accountsInDePool: inDePool.length,
      metModel: rijen.filter((r) => r.model).length,
      metNiche: rijen.filter((r) => r.niche).length,
    },
    cellen,
    deelbaar: cellen.filter((c) => c.deelbaar).length,
  });
}
