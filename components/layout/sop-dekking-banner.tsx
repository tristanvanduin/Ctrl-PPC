"use client";

// De dekkingsmelding: zichtbaar zolang het eigen bureau meer accounts met automatische SOP's aan
// heeft dan zijn tier dekt. Wegklikbaar voor déze sessie (eigenaar wil zelf kunnen kiezen "later"),
// maar keert terug bij een nieuwe paginalaad zolang de onderliggende staat niet klopt: upgraden,
// bijkopen (beide nog geen betaalde flow, dus "neem contact op"), of SOP's uitzetten voor genoeg
// accounts -- dat laatste is hier wel echt te doen.
//
// Onzichtbaar voor wie geen settings:write heeft: /api/tenancy/sop-dekking geeft dan een 403, en
// die wordt hier stil als "geen banner" gelezen. Dit is geen scherm voor een viewer-rol.
//
// GEEN dark:-varianten op de amber-klassen hieronder, met opzet. app/globals.css keert onder
// `.dark` de hele Tailwind-kleurenschaal om (amber-100 wordt daar de donkere tint, amber-900 de
// lichte) juist zodat gewone, in licht-modus geschreven combinaties als `bg-amber-50 text-amber-700`
// vanzelf goed lezen in het donker. Dit component had eerder wél een losse `dark:text-amber-200`
// erbovenop -- die selecteerde onder die omkering per ongeluk een van de DONKERE tinten, wat de
// meest waarschijnlijke verklaring is voor de gemelde onleesbaarheid in donker. Zie CodeRoodBanner
// voor hetzelfde patroon (ook zonder dark:-varianten op zijn amber/rood-klassen).

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";

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
  const [dismissed, setDismissed] = useState(false);

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

  if (!oordeel || oordeel.toestand !== "overschreden" || dismissed) return null;

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
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-700">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{oordeel.tekst}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href="mailto:info@ctrlppc.com?subject=Upgrade%20of%20extra%20SOP-dekking"
            className="rounded-[6px] border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-100"
          >
            Upgrade of dekking bijkopen
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 rounded-[6px] border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-100"
          >
            SOP&apos;s uitzetten
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Melding sluiten"
            className="shrink-0 rounded p-0.5 hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-[6px] border border-amber-200 bg-black/5 p-3 dark:bg-white/5">
          <p className="mb-2 text-xs text-amber-700/80">
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
                  className="shrink-0 rounded-[6px] border border-amber-300 px-2 py-1 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50"
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
