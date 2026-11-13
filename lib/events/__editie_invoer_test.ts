// Begin en eind per editie in Instellingen > Events (lib/events/editie-invoer.ts).
// Draaien: tsx --tsconfig ./tsconfig.json lib/events/__editie_invoer_test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editieDag, editieHint, editieVoorOpslag, eventsVoorOpslag, foutenVoorOpslag, MAX_EDITIE_DAGEN, valideerEditie } from "./editie-invoer";
import { eventPeriodesUitRaiEvents } from "./event-periodes";
import { standardB2cEvents } from "./standard-b2c-events";
import type { Edition } from "../fair/geo-clone-settings";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Ev = { id: string; name: string; abbrev: string; cadence: "annual" | "biennial" | "custom"; editions: Edition[] };

// Wat event-settings.tsx vóór deze stap opsloeg, letterlijk overgenomen: de maatstaf voor byte-gelijk.
function oudeOpslag(events: Ev[]) {
  return events
    .filter((e) => e.name.trim())
    .map((e) => ({ ...e, editions: e.editions.filter((ed) => ed.date) }));
}
const opslaan = (events: Ev[]) => JSON.stringify({ rai_events: { events: eventsVoorOpslag(events) } });
const teruglezen = (json: string): Ev[] => (JSON.parse(json) as { rai_events: { events: Ev[] } }).rai_events.events;

console.log("Zonder begin en eind: byte-gelijk aan voorheen");
{
  const events: Ev[] = [
    { id: "a", name: "GreenTech", abbrev: "GTA", cadence: "annual", editions: [{ date: "2025-06-10", label: "2025" }, { date: "", label: "" }, { date: "2026-06-16", label: "" }] },
    { id: "b", name: "  ", abbrev: "", cadence: "annual", editions: [{ date: "2026-01-01", label: "" }] },
    { id: "c", name: "Inkoop", abbrev: "INK", cadence: "biennial", editions: [] },
  ];
  const nieuw = opslaan(events);
  check("de hele payload is byte-gelijk", nieuw === JSON.stringify({ rai_events: { events: oudeOpslag(events) } }), nieuw);
  check("geen start of end in de JSON", !/"start"|"end"/.test(nieuw));
  const ed: Edition = { date: "2025-06-10", label: "2025" };
  check("een kale editie komt als hetzelfde object terug", editieVoorOpslag(ed) === ed);

  // Iemand vulde een begin in en maakte het weer leeg: het formulier houdt dan start: "" vast.
  const leeggemaakt: Ev[] = [{ ...events[0], editions: [{ date: "2025-06-10", label: "2025", start: "", end: "" }, { date: "2026-06-16", label: "", start: null, end: undefined }] }];
  const kaal: Ev[] = [{ ...events[0], editions: [{ date: "2025-06-10", label: "2025" }, { date: "2026-06-16", label: "" }] }];
  check("leeg begin en eind worden weggelaten, niet als \"\" of null bewaard", opslaan(leeggemaakt) === opslaan(kaal), opslaan(leeggemaakt));

  const b2c = standardB2cEvents(new Date(2026, 5, 1)) as Ev[];
  check("het B2C-voorstel blijft alleen een datum per editie", b2c.every((e) => e.editions.every((x) => Object.keys(x).join() === "date,label")));
  check("en wordt opgeslagen als voorheen", opslaan(b2c) === JSON.stringify({ rai_events: { events: oudeOpslag(b2c) } }));
  check("en heeft geen fouten", foutenVoorOpslag(b2c).length === 0);
}

console.log("Met begin en eind: opslaan en teruglezen");
{
  const events: Ev[] = [{
    id: "bf", name: "Black Friday", abbrev: "BF", cadence: "annual",
    editions: [
      { date: "2025-11-28", label: "2025", start: "2025-11-21", end: "2025-12-01" },
      { date: "2026-11-27", label: "2026", start: "2026-11-13", end: "" },
      { date: "2024-11-29", label: "2024" },
    ],
  }];
  check("geen fouten", foutenVoorOpslag(events).length === 0, foutenVoorOpslag(events).join(" | "));
  const json = opslaan(events);
  const terug = teruglezen(json);
  const eds = terug[0].editions;
  check("begin en eind komen terug", eds[0].start === "2025-11-21" && eds[0].end === "2025-12-01", JSON.stringify(eds[0]));
  check("in de volgorde date, label, start, end", Object.keys(eds[0]).join() === "date,label,start,end", Object.keys(eds[0]).join());
  check("alleen een begin: geen end-sleutel", eds[1].start === "2026-11-13" && !("end" in eds[1]), JSON.stringify(eds[1]));
  check("de kale editie blijft kaal", Object.keys(eds[2]).join() === "date,label");
  check("opnieuw opslaan verandert niets", opslaan(terug) === json);

  // En de lezer van het periodemodel ziet dezelfde periodes.
  const periodes = eventPeriodesUitRaiEvents(JSON.parse(json).rai_events);
  const p25 = periodes.find((p) => p.label === "2025");
  const p26 = periodes.find((p) => p.label === "2026");
  const p24 = periodes.find((p) => p.label === "2024");
  check("2025: 21 nov t/m 1 dec, ankerpunt 28 nov", p25?.start === "2025-11-21" && p25.eind === "2025-12-01" && p25.datum === "2025-11-28" && p25.heeftPeriode, JSON.stringify(p25));
  check("2026: alleen begin loopt t/m de datum", p26?.start === "2026-11-13" && p26.eind === "2026-11-27", JSON.stringify(p26));
  check("2024: één dag", p24?.start === "2024-11-29" && p24.eind === "2024-11-29" && !p24.heeftPeriode, JSON.stringify(p24));
}

