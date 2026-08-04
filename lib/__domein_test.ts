// De canonieke doorverwijzing. Deterministisch, geen IO.
// Draaien: npx tsx lib/__domein_test.ts
//
// De meeste controles hier gaan over wat er NIET mag gebeuren. Een doorverwijzing is makkelijk te
// schrijven en moeilijk terug te draaien zodra hij te breed staat: hij grijpt in voordat iemand
// iets ziet, dus een fout hier maakt een omgeving onbereikbaar in plaats van lelijk.

import { canoniekeDoelUrl, canoniekeDoelUrlVoorVerzoek, CANONIEK_DOMEIN } from "./domein";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Wat er wél doorverwezen wordt ─────────────────────────────────────────

check(".nl gaat naar .com",
  canoniekeDoelUrl("https://ctrlppc.nl/") === `https://${CANONIEK_DOMEIN}/`,
  String(canoniekeDoelUrl("https://ctrlppc.nl/")));
check("www.nl ook",
  canoniekeDoelUrl("https://www.ctrlppc.nl/") === `https://${CANONIEK_DOMEIN}/`);
check("www.com ook, want ook dat is niet canoniek",
  canoniekeDoelUrl("https://www.ctrlppc.com/") === `https://${CANONIEK_DOMEIN}/`);
check("hoofdletters in de host maken niet uit",
  canoniekeDoelUrl("https://CtrlPPC.NL/") === `https://${CANONIEK_DOMEIN}/`);

// HET PAD BLIJFT STAAN. Iemand die een gedeelde link naar een klant opent op .nl hoort op die
// klant uit te komen. Belandt hij op de voorpagina, dan lijkt de link kapot.
check("pad blijft behouden",
  canoniekeDoelUrl("https://ctrlppc.nl/client/gads-123") === `https://${CANONIEK_DOMEIN}/client/gads-123`,
  String(canoniekeDoelUrl("https://ctrlppc.nl/client/gads-123")));
check("zoekparameters blijven behouden",
  canoniekeDoelUrl("https://ctrlppc.nl/client/x?geo=AQM&demo=1")
    === `https://${CANONIEK_DOMEIN}/client/x?geo=AQM&demo=1`,
  String(canoniekeDoelUrl("https://ctrlppc.nl/client/x?geo=AQM&demo=1")));
check("fragment blijft behouden",
  canoniekeDoelUrl("https://ctrlppc.nl/insights#sectie") === `https://${CANONIEK_DOMEIN}/insights#sectie`);

// http wordt https, anders volgt er meteen een tweede doorverwijzing en komt een sessiecookie
// niet mee.
check("http wordt https",
  canoniekeDoelUrl("http://ctrlppc.nl/portfolio") === `https://${CANONIEK_DOMEIN}/portfolio`,
  String(canoniekeDoelUrl("http://ctrlppc.nl/portfolio")));

// ── Wat er NIET doorverwezen mag worden ───────────────────────────────────
//
// Dit is het deel dat ertoe doet. Een regel die "alles wat niet canoniek is" doorverwijst, maakt
// elke voorvertoning en elke lokale omgeving onbruikbaar -- je opent een preview-link en staat op
// productie zonder dat te zien.

for (const url of [
  `https://${CANONIEK_DOMEIN}/`,
  `https://${CANONIEK_DOMEIN}/client/x?a=1`,
  "http://localhost:3000/portfolio",
  "http://127.0.0.1:3000/",
  "https://dashboard-git-branch-team.vercel.app/client/x",
  "https://voorbeeld.test/",
]) {
  check(`geen doorverwijzing voor ${url}`, canoniekeDoelUrl(url) === null, String(canoniekeDoelUrl(url)));
}

// Een domein dat het canonieke domein alleen BEVAT, is een ander domein. Zonder exacte
// vergelijking zou "ctrlppc.com.kwaadaardig.nl" als canoniek gelden en blijven staan.
check("een domein dat er alleen op lijkt telt niet mee",
  canoniekeDoelUrl("https://ctrlppc.nl.voorbeeld.test/") === null,
  String(canoniekeDoelUrl("https://ctrlppc.nl.voorbeeld.test/")));

// ── Onzin ─────────────────────────────────────────────────────────────────

check("onparseerbare invoer geeft null", canoniekeDoelUrl("geen url") === null);
check("lege invoer geeft null", canoniekeDoelUrl("") === null);

// ── De versie die de middleware gebruikt ──────────────────────────────────
//
// HET GEVAL WAAROM DEZE FUNCTIE BESTAAT. Gemeten op een zelf gehoste `next start` op poort 3190:
// bij een verzoek met `Host: ctrlppc.nl` is request.url gewoon http://localhost:3190/... Next
// normaliseert naar het adres waarop de server luistert. De doorverwijzing keek naar die URL en
// vuurde dus nooit -- zonder foutmelding en zonder falende test, want er stond niets fout, er
// werd alleen naar de verkeerde plek gekeken.

check("de host-header wint van de genormaliseerde url",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/client/x?a=1", "ctrlppc.nl")
    === `https://${CANONIEK_DOMEIN}/client/x?a=1`,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/client/x?a=1", "ctrlppc.nl")));
check("met poort in de host-header ook",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", "ctrlppc.nl:8080") === `https://${CANONIEK_DOMEIN}/p`,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", "ctrlppc.nl:8080")));
check("x-forwarded-host wint van host",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", "interne-loadbalancer:8080", "ctrlppc.nl")
    === `https://${CANONIEK_DOMEIN}/p`,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", "interne-loadbalancer:8080", "ctrlppc.nl")));
check("bij meerdere proxies telt de eerste",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", null, "ctrlppc.nl, interne-proxy")
    === `https://${CANONIEK_DOMEIN}/p`,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", null, "ctrlppc.nl, interne-proxy")));

// En vooral: de lokale ontwikkelmachine blijft met rust. Dit is het geval dat elke dag voorkomt.
check("localhost met eigen host-header wordt niet doorverwezen",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/portfolio", "localhost:3190") === null,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/portfolio", "localhost:3190")));
check("het canonieke domein zelf wordt niet doorverwezen",
  canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", CANONIEK_DOMEIN) === null,
  String(canoniekeDoelUrlVoorVerzoek("http://localhost:3190/p", CANONIEK_DOMEIN)));

// Zonder host-header valt hij terug op de url zelf: dat is beter dan niets doen, en het is wat
// er op een platform gebeurt dat de host wél in de url zet.
check("zonder host-header valt hij terug op de url",
  canoniekeDoelUrlVoorVerzoek("https://ctrlppc.nl/p", null) === `https://${CANONIEK_DOMEIN}/p`,
  String(canoniekeDoelUrlVoorVerzoek("https://ctrlppc.nl/p", null)));
check("onparseerbare url geeft ook hier null",
  canoniekeDoelUrlVoorVerzoek("geen url", "ctrlppc.nl") === null);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
