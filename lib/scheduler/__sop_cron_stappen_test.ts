// Test: wat app/api/cron/trigger-sops per due item doet (lib/scheduler/sop-cron-stappen.ts).
// Draaien: tsx lib/scheduler/__sop_cron_stappen_test.ts
//
// Twee dingen die de tijdtests van de zuivere module (__sop_tijdbudget_test.ts) niet zagen:
//
// 1. Of de route zijn klok goed gebruikt: een due item zonder tijd komt terug als due_deferred met
//    uitstelreden "tijd", een vervolgstap zonder tijd staat in vervolg_uitgesteld, de analyse krijgt
//    de timeout uit dezelfde klok als de beslissing. Met een nepklok en een nep-analyse.
// 2. Of het wachten op de analyse de 300 s-grens van fetch overleeft. voerSopUit tegen een lokale
//    server die pas na 1,5 s antwoordt, met de headers-timeout van fetch verlaagd naar 400 ms: met
//    fetch faalde dit, met interneAanroep niet. Zie lib/scheduler/interne-aanroep.ts.

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verwerkDueItem, voerSopUit, triggerCrossChannelSynthesis, type DueItem, type Vervolgstap } from "./sop-cron-stappen";
import { maakTijdbudget, analyseTimeoutMs, EINDMARGE_S } from "./sop-tijdbudget";
import { verlaagFetchHeadersTimeout } from "./__fetch_drempel";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const T0 = Date.parse("2026-11-14T05:20:00Z");
const item: DueItem = { clientId: "demo-greentech", channel: "google_ads", cadence: "monthly", lastRunDate: "2026-10-01" };

/** Een klok die alleen verspringt als de test dat zegt. */
function nepKlok(startS = 0) {
  let ms = T0 + startS * 1000;
  return { nu: () => ms, zet: (s: number) => { ms = T0 + s * 1000; } };
}

async function lus(): Promise<void> {
  const budget = maakTijdbudget(800, T0);

  // ── starten: de timeout komt uit dezelfde klok als de beslissing ──────────
  {
    const klok = nepKlok(0);
    let kreeg: number | null = null;
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget, nu: klok.nu,
      voerUit: async (ms) => { kreeg = ms; klok.zet(200); return "2026-11-14"; },
      vervolgstappen: () => [],
    });
    check("t=0: gestart en triggered", r.uitkomst.status === "triggered" && r.uitkomst.analysisDate === "2026-11-14", JSON.stringify(r.uitkomst));
    check("de analyse krijgt de timeout van t=0", kreeg === analyseTimeoutMs(budget, T0), String(kreeg));
  }

  // ── uitstellen ─────────────────────────────────────────────────────────────
  {
    let aangeroepen = false;
    const r = await verwerkDueItem({
      item, getriggerd: 1, limit: 1, budget, nu: nepKlok(0).nu,
      voerUit: async () => { aangeroepen = true; return "x"; }, vervolgstappen: () => [],
    });
    check("limit bereikt: due_deferred met uitstelreden limiet, niets gestart",
      r.uitkomst.status === "due_deferred" && r.uitkomst.uitstelreden === "limiet" && !aangeroepen, JSON.stringify(r.uitkomst));
  }
  {
    let aangeroepen = false;
    const r = await verwerkDueItem({
      item, getriggerd: 1, limit: 5, budget, nu: nepKlok(508).nu,
      voerUit: async () => { aangeroepen = true; return "x"; }, vervolgstappen: () => [],
    });
    check("na 508 s (de traagste biweekly): due_deferred met uitstelreden tijd, niets gestart",
      r.uitkomst.status === "due_deferred" && r.uitkomst.uitstelreden === "tijd" && !aangeroepen, JSON.stringify(r.uitkomst));
    check("en het item draagt zijn gegevens mee", r.uitkomst.clientId === item.clientId && r.uitkomst.lastRunDate === item.lastRunDate);
  }
  {
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget: maakTijdbudget(300, T0), nu: nepKlok(0).nu,
      voerUit: async () => "x", vervolgstappen: () => [],
    });
    check("maxDuration 300: zelfs op t=0 uitgesteld om de tijd",
      r.uitkomst.status === "due_deferred" && r.uitkomst.uitstelreden === "tijd");
  }

  // ── vervolgstappen ─────────────────────────────────────────────────────────
  {
    // De analyse neemt alle tijd: na 760 s past geen vervolgstap meer (minimaal 30 s voor 785).
    const klok = nepKlok(0);
    const gedaan: string[] = [];
    const stappen: Vervolgstap[] = [
      { naam: "cross-channel demo-greentech", stap: async () => { gedaan.push("cc"); } },
      { naam: "cross-channel-synthese demo-greentech", stap: async () => { gedaan.push("synth"); } },
    ];
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget, nu: klok.nu,
      voerUit: async () => { klok.zet(760); return "2026-11-14"; },
      vervolgstappen: () => stappen,
    });
    check("trage analyse: toch triggered", r.uitkomst.status === "triggered");
    check("beide vervolgstappen in vervolg_uitgesteld, geen van beide gestart",
      r.vervolgUitgesteld.length === 2 && r.vervolgUitgesteld[0] === "cross-channel demo-greentech" && gedaan.length === 0,
      JSON.stringify(r.vervolgUitgesteld));
  }
  {
    // Na 630 s past de eerste; die duurt tot 760 s, dus de tweede niet meer.
    const klok = nepKlok(0);
    const timeouts: number[] = [];
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget, nu: klok.nu,
      voerUit: async () => { klok.zet(630); return "2026-11-14"; },
      vervolgstappen: () => [
        { naam: "cc", stap: async (ms) => { timeouts.push(ms); klok.zet(760); } },
        { naam: "synth", stap: async (ms) => { timeouts.push(ms); } },
      ],
    });
    check("eerste vervolgstap krijgt het restant tot de eindmarge als timeout",
      timeouts.length === 1 && timeouts[0] === (800 - EINDMARGE_S - 630) * 1000, JSON.stringify(timeouts));
    check("tweede uitgesteld", r.vervolgUitgesteld.length === 1 && r.vervolgUitgesteld[0] === "synth", JSON.stringify(r.vervolgUitgesteld));
  }
  {
    // Een mislukte vervolgstap maakt de analyse niet mislukt, en houdt de volgende stap niet tegen.
    const gedaan: string[] = [];
    const origineel = console.error;
    console.error = () => {};
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget, nu: nepKlok(0).nu,
      voerUit: async () => "2026-11-14",
      vervolgstappen: () => [
        { naam: "cc", stap: async () => { throw new Error("cross-channel gaf 500"); } },
        { naam: "synth", stap: async () => { gedaan.push("synth"); } },
      ],
    });
    console.error = origineel;
    check("mislukte vervolgstap: analyse blijft triggered, volgende stap loopt",
      r.uitkomst.status === "triggered" && gedaan.length === 1 && r.vervolgUitgesteld.length === 0);
  }
  {
    // Mislukt de analyse, dan worden de vervolgstappen niet eens opgevraagd (de route houdt daar zijn
    // dedup per klant bij: een mislukte maandrun mag de cross-channel niet opmaken).
    let opgevraagd = false;
    const r = await verwerkDueItem({
      item, getriggerd: 0, limit: 1, budget, nu: nepKlok(0).nu,
      voerUit: async () => { throw new Error("/api/analysis/monthly gaf 500"); },
      vervolgstappen: () => { opgevraagd = true; return []; },
    });
    check("mislukte analyse: failed met de fout, vervolgstappen niet opgevraagd",
      r.uitkomst.status === "failed" && r.uitkomst.error === "/api/analysis/monthly gaf 500" && !opgevraagd, JSON.stringify(r.uitkomst));
  }
}

