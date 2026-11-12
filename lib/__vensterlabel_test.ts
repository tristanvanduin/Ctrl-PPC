// Elk blok op het Overzicht zegt welk venster het gebruikt (bouwplan fase 2).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__vensterlabel_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Op het Overzicht stonden zes conversietotalen over zes vensters, en geen blok zei welk. Bij een
// periodewissel veranderde één blok van de eenentwintig. Sinds fase 2:
//
// - draagt elk blok een Vensterlabel: "volgt periode" (met de gekozen maanden), "jaarblok" (met
//   het jaar) of "vast venster" (met zijn eigen venster, eerlijk);
// - volgen de blokken die dat uit al geladen maandreeksen kunnen ook echt de periode;
// - staan de blokken met een vast venster op elk tabblad bij elkaar onder één kop, met de
//   jaarblokken (pacing, jaaroverzicht, beurs) aaneengesloten en niets ertussen dat de periode
//   volgt.
//
// Het label en de rekenkern worden echt uitgevoerd. De vijf weergaven zijn te groot om te mounten
// (hooks, providers, verzoeken); daar leest de test de bron. Dat vangnet is bewust streng: een
// blok dat iemand later toevoegt zonder label, of tussen de jaarblokken zet, laat hem falen.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Vensterlabel } from "../components/ui/vensterlabel";
import { Deelkop } from "../components/ui/sectie";
import { PeriodProvider } from "./period/period-context";
import {
  formatRangeKort, periodeOpEind, vensterEindMaand, addMonths, SNELKOPPELINGEN, PERIOD_PRESETS, monthCount,
} from "./period/period-range";
import { rijenInPeriode, kanaalMaandRijen } from "./cross-channel/kanaal-maandrijen";
import { volleMaandenUitTellers } from "../components/dashboard/channel-performance";
import { today } from "./reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const wortel = join(import.meta.dirname, "..");
const lees = (pad: string) => readFileSync(join(wortel, pad), "utf8");
const zonderCommentaar = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── De korte periode ───────────────────────────────────────────────────────────────────────────
console.log("formatRangeKort");
{
  check("binnen één jaar: het jaar één keer", formatRangeKort({ start: "2026-06", end: "2026-08" }) === "jun–aug 2026", formatRangeKort({ start: "2026-06", end: "2026-08" }));
  check("over de jaargrens: beide jaren", formatRangeKort({ start: "2025-09", end: "2026-08" }) === "sep 2025–aug 2026");
  check("één maand", formatRangeKort({ start: "2026-08", end: "2026-08" }) === "aug 2026");
}

// ── Het label ──────────────────────────────────────────────────────────────────────────────────
console.log("Vensterlabel");
{
  const toon = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(PeriodProvider, { scope: "label", children: createElement(Vensterlabel, props as never) }));
  const tekst = (html: string) => html.replace(/<[^>]+>/g, "");
  // Zonder datastand en zonder bewaarde keuze: de laatste twaalf maanden op de kalender.
  const bereik = periodeOpEind("last_12m", null, vensterEindMaand(null));

  const periode = toon({ soort: "periode" });
  check("volgt periode, met de gekozen maanden", tekst(periode) === `volgt periode · ${formatRangeKort(bereik)}`, tekst(periode));
  check("vindbaar voor de meting", /data-venster="periode"/.test(periode));
  check("kaal: zonder de maanden, voor een kop die ze al toont", tekst(toon({ soort: "periode", kaal: true })) === "volgt periode");

  const jaar = toon({ soort: "jaar", jaar: 2026 });
  check("jaarblok, met het jaar", tekst(jaar) === "jaarblok · 2026" && /data-venster="jaar"/.test(jaar), tekst(jaar));
  check("zonder jaar: het lopende rapportagejaar", tekst(toon({ soort: "jaar" })) === `jaarblok · ${today().slice(0, 4)}`);
  check("een voorbehoud staat erbij", tekst(toon({ soort: "jaar", jaar: 2026, toevoeging: "weken rond de beurs" })) === "jaarblok · 2026 · weken rond de beurs");

  const vast = toon({ soort: "vast", venster: "laatste 28 dagen" });
  check("een eigen venster staat er eerlijk bij", tekst(vast) === "vast venster · laatste 28 dagen" && /data-venster="vast"/.test(vast), tekst(vast));
  check("de uitleg zegt dat het blok de periode niet volgt", /title="[^"]*volgt de gekozen periode niet/.test(vast) && /title="[^"]*volgt de gekozen periode niet/.test(jaar));
  check("alleen 'volgt periode' is gekleurd", /bg-brand-blue\/5/.test(periode) && !/bg-brand-blue\/5/.test(jaar) && !/bg-brand-blue\/5/.test(vast));

  // Buiten een provider: de standaardperiode, niet januari 1970 (dan was elk volgend blok leeg).
  const los = tekst(renderToStaticMarkup(createElement(Vensterlabel, { soort: "periode" })));
  check("buiten een provider geldt de standaardperiode", los === `volgt periode · ${formatRangeKort(bereik)}` && !los.includes("1970"), los);

  const deel = renderToStaticMarkup(createElement(Deelkop, { titel: "Jaaroverzicht", bijschrift: "Jaardoelen", venster: createElement(Vensterlabel, { soort: "jaar", jaar: 2026 }) }));
  check("een Deelkop is een h3 met titel, bijschrift en het label", /<h3[^>]*>Jaaroverzicht<span[^>]*data-venster="jaar"/.test(deel) && deel.includes("Jaardoelen"), deel);
}

