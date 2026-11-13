// Vensters die zeggen wat ze tellen: "laatste 28 dagen" is 28 dagen, "Wat er draait" geeft elk
// kanaal hetzelfde dagvenster (Google op hele maanden) met een label, en de beursstrook noemt een
// week die al begonnen is geen prognose.
// Draaien: tsx lib/__vensters_campagnes_beurs_test.ts
//
// Tegenvoorbeelden uit de doorlichting van 13 november: de Microsoft-campagnetabel "laatste 28
// dagen" € 957 tegen € 924 in de kerncijfers (29 dagen); "Wat er draait" met Google over 200 dagen
// naast Meta over 90, zonder label; de beursweek van 2 november op 13 november als "Prognose 106".

import { eersteDagVanVenster } from "./period/dag-venster";
import { weekSoort, WEEK_SOORT_LABEL, WEEK_SOORT_UITLEG } from "./overzicht/beursweek";
import { campagneVensters } from "../components/dashboard/campaigns-per-channel";
import { geenBeursfilterTekst, overzichtBeursmelding } from "./overzicht/beursfilter";
import { kiezerOpTab } from "./period/kiezer-per-tab";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const dagenTussen = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

// 28 dagen, vandaag meegeteld.
const begin = eersteDagVanVenster("2026-11-13", 28);
check("laatste 28 dagen begint op 17 oktober", begin === "2026-10-17", begin);
check("en telt 28 kalenderdagen", dagenTussen(begin, "2026-11-13") === 28, String(dagenTussen(begin, "2026-11-13")));
check("over een maandgrens met 31 dagen", eersteDagVanVenster("2026-03-01", 28) === "2026-02-02");

// Eén venster voor alle vier de kanalen.
const v = campagneVensters("2026-11-13");
check("dagvenster: 90 dagen", dagenTussen(v.sinceDay, "2026-11-13") === 90, v.sinceDay);
check("Google: vanaf de maand waarin het dagvenster begint", v.sinceMonth === `${v.sinceDay.slice(0, 7)}-01`, v.sinceMonth);
check("Google niet meer 200 dagen terug", Date.parse(v.sinceMonth) > Date.parse("2026-07-01"), v.sinceMonth);
check("beide vensters hebben een label", v.dagLabel.includes("90 dagen") && v.maandLabel.includes("hele maanden"), `${v.dagLabel} / ${v.maandLabel}`);

// De beursstrook.
const vandaag = "2026-11-13";
check("week van 2 november zonder gerealiseerd: geschat, geen prognose", weekSoort({ realized: null, weekStart: "2026-11-02" }, vandaag) === "geschat");
check("deze week (maandag 9 november): geschat", weekSoort({ realized: null, weekStart: "2026-11-09" }, vandaag) === "geschat");
check("volgende week: prognose", weekSoort({ realized: null, weekStart: "2026-11-16" }, vandaag) === "prognose");
check("met gerealiseerd: gerealiseerd", weekSoort({ realized: 40, weekStart: "2026-10-05" }, vandaag) === "gerealiseerd");
check("het label van geschat zegt niet 'Prognose'", !WEEK_SOORT_LABEL.geschat.includes("Prognose"));
check("het label past in een weekkaart (kort), de uitleg staat erbij", WEEK_SOORT_LABEL.geschat.length <= 12 && (WEEK_SOORT_UITLEG.geschat ?? "").includes("maandtempo"));

// Een gekozen beurs die een blok niet volgt.
check("zonder beurs geen regel", geenBeursfilterTekst(null, "Bevindingen", true) === null);
const t = geenBeursfilterTekst("GRT", "Bevindingen", true);
check("met beurs: zegt dat het het hele account is", t === "Bevindingen tonen het hele account, niet gefilterd op beurs GRT.", String(t));

// Het Overzicht: dezelfde regel in beide weergaven (de functie kent de weergave niet; client-dashboard
// zet hem onder de band van de vertrouwde weergave én onder OverzichtBovenkant van de nieuwe).
// Tegenvoorbeeld: nieuwe weergave, ?geo=GRT, accounttegels (3.416 conversies, CPA € 57) zonder melding.
const opBlended = overzichtBeursmelding("GRT", "dashboard", "blended");
check("Overzicht, Alle kanalen, beurs GRT: melding", opBlended !== null && opBlended.tekst.includes("beurs GRT"), JSON.stringify(opBlended));
const opGoogle = overzichtBeursmelding("GRT", "dashboard", "google");
check("Overzicht, Google: melding noemt ook de blokken eronder", opGoogle !== null && opGoogle.tekst.includes("pacing") && opGoogle.tekst.includes("prognose"), JSON.stringify(opGoogle));
check("Overzicht zonder beurs: geen melding", overzichtBeursmelding(null, "dashboard", "blended") === null);
check("ander tabblad: het tabblad meldt het zelf", overzichtBeursmelding("GRT", "insights", "blended") === null);

// De periodekiezer staat alleen waar een blok hem volgt.
check("Overzicht: kiezer", kiezerOpTab("dashboard", false).toon && kiezerOpTab("dashboard", true).toon);
for (const tab of ["forecast", "insights", "sprint", "dgm"]) {
  const k = kiezerOpTab(tab, true);
  check(`${tab}: geen kiezer, wel uitleg`, !k.toon && k.uitleg.length > 0, JSON.stringify(k));
}
const prognose = kiezerOpTab("forecast", false);
check("Prognose noemt het kalenderjaar", !prognose.toon && prognose.uitleg.includes("kalenderjaar"));
check("Campagnes in de nieuwe weergave: kiezer (kanaaltotalen volgen hem)", kiezerOpTab("campaigns", true).toon);
check("Campagnes in de vertrouwde weergave: geen kiezer", !kiezerOpTab("campaigns", false).toon);

console.log(`vensters, campagnes en beurs: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
