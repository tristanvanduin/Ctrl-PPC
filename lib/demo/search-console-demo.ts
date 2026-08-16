// Search Console-demodata voor demo-greentech — spiegelt lib/demo/ga4-demo.ts qua opzet.
// Gesynthetiseerd om drie van de vijf detectoren (signals.ts) aantoonbaar te laten triggeren:
// aanhoudende merkdominantie, een positie-drop op één pagina, en een nieuwe stijgende zoekterm.
// Bewust één geïsoleerde plek; buiten demo geeft data-access "absent" en draait alles zonder GSC.

import type { GscConfig, GscDataset, GscQueryRow } from "@/lib/search-console/types";

export const GSC_DEMO_CONFIG: GscConfig = {
  siteUrl: "https://www.demo-greentech.nl/",
  brandTerms: ["greentech", "green tech"],
};

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const TOTAL_DAYS = 185;
const DROP_RECENT_DAYS = 7; // laatste 7 dagen: de gedropte pagina zakt hier
const RISING_WINDOW_DAYS = 28; // nieuwe zoekterm verschijnt alleen binnen dit venster

export function buildGscDemoRows(now: Date = new Date()): GscQueryRow[] {
  const rnd = seeded(20260816);
  const rows: GscQueryRow[] = [];

  for (let i = TOTAL_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const jitter = () => 0.85 + rnd() * 0.3;

    // 1) Merkterm — aanhoudend sterk, elke dag data, ver boven de 90d/12-weken-drempel.
    rows.push({
      date, query: "greentech", page: "/",
      clicks: Math.round(9 * jitter()), impressions: Math.round(28 * jitter()),
      ctr: 0.32, position: 1.1 + rnd() * 0.3,
    });

    // 2) Positie-drop: /diensten/zonnepanelen zakt in de laatste 7 dagen van ~4 naar ~9.
    const gezakt = i < DROP_RECENT_DAYS;
    rows.push({
      date, query: "zonnepanelen zakelijk", page: "/diensten/zonnepanelen",
      clicks: Math.round((gezakt ? 3 : 8) * jitter()), impressions: Math.round(60 * jitter()),
      ctr: gezakt ? 0.05 : 0.13, position: gezakt ? 8.5 + rnd() : 3.5 + rnd() * 0.8,
    });

    // 3) CTR-anomalie: /oplossingen/warmtepomp rankt gemiddeld maar krijgt structureel weinig CTR.
    rows.push({
      date, query: "warmtepomp installateur", page: "/oplossingen/warmtepomp",
      clicks: Math.round(1 * jitter()), impressions: Math.round(45 * jitter()),
      ctr: 0.02, position: 3 + rnd() * 0.5,
    });
    // Referentiepopulatie op dezelfde positiebucket (~3), gezonde CTR — nodig als baseline.
    for (let k = 0; k < 3; k++) {
      rows.push({
        date, query: `referentie zoekterm ${k}`, page: `/referentie/${k}`,
        clicks: Math.round(6 * jitter()), impressions: Math.round(40 * jitter()),
        ctr: 0.15, position: 3 + rnd() * 0.5,
      });
    }

    // 4) Nieuwe stijgende zoekterm: alleen binnen het laatste venster.
    if (i < RISING_WINDOW_DAYS) {
      rows.push({
        date, query: "zonnepanelen subsidie 2026", page: "/diensten/zonnepanelen",
        clicks: Math.round(2 * jitter()), impressions: Math.round(9 * jitter()),
        ctr: 0.22, position: 5 + rnd() * 2,
      });
    }
  }
  return rows;
}

export function buildGscDemoDataset(now: Date = new Date()): GscDataset {
  return {
    availability: "mock",
    config: GSC_DEMO_CONFIG,
    rows: buildGscDemoRows(now),
    limitations: ["Demo-Search-Console-data (mock): gesynthetiseerd voor review, geen live site."],
  };
}
