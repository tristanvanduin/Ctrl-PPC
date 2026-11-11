// Het cachehulpje voor luie lezers (lib/data-access/bron-cache.ts). Geen IO, geen React.
// Draaien: tsx --tsconfig ./tsconfig.json lib/data-access/__bron_cache_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De wereldkaart, de uitsplitsingen en de videokaart haalden bij elke mount opnieuw op, en twee
// kaarten naast elkaar deden elk hun eigen verzoek voor dezelfde rijen. Het patroon dat dat oplost
// stond al vijf keer los in de codebase, in drie varianten. Dit is het ene huis; wat hier vastligt
// is het contract waar elke lezer op leunt:
//
// - N gelijktijdige lezers van dezelfde sleutel: één `haal`, allemaal hetzelfde antwoord;
// - een latere lezer binnen de cachetijd: geen `haal`; na de cachetijd wel;
// - een mislukt `haal` komt niet in de cache, en blijft niet als lopend verzoek hangen;
// - vergeet(prefix) raakt alleen de sleutels met dat begin, vergeet() alles;
// - de generatie: een antwoord dat vóór het vergeten vertrok, komt niet meer in de cache (wie er
//   al op wachtte krijgt het wel), en een nieuwe lezer start een eigen verzoek;
// - vergeetBronnen(prefix) raakt elke cache die met dit hulpje gemaakt is.

import { maakBronCache, vergeetBronnen } from "./bron-cache";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

