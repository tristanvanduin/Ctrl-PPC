// De deterministische vangrails op zoektermen. Geen IO.
// Draaien: npx tsx lib/analysis/__search_term_guardrails_test.ts
//
// Dit is de laatste controle voordat een uitsluiting als voorstel in de goedkeuringswachtrij
// belandt. Een terechte uitsluiting die hier wegvalt kost budget; een onterechte die erdoor komt
// kost verkeer dat niet meer terugkomt. Twee dingen stonden hier scheef:
//
//   1. De clustercontrole telde rijen in plaats van zoektermen. Een term waarin hetzelfde 2-gram
//      twee keer voorkwam werd twee keer in dezelfde groep gezet, zodat twee termen samen de
//      drempel van drie haalden en een terechte uitsluiting werd afgezwakt.
//   2. "brand" werd als deelstring gezocht. Brandbeveiliging, Brandstof en Brandweer zijn gewone
//      Nederlandse woorden en beursonderwerpen; elke zoekterm in zo'n campagne werd op "keep"
//      gezet en kon niet meer worden uitgesloten. Terwijl "merk" zelf juist gemist werd.

import { applySearchTermGuardrails } from "./search-term-guardrails";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type T = Parameters<typeof applySearchTermGuardrails>[0][number];
const t = (searchTerm: string, o: Partial<T> = {}): T => ({
  searchTerm, verdict: "relevant", relevanceScore: 3, reason: "r", confidence: "medium",
  recommendedAction: "keep", intentType: "generic_commercial",
  clicks: 20, cost: 100, conversions: 0, conversionsValue: 0,
  campaignName: "Search Generic", adGroupName: "AG", ...o,
} as T);
/** Een term die zonder ingrijpen uitgesloten zou worden. */
const uitsluiten = (searchTerm: string, o: Partial<T> = {}) =>
  t(searchTerm, { recommendedAction: "negative_exact", intentType: "out_of_scope", relevanceScore: 1, ...o });
const acties = (v: T[]) => v.map((x) => x.recommendedAction).join(", ");

// ── De clusterdrempel telt zoektermen ─────────────────────────────────────

console.log("De clusterdrempel");
{
  // Beide termen leveren het 2-gram "zonnepaneel installatie" twee keer op. Dat gaf een groep
  // van vier terwijl het er twee zijn, en dus een afzwakking die niet had mogen gebeuren.
  const v = [
    t("zonnepaneel installatie zonnepaneel installatie"),
    uitsluiten("zonnepaneel installatie zonnepaneel installatie prijs"),
  ];
  applySearchTermGuardrails(v);
  check("twee termen halen de drempel van drie niet", v[1].recommendedAction === "negative_exact", acties(v));
}
{
  // Drie werkelijk verschillende termen in hetzelfde thema: dan hoort hij wel te vuren.
  const v = [
    t("groene energie beurs"),
    uitsluiten("groene energie cursus"),
    uitsluiten("groene energie vacature"),
  ];
  applySearchTermGuardrails(v);
  check("drie echte termen worden wel afgezwakt", v[1].recommendedAction === "investigate" && v[2].recommendedAction === "investigate", acties(v));
  check("met een clustersleutel", v[0].clusterKey === "groene energie", String(v[0].clusterKey));
  check("en gemarkeerd voor beoordeling", v[1].requiresHumanReview === true);
  check("de te behouden term blijft staan", v[0].recommendedAction === "keep");
}
{
  // Dezelfde zoekterm in drie advertentiegroepen is één term, geen thema van drie.
  const v = [
    t("groene energie beurs", { adGroupName: "A" }),
    uitsluiten("groene energie beurs", { adGroupName: "B" }),
    uitsluiten("groene energie beurs", { adGroupName: "C" }),
  ];
  applySearchTermGuardrails(v);
  check("geen clustersleutel voor één term", v[0].clusterKey === undefined, String(v[0].clusterKey));
  // Maar de tegenspraak zelf blijft wel staan: dezelfde term die hier behouden en daar
  // uitgesloten wordt, is per definitie inconsistent.
  check("de tegenspraak wordt wel opgemerkt", v[1].recommendedAction === "investigate", acties(v));
  check("met een reden die naar de term wijst",
    /andere advertentiegroep/.test(v[1].saferAlternativeReason ?? ""), v[1].saferAlternativeReason ?? "");
}
{
  // Dezelfde term overal uitsluiten is geen tegenspraak en hoort niet afgezwakt te worden.
  const v = [uitsluiten("gratis pdf", { adGroupName: "A" }), uitsluiten("gratis pdf", { adGroupName: "B" })];
  applySearchTermGuardrails(v);
  check("consistente uitsluitingen blijven staan", v.every((x) => x.recommendedAction === "negative_exact"), acties(v));
}

