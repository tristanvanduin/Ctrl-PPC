// De conversietrechter na de klik: welke stappen een klant meet (product bekeken, winkelwagen,
// afrekenen, aankoop; of formulier geopend, verzonden), welke bron per kanaal bij welke stap hoort,
// en wat die stappen over een periode per dag tellen. Zuiver en zonder React, zodat
// lib/overzicht/__conversiestappen_test.ts het zonder pagina kan toetsen.
//
// WAAR DE STAPPEN VANDAAN KOMEN
//
// - Meta per dag: landing_page_views, add_to_cart, initiate_checkout, conversions en leads
//   (meta_account_daily). De landingspagina is een vaste stap direct na de klik: Meta meet hem zelf,
//   voor elke klant, en hij hoort in geen enkel sjabloon bij een andere stap.
// - LinkedIn per dag: one_click_lead_form_opens en one_click_leads (linkedin_account_daily), plus de
//   websiteconversies.
// - Microsoft: alleen conversions. Een stap daarvoor kan, maar meer stappen meet Microsoft niet.
// - Google: google_ads_checkout_funnel_daily (migratie 111) als die de periode dekt; anders (geen
//   tabel, een lege tabel, of een periode van voor de eerste dagrij) de maandtabel
//   google_ads_checkout_funnel, en dan zegt de keten dat hij per maand telt. Beide hebben drie
//   vaste kolommen (add_to_cart_count, begin_checkout_count, purchase_count): winkelwagen,
//   afrekenen en aankoop. De sync vult elke kolom met de Google-acties die
//   client_settings.checkout_action_map ervoor noemt, en zonder die kaart met de acties die
//   letterlijk zo heten (getCheckoutFunnel in lib/api/google-ads.ts).
//
// WAAR DE KEUZE STAAT
//
// In client_settings.checkout_action_map, een bestaand jsonb-veld dat over precies dit gaat. Naast
// de drie posities (add_to_cart, begin_checkout, purchase, elk een lijst actienamen die de sync
// leest) staat daar `trechter`: het sjabloon en de stappen met per kanaal de gekozen bronnen.
//
// POSITIES OP BETEKENIS, NIET OP VOLGORDE. De sync schrijft de posities ook in de MAANDTABEL
// google_ads_checkout_funnel, en die leest de maandanalyse als winkelwagen, afrekenen en aankoop
// (lib/analysis/monthly-prepared-context.ts, de kolommen atc_to_checkout_rate e.d.). Een stap krijgt
// daarom alleen een positie als hij die betekenis HEEFT: de herkenning van de webshopstappen op de
// naam van de stap, en anders op zijn Google-acties (positieVanStap). "Product bekeken" of een
// formulierstap krijgt geen positie, en dan telt Google die stap niet. Een positie die geen stap
// dekt, houdt bij het opslaan wat er al stond (checkoutMapUit): een instelling uit de nieuwe
// weergave verandert de maandanalyse niet ongemerkt.
//
// ZOLANG ER NIETS GEKOZEN IS
//
// Herkenning op naam: per stap een regex over de sleutel en het label van elke bron
// (herkenStappen). Een bron hoort bij de eerste stap die hem herkent, zodat "leadformulier
// geopend" niet ook bij "verzonden" telt. Het sjabloon volgt het bedrijfsmodel als dat in
// client_settings staat (b2b: formulier, anders webshop). Een eigen keuze gaat altijd voor.
//
// NIET OPTELLEN OVER KANALEN. Elk platform rekent een aankoop zichzelf toe; dezelfde aankoop kan
// bij Google en bij Meta staan. Daarom staan de kanalen per stap naast elkaar (naDeKlikPerStap) en
// is er geen totaal.

import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import { delta } from "@/lib/period/apply-period";
import { alsMaandPeriode, dagIn, formatDag, formatDagPeriode, omhullendeMaanden, type DagPeriode } from "@/lib/period/dag-periode";
import { formatRange, monthsIn, type PeriodRange } from "@/lib/period/period-range";
import { safeDiv } from "@/lib/util/math";

// ── Sjablonen en bronnen ─────────────────────────────────────────────────────────────────────────

export type Sjabloon = "webshop" | "formulier" | "eigen";
export const SJABLOON_NAAM: Record<Sjabloon, string> = { webshop: "Webshop", formulier: "Formulier", eigen: "Eigen" };

export interface SjabloonStap { naam: string; herken: RegExp }

