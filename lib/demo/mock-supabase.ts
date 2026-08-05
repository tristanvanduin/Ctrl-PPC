// Scoped mock-Supabase-client voor demo-mode. Onderschept queries voor de demo-klant
// ("demo-greentech") en geeft curated rijen terug; voor élke andere klant/tabel delegeert hij
// naar de echte client (passthrough) zodat de 23 echte klanten volledig ongemoeid blijven.
//
// Nagebootst: gelijkheidsfilters (.eq), sortering (.order) en afkapping (.limit/.range). Bewust
// NIET nagebootst: bereikfilters als .gte/.lte en de tekstoperatoren — de curated rijen liggen al
// binnen de vensters die de app opvraagt, dus dat zou werk zijn zonder verschil.
//
// Sorteren en afkappen stonden hier eerst ook bij de genegeerde: "we hoeven de PostgREST-semantiek
// niet volledig na te bouwen". Dat hield geen stand. Het patroon .order(desc).limit(1) betekent
// "pak de laatste rij", en zonder ordening gaf dat de eerste — de oudste. In de second opinion
// bepaalde die ene waarde de maand waarop tien andere queries filteren, dus die kwamen leeg terug
// en tien controlepunten meldden "geen data beschikbaar" over een account dat de data wél heeft.
// Een mock mag minder kunnen dan de echte database; hij mag niet iets ANDERS antwoorden.
//
// Reads: thenable builder (await sb.from(t).select()…). Writes (insert/upsert/update/delete):
// no-op succes voor de demo-klant; anders passthrough naar echt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_GREENTECH_ID } from "./greentech-mock";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

interface DemoRowSource {
  [table: string]: Row[];
}

/** Vergelijkt twee celwaarden zoals Postgres dat zou doen: getallen numeriek, de rest als tekst. */
function compareValues(a: unknown, b: unknown, asc: boolean, nullsFirst: boolean): number {
  const aLeeg = a == null, bLeeg = b == null;
  if (aLeeg && bLeeg) return 0;
  if (aLeeg) return nullsFirst ? -1 : 1;
  if (bLeeg) return nullsFirst ? 1 : -1;
  const r = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return asc ? r : -r;
}

/**
 * Is dit de demoklant? Geexporteerd omdat de geo-bron dezelfde vraag stelt: een demo-vlag die van
 * de client komt mag bepalen of je de demo ziet, niet welke klant de demo is. Twee definities
 * zouden op termijn uiteenlopen.
 */
export const isDemoClientValue = (v: unknown): boolean =>
  typeof v === "string" && (v === DEMO_GREENTECH_ID || v.replace(/^gads-/, "") === DEMO_GREENTECH_ID);

class MockQuery implements PromiseLike<Result> {
  private calls: { m: string; args: unknown[] }[] = [];
  private eqFilters: Record<string, unknown> = {};
  private singleMode = false;
  private isWrite = false;

  constructor(
    private real: SupabaseClient | null,
    private table: string,
    private rows: Row[] | undefined,
  ) {}

  // ── filter/vorm-methoden: opnemen en this teruggeven ──
  private rec(m: string, args: unknown[]) { this.calls.push({ m, args }); return this; }
  select(...a: unknown[]) { return this.rec("select", a); }
  eq(col: unknown, val: unknown) { if (typeof col === "string") this.eqFilters[col] = val; return this.rec("eq", [col, val]); }
  neq(...a: unknown[]) { return this.rec("neq", a); }
  gt(...a: unknown[]) { return this.rec("gt", a); }
  gte(...a: unknown[]) { return this.rec("gte", a); }
  lt(...a: unknown[]) { return this.rec("lt", a); }
  lte(...a: unknown[]) { return this.rec("lte", a); }
  in(...a: unknown[]) { return this.rec("in", a); }
  is(...a: unknown[]) { return this.rec("is", a); }
  not(...a: unknown[]) { return this.rec("not", a); }
  or(...a: unknown[]) { return this.rec("or", a); }
  ilike(...a: unknown[]) { return this.rec("ilike", a); }
  like(...a: unknown[]) { return this.rec("like", a); }
  contains(...a: unknown[]) { return this.rec("contains", a); }
  filter(...a: unknown[]) { return this.rec("filter", a); }
  order(...a: unknown[]) { return this.rec("order", a); }
  limit(...a: unknown[]) { return this.rec("limit", a); }
  range(...a: unknown[]) { return this.rec("range", a); }
  maybeSingle() { this.singleMode = true; return this.rec("maybeSingle", []); }
  single() { this.singleMode = true; return this.rec("single", []); }