// ── Branded campagnes op hele woorden ─────────────────────────────────────

console.log("\nHerkenning van branded campagnes");
for (const naam of ["Search Brandbeveiliging", "Search Brandstof", "Display Brandweer", "Search Brandwonden"]) {
  const v = [uitsluiten("gratis pdf downloaden", { campaignName: naam })];
  applySearchTermGuardrails(v);
  check(`"${naam}" is geen merkcampagne`, v[0].recommendedAction === "negative_exact",
    `${v[0].recommendedAction} / ${v[0].intentType}`);
}
for (const naam of ["Search Brand NL", "Branded Search", "Search Merk", "Search Merknaam", "brand"]) {
  const v = [uitsluiten("iets willekeurigs", { campaignName: naam })];
  applySearchTermGuardrails(v);
  check(`"${naam}" is wel een merkcampagne`, v[0].recommendedAction === "keep",
    `${v[0].recommendedAction} / ${v[0].intentType}`);
}

// ── De kernbescherming blijft overeind ────────────────────────────────────

console.log("\nDe kernregels");
{
  const v = [uitsluiten("greentech tickets", { conversions: 4, conversionsValue: 900, recommendedAction: "negative_phrase" })];
  applySearchTermGuardrails(v);
  check("een converterende term wordt nooit uitgesloten", v[0].recommendedAction === "keep", acties(v));
  check("en telt als hard bewijs", v[0].evidenceLevel === "deterministic", String(v[0].evidenceLevel));
}
{
  const v = [uitsluiten("beurs stand huren", { cost: 2 })];
  applySearchTermGuardrails(v);
  check("te weinig spend wordt monitor", v[0].recommendedAction === "monitor", acties(v));
  check("met laag vertrouwen", v[0].confidence === "low");
}
{
  const v = [t("concurrentnaam expo", { intentType: "competitor", recommendedAction: "negative_phrase", cost: 20 })];
  applySearchTermGuardrails(v);
  check("phrase op een concurrent wordt nooit uitgevoerd", v[0].recommendedAction === "investigate", acties(v));
  check("en is gemarkeerd als risico", v[0].riskFlag === true);
  check("een concurrent vraagt altijd om beoordeling", v[0].requiresHumanReview === true);
}
{
  const v = [t("led verlichting kopen", { recommendedAction: "negative_exact", relevanceScore: 4 })];
  applySearchTermGuardrails(v);
  check("een relevante commerciele term met 0 conversies gaat naar investigate",
    v[0].recommendedAction === "investigate", acties(v));
}
{
  // Let op de intentie: bij een commerciele term grijpt regel 5 er eerder in en wordt het
  // investigate, waarna er niets meer uit te sluiten valt. Hier gaat het om een term die
  // werkelijk als phrase-uitsluiting zou doorgaan.
  const v = [t("gratis spel", { recommendedAction: "negative_phrase", intentType: "out_of_scope", relevanceScore: 1, confidence: "high" })];
  applySearchTermGuardrails(v);
  check("phrase op een korte term is hoog risico", v[0].exclusionRisk === "high", String(v[0].exclusionRisk));
  check("en wordt gemarkeerd", v[0].riskFlag === true);
  check("en gaat niet zonder beoordeling door",
    v[0].actionReadiness === "investigate_first", String(v[0].actionReadiness));
  // De uitsluiting zelf blijft staan; alleen de uitvoering vraagt om een mens.
  check("de aanbeveling blijft phrase", v[0].recommendedAction === "negative_phrase", v[0].recommendedAction);
}

