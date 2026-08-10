import { tminusLabel, mergeTminusRows } from "./event-tminus-chart";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  x " + msg); } else { console.log("  v " + msg); }
}

console.log("tminusLabel:");
{
  assert(tminusLabel(14) === "T-14", "voor het event: T-14");
  assert(tminusLabel(0) === "T0", "op de event-dag: T0");
  assert(tminusLabel(-3) === "T+3", "na het event: T+3");
}

console.log("mergeTminusRows:");
{
  const rows = mergeTminusRows(
    [{ daysToFair: 30, value: 10 }, { daysToFair: 10, value: 25 }],
    [{ daysToFair: 30, value: 8 }],
  );
  assert(rows.length === 2, "unie van de dagen-tot-event-punten");
  assert(rows[0].daysToFair === 30 && rows[1].daysToFair === 10, "aflopend gesorteerd, ver voor het event eerst");
  assert(rows[0].huidig === 10 && rows[0].vorig === 8, "beide edities op dezelfde dag naast elkaar");
  assert(rows[1].huidig === 25 && rows[1].vorig === null, "geen vorige-editie-punt op die dag: null, geen 0");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);
