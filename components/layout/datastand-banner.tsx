"use client";

// De stilstandsmelding: zichtbaar boven elke pagina zolang de Google-sync voor minstens één
// klant van het bureau niet meer draait (lib/sync/datastand.ts, samenvatDatastanden). Zonder
// deze banner toonde de app maandenlang dashboards met aprildata zonder dat iemand die niet
// toevallig op de klantbadge keek daar iets van merkte.
//
// Wegklikbaar voor deze sessie, keert terug bij een nieuwe paginalaad zolang de stand niet
// klopt. Zelfde kleurregels als SopDekkingBanner: geen dark:-varianten op de kleurklassen,
// app/globals.css keert de schaal zelf om.

import { useEffect, useState } from "react";
import Link from "next/link";
import { XCircle, AlertTriangle, X } from "lucide-react";

interface Samenvatting {
  toestand: "ok" | "nooit" | "stilstand";
  totaal: number;
  dood: number;
  geen: number;
  tekst: string | null;
}

export function DatastandBanner() {
  const [samenvatting, setSamenvatting] = useState<Samenvatting | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let actief = true;
    fetch("/api/sync/datastand")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (actief) setSamenvatting(data?.samenvatting ?? null); })
      .catch(() => { if (actief) setSamenvatting(null); });
    return () => { actief = false; };
  }, []);

  if (!samenvatting || samenvatting.toestand === "ok" || !samenvatting.tekst || dismissed) return null;

  const stilstand = samenvatting.toestand === "stilstand";
  const kleur = stilstand ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700";
  const knop = stilstand ? "border-red-300 hover:bg-red-100" : "border-amber-300 hover:bg-amber-100";
  const Icoon = stilstand ? XCircle : AlertTriangle;

  return (
    <div className={`border-b px-6 py-3 text-sm ${kleur}`} role="status">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Icoon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{samenvatting.tekst}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/settings" className={`rounded-[6px] border px-3 py-1.5 font-semibold ${knop}`}>
            Koppeling herstellen
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Melding sluiten"
            className={`shrink-0 rounded p-0.5 ${stilstand ? "hover:bg-red-100" : "hover:bg-amber-100"}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
