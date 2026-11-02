// Eén antwoord op "tot welke maand is de data vol" (stap 0, item E).
// Draaien: tsx lib/sync/__volle_maand_test.ts
//
// De aanleiding: demo-greentech heeft data t/m 26 augustus 2026, en op 1 november gaven de
// KPI-band (venster t/m de vorige kalendermaand), de blended pacing ("t/m augustus, 8 maanden"),
// het jaaroverzicht (augustus gerealiseerd) en de Meta-prognose (juli en augustus weg uit de YTD)
// elk een ander antwoord. Deze test legt het gedeelde antwoord vast. De afnemers hebben hun eigen
// test (lib/analysis/__channel_forecast_data_test.ts voor de kanaalprognose).
//
// De import is bewust een namespace: op de oude code bestaan deze functies niet, en dan moet de
// test per geval falen in plaats van op de import te struikelen zonder te zeggen wat er mist.

import * as datastand from "./datastand";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

interface VM {
  laatsteVolleMaand: string | null;
  partieel: { maand: string; tmDag: number; dagenInMaand: number } | null;
  verwachteMaand: string;
  maandenAchter: number | null;
}
const { beoordeelDagstand } = datastand;
const { volleMaand, dataTotVanMaandbron, gezamenlijkeDataTot, dataTotVanDagbron } = datastand as unknown as {
  volleMaand?: (inp: { dataTot: string | null | undefined; nu?: string }) => VM;
  dataTotVanMaandbron?: (laatsteMaand: string | null | undefined, laatsteSync: string | null | undefined) => string | null;
  gezamenlijkeDataTot?: (bronnen: { bron: string; dataTot: string | null | undefined; syncDraait?: boolean }[]) => { dataTot: string | null; uitgesloten: string[] };
  dataTotVanDagbron?: (stand: { laatsteDag: string | null; laatsteGeslaagdeSync: string | null; syncDraait: boolean }) => string | null;
};

