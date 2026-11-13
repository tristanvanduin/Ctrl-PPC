// Gedrag van de dagperiode en zijn vijf vergelijkingen (lib/period/dag-periode.ts).
// Draaien: tsx --tsconfig ./tsconfig.json lib/period/__dag_periode_test.ts
//
// De lastige gevallen staan hier met hun uitkomst uitgeschreven, niet nagerekend met dezelfde
// formule: een test die de functie herhaalt, keurt elke fout in die functie goed.

import {
  aantalDagen, alsMaandPeriode, dagenOverlappen, formatDagPeriode, isGeldigeDag, laatsteDagVanMaand,
  OVERLAP_WAARSCHUWING, resolveDagVergelijking, uitMaandKeuze, uitMaandPeriode, WEEKDAG_GRENS_DAGEN,
  type DagPeriode,
} from "./dag-periode";
import { COMPARISON_MODES, PERIOD_PRESETS, comparisonWarning, resolveComparison, resolvePeriod } from "./period-range";
import { eventPeriodesVoorKlant } from "../events/event-periodes";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const zelfde = (a: DagPeriode | null | undefined, b: DagPeriode | null | undefined) =>
  !!a && !!b && a.start === b.start && a.eind === b.eind;
const toon = (p: DagPeriode | null | undefined) => (p ? `${p.start}..${p.eind}` : "null");
const weekdag = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

console.log("Dag en maand vertalen");
{
  check("2026-02-30 is geen dag", !isGeldigeDag("2026-02-30"));
  check("2024-02-29 wel, 2025-02-29 niet", isGeldigeDag("2024-02-29") && !isGeldigeDag("2025-02-29"));
  check("laatste dag van februari 2024 is de 29e", laatsteDagVanMaand("2024-02") === "2024-02-29");
  check("laatste dag van december", laatsteDagVanMaand("2025-12") === "2025-12-31");
  const p = uitMaandPeriode({ start: "2025-11", end: "2026-02" });
  check("een maandperiode is van de eerste t/m de laatste dag", zelfde(p, { start: "2025-11-01", eind: "2026-02-28" }), toon(p));
  const terug = alsMaandPeriode(p);
  check("en terug is dezelfde maandperiode", terug?.start === "2025-11" && terug?.end === "2026-02", JSON.stringify(terug));
  check("een dagperiode die op de 2e begint is geen hele maand", alsMaandPeriode({ start: "2025-11-02", eind: "2025-11-30" }) === null);
  check("een dagperiode die vóór de laatste dag stopt ook niet", alsMaandPeriode({ start: "2024-02-01", eind: "2024-02-28" }) === null);
  check("aantal dagen over de jaargrens", aantalDagen({ start: "2025-12-28", eind: "2026-01-03" }) === 7);
  check("aantal dagen over 29 februari", aantalDagen({ start: "2024-02-28", eind: "2024-03-01" }) === 3);
  check("label", formatDagPeriode({ start: "2025-11-24", eind: "2025-11-30" }) === "24 t/m 30 nov 2025", formatDagPeriode({ start: "2025-11-24", eind: "2025-11-30" }));
  check("label over de jaargrens", formatDagPeriode({ start: "2025-12-28", eind: "2026-01-03" }) === "28 dec 2025 t/m 3 jan 2026");
}

