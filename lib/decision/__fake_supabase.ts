// Minimale, in-memory nabootsing van de Supabase-querybuilder-methodes die de beslislaag
// daadwerkelijk gebruikt: from/select/eq/is/gte/lte/in/order/limit/range/maybeSingle/insert/
// upsert/delete. Geen algemene Supabase-mock -- alleen wat deze keten aanroept, zodat een
// integratietest de echte orchestratiecode kan draaien zonder netwerk of een live database.
//
// Herbouw 2 september 2026: `faalOp(tabel, bericht)` laat een tabel een queryfout teruggeven.
// Zonder dat waren de foutpaden per constructie ontestbaar (de fake gaf nooit `error`), en dat
// was precies waar de audit de meeste defecten vond. `eq` verstaat ook jsonb-paden
// ("metadata->>source") en `range` pagineert, zodat alleRijen() uit db-veilig hier echt draait.

type Row = Record<string, unknown>;

function leesPad(row: Row, col: string): unknown {
  const pijl = col.indexOf("->>");
  if (pijl < 0) return row[col];
  const basis = row[col.slice(0, pijl)];
  const sleutel = col.slice(pijl + 3);
  return basis && typeof basis === "object" ? (basis as Row)[sleutel] : undefined;
}
function matchesEq(row: Row, col: string, val: unknown): boolean {
  return leesPad(row, col) === val;
}
function matchesLte(row: Row, col: string, val: unknown): boolean {
  const a = row[col];
  if (a == null) return false;
  return String(a) <= String(val);
}
function matchesGte(row: Row, col: string, val: unknown): boolean {
  const a = row[col];
  if (a == null) return false;
  return String(a) >= String(val);
}
function matchesIn(row: Row, col: string, vals: unknown[]): boolean {
  return vals.includes(row[col]);
}

class FakeQueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private rangeVan: number | null = null;
  private rangeTot: number | null = null;
  private wantSingle = false;
  private pendingInsert: Row[] | null = null;
  private pendingUpdate: Row | null = null;
  private pendingDelete = false;

  constructor(private store: FakeSupabase, private table: string) {}

  select(_cols?: string): this { return this; }
  eq(col: string, val: unknown): this { this.filters.push((r) => matchesEq(r, col, val)); return this; }
  neq(col: string, val: unknown): this { this.filters.push((r) => !matchesEq(r, col, val)); return this; }
  is(col: string, val: unknown): this { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  lte(col: string, val: unknown): this { this.filters.push((r) => matchesLte(r, col, val)); return this; }
  gte(col: string, val: unknown): this { this.filters.push((r) => matchesGte(r, col, val)); return this; }
  in(col: string, vals: unknown[]): this { this.filters.push((r) => matchesIn(r, col, vals)); return this; }
  order(col: string, opts?: { ascending?: boolean }): this {
    // Alleen de EERSTE order telt (zoals bij PostgREST de primaire sortering); een tweede
    // .order() als tiebreak wordt genegeerd -- de tests zaaien geen gelijke sleutels.
    if (this.orderCol === null) { this.orderCol = col; this.orderAsc = opts?.ascending ?? true; }
    return this;
  }
  limit(n: number): this { this.limitN = n; return this; }
  range(van: number, tot: number): this { this.rangeVan = van; this.rangeTot = tot; return this; }
  maybeSingle(): this { this.wantSingle = true; return this; }
  single(): this { this.wantSingle = true; return this; }

  /** Kanaalronde 3 september 2026: `update(patch)` past de patch toe op de rijen die de filters
   *  matchen (de echte builder doet dat ook pas bij het awaiten, na de .eq()-aanroepen). */
  update(patch: Row): this { this.pendingUpdate = patch; return this; }

  insert(rows: Row | Row[]): this {
    this.pendingInsert = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: crypto.randomUUID(), created_at: "2026-03-01T00:00:00Z", ...r }));
    return this;
  }
  // Geen echte conflict-resolutie (geen onConflict-matching): voor deze keten volstaat gewoon
  // toevoegen, want de tests zaaien nooit een botsende rij vooraf.
  upsert(rows: Row | Row[], _opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    return this.insert(rows);
  }
  delete(): this { this.pendingDelete = true; return this; }

  private matching(): Row[] {
    const rows = this.store.tables[this.table] ?? [];
    return rows.filter((r) => this.filters.every((f) => f(r)));
  }

  // Maakt het object thenable/awaitable, zoals de echte PostgrestFilterBuilder.
  then<T>(resolve: (value: { data: unknown; error: { message: string } | null }) => T): Promise<T> {
    const fout = this.store.fouten[this.table];
    if (fout) return Promise.resolve(resolve({ data: null, error: { message: fout } }));
    if (this.pendingInsert) {
      this.store.tables[this.table] = [...(this.store.tables[this.table] ?? []), ...this.pendingInsert];
      const inserted = this.pendingInsert;
      return Promise.resolve(resolve({ data: this.wantSingle ? (inserted[0] ?? null) : inserted, error: null }));
    }
    if (this.pendingUpdate) {
      const patch = this.pendingUpdate;
      const geraakt = this.matching();
      for (const r of geraakt) Object.assign(r, patch);
      return Promise.resolve(resolve({ data: this.wantSingle ? (geraakt[0] ?? null) : geraakt, error: null }));
    }
    if (this.pendingDelete) {
      const toRemove = new Set(this.matching());
      this.store.tables[this.table] = (this.store.tables[this.table] ?? []).filter((r) => !toRemove.has(r));
      return Promise.resolve(resolve({ data: null, error: null }));
    }
    let rows = this.matching();
    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? ""), bv = String(b[col] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.rangeVan != null && this.rangeTot != null) rows = rows.slice(this.rangeVan, this.rangeTot + 1);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) return Promise.resolve(resolve({ data: rows[0] ?? null, error: null }));
    return Promise.resolve(resolve({ data: rows, error: null }));
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  fouten: Record<string, string> = {};

  /** Gezaaide rijen krijgen een id als ze er geen hebben: een `.in("id", ...)`-filter op rijen
   *  zonder id zou anders elke rij zonder id matchen (undefined === undefined). */
  seed(table: string, rows: Row[]): void {
    const metId = rows.map((r) => (r.id === undefined ? { id: crypto.randomUUID(), ...r } : r));
    this.tables[table] = [...(this.tables[table] ?? []), ...metId];
  }

  /** Laat elke query op deze tabel met een fout terugkomen, zoals een ontbrekende kolom doet.
   *  Voor een databasefunctie: `faalOp("rpc:naam")`. */
  faalOp(table: string, bericht = "relation does not exist"): void {
    this.fouten[table] = bericht;
  }

  /** Aangeroepen databasefuncties, in volgorde (projectieronde 3 september 2026). */
  rpcAanroepen: { naam: string; args: Record<string, unknown> | undefined }[] = [];

  /** Een databasefunctie: geen uitvoering, alleen registratie en een injecteerbare fout. */
  async rpc(naam: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    this.rpcAanroepen.push({ naam, args });
    const fout = this.fouten[`rpc:${naam}`];
    return fout ? { data: null, error: { message: fout } } : { data: null, error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any {
    return new FakeQueryBuilder(this, table);
  }
}