// ── volleMaand ─────────────────────────────────────────────────────────────
console.log("volleMaand: de gedeelde regel");
check("volleMaand bestaat", typeof volleMaand === "function");
if (typeof volleMaand === "function") {
  const demo = volleMaand({ dataTot: "2026-08-26", nu: "2026-11-01" });
  check("data t/m 26 aug, op 1 nov: laatste volle maand is juli", demo.laatsteVolleMaand === "2026-07", JSON.stringify(demo));
  check("augustus is partieel t/m dag 26 van 31",
    demo.partieel?.maand === "2026-08" && demo.partieel?.tmDag === 26 && demo.partieel?.dagenInMaand === 31, JSON.stringify(demo.partieel));
  check("de kalender verwacht oktober; drie maanden achter", demo.verwachteMaand === "2026-10" && demo.maandenAchter === 3, JSON.stringify(demo));

  const volAug = volleMaand({ dataTot: "2026-08-31", nu: "2026-11-01" });
  check("t/m 31 aug: augustus is vol, niets partieel, twee maanden achter",
    volAug.laatsteVolleMaand === "2026-08" && volAug.partieel === null && volAug.maandenAchter === 2, JSON.stringify(volAug));

  const live = volleMaand({ dataTot: "2026-11-14", nu: "2026-11-15" });
  check("live bron midden in de maand: vorige maand vol, lopende maand partieel, niet achter",
    live.laatsteVolleMaand === "2026-10" && live.partieel?.maand === "2026-11" && live.partieel?.tmDag === 14 && live.maandenAchter === 0, JSON.stringify(live));

  const vandaag = volleMaand({ dataTot: "2026-11-01", nu: "2026-11-01" });
  check("een rij van vandaag is nog niet definitief: oktober vol, niets partieel",
    vandaag.laatsteVolleMaand === "2026-10" && vandaag.partieel === null && vandaag.maandenAchter === 0, JSON.stringify(vandaag));

  const laatsteDagVanMaand = volleMaand({ dataTot: "2026-10-31", nu: "2026-10-31" });
  check("op de 31e met een rij van vandaag: de maand is nog niet vol, de vorige wel",
    laatsteDagVanMaand.laatsteVolleMaand === "2026-09" && laatsteDagVanMaand.partieel?.maand === "2026-10" && laatsteDagVanMaand.partieel?.tmDag === 30,
    JSON.stringify(laatsteDagVanMaand));

  const toekomst = volleMaand({ dataTot: "2026-12-31", nu: "2026-11-15" });
  check("nooit voorbij de kalender: een datum in de toekomst geeft hooguit de vorige maand",
    toekomst.laatsteVolleMaand === "2026-10" && toekomst.maandenAchter === 0, JSON.stringify(toekomst));

  const schrikkel = volleMaand({ dataTot: "2028-02-28", nu: "2028-04-10" });
  check("28 februari in een schrikkeljaar is geen volle februari",
    schrikkel.laatsteVolleMaand === "2028-01" && schrikkel.partieel?.dagenInMaand === 29 && schrikkel.partieel?.tmDag === 28, JSON.stringify(schrikkel));
  const gewoon = volleMaand({ dataTot: "2027-02-28", nu: "2027-04-10" });
  check("28 februari in een gewoon jaar is wel een volle februari", gewoon.laatsteVolleMaand === "2027-02" && gewoon.partieel === null, JSON.stringify(gewoon));

  const jaargrens = volleMaand({ dataTot: "2026-12-31", nu: "2027-01-01" });
  check("over de jaargrens: op 1 januari is december vol", jaargrens.laatsteVolleMaand === "2026-12" && jaargrens.verwachteMaand === "2026-12", JSON.stringify(jaargrens));

  const tijdstip = volleMaand({ dataTot: "2026-08-26T23:59:00Z", nu: "2026-11-01" });
  check("een tijdstip telt als zijn dag", tijdstip.laatsteVolleMaand === "2026-07" && tijdstip.partieel?.tmDag === 26, JSON.stringify(tijdstip));

  const leeg = volleMaand({ dataTot: null, nu: "2026-11-01" });
  check("zonder data: null, en toch de verwachte maand", leeg.laatsteVolleMaand === null && leeg.partieel === null && leeg.maandenAchter === null && leeg.verwachteMaand === "2026-10", JSON.stringify(leeg));
  check("een maand is geen dag: geen data", volleMaand({ dataTot: "2026-08", nu: "2026-11-01" }).laatsteVolleMaand === null);
  check("30 februari bestaat niet en maakt februari niet vol", volleMaand({ dataTot: "2026-02-30", nu: "2026-11-01" }).laatsteVolleMaand === null);

  let gooit = false;
  try { volleMaand({ dataTot: "2026-08-26", nu: "2026-11" }); } catch { gooit = true; }
  check("een maand als 'nu' wordt geweigerd, niet stil vervangen door vandaag", gooit);
}

// ── dataTotVanMaandbron ────────────────────────────────────────────────────
console.log("dataTotVanMaandbron: een maandrij is t/m de dag voor de sync");
check("dataTotVanMaandbron bestaat", typeof dataTotVanMaandbron === "function");
if (typeof dataTotVanMaandbron === "function") {
  check("maandrij van augustus, sync op 26 aug: data t/m 25 aug", dataTotVanMaandbron("2026-08-01", "2026-08-26T06:44:34Z") === "2026-08-25");
  check("maandrij van augustus, sync op 2 sep: augustus is vol", dataTotVanMaandbron("2026-08-01", "2026-09-02T05:10:00Z") === "2026-08-31");
  check("sync op 1 sep: augustus is vol (de 31e is gisteren)", dataTotVanMaandbron("2026-08", "2026-09-01T05:00:00Z") === "2026-08-31");
  check("zonder synctijdstip: eind van de maand (terugval)", dataTotVanMaandbron("2026-08", null) === "2026-08-31");
  check("februari van een schrikkeljaar eindigt op de 29e", dataTotVanMaandbron("2028-02-01", null) === "2028-02-29");
  check("sync van vóór de maand van de rij: de rij bewijst dat er na die maandgrens gesynct is",
    dataTotVanMaandbron("2026-08-01", "2026-07-15T05:00:00Z") === "2026-07-31", String(dataTotVanMaandbron("2026-08-01", "2026-07-15T05:00:00Z")));
  check("zonder maandrij: null", dataTotVanMaandbron(null, "2026-08-26T06:44:34Z") === null);
  check("ongeldige maand: null", dataTotVanMaandbron("2026-13", null) === null);

  // Samen met volleMaand: de demo-Google (ads_account_monthly t/m augustus, sync 26 aug).
  if (typeof volleMaand === "function") {
    const g = volleMaand({ dataTot: dataTotVanMaandbron("2026-08-01", "2026-08-26T06:44:34Z"), nu: "2026-11-01" });
    check("demo-Google: juli vol, augustus partieel t/m de 25e", g.laatsteVolleMaand === "2026-07" && g.partieel?.tmDag === 25, JSON.stringify(g));
  }
}

