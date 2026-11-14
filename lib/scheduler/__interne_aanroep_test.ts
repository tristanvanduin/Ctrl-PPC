// Test: interneAanroep (lib/scheduler/interne-aanroep.ts) wacht langer dan de headers-timeout van
// fetch.
// Draaien: tsx lib/scheduler/__interne_aanroep_test.ts
//
// De cron (app/api/cron/trigger-sops) wachtte met fetch op de analyse-routes. undici, onder de fetch
// van Node, geeft het na 300 s zonder headers op (UND_ERR_HEADERS_TIMEOUT), en een biweekly deed er
// gemeten tot 508 s over. 300 s wachten past niet in een test, dus verlaagt deze test de drempel van
// de globale undici-dispatcher naar 400 ms en laat een lokale server pas na 1,5 s antwoorden. Eerst
// het bewijs dat fetch dan faalt (anders zegt de rest niets), dan dat interneAanroep hetzelfde
// verzoek wel afmaakt.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { interneAanroep } from "./interne-aanroep";
import { verlaagFetchHeadersTimeout } from "./__fetch_drempel";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const TRAAG_MS = 1500;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url === "/traag") {
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, methode: req.method, body, auth: req.headers.authorization ?? null }));
      }, TRAAG_MS);
    } else if (req.url === "/fout") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html");
      res.end("<html>Internal Server Error</html>");
    } else if (req.url === "/hangt") {
      // antwoordt nooit
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "niet gevonden" }));
    }
  });
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await verlaagFetchHeadersTimeout(`${basis}/onbekend`, 400);

  // ── de val: fetch geeft het op ─────────────────────────────────────────────
  let fetchFout = "";
  try {
    await fetch(`${basis}/traag`, { method: "POST", body: "{}" });
  } catch (err) {
    fetchFout = String((err as { cause?: { code?: string } }).cause?.code ?? err);
  }
  check("fetch met verlaagde drempel faalt op de trage server (de proef werkt)",
    fetchFout === "UND_ERR_HEADERS_TIMEOUT", fetchFout || "geen fout");

  // ── interneAanroep wacht wel ───────────────────────────────────────────────
  const t0 = Date.now();
  const antwoord = await interneAanroep(`${basis}/traag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer geheim" },
    body: JSON.stringify({ client_id: "demo-greentech", automatisch: true }),
    timeoutMs: 10_000,
  }).catch((err: Error) => err);
  check("interneAanroep maakt hetzelfde verzoek af", !(antwoord instanceof Error) && antwoord.ok && antwoord.data.ok === true,
    antwoord instanceof Error ? antwoord.message : JSON.stringify(antwoord));
  check("en wachtte daar echt op", Date.now() - t0 >= TRAAG_MS - 50, String(Date.now() - t0));
  if (!(antwoord instanceof Error)) {
    check("methode, body en Authorization komen aan",
      antwoord.data.methode === "POST" && antwoord.data.auth === "Bearer geheim"
      && JSON.parse(String(antwoord.data.body)).automatisch === true, JSON.stringify(antwoord.data));
  }

  // ── een eigen, harde deadline ──────────────────────────────────────────────
  const t1 = Date.now();
  const hangt = await interneAanroep(`${basis}/hangt`, { timeoutMs: 300 }).catch((err: Error) => err);
  check("een route die niet antwoordt: fout na de eigen timeout",
    hangt instanceof Error && /geen antwoord/.test(hangt.message), hangt instanceof Error ? hangt.message : "geen fout");
  check("en niet veel later dan die timeout", Date.now() - t1 < 2000, String(Date.now() - t1));

  // ── foutantwoorden ─────────────────────────────────────────────────────────
  const fout = await interneAanroep(`${basis}/fout`, { timeoutMs: 5000 });
  check("500 met een HTML-foutpagina: ok false, status 500, lege data",
    !fout.ok && fout.status === 500 && Object.keys(fout.data).length === 0, JSON.stringify(fout));
  const nietGevonden = await interneAanroep(`${basis}/nergens`, { timeoutMs: 5000 });
  check("JSON-fout wordt gelezen", nietGevonden.status === 404 && nietGevonden.data.error === "niet gevonden");

  server.close();
  console.log(`interne-aanroep: ${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); server.close(); process.exit(1); });
