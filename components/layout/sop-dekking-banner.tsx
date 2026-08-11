"use client";

// De dekkingsmelding: zichtbaar zolang het eigen bureau meer accounts met automatische SOP's aan
// heeft dan zijn tier dekt. Geen dismiss-knop -- dat zou "moeten kiezen" (zie het gesprek over het
// tier-model) reduceren tot "kan genegeerd worden". De banner verdwijnt pas als de onderliggende
// staat klopt: upgraden, bijkopen (beide nog geen betaalde flow, dus "neem contact op"), of SOP's
// uitzetten voor genoeg accounts -- dat laatste is hier wel echt te doen.
//
// Onzichtbaar voor wie geen settings:write heeft: /api/tenancy/sop-dekking geeft dan een 403, en
// die wordt hier stil als "geen banner" gelezen. Dit is geen scherm voor een viewer-rol.

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

interface Account {
  id: string;
  name: string;
  sops_enabled: boolean;
}

interface Oordeel {
  toestand: "binnen_dekking" | "overschreden";
  aantalMetSops: number;
  limiet: number;
  overtal?: number;
  ruimte?: number;
  tekst?: string;
}

export function SopDekkingBanner() {
  const [oordeel, setOordeel] = useState<Oordeel | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);

  async function herlaad() {
    try {
      const res = await fetch("/api/tenancy/sop-dekking");
      if (!res.ok) { setOordeel(null); return; }
      const data = await res.json();
      setOordeel(data.oordeel ?? null);
      setAccounts(data.accounts ?? []);
    } catch {
      setOordeel(null);
    }
  }

  useEffect(() => {
    herlaad();
  }, []);

  if (!oordeel || oordeel.toestand !== "overschreden") return null;

  const aanAccounts = accounts.filter((a) => a.sops_enabled);

  async function zetSops(accountId: string, enabled: boolean) {
    setBezig(accountId);
    try {
      await fetch("/api/tenancy/sop-dekking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, enabled }),
      });
      await herlaad();
    } finally {
      setBezig(null);
    }
  }

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm text-amber-900 dark:text-amber-200">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{oordeel.tekst}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href="mailto:info@ctrlppc.com?subject=Upgrade%20of%20extra%20SOP-dekking"
            className="rounded-[6px] border border-amber-500/40 px-3 py-1.5 font-semibold hover:bg-amber-500/10"
          >
            Upgrade of dekking bijkopen
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 rounded-[6px] border border-amber-500/40 px-3 py-1.5 font-semibold hover:bg-amber-500/10"
          >
            SOP&apos;s uitzetten
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-[6px] border border-amber-500/20 bg-black/5 p-3 dark:bg-white/5">
          <p className="mb-2 text-xs text-amber-900/70 dark:text-amber-200/70">
            Zet SOP&apos;s uit voor tenminste {oordeel.overtal} {oordeel.overtal === 1 ? "account" : "accounts"} om
            weer binnen de dekking te komen.
          </p>
          <ul className="space-y-1.5">
            {aanAccounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{account.name}</span>
                <button
                  type="button"
                  disabled={bezig === account.id}
                  onClick={() => zetSops(account.id, false)}
                  className="shrink-0 rounded-[6px] border border-amber-500/40 px-2 py-1 text-xs font-semibold hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {bezig === account.id ? "Bezig..." : "Uitzetten"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
