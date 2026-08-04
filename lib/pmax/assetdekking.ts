/**
 * Assetdekking per PMax-assetgroep: heb je genoeg van elk type, en wat vindt Google ervan?
 *
 * ── WAAROM DIT ERBIJ HOORT ──────────────────────────────────────────────────
 *
 * De netwerkkaart ernaast zegt dat de kanaalverdeling geen knop is en dat je eromheen stuurt, met
 * assets als eerste lever. Die assets stonden vervolgens nergens op het scherm -- een verwijzing
 * naar iets wat er niet was.
 *
 * ── DE DATA IS FIJNER DAN DE EERSTE WEERGAVE ────────────────────────────────
 *
 * De sync slaat `asset_group_asset.field_type` op, en dat is Google's fijne veldtype: HEADLINE,
 * LONG_HEADLINE, DESCRIPTION, MARKETING_IMAGE (liggend), SQUARE_MARKETING_IMAGE (vierkant),
 * PORTRAIT_MARKETING_IMAGE (staand), LOGO, YOUTUBE_VIDEO. De eerste versie van dit bestand gooide
 * dat op drie hopen -- tekst, beeld, video -- en wierp daarmee precies weg waar je op stuurt: één
 * kop te weinig is een andere actie dan één afbeeldingsverhouding te weinig.
 *
 * ── DE MINIMA KOMEN VAN GOOGLE, NIET VAN ONS ────────────────────────────────
 *
 * Uit developers.google.com/google-ads/api/performance-max/asset-requirements, nagekeken augustus
 * 2026. Dit zijn harde eisen: een assetgroep die eronder zit is niet volledig serveerbaar.
 *
 *   HEADLINE                    min 3   max 15
 *   LONG_HEADLINE               min 1   max 5
 *   DESCRIPTION                 min 2   max 5
 *   MARKETING_IMAGE (1.91:1)    min 1   max 20
 *   SQUARE_MARKETING_IMAGE 1:1  min 1   max 20
 *   PORTRAIT_MARKETING_IMAGE    geen min, max 20
 *   LOGO (1:1)                  min 1   max 5
 *   YOUTUBE_VIDEO               geen min, max 15
 *
 * Een minimum van 0 is dus geen slordigheid maar een echt gegeven: staand beeld en video zijn
 * optioneel. Bij video is dat wel misleidend, en daarom staat hij er apart bij:
 *
 * ── WAAROM EEN ONTBREKENDE VIDEO TOCH WEEGT ─────────────────────────────────
 *
 * Lever je geen video aan, dan MAAKT GOOGLE ER ZELF EEN uit je beeld en koppen. Die staat er dus
 * wél, alleen niet een die jij hebt gemaakt, en zulke automatisch gegenereerde video's presteren
 * aantoonbaar slechter dan geproduceerd materiaal. YouTube is tegelijk een van de best
 * converterende plaatsingen binnen PMax. Een groep zonder eigen video draait daar dus mee met de
 * zwakste creatie die er te maken valt. Formeel optioneel, in de praktijk het duurste gat.
 *
 * ── ONBEOORDEELD IS GEEN ZWAK ───────────────────────────────────────────────
 *
 * Google labelt assets BEST / GOOD / LOW, maar ook PENDING en LEARNING zolang er te weinig
 * vertoningen zijn. Die laatste twee tellen hier NIET als zwak. Hetzelfde onderscheid als bij de
 * gezondheidsscore: ontbrekende kennis is geen slechte uitkomst. Een verse assetgroep zou anders
 * als verwaarloosd lezen op de dag dat hij live gaat.
 */

import { opsomming } from "@/lib/util/tekst";

/** Wat er per rij uit ads_pmax_asset_performance nodig is. */
export type AssetRegel = {
  asset_group_name?: string | null;
  asset_id?: string | null;
  /** Google's field_type; zie de kop. */
  asset_type?: string | null;
  performance_label?: string | null;
  /** Voor het kiezen van het meest recente label bij een asset die in meerdere maanden voorkomt. */
  month?: string | null;
};

export type Assettype =
  | "HEADLINE" | "LONG_HEADLINE" | "DESCRIPTION"
  | "MARKETING_IMAGE" | "SQUARE_MARKETING_IMAGE" | "PORTRAIT_MARKETING_IMAGE"
  | "LOGO" | "YOUTUBE_VIDEO";

/** De drie kolomgroepen boven de matrix. Zie de kop van components/dashboard/pmax-asset-coverage. */
export type Band = "tekst" | "beeld" | "merk";

