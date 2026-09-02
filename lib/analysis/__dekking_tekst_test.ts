// De dekkingsregel voor de kaarten: periode → tekst + verouderd-vlag, dekking-blok → waarschuwingen.
// Draaien: npx tsx lib/analysis/__dekking_tekst_test.ts

import { dekkingUitPeriode, waarschuwingenUitDekking } from "./dekking-tekst";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("dekkingUitPeriode");
{
  const r = dekkingUitPeriode("2026-06-01", "2026-08-01", "2026-08");
  check("periode wordt tekst", r?.tekst === "Data: 2026-06-01 t/m 2026-08-01", r?.tekst);
  check("eindmaand = afgesloten maand is niet verouderd", r?.verouderd === false);
  const oud = dekkingUitPeriode("2026-02-01", "2026-04-01", "2026-08");
  check("april tegen augustus is verouderd", oud?.verouderd === true);
  check("en zegt dat in de tekst", /ouder dan/.test(oud?.tekst ?? ""));
  const dag = dekkingUitPeriode("2026-07-01", "2026-09-02", "2026-08");
  check("dagdata tot in de lopende maand is niet verouderd", dag?.verouderd === false);
  const een = dekkingUitPeriode("2026-08-01", "2026-08-01", "2026-08");
  check("gelijke grenzen worden 'Data t/m'", een?.tekst === "Data t/m 2026-08-01", een?.tekst);
  check("zonder einde geen regel", dekkingUitPeriode(null, null) === null);
  check("timestamp wordt datum", dekkingUitPeriode("2026-08-01T00:00:00Z", "2026-08-03T10:00:00Z", "2026-08")?.tekst === "Data: 2026-08-01 t/m 2026-08-03");
}

console.log("waarschuwingenUitDekking");
{
  check("niets bij lege input", waarschuwingenUitDekking(null).length === 0 && waarschuwingenUitDekking("x").length === 0);
  const w = waarschuwingenUitDekking({ verouderd: true, peilmaand: "2026-04", rijenAfgekapt: true, buitenDekkingCampagnes: 2, uurdata: false });
  check("vier waarschuwingen", w.length === 4, String(w.length));
  check("verouderd noemt de peilmaand", /2026-04/.test(w[0]));
  check("afkap wordt gemeld", w.some((t) => /plafond/.test(t)));
  check("dekkingsgrens wordt gemeld", w.some((t) => /2 campagne/.test(t)));
  check("uurdata=true geeft geen waarschuwing", waarschuwingenUitDekking({ uurdata: true }).length === 0);
  check("verouderd zonder maand blijft leesbaar", /ouder dan/.test(waarschuwingenUitDekking({ verouderd: true })[0]));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