// ── gezamenlijkeDataTot ────────────────────────────────────────────────────
console.log("gezamenlijkeDataTot: over kanalen remt de vroegste");
check("gezamenlijkeDataTot bestaat", typeof gezamenlijkeDataTot === "function");
if (typeof gezamenlijkeDataTot === "function") {
  const s = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-08-25" }, { bron: "meta", dataTot: "2026-08-26" }, { bron: "linkedin", dataTot: null }]);
  check("de vroegste telt; een bron zonder data doet niet mee", s.dataTot === "2026-08-25" && s.uitgesloten.length === 0, JSON.stringify(s));

  const gepauzeerd = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-10-31" }, { bron: "linkedin", dataTot: "2026-03-31", syncDraait: true }]);
  check("gepauzeerd kanaal met werkende sync remt de rest niet, maar wordt genoemd",
    gepauzeerd.dataTot === "2026-10-31" && gepauzeerd.uitgesloten.length === 1 && gepauzeerd.uitgesloten[0] === "linkedin", JSON.stringify(gepauzeerd));

  // Hier stond LinkedIn op 31 maart naast een Google t/m oktober, en dat remde: het hele venster
  // bleef op februari staan. Zeven maanden achter wacht een bron niet meer op een gemiste nacht maar
  // op data die niet komt (review [9], [36]); de rem geldt daarom tot DOOD_VANAF_MAANDEN, zie hieronder.
  const stuk = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-10-31" }, { bron: "linkedin", dataTot: "2026-09-20", syncDraait: false }]);
  check("een kanaal waarvan de sync NIET draait remt wel: ontbrekend is geen nul", stuk.dataTot === "2026-09-20" && stuk.uitgesloten.length === 0, JSON.stringify(stuk));

  const dood = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-10-31" }, { bron: "linkedin", dataTot: "2025-03-20", syncDraait: false }]);
  check("een bron die al anderhalf jaar stilligt remt niet meer, maar wordt genoemd",
    dood.dataTot === "2026-10-31" && dood.uitgesloten.join(",") === "linkedin", JSON.stringify(dood));
  const tweeMaanden = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-10-31" }, { bron: "linkedin", dataTot: "2026-08-31", syncDraait: false }]);
  check("twee kalendermaanden achter (augustus tegen oktober): opgegeven, net als 'dood' bij beoordeelDatastand",
    tweeMaanden.dataTot === "2026-10-31" && tweeMaanden.uitgesloten.join(",") === "linkedin", JSON.stringify(tweeMaanden));
  const eenMaand = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-10-31" }, { bron: "linkedin", dataTot: "2026-09-01", syncDraait: false }]);
  check("zestig dagen achter remt nog (de grens ligt erna)",
    eenMaand.dataTot === "2026-09-01" && eenMaand.uitgesloten.length === 0, JSON.stringify(eenMaand));
  // De grens telde kalendermaanden van de twee dagen: 31 augustus tegen 1 oktober is "twee maanden",
  // en dan gaf een bron die 31 nachten miste het op, terwijl 60 dagen (1 september tegen 31 oktober)
  // nog remde. Bij een Google-sync die op 1 september voor het laatst slaagde, sprong het venster zo
  // in de nacht van 1 op 2 oktober een maand vooruit, en telde Google's september als nul.
  const maandgrens = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-08-31", syncDraait: false }, { bron: "meta", dataTot: "2026-10-01" }]);
  check("31 dagen achter over een maandgrens remt nog: het venster springt niet een nacht later vooruit",
    maandgrens.dataTot === "2026-08-31" && maandgrens.uitgesloten.length === 0, JSON.stringify(maandgrens));

  const vooruit = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-08-25" }, { bron: "meta", dataTot: "2026-09-30", syncDraait: true }]);
  check("een stille bron die verder loopt dan de rest hoeft niemand te noemen", vooruit.dataTot === "2026-08-25" && vooruit.uitgesloten.length === 0, JSON.stringify(vooruit));
  // Dezelfde vorm met Meta op 30 oktober stond hierboven met "Google remt": maar twee kalendermaanden
  // achter op een bron die wél gemeten is, is Google zelf de bron die niet bijkomt.
  const googleOpgegeven = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-08-25" }, { bron: "meta", dataTot: "2026-10-30", syncDraait: true }]);
  check("ook naast een stille bron: twee maanden achter remt niet meer",
    googleOpgegeven.dataTot === "2026-10-30" && googleOpgegeven.uitgesloten.join(",") === "Google", JSON.stringify(googleOpgegeven));

  // Hier stond de VROEGSTE dag (30 juni): dan gooide een Meta die tot 26 augustus gemeten is, juli
  // en augustus weg, terwijl een Meta die gewoon was doorgelopen het venster tot oktober had gegeven
  // (review [11]). Stil betekent: de sync slaagt, na zijn dataTot zijn het echte nullen. De laatste
  // dag van de stille bronnen loopt dus nooit voorbij gemeten data.
  const alleStil = gezamenlijkeDataTot([{ bron: "Google", dataTot: "2026-06-30", syncDraait: true }, { bron: "meta", dataTot: "2026-08-26", syncDraait: true }]);
  check("staan alle bronnen stil, dan telt de laatste dag; wie eerder ophoudt wordt genoemd",
    alleStil.dataTot === "2026-08-26" && alleStil.uitgesloten.join(",") === "Google", JSON.stringify(alleStil));

  const niets = gezamenlijkeDataTot([{ bron: "Google", dataTot: null }, { bron: "meta", dataTot: undefined }]);
  check("geen enkele bron met data: null", niets.dataTot === null && niets.uitgesloten.length === 0, JSON.stringify(niets));
  check("lege lijst: null", gezamenlijkeDataTot([]).dataTot === null);
}

