// Zoekt de defecten in een gerenderde SOP-PDF die tsc, de tests en de build per definitie niet
// zien: interne pijplijn-lekken (rauwe Engelse veldnamen, "stap N"/"Steps N"), stat-tegels die
// allemaal op 0 staan terwijl er wel data is, en paginabloat (een regel per pagina i.p.v.
// samengevat).
//
// ── WAAROM DIT ER IS ────────────────────────────────────────────────────────
//
// De hele SOP-PDF is op 19-20 augustus 2026 herontworpen van 18-22 pagina's naar 4: geen interne
// AI-pijplijnmechaniek meer zichtbaar, concrete evidence-badges i.p.v. abstracte herhaling. Maar
// die redesign zat alleen in het renderpad dat aanslaat als `sopType === "monthly"` -- de
// letterlijke Google-string. Meta en LinkedIn's maandanalyses draaien dezelfde
// finalizeChannelMonthlySynthesis en hadden dus exact dezelfde rijke data allang klaarstaan,
// maar de PDF-route vroeg hem nooit op. Hun PDF viel terug op het lege legacy-pad: 22 pagina's,
// alle vijf stat-tegels op "0" (findings/recommendations/tasks bleven `undefined`), en rauwe
// Engelse veldnamen als "Primary thread" -- exact het defect waar de hele redesign voor bedoeld
// was, hier nog volledig aanwezig. Niets in tsc/tests/build zag dit; het kwam pas aan het licht
// door een PDF met het blote oog te bekijken (zie ook scripts/check-kaartoverloop.mjs se eigen
// aanleiding -- zelfde soort "rendert gewoon, leest als een ontwerpkeuze"-fout).
//
// ── HOE JE HEM DRAAIT ───────────────────────────────────────────────────────
//
//   npx next build && npx next start -p 3190     (eerst bouwen, zonder draaiende server)
//   node scripts/check-pdf-kwaliteit.mjs
//
// Bewust NIET in scripts/gates.sh: heeft een draaiende server en echte demo-data nodig, en
// genereert bij elke run meerdere PDF's -- te traag voor de snelle poorten. Draai hem na
// wijzigingen aan lib/analysis/sop-pdf-renderer.ts of app/api/analysis/pdf/route.ts.
//
// ── DE ZELFTEST ─────────────────────────────────────────────────────────────
//
// Een controle die niet kán falen is geen controle. Dit script bouwt aan het eind twee kleine
// synthetische PDF's rechtstreeks met @react-pdf/renderer -- een "foute" met exact de drie
// defecten hierboven (25 pagina's, "Primary thread", alle tegels op 0) en een "goede" zonder --
// en eist dat de detector de foute wél en de goede niét markeert. Doet hij dat niet, dan
// controleert hij iets anders dan hij beweert en faalt dit script alsnog, ongeacht wat de live
// PDF's hierboven lieten zien.

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { PDFParse } from "pdf-parse";

const BASIS = process.env.BASIS_URL ?? "http://localhost:3190";

// De combinaties die live gecontroleerd worden: alle drie de kanalen op monthly (waar de
// stat-tegels en de rijke laag zitten -- precies waar het Meta/LinkedIn-defect zat), weekly en
// biweekly (waar het →-pijltjes-/"Stap N"-defect zat, zie lib/analysis/sanitize.ts), en de drie
// single-channel demo-klanten (demo-grt/gra/grn -- alleen Google, geen cross-channel-synthese
// mogelijk) zodat de poort niet blind is voor de meest voorkomende klantvorm: één kanaal.
const COMBINATIES = [
  { clientId: "demo-greentech", sopType: "monthly", clientName: "GreenTech", baseType: "monthly" },
  { clientId: "demo-greentech", sopType: "meta_monthly", clientName: "GreenTech", baseType: "monthly" },
  { clientId: "demo-greentech", sopType: "linkedin_monthly", clientName: "GreenTech", baseType: "monthly" },
  { clientId: "demo-greentech", sopType: "weekly", clientName: "GreenTech", baseType: "weekly" },
  { clientId: "demo-greentech", sopType: "biweekly", clientName: "GreenTech", baseType: "biweekly" },
  { clientId: "demo-grt", sopType: "monthly", clientName: "GRT", baseType: "monthly" },
  { clientId: "demo-gra", sopType: "monthly", clientName: "GRA", baseType: "monthly" },
  { clientId: "demo-grn", sopType: "monthly", clientName: "GRN", baseType: "monthly" },
];

