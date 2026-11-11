// Gelijkheidstest: een kanaaltab en "Alle kanalen" tonen dezelfde cijfers, omdat ze uit één bron
// komen. Draaien: tsx lib/__kanaaltab_gelijk_alle_kanalen_test.ts
//
// LAAG (a) -- de KPI-band (fase 1, stap 4).
//
// De band las Meta, LinkedIn en Microsoft uit eigen dagrijen (36 maanden, in de browser geteld) en
// leest ze nu uit perKanaal van de blended route, die dezelfde dagrijen server-side samenvat. Dat
// mag alleen als het DEZELFDE band is. Deze test zet daarom de twee ingangen tegenover elkaar, op
// het antwoord van de echte route (fetchBlendedHistoricalData op een nep-Supabase):
//
//   kanaalStandUitRoute(perKanaal[k])  ==  kanaalStandUitDagen(ALLE dagrijen, k, selectie)
//
// per maand, in `vanaf` (de eerste volle maand) en in `laatsteDag`. Met ALLE dagrijen, zoals de
// route ze leest (alleRijen, de hele tabel), en niet met het 36-maandenvenster van de terugvalweg
// (fetchKanaalRijen): dan vergeleek de test twee verschillende invoeren. De seed loopt bewust
// langer dan 36 maanden terug en over de 1000 rijen, zodat dat verschil en de paginering echt
// meedoen. Daarna: "Alle kanalen" in de band is Google plus die drie standen, maand voor maand, en
// de optelling van de route zelf (het Jaaroverzicht) is dezelfde som.
//
// perKanaal[].eersteDag blijft buiten de band: dat is de start van de huidige loop (na een pauze),
// voor het tempo in de prognose. De band paart op `vanaf`, de eerste volle maand sinds de eerste
// dag ooit; viel de historie van vóór een pauze weg, dan verloor het kanaal zijn vorig jaar.
//
// De bedragen in de seed zijn veelvouden van een kwart: dan is elke som exact, in welke volgorde
// de rijen ook worden opgeteld, en mag de vergelijking op gelijkheid in plaats van op een marge.
//
// (De lagen (b) en verder -- het per-kanaal-object van de tabs, de kanaaltabel -- horen bij de
// stappen die die lezers omzetten.)

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlendedHistoricalData, type BlendedHistoricalData } from "./api/blended-historical";
import { FakeSupabase } from "./decision/__fake_supabase";
import { resolveChannelConversionConfig } from "./analysis/channel-conversion-config";
import {
  HELE_HISTORIE_GELADEN_VANAF, NIET_GOOGLE, eersteVolleMaand, kanaalDagbron, kanaalStandUitDagen, kanaalStandUitMaanden,
  maandTotalenUitMaandreeks, samenvoegen, type NietGoogleKanaal,
} from "./period/kanaal-maanden";
import { flattenMonths } from "./period/apply-period";
import { kanaalStandUitRoute, type BandRoute } from "./use-channel-period-data";
import { addDays, monthsAgo } from "./reporting-date";
import type { ClientHistoricalData } from "./types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Rij = Record<string, unknown>;
const KLANT = "klant-g";
const NU = "2026-11-01";

/** Een rij per `stap` dagen van `van` t/m `tot`. */
function dagen(van: string, tot: string, stap: number, maak: (d: string) => Rij): Rij[] {
  const uit: Rij[] = [];
  for (let d = van; d <= tot; d = addDays(d, stap)) uit.push(maak(d));
  return uit;
}

// Meta: twee accounts (een rij per account per dag), begonnen midden november 2022 -- ruim vóór het
// 36-maandenvenster van de terugvalweg. In 2026 liep het januari t/m maart, lag april t/m juni
// stil (geen rijen: de sync schrijft geen nullen) en kwam het op 20 juli terug.
const metaRij = (entity: string, d: string, spend: number, conversions: number, leads: number, waarde: number): Rij =>
  ({ client_id: KLANT, date: d, entity_id: entity, impressions: 100, link_clicks: 10, spend, conversions, leads, conversion_value: waarde });
