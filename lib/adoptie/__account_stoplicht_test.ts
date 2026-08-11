// Het account-stoplicht (Code Rood/Amber per klantaccount). Deterministisch, geen IO.
// Draaien: npx tsx lib/adoptie/__account_stoplicht_test.ts
//
// Een vast "nu", om dezelfde reden als __stoplicht_test.ts: anders verandert de uitkomst met de
// dag waarop de suite draait.

import {
  heeftStructureleForecastAfwijking, detecteerNieuweGebruiker, beoordeelAccount,
  FORECAST_AFWIJKING_PCT, FORECAST_AANHOUDEND_MAANDEN, NIEUWE_GEBRUIKER_VENSTER_DAGEN,
} from "./account-stoplicht";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = new Date("2026-08-11T12:00:00Z");
const dagenTerug = (n: number) => new Date(NU.getTime() - n * 86_400_000).toISOString();

// ── heeftStructureleForecastAfwijking ───────────────────────────────────────

check("null signaal is geen afwijking", !heeftStructureleForecastAfwijking(null));
check("te weinig maanden telt niet mee",
  !heeftStructureleForecastAfwijking({ afwijkingenPct: [-50] }));
check(`precies ${FORECAST_AANHOUDEND_MAANDEN} maanden op de drempel is wel structureel`,
  heeftStructureleForecastAfwijking({ afwijkingenPct: [-FORECAST_AFWIJKING_PCT, -FORECAST_AFWIJKING_PCT] }));
check("een van de twee maanden onder de drempel telt niet",
  !heeftStructureleForecastAfwijking({ afwijkingenPct: [-FORECAST_AFWIJKING_PCT, -(FORECAST_AFWIJKING_PCT - 1)] }));
check("positieve afwijking (ver boven forecast) telt ook mee, op basis van absolute waarde",
  heeftStructureleForecastAfwijking({ afwijkingenPct: [60, 55] }));
check("alleen de laatste N maanden tellen, een oude goede maand redt het niet",
  heeftStructureleForecastAfwijking({ afwijkingenPct: [5, -60, -55] }));
check("een recente goede maand doorbreekt de reeks",
  !heeftStructureleForecastAfwijking({ afwijkingenPct: [-60, -5] }));

// ── detecteerNieuweGebruiker ─────────────────────────────────────────────────

const wijziging = (email: string | null, dagenTerugN: number, resourceType = "CAMPAIGN") => ({
  changeDatetime: dagenTerug(dagenTerugN), userEmail: email, resourceType, changeType: "UPDATE",
});

check("lege geschiedenis geeft geen signaal", detecteerNieuweGebruiker([], NU) === null);

check("enige wijziging ooit telt niet als 'nieuw' als hij buiten het venster valt",
  detecteerNieuweGebruiker([wijziging("a@bureau.nl", NIEUWE_GEBRUIKER_VENSTER_DAGEN + 10)], NU) === null);

{
  const sig = detecteerNieuweGebruiker([wijziging("a@bureau.nl", 5)], NU);
  check("een wijziging binnen het venster zonder historie is wel nieuw", sig !== null && sig.email === "a@bureau.nl", JSON.stringify(sig));
}

{
  const geschiedenis = [
    wijziging("bekend@bureau.nl", 200),
    wijziging("bekend@bureau.nl", 10),
    wijziging("nieuw@extern.nl", 3),
  ];
  const sig = detecteerNieuweGebruiker(geschiedenis, NU);
  check("bekend e-mailadres blijft onopgemerkt, alleen het nieuwe komt terug",
    sig !== null && sig.email === "nieuw@extern.nl", JSON.stringify(sig));
}

{
  // Hoofdlettergevoeligheid mag geen vals-positief opleveren.
  const geschiedenis = [wijziging("Bekend@Bureau.nl", 200), wijziging("bekend@bureau.nl", 3)];
  const sig = detecteerNieuweGebruiker(geschiedenis, NU);
  check("hetzelfde adres in andere hoofdletters is niet nieuw", sig === null, JSON.stringify(sig));
}

{
  // Een e-mailadres dat al eerder BINNEN het venster is gezien mag niet twee keer als nieuw
  // binnenkomen -- de tweede wijziging van dezelfde nieuwkomer is geen tweede signaal.
  const geschiedenis = [wijziging("nieuw@extern.nl", 10), wijziging("nieuw@extern.nl", 2)];
  const sig = detecteerNieuweGebruiker(geschiedenis, NU);
  check("de eerste (oudste) wijziging van de nieuwkomer komt terug, niet de tweede",
    sig !== null && sig.eersteWijziging === dagenTerug(10), JSON.stringify(sig));
}

check("rijen zonder e-mailadres worden genegeerd, geen crash",
  detecteerNieuweGebruiker([wijziging(null, 1)], NU) === null);

// ── beoordeelAccount: de combinatie-regel ───────────────────────────────────

const geenForecast = null;
const forecastAfwijking = { afwijkingenPct: [-45, -50] };
const geenGebruiker = null;
const nieuweGebruiker = { email: "nieuw@extern.nl", eersteWijziging: dagenTerug(2), wijzigingType: "CAMPAIGN_BUDGET" };

check("geen van beide signalen is groen",
  beoordeelAccount({ forecast: geenForecast, nieuweGebruiker: geenGebruiker }).licht === "groen");

check("alleen forecast-afwijking is amber, niet rood",
  beoordeelAccount({ forecast: forecastAfwijking, nieuweGebruiker: geenGebruiker }).licht === "amber");

check("alleen nieuwe gebruiker is amber, niet rood",
  beoordeelAccount({ forecast: geenForecast, nieuweGebruiker }).licht === "amber");

{
  const o = beoordeelAccount({ forecast: forecastAfwijking, nieuweGebruiker });
  check("de combinatie van beide is rood", o.licht === "rood", o.licht);
  check("rood draagt beide redenen", o.redenen.length === 2, JSON.stringify(o.redenen));
}

for (const geval of [
  { forecast: forecastAfwijking, nieuweGebruiker: geenGebruiker },
  { forecast: geenForecast, nieuweGebruiker },
  { forecast: forecastAfwijking, nieuweGebruiker },
]) {
  const o = beoordeelAccount(geval);
  check(`${o.licht} draagt minstens een reden`, o.redenen.length > 0 && o.redenen[0].length > 5, JSON.stringify(o));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
