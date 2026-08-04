// Assetdekking per PMax-assetgroep. Deterministisch, geen IO.
// Draaien: npx tsx lib/pmax/__assetdekking_test.ts

import { analyseerAssetdekking, VERWACHTE_TYPES, type AssetRegel } from "./assetdekking";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const r = (groep: string, type: string, label: string, id: string, month = "2026-07-01"): AssetRegel =>
  ({ asset_group_name: groep, asset_type: type, performance_label: label, asset_id: id, month });

// ── HET GAT ───────────────────────────────────────────────────────────────
//
// Waar dit blok voor bestaat. Zonder eigen video maakt Google er zelf een uit je beeld en tekst;
// die staat er dus wél, alleen niet een die jij hebt gemaakt, en hij presteert doorgaans slechter.
// YouTube is tegelijk een van de sterkste plaatsingen binnen PMax, dus zo'n groep draait daar mee
// met de zwakste creatie die er te maken valt.

{
  const d = analyseerAssetdekking([
    r("Standhouders NL", "TEXT", "BEST", "a1"),
    r("Standhouders NL", "IMAGE", "GOOD", "a2"),
    r("Standhouders NL", "YOUTUBE_VIDEO", "BEST", "a3"),
    r("Bezoekers breed", "TEXT", "LOW", "b1"),
    r("Bezoekers breed", "IMAGE", "GOOD", "b2"),
    // geen video
  ]);
  check("twee groepen gevonden", d.groepen.length === 2, String(d.groepen.length));
  check("de groep zonder video wordt gemeld",
    d.zonderVideo.join(",") === "Bezoekers breed", d.zonderVideo.join(","));
  check("de complete groep niet", !d.zonderVideo.includes("Standhouders NL"));
  check("het ontbrekende type staat op de groep",
    d.groepen.find((g) => g.groep === "Bezoekers breed")?.ontbrekend.join(",") === "YOUTUBE_VIDEO",
    JSON.stringify(d.groepen.find((g) => g.groep === "Bezoekers breed")?.ontbrekend));
  check("de samenvatting noemt de video", /geen eigen video/.test(d.samenvatting ?? ""), String(d.samenvatting));
  check("en waarom dat erg is", /slechter/.test(d.samenvatting ?? ""));
}

// Complete dekking: geen zin. Een blok dat altijd iets meldt leert de lezer de melding over te
// slaan, en dan mist hij hem op de dag dat er wél iets is.
{
  const d = analyseerAssetdekking([
    r("Compleet", "TEXT", "BEST", "a1"),
    r("Compleet", "IMAGE", "GOOD", "a2"),
    r("Compleet", "YOUTUBE_VIDEO", "GOOD", "a3"),
  ]);
  check("complete dekking geeft geen samenvatting", d.samenvatting === null, String(d.samenvatting));
  check("en geen ontbrekende types", d.groepen[0].ontbrekend.length === 0);
}

// ── ONBEOORDEELD IS GEEN ZWAK ─────────────────────────────────────────────
//
// Google labelt pas als er genoeg vertoningen zijn. PENDING en LEARNING betekenen "nog niet
// beoordeeld", niet "slecht". Zonder dit onderscheid leest een verse assetgroep als verwaarloosd
// op de dag dat hij live gaat -- hetzelfde onderscheid als `assessed` in health-score.ts.

{
  const d = analyseerAssetdekking([
    r("Vers", "TEXT", "PENDING", "a1"),
    r("Vers", "IMAGE", "LEARNING", "a2"),
    r("Vers", "YOUTUBE_VIDEO", "", "a3"),
  ]);
  check("PENDING telt niet als zwak", d.zwakTotaal === 0, String(d.zwakTotaal));
  check("maar wel als onbeoordeeld",
    d.groepen[0].perType.every((t) => t.onbeoordeeld === 1),
    JSON.stringify(d.groepen[0].perType));
  check("en er komt geen zwak-melding", !/laag/.test(d.samenvatting ?? ""), String(d.samenvatting));
}