console.log("Hele maanden vergelijken precies zoals het maandmodel");
{
  // Voor elke preset en elke vergelijking: dezelfde vergelijkingsmaanden als resolveComparison, en
  // dezelfde waarschuwing over overlap als comparisonWarning.
  const eigen = { start: "2024-03", end: "2025-08" }; // 18 maanden: vorig jaar overlapt
  for (const nu of ["2026-11", "2026-01", "2025-03"]) {
    for (const preset of PERIOD_PRESETS) {
      const p = resolvePeriod(preset, eigen, nu);
      for (const mode of COMPARISON_MODES) {
        const c = resolveComparison(p, mode);
        const { periode, vergelijking } = uitMaandKeuze(p, mode);
        check(`${nu} ${preset}/${mode}: de periode`, zelfde(periode, uitMaandPeriode(p)));
        check(`${nu} ${preset}/${mode}: de vergelijking`,
          c === null ? vergelijking.periode === null : zelfde(vergelijking.periode, uitMaandPeriode(c)),
          `${toon(vergelijking.periode)} vs ${c ? toon(uitMaandPeriode(c)) : "null"}`);
        const oud = comparisonWarning(p, mode);
        check(`${nu} ${preset}/${mode}: dezelfde overlapwaarschuwing`,
          (oud === OVERLAP_WAARSCHUWING) === vergelijking.waarschuwingen.includes(OVERLAP_WAARSCHUWING),
          `${oud} vs ${vergelijking.waarschuwingen.join(" | ")}`);
        check(`${nu} ${preset}/${mode}: geen lengtewaarschuwing bij hele maanden`,
          !vergelijking.waarschuwingen.some((w) => w.includes("dagen, de gekozen periode")), vergelijking.waarschuwingen.join(" | "));
      }
    }
  }
  // Voorgaande periode is even veel MAANDEN: maart-mei (92 dagen) tegen december-februari (90).
  const v = resolveDagVergelijking({ start: "2026-03-01", eind: "2026-05-31" }, "previous_period");
  check("maart-mei vergelijkt met december-februari", zelfde(v.periode, { start: "2025-12-01", eind: "2026-02-28" }), toon(v.periode));
}

console.log("Voorgaande periode in dagen");
{
  const v = resolveDagVergelijking({ start: "2025-11-24", eind: "2025-11-30" }, "previous_period");
  check("zeven dagen direct ervoor", zelfde(v.periode, { start: "2025-11-17", eind: "2025-11-23" }), toon(v.periode));
  check("het label noemt het aantal dagen", v.label.includes("7 dagen"), v.label);
  const j = resolveDagVergelijking({ start: "2026-01-01", eind: "2026-01-10" }, "previous_period");
  check("over de jaargrens terug", zelfde(j.periode, { start: "2025-12-22", eind: "2025-12-31" }), toon(j.periode));
  const een = resolveDagVergelijking({ start: "2026-03-01", eind: "2026-03-01" }, "previous_period");
  check("één dag: de dag ervoor, ook als dat 28 februari is", zelfde(een.periode, { start: "2026-02-28", eind: "2026-02-28" }), toon(een.periode));
  check("geen overlap", !v.waarschuwingen.includes(OVERLAP_WAARSCHUWING));
}