/** Een `haal` waarvan de test bepaalt wanneer en waarmee hij antwoordt. */
function uitgesteld<T>() {
  let aanroepen = 0;
  const wachtend: { los: (v: T) => void; faal: (e: Error) => void }[] = [];
  const haal = () => {
    aanroepen += 1;
    return new Promise<T>((los, faal) => wachtend.push({ los, faal }));
  };
  return {
    haal,
    get aanroepen() { return aanroepen; },
    get open() { return wachtend.length; },
    antwoord(v: T) { wachtend.shift()?.los(v); },
    mislukt(bericht: string) { wachtend.shift()?.faal(new Error(bericht)); },
  };
}
const tik = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  const TTL = 5 * 60 * 1000;

  console.log("N gelijktijdige lezers: één haal");
  {
    const cache = maakBronCache<string[]>(TTL);
    const bron = uitgesteld<string[]>();
    const lezers = [cache.lees("k1|meta", bron.haal), cache.lees("k1|meta", bron.haal), cache.lees("k1|meta", bron.haal)];
    check("één haal voor drie lezers", bron.aanroepen === 1, String(bron.aanroepen));
    check("kijk geeft niets zolang het verzoek loopt", cache.kijk("k1|meta") === undefined);
    const rijen = ["a", "b"];
    bron.antwoord(rijen);
    const uit = await Promise.all(lezers);
    check("alle drie hetzelfde antwoord (hetzelfde object)", uit.every((u) => u === rijen));
    check("kijk geeft het antwoord daarna zonder verzoek", cache.kijk("k1|meta") === rijen && bron.aanroepen === 1);

    console.log("Een latere lezer binnen de cachetijd: geen haal");
    const later = await cache.lees("k1|meta", bron.haal);
    check("uit de cache", later === rijen && bron.aanroepen === 1, String(bron.aanroepen));

    console.log("Een andere sleutel: een eigen haal");
    const ander = cache.lees("k1|linkedin", bron.haal);
    check("een tweede haal voor de andere sleutel", bron.aanroepen === 2, String(bron.aanroepen));
    bron.antwoord(["c"]);
    check("met zijn eigen antwoord", (await ander)[0] === "c" && cache.kijk("k1|meta") === rijen);

    console.log("Na de cachetijd: opnieuw halen");
    const echteNow = Date.now;
    try {
      Date.now = () => echteNow() + TTL - 1000;
      check("vlak vóór het einde nog vers", cache.kijk("k1|meta") === rijen);
      Date.now = () => echteNow() + TTL + 1;
      check("kijk geeft niets meer", cache.kijk("k1|meta") === undefined);
      const opnieuw = cache.lees("k1|meta", bron.haal);
      check("een nieuwe haal", bron.aanroepen === 3, String(bron.aanroepen));
      bron.antwoord(["vers"]);
      check("met het nieuwe antwoord", (await opnieuw)[0] === "vers" && cache.kijk("k1|meta")?.[0] === "vers");
    } finally {
      Date.now = echteNow;
    }
  }

  console.log("Een mislukt haal komt niet in de cache");
  {
    const cache = maakBronCache<number>(TTL);
    const bron = uitgesteld<number>();
    const eerste = cache.lees("k|x", bron.haal);
    const tweede = cache.lees("k|x", bron.haal);
    bron.mislukt("kapot");
    const uitkomsten = await Promise.allSettled([eerste, tweede]);
    check("beide wachtende lezers krijgen de fout", uitkomsten.every((u) => u.status === "rejected" && (u.reason as Error).message === "kapot"));
    check("niets in de cache", cache.kijk("k|x") === undefined);
    const opnieuw = cache.lees("k|x", bron.haal);
    check("de volgende lezer probeert opnieuw (het mislukte verzoek hangt niet)", bron.aanroepen === 2, String(bron.aanroepen));
    bron.antwoord(7);
    check("en krijgt het antwoord", (await opnieuw) === 7 && cache.kijk("k|x") === 7);

    // Een haal die meteen gooit (geen belofte teruggeeft) is ook gewoon een mislukte lezing.
    const gooit = cache.lees("k|gooit", () => { throw new Error("meteen"); });
    const uit = await gooit.then(() => "ok", (e: Error) => e.message);
    check("een haal die meteen gooit geeft een afgewezen belofte, geen crash", uit === "meteen", uit);
    check("en staat niet in de cache", cache.kijk("k|gooit") === undefined);
  }

  console.log("vergeet(prefix): alleen de sleutels met dat begin");
  {
    const cache = maakBronCache<string>(TTL);
    await Promise.all([
      cache.lees("klant-a|meta", async () => "a-meta"),
      cache.lees("klant-a|linkedin", async () => "a-linkedin"),
      cache.lees("klant-ab|meta", async () => "ab-meta"),
      cache.lees("klant-b|meta", async () => "b-meta"),
    ]);
    cache.vergeet("klant-a|");
    check("klant-a is weg", cache.kijk("klant-a|meta") === undefined && cache.kijk("klant-a|linkedin") === undefined);
    // Het scheidingsteken hoort bij de prefix: "klant-a" zonder streep zou klant-ab meenemen.
    check("klant-ab en klant-b blijven", cache.kijk("klant-ab|meta") === "ab-meta" && cache.kijk("klant-b|meta") === "b-meta");
    let gehaald = 0;
    const opnieuw = await cache.lees("klant-a|meta", async () => { gehaald += 1; return "a-meta-2"; });
    check("de volgende lezer haalt opnieuw", gehaald === 1 && opnieuw === "a-meta-2");
    cache.vergeet();
    check("vergeet() zonder prefix: alles weg", cache.kijk("klant-ab|meta") === undefined && cache.kijk("klant-b|meta") === undefined && cache.kijk("klant-a|meta") === undefined);
  }

  console.log("De generatie: een antwoord van vóór het vergeten komt niet in de cache");
  {
    const cache = maakBronCache<string>(TTL);
    const bron = uitgesteld<string>();
    const oud = cache.lees("k|meta", bron.haal);
    // Een andere sleutel die niet vergeten wordt, loopt tegelijk.
    const buur = cache.lees("z|meta", bron.haal);
    cache.vergeet("k|");
    // Na het vergeten is het lopende verzoek niet meer "het" verzoek: een nieuwe lezer start er een.
    const nieuw = cache.lees("k|meta", bron.haal);
    check("een nieuwe lezer start een eigen haal", bron.aanroepen === 3, String(bron.aanroepen));
    bron.antwoord("oude stand");
    check("wie al wachtte krijgt het oude antwoord", (await oud) === "oude stand");
    await tik();
    check("maar het staat niet in de cache", cache.kijk("k|meta") === undefined);
    bron.antwoord("buur");
    check("de sleutel die niet vergeten is, komt gewoon in de cache", (await buur) === "buur" && cache.kijk("z|meta") === "buur");
    // Het nieuwe verzoek loopt nog: een lezer die nu komt, wacht daarop en start er geen vierde.
    const meelifter = cache.lees("k|meta", bron.haal);
    check("het nieuwe verzoek is het lopende (geen vierde haal)", bron.aanroepen === 3, String(bron.aanroepen));
    bron.antwoord("nieuwe stand");
    check("het nieuwe antwoord komt wel in de cache", (await nieuw) === "nieuwe stand" && (await meelifter) === "nieuwe stand" && cache.kijk("k|meta") === "nieuwe stand");

    // Het oude verzoek ruimt bij zijn afronding het NIEUWE lopende verzoek niet op.
    const bron2 = uitgesteld<string>();
    const c2 = maakBronCache<string>(TTL);
    const a = c2.lees("k|x", bron2.haal);
    c2.vergeet("k|");
    const b = c2.lees("k|x", bron2.haal);
    bron2.antwoord("oud");
    await a; await tik();
    const c = c2.lees("k|x", bron2.haal);
    check("na het oude antwoord wacht een lezer nog op het nieuwe verzoek", bron2.aanroepen === 2, String(bron2.aanroepen));
    bron2.antwoord("nieuw");
    check("en krijgt het nieuwe antwoord", (await b) === "nieuw" && (await c) === "nieuw");

    // Twee keer vergeten terwijl er steeds een verzoek loopt: geen van de oude komt in de cache.
    const bron3 = uitgesteld<string>();
    const c3 = maakBronCache<string>(TTL);
    const eerste = c3.lees("k|x", bron3.haal);
    c3.vergeet("k|");
    const tweede = c3.lees("k|x", bron3.haal);
    c3.vergeet("k|");
    bron3.antwoord("eerste"); bron3.antwoord("tweede");
    await Promise.all([eerste, tweede]); await tik();
    check("twee keer vergeten: geen van beide antwoorden in de cache", c3.kijk("k|x") === undefined, String(c3.kijk("k|x")));
  }

  console.log("vergeetBronnen: één ingang voor alle caches");
  {
    const geo = maakBronCache<string>(TTL);
    const video = maakBronCache<number>(TTL);
    await Promise.all([
      geo.lees("klant-s|meta|country", async () => "landen"),
      video.lees("klant-s|meta", async () => 3),
      geo.lees("klant-t|meta|country", async () => "landen-t"),
    ]);
    vergeetBronnen("klant-s|");
    check("beide caches zijn klant-s kwijt", geo.kijk("klant-s|meta|country") === undefined && video.kijk("klant-s|meta") === undefined);
    check("de andere klant blijft", geo.kijk("klant-t|meta|country") === "landen-t");
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
