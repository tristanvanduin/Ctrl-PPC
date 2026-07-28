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
}

interface MeResponse {
  /** False zolang O1_AUTH_ENFORCED uit staat: dan wordt er niet gefilterd. */
  enforced?: boolean;
  role?: Role | null;
  capabilities?: Capability[];
  scope?: ClientScope;
}

export function useAccess(): Access {
  const [role, setRole] = useState<Role | null>(null);
  const [capabilities, setCapabilities] = useState<readonly Capability[]>([]);
  const [scope, setScope] = useState<ClientScope>([]);
  const [unrestricted, setUnrestricted] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/me")
      .then(async (res) => (res.ok ? ((await res.json()) as MeResponse) : null))
      .then((data) => {
        if (!live || !data) return;
        // De server zegt nu expliciet of er gehandhaafd wordt, in plaats van dat we het uit een
        // 401 moeten afleiden. Staat de handhaving uit, dan blijft alles zichtbaar.
        if (data.enforced === false) return;
        setUnrestricted(false);
        setRole(data.role ?? null);
        setCapabilities(data.capabilities ?? []);
        setScope(data.scope === ALL_CLIENTS ? ALL_CLIENTS : (data.scope ?? []));
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return {
    role,
    loading,
    scope,
    unrestricted,
    can: (capability) => unrestricted || capabilities.includes(capability),
    canAccessClient: (clientId) => unrestricted || canAccessClient(scope, clientId),
  };
}
