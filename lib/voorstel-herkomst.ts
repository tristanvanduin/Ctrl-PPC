// Wat een voorstel in de goedkeuringswachtrij moet laten zien voordat iemand erover beslist: waar
// het vandaan komt in gewone taal, wanneer het gemaakt is en hoe oud het is.
//
// Een kaart toonde een rang, de interne bronnaam ("meta_biweekly", "cross_channel"), een ICE-totaal
// zonder delen en één zin. created_at werd opgehaald maar niet getoond: zeven voorstellen van 26
// augustus en 1 september zagen er op 13 november uit als van vandaag, terwijl de onderbouwing
// ("CPA van € 28") op cijfers van tien weken eerder stond.

const CADANS: Record<string, string> = {
  weekly: "wekelijkse analyse",
  biweekly: "tweewekelijkse analyse",
  monthly: "maandanalyse",
  signals: "signalen",
  kpi: "KPI-analyse",
  icp: "ICP-analyse",
  funnel: "funnelanalyse",
};
const KANAAL: Record<string, string> = { meta: "Meta", linkedin: "LinkedIn", microsoft: "Microsoft Ads", google: "Google Ads" };

/** "Meta, tweewekelijkse analyse" voor "meta_biweekly"; "Cross-channel analyse" voor "cross_channel". */
export function bronInGewoneTaal(bron: string | null | undefined): string {
  const s = (bron ?? "").trim().toLowerCase();
  if (!s) return "onbekende bron";
  if (s === "cross_channel") return "cross-channel analyse";
  if (s === "second_opinion") return "second opinion";
  const [kop, ...rest] = s.split("_");
  if (KANAAL[kop] && rest.length > 0) return `${KANAAL[kop]}, ${CADANS[rest.join("_")] ?? rest.join(" ")}`;
  if (CADANS[s]) return `Google Ads, ${CADANS[s]}`;
  return s.replace(/_/g, " ");
}

/** Na hoeveel dagen een voorstel als verouderd geldt: langer dan één maandcyclus. */
export const VEROUDERD_NA_DAGEN = 35;

export interface Ouderdom {
  /** "1 sep 2026" */
  datum: string;
  dagen: number;
  verouderd: boolean;
}

export function ouderdom(createdAt: string | null | undefined, nu: Date): Ouderdom | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  const dagen = Math.max(0, Math.floor((nu.getTime() - t) / 86_400_000));
  const datum = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(t)).replace(".", "");
  return { datum, dagen, verouderd: dagen > VEROUDERD_NA_DAGEN };
}
