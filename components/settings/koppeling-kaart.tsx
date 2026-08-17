"use client";

// Gedeelde kaart voor een platformkoppeling op de settingspagina. Toont de echte OAuth-status
// (agency_connections via /api/connections) met een "Verbinden"/"Ontkoppelen"-knop, en valt terug
// op de env-var-instructies (envFallback) zolang er geen koppeling is — zelfde tweesporen-gedrag
// als credentialsVoorBureau in lib/tenancy/credentials.ts.

import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/lib/tenancy/koppelingen";

export interface KoppelingWeergave {
  agencyId: string;
  provider: Provider;
  externalId: string | null;
  scopes: string[];
  status: "actief" | "verlopen" | "ingetrokken" | "fout";
  expiresAt: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  heeftToken: boolean;
}

function beoordeelVervalTekst(expiresAt: string | null): { toestand: "geen_verval" | "ruim" | "binnenkort" | "verlopen"; tekst: string | null } {
  if (!expiresAt) return { toestand: "geen_verval", tekst: null };
  const dagen = Math.floor((Date.parse(expiresAt) - Date.now()) / 86_400_000);
  if (dagen < 0) return { toestand: "verlopen", tekst: `Verlopen ${Math.abs(dagen)} dag${Math.abs(dagen) === 1 ? "" : "en"} geleden.` };
  if (dagen <= 14) return { toestand: "binnenkort", tekst: `Verloopt over ${dagen} dag${dagen === 1 ? "" : "en"}.` };
  return { toestand: "ruim", tekst: null };
}

interface KoppelingKaartProps {
  provider: Provider;
  label: string;
  beschrijving: string;
  koppeling: KoppelingWeergave | null;
  onGewijzigd: () => void;
  envFallback: React.ReactNode;
  /** Standaard "Alternatief: handmatig via .env.local" — pas aan voor providers zonder los env-pad. */
  envFallbackLabel?: string;
  /** Extra info-regel als de koppeling actief is, bv. het gekozen MCC/property/site. */
  actiefExtra?: React.ReactNode;
}

export function KoppelingKaart({ provider, label, beschrijving, koppeling, onGewijzigd, envFallback, envFallbackLabel, actiefExtra }: KoppelingKaartProps) {
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const isActief = koppeling?.status === "actief" && koppeling.heeftToken;
  const verval = koppeling?.expiresAt ? beoordeelVervalTekst(koppeling.expiresAt) : null;

  function verbind() {
    window.location.href = `/api/oauth/${provider}/start`;
  }

  async function ontkoppel() {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/oauth/${provider}/disconnect`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Ontkoppelen mislukt");
      onGewijzigd();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Ontkoppelen mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-brand-blue-ink text-title">{label}</h3>
        {isActief ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
            <CheckCircle2 className="w-4 h-4" /> Verbonden
          </span>
        ) : koppeling?.status === "fout" || koppeling?.status === "verlopen" ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
            <AlertTriangle className="w-4 h-4" /> {koppeling.status === "verlopen" ? "Verlopen" : "Fout"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <XCircle className="w-4 h-4" /> Niet verbonden
          </span>
        )}
      </div>

      <p className="text-body text-muted-foreground mb-4">{beschrijving}</p>

      {isActief ? (
        <div className="space-y-3">
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 font-medium">Gekoppeld via OAuth</p>
            {koppeling.externalId && <p className="text-xs text-green-700 mt-1">Account: {koppeling.externalId}</p>}
            {verval?.tekst && <p className={`text-xs mt-1 ${verval.toestand === "binnenkort" ? "text-amber-700" : "text-green-700"}`}>{verval.tekst}</p>}
            {actiefExtra}
          </div>
          <Button onClick={ontkoppel} variant="outline" className="w-full gap-2" disabled={bezig}>
            {bezig ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Ontkoppelen
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {koppeling?.lastError && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              Laatste fout: {koppeling.lastError}
            </div>
          )}
          <Button onClick={verbind} className="w-full gap-2">
            Verbinden met {label}
          </Button>
          {fout && <p className="text-xs text-red-700">{fout}</p>}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-brand-gray">{envFallbackLabel ?? "Alternatief: handmatig via .env.local"}</summary>
            <div className="mt-3">{envFallback}</div>
          </details>
        </div>
      )}
    </div>
  );
}
