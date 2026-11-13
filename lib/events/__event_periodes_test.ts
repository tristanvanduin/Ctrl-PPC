// Het lezen van event-periodes uit rai_events (lib/events/event-periodes.ts).
// Draaien: tsx --tsconfig ./tsconfig.json lib/events/__event_periodes_test.ts

import { editiePeriode, eventPeriodesUitRaiEvents, eventPeriodesVoorKlant } from "./event-periodes";
import { standardB2cEvents } from "./standard-b2c-events";
import { demoRows } from "../demo/demo-rows";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("Eén editie");
{
  const alleenDatum = editiePeriode({ date: "2025-11-28", label: "2025" });
  check("alleen date: een periode van die ene dag", alleenDatum?.start === "2025-11-28" && alleenDatum?.eind === "2025-11-28" && alleenDatum.heeftPeriode === false, JSON.stringify(alleenDatum));
  const metPeriode = editiePeriode({ date: "2025-11-28", label: "2025", start: "2025-11-24", end: "2025-12-01" });
  check("start en end: die periode", metPeriode?.start === "2025-11-24" && metPeriode?.eind === "2025-12-01" && metPeriode.heeftPeriode, JSON.stringify(metPeriode));
  check("date blijft het ankerpunt", metPeriode?.datum === "2025-11-28");
  const halfStart = editiePeriode({ date: "2026-06-16", start: "2026-06-01" });
  check("alleen start: t/m date", halfStart?.start === "2026-06-01" && halfStart?.eind === "2026-06-16", JSON.stringify(halfStart));
  const halfEind = editiePeriode({ date: "2026-06-16", end: "2026-06-18" });
  check("alleen end: vanaf date", halfEind?.start === "2026-06-16" && halfEind?.eind === "2026-06-18", JSON.stringify(halfEind));
  const zonderDatum = editiePeriode({ start: "2026-04-01", end: "2026-04-10" });
  check("zonder date: de start is het ankerpunt", zonderDatum?.datum === "2026-04-01" && zonderDatum.eind === "2026-04-10");
  const om = editiePeriode({ date: "2026-04-10", start: "2026-04-12", end: "2026-04-05" });
  check("omgedraaid wordt rechtgezet", om?.start === "2026-04-05" && om?.eind === "2026-04-12", JSON.stringify(om));
  check("een onbestaande datum maakt de editie onbruikbaar", editiePeriode({ date: "2026-02-30" }) === null);
  check("ook als alleen end niet bestaat", editiePeriode({ date: "2026-02-10", end: "2026-02-30" }) === null);
  check("lege velden tellen als afwezig", editiePeriode({ date: "2026-02-10", start: "", end: null })?.eind === "2026-02-10");
  check("helemaal leeg: niets", editiePeriode({ date: "", label: "" }) === null);
  // Zoals lib/fair: een datum met een tijd telt op zijn eerste tien tekens.
  const metTijd = editiePeriode({ date: "2026-01-05T00:00:00Z", start: "2026-01-02T00:00:00.000Z" });
  check("een datum met een tijd is bruikbaar", metTijd?.datum === "2026-01-05" && metTijd.start === "2026-01-02" && metTijd.eind === "2026-01-05", JSON.stringify(metTijd));
  check("een getal is geen datum", editiePeriode({ date: 20260105 }) === null);
}

