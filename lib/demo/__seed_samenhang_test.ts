// De demo-seed (scripts/demo/seed-demo-client.ts): tellen de campagnes van Meta en LinkedIn per dag
// op tot hun account, en beginnen ze op dezelfde dag? Zonder database: de seed-tabellen worden in
// het geheugen opgebouwd, zoals --check dat doet. Importeren is veilig: de seed draait alleen als
// script (isMain), niet bij een import.
// Draaien: tsx lib/demo/__seed_samenhang_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Tot 14 november 2026 waren meta_campaign_daily en meta_account_daily (en hetzelfde bij LinkedIn)
// twee losse verzinsels. Oktober 2026 telde bij Meta € 17.015 in de campagnes tegen € 4.650 in het
// account, bij LinkedIn € 14.930 tegen € 9.300, en de campagnes begonnen op 13 juli terwijl het
// account op 8 juni begon. Het tabblad Campagnes telt per periode, en scripts/check-cijfers-gelijk.mjs
// legt de campagnetotalen naast de kanaaltotalen: op de demo stond die controle daardoor rood om een
// reden die niets met de code te maken had. Nu is het account de som van zijn campagnes; deze test
// houdt dat zo, ook als er een campagne of een scenario bij komt.

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Record<string, unknown>;

/** De verschillen tussen het account en de som van zijn campagnes, per dag en per kolom. Leeg = samenhangend. */
function verschillen(campagnes: Rij[], account: Rij[], kolommen: readonly string[]): string[] {
  const uit: string[] = [];
  const som = new Map<string, Map<string, number | null>>();
  for (const r of campagnes) {
    const dag = String(r.date);
    const s = som.get(dag) ?? new Map<string, number | null>();
    for (const k of kolommen) {
      const v = r[k];
      if (v == null) { if (!s.has(k)) s.set(k, null); continue; }
      s.set(k, (s.get(k) ?? 0) + Number(v));
    }
    som.set(dag, s);
  }
  const perDag = new Map<string, Rij>();
  for (const r of account) {
    const dag = String(r.date);
    if (perDag.has(dag)) uit.push(`${dag}: twee accountrijen`);
    perDag.set(dag, r);
  }
  for (const dag of [...new Set([...som.keys(), ...perDag.keys()])].sort()) {
    const s = som.get(dag), a = perDag.get(dag);
    if (!s) { uit.push(`${dag}: een accountrij zonder campagnes`); continue; }
    if (!a) { uit.push(`${dag}: campagnes zonder accountrij`); continue; }
    for (const k of kolommen) {
      const verwacht = s.get(k) ?? null, gelezen = a[k] == null ? null : Number(a[k]);
      const gelijk = verwacht == null || gelezen == null ? verwacht === gelezen : Math.abs(verwacht - gelezen) < 0.005;
      if (!gelijk) uit.push(`${dag} ${k}: campagnes ${verwacht}, account ${gelezen}`);
    }
  }
  return uit;
}

const eersteDag = (rijen: Rij[]) => rijen.map((r) => String(r.date)).sort()[0] ?? null;