export type Typeregel = {
  type: Assettype;
  /** Korte kolomkop. */
  label: string;
  band: Band;
  /** Wat er precies bedoeld wordt; komt in de uitleg-hover te staan. */
  uitleg: string;
  /**
   * Hoe je het ding noemt in een zin: "nog 1 kop en 1 beschrijving nodig".
   *
   * De kolomkop kan dat niet doen. Die is kort omdat er acht naast elkaar staan ("1.91:1", "Lang"),
   * en "nog 1 1.91:1 nodig" is geen Nederlands.
   */
  enkelvoud: string;
  meervoud: string;
  /** Google's minimum voor een serveerbare assetgroep. 0 = optioneel. */
  min: number;
  max: number;
};

/**
 * De types in de volgorde waarin ze getoond worden: eerst tekst, dan beeld, dan merk en video.
 * Dat is ook de volgorde waarin je een assetgroep opbouwt.
 */
export const TYPES: readonly Typeregel[] = [
  { type: "HEADLINE", label: "Kop", band: "tekst", enkelvoud: "kop", meervoud: "koppen",
    uitleg: "Korte koppen, maximaal 30 tekens. Google zet er drie naast elkaar in een advertentie, dus met minder dan drie kan hij niets combineren.", min: 3, max: 15 },
  { type: "LONG_HEADLINE", label: "Lang", band: "tekst", enkelvoud: "lange kop", meervoud: "lange koppen",
    uitleg: "Lange koppen, maximaal 90 tekens. Deze verschijnen op de plaatsingen waar ruimte is voor een hele zin.", min: 1, max: 5 },
  // "Beschr." en niet "Tekst": de band erboven heet al Tekst, en twee keer hetzelfde woord in twee
  // betekenissen boven elkaar laat de lezer denken dat de kolom de band is. Gemeten op het scherm,
  // niet bedacht -- in de eerste render stond "TEKST" pal boven "Tekst".
  { type: "DESCRIPTION", label: "Beschr.", band: "tekst", enkelvoud: "beschrijving", meervoud: "beschrijvingen",
    uitleg: "Beschrijvingen, maximaal 90 tekens. Minstens één moet korter zijn dan 60 tekens, anders vervalt hij op de smalle plaatsingen.", min: 2, max: 5 },
  { type: "MARKETING_IMAGE", label: "1.91:1", band: "beeld", enkelvoud: "liggend beeld", meervoud: "liggende beelden",
    uitleg: "Liggend beeld, minimaal 600×314 en aangeraden 1200×628. Dit is het formaat voor Display en Gmail.", min: 1, max: 20 },
  { type: "SQUARE_MARKETING_IMAGE", label: "1:1", band: "beeld", enkelvoud: "vierkant beeld", meervoud: "vierkante beelden",
    uitleg: "Vierkant beeld, minimaal 300×300 en aangeraden 1200×1200. Verplicht: zonder is de assetgroep niet serveerbaar.", min: 1, max: 20 },
  { type: "PORTRAIT_MARKETING_IMAGE", label: "4:5", band: "beeld", enkelvoud: "staand beeld", meervoud: "staande beelden",
    uitleg: "Staand beeld, aangeraden 960×1200. Google eist het niet, maar zonder mis je de staande plaatsingen in Discover en Shorts.", min: 0, max: 20 },
  { type: "LOGO", label: "Logo", band: "merk", enkelvoud: "logo", meervoud: "logo's",
    uitleg: "Vierkant logo, minimaal 128×128 en aangeraden 1200×1200. Een liggend logo (4:1) is optioneel maar geeft nettere plaatsingen.", min: 1, max: 5 },
  { type: "YOUTUBE_VIDEO", label: "Video", band: "merk", enkelvoud: "video", meervoud: "video's",
    uitleg: "Eigen YouTube-video van minimaal 10 seconden. Lever je er geen, dan maakt Google er zelf een uit je beeld en koppen — die draait wél mee op YouTube, maar presteert doorgaans slechter.", min: 0, max: 15 },
];

export const BANDEN: readonly { band: Band; label: string }[] = [
  { band: "tekst", label: "Tekst" },
  { band: "beeld", label: "Beeld" },
  { band: "merk", label: "Merk & video" },
];

const REGEL_PER_TYPE = new Map(TYPES.map((t) => [t.type, t]));

/** Labels die een oordeel dragen. De rest (PENDING, LEARNING, UNKNOWN) is nog niet beoordeeld. */
const BEOORDEELD = new Set(["BEST", "GOOD", "LOW"]);

