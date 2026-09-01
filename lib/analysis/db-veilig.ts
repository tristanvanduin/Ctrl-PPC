// De veilige datalaag voor de losse analyses.
//
// WAAROM DIT BESTAAT
//
// De sloop-audit van 1 september vond in vrijwel elke deep-dive-route dezelfde drie fouten,
// steeds opnieuw met de hand gemaakt:
//
// 1. `const { data } = await supabase...` — de fout wordt weggegooid. Een kapotte query
//    (verkeerde kolom, ongeldige datum) leest dan als "geen data" en de route stuurt een
//    404 met "draai eerst de sync", terwijl de sync niets misdeed. Zo bleef bid-strategy
//    maandenlang onzichtbaar kapot: de kolom bestond niet, de 400 werd geslikt, elke run
//    eindigde in een geloofwaardige 404.
//
// 2. Een query zonder limiet en zonder paginering. PostgREST kapt op 1000 rijen af, stil.
//    Erger: twee routes sorteerden OPLOPEND op maand, waardoor de cap precies de nieuwste
//    maanden wegsneed en de analyse op stokoude data draaide — met groene status.
//
// 3. `${month}-01` op een waarde die al "2026-08-01" is. De month-kolommen zijn DATE;
//    PostgREST levert ze als volledige datum. Drie routes maakten er "2026-08-01-01" van
//    en faalden op de save — ná de betaalde LLM-call.
//
// Dit bestand is de ene plek waar die drie lessen wonen. Routes die hem gebruiken kunnen
// deze fouten niet meer maken; routes die hem omzeilen vallen op in review.

import { lastCompleteMonth } from "@/lib/period/period-range";

/** Een databankfout mét de plek waar hij optrad — voor een 500 die iets uitlegt. */
export class DataLaagFout extends Error {
  constructor(public readonly context: string, public readonly oorzaak: string) {
    super(`${context}: ${oorzaak}`);
    this.name = "DataLaagFout";
  }
}

interface QueryUitkomst<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Het resultaat van één query, met verplichte foutcontrole. Gooit DataLaagFout zodat de
 * route hem als 500 kan melden in plaats van als "geen data".
 */
export function eis<T>(res: QueryUitkomst<T>, context: string): T[] {
  if (res.error) throw new DataLaagFout(context, res.error.message);
  return res.data ?? [];
}

/**
 * Alle rijen van een query, gepagineerd langs de PostgREST-cap.
 *
 * De factory krijgt (van, tot) en hoort een VERSE builder te maken met een expliciete
 * `.order(...)` — zonder deterministische volgorde is paginering loterij — en `.range(van,
 * tot)` als laatste schakel. `afgekapt` wordt true zodra het plafond `max` is bereikt;
 * de aanroeper hoort dat te melden in plaats van te doen alsof de som compleet is.
 */
export async function alleRijen<T>(
  haal: (van: number, tot: number) => PromiseLike<QueryUitkomst<T>>,
  context: string,
  { stap = 1000, max = 25_000 }: { stap?: number; max?: number } = {}
): Promise<{ rijen: T[]; afgekapt: boolean }> {
  const rijen: T[] = [];
  for (let van = 0; van < max; van += stap) {
    const { data, error } = await haal(van, van + stap - 1);
    if (error) throw new DataLaagFout(context, error.message);
    rijen.push(...((data ?? []) as T[]));
    if (!data || data.length < stap) return { rijen, afgekapt: false };
  }
  return { rijen, afgekapt: true };
}

/**
 * DataLaagFout → een 500 die zegt wélke databron faalde; al het andere gooit door.
 * Gebruik in het catch-blok van de route, vóór de generieke afhandeling.
 */
export function dataFoutNaarResponse(e: unknown): Response | null {
  if (e instanceof DataLaagFout) {
    return Response.json(
      { error: `Databron faalde (${e.context})`, detail: e.oorzaak },
      { status: 500 }
    );
  }
  return null;
}

// ── Maandhulpjes ────────────────────────────────────────────────────────────
//
// De month-kolommen zijn DATE (altijd de eerste van de maand) en komen als "2026-08-01"
// binnen. Wie er tekst van maakt, doet dat hier — niet met een eigen `-01`-plak.

/** "2026-08", "2026-08-01" of een ISO-timestamp → "2026-08-01". */
export function maandStart(waarde: string): string {
  return `${waarde.slice(0, 7)}-01`;
}

/** "2026-08-01" of "2026-08" → "2026-08" (de sleutel om maanden mee te vergelijken). */
export function maandSleutel(waarde: string): string {
  return waarde.slice(0, 7);
}

/**
 * De eerste dag van de laatste AFGESLOTEN kalendermaand, als DATE-string. Dit is de
 * bovengrens (inclusief) voor elke analyse die geen halve lopende maand wil meten.
 */
export function laatsteAfgeslotenMaandStart(): string {
  return `${lastCompleteMonth()}-01`;
}

/**
 * De eerste dag van de LOPENDE maand, als DATE-string — de exclusieve bovengrens voor
 * `.lt("month", ...)`-filters.
 */
export function lopendeMaandStart(): string {
  const [jaar, maand] = lastCompleteMonth().split("-").map(Number);
  const volgend = maand === 12 ? `${jaar + 1}-01` : `${jaar}-${String(maand + 1).padStart(2, "0")}`;
  return `${volgend}-01`;
}

/** De eerste dag van de maand `terug` maanden vóór de laatste afgesloten maand. */
export function afgeslotenMaandenTerugStart(terug: number): string {
  const [jaar, maand] = lastCompleteMonth().split("-").map(Number);
  const index = jaar * 12 + (maand - 1) - terug;
  const j = Math.floor(index / 12);
  const m = index % 12;
  return `${j}-${String(m + 1).padStart(2, "0")}-01`;
}