/** De stappen per sjabloon, met de herkenning op naam die geldt zolang er niets gekozen is. */
export const SJABLONEN: Record<Exclude<Sjabloon, "eigen">, readonly SjabloonStap[]> = {
  webshop: [
    // Een scheidingsteken mag: "add_to_cart", "AddToCart" en "Add to cart" zijn dezelfde actie.
    // Niet los "product": dan viel "Aankoop product" of "Product purchase" bij Product bekeken.
    { naam: "Product bekeken", herken: /view[ _-]?item|view[ _-]?content|product[ _-]?(bekeken|view)/i },
    { naam: "Winkelwagen", herken: /add[ _-]?to[ _-]?cart|winkelwagen/i },
    { naam: "Afrekenen", herken: /begin[ _-]?checkout|initiate[ _-]?checkout|checkout|afrekenen/i },
    // "aanko+p": zowel "aankoop" als "aankopen". Eerder stond hier "aankop", en dat herkende
    // "Aankoop" niet: "aankoop" bevat "aankop" niet.
    { naam: "Aankoop", herken: /purchase|aanko+p|ticket/i },
  ],
  formulier: [
    { naam: "Formulier geopend", herken: /lead[ _-]?form[ _-]?open|form[ _-]?start/i },
    { naam: "Formulier verzonden", herken: /lead|generate[ _-]?lead|submit|verzonden|bedankt/i },
  ],
};

/** Een bron die een stap kan tellen: een Google-conversieactie, of een kolom van een dagkanaal. */
export interface StapBron { kanaal: Kanaal; sleutel: string; label: string }

export type DagKanaal = Exclude<Kanaal, "google">;

/** De kolommen van de dagtabellen die een stap na de klik kunnen zijn. */
export const KANAAL_STAPVELDEN: Record<DagKanaal, readonly { sleutel: string; label: string }[]> = {
  meta: [
    { sleutel: "add_to_cart", label: "Winkelwagen (AddToCart)" },
    { sleutel: "initiate_checkout", label: "Afrekenen gestart (InitiateCheckout)" },
    { sleutel: "conversions", label: "Aankopen en pixelconversies (Purchase)" },
    { sleutel: "leads", label: "Leads (Lead)" },
  ],
  linkedin: [
    { sleutel: "one_click_lead_form_opens", label: "Leadformulier geopend (lead_form_open)" },
    { sleutel: "one_click_leads", label: "Leadformulier verzonden" },
    { sleutel: "external_website_conversions", label: "Websiteconversies" },
  ],
  microsoft: [{ sleutel: "conversions", label: "Conversies (alle UET-doelen)" }],
};

/** De klikkolom per dagkanaal, zoals KANAAL_DAGBRON hem kent. */
export const KLIKVELD: Record<DagKanaal, string> = { meta: "link_clicks", linkedin: "clicks", microsoft: "clicks" };

/** Meta meet de landingspagina zelf: een vaste stap direct na de klik. */
export const META_LANDINGSPAGINA = { sleutel: "landing_page_views", naam: "Landingspagina bekeken" } as const;

/** De drie posities van de Google-checkouttabellen, met hun kolom. */
export const GOOGLE_POSITIES = [
  { positie: "add_to_cart", kolom: "add_to_cart_count" },
  { positie: "begin_checkout", kolom: "begin_checkout_count" },
  { positie: "purchase", kolom: "purchase_count" },
] as const;
export type GooglePositie = (typeof GOOGLE_POSITIES)[number]["positie"];

type Rij = Record<string, unknown>;

const getal = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * De bronnen die bij deze klant echt voorkomen: de Google-acties uit client_settings.conversion_actions,
 * en per dagkanaal de kolommen die ergens in de rijen boven nul staan. Een kanaal zonder rijen
 * heeft geen bronnen.
 */
export function beschikbareBronnen(inp: {
  conversionActions?: unknown;
  rijen?: Partial<Record<DagKanaal, readonly Rij[] | null>>;
}): StapBron[] {
  const uit: StapBron[] = [];
  if (Array.isArray(inp.conversionActions)) {
    const gezien = new Set<string>();
    for (const a of inp.conversionActions) {
      const naam = a && typeof a === "object" ? (a as { name?: unknown }).name : null;
      if (typeof naam !== "string" || !naam.trim() || gezien.has(naam)) continue;
      gezien.add(naam);
      uit.push({ kanaal: "google", sleutel: naam, label: naam });
    }
  }
  for (const k of ["meta", "linkedin", "microsoft"] as const) {
    const rijen = inp.rijen?.[k];
    if (!rijen?.length) continue;
    for (const v of KANAAL_STAPVELDEN[k]) {
      if (rijen.some((r) => (getal(r[v.sleutel]) ?? 0) > 0)) uit.push({ kanaal: k, sleutel: v.sleutel, label: v.label });
    }
  }
  return uit;
}