  // ── writes ──
  insert(...a: unknown[]) { this.isWrite = true; return this.rec("insert", a); }
  upsert(...a: unknown[]) { this.isWrite = true; return this.rec("upsert", a); }
  update(...a: unknown[]) { this.isWrite = true; return this.rec("update", a); }
  delete(...a: unknown[]) { this.isWrite = true; return this.rec("delete", a); }

  private servesDemo(): boolean {
    // Serveer demo-rijen als er curated data voor deze tabel is én de query de demo-klant betreft
    // (of geen client_id-filter heeft — dan geldt hij impliciet de zichtbare, incl. demo).
    if (!this.rows) return false;
    if ("client_id" in this.eqFilters) return isDemoClientValue(this.eqFilters.client_id);
    return true;
  }

  private demoResult(): Result {
    let data = this.rows ?? [];
    // Pas de eenvoudige gelijkheidsfilters toe (client_id en andere directe eq's).
    for (const [col, val] of Object.entries(this.eqFilters)) {
      if (col === "client_id") { data = data.filter((r) => isDemoClientValue(r[col]) || r[col] === val); continue; }
      data = data.filter((r) => r[col] === val);
    }
    data = this.applyOrder(data);
    data = this.applyLimit(data);
    if (this.singleMode) return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }

  /**
   * Sorteren en afkappen wél nabootsen. Deze twee konden we niet blijven negeren: het patroon
   * "pak de laatste maand" is .order(desc).limit(1), en zonder ordening leverde dat de EERSTE rij
   * op — de oudste. In de second opinion bepaalde die ene waarde de maand waarop tien andere
   * queries filteren, dus die kwamen allemaal leeg terug en tien controlepunten meldden "geen
   * data beschikbaar" op een account dat de data gewoon heeft.
   *
   * In productie deed Postgres het correct; het was dus geen rekenfout maar een demo die iets
   * anders liet zien dan het product doet. Dat is precies wat een demo niet mag.
   */
  private applyOrder(data: Row[]): Row[] {
    const orders = this.calls.filter((c) => c.m === "order");
    if (orders.length === 0) return data;
    const out = [...data];
    // PostgREST: de eerste .order() is de primaire sleutel. Array.sort is stabiel, dus we sorteren
    // van achter naar voren om dezelfde volgorde te krijgen.
    for (let i = orders.length - 1; i >= 0; i--) {
      const col = orders[i].args[0];
      if (typeof col !== "string") continue;
      const opts = (orders[i].args[1] ?? {}) as { ascending?: boolean; nullsFirst?: boolean };
      const asc = opts.ascending !== false;
      // Postgres zet nulls standaard achteraan bij ASC en vooraan bij DESC.
      const nullsFirst = opts.nullsFirst ?? !asc;
      out.sort((a, b) => compareValues(a[col], b[col], asc, nullsFirst));
    }
    return out;
  }

  private applyLimit(data: Row[]): Row[] {
    const range = [...this.calls].reverse().find((c) => c.m === "range");
    if (range && typeof range.args[0] === "number" && typeof range.args[1] === "number") {
      return data.slice(range.args[0], range.args[1] + 1); // range is inclusief
    }
    const limit = [...this.calls].reverse().find((c) => c.m === "limit");
    if (limit && typeof limit.args[0] === "number") return data.slice(0, limit.args[0]);
    return data;
  }

