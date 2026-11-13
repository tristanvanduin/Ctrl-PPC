// De conversietrechter na de klik (lib/overzicht/conversiestappen.ts, de blokken in
// components/dashboard/overzicht-na-de-klik.tsx, de instelling in conversie-trechter-settings.tsx,
// de Google-checkoutquery in lib/api/google-ads.ts en de demo in lib/demo/checkout-demo.ts).
// Draaien: tsx --tsconfig ./tsconfig.json lib/overzicht/__conversiestappen_test.ts
//
// Wat deze test vasthoudt:
// - HERKENNING OP NAAM per sjabloon, met een bron bij de eerste stap die hem herkent ("Aankoop"
//   ook); het sjabloon volgt het bedrijfsmodel; een eigen keuze gaat voor.
// - POSITIES OP BETEKENIS: de echte purchase blijft purchase, een formulierstap schrijft geen
//   positie, en een positie die geen stap dekt houdt de oude kaart (de maandanalyse leest hem).
// - TELLEN PER DAG: alleen de dagen van de periode, een stap zonder data valt eruit met de reden,
//   nul is geen ontbrekend getal, en de vergelijking geeft absoluut en relatief.
// - EERLIJK VERGELIJKEN: geen verandering als een periode voor de eerste rij begint, of als een
//   telling per maand overlappende of halve maanden vergelijkt.
// - DELING DOOR NUL: geen klikken of toen nul is "niet te berekenen", geen 0% of oneindig.
// - TERUGVAL ZONDER DAGTABEL: ontbrekend, leeg of te laat begonnen: Google telt per maand en zegt
//   welke maanden; zonder rijen in die maanden geen noot die iets geteld noemt.
// - NIET OPTELLEN: per stap staan de kanalen naast elkaar, zonder totaal, met de reden erbij, en
//   een kanaal dat per maand telt staat zo gelabeld, in beeld en in de tabel.
// - DE SYNC: lijsten per positie, de naam zoals opgeslagen in de query, per dag of per maand.
// - DE DEMO: Meta en Google samenhangend (landingspagina >= winkelwagen >= afrekenen >= aankoop).
// - DE SCHAKELAAR: met de schakelaar uit verandert er niets.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  beschikbareBronnen, bronnenMetKeuze, checkoutMapUit, geldendeTrechter, herkenStappen, ketenNaDeKlik, KLIKKEN,
  leesInstelling, naDeKlikPerStap, NIET_OPTELLEN, positiesUitStappen, telKanaalStappen,
  type GeldendeTrechter, type StapBron, type StapRijen,
} from "./conversiestappen";
import { checkoutActiesPerPositie, checkoutRijenUit } from "../api/google-ads";
import { demoRows } from "../demo/demo-rows";
import { checkoutPerDagUitCampagnes } from "../demo/checkout-demo";
import { addDays } from "../reporting-date";
import { KanaalNaDeKlik, NaDeKlikPerKanaal } from "../../components/dashboard/overzicht-na-de-klik";
import { KanaalTrechter } from "../../components/dashboard/overzicht-trechter";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const root = join(__dirname, "..", "..");
const lees = (p: string) => readFileSync(join(root, p), "utf8");

// ── Herkenning op naam ───────────────────────────────────────────────────────────────────────────

