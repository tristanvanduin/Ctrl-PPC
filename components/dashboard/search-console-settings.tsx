"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbUpsert } from "@/lib/data-access/client-write";
import { dbSelectOne } from "@/lib/data-access/client-read";
import type { GscConfig } from "@/lib/search-console/types";

// Per-klant Search Console-configuratie: site-URL en de merktermenlijst. Opgeslagen in
// client_settings.search_console_config (migratie 095). brandTerms is met opzet handmatige
// invoer — zie de migratie se opmerking over waarom dit nooit uit Ads-campagnenamen mag komen.

function parseList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function SearchConsoleSettings({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<GscConfig | null>(null);
  const [brandTermsInput, setBrandTermsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setConfig(null); setError(null); setSaved(false);
    dbSelectOne<{ search_console_config: unknown }>("client_settings", { select: "search_console_config", clientId })
      .then(({ data }) => {
        if (cancelled) return;
        const raw = data?.search_console_config as Partial<GscConfig> | null | undefined;
        const c: GscConfig = { siteUrl: raw?.siteUrl ?? "", brandTerms: raw?.brandTerms ?? [] };
        setConfig(c);
        setBrandTermsInput(c.brandTerms.join(", "));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  async function save() {
    const sb = supabase;
    if (!sb || !config) return;
    setSaving(true); setError(null);
    const clean: GscConfig = { siteUrl: config.siteUrl.trim(), brandTerms: parseList(brandTermsInput) };
    const { error } = await dbUpsert("client_settings", clientId, { search_console_config: clean });
    setSaving(false);
    if (error) setError(error.message);
    else { setConfig(clean); setSaved(true); setTimeout(() => setSaved(false), 4000); }
  }

  if (error && !config) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!config) {
    return <div className="flex items-center gap-2 text-body text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Search className="w-5 h-5 text-rm-blue-ink" />
        <h2 className="text-base font-semibold text-rm-blue-ink">Google Search Console</h2>
      </div>
      <p className="text-meta text-muted-foreground mb-4">
        Verifieert merk-cannibalisatie onafhankelijk van de campagnenaamgeving en signaleert
        positieverval. Vereist een actieve Search Console-koppeling bij het bureau (Instellingen)
        — deze kaart bepaalt alleen wélke site en merktermen.
      </p>

      <div className="space-y-4">
        <label className="block">
          <span className="text-body font-medium text-rm-gray">Site-URL</span>
          <input
            type="text"
            value={config.siteUrl}
            onChange={(e) => setConfig((c) => c && { ...c, siteUrl: e.target.value })}
            placeholder="https://www.klant.nl/"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-body font-mono"
          />
          <span className="block text-micro text-muted-foreground mt-1">Precies zoals geverifieerd in Search Console (met of zonder www., inclusief slash).</span>
        </label>

        <label className="block">
          <span className="text-body font-medium text-rm-gray">Merktermen</span>
          <input
            type="text"
            value={brandTermsInput}
            onChange={(e) => setBrandTermsInput(e.target.value)}
            placeholder="klantnaam, klant bv"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-body font-mono"
          />
          <span className="block text-micro text-muted-foreground mt-1">
            Kommagescheiden, handmatig ingevoerd — nooit afgeleid uit campagnenamen. Dat is precies
            wat de merk-cannibalisatie-check onafhankelijk maakt.
          </span>
        </label>
      </div>

      {error && <p className="text-meta text-red-500 mt-3">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-5 flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-body font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Search Console-configuratie opslaan"}
      </button>
    </div>
  );
}
