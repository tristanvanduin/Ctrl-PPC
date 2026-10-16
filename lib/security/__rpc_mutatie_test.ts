// De mutatieherkenning van de poort rpc-rechten (scripts/check-rpc-rechten.mjs).
//
// Deze regel stond groen om de verkeerde reden: `update\s+\w` gevolgd door \b matchte alleen een
// tabelnaam van één letter, dus `update generation_jobs` telde niet als mutatie en
// claim_generation_job stond bij de leesfuncties. Elke vorm die hieronder staat, is een vorm die
// in een migratie van dit project voorkomt.
// Draaien: npx tsx lib/security/__rpc_mutatie_test.ts

import { muteert, alleenCode } from "../../scripts/rpc-mutatie.mjs";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("muterend");
check("update op een lange tabelnaam (de gemiste vorm)", muteert("return query update generation_jobs set status = 'running' where job_id = v returning *;"));
check("update over een regelovergang", muteert("update\n  generation_jobs\n  set x = 1"));
check("claim_generation_job zoals in migratie 090", muteert(`
  select job_id into v_job_id from generation_jobs where status = 'queued' limit 1 for update skip locked;
  if v_job_id is null then return; end if;
  return query update generation_jobs set status = 'running' where job_id = v_job_id returning *;`));
check("insert into", muteert("insert into fact_core (a) values (1);"));
check("delete from", muteert("delete from fact_core where account_id = p;"));
check("truncate", muteert("truncate sync_runs;"));
check("drop table", muteert("drop table if exists x;"));
check("alter table", muteert("alter table accounts add column y int;"));
check("create or replace", muteert("create or replace function f() returns int as $$ select 1 $$ language sql;"));
check("grant en revoke", muteert("grant select on x to anon;") && muteert("revoke execute on function f() from anon;"));
check("update op een tabel van één letter blijft herkend", muteert("update t set a = 1;"));

console.log("lezend");
check("select", !muteert("select * from accounts where client_id = p_client_id;"));
check("het woord update in commentaar telt niet", !muteert("-- update generation_jobs set x\nselect 1;"));
check("het woord update in een blokcommentaar telt niet", !muteert("/* update generation_jobs */ select 1;"));
check("het woord update in een tekstliteral telt niet", !muteert("select 'update generation_jobs set x' as tekst;"));
check("een kolom die updated_at heet telt niet", !muteert("select updated_at from generation_jobs;"));
check("lege bron", !muteert("") && !muteert(null));

console.log("alleenCode");
check("literalen worden leeg, met behoud van de quotes", alleenCode("select 'a''b'") === "select ''");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