// ── Regel 14: al uitgesloten termen (status EXCLUDED) ─────────────────────
//
// search_term_view.status werd genegeerd (sloop-audit 1 sep 2026), waardoor termen waar al
// een negative op staat opnieuw als uitsluitings-advies terugkwamen — een dubbel voorstel in
// de wachtrij, elke run weer.

console.log("\nAl uitgesloten termen (status EXCLUDED)");
{
  const v = [uitsluiten("gokkasten online", { status: "EXCLUDED" })];
  applySearchTermGuardrails(v);
  check("een EXCLUDED term wordt niet opnieuw als negative geadviseerd",
    v[0].recommendedAction === "monitor", acties(v));
  check("met de reden erbij", /al uitgesloten/i.test(v[0].reason), v[0].reason);
  check("en het originele advies als spoor", v[0].saferAlternativeAction === "negative_exact",
    String(v[0].saferAlternativeAction));
  check("readiness volgt de nieuwe actie", v[0].actionReadiness === "monitor", String(v[0].actionReadiness));
}
{
  const v = [uitsluiten("gratis spellen", { status: "EXCLUDED", recommendedAction: "negative_phrase" })];
  applySearchTermGuardrails(v);
  check("ook phrase-uitsluitingen op EXCLUDED termen worden tegengehouden",
    v[0].recommendedAction === "monitor", acties(v));
}
{
  const v = [t("beursstand huren", { status: "ADDED" }), uitsluiten("iets ongerelateerds", { status: "NONE" })];
  applySearchTermGuardrails(v);
  check("ADDED raakt niets", v[0].recommendedAction === "keep", acties(v));
  check("NONE blokkeert een terechte uitsluiting niet", v[1].recommendedAction === "negative_exact", acties(v));
}
{
  // Zonder status-veld (oudere aanroepers) verandert er niets — het veld is optioneel.
  const v = [uitsluiten("nog iets ongerelateerds")];
  applySearchTermGuardrails(v);
  check("zonder status blijft het advies staan", v[0].recommendedAction === "negative_exact", acties(v));
}

// ── actionReadiness volgt de uiteindelijke aanbeveling ────────────────────
//
// Dit veld bepaalt in action-gating.ts of iets zonder mens toegepast mag worden. Het werd
// afgeleid in fase 1, terwijl de clustercontrole in fase 2 de aanbeveling daarna nog terugzette.
// Er kwamen dan rijen uit met actie "investigate" en requiresHumanReview true, maar readiness
// "direct_action" — twee velden in dezelfde rij die elkaar tegenspreken, waarbij het gevaarlijke
// veld het veld is waar de automatisering naar kijkt.