const MAX_PAGINAS = { monthly: 8, biweekly: 10, weekly: 10 };

// Rauwe Engelse veldnamen uit FinalSopSynthesis/OperatingDetailLayer (lib/analysis/monthly-
// structured.ts) die nooit letterlijk in een PDF horen te staan -- ze horen via
// stripInternalRefs/de Nederlandse kaartlabels te lopen (lib/analysis/sop-pdf-renderer.ts).
// Verschijnen ze toch, dan is de renderer teruggevallen op het lege/legacy pad.
const INTERNE_LEKKEN = [
  /Primary thread/i,
  /Root cause/i,
  /Supporting evidence/i,
  /What is NOT the problem/i,
  /QA self-check/i,
  /Operating detail/i,
  /\bstap(?:pen)?\s+\d+/i,
  /\bSteps?\s+\d+/,
  /\bTasks?\s+\d+/,
];

// Exacte tekstvolgorde van de stat-tegels op pagina 1 (geverifieerd door de kapotte Meta/
// LinkedIn-PDF's zelf uit te lezen, 20 augustus 2026) -- vijf getallen met hun label, elk op een
// eigen regel. Alleen zinvol voor de monthly-vorm, waar deze tegelrij bestaat.
const ALLE_TEGELS_NUL = /0\nBevindingen\n0\nKritiek\/Hoog\n0\nGezonde Signalen\n0\nAanbevelingen\n0\nTaken/;

/** De eigenlijke detector: tekst + paginatelling + basisvorm in, bevindingen (strings) uit. */
function detecteer(text, pageCount, baseType) {
  const bevindingen = [];
  for (const patroon of INTERNE_LEKKEN) {
    const match = text.match(patroon);
    if (match) bevindingen.push(`interne-lek: "${match[0]}"`);
  }
  if (baseType === "monthly" && ALLE_TEGELS_NUL.test(text)) {
    bevindingen.push("alle vijf stat-tegels staan op 0");
  }
  const maxPaginas = MAX_PAGINAS[baseType] ?? 10;
  if (pageCount > maxPaginas) {
    bevindingen.push(`${pageCount} pagina's (verwacht max ${maxPaginas} voor ${baseType})`);
  }
  return bevindingen;
}

async function pdfTekstEnPaginas(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return { text: result.text, pageCount: result.pages.length };
}

