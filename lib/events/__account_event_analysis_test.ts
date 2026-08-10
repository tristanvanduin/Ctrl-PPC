// Zelf-draaiende test voor de account-brede T-minus-analyse (fase 4). Draait via tsx.
// Spiegelt lib/rai/__geo_clone_analysis_test.ts qua opzet, maar zonder geo-clone-matching:
// het hele account telt mee, over meerdere kanalen tegelijk.

import { analyzeAccountEvent } from "./account-event-analysis";
import { googleMonthlyConversionPoints, googleMonthlyCostPoints, type GoogleAccountMonthlyRow } from "./account-event-points";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  ✗ " + msg); } else { console.log("  ✓ " + msg); }
}

console.log("geen edities geconfigureerd:");
{
  const res = analyzeAccountEvent({
    eventId: "bf", eventName: "Black Friday", cadence: "annual", editions: [],
    conversionsTarget: null, asOfDate: "2026-11-01",
    channels: [{ channel: "google_ads", points: [], costPoints: [] }],
  });
  assert(res.currentEditionId === null && !res.actionNeeded, "geen edities: leeg resultaat, geen actie nodig");
  assert(res.degradations.some((d) => d.includes("geen editie-datums")), "degradatie noemt ontbrekende editie-datums");
}

console.log("enkel kanaal, aanloop achter op vorig jaar:");
{
  const rows: GoogleAccountMonthlyRow[] = [
    { month: "2025-10-01", conversions: 40, cost: 4000 },
    { month: "2025-11-01", conversions: 60, cost: 4000 },
    { month: "2026-10-01", conversions: 20, cost: 4000 },
  ];
  const res = analyzeAccountEvent({
    eventId: "bf", eventName: "Black Friday", cadence: "annual",
    editions: [{ date: "2025-11-28", label: "2025" }, { date: "2026-11-27", label: "2026" }],
    conversionsTarget: 150, asOfDate: "2026-11-01",
    channels: [{
      channel: "google_ads",
      points: googleMonthlyConversionPoints(rows),
      costPoints: googleMonthlyCostPoints(rows),
    }],
  });
  assert(res.currentEditionId === "2026" && res.previousEditionId === "2025", "huidige en vorige editie correct");
  assert(res.conversions !== null && res.conversions.comparable, "editie-over-editie vergelijkbaar");
  assert(res.conversions!.currentCumulative === 20, "huidige opbouw 20 conversies (alleen okt, peildatum 1 nov, T-26)");
  // Op T-26 was ook de novemberrij van vorig jaar al binnen (T-27 t.o.v. de vorige beursdag): 40 + 60 = 100.
  assert(res.conversions!.previousCumulativeAtSameDaysOut === 100, "vorig jaar op hetzelfde punt (T-26): okt + begin nov = 100");
  assert(res.conversions!.deltaPct != null && res.conversions!.deltaPct < -0.15, "materieel achter op vorig jaar");
  assert(res.actionNeeded === true, "materieel achter => actionNeeded");
  assert(res.blendedForecast === null, "één kanaal: geen blended forecast (net als de beursanalyse)");
  assert(res.projectedFinal != null, "projectie heeft een basis");
  assert(/T-minus-analyse Black Friday/.test(res.markdown), "markdown-titel gebruikt event-naam");
}

console.log("meerdere kanalen: totaal telt op, account-breed doel afgezet tegen het totaal:");
{
  const rows: GoogleAccountMonthlyRow[] = [
    { month: "2025-10-01", conversions: 40, cost: 4000 },
    { month: "2025-11-01", conversions: 60, cost: 4000 },
    { month: "2026-10-01", conversions: 40, cost: 4000 },
  ];
  const res = analyzeAccountEvent({
    eventId: "bf", eventName: "Black Friday", cadence: "annual",
    editions: [{ date: "2025-11-28", label: "2025" }, { date: "2026-11-27", label: "2026" }],
    conversionsTarget: 100, asOfDate: "2026-11-01",
    channels: [
      { channel: "google_ads", points: googleMonthlyConversionPoints(rows), costPoints: googleMonthlyCostPoints(rows) },
      {
        channel: "meta_ads",
        points: [{ date: "2026-10-15", value: 10 }],
        costPoints: [{ date: "2026-10-15", value: 500 }],
      },
    ],
  });
  assert(res.conversions!.currentCumulative === 50, "totaal over beide kanalen: 40 (Google) + 10 (Meta) = 50");
  assert(res.blendedForecast !== null, "twee kanalen: wel een blended forecast");
  assert(res.perChannelForecast.length === 2, "per-kanaal-uitsplitsing aanwezig voor beide kanalen");
  assert(res.target === 100, "account-breed doel staat los van per-kanaal-doelen");
  assert(res.projectedVsTargetPct != null, "projectie afgezet tegen het account-brede doel");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);