console.log("Vorig jaar: kalender of 364 dagen");
{
  // Black Friday 2025 is vrijdag 28 november. Dezelfde kalenderdatum in 2024 is een donderdag.
  const bf: DagPeriode = { start: "2025-11-28", eind: "2025-11-28" };
  check("28 november 2025 is een vrijdag", weekdag("2025-11-28") === 5);
  const auto = resolveDagVergelijking(bf, "same_dates_last_year");
  check("kort: automatisch 364 dagen terug", auto.uitlijning === "weekdag" && zelfde(auto.periode, { start: "2024-11-29", eind: "2024-11-29" }), toon(auto.periode));
  check("vrijdag blijft vrijdag", weekdag(auto.periode!.start) === 5, auto.periode!.start);
  check("het label zegt welke verschuiving", auto.label.includes("364") && auto.label.includes("weekdagen"), auto.label);
  const kal = resolveDagVergelijking(bf, "same_dates_last_year", { uitlijning: "kalender" });
  check("op verzoek dezelfde kalenderdatum", kal.uitlijning === "kalender" && zelfde(kal.periode, { start: "2024-11-28", eind: "2024-11-28" }), toon(kal.periode));
  check("en dat label zegt kalenderdatums", kal.label.includes("kalenderdatums"), kal.label);
  check("die valt op een donderdag", weekdag(kal.periode!.start) === 4);

  // Een week over de jaargrens: 364 dagen terug blijft maandag t/m zondag.
  const jg = resolveDagVergelijking({ start: "2025-12-29", eind: "2026-01-04" }, "same_dates_last_year");
  check("over de jaargrens, 364 dagen", zelfde(jg.periode, { start: "2024-12-30", eind: "2025-01-05" }), toon(jg.periode));
  check("maandag blijft maandag", weekdag(jg.periode!.start) === 1 && weekdag(jg.periode!.eind) === 0);

  // Precies acht weken mag nog; een dag langer is kalender, ook als weekdag gevraagd is (met reden).
  const acht = { start: "2025-10-06", eind: "2025-11-30" };
  check("acht weken is 56 dagen", aantalDagen(acht) === WEEKDAG_GRENS_DAGEN);
  check("acht weken: nog weekdag", resolveDagVergelijking(acht, "same_dates_last_year").uitlijning === "weekdag");
  const lang = { start: "2025-10-05", eind: "2025-11-30" };
  const l = resolveDagVergelijking(lang, "same_dates_last_year", { uitlijning: "weekdag" });
  check("57 dagen: kalender", l.uitlijning === "kalender" && zelfde(l.periode, { start: "2024-10-05", eind: "2024-11-30" }), toon(l.periode));
  check("en dat wordt gezegd", l.waarschuwingen.some((w) => w.includes("364 dagen") && w.includes("57 dagen")), l.waarschuwingen.join(" | "));

  // Een hele maand blijft automatisch kalender (het maandmodel); op verzoek mag weekdag.
  const feb = { start: "2026-02-01", eind: "2026-02-28" };
  check("hele februari automatisch: februari vorig jaar", zelfde(resolveDagVergelijking(feb, "same_dates_last_year").periode, { start: "2025-02-01", eind: "2025-02-28" }));
  check("hele februari met weekdag: 364 dagen", zelfde(resolveDagVergelijking(feb, "same_dates_last_year", { uitlijning: "weekdag" }).periode, { start: "2025-02-02", eind: "2025-03-01" }));
}