async function haalPdfOp({ clientId, sopType, clientName }) {
  const params = new URLSearchParams({ client_id: clientId, sop_type: sopType, client_name: clientName });
  const res = await fetch(`${BASIS}/api/analysis/pdf?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── Synthetische PDF's voor de zelftest ─────────────────────────────────────
// Rechtstreeks met @react-pdf/renderer i.p.v. via de echte renderer/route: dit test de DETECTOR,
// niet de pijplijn -- onafhankelijk van of de app op dit moment toevallig goede of foute PDF's
// produceert.

async function bouwFoutePdf() {
  const paginas = Array.from({ length: 25 }, (_, i) =>
    React.createElement(Page, { key: i, size: "A4" }, React.createElement(Text, {}, `Sectie ${i + 1}`))
  );
  const eerstePagina = React.createElement(
    Page,
    { key: "stats", size: "A4" },
    React.createElement(Text, {}, "0"), React.createElement(Text, {}, "Bevindingen"),
    React.createElement(Text, {}, "0"), React.createElement(Text, {}, "Kritiek/Hoog"),
    React.createElement(Text, {}, "0"), React.createElement(Text, {}, "Gezonde Signalen"),
    React.createElement(Text, {}, "0"), React.createElement(Text, {}, "Aanbevelingen"),
    React.createElement(Text, {}, "0"), React.createElement(Text, {}, "Taken"),
    React.createElement(Text, {}, "Primary thread"),
    React.createElement(Text, {}, "Account: GRT | Search | NL - CPA €150")
  );
  const doc = React.createElement(Document, {}, eerstePagina, ...paginas);
  return renderToBuffer(doc);
}

async function bouwGoedePdf() {
  const styles = StyleSheet.create({ tegel: { marginBottom: 4 } });
  const pagina1 = React.createElement(
    Page,
    { key: "p1", size: "A4" },
    React.createElement(View, { style: styles.tegel }, React.createElement(Text, {}, "3"), React.createElement(Text, {}, "Bevindingen")),
    React.createElement(View, { style: styles.tegel }, React.createElement(Text, {}, "1"), React.createElement(Text, {}, "Kritiek/Hoog")),
    React.createElement(View, { style: styles.tegel }, React.createElement(Text, {}, "8"), React.createElement(Text, {}, "Gezonde Signalen")),
    React.createElement(View, { style: styles.tegel }, React.createElement(Text, {}, "3"), React.createElement(Text, {}, "Aanbevelingen")),
    React.createElement(View, { style: styles.tegel }, React.createElement(Text, {}, "5"), React.createElement(Text, {}, "Taken")),
    React.createElement(Text, {}, "Executive focus"),
    React.createElement(Text, {}, "Campagne: GRT | Search | NL mist vraag door budgetbeperking.")
  );
  const overigePaginas = Array.from({ length: 3 }, (_, i) =>
    React.createElement(Page, { key: `p${i + 2}`, size: "A4" }, React.createElement(Text, {}, `Inhoud pagina ${i + 2}`))
  );
  const doc = React.createElement(Document, {}, pagina1, ...overigePaginas);
  return renderToBuffer(doc);
}

async function zelftest() {
  console.log("\nZelftest: een bewust foute en een bewust goede PDF door de detector halen.");

  const fouteBuffer = await bouwFoutePdf();
  const { text: fouteTekst, pageCount: foutePaginas } = await pdfTekstEnPaginas(fouteBuffer);
  const fouteBevindingen = detecteer(fouteTekst, foutePaginas, "monthly");

  const goedeBuffer = await bouwGoedePdf();
  const { text: goedeTekst, pageCount: goedePaginas } = await pdfTekstEnPaginas(goedeBuffer);
  const goedeBevindingen = detecteer(goedeTekst, goedePaginas, "monthly");

  if (fouteBevindingen.length === 0) {
    console.log("  FOUT  de bewust foute PDF werd niet gemarkeerd -- de detector controleert iets anders dan hij beweert.");
    process.exit(1);
  }
  if (goedeBevindingen.length !== 0) {
    console.log(`  FOUT  de bewust goede PDF werd tóch gemarkeerd (${goedeBevindingen.join("; ")}) -- vals alarm, de detector is te streng.`);
    process.exit(1);
  }
  console.log(`  OK    foute PDF gemarkeerd (${fouteBevindingen.join("; ")}), goede PDF schoon (${goedePaginas} pagina's).`);
}

async function main() {
  let bevindingenTotaal = 0;
  for (const combinatie of COMBINATIES) {
    const label = `${combinatie.clientId}/${combinatie.sopType}`;
    try {
      const buffer = await haalPdfOp(combinatie);
      const { text, pageCount } = await pdfTekstEnPaginas(buffer);
      const bevindingen = detecteer(text, pageCount, combinatie.baseType);
      bevindingenTotaal += bevindingen.length;
      console.log(
        `  ${bevindingen.length === 0 ? "OK  " : "FOUT"}  ${label.padEnd(32)} ` +
        (bevindingen.length === 0 ? `schoon (${pageCount} pagina's)` : bevindingen.join("; "))
      );
    } catch (err) {
      bevindingenTotaal += 1;
      console.log(`  FOUT  ${label.padEnd(32)} kon niet ophalen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await zelftest();

  if (bevindingenTotaal > 0) {
    console.log(`\n  ${bevindingenTotaal} bevinding(en) in de gecontroleerde PDF's.`);
    process.exit(1);
  }
  console.log("\n  Alle gecontroleerde PDF's voldoen aan de standaard.");
}

main().catch((e) => { console.error(e); process.exit(1); });
