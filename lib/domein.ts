/**
 * Welk domein canoniek is, en wanneer er doorverwezen wordt.
 *
 * ctrlppc.com is de echte plek; ctrlppc.nl verwijst erheen. Eén plek, want dit gegeven duikt op
 * bij de doorverwijzing, bij de canonical-tag voor zoekmachines, bij de toegestane redirect-URLs
 * van Supabase Auth en bij de cookies. Staan die niet allemaal op hetzelfde domein, dan logt
 * iemand in op .nl, komt hij op .com terecht en is zijn sessie weg — en dat is precies de soort
 * storing waarvan niemand kan aanwijzen waar hij vandaan komt.
 *
 * ── WAT ER BEWUST NIET DOORVERWEZEN WORDT ───────────────────────────────────
 *
 * Alleen wat we KENNEN als alternatief domein. Niet "alles wat niet canoniek is", want daar
 * vallen ook localhost, voorbeeldomgevingen en de deploy-URL's van het hostingplatform onder.
 * Een doorverwijzing die daar aan staat maakt elke voorvertoning onbruikbaar: je opent een
 * preview-link en belandt op productie, zonder dat te zien.
 *
 * Dat is dezelfde afweging als bij de bureaugrens: een regel die "alles behalve" zegt, raakt
 * altijd meer dan bedoeld. Een opsomming van wat er wél onder valt is korter na te kijken.
 */

export const CANONIEK_DOMEIN = "ctrlppc.com";

/** Domeinen die naar het canonieke domein wijzen. Met en zonder www. */
export const ALTERNATIEVE_DOMEINEN = [
  "ctrlppc.nl",
  "www.ctrlppc.nl",
  `www.${CANONIEK_DOMEIN}`,
] as const;

/**
 * De URL waarheen doorverwezen moet worden, of null als er niets hoeft te gebeuren.
 *
 * Pad, zoekparameters en fragment blijven staan: iemand die een gedeelde link naar een klant
 * opent op .nl hoort op diezelfde klant uit te komen, niet op de voorpagina.
 */
export function canoniekeDoelUrl(huidigeUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(huidigeUrl);
  } catch {
    return null;   // onparseerbaar: dan liever niets doen dan iemand ergens heen sturen
  }

  const host = url.hostname.toLowerCase();
  if (!(ALTERNATIEVE_DOMEINEN as readonly string[]).includes(host)) return null;

  url.hostname = CANONIEK_DOMEIN;
  // Altijd https op het canonieke domein. Een doorverwijzing die http laat staan levert een
  // tweede doorverwijzing op, en bij een inlogsessie een cookie die niet meekomt.
  url.protocol = "https:";
  url.port = "";
  return url.toString();
}

/**
 * Hetzelfde, maar dan voor een binnenkomend verzoek — en dát is de versie die de middleware moet
 * gebruiken.
 *
 * ── WAAROM DIT NODIG IS ─────────────────────────────────────────────────────
 *
 * `request.url` in de middleware draagt het gevraagde domein NIET. Gemeten op een zelf gehoste
 * `next start` op poort 3190, met een verzoek waarin `Host: ctrlppc.nl` stond:
 *
 *   request.url                     http://localhost:3190/__proxy-check
 *   request.nextUrl.href            http://localhost:3190/__proxy-check
 *   request.headers.get("host")     ctrlppc.nl
 *
 * Next normaliseert de URL naar het adres waarop de server luistert. `canoniekeDoelUrl(request.url)`
 * ziet daardoor nooit `ctrlppc.nl` en de doorverwijzing vuurde dus nooit — geen foutmelding, geen
 * test die faalt, alleen een regel die er staat en niets doet. Op Vercel wérkt de oude versie
 * toevallig, want daar zet het platform de host in de URL; dat maakt het erger, niet beter, want
 * dan valt het pas op na een verhuizing.
 *
 * ── DE HEADER VERTROUWEN ────────────────────────────────────────────────────
 *
 * `x-forwarded-host` komt van buiten en is dus te vervalsen. Dat mag hier, en om een concrete
 * reden: de bestemming van deze doorverwijzing wordt niet uit de header overgenomen. Hij bepaalt
 * alleen óf er doorverwezen wordt; waarheen staat hierboven vast op CANONIEK_DOMEIN. Iemand die
 * `x-forwarded-host: ctrlppc.nl` verzint, verwijst daarmee alleen zichzelf naar ctrlppc.com.
 */
export function canoniekeDoelUrlVoorVerzoek(
  ruweUrl: string,
  hostHeader: string | null | undefined,
  doorgestuurdeHost?: string | null | undefined
): string | null {
  // x-forwarded-host wint: staat er een proxy voor, dan is dat het domein dat de bezoeker typte.
  // Bij meerdere proxies staat er een komma-lijst; de eerste is de oorspronkelijke vraag.
  const host = (doorgestuurdeHost ?? hostHeader ?? "").split(",")[0].trim();
  if (!host) return canoniekeDoelUrl(ruweUrl);

  let url: URL;
  try {
    url = new URL(ruweUrl);
  } catch {
    return null;
  }
  const [hostnaam, poort] = host.split(":");
  if (!hostnaam) return null;
  url.hostname = hostnaam;
  url.port = poort ?? "";
  return canoniekeDoelUrl(url.toString());
}