// ── dataTotVanDagbron ──────────────────────────────────────────────────────
// Een dagkanaal zonder rij op de laatste dag(en) van de maand (geen levering in het weekend, of
// het maandbudget op) heeft na een geslaagde sync gewoon een gemeten nul. Op de nieuwste rij alleen
// werd een volle oktober "t/m 30" (review [10]); bij een gepauzeerd account met een gezonde sync
// verloor de kanaaltab maanden (review [3], [14]).
console.log("dataTotVanDagbron: een gezonde sync na de laatste rij maakt de dag ervoor gemeten");
check("dataTotVanDagbron bestaat", typeof dataTotVanDagbron === "function");
if (typeof dataTotVanDagbron === "function") {
  check("laatste rij vrijdag 30 okt, sync 1 nov: t/m 31 okt",
    dataTotVanDagbron({ laatsteDag: "2026-10-30", laatsteGeslaagdeSync: "2026-11-01T05:10:00Z", syncDraait: true }) === "2026-10-31");
  check("gepauzeerd sinds 15 maart, sync gezond: t/m de dag vóór de sync",
    dataTotVanDagbron({ laatsteDag: "2026-03-15", laatsteGeslaagdeSync: "2026-11-01T05:10:00Z", syncDraait: true }) === "2026-10-31");
  // De nachtcron draait om 05:00 UTC en haalt dagrijen t/m todayUTC() op (lib/sync/kanaal-runs.ts):
  // de rij van de syncdag zelf is dan zo'n zes van de 24 uur. Hier stond "de nieuwste rij", en dan
  // telde een oktober waarvan de sync op de 31e om 05:00 voor het laatst slaagde als volle maand,
  // met een 31e van zes uur erin en zonder "partieel" in de band; de maandbron gaf voor dezelfde
  // sync september vol en oktober t/m de 30e.
  check("de demo: rij van 26 aug, sync 26 aug 06:44: t/m 25 aug, zoals Google uit dezelfde sync",
    dataTotVanDagbron({ laatsteDag: "2026-08-26", laatsteGeslaagdeSync: "2026-08-26T06:44:34Z", syncDraait: false }) === "2026-08-25"
      && dataTotVanMaandbron?.("2026-08", "2026-08-26T06:44:34Z") === "2026-08-25",
    String(dataTotVanDagbron({ laatsteDag: "2026-08-26", laatsteGeslaagdeSync: "2026-08-26T06:44:34Z", syncDraait: false })));
  for (const nu of ["2026-11-01", "2026-11-03"]) {
    const syncdag = beoordeelDagstand({ kanaal: "meta", laatsteDag: "2026-10-31", laatsteGeslaagdeSync: "2026-10-31T05:00:00Z", nu });
    const dt = dataTotVanDagbron(syncdag);
    check(`rij van 31 okt, laatste geslaagde sync 31 okt 05:00 (op ${nu}): t/m 30 okt`, dt === "2026-10-30", String(dt));
    if (typeof volleMaand === "function") {
      const vm = volleMaand({ dataTot: dt, nu });
      check(`  en dus september vol, oktober partieel t/m 30 (op ${nu})`,
        vm.laatsteVolleMaand === "2026-09" && vm.partieel?.maand === "2026-10" && vm.partieel?.tmDag === 30, JSON.stringify(vm));
    }
  }
  // Rijen NA de laatste geslaagde sync: een run die de dagrijen schreef en daarna op iets anders
  // faalde, zet last_sync_at niet. Ook die run haalde t/m zijn eigen dag op, dus zijn nieuwste rij is
  // even partieel; de dagen ervoor zijn wel compleet en horen niet terug te vallen naar de oude sync.
  check("rijen t/m 2 nov, laatste geslaagde sync 31 okt: t/m 1 nov (de nieuwste rij is zelf partieel)",
    dataTotVanDagbron({ laatsteDag: "2026-11-02", laatsteGeslaagdeSync: "2026-10-31T05:00:00Z", syncDraait: false }) === "2026-11-01",
    String(dataTotVanDagbron({ laatsteDag: "2026-11-02", laatsteGeslaagdeSync: "2026-10-31T05:00:00Z", syncDraait: false })));
  check("zonder bekende sync: de nieuwste rij, zoals voorheen",
    dataTotVanDagbron({ laatsteDag: "2026-08-26", laatsteGeslaagdeSync: null, syncDraait: false }) === "2026-08-26");
  // Wat een geslaagde sync gemeten heeft, blijft gemeten als hij ouder wordt. Hier telde de dag vóór
  // de sync alleen zolang syncDraait gold, en die eist ook een sync van hooguit drie dagen oud: een
  // gepauzeerde Meta (laatste rij 20 september) met een geslaagde sync op 29 oktober en daarna alleen
  // mislukte, stond op 1 november t/m 28 oktober en op 2 november ineens t/m 20 september. Zonder
  // dat er iets aan de data veranderde viel het venster van oktober terug naar augustus.
  const oud = beoordeelDagstand({ kanaal: "meta", laatsteDag: "2026-09-20", laatsteGeslaagdeSync: "2026-10-29T05:00:00Z", nu: "2026-11-02" });
  check("voorwaarde: op 2 november draait die sync niet meer", oud.syncDraait === false, JSON.stringify(oud));
  check("geslaagde sync van 29 oktober, vier dagen oud: nog steeds t/m 28 oktober",
    dataTotVanDagbron(oud) === "2026-10-28", String(dataTotVanDagbron(oud)));
  check("en op 1 november hetzelfde", dataTotVanDagbron(beoordeelDagstand({ kanaal: "meta", laatsteDag: "2026-09-20", laatsteGeslaagdeSync: "2026-10-29T05:00:00Z", nu: "2026-11-01" })) === "2026-10-28");
  if (typeof volleMaand === "function") {
    check("dus september blijft vol, ook een week later",
      volleMaand({ dataTot: dataTotVanDagbron(beoordeelDagstand({ kanaal: "meta", laatsteDag: "2026-09-20", laatsteGeslaagdeSync: "2026-10-29T05:00:00Z", nu: "2026-11-09" })), nu: "2026-11-09" }).laatsteVolleMaand === "2026-09");
  }
  check("zonder rijen: null, ook met een sync", dataTotVanDagbron({ laatsteDag: null, laatsteGeslaagdeSync: "2026-11-01T05:10:00Z", syncDraait: false }) === null);
  if (typeof volleMaand === "function") {
    const wk = volleMaand({ dataTot: dataTotVanDagbron({ laatsteDag: "2026-10-30", laatsteGeslaagdeSync: "2026-11-01T05:10:00Z", syncDraait: true }), nu: "2026-11-01" });
    check("samen met volleMaand: oktober is vol", wk.laatsteVolleMaand === "2026-10" && wk.partieel === null, JSON.stringify(wk));
  }
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);
