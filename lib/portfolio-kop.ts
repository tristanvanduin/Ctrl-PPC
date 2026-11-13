// De kopregel van het Portfolio: wat er gemeten is, en over welk kanaal.
//
// Het bord leest per klant de Google Ads-routes en zei dat nergens: GreenTech stond er met 1.277
// conversies en CPA € 109 waar het Overzicht over alle kanalen 3.416 en € 57 zegt. En "alles op
// schema" betekende alleen "geen klant meer dan 10% onder vorig jaar": er werd geen doel getoetst,
// terwijl dezelfde klant op Doelen & voortgang op rood stond. Zolang er geen doel getoetst wordt,
// zegt de regel wat er wél gemeten is.

export const PORTFOLIO_BEREIK = "alleen Google Ads";

/** Klanten met conversies meer dan dit percentage onder vorig jaar vragen aandacht. */
export const AANDACHT_YOY_PCT = -10;

export function portfolioKopregel(inv: {
  actief: number;
  groeiend: number;
  aandacht: number;
  /** Of er per klant een doel getoetst is (prognose tegen jaardoel). Nu nooit: het bord kent geen doel. */
  doelGetoetst: boolean;
}): string {
  const delen = [`${inv.actief} actieve ${inv.actief === 1 ? "klant" : "klanten"}`, `${inv.groeiend} groeiend`];
  if (inv.aandacht > 0) delen.push(`${inv.aandacht} ${inv.aandacht === 1 ? "vraagt" : "vragen"} aandacht`);
  else if (inv.doelGetoetst) delen.push("alles op schema");
  else delen.push(`geen klant meer dan ${Math.abs(AANDACHT_YOY_PCT)}% onder vorig jaar`);
  return `${delen.join(" · ")} (${PORTFOLIO_BEREIK})`;
}

export type StipKleur = "grijs" | "groen" | "oranje" | "rood";

/** De uitleg naast de stip, uit dezelfde drempels als gezondheidStip hieronder. */
export const STIP_LEGENDA =
  `Groen: conversies meer dan 10% boven vorig jaar en ROAS minstens 2. ` +
  `Rood: meer dan ${Math.abs(AANDACHT_YOY_PCT)}% onder vorig jaar. ` +
  `Oranje: al het andere, ook groei boven 10% met een ROAS onder 2 (een klant zonder omzet wordt dus nooit groen). ` +
  `Alleen Google Ads, geen doel getoetst.`;

/**
 * De kleur van de gezondheidsstip. Hier en niet in de cel: de legenda zei "Oranje: tussen -10% en
 * +10%", terwijl de cel ook +30% met een ROAS onder 2 oranje kleurde. Kleur en uitleg staan nu in
 * één bestand, en lib/__portfolio_kop_test.ts houdt ze gelijk.
 */
export function gezondheidStip(heeftData: boolean, convChangePct: number | null | undefined, roas: number): StipKleur {
  if (!heeftData) return "grijs";
  const groei = convChangePct ?? 0;
  if (groei > 10 && roas >= 2) return "groen";
  if (groei > AANDACHT_YOY_PCT) return "oranje";
  return "rood";
}
