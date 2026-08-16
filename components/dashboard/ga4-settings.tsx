"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, LineChart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbUpsert } from "@/lib/data-access/client-write";
import { dbSelectOne } from "@/lib/data-access/client-read";
import type { Ga4Config } from "@/lib/ga4/types";

// Per-klant GA4-configuratie: welke property, welke events tellen als key event, en de
// funnelvolgorde. Opgeslagen in client_settings.ga4_config (migratie 094). Zonder propertyId +
// minstens één key event blijft GA4 "absent" (lib/ga4/data-access.ts se parseConfig) — dat is
// bewust geen fout, alleen ontbrekende configuratie.

function parseList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function Ga4Settings({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<Ga4Config | null>(null);
  const [keyEventsInput, setKeyEventsInput] = useState("");
  const [funnelStepsInput, setFunnelStepsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setConfig(null); setError(null); setSaved(false);
    dbSelectOne<{ ga4_config: unknown }>("client_settings", { select: "ga4_config", clientId })
      .then(({ data }) => {
        if (cancelled) return;
        const raw = data?.ga4_config as Partial<Ga4Config> | null | undefined;
        const c: Ga4Config = {
          propertyId: raw?.propertyId ?? "",
          keyEvents: raw?.keyEvents ?? [],
          funnelSteps: raw?.funnelSteps ?? [],
        };
        setConfig(c);
        setKeyEventsInput(c.keyEvents.join(", "));
        setFunnelStepsInput(c.funnelSteps.join(", "));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  async function save() {
    const sb = supabase;
    if (!sb || !config) return;
    setSaving(true); setError(null);
    const clean: Ga4Config = {
      propertyId: config.propertyId.trim(),
      keyEvents: parseList(keyEventsInput),
      funnelSteps: parseList(funnelStepsInput),
    };
    const { error } = await dbUpsert("client_settings", clientId, { ga4_config: clean });
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
        <LineChart className="w-5 h-5 text-rm-blue-ink" />
        <h2 className="text-base font-semibold text-rm-blue-ink">Google Analytics 4</h2>
      </div>
      <p className="text-meta text-muted-foreground mb-4">
        Verrijkt de kanaal-analyses met website-/funnelcontext (tracking, CRO, kanaal-
        conversiekloof). Vereist een actieve GA4-koppeling bij het bureau (Instellingen →
        Google Analytics 4) — deze kaart bepaalt alleen wélke property en events.
      </p>

      <div className="space-y-4">
        <label className="block">
          <span className="text-body font-medium text-rm-gray">GA4-property</span>
          <input
            type="text"
            value={config.propertyId}
            onChange={(e) => setConfig((c) => c && { ...c, propertyId: e.target.value })}
            placeholder="properties/123456789"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-body font-mono"
          />
        </label>

        <label className="block">
          <span className="text-body font-medium text-rm-gray">Key events</span>
          <input
            type="text"
            value={keyEventsInput}
            onChange={(e) => setKeyEventsInput(e.target.value)}
            placeholder="form_submit, generate_lead"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-body font-mono"
          />
          <span className="block text-micro text-muted-foreground mt-1">Kommagescheiden GA4-eventnamen die als conversie/key event tellen.</span>
        </label>

        <label className="block">
          <span className="text-body font-medium text-rm-gray">Funnelstappen</span>
          <input
            type="text"
            value={funnelStepsInput}
            onChange={(e) => setFunnelStepsInput(e.target.value)}
            placeholder="session_start, view_item, form_start, form_submit"
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-body font-mono"
          />
          <span className="block text-micro text-muted-foreground mt-1">In volgorde — bepaalt de funnel-doorstroom die in de kanaal-SOP&apos;s wordt getoond.</span>
        </label>
      </div>

      {error && <p className="text-meta text-red-500 mt-3">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-5 flex items-center gap-2 px-4 py-2 rounded-md bg-rm-blue text-white text-body font-medium hover:bg-rm-blue/90 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "GA4-configuratie opslaan"}
      </button>
    </div>
  );
}