export type Typedekking = {
  type: Assettype;
  aantal: number;
  /** Assets met label LOW. */
  zwak: number;
  /** Assets die Google nog niet beoordeeld heeft. Geen oordeel, dus ook geen slecht oordeel. */
  onbeoordeeld: number;
  /** Onder Google's minimum voor een serveerbare groep. */
  tekort: boolean;
};

export type Groepsdekking = {
  groep: string;
  perType: Typedekking[];
  /** Types onder het minimum. Dit is wat er gerepareerd moet worden. */
  tekorten: Assettype[];
  /** Geen eigen video. Formeel toegestaan, in de praktijk het duurste gat -- zie de kop. */
  zonderVideo: boolean;
  zwak: number;
  /**
   * Welk deel van de PMax-kosten door deze groep loopt, 0..1. Null als er geen kosten bekend zijn.
   *
   * ── WAAROM DIT ERBIJ HOORT ────────────────────────────────────────────────
   *
   * Een ontbrekende video in een groep die 2% van het budget draait, en dezelfde in een groep die
   * er 32% draait, zijn niet hetzelfde probleem. Zonder dit getal staan ze naast elkaar alsof ze
   * dat wel zijn, en kiest de lezer op naam of op toeval.
   *
   * Null en geen 0: geen kostenregel betekent niet dat de groep niets kost. Dat onderscheid is
   * hier al eerder misgegaan -- Number(null) is 0 en leest als een gemeten nul.
   */
  kostenAandeel: number | null;
  /**
   * Welk deel van de PMax-conversies door deze groep loopt, 0..1. Null als er niets te delen valt.
   *
   * Pas NAAST het kostenaandeel wordt een percentage een bevinding. "32% van de kosten" zegt niets
   * over goed of fout; "32% van de kosten en 11% van de conversies" is controlepunt 47 uit de
   * second opinion -- een assetgroep die budget absorbeert zonder te leveren.
   */
  conversieAandeel: number | null;
};

export type Assetdekking = {
  groepen: Groepsdekking[];
  /**
   * Groepen met een tekort, geen video, of zwakke assets. Dit is wat er op het scherm hoort.
   *
   * Een account kan tientallen assetgroepen hebben. Ze allemaal tonen maakt het blok onbegrensd
   * hoog en zet de lezer aan het zoeken naar de ene die ertoe doet.
   */
  aandacht: Groepsdekking[];
  /** Hoeveel groepen niets mankeren. Alleen het aantal; zie hierboven. */
  compleet: number;
  zonderVideo: string[];
  tekortTotaal: number;
  zwakTotaal: number;
};

/**
 * Google's veldtypen naar de acht die we tonen.
 *
 * De API levert per plek een andere schrijfwijze, en oudere rijen dragen nog de grove waarden
 * ("TEXT", "IMAGE") uit de eerste versie van de sync. Die worden op de meest waarschijnlijke
 * fijne soort gezet in plaats van weggegooid -- een rij verliezen is erger dan hem iets te ruim
 * plaatsen, want dan meldt de kaart een tekort dat er niet is.
 */
function normaliseerType(waarde: unknown): Assettype | null {
  const t = String(waarde ?? "").toUpperCase().trim();
  if (!t) return null;
  if (REGEL_PER_TYPE.has(t as Assettype)) return t as Assettype;
  if (t === "VIDEO") return "YOUTUBE_VIDEO";
  if (t === "LANDSCAPE_LOGO") return "LOGO";
  if (t === "IMAGE" || t === "MARKETING_IMAGE_LANDSCAPE") return "MARKETING_IMAGE";
  if (t === "TEXT") return "HEADLINE";
  return null;
}

/**
 * Kosten en conversies per assetgroep over hetzelfde venster, om de aandelen mee te bepalen.
 *
 * Optioneel: zonder deze tabel werkt de kaart gewoon, alleen zonder de aandelen. Een lege map en
 * een ontbrekende map zijn daarom hetzelfde geval, en allebei geven ze null en geen 0.
 */
export type Groepscijfers = Readonly<Record<string, { kosten: number; conversies: number }>>;