// ── De instelling ────────────────────────────────────────────────────────────────────────────────

export interface StapInstelling {
  naam: string;
  /** Per kanaal de gekozen bronnen: Google-actienamen, of kolommen van de dagtabel. */
  bronnen: Partial<Record<Kanaal, string[]>>;
}

export interface TrechterInstelling {
  sjabloon: Sjabloon;
  stappen: StapInstelling[];
}

/** Het sjabloon dat past bij het bedrijfsmodel: b2b is formulier, b2c of onbekend webshop. */
export function sjabloonVoorBedrijfsmodel(bedrijfsmodel: unknown): Exclude<Sjabloon, "eigen"> {
  return bedrijfsmodel === "b2b" ? "formulier" : "webshop";
}

/** De stappen van een sjabloon, met per stap de bronnen die de herkenning op naam erbij zet. */
export function herkenStappen(sjabloon: Exclude<Sjabloon, "eigen">, bronnen: readonly StapBron[]): StapInstelling[] {
  const def = SJABLONEN[sjabloon];
  const stappen: StapInstelling[] = def.map((s) => ({ naam: s.naam, bronnen: {} }));
  for (const b of bronnen) {
    const i = def.findIndex((s) => s.herken.test(`${b.sleutel} ${b.label}`));
    if (i < 0) continue;
    (stappen[i].bronnen[b.kanaal] ??= []).push(b.sleutel);
  }
  return stappen;
}

/** De opgeslagen keuze uit checkout_action_map.trechter, of null als die er niet (geldig) is. */
export function leesInstelling(checkoutActionMap: unknown): TrechterInstelling | null {
  const t = checkoutActionMap && typeof checkoutActionMap === "object"
    ? (checkoutActionMap as { trechter?: unknown }).trechter : null;
  if (!t || typeof t !== "object") return null;
  const { sjabloon, stappen } = t as { sjabloon?: unknown; stappen?: unknown };
  if (sjabloon !== "webshop" && sjabloon !== "formulier" && sjabloon !== "eigen") return null;
  if (!Array.isArray(stappen)) return null;
  const schoon: StapInstelling[] = [];
  for (const s of stappen) {
    if (!s || typeof s !== "object") continue;
    const naam = (s as { naam?: unknown }).naam;
    const ruw = (s as { bronnen?: unknown }).bronnen;
    if (typeof naam !== "string" || !naam.trim()) continue;
    const bronnen: StapInstelling["bronnen"] = {};
    if (ruw && typeof ruw === "object") {
      for (const k of ALLE_KANALEN) {
        const lijst = (ruw as Record<string, unknown>)[k];
        if (Array.isArray(lijst)) {
          const namen = [...new Set(lijst.filter((x): x is string => typeof x === "string" && x.trim() !== ""))];
          if (namen.length) bronnen[k] = namen;
        }
      }
    }
    schoon.push({ naam: naam.trim(), bronnen });
  }
  return { sjabloon, stappen: schoon };
}

/** Per stap van het webshopsjabloon de positie die die betekenis heeft. */
const WEBSHOPSTAP_POSITIE: readonly (GooglePositie | null)[] = [null, "add_to_cart", "begin_checkout", "purchase"];

/**
 * De positie die bij een stap hoort, op BETEKENIS: de webshopherkenning op de naam van de stap, en
 * als de naam niets zegt op zijn Google-acties. "Product bekeken" en een formulierstap hebben geen
 * positie: de maandtabel kent geen kolom met die betekenis.
 */
export function positieVanStap(stap: StapInstelling): GooglePositie | null {
  for (const tekst of [stap.naam, ...(stap.bronnen.google ?? [])]) {
    const i = SJABLONEN.webshop.findIndex((s) => s.herken.test(tekst));
    if (i >= 0) return WEBSHOPSTAP_POSITIE[i];
  }
  return null;
}

/**
 * Per stap de Google-positie die hem telt. Elke positie hoort bij hooguit één stap: de eerste met
 * die betekenis. `alleenMetActie`: bij een eigen keuze telt Google een stap alleen als er een
 * Google-actie bij gekozen is.
 */
