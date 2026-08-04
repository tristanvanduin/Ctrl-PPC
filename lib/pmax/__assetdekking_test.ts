// Assetdekking per PMax-assetgroep. Deterministisch, geen IO.
// Draaien: npx tsx lib/pmax/__assetdekking_test.ts

import {
  analyseerAssetdekking, absorbeertBudget, groepsactie, TYPES, BANDEN, type AssetRegel,
} from "./assetdekking";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

let teller = 0;
const r = (groep: string, type: string, label = "GOOD", month = "2026-07-01"): AssetRegel =>
  ({ asset_group_name: groep, asset_type: type, performance_label: label, asset_id: `a${teller++}`, month });

/** Een groep die overal precies aan Google's minimum voldoet, plus video. */
function compleet(groep: string): AssetRegel[] {
  return [
    r(groep, "HEADLINE"), r(groep, "HEADLINE"), r(groep, "HEADLINE"),
    r(groep, "LONG_HEADLINE"),
    r(groep, "DESCRIPTION"), r(groep, "DESCRIPTION"),
    r(groep, "MARKETING_IMAGE"), r(groep, "SQUARE_MARKETING_IMAGE"),
    r(groep, "LOGO"), r(groep, "YOUTUBE_VIDEO"),
  ];
}

// ── DE MINIMA VAN GOOGLE ──────────────────────────────────────────────────
//
// Uit developers.google.com/google-ads/api/performance-max/asset-requirements. Dit zijn harde
// eisen: een assetgroep eronder is niet volledig serveerbaar. Deze controle legt de getallen vast
// zodat ze niet ongemerkt kunnen verschuiven.

{
  const minima = Object.fromEntries(TYPES.map((t) => [t.type, [t.min, t.max]]));
  check("HEADLINE 3–15", String(minima.HEADLINE) === "3,15", String(minima.HEADLINE));
  check("LONG_HEADLINE 1–5", String(minima.LONG_HEADLINE) === "1,5", String(minima.LONG_HEADLINE));
  check("DESCRIPTION 2–5", String(minima.DESCRIPTION) === "2,5", String(minima.DESCRIPTION));
  check("MARKETING_IMAGE 1–20", String(minima.MARKETING_IMAGE) === "1,20", String(minima.MARKETING_IMAGE));
  check("SQUARE_MARKETING_IMAGE 1–20", String(minima.SQUARE_MARKETING_IMAGE) === "1,20");
  // Staand beeld en video hebben GEEN minimum. Dat is geen slordigheid maar een echt gegeven;
  // zonder deze controle zou iemand er ooit een 1 van maken en meldt de kaart een tekort dat
  // Google niet kent.
  check("PORTRAIT geen minimum", String(minima.PORTRAIT_MARKETING_IMAGE) === "0,20");
  check("YOUTUBE_VIDEO geen minimum", String(minima.YOUTUBE_VIDEO) === "0,15");
  check("LOGO 1–5", String(minima.LOGO) === "1,5", String(minima.LOGO));
  check("acht types", TYPES.length === 8, String(TYPES.length));
}

// Elk type hoort bij precies één band, en elke band heeft minstens één type. Anders staat er een
// bandkop boven nul kolommen, of valt een kolom buiten alle koppen -- allebei onzichtbaar in tsc.
{
  const banden = new Set(BANDEN.map((b) => b.band));
  check("elke band heeft kolommen", BANDEN.every((b) => TYPES.some((t) => t.band === b.band)),
    BANDEN.map((b) => b.band).join(","));
  check("elk type valt onder een bekende band", TYPES.every((t) => banden.has(t.band)),
    TYPES.filter((t) => !banden.has(t.band)).map((t) => t.type).join(","));
  // De banden staan aaneengesloten in TYPES; de matrix zet zijn scheidingslijnen op de overgangen,
  // dus een type dat tussen twee andere banden in staat zou twee lijnen geven.
  const volgorde = TYPES.map((t) => t.band);
  check("de banden staan aaneengesloten",
    volgorde.filter((b, i) => i === 0 || volgorde[i - 1] !== b).length === BANDEN.length,
    volgorde.join(","));
}

