"use client";

import { useState } from "react";
import { useAccess } from "@/lib/auth/use-access";
import { agencyLogoUrl } from "@/lib/branding/agency-logo";
import { LogoMark } from "@/components/ui/logo";

// Standaard het Ctrl PPC-icoon; alleen als het eigen bureau whitelabel_actief heeft EN
// daadwerkelijk een logo heeft geupload, verschijnt dat icoon in plaats daarvan. `broken` vangt
// zowel "geen upload" als "whitelabel net uitgezet maar bestand nog niet verwijderd" af zonder
// een aparte "bestaat dit bestand?"-aanroep: de <img> zelf meldt het via onError.
export function SidebarLogo({ className = "" }: { className?: string }) {
  const { agencyId, whitelabelActief } = useAccess();
  const [broken, setBroken] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = whitelabelActief && agencyId ? agencyLogoUrl(agencyId, supabaseUrl) : null;

  if (!url || broken) return <LogoMark className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Logo"
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
