// Eén definitie van het jaardoel: over welke kanalen het gaat en wat elk scherm ermee doet
// (lib/doel/jaardoel.ts, mergeKpiTargetsVoorReeks in lib/kpi-target-merge.ts).
// Draaien: tsx lib/__jaardoel_bereik_test.ts
//
// Het tegenvoorbeeld uit de doorlichting van 13 november, demo-greentech: één doel van 2.600
// conversies (CPA-doel € 45) in Instellingen, zonder kanaal, en vier kanalen. Overzicht (alle
// kanalen): 3.072 gerealiseerd, prognose 3.972, +52,8%. Google-tab en Doelen & voortgang: dezelfde
// 2.600 tegen Google alleen, 1.091 gerealiseerd, prognose 1.264, -51%, "verhoog budget met 635%"
// naast "meer budget is niet de oplossing". En het advertentiebudget, prognose € 140.897 tegen een
// doel van € 117.000 (+20%), stond groen.

export {};

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const opslag = new Map<string, string>();
Object.assign(globalThis, {
  document: { cookie: "" },
  window: {},
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); } },
});

async function main() {
  const j = await import("./doel/jaardoel");
  const { mergeKpiTargetsVoorReeks } = await import("./kpi-target-merge");

  const vier = j.jaardoelBereik(["meta", "google", "microsoft", "linkedin"]);
  const alleenGoogle = j.jaardoelBereik(["google"]);

  // ── Over welke reeks het doel gaat ──
  check("vier kanalen: het doel geldt voor alle kanalen samen", j.doelGeldtVoor(vier, "blended"));
  check("vier kanalen: het doel geldt NIET voor Google alleen", !j.doelGeldtVoor(vier, "google"));
  check("vier kanalen: niet voor Meta alleen", !j.doelGeldtVoor(vier, "meta"));
  check("vier kanalen: beoordelen op alle kanalen samen", j.reeksVanDoel(vier) === "blended");
  check("alleen Google: het doel geldt voor Google", j.doelGeldtVoor(alleenGoogle, "google"));
  check("alleen Google: beoordelen op Google", j.reeksVanDoel(alleenGoogle) === "google");
  check("kanalen onbekend: zoals voorheen op Google", j.doelGeldtVoor(null, "google") && !j.doelGeldtVoor(null, "meta"));
  check("volgorde vast, ongeacht invoer", vier!.kanalen.join(",") === "google,meta,linkedin,microsoft", vier!.kanalen.join(","));

  // ── Elk scherm zegt waarover ──
  const blendedTekst = j.oordeelOverTekst(vier, "blended");
  check("alle kanalen noemt alle vier", ["Google Ads", "Meta", "LinkedIn", "Microsoft Ads"].every((n) => blendedTekst.includes(n)), blendedTekst);
  const googleTekst = j.oordeelOverTekst(vier, "google");
  check("Google-tab zegt dat het alleen Google is", googleTekst.includes("alleen over Google Ads"), googleTekst);
  check("Google-tab zegt dat het doel voor alle kanalen geldt", googleTekst.includes("alle kanalen samen"), googleTekst);
  check("enig kanaal zegt dat", j.oordeelOverTekst(alleenGoogle, "google").includes("enige kanaal"), j.oordeelOverTekst(alleenGoogle, "google"));

  // ── De voetregel van Pacing & jaaroverzicht spreekt zichzelf niet tegen ──
  // Nagerekend op demo-greentech: de Google-tab zei "Het jaardoel uit Instellingen geldt voor alle
  // kanalen samen (...)" en twee zinnen later "Geen jaardoel ingevoerd: de kolom toont een schatting".
  // De Google-route levert geen herkomst; mergeKpiTargetsVoorReeks zet die van de route terug.
  const { doelVoetregel } = await import("./overzicht/pacing-jaar");
  type Fc = Parameters<typeof doelVoetregel>[2];
  const zonderHerkomst = { doelHerkomst: undefined } as unknown as Fc;
  const metHerkomst = { doelHerkomst: { conversions: { soort: "absoluut" }, revenue: { soort: "standaard" } } } as unknown as Fc;
  const sleutels = ["conversions", "cpa", "adSpend"] as const;
  for (const ingevoerd of [true, false, undefined]) {
    const b = j.jaardoelBereik(["google", "meta", "linkedin", "microsoft"], ingevoerd);
    for (const reeks of ["google", "meta"] as const) {
      const regel = doelVoetregel(b, reeks, zonderHerkomst, sleutels);
      check(`voetregel ${reeks}, ingevoerd=${ingevoerd}: nooit Instellingen én "Geen jaardoel ingevoerd"`,
        !(regel.includes("Instellingen") && regel.includes("Geen jaardoel ingevoerd")), regel);
      check(`voetregel ${reeks}, ingevoerd=${ingevoerd}: zegt dat de kolom een eigen schatting is`, regel.includes("eigen schatting"), regel);
      check(`voetregel ${reeks}, ingevoerd=${ingevoerd}: Instellingen alleen als er een doel is`,
        regel.includes("uit Instellingen") === (ingevoerd === true), regel);
    }
  }
  const zonderDoelTekst = j.oordeelOverTekst(j.jaardoelBereik(["google", "meta"], false), "google");
  check("zonder ingevoerd doel zegt de kanaaltab dat er geen is", zonderDoelTekst.includes("geen jaardoel ingevoerd"), zonderDoelTekst);
  const blendedRegel = doelVoetregel(j.jaardoelBereik(["google", "meta"], true), "blended", metHerkomst, sleutels);
  check("alle kanalen met ingevoerd doel: uit Instellingen", blendedRegel.includes("Het jaardoel komt uit Instellingen"), blendedRegel);
  const alleenGoogleRegel = doelVoetregel(j.jaardoelBereik(["google"], false), "google", zonderHerkomst, sleutels);
  check("alleen Google zonder doel: de schatting, geen eigen-schatting-zin", alleenGoogleRegel.includes("Geen jaardoel ingevoerd") && !alleenGoogleRegel.includes("Instellingen geldt"), alleenGoogleRegel);

  // ── Het doel komt alleen op de reeks waar het voor is ──
  opslag.set("rm-dashboard-settings-demo", JSON.stringify({
    clientId: "demo", conversionActions: [], conversionLagDays: 3, kpiDoelenOpgeslagen: true,
    kpiTargets: {
      conversionsMode: "absolute", conversionsGrowthPct: 0, conversionsAbsolute: 2600,
      revenueMode: "growth", revenueGrowthPct: 0, revenueAbsolute: 0, roasTarget: 0, cpaTarget: 45,
      conversionOverrides: { "2026-03": 120 },
    },
  }));
  // De Google-reeks met het doel van de route (Google vorig jaar +10%).
  const google = {
    clientId: "demo", targetCurrentYear: { conversions: 1298, revenue: 270000, adSpend: 125000 },
    historicalYears: {}, currentYear: 2026, currentYearData: Array(12).fill(null),
  };
  const opGoogleVier = mergeKpiTargetsVoorReeks("demo", google, "google", vier);
  check("vier kanalen: Google houdt zijn eigen doel (1.298), niet 2.600", opGoogleVier.targetCurrentYear.conversions === 1298, String(opGoogleVier.targetCurrentYear.conversions));
  check("vier kanalen: Google houdt zijn kostendoel, niet 2.600 × € 45", opGoogleVier.targetCurrentYear.adSpend === 125000, String(opGoogleVier.targetCurrentYear.adSpend));
  check("vier kanalen: de handmatige conversiecorrecties blijven", opGoogleVier.conversionOverrides?.["2026-03"] === 120, JSON.stringify(opGoogleVier.conversionOverrides));
  const opGoogleAlleen = mergeKpiTargetsVoorReeks("demo", google, "google", alleenGoogle);
  check("alleen Google: het doel uit Instellingen (2.600)", opGoogleAlleen.targetCurrentYear.conversions === 2600, String(opGoogleAlleen.targetCurrentYear.conversions));
  const opAlles = mergeKpiTargetsVoorReeks("demo", { ...google, targetCurrentYear: { conversions: 3000, revenue: 300000, adSpend: 170000 } }, "blended", null);
  check("alle kanalen: het doel uit Instellingen (2.600)", opAlles.targetCurrentYear.conversions === 2600, String(opAlles.targetCurrentYear.conversions));
  check("alle kanalen: kostendoel 2.600 × € 45 = € 117.000", opAlles.targetCurrentYear.adSpend === 117000, String(opAlles.targetCurrentYear.adSpend));

  // ── Eén budgetadvies ──
  const rec = { behindTarget: true, efficiencyBottleneck: true, currentCpa: 108, cpaTarget: 45, spendIncreasePct: 635, requiredMonthlySpend: 71671 };
  const advies = j.budgetAdvies(rec, [], true);
  check("CPA € 108 boven doel € 45: efficiëntie, geen +635%", advies.soort === "efficientie", JSON.stringify(advies));
  check("bij efficiëntie nergens een verhogingspercentage", !("verhogingPct" in advies));
  check("doel geldt niet voor deze reeks: geen advies", j.budgetAdvies({ ...rec, efficiencyBottleneck: false }, [], false).soort === "geen");
  check("meting kapot gaat voor", j.budgetAdvies(rec, ["mrt 2026"], true).soort === "meting");
  const budget = j.budgetAdvies({ ...rec, efficiencyBottleneck: false, spendIncreasePct: 30 }, [], true);
  check("zonder bottleneck: budget +30%", budget.soort === "budget" && Math.round(budget.verhogingPct) === 30, JSON.stringify(budget));
  check("op schema: geen advies", j.budgetAdvies({ ...rec, behindTarget: false }, [], true).soort === "geen");

  // ── Het scenariovak verdwijnt niet bij een kleine achterstand ──
  const klein = j.budgetAdvies({ ...rec, efficiencyBottleneck: false, spendIncreasePct: 3 }, [], true);
  check("+3% budget: geen advies", klein.soort === "geen", JSON.stringify(klein));
  check("+3% budget, achter op doel: wel de verwachting", j.scenarioVak(klein, true, true) === "alleen-verwachting");
  check("op schema: geen vak", j.scenarioVak({ soort: "geen" }, false, true) === null);
  check("doel geldt niet: geen vak", j.scenarioVak({ soort: "geen" }, true, false) === null);
  check("met advies: het advies", j.scenarioVak(advies, true, true) === "advies");

  // ── Alle kanalen laden niet: Google tegen zijn eigen schatting, dus geen advies ──
  const terugval = j.gebruikteDoelReeks(vier, false);
  check("vier kanalen, blended laadt niet: rekent op Google", terugval.reeks === "google", terugval.reeks);
  check("en daar geldt het doel niet", terugval.doelGeldt === false);
  check("dus geen budgetadvies tegen de schatting", j.budgetAdvies({ ...rec, efficiencyBottleneck: false }, [], terugval.doelGeldt).soort === "geen");
  const geladen = j.gebruikteDoelReeks(vier, true);
  check("vier kanalen, blended geladen: het doel geldt", geladen.reeks === "blended" && geladen.doelGeldt);
  const enkel = j.gebruikteDoelReeks(alleenGoogle, false);
  check("alleen Google: Google, en het doel geldt", enkel.reeks === "google" && enkel.doelGeldt);

  // ── Overbesteding kleurt niet groen ──
  // Prognose € 140.897 tegen € 117.000: +20,4%.
  const over = ((140897 - 117000) / 117000) * 100;
  check("budget +20% boven doel is niet goed", j.doelOordeel(over, "rond") !== "goed", j.doelOordeel(over, "rond"));
  check("budget +20% boven doel is slecht", j.doelOordeel(over, "rond") === "slecht", j.doelOordeel(over, "rond"));
  check("budget binnen 5% is goed", j.doelOordeel(2, "rond") === "goed" && j.doelOordeel(-4, "rond") === "goed");
  check("conversies +20% is goed", j.doelOordeel(20, "hoger") === "goed");
  check("CPA +25% boven doel is slecht", j.doelOordeel(25, "lager") === "slecht");
  check("conversies -51% is slecht", j.doelOordeel(-51, "hoger") === "slecht");

  console.log(`jaardoel bereik: ${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