console.log("Validaties");
{
  const v = (ed: Partial<Edition>) => valideerEditie({ date: "", label: "", ...ed });
  check("een lege editie heeft geen fouten", Object.keys(v({})).length === 0);
  check("alleen een datum heeft geen fouten", Object.keys(v({ date: "2026-06-16" })).length === 0);
  check("een kale editie met een oude tijd erin ook niet", Object.keys(v({ date: "2026-01-05T00:00:00Z" })).length === 0);
  check("begin en eind op de datum mag", Object.keys(v({ date: "2026-06-16", start: "2026-06-16", end: "2026-06-16" })).length === 0);

  const eindVoorBegin = v({ date: "2026-06-16", start: "2026-06-20", end: "2026-06-10" });
  check("eind vóór begin: melding bij het eind", /vóór het begin/.test(eindVoorBegin.end ?? "") && !eindVoorBegin.start, JSON.stringify(eindVoorBegin));

  const beginNa = v({ date: "2026-06-16", start: "2026-06-17", end: "2026-06-20" });
  check("datum vóór het begin: melding bij het begin", /ligt na de datum/.test(beginNa.start ?? ""), JSON.stringify(beginNa));
  check("met de uitleg over beursdag en piekdag", /beursdag/.test(beginNa.start ?? "") && /piekdag/.test(beginNa.start ?? ""));
  const eindVoor = v({ date: "2026-06-16", start: "2026-06-01", end: "2026-06-15" });
  check("datum na het eind: melding bij het eind", /vóór de datum/.test(eindVoor.end ?? "") && /ankerpunt/.test(eindVoor.end ?? ""), JSON.stringify(eindVoor));
  check("ook bij alleen een begin na de datum", !!v({ date: "2026-06-16", start: "2026-06-18" }).start);
  check("ook bij alleen een eind vóór de datum", !!v({ date: "2026-06-16", end: "2026-06-14" }).end);

  const zonderDatum = v({ start: "2026-04-01", end: "2026-04-10" });
  check("begin en eind zonder datum: melding bij de datum", /Vul ook de datum in/.test(zonderDatum.date ?? ""), JSON.stringify(zonderDatum));
  check("onbestaand begin", /geen bestaande datum/.test(v({ date: "2026-02-10", start: "2026-02-30" }).start ?? ""));
  check("onbestaand eind", /geen bestaande datum/.test(v({ date: "2026-02-10", end: "2026-13-01" }).end ?? ""));

  const precies = v({ date: "2024-06-01", start: "2024-01-01", end: "2024-12-31" });
  check(`precies ${MAX_EDITIE_DAGEN} dagen (schrikkeljaar) mag`, Object.keys(precies).length === 0, JSON.stringify(precies));
  const teLang = v({ date: "2024-06-01", start: "2024-01-01", end: "2025-01-01" });
  check("een dag langer niet, met de lengte in de melding", /367 dagen/.test(teLang.end ?? "") && /366/.test(teLang.end ?? ""), JSON.stringify(teLang));
  const teLangBegin = v({ date: "2026-06-01", start: "2025-01-01" });
  check("te lang met alleen een begin: melding bij het begin", /dagen/.test(teLangBegin.start ?? ""), JSON.stringify(teLangBegin));

  const events: Ev[] = [
    { id: "x", name: "Zomersale", abbrev: "", cadence: "custom", editions: [{ date: "2026-07-01", label: "", start: "2026-07-05", end: "2026-07-10" }] },
    { id: "y", name: "", abbrev: "", cadence: "custom", editions: [{ date: "", label: "", start: "2026-07-05" }] },
  ];
  const fouten = foutenVoorOpslag(events);
  check("foutenVoorOpslag noemt event en editie", fouten.length === 1 && fouten[0].startsWith("Zomersale, editie 1: "), JSON.stringify(fouten));
  check("een event zonder naam (wordt niet opgeslagen) houdt het opslaan niet tegen", !fouten.some((f) => f.startsWith(",")));
  // Waarom het opslaan moet wachten: zonder datum zou de editie stil wegvallen.
  const zonder: Ev[] = [{ id: "z", name: "Actie", abbrev: "", cadence: "custom", editions: [{ date: "", label: "", start: "2026-07-05", end: "2026-07-09" }] }];
  check("een begin zonder datum is een fout", foutenVoorOpslag(zonder).length === 1);
  check("want eventsVoorOpslag zou hem weggooien", eventsVoorOpslag(zonder)[0].editions.length === 0);
}

