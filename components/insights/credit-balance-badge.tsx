"use client";

// Klein badge naast "Losse analyses": het creditsaldo dat StandaloneAnalyses hieronder daadwerkelijk
// verbruikt (credit_ledger, migratie 070 — zie lib/analysis/credit-costs.ts voor de "alleen deep
// dives, nooit SOP's"-regel). Toont nooit een verzonnen getal: bij saldo=null (leesfout) staat er
// "onbekend", nooit stilzwijgend 0 — hetzelfde onderscheid dat leesSaldo zelf bewaakt.

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

interface CreditsResponse {
  saldo: number | null;
  prijzenActief: boolean;
}

export function CreditBalanceBadge() {
  const [data, setData] = useState<CreditsResponse | null>(null);

  useEffect(() => {
    let actief = true;
    fetch("/api/credits")
      .then((res) => res.json())
      .then((d: CreditsResponse) => { if (actief) setData(d); })
      .catch(() => { /* stil: een badge is geen kritiek pad */ });
    return () => { actief = false; };
  }, []);

  if (!data) return null;

  // Prijstabel nog niet actief (CREDIT_COSTS leeg, masterplan §16.x): een kaal saldo tonen zou
  // suggereren dat er al iets afgeschreven wordt. Eerlijker om dat expliciet te zeggen.
  if (!data.prijzenActief) {
    return (
      <span className="flex items-center gap-1.5 text-micro font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
        <Coins className="w-3 h-3" />
        Credits — binnenkort actief
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-micro font-semibold text-brand-gray bg-card border border-border px-2.5 py-1 rounded-full">
      <Coins className="w-3 h-3 text-brand-orange" />
      {data.saldo == null ? "Saldo onbekend" : <>{data.saldo} credits</>}
    </span>
  );
}