export function positiesUitStappen(stappen: readonly StapInstelling[], alleenMetActie = true): (GooglePositie | null)[] {
  const bezet = new Set<GooglePositie>();
  return stappen.map((s) => {
    if (alleenMetActie && !s.bronnen.google?.length) return null;
    const p = positieVanStap(s);
    if (!p || bezet.has(p)) return null;
    bezet.add(p);
    return p;
  });
}

/** De posities die al in checkout_action_map staan: een lijst, of een losse naam (de oude vorm). */
export function leesPosities(checkoutActionMap: unknown): Partial<Record<GooglePositie, string[]>> {
  const uit: Partial<Record<GooglePositie, string[]>> = {};
  if (!checkoutActionMap || typeof checkoutActionMap !== "object") return uit;
  for (const { positie } of GOOGLE_POSITIES) {
    const ruw = (checkoutActionMap as Record<string, unknown>)[positie];
    const namen = (Array.isArray(ruw) ? ruw : [ruw]).filter((n): n is string => typeof n === "string" && n.trim() !== "");
    if (namen.length) uit[positie] = [...new Set(namen)];
  }
  return uit;
}

/**
 * De waarde voor client_settings.checkout_action_map: de posities voor de sync, en de keuze zelf.
 * Een positie die geen stap dekt, houdt wat er in `bestaand` stond (of blijft weg, en dan vraagt de
 * sync hem met de standaardnaam op): de maandtabel houdt zo zijn betekenis.
 */
export function checkoutMapUit(instelling: TrechterInstelling, bestaand: unknown = null): Record<string, unknown> {
  const uit: Record<string, unknown> = { ...leesPosities(bestaand) };
  const posities = positiesUitStappen(instelling.stappen);
  instelling.stappen.forEach((s, i) => {
    const p = posities[i];
    if (p) uit[p] = [...(s.bronnen.google ?? [])];
  });
  uit.trechter = instelling;
  return uit;
}

export interface GeldendeTrechter extends TrechterInstelling {
  /** True als de stappen een eigen, opgeslagen keuze zijn; false bij herkenning op naam. */
  eigen: boolean;
  /** Per stap de Google-positie die hem telt, of null. */
  googlePosities: (GooglePositie | null)[];
}

/**
 * De trechter die geldt: de opgeslagen keuze als die er is (eigen keuzes gaan voor), anders het
 * sjabloon van het bedrijfsmodel met herkenning op naam.
 *
 * Zonder eigen keuze telt de sync per positie de acties die al in de kaart staan (een oude kaart
 * zonder `trechter`), en anders de acties die letterlijk add_to_cart, begin_checkout en purchase
 * heten. Elke positie hoort dan bij de stap met die betekenis, en de acties uit een oude kaart
 * staan als keuze bij die stap: wat de instellingen tonen, is wat de sync telt.
 */
export function geldendeTrechter(inp: {
  checkoutActionMap?: unknown;
  bedrijfsmodel?: unknown;
  bronnen: readonly StapBron[];
}): GeldendeTrechter {
  const opgeslagen = leesInstelling(inp.checkoutActionMap);
  if (opgeslagen && opgeslagen.stappen.length > 0) {
    return { ...opgeslagen, eigen: true, googlePosities: positiesUitStappen(opgeslagen.stappen) };
  }
  const sjabloon = opgeslagen && opgeslagen.sjabloon !== "eigen" ? opgeslagen.sjabloon : sjabloonVoorBedrijfsmodel(inp.bedrijfsmodel);
  const googlePosities = positiesUitStappen(herkenStappen(sjabloon, []), false);
  const oud = leesPosities(inp.checkoutActionMap);
  const stappen = herkenStappen(sjabloon, inp.bronnen).map((s, i) => {
    const p = googlePosities[i];
    return p && oud[p] ? { ...s, bronnen: { ...s.bronnen, google: oud[p] } } : s;
  });
  return { sjabloon, stappen, eigen: false, googlePosities };
}

/**
 * De bronnen om uit te kiezen, plus wat al gekozen is maar niet (meer) voorkomt: een Google-actie
 * uit een oude kaart die niet in de conversieacties staat. Anders verdween hij bij het opslaan.
 */
export function bronnenMetKeuze(bronnen: readonly StapBron[], stappen: readonly StapInstelling[]): StapBron[] {
  const uit = [...bronnen];
  for (const s of stappen) {
    for (const k of ALLE_KANALEN) {
      for (const sleutel of s.bronnen[k] ?? []) {
        if (uit.some((b) => b.kanaal === k && b.sleutel === sleutel)) continue;
        const veld = k === "google" ? null : KANAAL_STAPVELDEN[k].find((v) => v.sleutel === sleutel);
        uit.push({ kanaal: k, sleutel, label: veld?.label ?? sleutel });
      }
    }
  }
  return uit;
}