{
  const d = analyseerAssetdekking(compleet("Compleet"));
  check("een complete groep heeft geen tekorten", d.groepen[0].tekorten.length === 0,
    d.groepen[0].tekorten.join(","));
  check("en vraagt geen aandacht", d.aandacht.length === 0);
  check("en heeft dus geen actieregel", groepsactie(d.groepen[0]) === null,
    String(groepsactie(d.groepen[0])));
  check("hij telt als compleet", d.compleet === 1);
}

// ── HET TEKORT ────────────────────────────────────────────────────────────
//
// Twee koppen waar er drie moeten zijn. Dat is niet "bijna goed": de groep is dan niet volledig
// serveerbaar. Op de grove indeling van de eerste versie (alles op één hoop "tekst") was dit
// onzichtbaar -- en dat is precies waarom de fijne veldtypen ertoe doen.

{
  const d = analyseerAssetdekking([
    r("Te weinig koppen", "HEADLINE"), r("Te weinig koppen", "HEADLINE"),
    r("Te weinig koppen", "LONG_HEADLINE"),
    r("Te weinig koppen", "DESCRIPTION"), r("Te weinig koppen", "DESCRIPTION"),
    r("Te weinig koppen", "MARKETING_IMAGE"), r("Te weinig koppen", "SQUARE_MARKETING_IMAGE"),
    r("Te weinig koppen", "LOGO"), r("Te weinig koppen", "YOUTUBE_VIDEO"),
  ]);
  check("twee koppen is een tekort", d.groepen[0].tekorten.join(",") === "HEADLINE",
    d.groepen[0].tekorten.join(","));
  check("de kop-cel draagt de vlag",
    d.groepen[0].perType.find((t) => t.type === "HEADLINE")?.tekort === true);
  check("de andere cellen niet",
    d.groepen[0].perType.filter((t) => t.tekort).length === 1);
  // De actieregel noemt HET AANTAL DAT ONTBREEKT, niet het aantal dat er staat. "1 kop tekort"
  // is een opdracht; "2 koppen" laat de lezer zelf het minimum uit zijn hoofd erbij halen.
  check("de actieregel zegt wat er nog moet komen",
    groepsactie(d.groepen[0]) === "1 kop tekort", String(groepsactie(d.groepen[0])));
}

// Twee tekorten tegelijk: enkelvoud en meervoud moeten allebei kloppen, en de opsomming leest als
// een zin. Een regel als "2 kop en 1 beschrijvingen tekort" is grammaticaal fout op een scherm
// waar de rest wél klopt, en dat valt meteen op.
{
  const d = analyseerAssetdekking([
    r("Twee gaten", "HEADLINE"),
    r("Twee gaten", "LONG_HEADLINE"),
    r("Twee gaten", "MARKETING_IMAGE"), r("Twee gaten", "SQUARE_MARKETING_IMAGE"),
    r("Twee gaten", "LOGO"), r("Twee gaten", "YOUTUBE_VIDEO"),
  ]);
  check("meervoud en enkelvoud in één opsomming",
    groepsactie(d.groepen[0]) === "2 koppen en 2 beschrijvingen tekort",
    String(groepsactie(d.groepen[0])));
}

// Staand beeld ontbreekt: GEEN tekort, want Google eist het niet. Zou dit als tekort tellen, dan
// meldt de kaart een probleem dat er niet is en leert de gebruiker de melding negeren.
{
  const d = analyseerAssetdekking(compleet("Zonder staand"));
  check("ontbrekend staand beeld is geen tekort",
    d.groepen[0].perType.find((t) => t.type === "PORTRAIT_MARKETING_IMAGE")?.tekort === false);
}

// ── DE VIDEO ──────────────────────────────────────────────────────────────
//
// Formeel optioneel, in de praktijk het duurste gat: zonder eigen video maakt Google er zelf een
// uit je beeld en koppen, en die presteert doorgaans slechter. Daarom apart bijgehouden en niet
// als "tekort".

