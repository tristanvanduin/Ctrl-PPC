// Mag een klik een betaalde analyse starten, en wat moet de gebruiker eerst bevestigen.
//
// Eén klik op een SOP-kaart (Weekly, Bi-weekly, Monthly) startte direct een modelrun van meerdere
// stappen, zonder bevestiging, ook in een ?demo=1-sessie zonder login: de demo-blokkade stond
// standaard uit, en de server houdt een verzoek zonder sessie niet tegen zolang de
// toegangscontrole uit staat. Een misklik kost geld en overschrijft de laatste uitkomst; een open
// demo-link laat elke bezoeker dat doen.
//
// De regel: op een demo-klant alleen met een sessie (de eigenaar kan zijn demo blijven draaien als
// hij ingelogd is), en altijd eerst een bevestiging die zegt wat er gebeurt.

export interface SopStartInvoer {
  /** De klant is een demo-klant (demo-...). */
  demoKlant: boolean;
  /** /api/me bevestigde een sessie. */
  ingelogd: boolean;
  /** /api/me is nog onderweg. */
  laden: boolean;
  /** NEXT_PUBLIC_SOP_DEMO_BLOKKADE=1: ook met sessie geen run op een demo-klant. */
  blokkadeVlag: boolean;
}

export type SopStartBeleid = { mag: true } | { mag: false; reden: string };

export function sopStartBeleid({ demoKlant, ingelogd, laden, blokkadeVlag }: SopStartInvoer): SopStartBeleid {
  if (!demoKlant) return { mag: true };
  if (blokkadeVlag) return { mag: false, reden: "In demo-modus kun je geen live analyses starten: dit zou een echte, betaalde modelaanroep zijn." };
  if (laden) return { mag: false, reden: "Even wachten: de sessie wordt gecontroleerd." };
  if (!ingelogd) return { mag: false, reden: "Zonder ingelogde sessie start de demo geen live analyses: dit zou een echte, betaalde modelaanroep zijn." };
  return { mag: true };
}

/** De vraag vóór de run: wat er draait, dat het geld kost, en wat er overschreven wordt. */
export function sopBevestigVraag(label: string, kanaal: string, maand: boolean): string {
  return `${label}-analyse voor ${kanaal} starten?\n\n` +
    `Dit is een live modelrun van meerdere stappen; hij kost tokens en duurt ${maand ? "enkele minuten" : "één tot twee minuten"}. ` +
    "De uitkomst vervangt de laatste analyse van dit type.";
}

/** De vraag vóór het genereren van een maandrapport. */
export function rapportBevestigVraag(): string {
  return "Een nieuw maandrapport genereren?\n\n" +
    "Dit is een live modelaanroep over de laatste afgesloten maand; hij kost tokens en duurt ongeveer een minuut. " +
    "Er komt een concept bij dat je daarna kunt bewerken of verwijderen.";
}