const metaRij = { date: "2026-10-01", add_to_cart: 3, initiate_checkout: 2, conversions: 1, leads: 1 };
const liRij = { date: "2026-10-01", one_click_lead_form_opens: 9, one_click_leads: 4, external_website_conversions: 0 };
const bronnen = beschikbareBronnen({
  conversionActions: [{ name: "Add to cart" }, { name: "Begin checkout" }, { name: "Purchase webshop" }, { name: "Bedankt offerte" }, { name: "Add to cart" }, { id: 5 }],
  rijen: { meta: [metaRij], linkedin: [liRij], microsoft: [] },
});
{
  check("alleen bronnen die voorkomen: geen LinkedIn-websiteconversies (overal nul)",
    !bronnen.some((b) => b.sleutel === "external_website_conversions"));
  check("geen Microsoft zonder rijen", !bronnen.some((b) => b.kanaal === "microsoft"));
  check("een dubbele Google-actie één keer", bronnen.filter((b) => b.sleutel === "Add to cart").length === 1);

  const web = herkenStappen("webshop", bronnen);
  check("webshop: vier stappen", web.map((s) => s.naam).join("|") === "Product bekeken|Winkelwagen|Afrekenen|Aankoop");
  check("webshop: Meta add_to_cart bij winkelwagen", web[1].bronnen.meta?.join() === "add_to_cart");
  check("webshop: Meta initiate_checkout bij afrekenen", web[2].bronnen.meta?.join() === "initiate_checkout");
  check("webshop: Meta-conversies (Purchase) bij aankoop", web[3].bronnen.meta?.join() === "conversions");
  check("webshop: Google-acties op naam", web[1].bronnen.google?.join() === "Add to cart" && web[2].bronnen.google?.join() === "Begin checkout"
    && web[3].bronnen.google?.join() === "Purchase webshop");
  check("webshop: product bekeken heeft geen bron", Object.keys(web[0].bronnen).length === 0);
  check("webshop: Meta-leads horen nergens bij", !web.some((s) => s.bronnen.meta?.includes("leads")));

  const form = herkenStappen("formulier", bronnen);
  check("formulier: twee stappen", form.map((s) => s.naam).join("|") === "Formulier geopend|Formulier verzonden");
  check("formulier: LinkedIn geopend alleen bij stap 1 (eerste die hem herkent)",
    form[0].bronnen.linkedin?.join() === "one_click_lead_form_opens" && !form[1].bronnen.linkedin?.includes("one_click_lead_form_opens"));
  check("formulier: LinkedIn-leads bij verzonden", form[1].bronnen.linkedin?.join() === "one_click_leads");
  check("formulier: Meta-leads bij verzonden", form[1].bronnen.meta?.join() === "leads");
  check("formulier: 'Bedankpagina' bij verzonden", form[1].bronnen.google?.join() === "Bedankt offerte");

  const ticket = herkenStappen("webshop", [{ kanaal: "google", sleutel: "Ticket gekocht", label: "Ticket gekocht" }]);
  check("ticket telt als aankoop", ticket[3].bronnen.google?.join() === "Ticket gekocht");
  const namen = ["Aankoop", "aankoop webshop", "Aankopen", "Product purchase", "Aankoop product", "view_item", "Product bekeken"];
  const herkend = herkenStappen("webshop", namen.map((n): StapBron => ({ kanaal: "google", sleutel: n, label: n })));
  check("'Aankoop', 'aankoop webshop' en 'Aankopen' zijn een aankoop",
    ["Aankoop", "aankoop webshop", "Aankopen"].every((n) => herkend[3].bronnen.google?.includes(n)), herkend[3].bronnen.google?.join());
  check("'Product purchase' en 'Aankoop product' zijn een aankoop, geen product bekeken",
    !!herkend[3].bronnen.google?.includes("Product purchase") && !!herkend[3].bronnen.google?.includes("Aankoop product")
    && herkend[0].bronnen.google?.join() === "view_item,Product bekeken", herkend[0].bronnen.google?.join());
}

