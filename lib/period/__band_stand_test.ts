// Tot welke dag de KPI-band rekent, per tabblad (lib/period/band-stand.ts).
// Draaien: tsx lib/period/__band_stand_test.ts
//
// Drie fouten in de stand die client-dashboard.tsx aan de PeriodProvider gaf:
// - [3] Op een kanaaltab alleen de nieuwste rij. Een gepauzeerd LinkedIn-account met een gezonde
//   sync kreeg "maart 2025 t/m februari 2026" op zijn eigen tab, en "november 2025 t/m oktober
//   2026" op Alle kanalen. Hetzelfde kanaal, twee vensters.
// - [12] Op "Alle kanalen" de stand van de route (fact_core), terwijl de band Google LIVE leest:
//   een DB-sync die stillag liet de band in september stoppen, met alle getoonde bronnen compleet
//   t/m oktober.
// - [7] Faalde de route, dan geen stand en dus het kalendervenster: september en oktober telden mee
//   als nullen, de vergelijking die het venster moest voorkomen.
// De module bestaat op de oude code niet; dan per geval een FAIL in plaats van een crash.

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Bron = { bron: string; dataTot: string | null; syncDraait: boolean };
type Stand = { laatsteVolleMaand: string | null; partieel: { maand: string; tmDag: number; dagenInMaand: number } | null; dataTot: string | null; uitgeslotenBronnen?: { bron: string; dataTot: string | null }[] };
type Invoer = {
  channel: "google" | "blended" | "meta" | "linkedin" | "microsoft";
  kanalen: readonly string[];
  google: { dataTot: string | null; laatsteVolleMaand: string | null; partieel: Stand["partieel"] } | null;
  laatsteDag: Record<"meta" | "linkedin" | "microsoft", string | null>;
  route: { bronnen?: Bron[] } | null;
  nu?: string;
};

const NU = "2026-11-01";
const geen = { meta: null, linkedin: null, microsoft: null };
const live = { dataTot: "2026-10-31", laatsteVolleMaand: "2026-10", partieel: null };