  /**
   * Geen demo-rijen voor deze tabel? Dan LEEG, en geen netwerkcall.
   *
   * ── WAT HIER STOND EN WAAROM HET WEG IS ─────────────────────────────────
   *
   * Dit was een passthrough: de opgenomen calls werden opnieuw afgespeeld op de echte client.
   * De gedachte was dat de mock alleen de demoklant onderschept, zodat je in hetzelfde tabblad
   * ook de echte klanten kon bekijken.
   *
   * Het gevolg was dat elke query ZONDER client_id-filter alsnog naar de echte database ging --
   * app_settings bijvoorbeeld, die de klantenlijst aanstuurt. In een doorloop op localhost gaf
   * dat ERR_CONNECTION_RESET, bleef de zijbalk op "KLANTEN (0)" staan, en hing de klantenlijst
   * op zijn skeletten. Een demo die op een backend wacht is geen demo.
   *
   * Nu geldt één regel: in demo-modus komt alles uit lib/demo/demo-rows.ts, en wat daar niet in
   * staat is leeg. Geen netwerk, geen wachten, geen echte data die per ongeluk in beeld komt.
   *
   * De prijs is bewust: in een demo-tabblad zijn de echte klanten niet te bekijken. Daarvoor is
   * ?demo=0 of een ander tabblad -- zie lib/demo/demo-mode.ts.
   */
  private async delegate(): Promise<Result> {
    return this.singleMode ? { data: null, error: null } : { data: [], error: null };
  }

  then<TR1 = Result, TR2 = never>(
    onfulfilled?: ((value: Result) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    const run = async (): Promise<Result> => {
      // Writes op de demo-klant: no-op succes. Anders passthrough.
      if (this.isWrite) {
        if (this.servesDemo()) return { data: null, error: null };
        return this.delegate();
      }
      if (this.servesDemo()) return this.demoResult();
      return this.delegate();
    };
    return run().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

// Bouwt een mock-client die .from() onderschept en de rest (auth, storage, rpc…) doorlaat
// naar de echte client indien aanwezig.
// Bestandsopslag zonder backend. Geeft overal een nette fout terug in plaats van undefined.
//
// Zonder dit stuk crashte de demo hard. De consumers schrijven `if (!supabase) return`, en die
// controle laat de mock door omdat hij bestaat — maar `supabase.storage` was undefined, dus
// `supabase.storage.from(...)` gaf "Cannot read properties of undefined (reading 'from')" en
// nam het hele instellingen-tabblad mee. Vijftien plekken gebruiken .storage; het is dus een
// klasse, geen geval, en hij hoort hier gedicht te worden en niet vijftien keer los.
//
// De vorm volgt supabase-js: { data, error }. Zo hoeft de aanroepende code niets te weten.
const DEMO_STORAGE_ERROR = { message: "Bestandsopslag is niet beschikbaar in de demo", name: "DemoStorageError" };

function demoStorageBucket() {
  return {
    upload: async () => ({ data: null, error: DEMO_STORAGE_ERROR }),
    download: async () => ({ data: null, error: DEMO_STORAGE_ERROR }),
    remove: async () => ({ data: null, error: DEMO_STORAGE_ERROR }),
    list: async () => ({ data: [], error: null }),
    // Geen ondertekende URL: de aanroepers controleren op data?.signedUrl en tonen dan niets.
    createSignedUrl: async () => ({ data: null, error: DEMO_STORAGE_ERROR }),
    createSignedUrls: async () => ({ data: [], error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
  };
}

export function createDemoSupabase(real: SupabaseClient | null, rows: DemoRowSource): SupabaseClient {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "from") {
        return (table: string) => new MockQuery(real, table, rows[table]);
      }
      // Overige leden delegeren naar de echte client (of no-op).
      if (real) {
        const v = (real as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
      }
      if (prop === "storage") return { from: demoStorageBucket };
      return undefined;
    },
  };
  return new Proxy({}, handler) as unknown as SupabaseClient;
}
