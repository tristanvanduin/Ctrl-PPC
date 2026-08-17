"use client";

// De klantenlijst.
//
// ── WAAROM DIT ER NU STAAT ──────────────────────────────────────────────────
//
// Hier stond "Klantenlijst wordt gebouwd in fase 4" in een leeg vlak van 384 pixels hoog. Dat is
// het eerste scherm dat iemand ziet die de app opent, en het zegt dus als eerste dat het product
// nog niet af is -- terwijl de klanten er wel degelijk zijn en de dashboards eronder werken.
//
// Dit is niet de volledige fase 4 (geen prestatiecijfers per klant, geen sortering, geen groepen).
// Het is de ontbrekende SCHAKEL: de klanten die de zijbalk al kent, als klikbare kaarten. Zonder
// dit is een klantdashboard alleen bereikbaar door de URL in te typen.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getVisibleClients, loadVisibleClientIds } from "@/lib/visible-clients";
import { loadApiClients } from "@/lib/clients";

interface Rij {
  id: string;
  name: string;
  source: string;
}

export default function ClientsPage() {
  const [klanten, setKlanten] = useState<Rij[] | null>(null);

  useEffect(() => {
    let afgebroken = false;

    // EERST tonen wat lokaal al bekend is, en pas daarna bijwerken.
    //
    // De eerste versie wachtte op Promise.allSettled van de twee Supabase-loads. Gemeten op
    // localhost zonder bereikbare backend: die settelden niet binnen zeven seconden, en de pagina
    // bleef op zijn skeletten staan. allSettled beschermt tegen een FOUT, niet tegen wachten.
    //
    // getVisibleClients() leest uit de lokale registratie plus localStorage en heeft die calls
    // helemaal niet nodig -- in demo-modus zit de demoklant er al in. De netwerkkant is een
    // aanvulling (gedeelde zichtbaarheid tussen collega's), geen voorwaarde.
    setKlanten(getVisibleClients() as Rij[]);

    Promise.allSettled([loadApiClients(), loadVisibleClientIds()]).then(() => {
      if (!afgebroken) setKlanten(getVisibleClients() as Rij[]);
    });
    return () => { afgebroken = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page font-bold text-brand-blue-ink">Klanten</h1>
        {/* Hier stond "Overzicht van alle klantaccounts en hun prestaties." De prestaties staan
            er niet: een kaart toont een naam, initialen en of het demodata is. Een ondertitel die
            iets belooft wat het scherm eronder niet levert, is de goedkoopste manier om een
            product minder te vertrouwen. Wie de cijfers per klant wil, hoort hier te lezen waar
            ze wél staan. */}
        <p className="mt-1 text-body text-muted-foreground">
          Kies een account om het dashboard te openen. Cijfers naast elkaar per klant staan onder{" "}
          <Link href="/portfolio" className="font-medium text-brand-blue-ink underline underline-offset-2">
            Portfolio
          </Link>
          .
        </p>
      </div>

      {klanten === null ? (
        // Skeletten en geen spinner: de vorm van wat er komt, zodat het scherm niet verspringt.
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[4.5rem] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : klanten.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-body text-brand-gray">Er zijn nog geen klantaccounts gekoppeld.</p>
          <p className="text-meta text-muted-foreground mt-1">
            Koppel een account via Instellingen, of open de demo met{" "}
            <code className="rounded bg-muted px-1 py-0.5">?demo=1</code> in de URL.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {klanten.map((c) => (
            <Link
              key={c.id}
              href={`/client/${c.id}`}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-brand-blue hover:bg-gray-50/70"
            >
              {/* Initialen in plaats van een logo: elke klant heeft een naam, niet elke klant een
                  merkbestand. Zo is de rij visueel gelijk zonder gaten. */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-meta font-semibold text-brand-blue-ink">
                {c.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-brand-gray">{c.name}</span>
                {/* "demodata" staat er expliciet bij. Een demoklant die eruitziet als een echte is
                    precies het soort verwarring dat je in een demonstratie niet wilt. */}
                {c.source === "demo" && (
                  <span className="block text-micro text-muted-foreground">demodata</span>
                )}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
