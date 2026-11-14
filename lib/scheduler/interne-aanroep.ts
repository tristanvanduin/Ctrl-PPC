// Een interne aanroep op de eigen origin waar de aanroeper LANG op wacht, zonder de 300 s-grens van
// fetch.
//
// WAAROM NIET fetch. De globale fetch van Node draait op undici, en undici breekt een verzoek af als
// er na 300 s nog geen headers binnen zijn (headersTimeout, UND_ERR_HEADERS_TIMEOUT), en ook als er
// 300 s geen bytes van de body komen (bodyTimeout). De analyse-routes sturen hun headers pas aan het
// eind (Response.json), en een biweekly deed er gemeten tot 508 s over. Met fetch faalt het wachten
// daarop dus na 300 s, wat de maxDuration van aanroeper of aangeroepene ook is; een
// AbortSignal.timeout kan een timeout alleen korter maken, niet langer. In de review nagemeten op
// Node 22.22 / undici 6.23: een server die na 310 s antwoordt, faalt na 301 s. De test
// (lib/scheduler/__interne_aanroep_test.ts) laat hetzelfde zien met een verlaagde drempel.
//
// De andere wegen, en waarom niet:
//   - undici als dependency en `dispatcher: new Agent({ headersTimeout: 0, bodyTimeout: 0 })`: een
//     nieuwe dependency waarvan de versie moet passen bij de undici die in Node zit, voor een optie
//     die node:http zonder meer heeft.
//   - de analyse-routes laten streamen (meteen headers, af en toe een spatie): raakt drie routes van
//     elk ruim duizend regels en ook de knoppen in de browser, die hetzelfde antwoord lezen.
//   - niet wachten en de uitvoer in een volgende invocatie uit sop_analysis_output lezen: een nieuwe
//     toestand ("gestart, nog niet geupload") die de cron moet bijhouden.
// node:http heeft geen headers- of bodytimeout als je er zelf geen zet. Deze functie zet er een:
// een harde deadline (`timeoutMs`) voor het hele verzoek, de aanroeper rekent hem uit het
// tijdbudget (lib/scheduler/sop-tijdbudget.ts).
//
// `agent: false`: een eigen verbinding per aanroep, buiten de keep-alive-pool, zodat een eerder
// afgebroken verzoek geen half gebruikte socket achterlaat voor het volgende.

import http from "node:http";
import https from "node:https";

export interface InternAntwoord {
  status: number;
  ok: boolean;
  /** Het JSON-antwoord, of {} als de body leeg of geen JSON was. */
  data: Record<string, unknown>;
}

export function interneAanroep(
  url: string,
  opties: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number },
): Promise<InternAntwoord> {
  const doel = new URL(url);
  const transport = doel.protocol === "https:" ? https : doel.protocol === "http:" ? http : null;
  if (!transport) return Promise.reject(new Error(`interneAanroep: geen http(s)-adres: ${url}`));

  return new Promise<InternAntwoord>((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(opties.headers ?? {}) };
    if (opties.body !== undefined) headers["Content-Length"] = Buffer.byteLength(opties.body);

    const req = transport.request(doel, { method: opties.method ?? "GET", headers, agent: false }, (res) => {
      const delen: Buffer[] = [];
      res.on("data", (d: Buffer) => delen.push(d));
      res.on("error", fout);
      res.on("end", () => {
        clearTimeout(deadline);
        const tekst = Buffer.concat(delen).toString("utf8");
        let data: Record<string, unknown> = {};
        try {
          const geparset: unknown = tekst ? JSON.parse(tekst) : {};
          if (geparset && typeof geparset === "object" && !Array.isArray(geparset)) data = geparset as Record<string, unknown>;
        } catch { /* een Next-foutpagina is HTML: dan zegt de status genoeg */ }
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, data });
      });
    });

    function fout(err: Error): void {
      clearTimeout(deadline);
      reject(err);
    }
    // Een deadline voor het hele verzoek, niet een stiltetimeout per socket: een route die af en
    // toe een byte stuurt, mag de aanroeper niet over zijn eigen grens trekken.
    const deadline = setTimeout(() => {
      req.destroy(new Error(`${doel.pathname} gaf binnen ${Math.round(opties.timeoutMs / 1000)} s geen antwoord`));
    }, Math.max(0, opties.timeoutMs));
    req.on("error", fout);
    req.end(opties.body);
  });
}