// ── Tellen over een periode per dag ──────────────────────────────────────────────────────────────

/** De rijen waaruit de stappen geteld worden. Null of afwezig: niet geladen of geen kanaal. */
export interface StapRijen {
  meta?: readonly Rij[] | null;
  linkedin?: readonly Rij[] | null;
  microsoft?: readonly Rij[] | null;
  /** Google: de dagrijen, of null als google_ads_checkout_funnel_daily er (nog) niet is; dan de maandrijen. */
  google?: { dag: readonly Rij[] | null; maand: readonly Rij[] | null } | null;
}

export interface StapWaarde {
  naam: string;
  /** Null: geen data of geen bron, en dan zegt `reden` waarom. Nul is een gemeten nul. */
  waarde: number | null;
  reden: string | null;
}

export interface KanaalStappen {
  kanaal: Kanaal;
  periode: DagPeriode;
  /** De klikken over dezelfde dagen, of null als die niet bekend zijn. */
  klikken: number | null;
  stappen: StapWaarde[];
  /** "maand" alleen bij Google als de dagrijen de periode niet dekken en de maandrijen wel. */
  fijnheid: "dag" | "maand";
  /**
   * De eerste dag met rijen in de bron die geteld is, uit ALLE rijen en niet alleen die van de
   * periode (zoals bronStart in lib/period/dag-telling.ts). Een periode die eerder begint, telt te
   * laag en is niet te vergelijken. Null: geen rijen.
   */
  bronStart: string | null;
  /** Bij fijnheid "maand": de maanden die echt geteld zijn. */
  maanden: PeriodRange | null;
  /** Wat de lezer bij deze telling moet weten (per maand geteld, pas vanaf een dag), anders null. */
  noot: string | null;
}

const isDatum = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const dagVan = (r: Rij) => String(r.date ?? "").slice(0, 10);

/** De vroegste geldige dag in de rijen, of null. */
function eersteDag(rijen: readonly Rij[] | null | undefined): string | null {
  let eerste: string | null = null;
  for (const r of rijen ?? []) {
    const d = dagVan(r);
    if (isDatum(d) && (eerste === null || d < eerste)) eerste = d;
  }
  return eerste;
}

/** "Meta telt pas vanaf 3 jun 2026", als de periode eerder begint dan de eerste rij. */
function pasVanaf(naam: string, periode: DagPeriode, bronStart: string | null): string | null {
  return bronStart && periode.start < bronStart && bronStart <= periode.eind
    ? `${naam} heeft deze stappen pas vanaf ${formatDag(bronStart)}; de dagen ervoor tellen niet mee.`
    : null;
}

/** De som van de velden over de rijen; null als geen enkele rij een getal in die velden heeft. */
function som(rijen: readonly Rij[], velden: readonly string[]): number | null {
  let s = 0;
  let gemeten = false;
  for (const r of rijen) {
    for (const v of velden) {
      const g = getal(r[v]);
      if (g === null) continue;
      gemeten = true;
      s += g;
    }
  }
  return gemeten ? s : null;
}

/**
 * De stappen van één kanaal over een periode per dag. `googleKlikken` zijn de klikken van Google
 * over dezelfde dagen, als die bekend zijn: Google heeft geen klikken per dag in deze rijen.
 * `googleKlikkenPerMaand`: de klikken van Google per maand ("YYYY-MM"). Telt Google de stappen per
 * maand (geen dagrijen voor de periode), dan zijn de klikken over DIEZELFDE maanden bekend, ook als
 * de periode zelf geen hele maanden is.
 */
