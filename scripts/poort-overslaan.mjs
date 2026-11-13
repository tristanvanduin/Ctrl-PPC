// Hoe een poort zegt dat hij NIET gedraaid heeft.
//
// WAAROM DIT BESTAAT. De vier databasepoorten (rpc-rechten, view-dekking, bureaugrens,
// rls-scheiding) eindigden zonder sleutels met exitcode 0, en scripts/gates.sh schreef daarna
// "POORTEN GROEN". Groen zei dus niet of de scheiding tussen bureaus getoetst was: de poort die
// datalekken tussen bureaus moet vangen viel juist weg als de auth-kant haperde, en niemand zag het
// verschil met een geslaagde run.
//
// Overslaan blijft toegestaan (in CI of bij frontendwerk zijn er geen sleutels, en een poort die
// daar rood wordt leert mensen poorten te negeren), maar het heeft nu een eigen uitgang: code 3.
// gates.sh telt die apart, noemt de poort bij naam in de slotregel, en eindigt dan niet op groen.

/** De exitcode voor "niet gedraaid". Niet 0 (dat is geslaagd) en niet 1 (dat is een fout gevonden). */
export const OVERGESLAGEN = 3;

/** Meldt hardop dat de poort niet draaide, en waarom, en stopt met OVERGESLAGEN. */
export function slaOver(naam, reden) {
  console.log(`${naam}: OVERGESLAGEN (${reden}). Niet gedraaid is niet geslaagd.`);
  process.exit(OVERGESLAGEN);
}

/**
 * Om binnen een try te gooien waar opruimwerk in de finally staat. process.exit slaat die finally
 * over: zo bleef bij een mislukte login een proefgebruiker met een echte rol in de database staan.
 * Gooi dit, laat de finally lopen, en roep daarna slaOver aan.
 */
export class Overslaan extends Error {
  constructor(reden) {
    super(reden);
    this.reden = reden;
  }
}