console.log("\nactionReadiness na de clustercontrole");
{
  const scherp = (naam: string, o: Partial<T> = {}) =>
    t(naam, { verdict: "irrelevant", relevanceScore: 1, confidence: "high", intentType: "out_of_scope", recommendedAction: "negative_exact", ...o });
  const v = [
    t("groene energie beurs", { relevanceScore: 5, intentType: "branded_own" }),
    scherp("groene energie cursus"),
    scherp("groene energie vacature"),
  ];
  applySearchTermGuardrails(v);
  check("de afgezwakte uitsluiting is niet direct uitvoerbaar",
    v[1].actionReadiness === "investigate_first", `${v[1].recommendedAction} / ${v[1].actionReadiness}`);
  check("dat geldt voor beide", v[2].actionReadiness === "investigate_first", String(v[2].actionReadiness));
  check("de te behouden term staat op monitor", v[0].actionReadiness === "monitor", String(v[0].actionReadiness));

  // Geen enkele rij mag tegelijk om een mens vragen en als direct uitvoerbaar gelden.
  const tegenstrijdig = v.filter((x) => x.actionReadiness === "direct_action" && (x.requiresHumanReview || x.riskFlag));
  check("geen rij spreekt zichzelf tegen", tegenstrijdig.length === 0,
    tegenstrijdig.map((x) => x.searchTerm).join(", "));
}
{
  // Een schone, scherpe uitsluiting die door geen enkele regel wordt aangeraakt hoort wel
  // gewoon direct uitvoerbaar te blijven — de gate mag niet alles dichtzetten.
  const v = [t("gratis spelletjes downloaden", { verdict: "irrelevant", relevanceScore: 1, confidence: "high", intentType: "out_of_scope", recommendedAction: "negative_exact" })];
  applySearchTermGuardrails(v);
  check("een schone uitsluiting blijft direct uitvoerbaar",
    v[0].actionReadiness === "direct_action", `${v[0].recommendedAction} / ${v[0].actionReadiness}`);
}
{
  // Zet het model zelf requiresHumanReview, dan mag de out_of_scope-tak dat niet overrulen.
  const v = [t("iets twijfelachtigs hier", { verdict: "irrelevant", relevanceScore: 1, confidence: "high", intentType: "out_of_scope", recommendedAction: "negative_exact", requiresHumanReview: true })];
  applySearchTermGuardrails(v);
  check("een gevraagde beoordeling wint van direct_action",
    v[0].actionReadiness === "investigate_first", String(v[0].actionReadiness));
}

// ── Stabiliteit ───────────────────────────────────────────────────────────
//
// De functie muteert zijn invoer. Twee keer draaien of de lijst in een andere volgorde
// aanleveren mag geen ander advies opleveren — anders hangt een uitsluiting af van de
// rijvolgorde die de database toevallig teruggaf.

console.log("\nStabiliteit");
{
  const maak = (): T[] => [
    t("gratis whitepaper", { recommendedAction: "negative_phrase", intentType: "informational", relevanceScore: 1, clicks: 1, confidence: "high" }),
    t("concurrent naam", { recommendedAction: "negative_phrase", intentType: "competitor", cost: 80 }),
    uitsluiten("led lamp kopen", { cost: 2 }),
    t("groene energie beurs"),
    uitsluiten("groene energie cursus"),
    uitsluiten("groene energie vacature"),
  ];
  const sleutel = (arr: T[]) => arr
    .map((x) => `${x.searchTerm}=${x.recommendedAction}/${x.clusterKey ?? "-"}/${x.actionReadiness}`)
    .sort().join(" ; ");

  const eenmaal = maak(); applySearchTermGuardrails(eenmaal);
  const tweemaal = maak(); applySearchTermGuardrails(tweemaal); applySearchTermGuardrails(tweemaal);
  check("twee keer toepassen verandert niets", sleutel(eenmaal) === sleutel(tweemaal),
    `${sleutel(eenmaal)}\n        vs ${sleutel(tweemaal)}`);

  const omgekeerd = maak().reverse(); applySearchTermGuardrails(omgekeerd);
  check("de volgorde van de invoer maakt niet uit", sleutel(eenmaal) === sleutel(omgekeerd),
    `${sleutel(eenmaal)}\n        vs ${sleutel(omgekeerd)}`);
}
{
  // Randgevallen die niet mogen crashen.
  check("een lege lijst is geen probleem", applySearchTermGuardrails([]).length === 0);
  const raar = [t("  ", { searchTerm: "   " }), t("a"), t("ab cd")];
  applySearchTermGuardrails(raar);
  check("lege en zeer korte termen crashen niet", raar.every((x) => x.recommendedAction !== undefined));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