{
  const d = analyseerAssetdekking([
    r("Zwak", "TEXT", "LOW", "a1"),
    r("Zwak", "IMAGE", "LOW", "a2"),
    r("Zwak", "YOUTUBE_VIDEO", "GOOD", "a3"),
  ]);
  check("LOW telt wel als zwak", d.zwakTotaal === 2, String(d.zwakTotaal));
  check("de samenvatting noemt het aantal", /2 assets met het label "laag"/.test(d.samenvatting ?? ""),
    String(d.samenvatting));
}

// ── Een asset komt in elke maand terug ────────────────────────────────────
//
// Zonder ontdubbelen telt dezelfde asset twaalf keer mee en lijkt elke groep goed gevuld. Het
// meest recente label wint: dat is het oordeel van nu.

{
  const d = analyseerAssetdekking([
    r("Groep", "TEXT", "LOW", "a1", "2026-05-01"),
    r("Groep", "TEXT", "GOOD", "a1", "2026-06-01"),
    r("Groep", "TEXT", "BEST", "a1", "2026-07-01"),
    r("Groep", "IMAGE", "GOOD", "a2", "2026-07-01"),
    r("Groep", "YOUTUBE_VIDEO", "GOOD", "a3", "2026-07-01"),
  ]);
  const tekst = d.groepen[0].perType.find((t) => t.type === "TEXT")!;
  check("dezelfde asset telt één keer", tekst.aantal === 1, String(tekst.aantal));
  check("het meest recente label wint", tekst.zwak === 0, JSON.stringify(tekst));
}
{
  // En andersom: eerst goed, later laag. Dan telt de laatste ook.
  const d = analyseerAssetdekking([
    r("Groep", "TEXT", "BEST", "a1", "2026-05-01"),
    r("Groep", "TEXT", "LOW", "a1", "2026-07-01"),
  ]);
  check("een verslechterd label wint ook", d.zwakTotaal === 1, String(d.zwakTotaal));
}

// ── Typenamen normaliseren ────────────────────────────────────────────────
// De API levert per veld een andere naam voor hetzelfde. Voor deze vraag is elke tekstvorm tekst.

{
  const d = analyseerAssetdekking([
    r("G", "HEADLINE", "GOOD", "a1"),
    r("G", "DESCRIPTION", "GOOD", "a2"),
    r("G", "LONG_HEADLINE", "GOOD", "a3"),
    r("G", "MARKETING_IMAGE", "GOOD", "a4"),
    r("G", "VIDEO", "GOOD", "a5"),
  ]);
  const tekst = d.groepen[0].perType.find((t) => t.type === "TEXT")!;
  check("alle tekstvormen tellen als tekst", tekst.aantal === 3, String(tekst.aantal));
  check("MARKETING_IMAGE telt als beeld",
    d.groepen[0].perType.find((t) => t.type === "IMAGE")!.aantal === 1);
  check("VIDEO telt als YOUTUBE_VIDEO",
    d.groepen[0].perType.find((t) => t.type === "YOUTUBE_VIDEO")!.aantal === 1);
  check("een complete groep meldt niets", d.samenvatting === null, String(d.samenvatting));
}

// ── Volgorde en onzin ─────────────────────────────────────────────────────

{
  const d = analyseerAssetdekking([
    r("Zebra", "TEXT", "GOOD", "z1"),
    r("Alfa", "TEXT", "GOOD", "a1"),
  ]);
  // Alfabetisch en niet in databasevolgorde: die verandert met de sync, en een lijst die van
  // volgorde wisselt zonder dat er iets veranderde leest als ruis.
  check("groepen staan alfabetisch", d.groepen.map((g) => g.groep).join(",") === "Alfa,Zebra",
    d.groepen.map((g) => g.groep).join(","));
}

