/**
 * Welke kanalen heeft deze klant écht?
 *
 * Aanleiding, gemeten op de 71 accounts in de database:
 *
 *   alleen Google        62 klanten
 *   helemaal geen data    8 klanten
 *   alle drie             1 klant (de demo)
 *
 * De kanaaltabs stonden als vaste lijst van vier in het dashboard. Voor 62 van de 71 klanten
 * betekende dat twee tabbladen die naar een leeg scherm leiden, plus een tab "Alle kanalen" die
 * hetzelfde toont als het enige kanaal dat er is. Dat is precies de ballast die een tool
 * onbetrouwbaar laat voelen: je klikt en er gebeurt niets, en dan ga je je afvragen wat er nog
 * meer niet werkt.
 *
 * ── WAT "BESCHIKBAAR" BETEKENT ──────────────────────────────────────────────
 *
 * Ooit data gehad, niet: data in de gekozen periode. Een klant die vorig jaar Meta draaide en nu
 * niet, houdt zijn Meta-tab -- daar staat historie in die je wilt kunnen terugzien. Zou het per
 * periode gaan, dan verspringt de navigatie bij elke wijziging van de datumkiezer, en dat is
 * erger dan een tab die een rustige nul toont.
 *
 * ── WAAROM DE LEGACY-NAMEN EN NIET fact_core ────────────────────────────────
 *
 * fact_core zou hier de nette bron zijn: één tabel, één kolom `channel`. Maar daar staat sinds
 * migratie 058 RLS op, en de browser leest voorlopig nog met de anon-sleutel zonder sessie -- die
 * krijgt dus nul rijen. De namen hieronder zijn sinds migratie 054 views over fact_core, dus het
 * IS fact_core; alleen langs de weg die vandaag werkt en die na het aanzetten van
 * security_invoker blijft werken.
 */

import { opsomming } from "@/lib/util/tekst";
import { CHANNEL_CHART_COLOR } from "@/lib/branding/chart-colors";

export type Kanaal = "google" | "meta" | "linkedin" | "microsoft";

/** Waar per kanaal te kijken. De view volstaat: er hoeft maar één rij te bestaan. */
export const KANAAL_BRON: Record<Kanaal, { tabel: string; kolom: string }> = {
  google: { tabel: "ads_account_monthly", kolom: "month" },
  meta: { tabel: "meta_account_daily", kolom: "date" },
  linkedin: { tabel: "linkedin_account_daily", kolom: "date" },
  // Gewone tabel, geen view: microsoft_* is niet in de bevroren fase-3-projectie opgenomen.
  microsoft: { tabel: "microsoft_account_daily", kolom: "date" },
};

export const ALLE_KANALEN: Kanaal[] = ["google", "meta", "linkedin", "microsoft"];

/** Hoe een kanaal heet in een zin. Dezelfde namen als op de tabbladen. */
export const KANAAL_NAAM: Record<Kanaal, string> = {
  google: "Google Ads",
  meta: "Meta",
  linkedin: "LinkedIn",
  microsoft: "Microsoft Ads",
};

/**
 * De vaste kleur van een kanaal, overal op het scherm dezelfde.
 *
 * Waarom hij hier staat en niet bij het component dat hem toevallig als eerste nodig had: dit
 * bestand is de plek waar een kanaal BESTAAT -- zijn bron, zijn naam. Stond de kleur ergens
 * anders, dan is "een kanaal toevoegen" twee losse bewerkingen waarvan je de tweede vergeet, en
 * dan valt het nieuwe kanaal terug op een positie-kleur die per grafiek verschilt. Dat is precies
 * wat er in kanaal-health-ranking.tsx gebeurd was: Meta stond daar oranje en overal elders violet.
 *
 * De waarden komen uit CHANNEL_CHART_COLOR, het gevalideerde categorische palet. Kleur volgt de
 * IDENTITEIT van het kanaal, nooit zijn positie in een lijst -- een rangschikking die van volgorde
 * wisselt mag de kleuren niet laten verspringen.
 */
