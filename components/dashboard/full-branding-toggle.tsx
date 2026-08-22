"use client";

import { useEffect, useState } from "react";
import { Loader2, Palette } from "lucide-react";
import { useAccess } from "@/lib/auth/use-access";

// Zet client_settings.full_branding_enabled (migratie 101): laat het hele dashboard-chrome
// (niet alleen de hero) meekleuren met deze klant se brand_guide. Alleen zichtbaar voor een
// platformbeheerder (user:manage) -- geen zelfbedieningsknop op de eigen instellingenpagina van
// een klant, zelfde reden als whitelabel_actief in agency-branding-section.tsx: dit is een knop
// op het beheerscherm, niet iets dat een klant voor zichzelf aanzet. Met opzet geen naam- of
// klant-specifieke check hier of in de API-route -- alleen deze generieke aan/uit-vlag.
export function FullBrandingToggle({ clientId }: { clientId: string }) {
  const { can, loading: accessLoading } = useAccess();
  const [actief, setActief] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const magBeheren = can("user:manage");

  useEffect(() => {
    if (!magBeheren) return;
    let cancelled = false;
    fetch(`/api/admin/full-branding?clientId=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((data: { fullBrandingEnabled?: boolean; error?: string }) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setActief(Boolean(data.fullBrandingEnabled));
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "onbekende fout"); });
    return () => { cancelled = true; };
  }, [clientId, magBeheren]);

  async function toggle() {
    if (actief === null) return;
    const volgende = !actief;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/admin/full-branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, actief: volgende }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || data?.error) { setError(data?.error ?? `HTTP ${res.status}`); return; }
      setActief(volgende);
    } finally {
      setSaving(false);
    }
  }

  if (accessLoading || !magBeheren) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Palette className="w-5 h-5 text-brand-blue-ink" />
        <h2 className="text-title font-semibold text-brand-blue-ink">Volledige branding (beheerder)</h2>
      </div>
      <p className="text-body text-muted-foreground mb-4">
        Laat het hele dashboard-chrome — zijbalk, knoppen, accenten — meekleuren met de merkkleuren
        hierboven, niet alleen de hero. Standaard uit: de meeste klanten zien het standaard
        Ctrl PPC-dashboard. Alleen aan te zetten door een platformbeheerder.
      </p>
      {error && <p className="text-meta text-red-500 mb-3">{error}</p>}
      {actief === null ? (
        // Een mislukte fetch zet nooit `actief` -- die blijft de initiele null-sentinel voor
        // "nog niet geladen". Zonder de !error-guard bleef de spinner hier voor altijd draaien
        // NAAST de foutmelding erboven: geen bug die zichzelf herstelt, want er komt geen tweede
        // poging. Bij een fout tonen we alleen de foutmelding, geen knop (actief is echt onbekend).
        !error && <div className="flex items-center gap-2 text-meta text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Laden...</div>
      ) : (
        <button
          onClick={toggle}
          disabled={saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-body font-medium transition-all disabled:opacity-50 ${
            actief ? "bg-brand-blue text-white hover:bg-brand-blue/90" : "border border-border text-brand-gray hover:bg-gray-50"
          }`}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {actief ? "Aan — klik om uit te zetten" : "Uit — klik om aan te zetten"}
        </button>
      )}
    </div>
  );
}