// ── voerSopUit tegen een trage analyse-route ─────────────────────────────────

const TRAAG_MS = 1500;
const ontvangen: { pad: string; body: Record<string, unknown>; auth: string | null }[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    ontvangen.push({ pad: req.url ?? "", body: body ? JSON.parse(body) : {}, auth: req.headers.authorization ?? null });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/analysis/biweekly") {
      setTimeout(() => res.end(JSON.stringify({
        analysisDate: "2026-11-14", periodStart: "2026-10-31", periodEnd: "2026-11-13", model: "test", output: "# Bevindingen",
      })), TRAAG_MS);
    } else if (req.url === "/api/analysis/cross-channel-synthesis") {
      res.statusCode = body.includes("overslaan") ? 409 : 500;
      res.end(JSON.stringify({ error: "synthese kapot" }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
});

/** Legt vast wat er naar Storage en client_files gaat; elke query geeft een lege lijst terug. */
function nepSupabase() {
  const uploads: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const keten = (): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "delete"]) q[m] = () => q;
    q.insert = (rij: Record<string, unknown>) => { inserts.push(rij); return Promise.resolve({ error: null }); };
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  const supabase = {
    from: () => keten(),
    storage: {
      from: () => ({
        upload: (pad: string) => { uploads.push(pad); return Promise.resolve({ error: null }); },
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  return { supabase, uploads, inserts };
}

async function trageRoute(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CRON_SECRET = "geheim";

  await verlaagFetchHeadersTimeout(`${origin}/opwarmen`, 400);
  // Het bewijs dat de drempel werkt: dezelfde trage route via fetch faalt.
  const viaFetch = await fetch(`${origin}/api/analysis/biweekly`, { method: "POST", body: "{}" }).then(() => "geen fout", (e) => String(e?.cause?.code ?? e));
  check("fetch faalt op de trage route (de proef werkt)", viaFetch === "UND_ERR_HEADERS_TIMEOUT", viaFetch);

  const { supabase, uploads, inserts } = nepSupabase();
  const datum = await voerSopUit(supabase, origin, "demo-greentech", "google_ads", "biweekly", 10_000).catch((e: Error) => e);
  check("voerSopUit wacht de trage analyse af", datum === "2026-11-14", datum instanceof Error ? datum.message : String(datum));
  check("en uploadt daarna de markdown", uploads.length === 1 && inserts.length === 1
    && inserts[0].file_name === "2026-11-14-biweekly-analyse.md", JSON.stringify({ uploads, inserts }));
  const verzoek = ontvangen.find((o) => o.pad === "/api/analysis/biweekly" && o.body.client_id === "demo-greentech");
  check("met het CRON_SECRET en automatisch: true (dan telt de run als gepland)",
    verzoek?.auth === "Bearer geheim" && verzoek.body.automatisch === true, JSON.stringify(verzoek));

  // Cross-channel-synthese: 409 (nog niet alle kanalen klaar) is geen fout, 500 wel.
  const fout500 = await triggerCrossChannelSynthesis(origin, "kapot", 5000).then(() => null, (e: Error) => e.message);
  check("synthese 500: gooit met de fout van de route", fout500 === "synthese kapot", String(fout500));
  const fout409 = await triggerCrossChannelSynthesis(origin, "overslaan", 5000).then(() => null, (e: Error) => e.message);
  check("synthese 409: geen fout", fout409 === null, String(fout409));

  server.close();
}

lus()
  .then(trageRoute)
  .then(() => {
    console.log(`sop-cron-stappen: ${passed} geslaagd, ${failed} gefaald`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => { console.error(err); server.close(); process.exit(1); });