const META: Rij[] = [
  ...dagen("2022-11-15", "2025-12-31", 2, (d) => metaRij("m1", d, 10.5, 2, 1, 20.5)),
  ...dagen("2022-11-15", "2025-12-31", 2, (d) => metaRij("m2", d, 4.25, 1, 0, 8)),
  ...dagen("2026-01-01", "2026-03-31", 1, (d) => metaRij("m1", d, 12, 3, 2, 30.25)),
  ...dagen("2026-07-20", "2026-10-31", 1, (d) => metaRij("m1", d, 9.75, 2, 1, 18)),
];
// LinkedIn: begonnen op de 1e (de eerste maand is meteen vol), om de drie dagen een rij.
const LINKEDIN: Rij[] = dagen("2025-03-01", "2026-10-30", 3, (d) =>
  ({ client_id: KLANT, date: d, entity_urn: "l1", impressions: 50, clicks: 5, spend: 30.75, one_click_leads: 1, external_website_conversions: 2, post_click_conversions: 3, conversion_value: 0 }));
// Microsoft: begonnen op de 23e (de eerste maand is partieel), elke dag een rij.
const MICROSOFT: Rij[] = dagen("2025-07-23", "2026-10-31", 1, (d) =>
  ({ client_id: KLANT, date: d, entity_id: "ms1", impressions: 40, clicks: 4, spend: 12.25, conversions: 1, conversion_value: 40.5 }));
const DAGRIJEN: Record<NietGoogleKanaal, Rij[]> = { meta: META, linkedin: LINKEDIN, microsoft: MICROSOFT };

function zaai(config: unknown, zonder: NietGoogleKanaal[] = []): FakeSupabase {
  const sb = new FakeSupabase();
  sb.seed("accounts", [{ id: "acc-g", client_id: KLANT, name: "G", source: "google_ads", external_id: "1", agency_id: "a" }]);
  sb.seed("client_settings", [{ client_id: KLANT, channel_conversion_config: config }]);
  const googleMaanden: Rij[] = [];
  for (let jaar = 2024; jaar <= 2026; jaar++) {
    for (let m = 1; m <= (jaar === 2026 ? 10 : 12); m++) {
      googleMaanden.push({
        account_id: "acc-g", channel: "google", level: "account", grain: "month", period_start: `${jaar}-${String(m).padStart(2, "0")}-01`,
        impressions: 1000, clicks: 100, cost: 1000 + m, conversions: 10 + m, conv_value: 900,
      });
    }
  }
  sb.seed("fact_core", googleMaanden);
  sb.seed("ads_account_monthly", googleMaanden.map((r) => ({ client_id: KLANT, month: r.period_start })));
  sb.seed("client_sync_status", [{ client_id: KLANT, last_successful_sync_at: "2026-11-01T05:00:00Z" }]);
  for (const k of NIET_GOOGLE) if (!zonder.includes(k)) sb.seed(kanaalDagbron(k).table, DAGRIJEN[k]);
  return sb;
}

/** Het antwoord van de route zoals de browser het krijgt (door JSON), in de vorm die de band leest. */
async function routeStaat(sb: FakeSupabase): Promise<{ route: BandRoute; antwoord: BlendedHistoricalData }> {
  const uit = await fetchBlendedHistoricalData(sb as unknown as SupabaseClient, KLANT, NU);
  if (!uit) throw new Error("de route gaf geen data op de seed");
  const antwoord = JSON.parse(JSON.stringify(uit)) as BlendedHistoricalData;
  return { antwoord, route: { perKanaal: antwoord.perKanaal, dataStand: antwoord.dataStand, loading: false, error: null } };
}

const json = (v: unknown) => JSON.stringify(v);
/** De maanden van een reeks op "YYYY-MM", alleen de drie getallen die de band toont. */
const perMaand = (d: ClientHistoricalData): Map<string, [number, number, number]> =>
  new Map(flattenMonths(d).map((m) => [m.key, [m.conversions, m.revenue, m.adSpend]]));