console.log("29 februari");
{
  const schrikkel = resolveDagVergelijking({ start: "2024-02-29", eind: "2024-02-29" }, "same_dates_last_year", { uitlijning: "kalender" });
  check("29 februari wordt 28 februari, niet 1 maart", zelfde(schrikkel.periode, { start: "2023-02-28", eind: "2023-02-28" }), toon(schrikkel.periode));
  // Hele februari 2025 tegen hele februari 2024: 28 tegen 29 dagen, en dat is het maandmodel.
  const feb = resolveDagVergelijking({ start: "2025-02-01", eind: "2025-02-28" }, "same_dates_last_year");
  check("hele februari 2025 tegen heel februari 2024", zelfde(feb.periode, { start: "2024-02-01", eind: "2024-02-29" }), toon(feb.periode));
  check("zonder lengtewaarschuwing (een maand is een maand)", feb.waarschuwingen.length === 0, feb.waarschuwingen.join(" | "));
  // Een periode over 29 februari heen: één dag langer, en dat staat erbij.
  const over = resolveDagVergelijking({ start: "2025-02-27", eind: "2025-03-02" }, "same_dates_last_year", { uitlijning: "kalender" });
  check("27 feb - 2 mrt 2025 tegen 27 feb - 2 mrt 2024", zelfde(over.periode, { start: "2024-02-27", eind: "2024-03-02" }), toon(over.periode));
  check("met de waarschuwing dat de lengte verschilt", over.waarschuwingen.some((w) => w.includes("5 dagen") && w.includes("periode 4")), over.waarschuwingen.join(" | "));
  // De spiegelvorm, bewust zo (zie jaarTerug): 28 feb t/m 1 mrt 2025 is 2 dagen, dezelfde datums in
  // 2024 zijn er 3, met 29 februari erbij. Geen fout: dat zijn dezelfde kalenderdatums, en de
  // lengte wordt gemeld. Wie gelijke lengte wil, kiest 364 dagen.
  const spiegel = resolveDagVergelijking({ start: "2025-02-28", eind: "2025-03-01" }, "same_dates_last_year", { uitlijning: "kalender" });
  check("spiegelvorm: 28 feb - 1 mrt 2025 tegen 28 feb - 1 mrt 2024", zelfde(spiegel.periode, { start: "2024-02-28", eind: "2024-03-01" }), toon(spiegel.periode));
  check("spiegelvorm: 3 dagen tegen 2, en dat wordt gemeld", spiegel.waarschuwingen.some((w) => w.includes("3 dagen") && w.includes("periode 2")), spiegel.waarschuwingen.join(" | "));
  const spiegelW = resolveDagVergelijking({ start: "2025-02-28", eind: "2025-03-01" }, "same_dates_last_year");
  check("spiegelvorm met 364 dagen: even lang, zonder melding", spiegelW.uitlijning === "weekdag" && aantalDagen(spiegelW.periode!) === 2 && spiegelW.waarschuwingen.length === 0, spiegelW.waarschuwingen.join(" | "));
  // Met 364 dagen is er geen probleem: de lengte blijft gelijk.
  const w = resolveDagVergelijking({ start: "2024-02-29", eind: "2024-03-03" }, "same_dates_last_year");
  check("364 dagen terug vanaf 29 februari", zelfde(w.periode, { start: "2023-03-02", eind: "2023-03-05" }), toon(w.periode));
  check("donderdag blijft donderdag", weekdag("2024-02-29") === weekdag(w.periode!.start));
}

console.log("Vorige editie");
{
  const periodes = eventPeriodesVoorKlant([
    { id: "bf", name: "Black Friday", abbrev: "BF", cadence: "annual", editions: [
      { date: "2024-11-29", label: "2024", start: "2024-11-25", end: "2024-12-02" },
      { date: "2025-11-28", label: "2025", start: "2025-11-24", end: "2025-12-01" },
    ] },
    { id: "beurs", name: "Kasbeurs", abbrev: "KB", cadence: "biennial", editions: [
      { date: "2022-06-14", label: "2022" }, { date: "2024-06-11", label: "2024" }, { date: "2026-06-16", label: "2026" },
    ] },
    { id: "nieuw", name: "Lenteactie", abbrev: "LA", cadence: "custom", editions: [{ date: "2026-04-10", label: "2026", start: "2026-04-01", end: "2026-04-10" }] },
  ]);
  const bf25 = periodes.find((e) => e.eventId === "bf" && e.label === "2025")!;
  const v = resolveDagVergelijking(bf25, "previous_edition", { editie: bf25 });
  check("Black Friday 2025 tegen de week van 2024 uit de instellingen", zelfde(v.periode, { start: "2024-11-25", eind: "2024-12-02" }), toon(v.periode));
  check("het label noemt de editie", v.label.includes("Black Friday 2024"), v.label);
  check("geen waarschuwing bij gelijke lengte", v.waarschuwingen.length === 0, v.waarschuwingen.join(" | "));

  const kb26 = periodes.find((e) => e.eventId === "beurs" && e.label === "2026")!;
  const kb = resolveDagVergelijking(kb26, "previous_edition", { editie: kb26 });
  check("tweejaarlijks: de editie van twee jaar terug", zelfde(kb.periode, { start: "2024-06-11", eind: "2024-06-11" }), toon(kb.periode));

  const la = periodes.find((e) => e.eventId === "nieuw")!;
  const geen = resolveDagVergelijking(la, "previous_edition", { editie: la });
  check("zonder vorige editie: null", geen.periode === null);
  check("met de reden", !!geen.reden && geen.reden.includes("Lenteactie"), String(geen.reden));
  const zonder = resolveDagVergelijking({ start: "2026-04-01", eind: "2026-04-10" }, "previous_edition");
  check("zonder gekozen editie: null met reden", zonder.periode === null && !!zonder.reden);

  // Een dubbele editie in de instellingen: de vergelijking geeft de melding door.
  const dub = eventPeriodesVoorKlant([{ id: "bf", name: "Black Friday", editions: [
    { date: "2024-11-29", label: "2024" }, { date: "2025-11-28", label: "2025" }, { date: "2025-11-28", label: "2025" },
  ] }]);
  const dv = resolveDagVergelijking(dub[1], "previous_edition", { editie: dub[1] });
  check("een dubbele editie wordt bij de vergelijking gemeld", dv.waarschuwingen.some((w) => w.includes("2 edities")), dv.waarschuwingen.join(" | "));

  // De voorgaande periode bij een editie is de aanloop: dat wordt gezegd.
  const pp = resolveDagVergelijking(bf25, "previous_period", { editie: bf25 });
  check("voorgaande periode bij een editie waarschuwt", pp.waarschuwingen.some((w) => w.includes("aanloop")), pp.waarschuwingen.join(" | "));

  // Een andere periode dan die van de editie: de vorige editie zoals hij staat, met een zin erbij.
  const anders = resolveDagVergelijking({ start: "2025-11-28", eind: "2025-11-30" }, "previous_edition", { editie: bf25 });
  check("afwijkende periode: toch de vorige editie", zelfde(anders.periode, { start: "2024-11-25", eind: "2024-12-02" }));
  check("met waarschuwing", anders.waarschuwingen.some((w) => w.includes("niet die van Black Friday 2025")), anders.waarschuwingen.join(" | "));
}