console.log("Een half ingevulde periode: geen stil voorstel");
{
  const alleenBegin = editieHint({ date: "2026-11-27", label: "", start: "2026-11-20" });
  check("alleen een begin: het formulier zegt dat de periode t/m de datum loopt", /Geen eind ingevuld/.test(alleenBegin ?? "") && /t\/m de datum/.test(alleenBegin ?? ""), String(alleenBegin));
  const alleenEind = editieHint({ date: "2026-11-27", label: "", end: "2026-11-30" });
  check("alleen een eind: vanaf de datum", /Geen begin ingevuld/.test(alleenEind ?? ""), String(alleenEind));
  check("beide ingevuld: geen uitleg nodig", editieHint({ date: "2026-11-27", label: "", start: "2026-11-20", end: "2026-11-30" }) === null);
  check("geen van beide: geen uitleg", editieHint({ date: "2026-11-27", label: "" }) === null);
  check("bij een fout geen uitleg ernaast", editieHint({ date: "2026-11-27", label: "", start: "2026-11-28" }) === null);
  const ed: Edition = { date: "2026-11-27", label: "", start: "2026-11-20" };
  editieHint(ed); valideerEditie(ed);
  check("er wordt niets ingevuld", !("end" in ed));
}

console.log("Begin en eind met een tijd erachter: gelezen zoals de lezer");
{
  const ed: Edition = { date: "2026-01-05", label: "", start: "2026-01-01T00:00:00Z" };
  check("een begin met een tijd is geen fout", Object.keys(valideerEditie(ed)).length === 0, JSON.stringify(valideerEditie(ed)));
  const ev: Ev = { id: "t", name: "Actie", abbrev: "", cadence: "custom", editions: [ed] };
  check("de lezer ziet dezelfde editie als geldige periode", eventPeriodesUitRaiEvents({ events: [ev] }).length === 1);
  check("het opslaan wordt er niet door tegengehouden", foutenVoorOpslag([ev]).length === 0);
  check("het veld toont de dag, niet leeg", editieDag(ed.start) === "2026-01-01");
  check("een leeg begin toont leeg", editieDag(undefined) === "" && editieDag("") === "" && editieDag(null) === "");
  check("een eind met een tijd vóór het begin is nog steeds een fout",
    !!valideerEditie({ date: "2026-01-05", label: "", start: "2026-01-03", end: "2026-01-02T23:00:00Z" }).end);
  check("een eind met een tijd vóór de datum is nog steeds een fout",
    !!valideerEditie({ date: "2026-01-05", label: "", end: "2026-01-04T00:00:00Z" }).end);
  check("de uitleg bij alleen een begin noemt de dag", /1 jan|2026-01-01|01-01/.test(editieHint(ed) ?? ""), String(editieHint(ed)));
  check("een begin met een tijd wordt ongemoeid opgeslagen", editieVoorOpslag(ed).start === "2026-01-01T00:00:00Z");
}

console.log("Het formulier");
{
  const bron = readFileSync(join(process.cwd(), "components/dashboard/event-settings.tsx"), "utf8");
  check("schrijft via de bestaande weg, één keer", (bron.match(/dbUpsert\(/g) ?? []).length === 1 && !/\.upsert\(|\.insert\(|\.update\(/.test(bron));
  check("slaat op via eventsVoorOpslag", /const clean = eventsVoorOpslag\(events\)/.test(bron));
  check("houdt het opslaan tegen bij fouten", /foutenVoorOpslag\(events\)/.test(bron) && bron.indexOf("foutenVoorOpslag(events)") < bron.indexOf('dbUpsert("client_settings"'));
  check("velden voor begin en eind met een label", /Begin \(optioneel\)/.test(bron) && /Eind \(optioneel\)/.test(bron));
  check("foutmeldingen via aria-describedby", (bron.match(/aria-describedby=\{beschrijving\("(date|start|end)"\)\}/g) ?? []).length === 3);
  check("tikvlakken van 44 px op een telefoon", /min-h-11 sm:min-h-0/.test(bron));
  // De twee regels vóór de knoptekst: de openingstag en zijn className.
  const knop = (tekst: string) => {
    const regels = bron.split("\n");
    const i = regels.findIndex((r) => r.includes(tekst));
    return i < 2 ? "" : regels.slice(i - 2, i).join("\n");
  };
  for (const tekst of ["Editie toevoegen", "Beurs of moment toevoegen"]) {
    const k = knop(tekst);
    check(`"${tekst}" is 44 px op een telefoon en type=button`, /<button type="button"/.test(k) && /min-h-11 sm:min-h-0/.test(k), k);
  }
  check("begin en eind tonen hun dag, ook met een tijd erachter", /value=\{editieDag\(ed\.start\)\}/.test(bron) && /value=\{editieDag\(ed\.end\)\}/.test(bron));
  check("de T-minus-pacing staat er nog, met dezelfde voorwaarde", /\{ev\.editions\.some\(\(ed\) => ed\.date\) && \(\s*<AccountEventPacing clientId=\{clientId\} eventId=\{ev\.id\} refreshKey=\{savedTick\} \/>/.test(bron));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
