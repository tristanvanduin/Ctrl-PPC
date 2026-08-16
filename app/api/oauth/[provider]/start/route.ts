// Start van de OAuth-flow voor een platformkoppeling. Bouwt de consent-redirect en zet een
// kortlevende, httpOnly state-cookie neer — puur CSRF-bescherming, draagt geen bureau-id. Het
// bureau wordt in de callback vers uit de ingelogde sessie afgeleid (zie de opmerking daar).
//
// ── ELKE FOUT HIER REDIRECT TERUG NAAR /SETTINGS, NOOIT RUWE JSON ──────────────────────────────
//
// De "Verbinden"-knop doet een volledige paginanavigatie (window.location.href), geen fetch — een
// JSON-response hier belandt dus LETTERLIJK als paginabron in de browser, precies zoals de
// callback-route dat al vermeed. Eén keer over het hoofd gezien (geen OAuth-client geconfigureerd
// gaf ruwe JSON i.p.v. een nette foutmelding op de settingspagina), hersteld nadat het in productie
// zichtbaar werd.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireCapability } from "@/lib/auth/server";
import { OAUTH_PROVIDERS, providerHeeftClient } from "@/lib/tenancy/oauth-providers";
import type { Provider } from "@/lib/tenancy/koppelingen";

export const dynamic = "force-dynamic";

function isProvider(v: string): v is Provider {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, v);
}

export function redirectUriFor(origin: string, provider: string): string {
  return `${origin}/api/oauth/${provider}/callback`;
}

function settingsErrorRedirect(origin: string, code: string): NextResponse {
  return NextResponse.redirect(`${origin}/settings?oauth_error=${code}`);
}

export async function GET(req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const { origin } = new URL(req.url);

  if (!isProvider(provider)) {
    return settingsErrorRedirect(origin, "onbekende_provider");
  }

  const user = await requireCapability("connection:manage");
  if (user instanceof Response) {
    return settingsErrorRedirect(origin, `${provider}_niet_geautoriseerd`);
  }

  const cfg = OAUTH_PROVIDERS[provider];
  if (!providerHeeftClient(provider)) {
    return settingsErrorRedirect(origin, `${provider}_geen_client`);
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = redirectUriFor(origin, provider);

  const authorizeUrl = new URL(cfg.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", cfg.clientId()!);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", cfg.scope);
  authorizeUrl.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams ?? {})) {
    authorizeUrl.searchParams.set(k, v);
  }

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minuten — ruim genoeg voor een consent-scherm, kort genoeg om geen dode state te laten slingeren
    path: "/",
  });
  return response;
}