async function main() {
  let bandDataStand: ((inp: Invoer) => Stand | null) | null = null;
  try {
    bandDataStand = ((await import("./band-stand")) as unknown as { bandDataStand: (inp: Invoer) => Stand | null }).bandDataStand;
  } catch { /* oude code: bestaat niet */ }
  check("bandDataStand bestaat", typeof bandDataStand === "function");
  if (!bandDataStand) return klaar();
  const f = bandDataStand;

  console.log("[3] Een kanaaltab rekent met de syncdag van de route");
  {
    // LinkedIn gepauzeerd sinds 15 maart, sync vannacht geslaagd: de route zegt t/m 31 oktober.
    const route = { bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-10-31", syncDraait: true }] };
    const tab = f({ channel: "linkedin", kanalen: ["google", "linkedin"], google: live, laatsteDag: { ...geen, linkedin: "2026-03-15" }, route, nu: NU });
    check("gepauzeerd met gezonde sync: de tab loopt t/m oktober, zoals Alle kanalen", tab?.laatsteVolleMaand === "2026-10" && tab?.dataTot === "2026-10-31", JSON.stringify(tab));
    const alle = f({ channel: "blended", kanalen: ["google", "linkedin"], google: live, laatsteDag: { ...geen, linkedin: "2026-03-15" }, route, nu: NU });
    check("en Alle kanalen geeft hetzelfde venster", alle?.laatsteVolleMaand === "2026-10", JSON.stringify(alle));

    // Zonder route (een klant met één kanaal waarvan de route faalde): de rij, zoals voorheen.
    const zonder = f({ channel: "linkedin", kanalen: ["linkedin"], google: null, laatsteDag: { ...geen, linkedin: "2026-03-15" }, route: null, nu: NU });
    check("zonder route: de nieuwste rij", zonder?.laatsteVolleMaand === "2026-02" && zonder?.dataTot === "2026-03-15", JSON.stringify(zonder));
    // Een nieuwere rij dan de (gecachete) route telt, maar zonder zijn eigen dag: die rij komt van
    // een sync na het antwoord van de route, en de nachtcron haalt t/m zijn eigen dag op, dus de
    // nieuwste rij is een deel van die dag (zie dataTotVanDagbron). Hier stond 31 oktober.
    const nieuwer = f({ channel: "meta", kanalen: ["meta"], google: null, laatsteDag: { ...geen, meta: "2026-10-31" }, route: { bronnen: [{ bron: "meta", dataTot: "2026-10-15", syncDraait: false }] }, nu: NU });
    check("een nieuwere rij wint van een oudere routedag, t/m de dag ervoor", nieuwer?.dataTot === "2026-10-30", JSON.stringify(nieuwer));
  }

  console.log("De rij van de syncdag is een deel van die dag, ook in de band");
  {
    // Meta slaagde voor het laatst op 31 oktober om 05:00 UTC; de route zegt daarom t/m 30 oktober
    // (dataTotVanDagbron). De browser ziet dezelfde rij van 31 oktober. Hier won de LAATSTE van de
    // twee, en dan kwam de correctie van de route nooit in de band: oktober vol, zonder "partieel".
    const route = { bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "meta", dataTot: "2026-10-30", syncDraait: false }] };
    const tab = f({ channel: "meta", kanalen: ["google", "meta"], google: live, laatsteDag: { ...geen, meta: "2026-10-31" }, route, nu: "2026-11-03" });
    check("Meta-tab: september vol, oktober partieel t/m 30",
      tab?.dataTot === "2026-10-30" && tab?.laatsteVolleMaand === "2026-09" && tab?.partieel?.maand === "2026-10" && tab?.partieel?.tmDag === 30, JSON.stringify(tab));
    const alle = f({ channel: "blended", kanalen: ["google", "meta"], google: live, laatsteDag: { ...geen, meta: "2026-10-31" }, route, nu: NU });
    check("Alle kanalen: Meta remt op 30 oktober, zoals de route",
      alle?.dataTot === "2026-10-30" && alle?.laatsteVolleMaand === "2026-09" && alle?.partieel?.tmDag === 30, JSON.stringify(alle));
    // Zonder synctijdstip in de route (geen koppelingsrij) is de routedag de rij zelf: dan blijft het die rij.
    const zonderSync = f({ channel: "microsoft", kanalen: ["microsoft"], google: null, laatsteDag: { ...geen, microsoft: "2026-08-26" }, route: { bronnen: [{ bron: "microsoft", dataTot: "2026-08-26", syncDraait: true }] }, nu: NU });
    check("route zonder sync (routedag = de rij): de rij, ongewijzigd", zonderSync?.dataTot === "2026-08-26", JSON.stringify(zonderSync));
  }

  console.log("[12] Alle kanalen rekent over de bronnen die de band leest");
  {
    // De DB-sync van Google lag sinds 18 oktober stil; de band leest Google live (t/m gisteren).
    const route = { bronnen: [{ bron: "google", dataTot: "2026-10-17", syncDraait: false }, { bron: "meta", dataTot: "2026-10-31", syncDraait: false }] };
    const s = f({ channel: "blended", kanalen: ["google", "meta"], google: live, laatsteDag: { ...geen, meta: "2026-10-31" }, route, nu: NU });
    check("oktober vol, niet 'Data t/m 17 oktober'", s?.laatsteVolleMaand === "2026-10" && s?.partieel === null && s?.dataTot === "2026-10-31", JSON.stringify(s));

    // Een kanaal dat niet meer gekoppeld is: de route zegt dat het niet remt; de band noemt het.
    const los = f({
      channel: "blended", kanalen: ["google", "linkedin"], google: live, laatsteDag: { ...geen, linkedin: "2026-05-15" },
      route: { bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-05-15", syncDraait: true }] }, nu: NU,
    });
    check("ontkoppeld LinkedIn remt niet en staat met zijn dag in uitgeslotenBronnen",
      los?.laatsteVolleMaand === "2026-10" && JSON.stringify(los?.uitgeslotenBronnen) === JSON.stringify([{ bron: "linkedin", dataTot: "2026-05-15" }]), JSON.stringify(los));

    // Zoals de route het echt geeft: ontkoppeld na zijn sync van 15 mei 05:00, met een rij van die
    // dag. dataTotVanDagbron zegt dan t/m 14 mei (de rij van de syncdag is een deel van de dag), en
    // de zin zei "geen data na 14 mei" terwijl de rij van 15 mei in het meitotaal staat.
    const syncdag = f({
      channel: "blended", kanalen: ["google", "linkedin"], google: live, laatsteDag: { ...geen, linkedin: "2026-05-15" },
      route: { bronnen: [{ bron: "google", dataTot: "2026-10-31", syncDraait: false }, { bron: "linkedin", dataTot: "2026-05-14", syncDraait: true }] }, nu: NU,
    });
    check("ontkoppeld na de sync van zijn laatste rij: de zin noemt die rij (15 mei), het venster blijft oktober",
      syncdag?.laatsteVolleMaand === "2026-10" && JSON.stringify(syncdag?.uitgeslotenBronnen) === JSON.stringify([{ bron: "linkedin", dataTot: "2026-05-15" }]), JSON.stringify(syncdag));
    // Een gepauzeerd account met een gezonde sync (laatste levering 20 september, sync 31 oktober
    // terwijl Google al t/m 1 november staat) houdt de dag van de sync: die dagen zijn gemeten nullen.
    const gepauzeerd = f({
      channel: "blended", kanalen: ["google", "linkedin"], google: { dataTot: "2026-11-01", laatsteVolleMaand: "2026-10", partieel: null }, laatsteDag: { ...geen, linkedin: "2026-09-20" },
      route: { bronnen: [{ bron: "google", dataTot: "2026-11-01", syncDraait: false }, { bron: "linkedin", dataTot: "2026-10-30", syncDraait: true }] }, nu: "2026-11-02",
    });
    check("gepauzeerd met gezonde sync: de dag van de sync, niet de laatste levering",
      JSON.stringify(gepauzeerd?.uitgeslotenBronnen) === JSON.stringify([{ bron: "linkedin", dataTot: "2026-10-30" }]), JSON.stringify(gepauzeerd));

    // Demo: Google (DB) t/m 25 augustus, de dagkanalen t/m 26 augustus en uitgezet. Onveranderd.
    const demo = f({
      channel: "blended", kanalen: ["google", "meta", "linkedin", "microsoft"],
      google: { dataTot: "2026-08-25", laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 } },
      laatsteDag: { meta: "2026-08-26", linkedin: "2026-08-26", microsoft: "2026-08-26" },
      route: { bronnen: [
        { bron: "google", dataTot: "2026-08-25", syncDraait: false }, { bron: "meta", dataTot: "2026-08-26", syncDraait: true },
        { bron: "linkedin", dataTot: "2026-08-26", syncDraait: true }, { bron: "microsoft", dataTot: "2026-08-26", syncDraait: true },
      ] }, nu: NU,
    });
    check("demo: juli vol, augustus t/m 25, niemand uitgesloten",
      demo?.laatsteVolleMaand === "2026-07" && demo?.partieel?.tmDag === 25 && demo?.dataTot === "2026-08-25" && (demo?.uitgeslotenBronnen ?? []).length === 0, JSON.stringify(demo));

    // Google telt alleen mee als de klant Google heeft.
    const zonderGoogle = f({ channel: "blended", kanalen: ["meta", "linkedin"], google: live, laatsteDag: { ...geen, meta: "2026-08-26", linkedin: "2026-08-26" }, route: null, nu: NU });
    check("zonder Google-kanaal remt de Google-stand niet mee", zonderGoogle?.dataTot === "2026-08-26", JSON.stringify(zonderGoogle));
  }

  console.log("[7] Faalt de route, dan de regel over de eigen rijen, niet de kalender");
  {
    const s = f({
      channel: "blended", kanalen: ["google", "meta", "linkedin", "microsoft"],
      google: { dataTot: "2026-08-25", laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 } },
      laatsteDag: { meta: "2026-08-26", linkedin: "2026-08-26", microsoft: "2026-08-26" }, route: null, nu: NU,
    });
    check("demo zonder route: nog steeds juli vol, augustus t/m 25", s?.laatsteVolleMaand === "2026-07" && s?.dataTot === "2026-08-25", JSON.stringify(s));
    check("zonder enige bron met data: geen stand", f({ channel: "blended", kanalen: [], google: null, laatsteDag: geen, route: null, nu: NU }) === null);
  }

  console.log("De Google-tab: de stand van de Google-route, ongewijzigd");
  {
    const g = f({ channel: "google", kanalen: ["google"], google: live, laatsteDag: geen, route: null, nu: NU });
    check("google: laatste volle maand en dag uit de Google-route", g?.laatsteVolleMaand === "2026-10" && g?.dataTot === "2026-10-31", JSON.stringify(g));
  }
  klaar();
}

function klaar() {
  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Een module en geen script: de module wordt dynamisch geladen, en zonder import of export deelt
// dit bestand voor tsc zijn namen met elk ander testscript.
export {};