// ── De snelkoppelingen zijn de bestaande presets ───────────────────────────────────────────────
console.log("Snelkoppelingen 3, 6 en 12 maanden");
{
  check("drie knoppen: 3, 6 en 12 maanden", SNELKOPPELINGEN.map((k) => k.kort).join() === "3 mnd,6 mnd,12 mnd");
  check("het zijn bestaande presets, geen tweede model", SNELKOPPELINGEN.every((k) => (PERIOD_PRESETS as readonly string[]).includes(k.preset) && k.preset !== "custom"));
  const eind = vensterEindMaand("2026-08", "2026-11");
  check("ze eindigen op de laatste volle maand met data, net als de presets in het paneel",
    SNELKOPPELINGEN.every((k) => periodeOpEind(k.preset, null, eind).end === "2026-08")
    && SNELKOPPELINGEN.map((k) => monthCount(periodeOpEind(k.preset, null, eind))).join() === "3,6,12");
}

// ── Volgen: dezelfde rijen, andere maanden ─────────────────────────────────────────────────────
console.log("De blokken die de periode volgen, rekenen op de maanden van de periode");
{
  const maanden = (kanaal: "google" | "meta", van: string, n: number, spend: number) => ({
    kanaal, vanaf: null,
    maanden: Array.from({ length: n }, (_, i) => ({ month: addMonths(van, i), conversions: 10, revenue: 0, adSpend: spend, impressions: 100, clicks: 10 })),
  });
  // Google twaalf maanden t/m augustus 2026, Meta de laatste vier.
  const rijen = kanaalMaandRijen([maanden("google", "2025-09", 12, 100), maanden("meta", "2026-05", 4, 40)]);
  const som = (p: { start: string; end: string }) => rijenInPeriode(rijen, p).reduce((t, r) => t + r.spend, 0);
  check("twaalf maanden", som({ start: "2025-09", end: "2026-08" }) === 12 * 100 + 4 * 40);
  check("drie maanden: een ander totaal uit dezelfde rijen", som({ start: "2026-06", end: "2026-08" }) === 3 * 100 + 3 * 40);
  check("zes maanden: Meta telt alleen de maanden dat het liep", som({ start: "2026-03", end: "2026-08" }) === 6 * 100 + 4 * 40);
  check("een periode vóór de data: niets, geen fout", som({ start: "2024-01", end: "2024-12" }) === 0);

  // De maandtabel van een kanaaltab.
  const tellers = maanden("meta", "2025-09", 12, 40).maanden;
  const zes = volleMaandenUitTellers(tellers, "2026-09");
  check("zonder periode: de laatste zes volle maanden (de beurs-scope)", zes.length === 6 && zes[0][0] === "2026-03" && zes[5][0] === "2026-08", zes.map(([m]) => m).join());
  const drie = volleMaandenUitTellers(tellers, "2026-09", { start: "2026-06", end: "2026-08" });
  check("met periode: precies die maanden", drie.map(([m]) => m).join() === "2026-06,2026-07,2026-08", drie.map(([m]) => m).join());
  const twaalf = volleMaandenUitTellers(tellers, "2026-09", { start: "2025-09", end: "2026-08" });
  check("een langere periode geeft meer dan zes rijen", twaalf.length === 12);
  check("de lopende maand valt er altijd buiten", volleMaandenUitTellers(tellers, "2026-08", { start: "2026-06", end: "2026-08" }).map(([m]) => m).join() === "2026-06,2026-07");
}