{
  const zonder = compleet("Zonder video").filter((x) => x.asset_type !== "YOUTUBE_VIDEO");
  const d = analyseerAssetdekking(zonder);
  check("geen video is geen formeel tekort", d.groepen[0].tekorten.length === 0,
    d.groepen[0].tekorten.join(","));
  check("maar wordt wel apart gemeld", d.groepen[0].zonderVideo === true);
  check("en de groep vraagt aandacht", d.aandacht.length === 1);
  check("de actieregel noemt het", groepsactie(d.groepen[0]) === "geen eigen video",
    String(groepsactie(d.groepen[0])));
  // En niet twee keer: video heeft geen minimum, dus hij mag niet óók als tekort meelopen.
  check("en niet ook als tekort", !/tekort/.test(groepsactie(d.groepen[0]) ?? ""),
    String(groepsactie(d.groepen[0])));
}

// ── ONBEOORDEELD IS GEEN ZWAK ─────────────────────────────────────────────

{
  const d = analyseerAssetdekking([
    r("Vers", "HEADLINE", "PENDING"), r("Vers", "HEADLINE", "LEARNING"), r("Vers", "HEADLINE", ""),
    r("Vers", "LONG_HEADLINE", "PENDING"),
    r("Vers", "DESCRIPTION", "PENDING"), r("Vers", "DESCRIPTION", "PENDING"),
    r("Vers", "MARKETING_IMAGE", "PENDING"), r("Vers", "SQUARE_MARKETING_IMAGE", "PENDING"),
    r("Vers", "LOGO", "PENDING"), r("Vers", "YOUTUBE_VIDEO", "PENDING"),
  ]);
  check("PENDING telt niet als zwak", d.zwakTotaal === 0, String(d.zwakTotaal));
  check("maar wel als onbeoordeeld",
    d.groepen[0].perType.find((t) => t.type === "HEADLINE")?.onbeoordeeld === 3,
    JSON.stringify(d.groepen[0].perType.find((t) => t.type === "HEADLINE")));
  check("een verse groep vraagt geen aandacht", d.aandacht.length === 0);
}

{
  const d = analyseerAssetdekking([...compleet("Zwak"), r("Zwak", "HEADLINE", "LOW")]);
  check("LOW telt als zwak", d.zwakTotaal === 1, String(d.zwakTotaal));
  check("en zet de groep op aandacht", d.aandacht.length === 1);
  check("de actieregel noemt het aantal", groepsactie(d.groepen[0]) === "1 zwakke asset",
    String(groepsactie(d.groepen[0])));
}

// ── Een asset komt in elke maand terug ────────────────────────────────────
//
// Zonder ontdubbelen telt dezelfde kop twaalf keer mee en zit elke groep ruim boven het minimum.

{
  const d = analyseerAssetdekking([
    { asset_group_name: "G", asset_type: "HEADLINE", performance_label: "LOW", asset_id: "x", month: "2026-05-01" },
    { asset_group_name: "G", asset_type: "HEADLINE", performance_label: "GOOD", asset_id: "x", month: "2026-06-01" },
    { asset_group_name: "G", asset_type: "HEADLINE", performance_label: "BEST", asset_id: "x", month: "2026-07-01" },
  ]);
  const kop = d.groepen[0].perType.find((t) => t.type === "HEADLINE")!;
  check("dezelfde asset telt één keer", kop.aantal === 1, String(kop.aantal));
  check("het meest recente label wint", kop.zwak === 0, JSON.stringify(kop));
  check("één kop is dus een tekort", kop.tekort === true);
}

// ── Volgorde: wat gerepareerd moet worden bovenaan ────────────────────────

