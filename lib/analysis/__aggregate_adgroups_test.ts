// De voor-aggregatie van advertentiegroepen. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__aggregate_adgroups_test.ts
//
// De uitvoer van deze module gaat als JSON rechtstreeks de analyseprompt in. Elk getal leest het
// model als een meting. Dat maakte vier stille fouten hier duur:
//
//   1. Bij nul conversies werd de CPA gelijkgesteld aan de totale kosten. Een groep die 6 euro
//      uitgaf en niets opleverde kwam daarmee binnen als CPA 6 — de goedkoopste van de campagne.
//   2. Het campagnegemiddelde voor CPA en ROAS was het gemiddelde van de verhoudingen per
//      advertentiegroep. Een groep van 3 euro woog dan even zwaar als een van 1000 euro.
//   3. Een groep die stillag kreeg gemiddelde 0 en werd underperformer, met CPA 0.
//   4. Zonder voorgeschiedenis kwam er +100% uit, wat leest als gemeten groei.

import { aggregateAdGroups } from "./aggregate-adgroups";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const M = (n: number) => `2026-${String(n).padStart(2, "0")}-01`;
type R = Parameters<typeof aggregateAdGroups>[0][number];
const rij = (ag: string, maand: number, o: Partial<R> = {}): R => ({
  ad_group_id: ag, ad_group_name: ag, campaign_name: "C", month: M(maand),
  impressions: 1000, clicks: 50, cost: 100, conversions: 5, conversions_value: 500,
  cpa: 20, roas: 5, ...o,
});
const vind = (out: ReturnType<typeof aggregateAdGroups>, naam: string) =>
  out.ad_group_details.find((a) => a.ad_group_name === naam)!;

// ── Nul conversies is geen CPA ────────────────────────────────────────────

console.log("Nul conversies levert geen kosten-per-conversie op");
{
  const rows: R[] = [];
  for (let m = 1; m <= 6; m++) {
    rows.push(rij("groot", m, { cost: 300, conversions: 10 }));
    rows.push(rij("duur-nul", m, { cost: 300, conversions: 0, conversions_value: 0, roas: 0 }));
    rows.push(rij("klein-nul", m, { cost: 2, conversions: 0, conversions_value: 0, roas: 0 }));
  }
  const out = aggregateAdGroups(rows, []);

  // Dit is de kern: zonder conversies bestaat er geen CPA. Stond hier de totale spend, dan was
  // de goedkoopste advertentiegroep van de campagne degene die het minst uitgaf zonder resultaat.
  check("geen CPA zonder conversies", vind(out, "klein-nul").avg_cpa_last_3m === null,
    String(vind(out, "klein-nul").avg_cpa_last_3m));
  check("ook niet bij veel spend", vind(out, "duur-nul").avg_cpa_last_3m === null,
    String(vind(out, "duur-nul").avg_cpa_last_3m));
  check("en dus ook geen vergelijking met de campagne",
    vind(out, "klein-nul").vs_campaign_avg_cpa_pct === null);
  check("de groep die wel converteert houdt zijn CPA", vind(out, "groot").avg_cpa_last_3m === 30,
    String(vind(out, "groot").avg_cpa_last_3m));

  // De campagnenorm telt alle kosten mee, ook die van de groepen zonder resultaat:
  // (900 + 900 + 6) / 30 conversies = 60,20.
  check("de campagne-CPA weegt de verspilling mee",
    Math.abs((vind(out, "groot").vs_campaign_avg_cpa_pct ?? 0) - -50.17) < 0.1,
    String(vind(out, "groot").vs_campaign_avg_cpa_pct));
}

// ── Verhoudingen worden gewogen, niet gemiddeld ───────────────────────────