// ── Welke trechter geldt, en de posities op betekenis ────────────────────────────────────────────
{
  const b2b = geldendeTrechter({ bedrijfsmodel: "b2b", bronnen });
  check("b2b zonder keuze: formulier, herkend", b2b.sjabloon === "formulier" && !b2b.eigen);
  check("formulier zonder keuze: geen Google-positie (de sync vraagt de webshopnamen)", b2b.googlePosities.every((p) => p === null));
  const onbekend = geldendeTrechter({ bedrijfsmodel: null, bronnen });
  check("onbekend bedrijfsmodel: webshop", onbekend.sjabloon === "webshop");
  check("webshop zonder keuze: posities op winkelwagen, afrekenen, aankoop",
    onbekend.googlePosities.join() === ",add_to_cart,begin_checkout,purchase");

  // Een webshop met view_item, add_to_cart, begin_checkout en purchase, opgeslagen zonder
  // wijziging. Toen de posities op volgorde gingen, viel de echte purchase weg.
  const shop = beschikbareBronnen({ conversionActions: ["view_item", "add_to_cart", "begin_checkout", "purchase"].map((name) => ({ name })) });
  const web = geldendeTrechter({ bedrijfsmodel: "b2c", bronnen: shop });
  const kaart = checkoutMapUit({ sjabloon: web.sjabloon, stappen: web.stappen });
  check("webshop met view_item opslaan: purchase blijft purchase", JSON.stringify(kaart.purchase) === '["purchase"]', JSON.stringify(kaart));
  check("webshop met view_item opslaan: winkelwagen en afrekenen op hun eigen positie",
    JSON.stringify(kaart.add_to_cart) === '["add_to_cart"]' && JSON.stringify(kaart.begin_checkout) === '["begin_checkout"]');
  check("view_item komt in geen enkele positie", !JSON.stringify([kaart.add_to_cart, kaart.begin_checkout, kaart.purchase]).includes("view_item"));
  check("na het opslaan telt het Overzicht dezelfde posities",
    geldendeTrechter({ checkoutActionMap: kaart, bronnen: shop }).googlePosities.join() === ",add_to_cart,begin_checkout,purchase");

  // Een formulier: generate_lead mag de maandtabel niet in als winkelwagen.
  const formBronnen = beschikbareBronnen({ conversionActions: [{ name: "lead_form_open" }, { name: "generate_lead" }] });
  const form = geldendeTrechter({ bedrijfsmodel: "b2b", bronnen: formBronnen });
  check("formulier: generate_lead bij verzonden", form.stappen[1].bronnen.google?.join() === "generate_lead");
  const formKaart = checkoutMapUit({ sjabloon: "formulier", stappen: form.stappen });
  check("formulier opslaan: geen positie, generate_lead niet in add_to_cart_count",
    !("add_to_cart" in formKaart) && !("begin_checkout" in formKaart) && !("purchase" in formKaart), JSON.stringify(formKaart));
  const oud = { add_to_cart: "Mand", purchase: "Bestelling afgerond" };
  const formOverOud = checkoutMapUit({ sjabloon: "formulier", stappen: form.stappen }, oud);
  check("een positie die geen stap dekt, houdt de oude kaart",
    JSON.stringify(formOverOud.add_to_cart) === '["Mand"]' && JSON.stringify(formOverOud.purchase) === '["Bestelling afgerond"]');

  // Een oude kaart zonder `trechter`: de acties staan als keuze bij de stap met die betekenis.
  const metOud = geldendeTrechter({ checkoutActionMap: oud, bedrijfsmodel: "b2c", bronnen: shop });
  check("oude kaart: 'Bestelling afgerond' bij Aankoop, 'Mand' bij Winkelwagen",
    metOud.stappen[3].bronnen.google?.join() === "Bestelling afgerond" && metOud.stappen[1].bronnen.google?.join() === "Mand" && !metOud.eigen);
  const keuze = bronnenMetKeuze(shop, metOud.stappen);
  check("oude kaart: de acties staan ook in de lijst om uit te kiezen (anders verdwenen ze bij opslaan)",
    keuze.some((b) => b.sleutel === "Bestelling afgerond") && keuze.length === shop.length + 2);
  check("oude kaart opnieuw opslaan: purchase blijft wat het was",
    JSON.stringify(checkoutMapUit({ sjabloon: "webshop", stappen: metOud.stappen }, oud).purchase) === '["Bestelling afgerond"]');

  const opgeslagen = checkoutMapUit({ sjabloon: "eigen", stappen: [
    { naam: "Offerte bekeken", bronnen: { google: ["Offerte bekeken"] } },
    { naam: "Lead", bronnen: { meta: ["leads"], google: ["Lead A", "Lead B"] } },
  ] });
  check("eigen stappen zonder winkelwagen, afrekenen of aankoop: geen positie", !("add_to_cart" in opgeslagen)
    && !("begin_checkout" in opgeslagen) && !("purchase" in opgeslagen));
  const eigen = geldendeTrechter({ checkoutActionMap: opgeslagen, bedrijfsmodel: "b2c", bronnen });
  check("eigen keuze gaat voor het bedrijfsmodel", eigen.eigen && eigen.sjabloon === "eigen" && eigen.stappen.length === 2);
  check("eigen keuze: Meta alleen wat gekozen is", eigen.stappen[1].bronnen.meta?.join() === "leads" && !eigen.stappen[0].bronnen.meta);
  check("eigen keuze: geen Google-positie zonder die betekenis", eigen.googlePosities.every((p) => p === null));
  check("eigen stap met een eigen naam: de betekenis volgt uit zijn Google-acties",
    positiesUitStappen([{ naam: "Stap 3", bronnen: { google: ["Ticket verkocht"] } }]).join() === "purchase");
  check("twee stappen met dezelfde betekenis: alleen de eerste telt",
    positiesUitStappen([{ naam: "Aankoop", bronnen: { google: ["A"] } }, { naam: "Aankoop 2", bronnen: { google: ["B"] } }]).join() === "purchase,");
  check("eigen keuze zonder Google-actie: geen positie",
    positiesUitStappen([{ naam: "Aankoop", bronnen: { meta: ["conversions"] } }]).join() === "");
  check("rommel in de kaart is geen keuze", leesInstelling({ trechter: { sjabloon: "x", stappen: [] } }) === null
    && leesInstelling("tekst") === null && leesInstelling({ add_to_cart: "add_to_cart" }) === null);
  check("een stap zonder naam valt weg", leesInstelling({ trechter: { sjabloon: "eigen", stappen: [{ naam: " " }, { naam: "A", bronnen: { meta: ["x", 3] } }] } })
    ?.stappen.map((s) => `${s.naam}:${s.bronnen.meta}`).join() === "A:x");
}

// ── Tellen per dag ───────────────────────────────────────────────────────────────────────────────

