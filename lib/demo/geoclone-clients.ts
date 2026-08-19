// De 3 losse geo-clone-klanten (GRT/GRA/GRN) als gedeelde constante -- gebruikt door zowel het
// seedscript (scripts/demo/seed-geoclone-clients.ts / teardown-geoclone-clients.ts) als de
// runtime (lib/demo/geoclone-demo-data.ts, voor de dashboardweergave). Stond eerst alleen in het
// seedscript; de runtime moet dezelfde lijst kennen om deze klant-id's te herkennen, en een
// scripts/-bestand importeren vanuit app/-code is de verkeerde afhankelijkheidsrichting.

export const GEOCLONE_CLIENTS = [
  {
    clientId: "demo-grt", name: "DEMO — GreenTech Amsterdam (GRT)",
    campaigns: ["GRT | Search | NL", "GRT | Performance Max"],
    conversionsTarget: 320,
  },
  {
    clientId: "demo-gra", name: "DEMO — GreenTech Americas (GRA)",
    campaigns: ["GRA | Search | US"],
    conversionsTarget: 200,
  },
  {
    clientId: "demo-grn", name: "DEMO — GreenTech North America (GRN)",
    campaigns: ["GRN | Search | NA"],
    conversionsTarget: 70,
  },
] as const;

export const GEOCLONE_DEMO_IDS: readonly string[] = GEOCLONE_CLIENTS.map((g) => g.clientId);
