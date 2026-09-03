// De datastand: live afgeleid uit de data, niet uit een opgeslagen label. Legt de grenzen vast
// waarop de aanvoer-audit van 3 september 2026 stukliep (data t/m april, "fresh" in de status).
// Draaien: npx tsx lib/sync/__datastand_test.ts

import { beoordeelDatastand, beoordeelWeekstand, datastandBlokkade, weekstandBlokkade, datastandVoorKlant, weekstandVoorKlant, DOOD_VANAF_MAANDEN } from "./datastand";
import { FakeSupabase } from "../decision/__fake_supabase";
import { DataLaagFout } from "../analysis/db-veilig";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

async function main() {
  console.log("beoordeelDatastand: de vier toestanden");
  {
    const NU = "2026-09-03"; // laatste afgesloten maand: augustus
    const actueel = beoordeelDatastand({ laatsteMaand: "2026-08-01", laatsteGeslaagdeSync: "2026-09-02T05:10:00Z", nu: NU });
    check("augustus aanwezig in september: actueel", actueel.toestand === "actueel" && actueel.maandenAchter === 0, JSON.stringify(actueel));
    check("tekst noemt de maand en de sync", actueel.tekst.includes("Augustus 2026") && actueel.tekst.includes("1 dagen geleden"), actueel.tekst);
    const achter = beoordeelDatastand({ laatsteMaand: "2026-07-01", laatsteGeslaagdeSync: "2026-08-02T05:10:00Z", nu: NU });
    check("juli als nieuwste: één maand achter", achter.toestand === "achter" && achter.maandenAchter === 1);
    const dood = beoordeelDatastand({ laatsteMaand: "2026-04-01", laatsteGeslaagdeSync: "2026-04-17T15:14:13Z", nu: NU });
    check(`april in september: ${DOOD_VANAF_MAANDEN}+ maanden achter is 'dood'`, dood.toestand === "dood" && dood.maandenAchter === 4, JSON.stringify(dood));
    check("tekst zegt dat de sync niet draait, met dagen sinds de sync", dood.tekst.includes("draait niet") && dood.tekst.includes("139 dagen"), dood.tekst);
    const geen = beoordeelDatastand({ laatsteMaand: null, laatsteGeslaagdeSync: null, nu: NU });
    check("zonder rijen: geen", geen.toestand === "geen" && geen.tekst.includes("nooit"));
    const kapot = beoordeelDatastand({ laatsteMaand: "onzin", nu: NU });
    check("ongeldige maandwaarde telt als geen data, geen crash", kapot.toestand === "geen");
    const jan = beoordeelDatastand({ laatsteMaand: "2025-12-01", nu: "2026-01-15" });
    check("in januari is december actueel (jaargrens)", jan.toestand === "actueel");
  }

  console.log("datastandBlokkade: alleen actueel mag door");
  {
    const NU = "2026-09-03";
    check("actueel: geen blokkade", datastandBlokkade(beoordeelDatastand({ laatsteMaand: "2026-08-01", nu: NU })) === null);
    const b = datastandBlokkade(beoordeelDatastand({ laatsteMaand: "2026-07-01", nu: NU }));
    check("één maand achter blokkeert een maandanalyse (de analysemaand is leeg)", b !== null && b.includes("Augustus 2026"), String(b));
    check("geen data blokkeert", datastandBlokkade(beoordeelDatastand({ laatsteMaand: null, nu: NU }))?.includes("Geen Google-data") === true);
  }

  console.log("beoordeelWeekstand");
  {
    const NU = "2026-09-03";
    check("week van 24 aug (eind 31 aug): actueel", beoordeelWeekstand({ laatsteWeekStart: "2026-08-24", nu: NU }).toestand === "actueel");
    check("week van 10 aug: achter", beoordeelWeekstand({ laatsteWeekStart: "2026-08-10", nu: NU }).toestand === "achter");
    const dood = beoordeelWeekstand({ laatsteWeekStart: "2026-04-13", nu: NU });
    check("week van 13 april: dood", dood.toestand === "dood" && dood.tekst.includes("2026-04-13"));
    check("achter blokkeert de weekly niet, dood wel", weekstandBlokkade(beoordeelWeekstand({ laatsteWeekStart: "2026-08-10", nu: NU })) === null && weekstandBlokkade(dood) !== null);
    check("geen weekdata: geen", beoordeelWeekstand({ laatsteWeekStart: null, nu: NU }).toestand === "geen");
  }

  console.log("datastandVoorKlant: maximum in het geheugen, fout is fout");
  {
    const sb = new FakeSupabase();
    sb.seed("ads_account_monthly", [
      { client_id: "k1", month: "2026-03-01" }, { client_id: "k1", month: "2026-04-01" }, { client_id: "k1", month: "2025-12-01" },
      { client_id: "ander", month: "2026-08-01" },
    ]);
    sb.seed("client_sync_status", [{ client_id: "k1", last_successful_sync_at: "2026-04-17T15:14:13Z" }]);
    const stand = await datastandVoorKlant(sb as never, "k1");
    check("nieuwste maand van DEZE klant is april", stand.laatsteMaand === "2026-04", JSON.stringify(stand));
    check("laatste geslaagde sync komt uit client_sync_status", stand.laatsteGeslaagdeSync === "2026-04-17T15:14:13Z");
    sb.seed("ads_account_weekly", [{ client_id: "k1", week_start: "2026-04-06" }, { client_id: "k1", week_start: "2026-04-13" }]);
    const week = await weekstandVoorKlant(sb as never, "k1");
    check("nieuwste week is 13 april", week.laatsteWeekStart === "2026-04-13");
    const kapot = new FakeSupabase();
    kapot.faalOp("ads_account_monthly", "permission denied");
    let fout: unknown = null;
    try { await datastandVoorKlant(kapot as never, "k1"); } catch (e) { fout = e; }
    check("een queryfout gooit DataLaagFout, geen 'geen data'", fout instanceof DataLaagFout);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