export function telKanaalStappen(
  kanaal: Kanaal,
  periode: DagPeriode,
  trechter: GeldendeTrechter,
  rijen: StapRijen,
  googleKlikken: number | null = null,
  googleKlikkenPerMaand: ReadonlyMap<string, { clicks: number }> | null = null,
): KanaalStappen {
  const naam = KANAAL_NAAM[kanaal];
  if (kanaal === "google") return telGoogle(periode, trechter, rijen.google ?? null, googleKlikken, googleKlikkenPerMaand);

  const alle = rijen[kanaal] ?? null;
  const binnen = alle ? alle.filter((r) => isDatum(dagVan(r)) && dagIn(dagVan(r), periode)) : [];
  const stappen: StapWaarde[] = [];
  if (kanaal === "meta") {
    const w = som(binnen, [META_LANDINGSPAGINA.sleutel]);
    stappen.push({ naam: META_LANDINGSPAGINA.naam, waarde: w, reden: w === null ? `${naam} telde in deze periode geen landingspagina's.` : null });
  }
  for (const s of trechter.stappen) {
    const velden = s.bronnen[kanaal] ?? [];
    if (!velden.length) {
      stappen.push({ naam: s.naam, waarde: null, reden: `voor ${naam} is bij deze stap geen bron gekozen of op naam herkend.` });
      continue;
    }
    const w = som(binnen, velden);
    stappen.push({ naam: s.naam, waarde: w, reden: w === null ? `${naam} heeft hiervoor geen data in deze periode.` : null });
  }
  const bronStart = eersteDag(alle);
  return {
    kanaal, periode, klikken: som(binnen, [KLIKVELD[kanaal]]), stappen, fijnheid: "dag", bronStart, maanden: null,
    noot: alle ? pasVanaf(naam, periode, bronStart) : `${naam}: de dagcijfers zijn niet geladen.`,
  };
}

/**
 * Google: per dag als de dagrijen de periode dekken (de periode begint op of na de eerste dagrij),
 * anders de maandrijen, en dat staat erbij. Een lege dagtabel (gedraaid, nog niet gevuld) is dus
 * geen "geen data": dan tellen de maanden. Zonder maandrijen de dagrijen die er zijn, met de dag
 * vanaf wanneer.
 */
function telGoogle(
  periode: DagPeriode,
  trechter: GeldendeTrechter,
  google: StapRijen["google"] | null,
  klikkenGegeven: number | null,
  klikkenPerMaand: ReadonlyMap<string, { clicks: number }> | null,
): KanaalStappen {
  let klikken = klikkenGegeven;
  const naam = KANAAL_NAAM.google;
  const dagrijen = google?.dag?.length ? google.dag : null;
  const maandrijen = google?.maand?.length ? google.maand : null;
  const dagStart = eersteDag(dagrijen);
  const perDag = dagrijen && (!maandrijen || (dagStart !== null && periode.start >= dagStart)) ? dagrijen : null;
  const perMaand = perDag ? null : maandrijen;

  let binnen: readonly Rij[] = [];
  let noot: string | null = null;
  let maanden: PeriodRange | null = null;
  let bronStart: string | null = null;
  let geenData = `${naam} heeft geen checkoutcijfers.`;
  if (perDag) {
    bronStart = dagStart;
    binnen = perDag.filter((r) => isDatum(dagVan(r)) && dagIn(dagVan(r), periode));
    noot = pasVanaf(naam, periode, bronStart);
  } else if (perMaand) {
    // De maanden die de periode raken, en dat staat erbij. Een maand naar rato verdelen doen we
    // niet (zie lib/period/dag-telling.ts).
    maanden = omhullendeMaanden(periode);
    const set = new Set(monthsIn(maanden));
    bronStart = eersteDag(perMaand);
    binnen = perMaand.filter((r) => set.has(dagVan(r).slice(0, 7)));
    // De klikken over dezelfde hele maanden als de stappen: anders begon de keten bij een periode
    // die geen hele maanden is zonder klikken, terwijl de maanden ze wel hebben.
    if (klikkenPerMaand) klikken = monthsIn(maanden).reduce((t, m) => t + (klikkenPerMaand.get(m)?.clicks ?? 0), 0);
    // Alleen een noot als er iets geteld is: "geteld is november" bij nul rijen klopt niet.
    if (binnen.length) {
      noot = alsMaandPeriode(periode)
        ? `${naam} telt deze stappen per maand: er zijn geen dagcijfers voor deze periode.`
        : `${naam} telt deze stappen per maand (er zijn geen dagcijfers voor deze periode): geteld is ${formatRange(maanden)}, gevraagd ${formatDagPeriode(periode)}.`;
    } else {
      geenData = `${naam} heeft in ${formatRange(maanden)} geen checkoutcijfers.`;
    }
  }
  const stappen = trechter.stappen.map((s, i): StapWaarde => {
    const positie = trechter.googlePosities[i];
    if (!positie) {
      return { naam: s.naam, waarde: null, reden: `voor ${naam} telt bij deze stap geen kolom: Google meet per dag alleen winkelwagen, afrekenen en aankoop.` };
    }
    if (!binnen.length) return { naam: s.naam, waarde: null, reden: geenData };
    const kolom = GOOGLE_POSITIES.find((p) => p.positie === positie)!.kolom;
    const w = som(binnen, [kolom]);
    return { naam: s.naam, waarde: w, reden: w === null ? `${naam} heeft hiervoor geen data in deze periode.` : null };
  });
  return { kanaal: "google", periode, klikken, stappen, fijnheid: perMaand ? "maand" : "dag", bronStart, maanden, noot };
}

