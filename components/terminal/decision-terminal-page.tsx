"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Radar, Search } from "lucide-react";
import { useState } from "react";
import { getVisibleClients } from "@/lib/visible-clients";
import { DecisionTerminal } from "./decision-terminal";

// Losse, geisoleerde route (app/decision-terminal/page.tsx): geen client-id in het pad zoals
// app/client/[clientId], maar een querystring (?client=), zodat de Decision Terminal een eigen,
// deelbare URL heeft die niet in de bestaande klant-navigatie hangt.

function ClientKiezer() {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const clients = getVisibleClients().filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="terminal mx-auto max-w-lg space-y-4 py-16">
      <div className="flex items-center gap-2">
        <Radar className="h-5 w-5" style={{ color: "var(--terminal-accent, var(--color-brand-blue-ink))" }} />
        <h1 className="text-page font-bold text-brand-blue-ink">Decision Terminal</h1>
      </div>
      <p className="text-body text-muted-foreground">Kies een klant om het Hypothesis Board, de Attribution View en het Decision Log te zien.</p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek een klant..."
          className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-body focus:border-brand-blue/50 focus:outline-none"
          autoFocus
        />
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => router.push(`/decision-terminal?client=${encodeURIComponent(c.id)}`)}
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-body text-brand-gray hover:border-brand-blue/40 hover:bg-muted"
          >
            {c.name}
          </button>
        ))}
        {clients.length === 0 && <p className="text-meta text-muted-foreground">Geen klanten gevonden.</p>}
      </div>
    </div>
  );
}

export function DecisionTerminalPage() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  if (!clientId) return <ClientKiezer />;
  return <DecisionTerminal clientId={clientId} />;
}
