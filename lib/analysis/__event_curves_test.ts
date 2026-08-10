import { buildEditionCurves, deriveCpaCurve } from "./event-curves";
import type { Edition, DailyPoint } from "@/lib/rai/event-time-axis";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  x " + msg); } else { console.log("  v " + msg); }
}

const editie: Edition = {
  editionId: "2026",
  campaignStartDate: "2026-01-01",
  fairStartDate: "2026-02-01",
  fairEndDate: "2026-02-03",
};

console.log("buildEditionCurves:");
{
  const punten: DailyPoint[] = [
    { date: "2026-01-01", value: 10 },
    { date: "2026-01-15", value: 20 },
  ];
  const curves = buildEditionCurves(punten, editie, null);
  assert(curves.current.length === 2, "twee punten binnen het venster");
  assert(curves.current[0].cumulative === 10 && curves.current[1].cumulative === 30, "cumulatief, vroeg naar laat");
  assert(curves.previous.length === 0, "geen vorige editie: lege curve, geen fout");
}

console.log("deriveCpaCurve:");
{
  const conv = [{ daysToFair: 30, cumulative: 10 }, { daysToFair: 15, cumulative: 25 }];
  const cost = [{ daysToFair: 30, cumulative: 1000 }, { daysToFair: 15, cumulative: 2500 }];
  const cpa = deriveCpaCurve(conv, cost);
  assert(cpa[0].cpa === 100, "1000 / 10 = 100");
  assert(cpa[1].cpa === 100, "2500 / 25 = 100");
  const zonderConversies = deriveCpaCurve([{ daysToFair: 30, cumulative: 0 }], [{ daysToFair: 30, cumulative: 500 }]);
  assert(zonderConversies[0].cpa === null, "nul conversies: cpa is null, niet Infinity");
  const zonderKostenpunt = deriveCpaCurve([{ daysToFair: 5, cumulative: 3 }], []);
  assert(zonderKostenpunt[0].cpa === null, "geen bijpassend kostenpunt: null, geen giswerk");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);