const trechter: GeldendeTrechter = geldendeTrechter({ bronnen: [
  { kanaal: "meta", sleutel: "add_to_cart", label: "Winkelwagen (AddToCart)" },
  { kanaal: "meta", sleutel: "initiate_checkout", label: "Afrekenen gestart (InitiateCheckout)" },
  { kanaal: "meta", sleutel: "conversions", label: "Aankopen (Purchase)" },
] as StapBron[] });
const meta = [
  { date: "2026-10-31", link_clicks: 1000, landing_page_views: 900, add_to_cart: 100, initiate_checkout: 50, conversions: 20 },
  { date: "2026-11-01", link_clicks: 100, landing_page_views: 80, add_to_cart: 10, initiate_checkout: 5, conversions: 2 },
  { date: "2026-11-02", link_clicks: 100, landing_page_views: 80, add_to_cart: 10, initiate_checkout: 5, conversions: 3 },
  { date: "2025-11-01", link_clicks: 50, landing_page_views: 40, add_to_cart: 8, initiate_checkout: 0, conversions: 2 },
  { date: "2025-11-02", link_clicks: 50, landing_page_views: 40, add_to_cart: 8, initiate_checkout: 0, conversions: 0 },
];
const rijen: StapRijen = { meta };
const nov = { start: "2026-11-01", eind: "2026-11-02" };
const vorig = { start: "2025-11-01", eind: "2025-11-02" };
{
  const nu = telKanaalStappen("meta", nov, trechter, rijen);
  check("dagperiode: alleen de dagen van de periode", nu.klikken === 200 && nu.stappen.find((s) => s.naam === "Winkelwagen")?.waarde === 20);
  check("Meta: landingspagina is de eerste stap na de klik", nu.stappen[0].naam === "Landingspagina bekeken" && nu.stappen[0].waarde === 160);
  const k = ketenNaDeKlik(nu, telKanaalStappen("meta", vorig, trechter, rijen));
  check("keten: klikken > landingspagina > winkelwagen > afrekenen > aankoop",
    k.rijen.map((r) => r.naam).join("|") === `${KLIKKEN}|Landingspagina bekeken|Winkelwagen|Afrekenen|Aankoop`);
  check("stap zonder data valt eruit, met de reden", !k.rijen.some((r) => r.naam === "Product bekeken")
    && k.weg.some((w) => w.startsWith("Product bekeken:") && w.includes("geen bron")));
  const ww = k.rijen.find((r) => r.naam === "Winkelwagen")!;
  check("percentage naar de volgende stap", ww.naarVolgende === 0.5);
  check("uitval", ww.uitval === 10);
  check("verandering absoluut en relatief", ww.verandering?.absoluut === 4 && ww.verandering?.pct === 25);
  const af = k.rijen.find((r) => r.naam === "Afrekenen")!;
  check("toen nul: absoluut wel, geen percentage", af.verandering?.absoluut === 10 && af.verandering?.pct === null);
  const laatste = k.rijen[k.rijen.length - 1];
  check("de laatste stap heeft geen volgende", laatste.naarVolgende === null && laatste.uitval === null);
  check("zonder vergelijking geen verandering", ketenNaDeKlik(nu, null).rijen.every((r) => r.verandering === null));
}
{
  // Deling door nul: geen klikken.
  const nul = telKanaalStappen("meta", nov, trechter, { meta: [{ date: "2026-11-01", link_clicks: 0, landing_page_views: 0, add_to_cart: 0, initiate_checkout: 0, conversions: 0 }] });
  const k = ketenNaDeKlik(nul, null);
  check("nul klikken: aandeel niet te berekenen (null), geen 0% of oneindig", k.rijen[0].naam === KLIKKEN && k.rijen[0].naarVolgende === null);
  check("een gemeten nul is data, geen ontbrekende stap", !k.leeg && k.rijen.length === 5);
  // Meer bij een latere stap dan bij de vorige: uitgelegd, geen negatieve uitval.
  const raar = ketenNaDeKlik(telKanaalStappen("meta", nov, trechter, { meta: [{ date: "2026-11-01", link_clicks: 10, landing_page_views: 8, add_to_cart: 1, initiate_checkout: 1, conversions: 4 }] }), null);
  check("meer aankopen dan afrekeningen: geen negatieve uitval, wel een regel",
    raar.rijen.find((r) => r.naam === "Afrekenen")?.uitval === null && raar.opmerkingen.some((o) => o.includes("rekent die stap ook toe")));
  // Geen rijen in de periode: de keten is leeg, met redenen.
  const leeg = ketenNaDeKlik(telKanaalStappen("meta", { start: "2020-01-01", eind: "2020-01-31" }, trechter, rijen), null);
  check("geen data in de periode: leeg", leeg.leeg && leeg.weg.length === 5);
  // Microsoft zonder stap: leeg, en de reden noemt de bron.
  const ms = ketenNaDeKlik(telKanaalStappen("microsoft", nov, trechter, { microsoft: [{ date: "2026-11-01", clicks: 5, conversions: 1 }] }), null);
  check("Microsoft zonder gekozen stap: leeg met reden", ms.leeg && ms.weg.every((w) => w.includes("Microsoft")));
}