{
  const d = analyseerAssetdekking([]);
  check("geen regels geeft geen groepen", d.groepen.length === 0);
  check("en geen samenvatting", d.samenvatting === null);
  const rommel = analyseerAssetdekking([
    { asset_group_name: null, asset_type: "TEXT", performance_label: "GOOD", asset_id: "x" },
    { asset_group_name: "G", asset_type: "ONBEKEND_TYPE", performance_label: "GOOD", asset_id: "y" },
    { asset_group_name: "  ", asset_type: "IMAGE", performance_label: "GOOD", asset_id: "z" },
  ]);
  check("regels zonder groep of met een onbekend type vallen weg", rommel.groepen.length === 0,
    JSON.stringify(rommel.groepen));
}

check("drie verwachte types, video achteraan",
  VERWACHTE_TYPES.join(",") === "TEXT,IMAGE,YOUTUBE_VIDEO", VERWACHTE_TYPES.join(","));

// ── Beperkt houden bij veel groepen ───────────────────────────────────────
//
// Een account kan tientallen assetgroepen hebben. Ze allemaal tonen maakt het blok onbegrensd
// hoog en zet de lezer aan het zoeken naar de ene die ertoe doet. Wat er op het scherm hoort is
// wat aandacht vraagt; de rest wordt geteld.

{
  const compleet = (n: string) => [r(n, "TEXT", "GOOD", `${n}-t`), r(n, "IMAGE", "GOOD", `${n}-i`), r(n, "YOUTUBE_VIDEO", "GOOD", `${n}-v`)];
  const d = analyseerAssetdekking([
    ...compleet("A"), ...compleet("B"), ...compleet("C"), ...compleet("D"),
    r("Zonder video", "TEXT", "GOOD", "z-t"), r("Zonder video", "IMAGE", "GOOD", "z-i"),
    r("Met zwak", "TEXT", "LOW", "m-t"), r("Met zwak", "IMAGE", "GOOD", "m-i"), r("Met zwak", "YOUTUBE_VIDEO", "GOOD", "m-v"),
  ]);
  check("alle groepen blijven beschikbaar", d.groepen.length === 6, String(d.groepen.length));
  check("alleen twee vragen aandacht", d.aandacht.length === 2, String(d.aandacht.length));
  check("de rest wordt geteld, niet opgesomd", d.compleet === 4, String(d.compleet));
  // De ontbrekende video bovenaan: dat is de bevinding met de meeste impact.
  check("ontbrekende video staat bovenaan", d.aandacht[0].groep === "Zonder video",
    d.aandacht.map((g) => g.groep).join(","));
}

// Bij gelijke soort probleem telt het aantal zwakke assets, aflopend.
{
  const g = (n: string, zwak: number) => [
    r(n, "TEXT", zwak > 0 ? "LOW" : "GOOD", `${n}-t`),
    r(n, "TEXT", zwak > 1 ? "LOW" : "GOOD", `${n}-t2`),
    r(n, "IMAGE", "GOOD", `${n}-i`), r(n, "YOUTUBE_VIDEO", "GOOD", `${n}-v`),
  ];
  const d = analyseerAssetdekking([...g("Een zwak", 1), ...g("Twee zwak", 2)]);
  check("meer zwakke assets staat hoger", d.aandacht[0].groep === "Twee zwak",
    d.aandacht.map((x) => `${x.groep}:${x.zwak}`).join(","));
}

// Alles in orde: niets vraagt aandacht, en dan hoort er ook geen lijst te staan.
{
  const d = analyseerAssetdekking([
    r("A", "TEXT", "GOOD", "a1"), r("A", "IMAGE", "GOOD", "a2"), r("A", "YOUTUBE_VIDEO", "GOOD", "a3"),
  ]);
  check("zonder problemen geen aandachtslijst", d.aandacht.length === 0);
  check("en alles telt als compleet", d.compleet === 1);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
