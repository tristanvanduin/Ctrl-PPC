"use client";

import { useState } from "react";

// Extreem lean, zoals afgesproken: een formulier, geen agenda-koppeling. Upgrade naar een
// echte boekingsflow (Cal.com oid) is een latere stap, geen blokkade voor nu.
export function DemoForm() {
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [bedrijf, setBedrijf] = useState("");
  const [bericht, setBericht] = useState("");
  const [versturen, setVersturen] = useState(false);
  const [verzonden, setVerzonden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVersturen(true);
    setFout(null);
    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naam, email, bedrijf, bericht }),
      });
      const data = await res.json();
      if (!res.ok) { setFout(data.error ?? "Versturen mislukt"); return; }
      setVerzonden(true);
    } catch {
      setFout("Versturen mislukt, probeer het later opnieuw.");
    } finally {
      setVersturen(false);
    }
  }

  if (verzonden) {
    return (
      <div className="rounded-[6px] border border-neon-indigo/40 bg-midnight-slate-raised p-8 text-center">
        <p className="font-marketing-heading text-xl font-bold text-off-white">Bedankt.</p>
        <p className="mt-2 text-sm text-off-white/60">
          We nemen zo snel mogelijk contact met je op om een moment te vinden.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-8">
      <div>
        <label htmlFor="naam" className="mb-1 block text-sm font-medium text-off-white/70">Naam</label>
        <input
          id="naam" required value={naam} onChange={(e) => setNaam(e.target.value)}
          className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-off-white/70">E-mail</label>
        <input
          id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="bedrijf" className="mb-1 block text-sm font-medium text-off-white/70">Bureau / bedrijf (optioneel)</label>
        <input
          id="bedrijf" value={bedrijf} onChange={(e) => setBedrijf(e.target.value)}
          className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="bericht" className="mb-1 block text-sm font-medium text-off-white/70">Waar wil je naar kijken? (optioneel)</label>
        <textarea
          id="bericht" rows={3} value={bericht} onChange={(e) => setBericht(e.target.value)}
          className="w-full rounded-[6px] border border-off-white/15 bg-midnight-slate px-3 py-2 text-sm text-off-white focus:border-neon-indigo focus:outline-none"
        />
      </div>
      {fout && <p className="text-sm text-amber-waste">{fout}</p>}
      <button
        type="submit"
        disabled={versturen}
        className="w-full rounded-[6px] px-5 py-3 text-sm font-semibold text-midnight-slate disabled:opacity-60"
        style={{ backgroundColor: "#818cf8" }}
      >
        {versturen ? "Versturen..." : "Demo aanvragen"}
      </button>
    </form>
  );
}
