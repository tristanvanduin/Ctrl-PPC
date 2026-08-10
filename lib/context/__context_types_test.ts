import { businessEventsUitRaiEvents } from "./context-types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  x " + msg); } else { console.log("  v " + msg); }
}

console.log("businessEventsUitRaiEvents:");
{
  const events = businessEventsUitRaiEvents(
    [
      { id: "evt-1", name: "Black Friday", cadence: "annual", editions: [{ date: "2026-11-27", label: "2026" }] },
    ],
    "agency-1",
    "client-1"
  );
  assert(events.length === 1, "een geldig event komt door");
  assert(events[0].agencyId === "agency-1" && events[0].accountId === "client-1", "tenant-scope staat op het event, niet verzonnen");
  assert(events[0].cadence === "annual", "cadans overgenomen");
  assert(events[0].editions.length === 1 && events[0].editions[0].date === "2026-11-27", "editie overgenomen");
}

console.log("edge cases, expliciet afgevangen:");
{
  const zonderId = businessEventsUitRaiEvents([{ name: "Zonder id", editions: [] }], "a", "c");
  assert(zonderId.length === 0, "event zonder id wordt overgeslagen, niet verzonnen");

  const zonderNaam = businessEventsUitRaiEvents([{ id: "evt-2", name: "", editions: [] }], "a", "c");
  assert(zonderNaam.length === 0, "event met lege naam (event-settings.tsx-seed) wordt overgeslagen");

  const zonderEditieDatum = businessEventsUitRaiEvents(
    [{ id: "evt-3", name: "Nog leeg", editions: [{ date: "", label: "" }] }],
    "a", "c"
  );
  assert(zonderEditieDatum.length === 1 && zonderEditieDatum[0].editions.length === 0, "editie zonder datum telt niet mee, het event zelf wel");

  const zonderLabel = businessEventsUitRaiEvents(
    [{ id: "evt-4", name: "Sale", editions: [{ date: "2026-06-15", label: "" }] }],
    "a", "c"
  );
  assert(zonderLabel[0].editions[0].label === "2026", "ontbrekend label valt terug op het jaartal, geen lege string");

  const leeg = businessEventsUitRaiEvents([], "a", "c");
  assert(leeg.length === 0, "geen events geconfigureerd: lege lijst, geen fout");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);