/** Alleen positieve, eindige getallen tellen mee in een totaal. De rest is geen meting. */
function bruikbaar(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function analyseerAssetdekking(
  regels: readonly AssetRegel[],
  cijfers?: Groepscijfers,
): Assetdekking {
  // Per asset één regel: een asset komt in elke maand terug, en dan zou hij twaalf keer meetellen
  // en zou elke groep ruim boven het minimum lijken te zitten. Het meest recente label wint, want
  // dat is het oordeel van nu.
  const perAsset = new Map<string, { groep: string; type: Assettype; label: string; month: string }>();

  for (const r of regels) {
    const type = normaliseerType(r.asset_type);
    if (type === null) continue;
    const groep = String(r.asset_group_name ?? "").trim();
    if (!groep) continue;
    const id = String(r.asset_id ?? `${groep}|${type}|${r.performance_label ?? ""}`);
    const month = String(r.month ?? "");
    const bestaand = perAsset.get(id);
    if (bestaand && bestaand.month >= month) continue;
    perAsset.set(id, { groep, type, label: String(r.performance_label ?? "").toUpperCase().trim(), month });
  }

  const perGroep = new Map<string, Map<Assettype, { aantal: number; zwak: number; onbeoordeeld: number }>>();
  for (const a of perAsset.values()) {
    if (!perGroep.has(a.groep)) perGroep.set(a.groep, new Map());
    const g = perGroep.get(a.groep)!;
    const t = g.get(a.type) ?? { aantal: 0, zwak: 0, onbeoordeeld: 0 };
    t.aantal += 1;
    if (a.label === "LOW") t.zwak += 1;
    else if (!BEOORDEELD.has(a.label)) t.onbeoordeeld += 1;
    g.set(a.type, t);
  }

  // De totalen lopen over ALLE bekende regels, ook die van groepen zonder assets in dit venster.
  // Zouden ze alleen over de getoonde groepen lopen, dan telden de aandelen naar 100% op terwijl
  // er budget buiten beeld staat -- een percentage dat kloppend lijkt en het niet is.
  const alle = cijfers ? Object.values(cijfers) : [];
  const kostenTotaal = alle.reduce((s, v) => s + bruikbaar(v?.kosten), 0);
  const conversieTotaal = alle.reduce((s, v) => s + bruikbaar(v?.conversies), 0);

  const groepen: Groepsdekking[] = [...perGroep.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "nl"))
    .map(([groep, tellingen]) => {
      const perType: Typedekking[] = TYPES.map((regel) => {
        const t = tellingen.get(regel.type) ?? { aantal: 0, zwak: 0, onbeoordeeld: 0 };
        return { type: regel.type, aantal: t.aantal, zwak: t.zwak, onbeoordeeld: t.onbeoordeeld, tekort: t.aantal < regel.min };
      });
      const eigen = cijfers?.[groep];
      return {
        groep,
        perType,
        tekorten: perType.filter((t) => t.tekort).map((t) => t.type),
        zonderVideo: (tellingen.get("YOUTUBE_VIDEO")?.aantal ?? 0) === 0,
        zwak: perType.reduce((s, t) => s + t.zwak, 0),
        kostenAandeel: kostenTotaal > 0 && eigen !== undefined ? bruikbaar(eigen.kosten) / kostenTotaal : null,
        // Bij nul conversies in het hele account is er geen verdeling om een aandeel van te nemen.
        // Zou dat 0 worden, dan absorbeert volgens de regel hieronder ELKE groep budget -- terwijl
        // het enige dat er aan de hand is, is dat er nog niets geconverteerd heeft.
        conversieAandeel: conversieTotaal > 0 && eigen !== undefined ? bruikbaar(eigen.conversies) / conversieTotaal : null,
      };
    });

  const zonderVideo = groepen.filter((g) => g.zonderVideo).map((g) => g.groep);
  const tekortTotaal = groepen.filter((g) => g.tekorten.length > 0).length;
  const zwakTotaal = groepen.reduce((s, g) => s + g.zwak, 0);

  // Aandacht eerst, en binnen aandacht: een tekort onder Google's minimum bovenaan (dan is de
  // groep niet volledig serveerbaar), daarna een ontbrekende video, daarna zwakke assets.
  //
  // Bij gelijke ernst wint het geld. Twee groepen die allebei hun video missen zijn niet even
  // dringend als de een 32% van het budget draait en de ander 2%; op naam sorteren zou de lezer
  // op alfabet laten kiezen. Zonder kostendata valt hij terug op naam -- dat is stabiel, en een
  // stabiele volgorde is het minste wat een lijst moet doen.
  const aandacht = groepen
    .filter((g) => g.tekorten.length > 0 || g.zonderVideo || g.zwak > 0)
    .sort((a, b) => {
      if ((a.tekorten.length > 0) !== (b.tekorten.length > 0)) return a.tekorten.length > 0 ? -1 : 1;
      if (a.zonderVideo !== b.zonderVideo) return a.zonderVideo ? -1 : 1;
      if (a.zwak !== b.zwak) return b.zwak - a.zwak;
      if (a.kostenAandeel !== b.kostenAandeel) return (b.kostenAandeel ?? -1) - (a.kostenAandeel ?? -1);
      return a.groep.localeCompare(b.groep, "nl");
    });

  return {
    groepen,
    aandacht,
    compleet: groepen.length - aandacht.length,
    zonderVideo,
    tekortTotaal,
    zwakTotaal,
  };
}