console.log("De lijst van een klant");
{
  const lijst = eventPeriodesVoorKlant([
    { id: "beurs", name: " Kasbeurs ", abbrev: "KB", cadence: "biennial", editions: [
      { date: "2026-06-16", label: "2026" }, { date: "2022-06-14", label: "" }, { date: "2024-06-11", label: "2024" },
    ] },
    { id: "bf", name: "Black Friday", abbrev: "BF", cadence: "annual", editions: [
      { date: "2025-11-28", label: "2025", start: "2025-11-24", end: "2025-12-01" },
      { date: "2024-11-29", label: "2024" },
    ] },
    { id: "", name: "Zonder id", editions: [{ date: "2025-01-01", label: "x" }] },
    { id: "leeg", name: "  ", editions: [{ date: "2025-01-01", label: "x" }] },
    { id: "eenmalig", name: "Lenteactie", abbrev: "LA", cadence: "custom", editions: [{ date: "2026-04-10", label: "2026", start: "2026-04-01", end: "2026-04-10" }] },
  ]);
  check("events zonder id of naam vallen weg", lijst.every((e) => e.eventId && e.naam.trim()) && lijst.length === 6, String(lijst.length));
  check("chronologisch gesorteerd", lijst.every((e, i) => i === 0 || lijst[i - 1].start <= e.start), lijst.map((e) => e.start).join(","));
  check("de naam is getrimd", lijst.find((e) => e.eventId === "beurs")?.naam === "Kasbeurs");
  const kb22 = lijst.find((e) => e.eventId === "beurs" && e.start === "2022-06-14")!;
  check("een leeg label wordt het jaar", kb22.label === "2022", kb22.label);
  check("de eerste editie heeft geen vorige", kb22.vorige === null);
  const kb26 = lijst.find((e) => e.eventId === "beurs" && e.label === "2026")!;
  check("tweejaarlijks: de vorige is 2024, niet 2022", kb26.vorige?.label === "2024" && kb26.vorige.start === "2024-06-11", JSON.stringify(kb26.vorige));
  check("met de afstand in dagen", kb26.vorige?.afstandDagen === 735, String(kb26.vorige?.afstandDagen));
  const bf25 = lijst.find((e) => e.eventId === "bf" && e.label === "2025")!;
  check("de vorige is van hetzelfde event, niet de beurs ervoor", bf25.vorige?.label === "2024" && bf25.vorige.start === "2024-11-29", JSON.stringify(bf25.vorige));
  check("een editie met periode heet zo", bf25.heeftPeriode && bf25.start === "2025-11-24" && bf25.eind === "2025-12-01");
  check("een eenmalig event heeft geen vorige editie", lijst.find((e) => e.eventId === "eenmalig")?.vorige === null);
  check("cadans en afkorting gaan mee", bf25.cadence === "annual" && bf25.abbrev === "BF");
}