console.log("\nHet campagnegemiddelde weegt op volume");
{
  const rows: R[] = [];
  for (let m = 1; m <= 6; m++) {
    rows.push(rij("volume", m, { cost: 1000, conversions: 50, conversions_value: 5000 }));
    rows.push(rij("mini", m, { cost: 3, conversions: 1, conversions_value: 30 }));
  }
  const out = aggregateAdGroups(rows, []);
  const vol = vind(out, "volume");

  // Gewogen: (3000 + 9) / (150 + 3) = 19,67. 'volume' zit met CPA 20 vlak boven de norm.
  // Ongewogen was het (20 + 3) / 2 = 11,50 en kwam 'volume' er 74% te duur uit.
  check("volume ligt vlak bij de norm", Math.abs((vol.vs_campaign_avg_cpa_pct ?? 0) - 1.7) < 0.1,
    `${vol.vs_campaign_avg_cpa_pct}% — bij een ongewogen gemiddelde was dit 73,9%`);
  check("de CPA van volume zelf klopt", vol.avg_cpa_last_3m === 20, String(vol.avg_cpa_last_3m));

  // ROAS gaat dezelfde kant op: gewogen (15000 + 90) / (3000 + 9) = 5,015.
  check("ROAS wordt op kosten gewogen", Math.abs((vol.vs_campaign_avg_roas_pct ?? 0) - -0.3) < 0.2,
    String(vol.vs_campaign_avg_roas_pct));
}

// ── Stilliggen is geen slecht presteren ───────────────────────────────────

console.log("\nEen advertentiegroep zonder recente data");
{
  const rows: R[] = [];
  for (let m = 1; m <= 6; m++) rows.push(rij("actief", m, { cost: 100, conversions: 5 }));
  for (let m = 1; m <= 3; m++) rows.push(rij("gestopt", m, { cost: 100, conversions: 5 }));
  const out = aggregateAdGroups(rows, []);
  const g = vind(out, "gestopt");

  check("krijgt het label geen_data", g.performance_label === "geen_data", g.performance_label);
  check("en is als niet-actief gemarkeerd", g.active_last_3m === false);
  // Eerder stond hier 0 conversies, CPA 0 en -100% trend: drie gemeten ogende getallen over een
  // periode waarin niets gedraaid heeft. CPA 0 is bovendien de best denkbare waarde.
  check("geen verzonnen nul-conversies", g.avg_conversions_last_3m === null, String(g.avg_conversions_last_3m));
  check("geen CPA van nul", g.avg_cpa_last_3m === null, String(g.avg_cpa_last_3m));
  check("geen trend van -100%", g.conversions_trend_pct === null, String(g.conversions_trend_pct));
  check("de actieve groep is wel gewoon actief", vind(out, "actief").active_last_3m === true);

  const cs = out.campaign_summaries[0];
  check("de campagne telt hem apart", cs.zonder_data === 1, String(cs.zonder_data));
  check("en noemt hem niet de slechtste", cs.worst_ad_group !== "gestopt", String(cs.worst_ad_group));
}

// ── Groei vanaf niets is niet te meten ────────────────────────────────────

console.log("\nZonder voorgeschiedenis");
{
  const rows: R[] = [];
  for (let m = 1; m <= 3; m++) rows.push(rij("nieuw", m, { cost: 100, conversions: 5 }));
  const a = aggregateAdGroups(rows, []).ad_group_details[0];
  // pctChange(x, 0) gaf 100. Dat leest als "verdubbeld" terwijl er geen vorige periode is.
  check("geen conversietrend", a.conversions_trend_pct === null, String(a.conversions_trend_pct));
  check("geen CPA-trend", a.cpa_trend_pct === null, String(a.cpa_trend_pct));
  check("geen ROAS-trend", a.roas_trend_pct === null, String(a.roas_trend_pct));
  check("de huidige stand staat er wel", a.avg_conversions_last_3m === 5, String(a.avg_conversions_last_3m));
}

// ── Maanden tellen, geen rijen ────────────────────────────────────────────

console.log("\nmonths_with_data");
{
  const rows: R[] = [];
  for (let m = 1; m <= 3; m++) { rows.push(rij("dubbel", m)); rows.push(rij("dubbel", m)); }
  const a = aggregateAdGroups(rows, []).ad_group_details[0];
  check("zes rijen over drie maanden tellen als drie", a.months_with_data === 3, String(a.months_with_data));
}

// ── Breekpunten hebben volume nodig ───────────────────────────────────────

