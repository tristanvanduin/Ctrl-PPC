// Het antwoord van GET /api/data/[table] als de database een fout geeft.
//
// Een tabel die (nog) niet bestaat, is geen serverfout maar een bekende toestand: een migratie die
// klaarstaat en op akkoord wacht (scripts/check-datagrond.mjs, KLAARGEZET). De lezer valt dan terug,
// bijvoorbeeld Google per week of maand zolang ads_account_daily er niet is (migratie 111).
//
// Daarom geen 500 maar een herkenbare code. En geen 404: de browser logt elk antwoord van 400 of
// hoger als consolefout, en de rookproef keurt een pagina daarop af. Dus status 200, `ok: false` en
// `code: "tabel_ontbreekt"`; de browserkant (client-read.ts) maakt daar een gewone fout met die code
// van, zodat elke bestaande lezer hem nog steeds als fout ziet.

import { isOntbrekendeTabel } from "@/lib/meta/sync";
import { TABEL_ONTBREEKT } from "./client-read";

export function leesFoutAntwoord(error: { code?: string; message?: string }): { body: Record<string, unknown>; status: number } {
  if (isOntbrekendeTabel(error)) {
    return { body: { ok: false, code: TABEL_ONTBREEKT, error: error.message ?? "tabel ontbreekt" }, status: 200 };
  }
  return { body: { error: error.message ?? "onbekende fout" }, status: 500 };
}
