/**
 * Welke assetgroepen missen een asset-type, en welke assets noemt Google zwak?
 *
 * ── WAAROM DIT ERBIJ HOORT ──────────────────────────────────────────────────
 *
 * De netwerkkaart ernaast zegt dat de verdeling geen knop is en dat je eromheen stuurt, met assets
 * als eerste lever. Die assets stonden vervolgens nergens op het scherm -- een verwijzing naar iets
 * wat er niet was.
 *
 * ── WAAROM EEN ONTBREKENDE VIDEO ZWAARDER WEEGT DAN EEN ONTBREKENDE AFBEELDING ──
 *
 * Levert je geen video aan, dan maakt Google er zelf een uit je afbeeldingen en koppen. Die staat
 * er dus wél, alleen niet een die jij hebt gemaakt, en zulke automatisch gegenereerde video's
 * presteren aantoonbaar slechter dan geproduceerd materiaal. YouTube is tegelijk een van de best
 * converterende plaatsingen binnen PMax. Een groep zonder eigen video draait daar dus mee met de
 * zwakste creatie die er te maken valt.
 *
 * Bij tekst en beeld ligt dat anders: die zijn verplicht bij het aanmaken, dus een groep zonder
 * afbeelding bestaat in de praktijk niet. Vandaar dat de video het gat is dat gemeld wordt.
 *
 * Nagekeken augustus 2026 op de actuele Google-documentatie. PMax verandert per kwartaal.
 *
 * ── ONBEOORDEELD IS GEEN ZWAK ───────────────────────────────────────────────
 *
 * Google labelt assets BEST / GOOD / LOW, maar ook PENDING en LEARNING zolang er te weinig
 * vertoningen zijn. Die laatste twee tellen hier NIET als zwak. Hetzelfde onderscheid als bij de
 * gezondheidsscore: ontbrekende kennis is geen slechte uitkomst. Een verse assetgroep zou anders
 * als verwaarloosd lezen op de dag dat hij live gaat.
 */

/** Wat er per rij uit ads_pmax_asset_performance nodig is. */
export type AssetRegel = {
  asset_group_name?: string | null;
  asset_id?: string | null;
  asset_type?: string | null;
  performance_label?: string | null;
  /** Voor het kiezen van het meest recente label bij een asset die in meerdere maanden voorkomt. */
  month?: string | null;
};

export type Assettype = "TEXT" | "IMAGE" | "YOUTUBE_VIDEO";

/**
 * De types die een complete assetgroep hoort te hebben, in de volgorde waarin ze getoond worden.
 * Video achteraan, want dat is het type dat ontbreekt en dus het oog moet vangen aan het eind.
 */
export const VERWACHTE_TYPES: readonly Assettype[] = ["TEXT", "IMAGE", "YOUTUBE_VIDEO"];

export const TYPE_LABEL: Record<Assettype, string> = {
  TEXT: "Tekst",
  IMAGE: "Beeld",
  YOUTUBE_VIDEO: "Video",
};

/** Labels die een oordeel dragen. De rest (PENDING, LEARNING, UNKNOWN) is nog niet beoordeeld. */
const BEOORDEELD = new Set(["BEST", "GOOD", "LOW"]);

export type Typedekking = {
  type: Assettype;
  aantal: number;
  /** Assets met label LOW. */
  zwak: number;
  /** Assets die Google nog niet beoordeeld heeft. Geen oordeel, dus ook geen slecht oordeel. */
  onbeoordeeld: number;
};

export type Groepsdekking = {
  groep: string;
  perType: Typedekking[];
  /** Types met nul assets. */
  ontbrekend: Assettype[];
  /** Totaal aantal assets met label LOW in deze groep. */
  zwak: number;
};

export type Assetdekking = {
  groepen: Groepsdekking[];
  /** Groepen zonder eigen video. Het gat dat ertoe doet; zie de kop van dit bestand. */
  zonderVideo: string[];
  zwakTotaal: number;
  /** Null als er niets te melden valt -- dan hoort er geen zin te staan. */
  samenvatting: string | null;
};

function normaliseerType(waarde: unknown): Assettype | null {
  const t = String(waarde ?? "").toUpperCase().trim();
  // VIDEO en YOUTUBE_VIDEO komen allebei voor, afhankelijk van het API-veld. Beide zijn video.
  if (t === "YOUTUBE_VIDEO" || t === "VIDEO") return "YOUTUBE_VIDEO";
  if (t === "IMAGE" || t === "MARKETING_IMAGE" || t === "SQUARE_MARKETING_IMAGE" || t === "LOGO") return "IMAGE";
  // Alle tekstvormen op één hoop: koppen, lange koppen en beschrijvingen zijn voor deze vraag
  // hetzelfde -- het gaat erom óf er tekst is, niet welke soort.
  if (t === "TEXT" || t === "HEADLINE" || t === "LONG_HEADLINE" || t === "DESCRIPTION") return "TEXT";
  return null;
}

export function analyseerAssetdekking(regels: readonly AssetRegel[]): Assetdekking {
  // Per groep per asset één regel: een asset komt in elke maand terug, en dan zou hij twaalf keer
  // meetellen. Het meest recente label wint, want dat is het oordeel van nu.
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

  // Groepen alfabetisch: de volgorde waarin ze binnenkomen is die van de database en verandert
  // met de sync. Een lijst die van volgorde wisselt zonder dat er iets veranderde, leest als ruis.
  const groepen: Groepsdekking[] = [...perGroep.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "nl"))
    .map(([groep, tellingen]) => {
      const perType = VERWACHTE_TYPES.map((type) => {
        const t = tellingen.get(type) ?? { aantal: 0, zwak: 0, onbeoordeeld: 0 };
        return { type, aantal: t.aantal, zwak: t.zwak, onbeoordeeld: t.onbeoordeeld };
      });
      return {
        groep,
        perType,
        ontbrekend: perType.filter((t) => t.aantal === 0).map((t) => t.type),
        zwak: perType.reduce((s, t) => s + t.zwak, 0),
      };
    });

  const zonderVideo = groepen
    .filter((g) => g.ontbrekend.includes("YOUTUBE_VIDEO"))
    .map((g) => g.groep);
  const zwakTotaal = groepen.reduce((s, g) => s + g.zwak, 0);

  return { groepen, zonderVideo, zwakTotaal, samenvatting: bouwSamenvatting(zonderVideo, zwakTotaal) };
}

/**
 * De zin bovenaan, of null als er niets te melden is.
 *
 * Null en geen "alles in orde": een blok dat altijd een zin toont leert de lezer die zin over te
 * slaan. Staat er niets, dan is de dekking compleet en zeggen de tellingen dat zelf al.
 */
function bouwSamenvatting(zonderVideo: readonly string[], zwak: number): string | null {
  const delen: string[] = [];
  if (zonderVideo.length > 0) {
    delen.push(
      zonderVideo.length === 1
        ? `Eén assetgroep heeft geen eigen video. Google maakt er dan zelf een uit je beeld en tekst, en die presteert doorgaans slechter — terwijl YouTube juist een van de sterkste plaatsingen binnen PMax is.`
        : `${zonderVideo.length} assetgroepen hebben geen eigen video. Google maakt er dan zelf een uit je beeld en tekst, en die presteert doorgaans slechter — terwijl YouTube juist een van de sterkste plaatsingen binnen PMax is.`
    );
  }
  if (zwak > 0) {
    delen.push(`${zwak} asset${zwak === 1 ? "" : "s"} met het label "laag" — vervangen kost minder dan een nieuwe groep bouwen.`);
  }
  return delen.length > 0 ? delen.join(" ") : null;
}