console.log("\nBreekpuntdetectie");
{
  // 1 -> 2 is +100% en zou zonder volumedrempel elke maand een breekpunt zijn.
  const ruis = [1, 2, 1, 2, 1, 2].map((c, i) => rij("ruis", i + 1, { conversions: c }));
  const a = aggregateAdGroups(ruis, []).ad_group_details[0];
  check("ruis op kleine aantallen is geen breekpunt", a.has_breakpoint === false, String(a.breakpoint_month));
}
{
  // Een echte breuk: 20 -> 4 is -80% met ruim volume.
  const echt = [20, 20, 20, 4, 4, 4].map((c, i) => rij("breuk", i + 1, { conversions: c }));
  const a = aggregateAdGroups(echt, []).ad_group_details[0];
  check("een echte breuk wordt wel gezien", a.has_breakpoint === true);
  check("op de juiste maand", a.breakpoint_month === M(4), String(a.breakpoint_month));
}
{
  // Twee breuken: de grootste hoort gemeld te worden, niet toevallig de eerste.
  const twee = [10, 15, 15, 15, 15, 1].map((c, i) => rij("twee", i + 1, { conversions: c }));
  const a = aggregateAdGroups(twee, []).ad_group_details[0];
  check("de grootste breuk wint van de eerste", a.breakpoint_month === M(6),
    `${a.breakpoint_month} (+50% in maand 2 tegen -93% in maand 6)`);
}

// ── Randgevallen ──────────────────────────────────────────────────────────

console.log("\nRandgevallen");
{
  check("lege invoer geeft lege uitvoer",
    aggregateAdGroups([], []).ad_group_details.length === 0);
  const out = aggregateAdGroups([rij("a", 1)], ["bestaat-niet"]);
  check("een filter zonder treffers geeft lege uitvoer", out.ad_group_details.length === 0);
}
{
  // Eén advertentiegroep is niet tegelijk de beste en de slechtste van zijn campagne.
  const out = aggregateAdGroups([rij("solo", 1), rij("solo", 2), rij("solo", 3)], []);
  const cs = out.campaign_summaries[0];
  check("de beste staat er", cs.best_ad_group === "solo", String(cs.best_ad_group));
  check("maar er is geen slechtste", cs.worst_ad_group === null, String(cs.worst_ad_group));
}
{
  // Geen enkele conversie in de hele campagne: dan valt er niets te rangschikken, maar het mag
  // ook niet crashen of nullen verzinnen.
  const rows: R[] = [];
  for (let m = 1; m <= 3; m++) rows.push(rij("leeg", m, { conversions: 0, conversions_value: 0, roas: 0 }));
  const out = aggregateAdGroups(rows, []);
  const a = out.ad_group_details[0];
  check("de groep bestaat", out.ad_group_details.length === 1);
  check("zonder CPA", a.avg_cpa_last_3m === null);
  check("met een gemeten nul aan conversies", a.avg_conversions_last_3m === 0, String(a.avg_conversions_last_3m));
  check("en zonder vergelijking met de campagne", a.vs_campaign_avg_conversions_pct === null,
    String(a.vs_campaign_avg_conversions_pct));
}
{
  // Geen enkel getal in de uitvoer mag NaN of Infinity zijn — dat komt anders zo de prompt in.
  const rows: R[] = [];
  for (let m = 1; m <= 6; m++) {
    rows.push(rij("a", m, { cost: 0, conversions: 0, conversions_value: 0, roas: 0 }));
    rows.push(rij("b", m, { cost: 500, conversions: 3 }));
  }
  const out = aggregateAdGroups(rows, []);
  // JSON.stringify maakt van NaN en Infinity stilletjes `null`, dus daar is de tekst niet op te
  // controleren. Elk getalveld dus zelf langslopen.
  const kapot: string[] = [];
  for (const a of out.ad_group_details) {
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "number" && !Number.isFinite(v)) kapot.push(`${a.ad_group_name}.${k}=${v}`);
    }
  }
  check("geen NaN of Infinity in de uitvoer", kapot.length === 0, kapot.join(", "));
  check("de groep zonder kosten heeft geen ROAS", vind(out, "a").avg_roas_last_3m === null);
  check("de groep die wel draait heeft er wel een", vind(out, "b").avg_roas_last_3m !== null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