// ── Eerlijk vergelijken ──────────────────────────────────────────────────────────────────────────
{
  // Meta-dagrijen die 160 dagen terug beginnen (zoals de seed), met elke dag hetzelfde tempo. Een
  // vergelijking die deels voor de eerste rij valt, gaf +30% op elke stap.
  const eind = "2026-11-12";
  const vlak = Array.from({ length: 160 }, (_, d) => ({
    date: addDays(eind, -d), link_clicks: 45, landing_page_views: 30, add_to_cart: 12, initiate_checkout: 10, conversions: 6,
  }));
  const eerste = addDays(eind, -159);
  const nu = { start: addDays(eind, -89), eind };
  const toenDeels = { start: addDays(eind, -179), eind: addDays(eind, -90) };
  const k = ketenNaDeKlik(telKanaalStappen("meta", nu, trechter, { meta: vlak }), telKanaalStappen("meta", toenDeels, trechter, { meta: vlak }));
  check("vergelijking die voor de eerste rij begint: geen verandering", k.rijen.every((r) => r.verandering === null),
    k.rijen.map((r) => r.verandering?.pct).join());
  check("... met de reden en de eerste dag", !!k.geenVergelijking?.includes("pas vanaf") && k.opmerkingen.includes(k.geenVergelijking!));
  const toenHeel = { start: addDays(eind, -159), eind: addDays(eind, -90) };
  const nuGelijk = { start: addDays(eind, -69), eind };
  const goed = ketenNaDeKlik(telKanaalStappen("meta", nuGelijk, trechter, { meta: vlak }), telKanaalStappen("meta", toenHeel, trechter, { meta: vlak }));
  check("beide periodes na de eerste rij: wel een verandering (gelijk tempo, 0%)",
    goed.geenVergelijking === null && goed.rijen.every((r) => r.verandering?.pct === 0), goed.rijen.map((r) => r.verandering?.pct).join());
  check("de eerste rij komt uit alle rijen, niet uit de periode", telKanaalStappen("meta", nu, trechter, { meta: vlak }).bronStart === eerste);
  const deelsNu = telKanaalStappen("meta", { start: addDays(eerste, -5), eind: addDays(eerste, 5) }, trechter, { meta: vlak });
  check("een periode die voor de eerste rij begint, zegt vanaf wanneer hij telt", !!deelsNu.noot?.includes("pas vanaf"));

  // Google zonder dagtabel: nu 5-11 nov telt november; toen 29 okt-4 nov telt oktober en november.
  const g = geldendeTrechter({ bronnen: [] });
  const maand = [
    { date: "2026-09-01", add_to_cart_count: 90, begin_checkout_count: 50, purchase_count: 30 },
    { date: "2026-10-01", add_to_cart_count: 100, begin_checkout_count: 60, purchase_count: 30 },
    { date: "2026-11-01", add_to_cart_count: 40, begin_checkout_count: 20, purchase_count: 10 },
  ];
  const r: StapRijen = { google: { dag: null, maand } };
  const a = ketenNaDeKlik(
    telKanaalStappen("google", { start: "2026-11-05", eind: "2026-11-11" }, g, r),
    telKanaalStappen("google", { start: "2026-10-29", eind: "2026-11-04" }, g, r),
  );
  check("per maand, periodes die dezelfde maand raken: geen verandering (was -71%)", a.rijen.every((x) => x.verandering === null)
    && !!a.geenVergelijking?.includes("per maand"), a.rijen.map((x) => x.verandering?.pct).join());
  const binnenMaand = ketenNaDeKlik(
    telKanaalStappen("google", { start: "2026-11-08", eind: "2026-11-14" }, g, r),
    telKanaalStappen("google", { start: "2026-11-01", eind: "2026-11-07" }, g, r),
  );
  check("per maand, vorige 7 dagen binnen dezelfde maand: geen verandering", binnenMaand.rijen.every((x) => x.verandering === null));
  const halfApart = ketenNaDeKlik(
    telKanaalStappen("google", { start: "2026-11-02", eind: "2026-11-08" }, g, r),
    telKanaalStappen("google", { start: "2026-10-02", eind: "2026-10-08" }, g, r),
  );
  check("per maand, halve maanden zonder overlap: geen verandering", halfApart.rijen.every((x) => x.verandering === null)
    && !!halfApart.geenVergelijking?.includes("geen hele maanden"));
  const heel = ketenNaDeKlik(
    telKanaalStappen("google", { start: "2026-10-01", eind: "2026-10-31" }, g, r),
    telKanaalStappen("google", { start: "2026-09-01", eind: "2026-09-30" }, g, r),
  );
  check("per maand, hele maanden zonder overlap: wel een verandering",
    heel.geenVergelijking === null && heel.rijen.find((x) => x.naam === "Winkelwagen")?.verandering?.absoluut === 10);
  // De ene periode per dag, de andere per maand: geen verandering.
  const gemengd: StapRijen = { google: { dag: [{ date: "2026-11-03", add_to_cart_count: 5, begin_checkout_count: 2, purchase_count: 1 }], maand } };
  const mix = ketenNaDeKlik(
    telKanaalStappen("google", { start: "2026-11-03", eind: "2026-11-09" }, g, gemengd),
    telKanaalStappen("google", { start: "2026-10-01", eind: "2026-10-31" }, g, gemengd),
  );
  check("per dag tegen per maand: geen verandering", mix.fijnheid === "dag" && mix.rijen.every((x) => x.verandering === null)
    && !!mix.geenVergelijking?.includes("per dag en de andere per maand"));
}

