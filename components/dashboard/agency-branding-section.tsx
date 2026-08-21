"use client";

import { useState, useEffect } from "react";
import { ImageIcon, Upload, Trash2, Palette, Save, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccess } from "@/lib/auth/use-access";
import { AGENCY_LOGO_BUCKET, agencyLogoPath, agencyLogoUrl } from "@/lib/branding/agency-logo";
import type { BrandVisualIdentity } from "@/lib/branding/theme";

type GuideShape = { visual?: BrandVisualIdentity } & Record<string, unknown>;

const COLOR_FIELDS: { key: keyof BrandVisualIdentity; label: string }[] = [
  { key: "primaryColor", label: "Primaire kleur" },
  { key: "accentColor", label: "Accentkleur" },
  { key: "secondaryColor", label: "Secundaire kleur" },
];

// Zelfde editor als BrandingView (client_settings.brand_guide), nu tegen agencies.brand_guide via
// een eigen route (app/api/agency/branding/route.ts) i.p.v. de generieke /api/data/[table] --
// agencies staat daar met opzet niet in. Alleen zichtbaar/bewerkbaar zolang whitelabelActief
// staat, zelfde voorwaarde als het logo hierboven.
function AgencyColorEditor({ agencyId }: { agencyId: string }) {
  const [guide, setGuide] = useState<GuideShape | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGuide(null); setError(null); setSaved(false);
    fetch(`/api/agency/branding?agencyId=${encodeURIComponent(agencyId)}`)
      .then((res) => res.json())
      .then((data: { brandGuide?: GuideShape; error?: string }) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setGuide({ ...(data.brandGuide ?? {}), visual: data.brandGuide?.visual ?? {} });
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "onbekende fout"); });
    return () => { cancelled = true; };
  }, [agencyId]);

  function setVisual(key: keyof BrandVisualIdentity, value: string) {
    setGuide((g) => g ? { ...g, visual: { ...g.visual, [key]: value } } : g);
    setSaved(false);
  }

  async function save() {
    if (!guide) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/agency/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyId, brandGuide: guide }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || data?.error) { setError(data?.error ?? `HTTP ${res.status}`); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  }

  if (error && !guide) {
    return <p className="text-meta text-red-500 mt-3">{error}</p>;
  }
  if (!guide) {
    return <div className="flex items-center gap-2 text-meta text-muted-foreground py-4"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Laden...</div>;
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-1">
        <Palette className="w-4 h-4 text-brand-blue-ink" />
        <h3 className="text-body font-semibold text-brand-gray">Bureaubrede kleuren</h3>
      </div>
      <p className="text-meta text-muted-foreground mb-3">
        Deze kleuren gelden voor het hele dashboard, voor elke klant die je bureau beheert — anders
        dan de merkkleuren op een klant se eigen instellingenpagina, die alleen die ene klant raken.
      </p>
      <div className="space-y-3 max-w-sm">
        {COLOR_FIELDS.map(({ key, label }) => {
          const val = (guide.visual?.[key] as string) ?? "";
          return (
            <label key={key} className="block">
              <span className="text-meta font-medium text-brand-gray">{label}</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={/^#([0-9a-fA-F]{6})$/.test(val) ? val : "#000000"}
                  onChange={(e) => setVisual(key, e.target.value)}
                  className="h-9 w-12 rounded border border-border cursor-pointer"
                />
                <input
                  type="text"
                  value={val}
                  placeholder="#2563EB"
                  onChange={(e) => setVisual(key, e.target.value)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-lead font-mono focus:border-brand-blue/50 focus:outline-none"
                />
              </div>
            </label>
          );
        })}
      </div>
      {error && <p className="text-meta text-red-500 mt-3">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 flex items-center gap-2 px-4 py-2 rounded-md bg-brand-blue text-white text-body font-medium hover:bg-brand-blue/90 disabled:opacity-50 transition-all"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Kleuren opslaan"}
      </button>
    </div>
  );
}

// Huisstijl: eigen logo in de zijbalk in plaats van het Ctrl PPC-icoon. Alleen zichtbaar als
// whitelabel_actief staat voor het eigen bureau (migratie 068, door een platformbeheerder gezet
// -- geen zelfbedieningsknop). Zonder die vlag rendert deze component niets: geen grijze,
// uitgeschakelde sectie die een recht suggereert dat er niet is.
//
// Zelfde upload/verwijder-patroon als het klantlogo in client-settings.tsx, maar tegen de
// publieke agency-logos-bucket en zonder signed URL -- zie lib/branding/agency-logo.ts voor
// waarom dat bewust publiek is.
export function AgencyBrandingSection() {
  const { agencyId, whitelabelActief, loading } = useAccess();
  const [uploading, setUploading] = useState(false);
  const [cacheBust, setCacheBust] = useState<number>(() => Date.now());
  // null = nog aan het laden (probe-<img> heeft nog niet load/error gemeld). Zo toont deze
  // sectie bij een bureau dat al eerder een logo uploadde meteen dat logo, in plaats van eerst
  // altijd de uploadprompt te tonen alsof er nog nooit iets is geplaatst.
  const [exists, setExists] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading || !whitelabelActief || !agencyId) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previewUrl = agencyLogoUrl(agencyId, supabaseUrl, cacheBust);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !supabase || !agencyId) return;
    setUploading(true);
    setError(null);
    try {
      const { error: uploadError } = await supabase.storage
        .from(AGENCY_LOGO_BUCKET)
        .upload(agencyLogoPath(agencyId), file, { contentType: file.type, upsert: true });
      if (uploadError) { setError(uploadError.message); return; }
      setExists(true);
      setCacheBust(Date.now());
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!supabase || !agencyId) return;
    await supabase.storage.from(AGENCY_LOGO_BUCKET).remove([agencyLogoPath(agencyId)]);
    setExists(false);
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ImageIcon className="w-5 h-5 text-brand-blue-ink" />
        <h2 className="text-title font-semibold text-brand-blue-ink">Huisstijl</h2>
      </div>
      <p className="text-body text-muted-foreground mb-4">
        Upload het eigen logo van je bureau. Dit vervangt het Ctrl PPC-icoon in de zijbalk voor
        iedereen bij jouw bureau; zonder upload blijft het standaardicoon staan.
      </p>
      {error && <p className="mb-3 text-body text-red-600">{error}</p>}
      <div className="flex items-center gap-4">
        {exists !== false && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl ?? undefined}
            alt="Bureaulogo"
            className={`h-12 max-w-[200px] object-contain rounded border border-border p-1 ${exists ? "" : "hidden"}`}
            onLoad={() => setExists(true)}
            onError={() => setExists(false)}
          />
        )}
        {exists === true && (
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Verwijderen
          </button>
        )}
        {exists === false && (
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-brand-blue/40 cursor-pointer transition-colors">
            {uploading ? (
              <span className="text-body text-muted-foreground">Uploaden...</span>
            ) : (
              <>
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-body text-muted-foreground">Logo uploaden (PNG)</span>
              </>
            )}
            <input type="file" accept="image/png" onChange={handleUpload} className="hidden" />
          </label>
        )}
      </div>

      <AgencyColorEditor agencyId={agencyId} />
    </div>
  );
}
