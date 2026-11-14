// Test: het tijdbudget van app/api/cron/trigger-sops (lib/scheduler/sop-tijdbudget.ts).
// Draaien: tsx lib/scheduler/__sop_tijdbudget_test.ts
//
// De cron wachtte met maxDuration 300 op analyse-routes met maxDuration 600; van de 51 afgeronde
// (knop- en test)runs sinds augustus liepen er 7 langer dan 300 s (max 508). Deze test legt vast wat de route met
// zijn klok doet: geen analyse starten die niet af kan, vervolgstappen uitstellen als de tijd op is,
// en altijd een eindmarge voor het overzicht.

import {
  type DueBeslissing,
  maakTijdbudget, resterendMs, magAnalyseStarten, analyseTimeoutMs, vervolgTimeoutMs, beslisDueItem,
  ANALYSE_MAX_DUUR_S, UPLOAD_MARGE_S, EINDMARGE_S, VERVOLG_MIN_S,
} from "./sop-tijdbudget";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const isUitgesteld = (b: DueBeslissing, reden: "limiet" | "tijd") => b.soort === "uitgesteld" && b.reden === reden;

const T0 = Date.parse("2026-11-14T05:20:00Z");
const s = (sec: number) => T0 + sec * 1000;
const nieuw = maakTijdbudget(800, T0);
const oud = maakTijdbudget(300, T0);

// ── de oude instelling ───────────────────────────────────────────────────────
// Met 300 s past geen enkele analyse gegarandeerd: het restant dekt nooit 600 + upload. Dit is de
// reden voor maxDuration 800 op de route.
check("maxDuration 300: geen analyse past, ook niet op t=0", !magAnalyseStarten(oud, T0));
check("maxDuration 300: due item wordt uitgesteld om de tijd",
  isUitgesteld(beslisDueItem({ getriggerd: 0, limit: 1, budget: oud, nuMs: T0 }), "tijd"));

// ── 800 s: een analyse past, ook de traagste ─────────────────────────────────
check("maxDuration 800: op t=0 past een analyse", magAnalyseStarten(nieuw, T0));
check("de timeout voor de analyse is ruimer dan zijn eigen maxDuration",
  (analyseTimeoutMs(nieuw, T0) ?? 0) >= ANALYSE_MAX_DUUR_S * 1000, String(analyseTimeoutMs(nieuw, T0)));
check("en laat ruimte voor upload en eindmarge binnen de 800 s",
  T0 + (analyseTimeoutMs(nieuw, T0) ?? 0) + (UPLOAD_MARGE_S + EINDMARGE_S) * 1000 <= s(800));

// Na een analyse van 508 s (de gemeten traagste biweekly) start er geen tweede: hij zou niet af kunnen.
check("na 508 s geen tweede analyse", !magAnalyseStarten(nieuw, s(508)));
check("na 508 s: due item uitgesteld om de tijd, ook met een ruime limit",
  isUitgesteld(beslisDueItem({ getriggerd: 1, limit: 5, budget: nieuw, nuMs: s(508) }), "tijd"));
// Na een snelle weekly (120 s) past er met een ruimere limit wel een tweede.
check("na 120 s past met limit 2 nog een analyse",
  beslisDueItem({ getriggerd: 1, limit: 2, budget: nieuw, nuMs: s(120) }).soort === "starten");
// De grens precies: 800 - 15 - 600 - 30 = 155 s.
const grens = 800 - EINDMARGE_S - ANALYSE_MAX_DUUR_S - UPLOAD_MARGE_S;
check("grens op 155 s: daar nog wel, een seconde later niet",
  magAnalyseStarten(nieuw, s(grens)) && !magAnalyseStarten(nieuw, s(grens + 1)), String(grens));
check("analyseTimeoutMs is null als de analyse niet past", analyseTimeoutMs(nieuw, s(grens + 1)) === null);

// Beslissing en timeout uit een klok: op de grens geeft "starten" altijd de volle timeout mee, nooit
// nul. Met twee aparte Date.now()-lezingen kon de tweede net voorbij de grens vallen.
const opGrens = beslisDueItem({ getriggerd: 0, limit: 1, budget: nieuw, nuMs: s(grens) });
check("op de grens: starten met een timeout die analyse plus marges dekt",
  opGrens.soort === "starten" && opGrens.timeoutMs === analyseTimeoutMs(nieuw, s(grens))
  && opGrens.timeoutMs >= ANALYSE_MAX_DUUR_S * 1000, JSON.stringify(opGrens));

// ── de limit gaat voor de tijd ───────────────────────────────────────────────
check("limit bereikt: uitgesteld om de limit, ook als de tijd ruim is",
  isUitgesteld(beslisDueItem({ getriggerd: 1, limit: 1, budget: nieuw, nuMs: T0 }), "limiet"));

// ── vervolgstappen ───────────────────────────────────────────────────────────
// Na de traagste analyse (600 s) plus upload blijft er ruim tijd voor cross-channel en de PDF.
const naTraagste = vervolgTimeoutMs(nieuw, s(ANALYSE_MAX_DUUR_S + UPLOAD_MARGE_S));
check("na 630 s krijgt een vervolgstap nog ruim twee minuten",
  naTraagste !== null && naTraagste >= 150_000, String(naTraagste));
check("de timeout van een vervolgstap eindigt op de eindmarge, niet erna",
  s(700) + (vervolgTimeoutMs(nieuw, s(700)) ?? 0) === s(800 - EINDMARGE_S));
check("onder VERVOLG_MIN_S start er geen vervolgstap meer",
  vervolgTimeoutMs(nieuw, s(800 - EINDMARGE_S - VERVOLG_MIN_S + 1)) === null
  && vervolgTimeoutMs(nieuw, s(800 - EINDMARGE_S - VERVOLG_MIN_S)) !== null);
check("voorbij de grens is het restant negatief en de timeout null",
  resterendMs(nieuw, s(900)) < 0 && vervolgTimeoutMs(nieuw, s(900)) === null);

console.log(`sop-tijdbudget: ${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
