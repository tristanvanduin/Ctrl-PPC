// Puur: GA4 sessionSource/sessionMedium → onze eigen, kleinere kanaal-union (Ga4Channel). Zie de
// opmerking bij Ga4Channel (types.ts) — dit is bewust een aparte, smallere classificatie dan GA4's
// eigen Default Channel Group ("Paid Search", "Paid Social", ...), omdat we maar drie betaalde
// kanalen onderscheiden en de rest optellen bij "other" (organisch/direct/e-mail).

import type { Ga4Channel } from "./types";

const PAID_MEDIA = new Set(["cpc", "ppc", "paid", "paidsocial", "display", "cpm"]);

export function classifyGa4Channel(source: string | null | undefined, medium: string | null | undefined): Ga4Channel {
  const s = (source ?? "").toLowerCase();
  const m = (medium ?? "").toLowerCase();
  const isPaid = PAID_MEDIA.has(m) || m.includes("cpc") || m.includes("paid");

  if (isPaid && (s.includes("google") || s === "adwords")) return "google";
  if (isPaid && (s.includes("facebook") || s.includes("instagram") || s.includes("meta") || s.includes("fb"))) return "meta";
  if (isPaid && s.includes("linkedin")) return "linkedin";
  if (isPaid && (s.includes("bing") || s.includes("microsoft"))) return "microsoft";
  return "other";
}