export const KANAAL_KLEUR: Record<Kanaal, string> = {
  google: CHANNEL_CHART_COLOR.Google,
  meta: CHANNEL_CHART_COLOR.Meta,
  linkedin: CHANNEL_CHART_COLOR.LinkedIn,
  microsoft: CHANNEL_CHART_COLOR.Microsoft,
};

/**
 * De kanalen als opsomming, of null als er niets op te sommen valt.
 *
 * Waarom dit bestaat: bovenaan het dashboard stond "Live data uit Google Ads" als vaste tekst.
 * Bij een klant zonder Google is dat een zin die klopt in grammatica en niet in feiten -- dezelfde
 * soort fout als de verwijzing "→ Meta" naar een tabblad dat er niet is. Data-onderdelen zakken
 * netjes naar nul als er niets is; zinnen doen dat niet, die blijven staan en liegen.
 *
 * De volgorde is die van ALLE_KANALEN en niet die van de invoer, anders wisselt de tekst per
 * keer dat de kanalen opnieuw geladen worden.
 */
export function kanalenOpsomming(beschikbaar: readonly Kanaal[]): string | null {
  const namen = ALLE_KANALEN.filter((k) => beschikbaar.includes(k)).map((k) => KANAAL_NAAM[k]);
  // Null en geen lege tekst: hier betekent "niets" dat er geen zin hoort te staan, en dat is een
  // keuze van deze functie en niet van de opsomming.
  if (namen.length === 0) return null;
  return opsomming(namen);
}

/** Wat de kanaalkiezer laat zien. `blended` is de samenvoeging van alles. */
export type Kanaalkeuze = Kanaal | "blended";

/**
 * De tabbladen die getoond horen te worden.
 *
 * Nul kanalen  → niets. Er is dan geen dashboard om te tonen; de aanroeper hoort een lege staat
 *                te laten zien in plaats van een scherm vol nullen.
 * Eén kanaal   → niets. Een kiezer met één knop is geen keuze, en "Alle kanalen" naast dat ene
 *                kanaal toont twee keer hetzelfde.
 * Twee of meer → `blended` plus de kanalen zelf, in vaste volgorde zodat de tabs niet verspringen
 *                als er een kanaal bijkomt.
 */
export function zichtbareTabs(beschikbaar: readonly Kanaal[]): Kanaalkeuze[] {
  const gevonden = ALLE_KANALEN.filter((k) => beschikbaar.includes(k));
  if (gevonden.length < 2) return [];
  return ["blended", ...gevonden];
}

/**
 * Welk kanaal er moet worden getoond, gegeven een eerdere keuze.
 *
 * Zonder dit blijft een klant hangen op een kanaal dat hij niet heeft: je bekijkt klant A op de
 * Meta-tab, klikt door naar klant B die alleen Google draait, en ziet een leeg scherm terwijl de
 * tab niet eens meer bestaat.
 */
export function geldigeKeuze(
  huidig: Kanaalkeuze,
  beschikbaar: readonly Kanaal[]
): Kanaalkeuze {
  const gevonden = ALLE_KANALEN.filter((k) => beschikbaar.includes(k));
  if (gevonden.length === 0) return "blended";
  if (gevonden.length === 1) return gevonden[0];
  if (huidig === "blended" || gevonden.includes(huidig as Kanaal)) return huidig;
  return "blended";
}

/** Nette omschrijving voor een lege staat. */
export function geenDataTekst(kanalen: readonly Kanaal[]): string | null {
  return kanalen.length === 0
    ? "Voor deze klant staat nog geen data in het systeem. Zodra een kanaal gekoppeld is en de eerste sync heeft gedraaid, verschijnt hier het dashboard."
    : null;
}

/**
 * Hoe lang op een antwoord gewacht wordt voordat een kanaal als afwezig geldt.
 *
 * Een onbereikbare Supabase geeft geen foutmelding maar een fetch die blijft hangen. Zonder deze
 * grens blijft de laadstand eeuwig "nog niet bekend", en dan verschijnt de lege staat nooit --
 * precies de fout die eerder in het groepenblok op /settings zat, waar een mislukte load het hele
 * blok onzichtbaar maakte in plaats van een melding te tonen.
 *
 * Zes seconden: ruim boven een trage maar werkende verbinding, ruim onder wat iemand uitzit.
 */
