// Wie een run startte: de planning (cron) of een mens (knop, handmatige route, script). Gaat naar
// generation_jobs.triggered_by.
//
// WAAROM. De kolom bestond sinds migratie 004, maar createProgressJob vulde hem nooit: elke rij
// had triggered_by null. Daardoor kon niets -- het slagingspercentage (lib/eval/analyse-slagingen.ts),
// het logboek -- een geplande run onderscheiden van een testklik. Zolang de cron niet aanstaat zijn
// alle runs handmatig; zodra hij aangaat moet je kunnen zien of een daling in het percentage uit
// de nacht komt of uit het testen.
//
// HOE WE HET WETEN. Twee dingen tegelijk: het CRON_SECRET als Bearer EN de vlag `automatisch`.
//   - Alleen het geheim is niet genoeg: ook niet-geplande aanroepen dragen het. Een verse run van
//     scripts/score-evaluatieset.mjs (handmatig, kost geld) stuurt het om langs de toegangscheck te
//     komen, en die stuurt de vlag niet. Telde het geheim alleen, dan stonden die runs als gepland.
//   - Alleen de vlag is niet genoeg: iedereen kan hem in een body zetten. Zonder het geheim telt hij
//     niet.
// app/api/cron/trigger-sops stuurt beide: `automatisch: true` in de body naar de analyse-routes
// (dezelfde vlag die daar de sops_enabled-dekking aanzet) en `automatisch=1` in de query naar de
// PDF-route. Een handmatige curl naar trigger-sops zonder dry_run is daardoor WEL gepland: die
// draait precies het geplande pad, en het onderscheid tussen die twee zit in de tijd van de dag,
// niet in deze kolom.
//
// Het id van de gebruiker zit hier niet in: de analyse-routes lezen de sessie niet (de
// toegangscheck geeft alleen een weigering of null terug), en een extra sessie-lookup per run alleen
// voor dit veld is het niet waard. Komt die gebruiker later wel beschikbaar, geef dan zijn id mee
// als `gebruikerId`; alles behalve "cron" telt in de weergave als handmatig.
//
// De weergave (gepland, handmatig, onbekend) staat in lib/eval/analyse-slagingen.ts
// (soortGestartDoor): dat bestand moet zonder imports blijven, en "cron" is daar de enige waarde
// die telt als gepland.

export const GESTART_DOOR_CRON = "cron";
export const GESTART_DOOR_HANDMATIG = "handmatig";

interface HeadersLike {
  get(naam: string): string | null;
}

/**
 * "cron" als het verzoek het CRON_SECRET als Bearer draagt EN zich als automatisch meldt (`automatisch`:
 * de body- of queryvlag, door de route gelezen), anders het id van de gebruiker als dat bekend is,
 * anders "handmatig". Zonder CRON_SECRET in de omgeving is niets een cron-aanroep: de cronroutes
 * weigeren dan zelf al te draaien.
 */
export function gestartDoorUitVerzoek(
  headers: HeadersLike,
  automatisch: boolean,
  opties: { cronSecret?: string | null; gebruikerId?: string | null } = {},
): string {
  const secret = opties.cronSecret === undefined ? process.env.CRON_SECRET : opties.cronSecret;
  if (automatisch && secret && headers.get("authorization") === `Bearer ${secret}`) return GESTART_DOOR_CRON;
  const id = opties.gebruikerId?.trim();
  return id ? id : GESTART_DOOR_HANDMATIG;
}
