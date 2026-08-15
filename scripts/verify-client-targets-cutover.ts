// Bewijst de fase-2-overstap (docs/MASTERPLAN.md) tegen echte data: voor elk van de drie klanten
// met een niet-lege kpi_targets moet resolveTargets() op client_targets exact dezelfde cpa/roas
// teruggeven als wat er in kpi_targets stond vóór migratie 082 -- geen LLM-call nodig, dit is de
// pure laag die app/api/analysis/monthly/route.ts nu aanroept.
//
// Gebruik: npx tsx scripts/verify-client-targets-cutover.ts

import { readFileSync } from "node:fs";
import { sql } from "./supabase-sql.mjs";
import { resolveTargets, type TargetRow } from "../lib/analysis/o2-targets-cost";

try { readFileSync(".env.local", "utf8"); } catch { /* dan de omgeving zelf */ }

const KLANTEN = ["gads-4140363870", "gads-7649590091", "gads-8375102493"];

async function main(): Promise<void> {
  const kpiRows = await sql(
    `select client_id, kpi_targets from client_settings where client_id in ('${KLANTEN.join("','")}')`
  );
  const targetRows = await sql(
    `select client_id, channel, metric, target_value, valid_from, valid_to from client_targets where client_id in ('${KLANTEN.join("','")}')`
  );

  let fouten = 0;
  const vandaag = new Date().toISOString().slice(0, 7) + "-01";

  for (const k of kpiRows) {
    const kpi = k.kpi_targets as { cpaTarget?: number; roasTarget?: number } | null;
    const verwachtCpa = Number(kpi?.cpaTarget ?? 0);
    const verwachtRoas = Number(kpi?.roasTarget ?? 0);

    const rows: TargetRow[] = targetRows
      .filter((r: Record<string, unknown>) => r.client_id === k.client_id)
      .map((r: Record<string, unknown>) => ({
        channel: String(r.channel),
        metric: String(r.metric),
        targetValue: Number(r.target_value),
        validFrom: String(r.valid_from),
        validTo: r.valid_to == null ? null : String(r.valid_to),
      }));

    // Twee peildata: vandaag (wat de route in de praktijk meegeeft) en de maand van de laatste
    // sync (april 2026, de sync ligt stil) -- valid_from=2000-01-01/valid_to=null uit migratie 082
    // hoort voor BEIDE hetzelfde te geven, dat is precies het punt van een open-eind-target.
    for (const peildatum of [vandaag, "2026-04-01"]) {
      const resolved = resolveTargets(rows, "google_ads", peildatum);
      const cpaOk = (resolved.cpa ?? 0) === verwachtCpa;
      const roasOk = (resolved.roas ?? 0) === verwachtRoas;
      const status = cpaOk && roasOk ? "OK" : "FOUT";
      if (!cpaOk || !roasOk) fouten++;
      console.log(
        `${status}  ${k.client_id}  peildatum=${peildatum}  cpa: kpi_targets=${verwachtCpa} client_targets=${resolved.cpa ?? 0}  roas: kpi_targets=${verwachtRoas} client_targets=${resolved.roas ?? 0}`
      );
    }
  }

  console.log(fouten === 0 ? "\nAlle klanten: client_targets levert exact wat kpi_targets leverde." : `\n${fouten} afwijking(en) gevonden.`);
  if (fouten > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