async function main() {
  const SELECTIES: [string, unknown][] = [
    ["de standaardselectie", null],
    ["een opgeslagen selectie (Meta alleen leads, LinkedIn alleen lead-formulieren)", { meta_ads: ["leads"], linkedin_ads: ["one_click_leads"] }],
  ];

  for (const [naam, opgeslagen] of SELECTIES) {
    console.log(`Laag (a), ${naam}`);
    const sb = zaai(opgeslagen);
    const cfg = resolveChannelConversionConfig(opgeslagen as never);
    const { route, antwoord } = await routeStaat(sb);

    const uitRoute = {} as Record<NietGoogleKanaal, ReturnType<typeof kanaalStandUitRoute>>;
    const uitDagen = {} as Record<NietGoogleKanaal, ReturnType<typeof kanaalStandUitDagen>>;
    for (const k of NIET_GOOGLE) {
      // ALLE dagrijen van het kanaal, zoals ze in de tabel staan: geen venster, geen sortering.
      const alle = sb.tables[kanaalDagbron(k).table] ?? [];
      uitRoute[k] = kanaalStandUitRoute(KLANT, k, route);
      uitDagen[k] = kanaalStandUitDagen(KLANT, alle, k, cfg);

      const r = perMaand(uitRoute[k].data), d = perMaand(uitDagen[k].data);
      const sleutels = [...new Set([...r.keys(), ...d.keys()])].sort();
      const afwijkend = sleutels.filter((m) => json(r.get(m)) !== json(d.get(m)));
      check(`${k}: elke maand uit de route is de maand uit alle dagrijen (${sleutels.length} maanden)`,
        sleutels.length > 0 && afwijkend.length === 0, afwijkend.slice(0, 3).map((m) => `${m}: ${json(r.get(m))} tegen ${json(d.get(m))}`).join("; "));
      check(`${k}: vanaf (de eerste volle maand) is gelijk`, uitRoute[k].vanaf === uitDagen[k].vanaf && uitDagen[k].vanaf !== null, `${uitRoute[k].vanaf} tegen ${uitDagen[k].vanaf}`);
      check(`${k}: laatsteDag is gelijk`, uitRoute[k].laatsteDag === uitDagen[k].laatsteDag && uitDagen[k].laatsteDag !== null, `${uitRoute[k].laatsteDag} tegen ${uitDagen[k].laatsteDag}`);
      // En als geheel: dezelfde KanaalStand, niets ernaast behalve de laadgrens.
      const { geladenVanaf, ...stand } = uitRoute[k];
      check(`${k}: de stand als geheel is dezelfde`, json(stand) === json(uitDagen[k]));
      check(`${k}: uit de route is de hele historie geladen`, geladenVanaf === HELE_HISTORIE_GELADEN_VANAF, String(geladenVanaf));
      check(`${k}: de band draagt geen eersteDag`, json(Object.keys(uitRoute[k]).sort()) === json(["data", "geladenVanaf", "laatsteDag", "vanaf"]), json(Object.keys(uitRoute[k])));
    }

    // De invoer is echt de hele tabel: Meta begint vóór het 36-maandenvenster van de terugvalweg,
    // en met alleen dat venster was het een andere band geweest.
    const venster = monthsAgo(36).slice(0, 7);
    const metaMaanden = [...perMaand(uitRoute.meta.data).keys()].sort();
    check("Meta uit de route loopt verder terug dan het 36-maandenvenster van de eigen lezing",
      metaMaanden[0] === "2022-11" && metaMaanden[0] < venster, `${metaMaanden[0]} tegen ${venster}`);
    const alleenVenster = kanaalStandUitDagen(KLANT, META.filter((r) => String(r.date) >= monthsAgo(36)), "meta", cfg);
    check("en met alleen dat venster was de band een andere geweest (de test vergelijkt dus niet twee vensters)",
      json(alleenVenster.data) !== json(uitDagen.meta.data));
    check("de seed gaat over de paginagrens van de route (meer dan 1000 Meta-rijen)", META.length > 1000, String(META.length));

    // De pauze: `vanaf` blijft op de eerste dag ooit, eersteDag is de terugkeer en hoort bij de prognose.
    const metaReeks = antwoord.perKanaal.find((x) => x.kanaal === "meta");
    check("Meta: de route kent de terugkeer na de pauze als eersteDag", metaReeks?.eersteDag === "2026-07-20", String(metaReeks?.eersteDag));
    check("Meta: de band paart vanaf de eerste volle maand sinds de eerste dag ooit, niet vanaf de terugkeer",
      uitRoute.meta.vanaf === "2022-12" && uitRoute.meta.vanaf !== eersteVolleMaand(metaReeks?.eersteDag), `${uitRoute.meta.vanaf} / ${eersteVolleMaand(metaReeks?.eersteDag)}`);
    check("Microsoft: begonnen op de 23e, dus vol vanaf de maand erna", uitRoute.microsoft.vanaf === "2025-08", String(uitRoute.microsoft.vanaf));
    check("LinkedIn: begonnen op de 1e, dus vol vanaf die maand", uitRoute.linkedin.vanaf === "2025-03", String(uitRoute.linkedin.vanaf));

    // "Alle kanalen" in de band: Google plus de drie standen, maand voor maand. Google hier uit
    // dezelfde reeks aan beide kanten (in productie leest de band hem live; dat is een andere bron
    // dan fact_core, en buiten deze gelijkheid).
    const googleReeks = antwoord.perKanaal.find((x) => x.kanaal === "google");
    const google = kanaalStandUitMaanden(KLANT, maandTotalenUitMaandreeks(googleReeks?.maanden ?? []), null, null).data;
    const band = perMaand(samenvoegen(KLANT, [google, ...NIET_GOOGLE.map((k) => uitRoute[k].data)]));
    const delen = [google, ...NIET_GOOGLE.map((k) => uitDagen[k].data)].map(perMaand);
    const scheef = [...band.keys()].filter((m) => {
      const som = [0, 1, 2].map((i) => delen.reduce((s, d) => s + (d.get(m)?.[i] ?? 0), 0));
      return json(som) !== json(band.get(m));
    });
    check(`Alle kanalen in de band = Google + Meta + LinkedIn + Microsoft uit de dagrijen, maand voor maand (${band.size} maanden)`,
      band.size > 0 && scheef.length === 0, scheef.slice(0, 3).join(", "));

    // En de optelling van de route zelf (het Jaaroverzicht op Alle kanalen) is dezelfde som: de
    // route rondt haar maanden af (naarApiMonthlyData), de band niet.
    const samen = new Map<string, [number, number, number]>();
    for (const j of antwoord.historicalYears) for (const m of j.monthly) samen.set(`${j.year}-${String(m.month).padStart(2, "0")}`, [m.conversions, m.revenue, m.adSpend]);
    for (const m of antwoord.currentYearMonthly) samen.set(`${antwoord.currentYear}-${String(m.month).padStart(2, "0")}`, [m.conversions, m.revenue, m.adSpend]);
    const naast = [...samen.keys()].filter((m) => json(samen.get(m)) !== json((band.get(m) ?? [0, 0, 0]).map(Math.round)));
    check(`het Jaaroverzicht van de route telt per maand hetzelfde als de band (${samen.size} maanden)`,
      samen.size > 0 && naast.length === 0, naast.slice(0, 3).map((m) => `${m}: ${json(samen.get(m))} tegen ${json(band.get(m))}`).join("; "));
  }

  console.log("Laag (a), een kanaal dat de klant niet heeft");
  {
    const sb = zaai(null, ["microsoft"]);
    const { route, antwoord } = await routeStaat(sb);
    check("de route noemt het kanaal niet", !antwoord.perKanaal.some((x) => x.kanaal === "microsoft"));
    const { geladenVanaf, ...stand } = kanaalStandUitRoute(KLANT, "microsoft", route);
    check("de band geeft dan de lege stand van kanaalStandUitDagen op nul rijen",
      json(stand) === json(kanaalStandUitDagen(KLANT, [], "microsoft", resolveChannelConversionConfig(null))) && stand.laatsteDag === null && stand.vanaf === null
        && geladenVanaf === HELE_HISTORIE_GELADEN_VANAF);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
