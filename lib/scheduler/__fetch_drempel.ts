// Alleen voor tests: verlaagt de headers-timeout van de globale fetch van Node, zodat een test in
// een paar seconden kan laten zien wat in productie pas na 300 s gebeurt.
//
// De fetch van Node gebruikt de undici-dispatcher die op globalThis onder
// Symbol.for("undici.globalDispatcher.1") staat, en maakt die bij de eerste aanroep aan. De klasse
// halen we van die instantie: undici is geen dependency van dit project, en hoort dat ook niet te
// worden voor een test.

const SLEUTEL = Symbol.for("undici.globalDispatcher.1");

/** `opwarmUrl` moet een bereikbare server zijn: een eerste fetch maakt de dispatcher aan. */
export async function verlaagFetchHeadersTimeout(opwarmUrl: string, headersTimeoutMs: number): Promise<void> {
  await fetch(opwarmUrl).then((r) => r.arrayBuffer()).catch(() => undefined);
  const g = globalThis as unknown as Record<symbol, unknown>;
  const huidige = g[SLEUTEL] as { constructor: new (opties: Record<string, unknown>) => unknown } | undefined;
  if (!huidige) throw new Error("geen globale undici-dispatcher gevonden; deze Node-versie werkt anders");
  g[SLEUTEL] = new huidige.constructor({ headersTimeout: headersTimeoutMs });
}
