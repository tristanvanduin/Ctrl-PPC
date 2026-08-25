// Valt elke sop_type in precies één kanaal, en klopt die indeling met die van de inzichtenlaag?
// Draaien: npx tsx lib/analysis/__sop_kanaal_partitie_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// sop_tasks droeg geen sop_type. priorTasksVoorGrounding kon dus alleen op client_id en datum
// filteren, en de Google-maandprompt kreeg de taken van de Meta- en LinkedIn-runs ongelabeld
// binnen -- mét de instructie afgeronde taken niet te herhalen. Een Google-analyse las daardoor
// dat een LinkedIn-formulierwijziging al was uitgevoerd en liet een echte Google-actie liggen.
// Migratie 104 voegt de kolom toe; sopTypesVanZelfdeKanaal is het filter erbovenop.
//
// Wat hier fout kan gaan is niet zichtbaar als een fout. Een filter dat één sop_type mist, laat
// stilzwijgend historie weg; een filter dat er één te veel doorlaat, mengt kanalen weer. Beide
// leveren een prompt op die er precies zo uitziet als een goede. De eigenschap die dat afdekt is
// PARTITIE: de negen sleutels vallen in drie disjuncte groepen van drie, samen volledig.
//
// De tweede eigenschap is dat die indeling gelijk is aan die van channelOfSopType -- de functie
// waar de UI zijn badges op baseert. Lopen die twee uiteen, dan deelt het scherm een taak bij een
// ander kanaal in dan de prompt, en dat is precies het soort verschil dat niemand opmerkt.

import { sopTypesVanZelfdeKanaal, ALLE_SOP_CHANNELS, ALLE_SOP_TYPES, CHANNEL_CONFIG } from "./sop-channel-config";
import { channelOfSopType } from "@/lib/insights/channel-of";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

/** Alle negen sleutels, uit dezelfde tabel die de productiecode gebruikt. */
const ALLE_SLEUTELS = ALLE_SOP_CHANNELS.flatMap((kanaal) =>
  ALLE_SOP_TYPES.map((cadans) => CHANNEL_CONFIG[kanaal].sopTypeKey[cadans])
);

// Het aantal is afgeleid, niet hardgecodeerd: bij het vierde kanaal (microsoft_ads, 25 aug 2026)
// ging dit van 9 naar 12, en de test hoort dan mee te groeien via dezelfde tabel als de
// productiecode -- niet te falen op een getal dat gisteren klopte.
const VERWACHT = ALLE_SOP_CHANNELS.length * ALLE_SOP_TYPES.length;

console.log(`De ${VERWACHT} sleutels vormen een partitie in ${ALLE_SOP_CHANNELS.length} kanalen`);
{
  check(`er zijn ${VERWACHT} sleutels`, ALLE_SLEUTELS.length === VERWACHT, ALLE_SLEUTELS.join(", "));
  check("en ze zijn allemaal uniek", new Set(ALLE_SLEUTELS).size === VERWACHT, ALLE_SLEUTELS.join(", "));

  for (const sleutel of ALLE_SLEUTELS) {
    const groep = sopTypesVanZelfdeKanaal(sleutel);
    check(`${sleutel}: drie cadansen`, groep.length === 3, groep.join(", "));
    check(`${sleutel}: zit in zijn eigen groep`, groep.includes(sleutel), groep.join(", "));
  }

  // Disjunct: twee sleutels uit verschillende kanalen mogen geen enkele waarde delen.
  for (const a of ALLE_SLEUTELS) {
    for (const b of ALLE_SLEUTELS) {
      const zelfdeKanaal = channelOfSopType(a) === channelOfSopType(b);
      const overlap = sopTypesVanZelfdeKanaal(a).some((t) => sopTypesVanZelfdeKanaal(b).includes(t));
      if (zelfdeKanaal) continue;
      check(`${a} en ${b} delen niets`, !overlap,
        `${sopTypesVanZelfdeKanaal(a).join(",")} vs ${sopTypesVanZelfdeKanaal(b).join(",")}`);
    }
  }

  // Volledig: de drie groepen samen dekken alle negen. Een sleutel die nergens in valt zou
  // stilzwijgend uit elke taakhistorie verdwijnen.
  const gedekt = new Set(ALLE_SLEUTELS.flatMap((s) => sopTypesVanZelfdeKanaal(s)));
  check(`samen dekken de groepen alle ${VERWACHT} sleutels`, gedekt.size === VERWACHT,
    [...gedekt].sort().join(", "));
}