{
  const zonderVideo = compleet("B zonder video").filter((x) => x.asset_type !== "YOUTUBE_VIDEO");
  const metTekort = compleet("C met tekort").filter((x, i) => !(x.asset_type === "HEADLINE" && i < 2));
  const d = analyseerAssetdekking([...zonderVideo, ...metTekort, ...compleet("A compleet")]);
  check("een tekort staat boven een ontbrekende video",
    d.aandacht[0].groep === "C met tekort", d.aandacht.map((g) => g.groep).join(","));
  check("de complete groep valt buiten de aandachtslijst",
    !d.aandacht.some((g) => g.groep === "A compleet"));
  check("en wordt geteld", d.compleet === 1, String(d.compleet));
}

// ── Oude en afwijkende typenamen ──────────────────────────────────────────
//
// Rijen uit een eerdere sync dragen nog de grove waarden. Die weggooien zou een tekort melden dat
// er niet is; ze worden dus op de meest waarschijnlijke fijne soort gezet.

{
  const d = analyseerAssetdekking([
    r("Oud", "TEXT"), r("Oud", "IMAGE"), r("Oud", "VIDEO"), r("Oud", "LANDSCAPE_LOGO"),
  ]);
  const per = Object.fromEntries(d.groepen[0].perType.map((t) => [t.type, t.aantal]));
  check("TEXT wordt een kop", per.HEADLINE === 1, JSON.stringify(per));
  check("IMAGE wordt liggend beeld", per.MARKETING_IMAGE === 1);
  check("VIDEO wordt YOUTUBE_VIDEO", per.YOUTUBE_VIDEO === 1);
  check("LANDSCAPE_LOGO telt als logo", per.LOGO === 1);
}

// ── HET GELD ACHTER HET GAT ───────────────────────────────────────────────
//
// Zonder kostenaandeel staan een groep van 2% en een van 32% naast elkaar alsof ze even dringend
// zijn. Met dat aandeel is de volgorde binnen dezelfde ernst een keuze en geen alfabet.

{
  const regels = [...compleet("A klein"), ...compleet("B groot")]
    .filter((x) => x.asset_type !== "YOUTUBE_VIDEO");
  const d = analyseerAssetdekking(regels, {
    "A klein": { kosten: 100, conversies: 10 },
    "B groot": { kosten: 900, conversies: 90 },
  });
  const per = Object.fromEntries(d.groepen.map((g) => [g.groep, g.kostenAandeel]));
  check("het aandeel is kosten gedeeld door het totaal", per["B groot"] === 0.9, JSON.stringify(per));
  check("bij gelijke ernst staat de duurste bovenaan",
    d.aandacht[0].groep === "B groot", d.aandacht.map((g) => g.groep).join(","));
}

// Een groep zonder kostenregel krijgt null en geen 0. Nul zou lezen als "deze groep kost niets",
// en dat is precies de fout die deze codebase vaker maakte: afwezigheid als gemeten waarde.
{
  const d = analyseerAssetdekking(compleet("Zonder kosten"), { "Andere groep": { kosten: 500, conversies: 5 } });
  check("geen kostenregel geeft null", d.groepen[0].kostenAandeel === null,
    String(d.groepen[0].kostenAandeel));
}

// Het totaal loopt over ALLE kostenregels, ook van groepen die in dit venster geen assets hebben.
// Zou het alleen over de getoonde groepen lopen, dan telt 300 van 1000 op tot 100%.
{
  const d = analyseerAssetdekking(compleet("Enige"), {
    "Enige": { kosten: 300, conversies: 3 },
    "Buiten beeld": { kosten: 700, conversies: 7 },
  });
  check("het totaal telt ook groepen buiten beeld mee",
    d.groepen[0].kostenAandeel === 0.3, String(d.groepen[0].kostenAandeel));
}

{
  const d = analyseerAssetdekking(compleet("Geen kostentabel"));
  check("zonder kostentabel is het aandeel null", d.groepen[0].kostenAandeel === null);
  const nul = analyseerAssetdekking(compleet("Alles nul"), { "Alles nul": { kosten: 0, conversies: 0 } });
  check("een totaal van nul geeft geen deling", nul.groepen[0].kostenAandeel === null,
    String(nul.groepen[0].kostenAandeel));
}