// ── Bron: elk blok draagt een label ────────────────────────────────────────────────────────────
//
// Per weergave: elk component dat in de Overzicht-functie staat, is óf een blok met een label
// (GELABELD: het bestand waar het Vensterlabel in staat), óf bekend als iets zonder eigen cijfers
// of met het label op een andere plek (ZONDER, met de reden). Een nieuw component dat in geen van
// beide staat, laat deze test falen: dan is er een blok bijgekomen zonder dat iemand zijn venster
// heeft benoemd.
console.log("Bron: elk blok op het Overzicht draagt een Vensterlabel");
const GELABELD: Record<string, string> = {
  HealthBadge: "health-badge.tsx",
  ChannelHealthBadge: "channel-health-badge.tsx",
  KanaalHealthRanking: "kanaal-health-ranking.tsx",
  PacingMonitor: "pacing-monitor.tsx",
  ChannelPacing: "channel-pacing.tsx",
  BlendedPacing: "blended-pacing.tsx",
  GeoMapCard: "geo-map-card.tsx",
  GeoRanglijstCard: "geo-ranglijst-card.tsx",
  MonthlyOverview: "monthly-overview.tsx",
  FairWeeksOverview: "fair-weeks-overview.tsx",
  FairWeeksView: "fair-weeks-overview.tsx",
  ChannelFairWeeks: "fair-weeks-overview.tsx", // rendert FairWeeksView
  PerformanceChart: "performance-chart.tsx",
  PerformanceChartView: "performance-chart.tsx",
  ChannelForecastOverview: "channel-forecast-overview.tsx",
  VideoPerformance: "video-performance.tsx",
  VideoPlacements: "video-placements.tsx",
  ChannelVideoPerformance: "channel-video-performance.tsx",
  BreakdownDonuts: "breakdown-donuts.tsx",
  EventPacing: "event-pacing.tsx",
  GeoCloneOverview: "geo-clone-overview.tsx",
  ChannelMonthlyChart: "channel-monthly-chart.tsx",
  ChannelPerformance: "channel-performance.tsx",
  CampaignTypeSplit: "campaign-type-split.tsx",
  MonthlyTrendLine: "monthly-trend-line.tsx",
  MonthlyTrendBars: "monthly-trend-bars.tsx",
};
const ZONDER: Record<string, string> = {
  Sectie: "de sectie zelf", Deelkop: "een kop binnen een sectie", Vensterlabel: "het label",
  ChannelViewHeader: "uitleg en koppelstatus, geen cijfers", ChannelDataProvider: "een provider",
  TijdasKeuze: "een keuzeknop", GeoRanglijstInKaart: "staat ín de wereldkaart, onder diens label",
  GeoChannelMatrix: "staat ín de wereldkaart, zelfde 180 dagen",
  MetricCards: "vier tegels onder de Deelkop Jaaroverzicht, die het label draagt",
  MetricCardsView: "vier tegels onder de Deelkop Jaaroverzicht, die het label draagt",
  GroupedMonthlyBars: "krijgt zijn label van de aanroeper (prop venster)",
  // De kanaaltabel op Alle kanalen: het label staat in de sectiekop erboven.
  Tabel: "kanaaltabel", Kop: "kanaaltabel", KolomKop: "kanaaltabel", Body: "kanaaltabel", Rij: "kanaaltabel",
  NaamCel: "kanaaltabel", GetalCel: "kanaaltabel", AandeelCel: "kanaaltabel", TotaalRij: "kanaaltabel", TotaalCel: "kanaaltabel",
  RegioToggle: "kanaaltabel",
};
const ICOON = /^(Calendar|CalendarClock|Target|Globe|LayoutGrid|TrendingUp|Sparkles|AlertTriangle|Users|Gauge|SearchIcon|Search|Megaphone|Briefcase|PieChart|Info|Layers|Loader2)$/;

