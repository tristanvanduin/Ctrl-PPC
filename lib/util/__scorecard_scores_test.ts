// De gedeelde scorebanden van de scorecards. Deterministisch, geen IO.
// Draaien: npx tsx lib/util/__scorecard_scores_test.ts
//
// Dit zijn bandgrens-tests, met opzet exact óp de grens: de drie kopieën die hier zijn
// samengevoegd (display/shopping/pmax) waren vandaag nog identiek, maar de vierde kopie is
// historisch gezien degene die het nét anders doet. Wie een grens verschuift of een < in een
// <= verandert, hoort hier rood te zien — voor alle scorecards tegelijk, niet voor één.

import { trendScoreDalendIsGoed, trendScoreStijgendIsGoed, aandeelScoreOmgekeerd } from "./scorecard-scores";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("trendScoreDalendIsGoed: grenzen op -10 / 5 / 20 (strikte <)");
check("-10.01 valt in de beste band", trendScoreDalendIsGoed(-10.01) === 20, String(trendScoreDalendIsGoed(-10.01)));
check("exact -10 valt NIET meer in de beste band", trendScoreDalendIsGoed(-10) === 16, String(trendScoreDalendIsGoed(-10)));
check("4.99 is nog stabiel", trendScoreDalendIsGoed(4.99) === 16, String(trendScoreDalendIsGoed(4.99)));
check("exact 5 is licht stijgend", trendScoreDalendIsGoed(5) === 10, String(trendScoreDalendIsGoed(5)));
check("19.99 is nog licht stijgend", trendScoreDalendIsGoed(19.99) === 10, String(trendScoreDalendIsGoed(19.99)));
check("exact 20 is de slechtste band", trendScoreDalendIsGoed(20) === 4, String(trendScoreDalendIsGoed(20)));
check("een forse daling scoort vol", trendScoreDalendIsGoed(-50) === 20);
check("een forse stijging scoort minimaal", trendScoreDalendIsGoed(80) === 4);

console.log("\ntrendScoreStijgendIsGoed: grenzen op 10 / -10 / -25 (strikte >)");
check("10.01 valt in de beste band", trendScoreStijgendIsGoed(10.01) === 20, String(trendScoreStijgendIsGoed(10.01)));
check("exact 10 valt NIET meer in de beste band", trendScoreStijgendIsGoed(10) === 14, String(trendScoreStijgendIsGoed(10)));
check("-9.99 is nog stabiel", trendScoreStijgendIsGoed(-9.99) === 14, String(trendScoreStijgendIsGoed(-9.99)));
check("exact -10 is dalend", trendScoreStijgendIsGoed(-10) === 8, String(trendScoreStijgendIsGoed(-10)));
check("-24.99 is nog dalend", trendScoreStijgendIsGoed(-24.99) === 8, String(trendScoreStijgendIsGoed(-24.99)));
check("exact -25 is de slechtste band", trendScoreStijgendIsGoed(-25) === 4, String(trendScoreStijgendIsGoed(-25)));

console.log("\naandeelScoreOmgekeerd: grenzen op 0.10 / 0.25 / 0.40 (strikte <)");
check("0.099 valt in de beste band", aandeelScoreOmgekeerd(0.099) === 20, String(aandeelScoreOmgekeerd(0.099)));
check("exact 0.10 valt NIET meer in de beste band", aandeelScoreOmgekeerd(0.10) === 14, String(aandeelScoreOmgekeerd(0.10)));
check("0.249 is nog de tweede band", aandeelScoreOmgekeerd(0.249) === 14, String(aandeelScoreOmgekeerd(0.249)));
check("exact 0.25 is de derde band", aandeelScoreOmgekeerd(0.25) === 8, String(aandeelScoreOmgekeerd(0.25)));
check("0.399 is nog de derde band", aandeelScoreOmgekeerd(0.399) === 8, String(aandeelScoreOmgekeerd(0.399)));
check("exact 0.40 is de slechtste band", aandeelScoreOmgekeerd(0.40) === 4, String(aandeelScoreOmgekeerd(0.40)));
check("nul aandeel scoort vol", aandeelScoreOmgekeerd(0) === 20);
check("alles in het dure segment scoort minimaal", aandeelScoreOmgekeerd(1) === 4);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