// ── Google: per dag, en de terugval zonder dagtabel ──────────────────────────────────────────────
{
  const g = geldendeTrechter({ bronnen: [] });
  const dag = [
    { date: "2026-11-01", add_to_cart_count: 10, begin_checkout_count: 6, purchase_count: 3 },
    { date: "2026-11-01", add_to_cart_count: 2, begin_checkout_count: 1, purchase_count: 1 },
    { date: "2026-11-05", add_to_cart_count: 50, begin_checkout_count: 30, purchase_count: 20 },
  ];
  const perDag = telKanaalStappen("google", nov, g, { google: { dag, maand: null } });
  check("Google per dag: rijen van campagnes opgeteld, alleen de dagen van de periode",
    perDag.fijnheid === "dag" && perDag.stappen[1].waarde === 12 && perDag.stappen[3].waarde === 4 && perDag.noot === null);
  check("Google zonder klikken per dag: keten begint bij de eerste stap, met de reden",
    ketenNaDeKlik(perDag, null).rijen[0].naam === "Winkelwagen" && ketenNaDeKlik(perDag, null).opmerkingen.some((o) => o.includes("klikken")));
  const maand = [
    { date: "2026-11-01", add_to_cart_count: 100, begin_checkout_count: 60, purchase_count: 30 },
    { date: "2026-10-01", add_to_cart_count: 999, begin_checkout_count: 999, purchase_count: 999 },
  ];
  const terug = telKanaalStappen("google", nov, g, { google: { dag: null, maand } });
  check("zonder dagtabel: per maand, en dat staat erbij", terug.fijnheid === "maand" && terug.stappen[1].waarde === 100
    && !!terug.noot?.includes("per maand") && !!terug.noot?.includes("november 2026"));
  const heleMaand = telKanaalStappen("google", { start: "2026-11-01", eind: "2026-11-30" }, g, { google: { dag: null, maand } }, 500);
  check("zonder dagtabel over een hele maand: klikken erbij, geen 'gevraagd'",
    heleMaand.klikken === 500 && !heleMaand.noot?.includes("gevraagd") && ketenNaDeKlik(heleMaand, null).rijen[0].naam === KLIKKEN);
  const niets = telKanaalStappen("google", nov, g, { google: null });
  check("zonder Google-rijen: leeg, niet gecrasht", ketenNaDeKlik(niets, null).leeg);

  // De dagtabel bestaat maar is leeg (migratie 111 gedraaid, nog geen sync): de maanden tellen.
  const legeDag = telKanaalStappen("google", nov, g, { google: { dag: [], maand } });
  check("lege dagtabel: per maand, met het label", legeDag.fijnheid === "maand" && legeDag.stappen[1].waarde === 100 && !!legeDag.noot?.includes("per maand"));
  // Deels gevuld: dagrijen vanaf 3 november. Een periode die eerder begint, telt de maand.
  const deels = [{ date: "2026-11-03", add_to_cart_count: 7, begin_checkout_count: 3, purchase_count: 1 }];
  const ervoor = telKanaalStappen("google", { start: "2026-11-01", eind: "2026-11-07" }, g, { google: { dag: deels, maand } });
  check("dagtabel vanaf 3 nov, periode vanaf 1 nov: per maand, niet stil te laag", ervoor.fijnheid === "maand" && ervoor.stappen[1].waarde === 100);
  const erna = telKanaalStappen("google", { start: "2026-11-03", eind: "2026-11-07" }, g, { google: { dag: deels, maand } });
  check("dagtabel vanaf 3 nov, periode vanaf 3 nov: per dag", erna.fijnheid === "dag" && erna.stappen[1].waarde === 7 && erna.noot === null);
  // Wel maandrijen, maar niet in de maanden van de periode: geen noot die iets geteld noemt.
  const andereMaand = telKanaalStappen("google", { start: "2026-08-03", eind: "2026-08-09" }, g, { google: { dag: null, maand } });
  const ak = ketenNaDeKlik(andereMaand, null);
  check("maandrijen buiten de periode: geen 'geteld is', wel een reden", ak.leeg && andereMaand.noot === null
    && ak.weg.some((w) => w.includes("augustus 2026") && w.includes("geen checkoutcijfers")), ak.weg.join(" | "));
  // Een formulierstap: Google telt hem niet, en de reden zegt waarom.
  const formG = ketenNaDeKlik(telKanaalStappen("google", nov, geldendeTrechter({ bedrijfsmodel: "b2b", bronnen: [] }), { google: { dag, maand: null } }), null);
  check("formulier bij Google: leeg met de reden", formG.leeg && formG.weg.every((w) => w.includes("winkelwagen, afrekenen en aankoop")));
}