// ── WANNEER EEN PERCENTAGE EEN BEVINDING WORDT ────────────────────────────
//
// "32% van de kosten" is even goed het teken van de beste groep als van de slechtste. Pas naast
// het conversie-aandeel zegt het iets, en dan nog alleen als het ver genoeg uiteenloopt EN er
// genoeg budget in omgaat om er iets aan te hebben.

{
  // 32% van de kosten, 11% van de conversies: verdubbeld en ruim boven de budgetdrempel.
  const d = analyseerAssetdekking([...compleet("Slurper"), ...compleet("Rest")], {
    "Slurper": { kosten: 320, conversies: 11 },
    "Rest": { kosten: 680, conversies: 89 },
  });
  const slurper = d.groepen.find((g) => g.groep === "Slurper")!;
  const rest = d.groepen.find((g) => g.groep === "Rest")!;
  check("kost het dubbele van wat het levert", absorbeertBudget(slurper) === true,
    `${slurper.kostenAandeel} vs ${slurper.conversieAandeel}`);
  check("de andere groep niet", absorbeertBudget(rest) === false,
    `${rest.kostenAandeel} vs ${rest.conversieAandeel}`);
}

// Wel de factor, niet het budget: 3% tegen 1% is verdubbeld, maar daar valt niets te halen. Zonder
// die tweede drempel meldt de kaart elke kleine groep en leert de lezer de melding over te slaan.
{
  const d = analyseerAssetdekking([...compleet("Klein"), ...compleet("Groot")], {
    "Klein": { kosten: 30, conversies: 1 },
    "Groot": { kosten: 970, conversies: 99 },
  });
  const klein = d.groepen.find((g) => g.groep === "Klein")!;
  check("een kleine groep haalt de drempel niet", absorbeertBudget(klein) === false,
    String(klein.kostenAandeel));
}

// Normale spreiding: 30% kosten tegen 25% conversies. Assetgroepen lopen altijd wat uiteen; dat
// melden zou van de bevinding een vaste regel maken.
{
  const d = analyseerAssetdekking([...compleet("A"), ...compleet("B")], {
    "A": { kosten: 300, conversies: 25 },
    "B": { kosten: 700, conversies: 75 },
  });
  check("normale spreiding is geen bevinding",
    absorbeertBudget(d.groepen.find((g) => g.groep === "A")!) === false);
}

// Nul conversies in het HELE account: dan is er geen verdeling om een aandeel van te nemen. Zou
// dat 0 worden, dan absorbeert elke groep volgens de regel budget -- terwijl het enige dat er aan
// de hand is, is dat er nog niets geconverteerd heeft. Dezelfde fout als Number(null) === 0.
{
  const d = analyseerAssetdekking(compleet("Zonder conversies"), {
    "Zonder conversies": { kosten: 1000, conversies: 0 },
  });
  const g = d.groepen[0];
  check("zonder conversies geen aandeel", g.conversieAandeel === null, String(g.conversieAandeel));
  check("en dus geen bevinding", absorbeertBudget(g) === false);
  check("het kostenaandeel staat er wel", g.kostenAandeel === 1, String(g.kostenAandeel));
}

// ── Onzin ─────────────────────────────────────────────────────────────────

{
  check("geen regels geeft geen groepen", analyseerAssetdekking([]).groepen.length === 0);
  check("en geen aandacht", analyseerAssetdekking([]).aandacht.length === 0);
  const rommel = analyseerAssetdekking([
    { asset_group_name: null, asset_type: "HEADLINE", asset_id: "x" },
    { asset_group_name: "G", asset_type: "ONBEKEND", asset_id: "y" },
    { asset_group_name: "  ", asset_type: "LOGO", asset_id: "z" },
  ]);
  check("regels zonder groep of met een onbekend type vallen weg", rommel.groepen.length === 0,
    JSON.stringify(rommel.groepen.map((g) => g.groep)));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
