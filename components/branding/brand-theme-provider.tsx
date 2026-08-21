"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { resolveEventTheme, type BrandVisualIdentity, type EventTheme } from "@/lib/branding/theme";
import { resolveBranding, type GeoCloneBranding } from "@/lib/fair/geo-clone-settings";

// BrandThemeProvider — trekt de merkidentiteit (kleuren, logo, font) van de ACTIEVE klant/beurs
// door naar het hele dashboard. Dit is de ontbrekende schakel: het thema-systeem in
// lib/branding/theme bestond al, maar niemand paste het toe. Hier zetten we de --brand-* (en de
// bijhorende shadcn/sidebar) CSS-variabelen op de document-root, zodat de chrome — menu, headers,
// knoppen, accenten — meekleurt met het merk i.p.v. het standaardblauw.
//
// Per beurs: is er een geo-clone-branding-override, dan wint die; anders het account. Verlaat je
// de klantpagina, dan draaien we de variabelen terug (cleanup) naar de standaard huisstijl.

interface BrandContextValue {
  theme: EventTheme;
  brandName: string | null;
  loaded: boolean;
  /** Kleurt het hele dashboard-chrome mee (zijbalk, knoppen, accenten), of alleen de
   *  klant-eigen widgets die `theme` rechtstreeks lezen (bv. BrandHeaderBar)? Zie migratie 101:
   *  alleen waar een platformbeheerder dit expliciet aanzette, of het bureau whitelabel afneemt. */
  fullBranding: boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

export function useBrandTheme(): BrandContextValue {
  return useContext(BrandContext) ?? { theme: resolveEventTheme(null), brandName: null, loaded: false, fullBranding: false };
}

// De variabelen die we op de root zetten. Merk-tokens + de shadcn/sidebar-tokens die anders het
// standaardblauw vasthouden, zodat de héle chrome (incl. de blauwe sidebar) meekleurt.
function brandVars(theme: EventTheme): Record<string, string> {
  const primaryLight = `color-mix(in srgb, ${theme.primary} 82%, white)`;
  const accentLight = `color-mix(in srgb, ${theme.accent} 82%, white)`;
  return {
    "--brand-primary": theme.primary,
    "--brand-primary-contrast": theme.primaryForeground,
    "--brand-primary-light": primaryLight,
    "--brand-accent": theme.accent,
    "--brand-accent-contrast": theme.accentForeground,
    "--brand-accent-light": accentLight,
    // shadcn-tokens die het merk moeten volgen
    "--primary": theme.primary,
    "--primary-foreground": theme.primaryForeground,
    "--accent": theme.accent,
    "--accent-foreground": theme.accentForeground,
    "--ring": theme.primary,
    "--secondary-foreground": theme.primary,
    "--chart-1": theme.primary,
    "--chart-2": theme.accent,
    // sidebar
    "--sidebar": theme.primary,
    "--sidebar-primary": theme.accent,
    "--sidebar-accent": primaryLight,
    "--sidebar-ring": theme.accent,
    // typografie
    "--font-heading": theme.headingFont,
  };
}

export function BrandThemeProvider({
  clientId,
  geoClone,
  children,
}: {
  clientId: string;
  geoClone?: string | null;
  children: React.ReactNode;
}) {
  const [identity, setIdentity] = useState<BrandVisualIdentity | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fullBranding, setFullBranding] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setLoaded(true); return; }
    let cancelled = false;
    setLoaded(false);

    (async () => {
      // Account-branding uit de brand guide, en of het chrome mee mag kleuren (migratie 101) --
      // parallel, want geen van beide hangt van de ander af.
      const [{ data: cs }, scopeRes] = await Promise.all([
        dbSelectOne<{ brand_guide: unknown }>("client_settings", { select: "brand_guide", clientId }),
        fetch(`/api/branding/scope?clientId=${encodeURIComponent(clientId)}`).then((r) => r.json()).catch(() => null),
      ]);
      const guide = (cs?.brand_guide ?? {}) as { brandName?: string; visual?: BrandVisualIdentity };
      const accountBranding: GeoCloneBranding = { brandName: guide.brandName ?? null, ...(guide.visual ?? {}) };

      // Per-beurs override (tabel kan ontbreken → dan geen override, account wint).
      let override: GeoCloneBranding | null = null;
      if (geoClone) {
        try {
          const { data: gc } = await dbSelectOne<{ branding: unknown }>("geo_clone_settings", {
            select: "branding", clientId, filters: [{ op: "eq", column: "geo_clone", value: geoClone }],
          });
          override = (gc?.branding ?? null) as GeoCloneBranding | null;
        } catch { override = null; }
      }
      if (cancelled) return;

      const resolved = resolveBranding(accountBranding, override).effective;
      setIdentity(resolved);
      setBrandName(resolved.brandName ?? guide.brandName ?? null);
      setFullBranding(Boolean((scopeRes as { fullBrandingEnabled?: boolean } | null)?.fullBrandingEnabled));
      setLoaded(true);
    })().catch(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  }, [clientId, geoClone]);

  const theme = useMemo(() => resolveEventTheme(identity), [identity]);

  // Zet de variabelen op de document-root en draai ze bij het verlaten weer terug -- alleen als
  // het hele chrome mee mag kleuren (migratie 101). Zonder fullBranding blijft de root op de
  // standaard Ctrl PPC-huisstijl staan; `theme`/`brandName` blijven wel via de context
  // beschikbaar voor widgets die een klant altijd al herkenbaar tonen (bv. BrandHeaderBar, die
  // zijn eigen gradient rechtstreeks uit `theme` leest, niet uit deze CSS-variabelen).
  useEffect(() => {
    if (!loaded || !fullBranding) return;
    const root = document.documentElement;
    const vars = brandVars(theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => { for (const k of Object.keys(vars)) root.style.removeProperty(k); };
  }, [theme, loaded, fullBranding]);

  const value = useMemo<BrandContextValue>(() => ({ theme, brandName, loaded, fullBranding }), [theme, brandName, loaded, fullBranding]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