console.log("Dubbele edities en het ankerpunt");
{
  // Dezelfde Black Friday twee keer: kaal, en met de ingevulde periode. Eén editie, die met periode.
  const lijst = eventPeriodesVoorKlant([
    { id: "bf", name: "Black Friday", abbrev: "BF", cadence: "annual", editions: [
      { date: "2024-11-29", label: "2024" },
      { date: "2024-11-29", label: "2024", start: "2024-11-25", end: "2024-12-02" },
      { date: "2025-11-28", label: "2025", start: "2025-11-24", end: "2025-12-01" },
    ] },
  ]);
  check("de dubbele wordt één editie", lijst.length === 2, JSON.stringify(lijst.map((e) => [e.start, e.eind])));
  const bf24 = lijst.find((e) => e.label === "2024")!;
  check("die met een periode gaat voor", bf24.heeftPeriode && bf24.start === "2024-11-25" && bf24.eind === "2024-12-02", JSON.stringify(bf24));
  check("en meldt de dubbele", !!bf24.waarschuwing?.includes("2 edities"), String(bf24.waarschuwing));
  check("de editie 2024 is niet zijn eigen vorige", bf24.vorige === null, JSON.stringify(bf24.vorige));
  const bf25 = lijst.find((e) => e.label === "2025")!;
  check("2025 vergelijkt met de ingevulde periode van 2024", bf25.vorige?.start === "2024-11-25" && bf25.vorige.eind === "2024-12-02", JSON.stringify(bf25.vorige));
  check("zonder melding", bf25.waarschuwing === null);
  // Andersom ingevuld (eerst met periode, dan kaal): dezelfde uitkomst.
  const om = eventPeriodesVoorKlant([{ id: "bf", name: "Black Friday", editions: [
    { date: "2024-11-29", label: "2024", start: "2024-11-25", end: "2024-12-02" }, { date: "2024-11-29", label: "2024" },
  ] }]);
  check("de volgorde in de lijst maakt niet uit", om.length === 1 && om[0].heeftPeriode && !!om[0].waarschuwing);

  // De vorige editie op het ankerpunt, niet op de start: de editie van 2026 heeft een aanloop die
  // vóór de start van de periode van 2025 begint. Op start gesorteerd was 2025 dan de "volgende".
  const vroeg = eventPeriodesVoorKlant([{ id: "a", name: "Actie", editions: [
    { date: "2025-06-10", label: "2025", start: "2025-06-01", end: "2025-06-20" },
    { date: "2026-06-10", label: "2026", start: "2025-05-20", end: "2026-06-10" },
  ] }]);
  const a26 = vroeg.find((e) => e.label === "2026")!;
  const a25 = vroeg.find((e) => e.label === "2025")!;
  check("de vorige van 2026 is 2025, ook met een vroegere start", a26.vorige?.label === "2025" && a26.vorige.datum === "2025-06-10", JSON.stringify(a26.vorige));
  check("en 2025 heeft geen vorige", a25.vorige === null, JSON.stringify(a25.vorige));
  check("de afstand gaat van ankerpunt tot ankerpunt", a26.vorige?.afstandDagen === 365, String(a26.vorige?.afstandDagen));

  // Een leeg label wordt het jaar van date, ook als de aanloop in het jaar ervoor begint.
  const jg = eventPeriodesVoorKlant([{ id: "n", name: "Nieuwjaarsactie", editions: [{ date: "2026-01-02", label: "", start: "2025-12-27", end: "2026-01-04" }] }]);
  check("het terugvallabel is het jaar van date", jg[0]?.label === "2026", String(jg[0]?.label));
}

console.log("Uit de kolom zelf");
{
  check("null geeft een lege lijst", eventPeriodesUitRaiEvents(null).length === 0);
  check("een kolom zonder events ook", eventPeriodesUitRaiEvents({}).length === 0);
  check("events dat geen lijst is ook", eventPeriodesUitRaiEvents({ events: "kapot" }).length === 0);
  // De demo-klant, zoals de mock hem draagt: alleen date, dus allemaal eendaagse periodes.
  const cs = demoRows().client_settings.find((r) => r.client_id === DEMO_GREENTECH_ID)!;
  const demo = eventPeriodesUitRaiEvents(cs.rai_events);
  check("de demo heeft vijf edities", demo.length === 5, String(demo.length));
  check("allemaal één dag", demo.every((e) => e.start === e.eind && !e.heeftPeriode));
  const gra26 = demo.find((e) => e.eventId === "demo-gra" && e.label === "2026");
  check("GreenTech Americas 2026 vergelijkt met 2025", gra26?.vorige?.start === "2025-09-16", JSON.stringify(gra26?.vorige));
  check("GreenTech North America heeft geen vorige editie", demo.find((e) => e.eventId === "demo-grn")?.vorige === null);
}

console.log("Het B2C-voorstel");
{
  // Het voorstel uit standard-b2c-events.ts (alleen date) leest als eendaagse periodes, met per
  // event de editie van een jaar eerder als vorige: zo ziet een klant die het voorstel opslaat het.
  const voorstel = standardB2cEvents(new Date(2026, 5, 1));
  const lijst = eventPeriodesVoorKlant(voorstel);
  check("vier events maal drie jaar", lijst.length === 12, String(lijst.length));
  const bf = lijst.filter((e) => e.naam === "Black Friday");
  check("Black Friday 2026 vergelijkt met die van 2025", bf[1]?.start === "2026-11-27" && bf[1]?.vorige?.start === "2025-11-28" && bf[0]?.vorige === null, JSON.stringify(bf.map((e) => e.start)));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