/**
 * Waarom `nu` en `toen` niet eerlijk te vergelijken zijn, of null als het wel kan. Alleen als beide
 * op dezelfde fijnheid tellen, beide op of na de eerste rij van hun bron beginnen, en bij een
 * telling per maand beide hele maanden zijn die elkaar niet overlappen. Anders telt "toen" deels
 * dezelfde maand als "nu", of een stuk zonder rijen als nul: dezelfde fout als de +1559% die
 * lib/period/dag-telling.ts met bronStart voorkomt.
 */
export function waaromNietVergelijkbaar(nu: KanaalStappen, toen: KanaalStappen): string | null {
  const naam = KANAAL_NAAM[nu.kanaal];
  if (nu.fijnheid !== toen.fijnheid) {
    return `${naam} telt de ene periode per dag en de andere per maand; er staat geen verandering bij.`;
  }
  const teVroeg = ([[nu, "de gekozen periode"], [toen, "de vergelijkingsperiode"]] as const)
    .filter(([t]) => t.bronStart !== null && t.periode.start < t.bronStart);
  if (teVroeg.length) {
    return teVroeg.map(([t, wat]) => `${naam} heeft deze stappen pas vanaf ${formatDag(t.bronStart!)}; ${wat} (${formatDagPeriode(t.periode)}) begint eerder.`).join(" ")
      + " Daarom staat er geen verandering bij.";
  }
  if (nu.fijnheid === "maand") {
    const a = alsMaandPeriode(nu.periode);
    const b = alsMaandPeriode(toen.periode);
    if (!a || !b) return `${naam} telt per maand, en de periodes zijn geen hele maanden; er staat geen verandering bij.`;
    const overlap = monthsIn(a).some((m) => monthsIn(b).includes(m));
    if (overlap) return `${naam} telt per maand, en beide periodes raken dezelfde maand; er staat geen verandering bij.`;
  }
  return null;
}

// ── De keten na de klik, per kanaal ──────────────────────────────────────────────────────────────

export interface KetenRij {
  naam: string;
  waarde: number;
  /** Het aandeel dat de volgende stap haalt, als fractie; null bij de laatste stap of zonder basis. */
  naarVolgende: number | null;
  /** Hoeveel er tussen deze en de volgende stap afvallen; null bij de laatste, of als de volgende groter is. */
  uitval: number | null;
  /** Tegen de vergelijkingsperiode; null zonder vergelijking of zonder waarde toen. */
  verandering: { absoluut: number; pct: number | null } | null;
}

export interface Keten {
  kanaal: Kanaal;
  /** Klikken (als bekend) en dan de stappen met data, in volgorde. */
  rijen: KetenRij[];
  /** De stappen die eruit vallen, met de reden ("Product bekeken: ..."). */
  weg: string[];
  opmerkingen: string[];
  /** True als er geen enkele stap na de klik data heeft. */
  leeg: boolean;
  fijnheid: "dag" | "maand";
  /** De noot van de telling (per maand, pas vanaf), voor Alle kanalen; anders null. */
  noot: string | null;
  /** Waarom er geen verandering staat terwijl er wel een vergelijkingsperiode is; anders null. */
  geenVergelijking: string | null;
}

export const KLIKKEN = "Klikken";

/**
 * Klikken > stappen na de klik, met per stap het aantal, het aandeel naar de volgende stap, de
 * uitval, en de verandering tegen `toen` (absoluut en relatief), alleen als die vergelijking
 * eerlijk is (waaromNietVergelijkbaar). Een stap zonder data valt eruit, met de reden. Elke deling
 * via safeDiv: nul klikken is "niet te berekenen", geen 0%.
 */
