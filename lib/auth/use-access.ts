"use client";

// De UI-gating-hook. Comfort: knoppen en tabbladen verbergen waar het recht ontbreekt, en
// de beurslijst beperken tot de eigen scope. De server-guard blijft de waarheid — deze hook
// bepaalt wat je ZIET, niet waar je BIJ KUNT.
//
// WAAROM DIT OPEN VALT ALS /api/me NIET ANTWOORDT
//
// Zolang O1_AUTH_ENFORCED uit staat is er geen sessie en geeft /api/me een 401. Zou de hook
// dan dichtvallen, dan verdwijnt vandaag de hele beurslijst uit de sidebar voor iedereen.
// Openvallen is hier veilig omdat het alleen kan gebeuren wanneer de enforcement uit staat:
// staat hij AAN, dan stuurt de middleware een verzoek zonder sessie naar /login voordat deze
// component ooit rendert. Een ingelogde gebruiker zonder rol is een ander geval — die krijgt
// een 200 met een lege rechtenlijst, en valt dus wel degelijk dicht.
//
// ÉÉN VERZOEK PER PAGINA, NIET ÉÉN PER MOUNT
//
// De zijbalk, het zijbalklogo en het gebruikersmenu mounten deze hook alle drie bij het laden,
// en elk deed een eigen fetch: drie keer /api/me voor één antwoord dat per sessie vaststaat.
// Het antwoord staat nu in één module-niveau promise (zelfde patroon als `onderweg` in
// lib/use-blended-client-data.ts): wie tegelijk mount wacht op het lopende verzoek, wie later
// mount leest het bewaarde antwoord. Een mislukt antwoord wordt niet bewaard, zodat een
// volgende mount het opnieuw probeert. Inloggen laadt de pagina volledig opnieuw
// (app/(marketing)/login/page.tsx zet window.location.href), dus een nieuwe sessie begint altijd
// met een lege module; uitloggen vergeet het antwoord expliciet via vergeetToegang.

import { useEffect, useState } from "react";
import { ALL_CLIENTS, canAccessClient, type Capability, type ClientScope, type Role } from "./roles";

export interface Access {
  role: Role | null;
  loading: boolean;
  /** Heeft de ingelogde gebruiker dit recht? */
  can: (capability: Capability) => boolean;
  /** Mag de ingelogde gebruiker bij deze beurs? */
  canAccessClient: (clientId: string | null | undefined) => boolean;
  /** Beurzen waar deze gebruiker bij mag, of "all". */
  scope: ClientScope;
  /** Er wordt niet gefilterd: geen sessie omdat de enforcement uit staat. */
  unrestricted: boolean;
  /**
   * /api/me bevestigde een sessie (enforced: true). Het spiegelbeeld van `unrestricted`, maar
   * onder de naam die telt op de plekken die een sessie NODIG hebben: routes achter
   * requireCapability (code-rood, sop-dekking, datastand) geven zonder sessie gegarandeerd 401,
   * dus die worden pas aangeroepen als dit true is. Zolang `loading` true is, is dit nog onbekend.
   */
  ingelogd: boolean;
  /** Het e-mailadres van de ingelogde gebruiker, voor het gebruikersmenu. Null zonder sessie. */
  email: string | null;
  /** Het eigen bureau, voor white-label-logoresolutie. Null zonder sessie of zonder bureau. */
  agencyId: string | null;
  /** Mag dit bureau een eigen logo tonen in de app-shell? Door een platformbeheerder gezet. */
  whitelabelActief: boolean;
  /** Staat deze gebruiker in platform_beheerders? Bepaalt o.a. of hij adminrechten mag toekennen. */
  isPlatform: boolean;
}

interface MeResponse {
  /** False zolang O1_AUTH_ENFORCED uit staat: dan wordt er niet gefilterd. */
  enforced?: boolean;
  email?: string | null;
  role?: Role | null;
  capabilities?: Capability[];
  scope?: ClientScope;
  agencyId?: string | null;
  whitelabelActief?: boolean;
  isPlatform?: boolean;
}

// Het ene verzoek, met zijn vertrektijd. Vijf minuten, zoals de datacaches: een rol die een
// beheerder tussendoor wijzigt is na een paginaherlaad of na die vijf minuten zichtbaar, en de
// server-guard liet er intussen toch al niets door dat niet mag.
const CACHE_TTL = 5 * 60 * 1000;
let bewaard: { verzoek: Promise<MeResponse | null>; timestamp: number } | null = null;
// Het laatst binnengekomen antwoord, zodat een mount binnen de TTL meteen de juiste staat heeft
// in plaats van één render lang "laden" te tonen.
let laatste: MeResponse | null = null;

function haalMe(): Promise<MeResponse | null> {
  if (bewaard && Date.now() - bewaard.timestamp < CACHE_TTL) return bewaard.verzoek;
  const eigen = {
    verzoek: fetch("/api/me")
      .then(async (res) => (res.ok ? ((await res.json()) as MeResponse) : null))
      .catch(() => null)
      .then((data) => {
        // Geen antwoord (netwerkfout, 401) blijft niet vijf minuten hangen: de volgende mount
        // probeert opnieuw, precies zoals elke mount dat vóór de dedupe deed.
        if (data) laatste = data;
        else if (bewaard === eigen) bewaard = null;
        return data;
      }),
    timestamp: Date.now(),
  };
  bewaard = eigen;
  return eigen.verzoek;
}

/** Vergeet het bewaarde /api/me-antwoord. Aan te roepen bij uitloggen, en in tests. */
export function vergeetToegang(): void {
  bewaard = null;
  laatste = null;
}

function uitCache(): MeResponse | undefined {
  return bewaard && laatste && Date.now() - bewaard.timestamp < CACHE_TTL ? laatste : undefined;
}

export function useAccess(): Access {
  // undefined: nog onderweg. null: geen bruikbaar antwoord (de hook valt dan open, zie boven).
  const [me, setMe] = useState<MeResponse | null | undefined>(uitCache);

  useEffect(() => {
    let live = true;
    haalMe().then((data) => {
      if (live) setMe(data);
    });
    return () => {
      live = false;
    };
  }, []);

  // De server zegt expliciet of er gehandhaafd wordt, in plaats van dat we het uit een 401
  // moeten afleiden. Staat de handhaving uit, dan blijft alles zichtbaar.
  const sessie = me != null && me.enforced !== false;
  const capabilities: readonly Capability[] = sessie ? (me.capabilities ?? []) : [];
  const scope: ClientScope = sessie ? (me.scope === ALL_CLIENTS ? ALL_CLIENTS : (me.scope ?? [])) : [];
  const unrestricted = !sessie;

  return {
    role: sessie ? (me.role ?? null) : null,
    loading: me === undefined,
    scope,
    unrestricted,
    ingelogd: sessie,
    email: me?.email ?? null,
    agencyId: me?.agencyId ?? null,
    whitelabelActief: me?.whitelabelActief ?? false,
    isPlatform: me?.isPlatform ?? false,
    can: (capability) => unrestricted || capabilities.includes(capability),
    canAccessClient: (clientId) => unrestricted || canAccessClient(scope, clientId),
  };
}
