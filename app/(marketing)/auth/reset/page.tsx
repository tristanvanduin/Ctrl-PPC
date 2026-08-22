"use client";

// W1.2 (O1): de wachtwoord-reset-landing. De resetmail en de invite-mail landen hier met
// een recovery-sessie; de gebruiker zet het nieuwe wachtwoord via updateUser. Publiek pad
// (isPublicPath dekt /auth/). LIVE-ONGETEST tot de WL.3-activatie.

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [herhaal, setHerhaal] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [klaar, setKlaar] = useState(false);
  const [bezig, setBezig] = useState(false);

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    if (password.length < 8) {
      setMelding("Kies een wachtwoord van minimaal 8 tekens.");
      return;
    }
    if (password !== herhaal) {
      setMelding("De wachtwoorden komen niet overeen.");
      return;
    }
    setBezig(true);
    setMelding(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBezig(false);
    if (error) {
      setMelding("Opslaan mislukt: open de link uit de mail opnieuw en probeer het nog een keer.");
      return;
    }
    setKlaar(true);
  }

  // Zelfde donkere marketing-theming als login/page.tsx (bg-midnight-slate-raised, text-off-white,
  // de #818cf8-accent) -- deze pagina gebruikte tot 22 augustus 2026 een losse set lichte
  // gray-*-klassen, terwijl elke andere pagina op de marketingsite (inclusief de loginpagina
  // ernaast) donker is. Wie op "wachtwoord vergeten" klikt en via de mail hier landt, kwam zo op
  // een pagina die eruitzag alsof hij een ander, onafgemaakt product had geopend.
  if (klaar) {
    return (
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6">
          <h1 className="mb-2 text-lg font-semibold text-off-white">Wachtwoord ingesteld</h1>
          <p className="mb-4 text-sm text-off-white/50">Je kunt nu inloggen met je nieuwe wachtwoord.</p>
          <a href="/login" className="text-sm font-medium text-off-white underline hover:text-off-white/80">Naar inloggen</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-73px)] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6">
        <h1 className="mb-1 text-lg font-semibold text-off-white">Nieuw wachtwoord</h1>
        <p className="mb-5 text-sm text-off-white/50">Ingesteld via de link uit je mail.</p>
        <form onSubmit={opslaan} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-off-white/70">
              Nieuw wachtwoord
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="herhaal" className="mb-1 block text-sm font-medium text-off-white/70">
              Herhaal wachtwoord
            </label>
            <input
              id="herhaal"
              type="password"
              required
              value={herhaal}
              onChange={(e) => setHerhaal(e.target.value)}
              className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
            />
          </div>
          {melding && <p className="text-sm text-amber-waste">{melding}</p>}
          <button
            type="submit"
            disabled={bezig}
            className="w-full rounded-[6px] px-3 py-2 text-sm font-medium text-midnight-slate disabled:opacity-60"
            style={{ backgroundColor: "#818cf8" }}
          >
            {bezig ? "Bezig..." : "Opslaan"}
          </button>
        </form>
      </div>
    </div>
  );
}
