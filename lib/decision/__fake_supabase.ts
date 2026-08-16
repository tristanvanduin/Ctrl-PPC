// Minimale, in-memory nabootsing van de Supabase-querybuilder-methodes die de Master
// Synthesis-keten (Pijler 6) daadwerkelijk gebruikt: from/select/eq/lte/in/order/limit/
// maybeSingle/insert/delete. Geen algemene Supabase-mock -- alleen wat deze keten aanroept,
// zodat een integratietest de echte route/orchestratiecode kan draaien zonder netwerk of een
// live database. Gebruikt door __master_synthesis_integration_test.ts.

type Row = Record<string, unknown>;

function matchesEq(row: Row, col: string, val: unknown): boolean {
  return row[col] === val;
}
function matchesLte(row: Row, col: string, val: unknown): boolean {
  const a = row[col];
  if (a == null) return false;
  return String(a) <= String(val);
}
function matchesIn(row: Row, col: string, vals: unknown[]): boolean {
  return vals.includes(row[col]);
}

class FakeQueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSingle = false;
  private pendingInsert: Row[] | null = null;
  private pendingDelete = false;

  constructor(private store: FakeSupabase, private table: string) {}

  select(_cols?: string): this { return this; }
  eq(col: string, val: unknown): this { this.filters.push((r) => matchesEq(r, col, val)); return this; }
  lte(col: string, val: unknown): this { this.filters.push((r) => matchesLte(r, col, val)); return this; }
  in(col: string, vals: unknown[]): this { this.filters.push((r) => matchesIn(r, col, vals)); return this; }
  order(col: string, opts?: { ascending?: boolean }): this { this.orderCol = col; this.orderAsc = opts?.ascending ?? true; return this; }
  limit(n: number): this { this.limitN = n; return this; }
  maybeSingle(): this { this.wantSingle = true; return this; }

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
  then<T>(resolve: (value: { data: unknown; error: null } | { data: null; error: null }) => T): Promise<T> {
    if (this.pendingInsert) {
      this.store.tables[this.table] = [...(this.store.tables[this.table] ?? []), ...this.pendingInsert];
      const inserted = this.pendingInsert;
      return Promise.resolve(resolve({ data: this.wantSingle ? (inserted[0] ?? null) : inserted, error: null }));
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
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) return Promise.resolve(resolve({ data: rows[0] ?? null, error: null }));
    return Promise.resolve(resolve({ data: rows, error: null }));
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};

  seed(table: string, rows: Row[]): void {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any {
    return new FakeQueryBuilder(this, table);
  }
}