export function ketenNaDeKlik(nu: KanaalStappen, vergelijk: KanaalStappen | null): Keten {
  const naam = KANAAL_NAAM[nu.kanaal];
  const geenVergelijking = vergelijk ? waaromNietVergelijkbaar(nu, vergelijk) : null;
  const toen = geenVergelijking ? null : vergelijk;
  const metData = nu.stappen.filter((s) => s.waarde !== null) as (StapWaarde & { waarde: number })[];
  const basis: { naam: string; waarde: number }[] = [
    ...(nu.klikken !== null ? [{ naam: KLIKKEN, waarde: nu.klikken }] : []),
    ...metData,
  ];
  const toenWaarde = (n: string): number | null => {
    if (!toen) return null;
    if (n === KLIKKEN) return toen.klikken;
    return toen.stappen.find((s) => s.naam === n)?.waarde ?? null;
  };
  const opmerkingen: string[] = [];
  const rijen = basis.map((r, i): KetenRij => {
    const volgende = basis[i + 1];
    const t = toenWaarde(r.naam);
    let uitval: number | null = null;
    if (volgende) {
      if (volgende.waarde <= r.waarde) uitval = r.waarde - volgende.waarde;
      else {
        opmerkingen.push(`${naam} telt meer bij "${volgende.naam}" dan bij "${r.naam}": het platform rekent die stap ook toe zonder de stap ervoor (bijvoorbeeld na het zien van een advertentie, of via een ander apparaat). Het aandeel is dan geen doorstroom.`);
      }
    }
    return {
      naam: r.naam,
      waarde: r.waarde,
      naarVolgende: volgende ? safeDiv(volgende.waarde, r.waarde) : null,
      uitval,
      verandering: t === null ? null : { absoluut: r.waarde - t, pct: delta(r.waarde, t).pct },
    };
  });
  if (nu.klikken === null && metData.length > 0) {
    opmerkingen.push(`De klikken van ${naam} over precies deze dagen zijn niet bekend; de keten begint bij de eerste stap na de klik.`);
  }
  if (nu.noot) opmerkingen.push(nu.noot);
  if (geenVergelijking) opmerkingen.push(geenVergelijking);
  return {
    kanaal: nu.kanaal,
    rijen,
    weg: nu.stappen.filter((s) => s.waarde === null).map((s) => `${s.naam}: ${s.reden ?? "geen data."}`),
    opmerkingen: [...new Set(opmerkingen)],
    leeg: metData.length === 0,
    fijnheid: nu.fijnheid,
    noot: nu.noot,
    geenVergelijking,
  };
}

// ── Alle kanalen: per stap de kanalen naast elkaar ───────────────────────────────────────────────

export interface NaDeKlikStap {
  naam: string;
  perKanaal: { kanaal: Kanaal; waarde: number; verandering: KetenRij["verandering"]; fijnheid: Keten["fijnheid"] }[];
}

export interface NaDeKlikUitkomst {
  stappen: NaDeKlikStap[];
  kanalen: Kanaal[];
  /** Per kanaal wat de lezer moet weten: per maand geteld, pas vanaf, geen vergelijking. */
  noten: { kanaal: Kanaal; tekst: string }[];
}

/** Waarom de kanalen per stap niet worden opgeteld. */
export const NIET_OPTELLEN =
  "De kanalen staan naast elkaar en zijn niet opgeteld: elk platform rekent dezelfde aankoop zichzelf toe, dus een som telt één klant soms twee of drie keer.";

/**
 * Per stap de kanalen die hem meten, naast elkaar en NIET opgeteld. Alleen kanalen met data in
 * minstens één stap; de volgorde van de stappen is die van de eerste keten waarin ze voorkomen.
 * De fijnheid en de noten gaan mee: Google per maand naast Meta per dag zonder label leest als
 * dezelfde dagen.
 */
export function naDeKlikPerStap(ketens: readonly Keten[]): NaDeKlikUitkomst {
  const metData = ketens.filter((k) => !k.leeg);
  const stappen: NaDeKlikStap[] = [];
  for (const k of metData) {
    for (const r of k.rijen) {
      if (r.naam === KLIKKEN) continue;
      let s = stappen.find((x) => x.naam === r.naam);
      if (!s) { s = { naam: r.naam, perKanaal: [] }; stappen.push(s); }
      s.perKanaal.push({ kanaal: k.kanaal, waarde: r.waarde, verandering: r.verandering, fijnheid: k.fijnheid });
    }
  }
  const noten = metData.flatMap((k) => [k.noot, k.geenVergelijking]
    .filter((t): t is string => !!t)
    .map((tekst) => ({ kanaal: k.kanaal, tekst })));
  return { stappen, kanalen: metData.map((k) => k.kanaal), noten };
}