export const WACHT_MS = 6000;

/**
 * Zoekt per kanaal of er ook maar één rij bestaat.
 *
 * Drie kleine queries naast elkaar, met `limit 1` en één kolom: het antwoord is ja of nee, dus er
 * hoeft niets geteld te worden. Een count over de hele historie zou hier het duurste zijn wat je
 * kunt doen voor de goedkoopste vraag.
 */
export async function laadBeschikbareKanalen(
  supabase: { from: (t: string) => { select: (k: string) => { eq: (c: string, v: string) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null }> } } } },
  clientId: string
): Promise<Kanaal[]> {
  const uitkomsten = await Promise.all(
    ALLE_KANALEN.map(async (kanaal) => {
      const bron = KANAAL_BRON[kanaal];
      try {
        const vraag = supabase.from(bron.tabel).select(bron.kolom).eq("client_id", clientId).limit(1);
        const uitkomst = await Promise.race([
          Promise.resolve(vraag),
          new Promise<null>((klaar) => setTimeout(() => klaar(null), WACHT_MS)),
        ]);
        if (uitkomst === null) return null;   // te lang stil: dan geldt het kanaal als afwezig
        return ((uitkomst as { data: unknown[] | null }).data?.length ?? 0) > 0 ? kanaal : null;
      } catch {
        // Een kanaal waarvan de tabel niet bestaat of niet leesbaar is, telt als afwezig. Dat is
        // beter dan de hele kiezer laten omvallen op één kapotte bron.
        return null;
      }
    })
  );
  return uitkomsten.filter((k): k is Kanaal => k !== null);
}

/**
 * De kanalenlijst uit de bronnen die het klantdashboard bij de mount toch al vraagt (fase 1, stap 4).
 *
 * Eerder kwam de lijst alleen uit laadBeschikbareKanalen, en startte de blended route pas daarna:
 * een waterval proefjes -> route -> KPI-band. Nu weet elke bron zijn eigen deel:
 * - Google uit het Google-antwoord zelf. De band toont Google live, dus een account dat nog niet
 *   in de database gesynct is, bestaat hier wel -- het proefje (ads_account_monthly) zag dat niet.
 * - De drie dagkanalen uit perKanaal van de blended route (alleen kanalen met rijen staan erin),
 *   of uit het proefje als dat eerder antwoordt of de route faalt. Het proefje loopt ernaast, niet
 *   erna: een klant met alleen Google hangt zo niet aan de duur van de blended route.
 *
 * Null zolang van een kanaal nog niets bekend is. Dat onderscheid telt: "nog niet weten" mag er
 * niet uitzien als "geen kanalen", anders flitst de lege staat op bij elke navigatie.
 */
export function kanalenUitBronnen(inp: {
  /** De Google-route laadt nog: Google is dan onbekend, wat het proefje er ook van zegt (een live
   *  account zonder gesyncte rijen gaf anders één moment de melding "nog geen data"). */
  googleLaadt: boolean;
  /** Heeft het Google-antwoord een maand met data; null als die route faalde (geen antwoord). */
  google: boolean | null;
  /** De kanalen in perKanaal van de blended route; null zolang hij laadt of na een fout. */
  route: readonly string[] | null;
  /** Het antwoord van laadBeschikbareKanalen; null zolang het er niet is. */
  proefje: readonly string[] | null;
}): Kanaal[] | null {
  // De route gaat voor zodra hij er is: hij is ook de bron van de cijfers in de band.
  const elders = (k: Kanaal): boolean | null => (inp.route ? inp.route.includes(k) : inp.proefje ? inp.proefje.includes(k) : null);
  // Faalde de Google-route, dan wat de database van Google weet.
  const google = inp.googleLaadt ? null : inp.google ?? elders("google");
  const per: Record<Kanaal, boolean | null> = { google, meta: elders("meta"), linkedin: elders("linkedin"), microsoft: elders("microsoft") };
  if (ALLE_KANALEN.some((k) => per[k] === null)) return null;
  return ALLE_KANALEN.filter((k) => per[k] === true);
}