console.log("\nDe indeling is dezelfde als die van de inzichtenlaag");
{
  // channelOfSopType is de functie waar de UI-badges op staan. Deze test bewaakt dat de
  // promptkant er niet naast gaat lopen -- niet dat sopTypesVanZelfdeKanaal hem aanroept (dat is
  // een implementatiekeuze), maar dat de UITKOMST gelijk is.
  for (const sleutel of ALLE_SLEUTELS) {
    const kanaal = channelOfSopType(sleutel);
    const groep = sopTypesVanZelfdeKanaal(sleutel);
    check(`${sleutel} (${kanaal}): de hele groep hoort bij hetzelfde kanaal`,
      groep.every((t) => channelOfSopType(t) === kanaal),
      groep.map((t) => `${t}=${channelOfSopType(t)}`).join(", "));
  }
}

console.log("\nWat er buiten de negen valt");
{
  // cross_channel hoort per definitie bij geen enkel kanaal. Een lege lijst betekent voor de
  // aanroeper "geen kanaalfilter mogelijk" en dus niet filteren -- een lege `in`-clausule zou
  // nul taken opleveren en dat leest als "er is nooit iets gedaan".
  check("cross_channel geeft een lege lijst", sopTypesVanZelfdeKanaal("cross_channel").length === 0,
    sopTypesVanZelfdeKanaal("cross_channel").join(", "));

  // Een onbekende sleutel valt terug op Google, precies zoals channelOfSource dat al deed voor de
  // oudere bronnen. Dat is bewust en gedocumenteerd gedrag, geen toeval.
  check("onbekend valt terug op Google, net als channelOfSource",
    JSON.stringify(sopTypesVanZelfdeKanaal("iets_anders")) === JSON.stringify(sopTypesVanZelfdeKanaal("monthly")),
    sopTypesVanZelfdeKanaal("iets_anders").join(", "));

  // De signaalbronnen uit SI7 delen hun sleutelruimte met de sop_types (zie channel-of.ts). Een
  // Meta-signaalbron hoort dus ook bij Meta.
  check("meta_signals valt bij Meta", sopTypesVanZelfdeKanaal("meta_signals").every((t) => t.startsWith("meta_")),
    sopTypesVanZelfdeKanaal("meta_signals").join(", "));
  check("linkedin_icp valt bij LinkedIn", sopTypesVanZelfdeKanaal("linkedin_icp").every((t) => t.startsWith("linkedin_")),
    sopTypesVanZelfdeKanaal("linkedin_icp").join(", "));

  // Het vierde kanaal volgt de prefixregel, niet een handmatige sleutellijst -- precies zoals
  // meta_weekly en linkedin_biweekly ooit uit de handlijsten vielen en stil Google werden.
  check("microsoft_weekly valt bij Microsoft",
    JSON.stringify(sopTypesVanZelfdeKanaal("microsoft_weekly").sort()) ===
    JSON.stringify(["microsoft_biweekly", "microsoft_monthly", "microsoft_weekly"]),
    sopTypesVanZelfdeKanaal("microsoft_weekly").join(", "));
  check("een toekomstige microsoft_-bron valt er ook onder",
    sopTypesVanZelfdeKanaal("microsoft_iets_nieuws").every((t) => t.startsWith("microsoft_")),
    sopTypesVanZelfdeKanaal("microsoft_iets_nieuws").join(", "));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