console.log("Eigen vergelijking en overlap");
{
  const p = { start: "2025-11-24", eind: "2025-12-07" };
  const e = resolveDagVergelijking(p, "custom", { eigen: { start: "2025-12-01", eind: "2025-11-20" } });
  check("omgedraaide grenzen worden rechtgezet", zelfde(e.periode, { start: "2025-11-20", eind: "2025-12-01" }), toon(e.periode));
  check("overlap wordt gemeld met dezelfde zin als bij maanden", e.waarschuwingen[0] === OVERLAP_WAARSCHUWING, e.waarschuwingen.join(" | "));
  check("ongelijke lengte ook", e.waarschuwingen.some((w) => w.includes("12 dagen") && w.includes("periode 14")), e.waarschuwingen.join(" | "));
  const fout = resolveDagVergelijking(p, "custom", { eigen: { start: "2025-02-30", eind: "2025-03-05" } });
  check("een onbestaande datum geeft null met reden", fout.periode === null && !!fout.reden);
  check("geen eigen periode ook", resolveDagVergelijking(p, "custom").periode === null);
  check("none geeft alleen totalen", resolveDagVergelijking(p, "none").periode === null && resolveDagVergelijking(p, "none").reden === null);
  check("overlap aan de rand telt", dagenOverlappen({ start: "2025-01-01", eind: "2025-01-10" }, { start: "2025-01-10", eind: "2025-01-20" }));
  check("aansluitend overlapt niet", !dagenOverlappen({ start: "2025-01-01", eind: "2025-01-10" }, { start: "2025-01-11", eind: "2025-01-20" }));
  // Een lange periode tegen vorig jaar op de kalender overlapt, net als achttien maanden bij maanden.
  const lang = resolveDagVergelijking({ start: "2025-01-15", eind: "2026-03-15" }, "same_dates_last_year");
  check("een periode langer dan een jaar overlapt met vorig jaar", lang.waarschuwingen.includes(OVERLAP_WAARSCHUWING), lang.waarschuwingen.join(" | "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