// ── Alle kanalen: niet optellen ──────────────────────────────────────────────────────────────────
{
  const g = geldendeTrechter({ bronnen: [
    { kanaal: "meta", sleutel: "conversions", label: "Aankopen (Purchase)" },
  ] });
  const metaK = ketenNaDeKlik(telKanaalStappen("meta", nov, g, rijen), null);
  const googleK = ketenNaDeKlik(telKanaalStappen("google", nov, g, { google: { dag: [{ date: "2026-11-01", purchase_count: 7 }], maand: null } }), null);
  const liK = ketenNaDeKlik(telKanaalStappen("linkedin", nov, g, { linkedin: [{ date: "2026-11-01", clicks: 3 }] }), null);
  const uit = naDeKlikPerStap([googleK, metaK, liK]);
  const aankoop = uit.stappen.find((s) => s.naam === "Aankoop")!;
  check("per stap de kanalen naast elkaar", aankoop.perKanaal.map((k) => `${k.kanaal}:${k.waarde}`).join() === "google:7,meta:5");
  check("geen totaal over de kanalen", !("totaal" in aankoop) && !uit.stappen.some((s) => s.perKanaal.some((k) => k.waarde === 12)));
  check("alleen kanalen met stapdata", uit.kanalen.join() === "google,meta");
  check("de klikken staan niet in Na de klik per kanaal", !uit.stappen.some((s) => s.naam === KLIKKEN));
  check("allebei per dag: geen noten", uit.noten.length === 0 && aankoop.perKanaal.every((k) => k.fijnheid === "dag"));

  const html = renderToStaticMarkup(createElement(NaDeKlikPerKanaal, { uitkomst: uit, venster: { over: "1 t/m 2 nov 2026", tegen: null } }));
  check("de reden om niet op te tellen staat in beeld", html.includes(NIET_OPTELLEN.slice(0, 40)));
  check("tekstalternatief: tabel in een sr-only blok, niet zelf sr-only", /<div class="sr-only"><table>/.test(html) && !/<table class="sr-only"/.test(html));
  const leeg = renderToStaticMarkup(createElement(NaDeKlikPerKanaal, { uitkomst: { stappen: [], kanalen: [], noten: [] }, venster: { over: "x", tegen: null }, onNaarInstellingen: () => {} }));
  check("geen enkel kanaal: een regel met een link naar de instellingen", leeg.includes("Stel de conversietrechter in") && /min-h-11/.test(leeg));

  // Google per maand naast Meta per dag: gelabeld, in beeld en in de tabel, met de noot erbij.
  const gMaand = ketenNaDeKlik(telKanaalStappen("google", nov, g, { google: { dag: null, maand: [{ date: "2026-11-01", purchase_count: 30 }] } }), null);
  const gemengd = naDeKlikPerStap([gMaand, metaK]);
  const gAankoop = gemengd.stappen.find((s) => s.naam === "Aankoop")!.perKanaal.find((k) => k.kanaal === "google")!;
  check("Google per maand: de fijnheid gaat mee per kanaal", gAankoop.fijnheid === "maand");
  check("Google per maand: de noot gaat mee", gemengd.noten.some((n) => n.kanaal === "google" && n.tekst.includes("per maand")));
  const gemengdHtml = renderToStaticMarkup(createElement(NaDeKlikPerKanaal, { uitkomst: gemengd, venster: { over: "1 t/m 2 nov 2026", tegen: null } }));
  check("Google per maand: gelabeld in de tabel voor een schermlezer", /<td>Google Ads \(per maand geteld\)<\/td>/.test(gemengdHtml)
    || /<td>Google[^<]*\(per maand geteld\)<\/td>/.test(gemengdHtml));
  check("Google per maand: de noot staat onder het blok", gemengdHtml.includes("data-nadeklik-noten") && gemengdHtml.includes("geteld is november 2026"));

  const kanaal = renderToStaticMarkup(createElement(KanaalNaDeKlik, { keten: metaK, venster: { over: "1 t/m 2 nov 2026", tegen: null } }));
  check("per kanaal: aandeel naar de volgende stap en uitval in beeld", kanaal.includes("naar de volgende stap") && kanaal.includes("uitval"));
  check("per kanaal: tekstalternatief in een sr-only blok", /<div class="sr-only"><table>/.test(kanaal));
}

// ── De sync ──────────────────────────────────────────────────────────────────────────────────────
{
  const perActie = checkoutActiesPerPositie({ add_to_cart: ["In Winkelwagen", "Mand"], purchase: "Aankoop" });
  check("sync: lijsten en losse namen, de naam zoals opgeslagen",
    perActie.get("In Winkelwagen") === "add_to_cart" && perActie.get("Mand") === "add_to_cart" && perActie.get("Aankoop") === "purchase");
  check("sync: een positie zonder acties houdt de standaardnaam", perActie.get("begin_checkout") === "begin_checkout");
  check("sync: zonder kaart de drie standaardnamen", [...checkoutActiesPerPositie(undefined).keys()].join() === "add_to_cart,begin_checkout,purchase");
  check("sync: de sleutel 'trechter' leest de sync niet",
    ![...checkoutActiesPerPositie({ trechter: { x: 1 } } as never).keys()].some((n) => n.includes("trechter")));
  const api = [
    { campaign: { id: "1", name: "C" }, segments: { date: "2026-11-01", device: "MOBILE", conversionActionName: "in winkelwagen" }, metrics: { conversions: 4, conversionsValue: 0 } },
    { campaign: { id: "1", name: "C" }, segments: { date: "2026-11-01", device: "MOBILE", conversionActionName: "Mand" }, metrics: { conversions: 1 } },
    { campaign: { id: "1", name: "C" }, segments: { date: "2026-11-01", device: "MOBILE", conversionActionName: "Aankoop" }, metrics: { conversions: 2, conversionsValue: 80 } },
    { campaign: { id: "1", name: "C" }, segments: { date: "2026-11-02", device: "MOBILE", conversionActionName: "Iets anders" }, metrics: { conversions: 9 } },
  ];
  const dag = checkoutRijenUit(api, perActie, "date");
  check("sync per dag: een rij per campagne, dag en apparaat, per positie opgeteld",
    dag.length === 1 && dag[0].date === "2026-11-01" && dag[0].addToCartCount === 5 && dag[0].purchaseCount === 2 && dag[0].purchaseValue === 80);
  check("sync per maand leest segments.month", checkoutRijenUit([{ ...api[0], segments: { ...api[0].segments, month: "2026-11-01" } }], perActie, "month")[0]?.date === "2026-11-01");
  // Wat de instellingen opslaan, telt de sync op dezelfde positie.
  const kaart = checkoutMapUit({ sjabloon: "webshop", stappen: herkenStappen("webshop",
    beschikbareBronnen({ conversionActions: [{ name: "view_item" }, { name: "Bestelling" }, { name: "Aankoop" }] })) });
  const uitKaart = checkoutActiesPerPositie(kaart as never);
  check("instellingen naar sync: 'Aankoop' telt als purchase, view_item niet", uitKaart.get("Aankoop") === "purchase" && !uitKaart.has("view_item"));
}

