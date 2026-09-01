// De veilige datalaag: foutcontrole, paginering en de maandhulpjes.
// Draaien: npx tsx lib/analysis/__db_veilig_test.ts
//
// Dit zijn de drie fouten die de sloop-audit van 1 september in vrijwel elke deep dive
// vond (geslikte queryfout, stille 1000-rijen-afkap, `-01` geplakt op een volledige
// datum). De module bestaat om ze onmogelijk te maken; deze test legt dat gedrag vast.

import {
  eis, alleRijen, DataLaagFout, dataFoutNaarResponse,
  maandStart, maandSleutel, laatsteAfgeslotenMaandStart, lopendeMaandStart,
  afgeslotenMaandenTerugStart,
} from "./db-veilig";
import { lastCompleteMonth } from "../period/period-range";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("eis: een queryfout is een fout, geen lege uitkomst");
{
  check("data komt door", eis({ data: [1, 2], error: null }, "x").length === 2);
  check("null-data wordt lege lijst", eis({ data: null, error: null }, "x").length === 0);
  try {
    eis({ data: null, error: { message: "kolom bestaat niet" } }, "tabel-y");
    check("fout gooit", false);
  } catch (e) {
    check("fout gooit DataLaagFout", e instanceof DataLaagFout);
    check("met context en oorzaak", String(e).includes("tabel-y") && String(e).includes("kolom bestaat niet"));
    const res = dataFoutNaarResponse(e);
    check("en wordt een 500 met uitleg", res !== null && res.status === 500);
  }
  check("andere fouten gaan niet mee", dataFoutNaarResponse(new Error("los")) === null);
}

console.log("\nmaandhulpjes: de -01-val kan niet meer");
{
  check("volledige datum blijft heel", maandStart("2026-08-01") === "2026-08-01");
  check("korte maand wordt datum", maandStart("2026-08") === "2026-08-01");
  check("timestamp wordt maandstart", maandStart("2026-08-14T09:00:00Z") === "2026-08-01");
  check("sleutel uit datum", maandSleutel("2026-08-01") === "2026-08");
  check("sleutel uit sleutel", maandSleutel("2026-08") === "2026-08");

  const afgesloten = laatsteAfgeslotenMaandStart();
  check("afgesloten maand is een geldige datum", /^\d{4}-\d{2}-01$/.test(afgesloten), afgesloten);
  check("en spoort met period-range", afgesloten === `${lastCompleteMonth()}-01`);

  const lopend = lopendeMaandStart();
  check("lopende maand is een geldige datum", /^\d{4}-\d{2}-01$/.test(lopend), lopend);
  check("en ligt ná de afgesloten maand", lopend > afgesloten);

  check("0 terug = de afgesloten maand zelf", afgeslotenMaandenTerugStart(0) === afgesloten);
  const [jaar, maand] = lastCompleteMonth().split("-").map(Number);
  const verwacht12 = `${jaar - 1}-${String(maand).padStart(2, "0")}-01`;
  check("12 terug = zelfde maand vorig jaar", afgeslotenMaandenTerugStart(12) === verwacht12,
    `${afgeslotenMaandenTerugStart(12)} vs ${verwacht12}`);
  const een = afgeslotenMaandenTerugStart(1);
  check("1 terug is echt eerder", maandSleutel(een) < maandSleutel(afgesloten));
}

async function asyncDeel(): Promise<void> {
  console.log("\nalleRijen: pagineert langs de cap en meldt afkap");

  // Nepbron met 2500 rijen in pagina's van max 1000.
  const bron = Array.from({ length: 2500 }, (_, i) => i);
  const haal = async (van: number, tot: number) => ({
    data: bron.slice(van, Math.min(tot + 1, bron.length)),
    error: null,
  });
  const alles = await alleRijen(haal, "bron");
  check("alle 2500 rijen komen binnen", alles.rijen.length === 2500, String(alles.rijen.length));
  check("in volgorde", alles.rijen[2499] === 2499);
  check("niet afgekapt gemeld", alles.afgekapt === false);

  const geklemd = await alleRijen(haal, "bron", { max: 2000 });
  check("het plafond klemt", geklemd.rijen.length === 2000, String(geklemd.rijen.length));
  check("en meldt afgekapt", geklemd.afgekapt === true);

  const fout = await alleRijen(
    async () => ({ data: null, error: { message: "boem" } }),
    "kapotte-bron"
  ).then(() => null, (e: unknown) => e);
  check("een paginafout gooit door", fout instanceof DataLaagFout);
}

asyncDeel().then(() => {
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
});