async function main() {
  // Een vaste klok: de seed is klokrelatief, en de test moet elke dag hetzelfde zeggen. 14 november
  // 2026 is de dag waarop het verschil gevonden werd (oktober is dan de laatste volle maand).
  process.env.DEMO_VANDAAG = "2026-11-14";
  const { buildAllRows, META_SOM_KOLOMMEN, LINKEDIN_SOM_KOLOMMEN } = await import("../../scripts/demo/seed-demo-client");
  const t = buildAllRows() as Record<string, Rij[]>;

  for (const [kanaal, campagneTabel, accountTabel, kolommen] of [
    ["Meta", "meta_campaign_daily", "meta_account_daily", META_SOM_KOLOMMEN],
    ["LinkedIn", "linkedin_campaign_daily", "linkedin_account_daily", LINKEDIN_SOM_KOLOMMEN],
  ] as const) {
    const campagnes = t[campagneTabel], account = t[accountTabel];
    check(`${kanaal}: er zijn campagne- en accountrijen`, campagnes.length > 0 && account.length > 0, `${campagnes.length} / ${account.length}`);
    const v = verschillen(campagnes, account, kolommen);
    check(`${kanaal}: de campagnes tellen per dag en per kolom op tot het account`, v.length === 0, `${v.length} verschillen, o.a. ${v.slice(0, 3).join("; ")}`);
    check(`${kanaal}: campagnes en account beginnen op dezelfde dag`, eersteDag(campagnes) === eersteDag(account), `${eersteDag(campagnes)} tegen ${eersteDag(account)}`);
    // Een kolom die de accountrij draagt, moet er ook echt staan: een som die overal null is, zou de
    // controle hierboven leeg laten slagen.
    const gevuld: string[] = kolommen.filter((k) => account.some((r) => r[k] != null));
    const verplicht = kanaal === "Meta"
      ? ["impressions", "link_clicks", "spend", "conversions", "conversion_value", "landing_page_views", "add_to_cart", "initiate_checkout", "leads"]
      : ["impressions", "clicks", "spend", "one_click_leads", "one_click_lead_form_opens", "external_website_conversions", "conversion_value"];
    check(`${kanaal}: de accountrij draagt de kolommen die het Overzicht leest`, verplicht.every((k) => gevuld.includes(k)), `gevuld: ${gevuld.join(", ")}`);
  }

  // Het Overzicht begon op 8 juni (160 dagen) en blijft daar beginnen: de campagnes zijn
  // verlengd, het account is niet ingekort.
  check("het account begint nog 160 dagen terug (8 juni 2026)", eersteDag(t["meta_account_daily"]) === "2026-06-08" && eersteDag(t["linkedin_account_daily"]) === "2026-06-08",
    `${eersteDag(t["meta_account_daily"])} / ${eersteDag(t["linkedin_account_daily"])}`);

  // LinkedIn telt in hele getallen (bigint, migratie 008); een som van hele getallen is dat ook,
  // maar een gebroken getal in een campagne zou hier pas bij de insert opvallen.
  const nietHeel = [...t["linkedin_campaign_daily"], ...t["linkedin_account_daily"]]
    .filter((r) => ["one_click_leads", "one_click_lead_form_opens", "external_website_conversions", "impressions", "clicks"].some((k) => !Number.isInteger(Number(r[k]))));
  check("LinkedIn: leads, opens, conversies, vertoningen en klikken zijn hele getallen", nietHeel.length === 0, JSON.stringify(nietHeel[0] ?? null));

  // De stappen na de klik op Meta, op elke dag, in elke campagne en in het account: landingspagina
  // >= winkelwagen >= afrekenen >= conversies, en de landingspagina onder de linkklikken. Eerder
  // stonden er 6 conversies op 4 gestarte afrekeningen (zie de seed); dat mag ook in een campagne niet.
  const metaRijen = [...t["meta_campaign_daily"], ...t["meta_account_daily"]];
  const n = (v: unknown) => Number(v ?? 0);
  const onlogisch = metaRijen.filter((r) => !(n(r.landing_page_views) >= n(r.add_to_cart) && n(r.add_to_cart) >= n(r.initiate_checkout)
    && n(r.initiate_checkout) >= n(r.conversions) && n(r.landing_page_views) <= n(r.link_clicks)));
  check("seed Meta: samenhangend (landingspagina >= winkelwagen >= afrekenen >= conversies, op elke rij)", onlogisch.length === 0,
    onlogisch.slice(0, 2).map((r) => `${r.entity_id} ${r.date}`).join("; "));
  // De drop-off van landingspagina naar winkelwagen in de laatste 28 dagen (40% -> 24%) is de
  // ontworpen bevinding voor de funnel-analyse; hij moet de afleiding overleven.
  const aandeel = (rijen: Rij[]) => rijen.reduce((s, r) => s + n(r.add_to_cart), 0) / rijen.reduce((s, r) => s + n(r.landing_page_views), 0);
  const acc = t["meta_account_daily"];
  const recent = acc.filter((r) => String(r.date) > "2026-10-17"), eerder = acc.filter((r) => String(r.date) <= "2026-10-17");
  check("seed Meta: winkelwagen 40% van de landingspagina, de laatste 28 dagen 24%",
    Math.abs(aandeel(eerder) - 0.4) < 0.001 && Math.abs(aandeel(recent) - 0.24) < 0.001, `${aandeel(eerder)} / ${aandeel(recent)}`);

  // Zelftest: de vergelijking hierboven ziet een verschil echt. Zonder deze toets kon een
  // vergelijking die nooit iets vindt (verkeerde kolomnaam, verkeerde sleutel) gewoon groen staan.
  const kopie = t["meta_campaign_daily"].map((r) => ({ ...r }));
  kopie[0].spend = n(kopie[0].spend) + 1;
  check("zelftest: een euro extra in een campagne wordt gezien", verschillen(kopie, t["meta_account_daily"], META_SOM_KOLOMMEN).some((v) => /spend/.test(v)));
  check("zelftest: een ontbrekende accountdag wordt gezien", verschillen(t["linkedin_campaign_daily"], t["linkedin_account_daily"].slice(1), LINKEDIN_SOM_KOLOMMEN).some((v) => /zonder accountrij/.test(v)));
  check("zelftest: een gevulde kolom tegen een lege wordt gezien",
    verschillen([{ date: "d", leads: 1 }], [{ date: "d", leads: null }], ["leads"]).length === 1
    && verschillen([{ date: "d", leads: null }], [{ date: "d", leads: null }], ["leads"]).length === 0);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
