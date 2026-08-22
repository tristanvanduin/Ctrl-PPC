"use client";

// W1.2 (O1): login met e-mail en wachtwoord. Invite-only: publieke signup staat uit in
// Supabase; accounts ontstaan via de admin-invite (vervolgstap 5e). Wachtwoord-vergeten
// stuurt de standaard Supabase-resetmail. Sessie/cookie-pad inmiddels getest tegen echte
// productie-Supabase (masterplan 15.7); wacht nog op de WL.3-activatie zelf
// (O1_AUTH_ENFORCED=true in Vercel, buiten bereik van deze sessie).

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    setBezig(true);
    setMelding(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBezig(false);
    if (error) {
      setMelding("Inloggen mislukt: controleer e-mail en wachtwoord.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next") || "/vandaag";
    window.location.href = next;
  }

  async function wachtwoordVergeten() {
    if (!supabase) {
      setMelding("Supabase is niet geconfigureerd.");
      return;
    }
    if (!email) {
      setMelding("Vul eerst je e-mailadres in.");
      return;
    }
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setMelding("Als het adres bekend is, is er een resetmail verstuurd.");
  }

  return (
    <div className="flex min-h-[calc(100vh-73px)] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6">
        <h1 className="mb-1 text-lg font-semibold text-off-white">Inloggen</h1>
        <p className="mb-5 text-sm text-off-white/50">Toegang is op uitnodiging.</p>
        <form onSubmit={login} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-off-white/70">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-off-white/70">
              Wachtwoord
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
          {melding && <p className="text-sm text-amber-waste">{melding}</p>}
          <button
            type="submit"
            disabled={bezig}
            className="w-full rounded-[6px] px-3 py-2 text-sm font-medium text-midnight-slate disabled:opacity-60"
            style={{ backgroundColor: "#818cf8" }}
          >
            {bezig ? "Bezig..." : "Inloggen"}
          </button>
        </form>
        <button
          type="button"
          onClick={wachtwoordVergeten}
          className="mt-4 text-sm text-off-white/50 underline hover:text-off-white"
        >
          Wachtwoord vergeten
        </button>
      </div>
    </div>
  );
}
