// Test: het slagingspercentage van de analyses per cadans (lib/eval/analyse-slagingen.ts).
// Draaien: tsx lib/eval/__analyse_slagingen_test.ts
//
// Het hoofdgeval is de meting uit de doorlichting van 13 november: monthly_sop 11 afgerond,
// 14 mislukt, 15 op "running" met een updated_at gelijk aan de startdag. Dat is 11 van 40, en het
// script moet daarop waarschuwen. Telde het de vastgelopen runs niet mee, dan stond er 11 van 25.

import { vatSlagingenSamen, slagingsRegel, beslisSlagingsPoort, type GenerationJobRij } from "./analyse-slagingen";
import { STALE_RUNNING_MINUTES } from "../scheduler/core";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = new Date("2026-11-13T12:00:00Z");
const rij = (job_type: string, status: string, updated_at = "2026-09-01T15:00:00Z"): GenerationJobRij =>
  ({ job_type, status, started_at: updated_at, updated_at });
const herhaal = (n: number, r: GenerationJobRij) => Array.from({ length: n }, () => r);

const rijen: GenerationJobRij[] = [
  ...herhaal(11, rij("monthly_sop", "completed")),
  ...herhaal(14, rij("monthly_sop", "failed")),
  ...herhaal(15, rij("monthly_sop", "running")),
  ...herhaal(16, rij("weekly_sop", "completed")),
  ...herhaal(6, rij("weekly_sop", "failed")),
  ...herhaal(14, rij("biweekly_sop", "completed")),
  ...herhaal(4, rij("biweekly_sop", "failed")),
  // Een run die net bezig is (vijf minuten geleden bijgewerkt) is geen mislukking.
  rij("biweekly_sop", "running", "2026-11-13T11:55:00Z"),
  rij("pdf_generation", "completed"),
  rij("pdf_generation", "failed"),
];

const uit = vatSlagingenSamen(rijen, { nu: NU, vastgelopenNaMinuten: STALE_RUNNING_MINUTES, grens: 0.8, minimumPogingen: 5 });
const per = new Map(uit.map((u) => [u.cadans, u]));

const maand = per.get("monthly_sop")!;
check("maand: 15 vastgelopen", maand.vastgelopen === 15, String(maand.vastgelopen));
check("maand: 11 van 40 afgerond", maand.slagingspercentage === 11 / 40, String(maand.slagingspercentage));
check("maand: waarschuwing onder 80%", maand.waarschuwing === true);
check("maand: de regel noemt LAAG en 28%", /LAAG/.test(slagingsRegel(maand)) && /28%/.test(slagingsRegel(maand)), slagingsRegel(maand));

const week = per.get("weekly_sop")!;
check("week: 16 van 22", week.slagingspercentage === 16 / 22);
check("week: 73% is onder 80%, dus waarschuwing", week.waarschuwing === true);

const tweeweek = per.get("biweekly_sop")!;
check("tweeweek: de lopende run telt als bezig, niet als vastgelopen", tweeweek.bezig === 1 && tweeweek.vastgelopen === 0);
check("tweeweek: 14 van 18", tweeweek.slagingspercentage === 14 / 18);

const pdf = per.get("pdf_generation")!;
check("twee pogingen: wel een percentage, geen waarschuwing (te weinig om iets te zeggen)", pdf.slagingspercentage === 0.5 && pdf.waarschuwing === false);

// Boven de grens: geen waarschuwing.
const goed = vatSlagingenSamen(herhaal(9, rij("weekly_sop", "completed")).concat([rij("weekly_sop", "failed")]),
  { nu: NU, vastgelopenNaMinuten: STALE_RUNNING_MINUTES, grens: 0.8, minimumPogingen: 5 });
check("9 van 10: geen waarschuwing", goed[0].waarschuwing === false && goed[0].slagingspercentage === 0.9);

// Een running-job zonder tijd telt als vastgelopen: niets zegt dat hij leeft.
const zonderTijd = vatSlagingenSamen([{ job_type: "weekly_sop", status: "running", started_at: null, updated_at: null }],
  { nu: NU, vastgelopenNaMinuten: STALE_RUNNING_MINUTES, grens: 0.8, minimumPogingen: 1 });
check("running zonder tijd -> vastgelopen", zonderTijd[0].vastgelopen === 1 && zonderTijd[0].slagingspercentage === 0);

// Alleen lopende of wachtende jobs: geen percentage, geen waarschuwing.
const alleenBezig = vatSlagingenSamen([rij("weekly_sop", "queued")], { nu: NU, vastgelopenNaMinuten: 15, grens: 0.8, minimumPogingen: 1 });
check("alleen queued: percentage null", alleenBezig[0].slagingspercentage === null && alleenBezig[0].waarschuwing === false);

// De eindbeslissing. Een leeg venster is NIET groen: de vorige versie gaf daar exit 0, en omdat de
// keten sinds 1 september stilstaat zou de poort vanaf eind november groen staan omdat er niets
// draait.
const leegVenster = beslisSlagingsPoort([], [{ cadans: "monthly_sop", laatst: "2026-09-01T15:00:00Z" }], { nu: NU });
check("leeg venster: rood", leegVenster.code === 1);
check("leeg venster: noemt de laatste afgeronde maandrun", leegVenster.meldingen.some((m) => /monthly_sop: 2026-09-01/.test(m)), JSON.stringify(leegVenster.meldingen));
check("leeg venster: een cadans die nooit afrondde heet 'nooit'", leegVenster.meldingen.some((m) => /weekly_sop: nooit/.test(m)));

// Het percentage oogt goed, maar de laatste afgeronde maandrun is van 1 september: stilstand.
const goedMaarOud = beslisSlagingsPoort(
  vatSlagingenSamen(herhaal(9, rij("monthly_sop", "completed")), { nu: NU, vastgelopenNaMinuten: 15, grens: 0.8, minimumPogingen: 5 }),
  [{ cadans: "monthly_sop", laatst: "2026-09-01T15:00:00Z" }],
  { nu: NU, maxDagen: { monthly_sop: 38 } });
check("100% maar laatste afronding te oud: rood", goedMaarOud.code === 1 && /stil/.test(goedMaarOud.meldingen.join(" ")), JSON.stringify(goedMaarOud));

const vers = beslisSlagingsPoort(
  vatSlagingenSamen(herhaal(9, rij("weekly_sop", "completed", "2026-11-10T03:00:00Z")), { nu: NU, vastgelopenNaMinuten: 15, grens: 0.8, minimumPogingen: 5 }),
  [{ cadans: "weekly_sop", laatst: "2026-11-10T03:00:00Z" }],
  { nu: NU, maxDagen: { weekly_sop: 10 } });
check("goed percentage en recente afronding: groen", vers.code === 0, JSON.stringify(vers));

const onderGrens = beslisSlagingsPoort(uit, [
  { cadans: "monthly_sop", laatst: "2026-11-02T03:00:00Z" },
  { cadans: "weekly_sop", laatst: "2026-11-10T03:00:00Z" },
  { cadans: "biweekly_sop", laatst: "2026-11-05T03:00:00Z" },
], { nu: NU });
check("onder de grens met recente runs: rood", onderGrens.code === 1 && /onder de grens/.test(onderGrens.meldingen.join(" ")));

console.log(`analyse-slagingen: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