/**
 * Wanneer een assetgroep budget absorbeert zonder te leveren.
 *
 * ── WAAROM DEZE TWEE DREMPELS ───────────────────────────────────────────────
 *
 * Een percentage op zichzelf is geen bevinding. "32% van de kosten" is even goed het teken van de
 * best draaiende groep als van de slechtste; pas naast het conversie-aandeel zegt het iets.
 *
 * FACTOR 2 -- het kostenaandeel minstens twee keer het conversie-aandeel. Assetgroepen lopen altijd
 * uiteen; een groep die 30% kost en 25% levert is normaal en verdient geen melding. Verdubbeling is
 * de grens waarboven het geen ruis meer kan zijn.
 *
 * MINSTENS 15% VAN HET BUDGET -- een groep die 3% kost en 1% levert voldoet aan de factor, maar
 * daar valt niets te halen. Zonder deze tweede drempel meldt de kaart elke kleine groep en leert
 * de lezer de melding over te slaan.
 *
 * Dit is controlepunt 47 uit de second opinion ("asset groups die budget absorberen zonder
 * conversies"), maar dan op het scherm waar de assets van die groep staan -- want dat is meestal
 * ook waar de oorzaak zit.
 */
export const ABSORBEERT_FACTOR = 2;
export const ABSORBEERT_MIN_KOSTEN = 0.15;

export function absorbeertBudget(g: Groepsdekking): boolean {
  if (g.kostenAandeel === null || g.conversieAandeel === null) return false;
  if (g.kostenAandeel < ABSORBEERT_MIN_KOSTEN) return false;
  return g.kostenAandeel >= g.conversieAandeel * ABSORBEERT_FACTOR;
}

/**
 * Wat er aan deze groep te doen valt, in één regel naast de naam.
 *
 * ── WAAROM DIT NAAST DE RIJ STAAT EN NIET BOVEN DE TABEL ────────────────────
 *
 * De matrix toont acht getallen per groep. Die getallen zeggen wat er IS; ze zeggen niet wat je
 * moet doen, en om dat eruit te lezen moet je acht cellen tegen acht minima houden die je uit je
 * hoofd moet kennen. Een alinea boven de tabel lost dat niet op: die geldt voor alle groepen
 * tegelijk en dus voor geen enkele in het bijzonder.
 *
 * Deze regel staat naast de naam van de groep waar hij over gaat, en hij is er alleen als er iets
 * te doen is. Bij een groep zonder gebrek staat er niets -- dat is de ruimte waard.
 *
 * Video verschijnt hier als "geen eigen video" en niet als tekort, want Google eist hem niet; het
 * waarom staat in de uitleg-hover bij de kolom. Zonder dat onderscheid meldt de kaart een
 * overtreding die niet bestaat, en leert de lezer de melding negeren.
 */
export function groepsactie(g: Groepsdekking): string | null {
  const delen: string[] = [];

  const tekorten = g.perType.filter((t) => t.tekort);
  if (tekorten.length > 0) {
    const stukken = tekorten.map((t) => {
      const regel = REGEL_PER_TYPE.get(t.type)!;
      const nodig = regel.min - t.aantal;
      return `${nodig} ${nodig === 1 ? regel.enkelvoud : regel.meervoud}`;
    });
    // "1 kop tekort" en niet "nog 1 kop nodig": vier tekens korter per onderdeel, en op het scherm
    // was dat het verschil tussen de hele regel en "... 3 met het label l...". Kort omdat de ruimte
    // het vraagt, niet omdat het mooier staat -- een afgekapte instructie is geen instructie.
    delen.push(`${opsomming(stukken)} tekort`);
  }

  if (g.zonderVideo) delen.push("geen eigen video");
  // "zwakke assets" en niet "label laag": dat laatste is Google's term voor het veld, niet voor
  // wat er aan de hand is. Wie de kaart voor het eerst ziet moet niet eerst leren wat een label is.
  if (g.zwak > 0) delen.push(`${g.zwak} zwakke asset${g.zwak === 1 ? "" : "s"}`);

  return delen.length > 0 ? delen.join(" · ") : null;
}