/** De bron van één geëxporteerde functie: van zijn kop tot de eerstvolgende functie op kolom 0. */
function functieBron(bestand: string, naam: string): string {
  const s = lees(`components/dashboard/${bestand}`);
  const a = s.indexOf(`export function ${naam}(`);
  if (a < 0) return "";
  const rest = s.slice(a + 10);
  const b = rest.search(/\n(export )?(function|const|interface|type) /);
  return zonderCommentaar(b < 0 ? rest : rest.slice(0, b));
}
const WEERGAVEN: [string, string][] = [
  ["google-view.tsx", "GoogleView"], ["meta-view.tsx", "MetaView"], ["linkedin-view.tsx", "LinkedInView"],
  ["microsoft-view.tsx", "MicrosoftView"], ["cross-channel-view.tsx", "CrossChannelView"],
];
{
  for (const [bestand, naam] of WEERGAVEN) {
    const bron = functieBron(bestand, naam);
    check(`${naam}: de functie is gevonden`, bron.length > 500, String(bron.length));
    // Alleen JSX-tags: een hoofdletter direct na "<" aan het begin van een element, geen generieke
    // typeparameter (useState<ForecastMetric>).
    const tags = [...new Set([...bron.matchAll(/(?<![A-Za-z0-9_)\]])<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
    const onbekend = tags.filter((t) => !(t in GELABELD) && !(t in ZONDER) && !ICOON.test(t));
    check(`${naam}: geen blok zonder benoemd venster`, onbekend.length === 0, onbekend.join(", "));
  }
  const bestanden = [...new Set(Object.values(GELABELD))];
  const zonderLabel = bestanden.filter((b) => !/<Vensterlabel\b/.test(zonderCommentaar(lees(`components/dashboard/${b}`))));
  check(`alle ${bestanden.length} blokbestanden renderen een Vensterlabel`, zonderLabel.length === 0, zonderLabel.join(", "));
  check("de KPI-band ook (kaal: de periode staat er al voluit)", /<Vensterlabel soort="periode" kaal \/>/.test(lees("components/dashboard/period-summary.tsx")));
  check("de kanaaltabel draagt het label in zijn sectiekop",
    /titel="Cross-channel \(blended\)"[\s\S]{0,260}actie=\{<Vensterlabel soort="periode" \/>\}/.test(zonderCommentaar(lees("components/dashboard/cross-channel-view.tsx"))));
  // De losse vensterteksten die er stonden zijn opgegaan in het label.
  const los = ["monthly-trend-line.tsx", "monthly-trend-bars.tsx", "breakdown-donuts.tsx"]
    .filter((b) => />laatste (6 maanden|60 dagen)<\/span>/.test(lees(`components/dashboard/${b}`)));
  check("geen los vensterbijschrift meer naast het label", los.length === 0, los.join(", "));
}

// ── Bron: welke blokken de periode volgen ──────────────────────────────────────────────────────
console.log("Bron: de blokken die de periode volgen");
{
  const volgt: [string, RegExp][] = [
    ["cross-channel-view.tsx", /rijenInPeriode\(rows, \{ start: periodeStart, end: periodeEind \}\)/],
    ["campaign-type-split.tsx", /rijenInPeriode\(bron, \{ start: periodeStart, end: periodeEind \}\)/],
    ["monthly-trend-line.tsx", /slicePeriod\(clientData, \{ start: periodeStart, end: periodeEind \}\)/],
    ["monthly-trend-bars.tsx", /slicePeriod\(clientData, \{ start: periodeStart, end: periodeEind \}\)/],
    ["channel-monthly-chart.tsx", /m\.month\.slice\(0, 7\) >= periodeStart && m\.month\.slice\(0, 7\) <= periodeEind/],
    ["channel-performance.tsx", /volleMaandenUitTellers\(maanden, curMonth, \{ start: periodeStart, end: periodeEind \}\)/],
  ];
  for (const [bestand, patroon] of volgt) {
    const bron = zonderCommentaar(lees(`components/dashboard/${bestand}`));
    check(`${bestand}: leest de periode en filtert erop`, /usePeriod\(\)/.test(bron) && patroon.test(bron));
    check(`${bestand}: en zegt dat in zijn kop`, /<Vensterlabel soort="periode"/.test(bron));
  }
  const cross = zonderCommentaar(lees("components/dashboard/cross-channel-view.tsx"));
  check("Alle kanalen: geen eigen venster van zes maanden meer", !/RECENT_MONTHS/.test(cross) && !/slice\(-6\)/.test(cross));
  check("de kanaaltabel telt de rijen van de periode", /const rows = rijenPeriode;/.test(cross));
  check("een lege periode laat de blokken staan, met uitleg", /chartMonths\.length === 0 \?/.test(cross) && /rijenPeriode\.length === 0 &&/.test(cross));
  // Een blok dat de periode volgt, mag geen vast label dragen, en andersom.
  const ms = zonderCommentaar(lees("components/dashboard/channel-performance.tsx"));
  check("de kerncijfers over 28 dagen zeggen dat eerlijk", /<Vensterlabel soort="vast" venster="laatste 28 dagen" \/>/.test(ms));
  check("met een beurs-scope houdt de maandtabel zes maanden, en zegt dat", /geoClone \? <Vensterlabel soort="vast" venster="laatste 6 maanden" \/> : <Vensterlabel soort="periode" \/>/.test(ms));
}

// ── Bron: de vaste vensters bij elkaar, de jaarblokken aaneen ─────────────────────────────────
console.log("Bron: de jaarblokken staan bij elkaar onder één kop");
{
  // Per weergave: de kop, dan in deze volgorde de jaarblokken, dan het einde van de sectie; en
  // daarbinnen geen enkel blok dat de periode volgt.
  const eisen: [string, string, string, string[], string[]][] = [
    ["google-view.tsx", "GoogleView", "Jaar, beurs en markten",
      ["<HealthBadge", "<PacingMonitor", "<GeoMapCard", "<GeoRanglijstCard", "<FairWeeksOverview", "Jaaroverzicht 2026", "<MetricCards", "<PerformanceChart"],
      ["<MonthlyTrendLine", "<MonthlyTrendBars", "<CampaignTypeSplit"]],
    ["meta-view.tsx", "MetaView", "Jaar, beurs en markten",
      ["<ChannelHealthBadge", "<ChannelPacing", "<GeoMapCard", "<GeoRanglijstCard", "<ChannelFairWeeks", "Jaaroverzicht 2026", "<ChannelForecastOverview"],
      ["<ChannelMonthlyChart", "<ChannelPerformance", "<BreakdownDonuts"]],
    ["linkedin-view.tsx", "LinkedInView", "Jaar, beurs en markten",
      ["<ChannelHealthBadge", "<ChannelPacing", "<GeoMapCard", "<GeoRanglijstCard", "<ChannelFairWeeks", "Jaaroverzicht 2026", "<ChannelForecastOverview"],
      ["<ChannelMonthlyChart", "<ChannelPerformance", "<BreakdownDonuts"]],
    ["microsoft-view.tsx", "MicrosoftView", "Jaar en beurs",
      ["<ChannelHealthBadge", "<ChannelPacing", "<ChannelFairWeeks", "titel=\"Jaaroverzicht\"", "<ChannelForecastOverview"],
      ["<ChannelMonthlyChart", "<ChannelPerformance"]],
    ["cross-channel-view.tsx", "CrossChannelView", "Jaar, beurs en markten",
      ["<KanaalHealthRanking", "<BlendedPacing", "<GeoMapCard", "<GeoRanglijstCard", "<FairWeeksView", "titel=\"Jaaroverzicht\"", "<MetricCardsView", "<PerformanceChartView"],
      ["<GroupedMonthlyBars", "<CampaignTypeSplit", "<Tabel"]],
  ];
  for (const [bestand, naam, titel, volgorde, volgers] of eisen) {
    const bron = functieBron(bestand, naam);
    const begin = bron.indexOf(`titel="${titel}"`);
    const eind = bron.indexOf("</Sectie>", begin);
    check(`${naam}: één sectie "${titel}"`, begin > 0 && eind > begin && bron.split(`titel="${titel}"`).length === 2);
    const sectie = bron.slice(begin, eind);
    const plekken = volgorde.map((v) => sectie.indexOf(v));
    check(`${naam}: de blokken met een vast venster staan erin, in volgorde`,
      plekken.every((p, i) => p >= 0 && (i === 0 || p > plekken[i - 1])), volgorde.map((v, i) => `${v}@${plekken[i]}`).join(" "));
    check(`${naam}: geen blok ertussen dat de periode volgt`, volgers.every((v) => !sectie.includes(v)), volgers.filter((v) => sectie.includes(v)).join(", "));
    check(`${naam}: de volgende blokken staan eronder`, volgers.every((v) => bron.indexOf(v, eind) > eind), volgers.filter((v) => bron.indexOf(v, eind) < 0).join(", "));
    // Wat een sectie was, is een deel met dezelfde titel: de beurs en het jaaroverzicht.
    check(`${naam}: de beurs en het jaaroverzicht zijn een Deelkop in die sectie`,
      (sectie.match(/<Deelkop/g) ?? []).length === 2 && sectie.includes("Prestaties richting de beurs") && /Jaaroverzicht/.test(sectie));
    check(`${naam}: het bijschrift van de beurs is gebleven`, sectie.includes("hoeveel weken zijn we van"));
  }
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