// ── De demo ──────────────────────────────────────────────────────────────────────────────────────
{
  const d = demoRows();
  const metaDag = d.meta_account_daily as Record<string, number>[];
  const fout = metaDag.filter((r) => !(r.landing_page_views >= r.add_to_cart && r.add_to_cart >= r.initiate_checkout && r.initiate_checkout >= r.conversions));
  check("demo Meta: landingspagina >= winkelwagen >= afrekenen >= aankoop op elke dag", metaDag.length > 700 && fout.length === 0, `${fout.length} dagen fout`);
  const google = d.google_ads_checkout_funnel_daily as Record<string, number | string>[];
  check("demo Google: checkoutstappen per dag", google.length > 300);
  check("demo Google: winkelwagen >= afrekenen >= aankoop op elke rij",
    google.every((r) => Number(r.add_to_cart_count) >= Number(r.begin_checkout_count) && Number(r.begin_checkout_count) >= Number(r.purchase_count)));
  const perMaand = new Map<string, number>();
  for (const r of google) {
    const k = `${r.campaign_id}|${String(r.date).slice(0, 7)}`;
    perMaand.set(k, (perMaand.get(k) ?? 0) + Number(r.purchase_count));
  }
  const camp = d.ads_campaign_monthly as Record<string, number | string>[];
  const teVeel = [...perMaand].filter(([k, n]) => {
    const [id, m] = k.split("|");
    const c = camp.find((x) => x.campaign_id === id && String(x.month).slice(0, 7) === m);
    return !c || n > Number(c.conversions);
  });
  check("demo Google: aankopen nooit meer dan de conversies van die campagne en maand", teVeel.length === 0, teVeel.slice(0, 3).join(";"));
  // Dezelfde generator voor de seed: geen dag na vandaag, geen dag die niet bestaat.
  const proef = checkoutPerDagUitCampagnes("x", [{ campaign_id: "c", campaign_name: "C", month: "2026-02-01", conversions: 10 }], "2026-02-10", "2026-01");
  check("demo-generator: alleen echte dagen tot en met vandaag", proef.length === 10 && proef.every((r) => String(r.date) <= "2026-02-10"));
  const seed = lees("scripts/demo/seed-demo-client.ts");
  check("de seed schrijft dezelfde Google-dagrijen (de browser leest de database, niet de mock)",
    /tables\["google_ads_checkout_funnel_daily"\] = checkoutPerDagUitCampagnes\(/.test(seed) && /google_ads_checkout_funnel_daily: "migratie 111/.test(seed));
  const m = /lpv: (\d+), atc: recent28 \? ([\d.]+) : ([\d.]+), ic: recent28 \? ([\d.]+) : ([\d.]+) \}\);/.exec(seed);
  const conv = /entity: "demo-meta-account".*?conv: (\d+)/.exec(seed);
  check("seed Meta: samenhangend (afrekenen >= conversies, in beide vensters)", !!m && !!conv
    && Number(m[1]) >= Number(m[3]) && Number(m[2]) >= Number(m[4]) && Number(m[3]) >= Number(m[5])
    && Number(m[4]) >= Number(conv![1]) && Number(m[5]) >= Number(conv![1]), m?.[0] ?? "niet gevonden");
}

// ── De schakelaar ────────────────────────────────────────────────────────────────────────────────
// Deze toetsen lezen de bron: ClientDashboard is niet los te renderen. Wat wel als gedrag te toetsen
// is (de trechter zonder Na de klik), staat onderaan.
{
  const dash = lees("components/dashboard/client-dashboard.tsx");
  check("de instelling staat alleen in de nieuwe weergave", /\{nieuweWeergave && <ConversieTrechterSettings/.test(dash)
    && dash.split("<ConversieTrechterSettings").length === 2);
  const oudeTak = dash.indexOf("// ── De vertrouwde weergave");
  const vertrouwd = dash.slice(oudeTak, dash.indexOf("{clientData.loading && <PaginaLaadvlak"));
  check("de vertrouwde tak kent Na de klik niet", !/NaDeKlik|Conversiestappen/.test(vertrouwd));
  const boven = lees("components/dashboard/overzicht-bovenkant.tsx");
  check("Na de klik staat alleen op de bovenkant van de nieuwe weergave",
    boven.includes("<KanaalNaDeKlik") && boven.includes("<NaDeKlikPerKanaal") && !dash.includes("<NaDeKlikPerKanaal"));
  check("Na de klik direct onder Bijdrage per kanaal", /<BijdragePerKanaal [^\n]*\/>\s*<NaDeKlikPerKanaal/.test(boven));
  // De trechter zonder kind rendert zoals hij was.
  const zonder = renderToStaticMarkup(createElement(KanaalTrechter, { kanaal: "meta", trechter: null, uitleg: null, venster: { over: "x", tegen: null } }));
  check("de trechter zonder Na de klik is ongewijzigd", !zonder.includes("na-de-klik"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
