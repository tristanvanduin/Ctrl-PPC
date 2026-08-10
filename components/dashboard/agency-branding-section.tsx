"use client";

import { useState } from "react";
import { ImageIcon, Upload, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccess } from "@/lib/auth/use-access";
import { AGENCY_LOGO_BUCKET, agencyLogoPath, agencyLogoUrl } from "@/lib/branding/agency-logo";

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
        <ImageIcon className="w-5 h-5 text-rm-blue-ink" />
        <h2 className="text-title font-semibold text-rm-blue-ink">Huisstijl</h2>
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
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-border hover:border-rm-blue/40 cursor-pointer transition-colors">
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
    </div>
  );
}
