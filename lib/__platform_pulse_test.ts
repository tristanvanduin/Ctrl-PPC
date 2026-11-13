// De tellers onder "Not simulated" op de publieke homepage tellen alleen wat waar is
// (lib/marketing/platform-pulse.ts).
// Draaien: tsx lib/__platform_pulse_test.ts
//
// Het tegenvoorbeeld uit de doorlichting van 13 november: "70 active clients" en "€ 2,26 miljoen ad
// spend optimized" als live en niet gesimuleerd, terwijl er sinds 17 april geen meting binnenkwam
// en er geen actieve klant was; "hypotheses tested" telde voorstellen zonder vastgelegde uitkomst.

import { actieveKlanten, berekenPulse, isGetoetst, pulseTonen, type PulseInvoer } from "./marketing/platform-pulse";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const nu = new Date("2026-11-13T12:00:00Z");
const dagenGeleden = (d: number) => new Date(nu.getTime() - d * 86_400_000).toISOString();

// Zeventig accounts waarvan de laatste geslaagde sync op 17 april was.
const oud: PulseInvoer = {
  googleStatus: Array.from({ length: 70 }, (_, i) => ({ client_id: `gads-${i}`, last_successful_sync_at: "2026-04-17T03:00:00Z" })),
  kanaalRuns: [],
  spend: Array.from({ length: 70 }, (_, i) => ({ client_id: `gads-${i}`, spend: 32_300 })),
  hypotheses: [
    { client_id: "gads-1", outcome: null, result_met: null, evaluated_at: null }, // status accepted, nooit geëvalueerd
    { client_id: "gads-2", outcome: "niet_uitgevoerd", result_met: null, evaluated_at: dagenGeleden(40) },
    { client_id: "gads-3", outcome: "expired", result_met: null, evaluated_at: dagenGeleden(40) },
  ],
  analyses: Array.from({ length: 557 }, () => ({ client_id: "gads-1" })),
};
const p = berekenPulse(oud, nu);
check("geen sync in 7 dagen: 0 actieve klanten, niet 70", p.activeClients === 0, JSON.stringify(p));
check("geen sync in 7 dagen: geen ad spend", p.adSpendOptimized === 0, JSON.stringify(p));
check("niet uitgevoerd en verlopen tellen niet als getoetst", p.hypothesesTested === 0, JSON.stringify(p));
check("en dan staat het blok er niet", !pulseTonen(p));
check("zonder antwoord ook niet", !pulseTonen(null));

// Twee klanten met een recente sync (een via Google, een via Meta), één met een sync van 9 dagen
// geleden, een mislukte run en een demo-klant.
const nieuw: PulseInvoer = {
  googleStatus: [
    { client_id: "gads-a", last_successful_sync_at: dagenGeleden(1) },
    { client_id: "gads-oud", last_successful_sync_at: dagenGeleden(9) },
    { client_id: "demo-greentech", last_successful_sync_at: dagenGeleden(0.5) },
  ],
  kanaalRuns: [
    { client_id: "meta-b", status: "completed", finished_at: dagenGeleden(2) },
    { client_id: "meta-c", status: "failed", finished_at: dagenGeleden(1) },
    { client_id: "meta-d", status: "running", finished_at: null },
  ],
  spend: [
    { client_id: "gads-a", spend: 1000 },
    { client_id: "meta-b", spend: 500.4 },
    { client_id: "gads-oud", spend: 99_999 },
    { client_id: "demo-greentech", spend: 584_500 },
  ],
  hypotheses: [
    { client_id: "gads-a", outcome: "uitgevoerd_en_gehaald", result_met: true, evaluated_at: dagenGeleden(3) },
    { client_id: "gads-oud", outcome: "uitgevoerd_en_niet_gehaald", result_met: false, evaluated_at: dagenGeleden(30) },
    { client_id: "gads-a", outcome: "unmeasurable", result_met: null, evaluated_at: dagenGeleden(3) },
    { client_id: "demo-greentech", outcome: "uitgevoerd_en_gehaald", result_met: true, evaluated_at: dagenGeleden(1) },
  ],
  analyses: [{ client_id: "gads-a" }, { client_id: "meta-b" }, { client_id: "gads-oud" }, { client_id: "demo-greentech" }],
};
const actief = actieveKlanten(nieuw, nu);
check("actief: Google-sync van gisteren en Meta-run van eergisteren", actief.has("gads-a") && actief.has("meta-b") && actief.size === 2, [...actief].join(","));
const q = berekenPulse(nieuw, nu);
check("twee actieve klanten", q.activeClients === 2, JSON.stringify(q));
check("spend alleen van actieve klanten, zonder demo", q.adSpendOptimized === 1500, JSON.stringify(q));
check("analyses alleen van actieve klanten", q.analysesRun === 2, JSON.stringify(q));
check("getoetst: gehaald en niet gehaald, niet 'niet meetbaar' of demo", q.hypothesesTested === 2, JSON.stringify(q));
check("met actieve klanten staat het blok er", pulseTonen(q));

check("zonder evaluatiedatum geen getoetste uitkomst", !isGetoetst({ client_id: "x", outcome: "uitgevoerd_en_gehaald", result_met: true, evaluated_at: null }));
check("een sync in de toekomst telt niet", actieveKlanten({ googleStatus: [{ client_id: "x", last_successful_sync_at: "2027-01-01T00:00:00Z" }], kanaalRuns: [] }, nu).size === 0);

console.log(`platform pulse: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
