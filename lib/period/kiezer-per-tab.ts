// Op welk tabblad de periodekiezer iets doet, en wat er anders staat.
//
// De kiezer stond boven elk tabblad. Bij 12 naar 3 maanden veranderden op Campagnes (op de
// kanaaltotalen na), Prognose, Analyseren, Bevindingen, Sprint en Doelen precies twee regels: het
// label van de kiezer zelf en de vergelijkregel. Een kiezer die niets doet, leest als een kiezer
// waarvan de keuze al verwerkt is. Nu staat hij alleen waar een blok hem volgt; op de andere
// tabbladen staat in zijn plaats welk venster dat tabblad heeft.

export type KiezerOpTab = { toon: true } | { toon: false; uitleg: string };

const UITLEG: Record<string, string> = {
  forecast: "Prognose gaat over het kalenderjaar en volgt de periodekiezer niet.",
  dgm: "Doelen & voortgang gaat over het kalenderjaar en volgt de periodekiezer niet.",
  insights: "Bevindingen tonen de laatste analyses; elke analyse noemt haar eigen periode.",
  outcomes: "Uitkomsten volgen de periodekiezer niet.",
  sprint: "De sprint volgt de periodekiezer niet.",
  reporting: "Een rapport gaat over de laatste afgesloten maand en volgt de periodekiezer niet.",
  godview: "Dit tabblad volgt de periodekiezer niet.",
  "second-opinion": "Second opinion volgt de periodekiezer niet.",
  files: "Bestanden volgen de periodekiezer niet.",
  settings: "Instellingen volgen de periodekiezer niet.",
};

/**
 * Het Overzicht volgt de kiezer altijd. Campagnes alleen in de nieuwe weergave (de tabel
 * Kanaaltotalen); de campagnetabellen daar noemen hun eigen vaste venster.
 */
export function kiezerOpTab(tab: string, nieuweWeergave: boolean): KiezerOpTab {
  if (tab === "dashboard") return { toon: true };
  if (tab === "campaigns" && nieuweWeergave) return { toon: true };
  if (tab === "campaigns") return { toon: false, uitleg: "De campagnetabellen hebben een eigen venster en volgen de periodekiezer niet; elk blok noemt het zijne." };
  return { toon: false, uitleg: UITLEG[tab] ?? "Dit tabblad volgt de periodekiezer niet." };
}
