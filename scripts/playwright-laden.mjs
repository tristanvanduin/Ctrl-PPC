// Laadt playwright-core voor de browsercontroles (rookproef, cijfercontrole).
//
// Eerst vanuit de map waarin je het script draait: daar staat het in node_modules als de repo
// geinstalleerd is, op elke machine. Pas daarna het vaste pad van de ontwikkelmachine, en anders een
// melding die zegt wat er mist. Een eerdere versie laadde alleen via het vaste pad, en buiten die
// machine faalde het script dan met een stacktrace en exit 1, wat leest als een kapotte pagina.

import { createRequire } from "node:module";
import { join } from "node:path";

export function laadPlaywright() {
  const ankers = [
    process.env.PLAYWRIGHT_ANKER,
    join(process.cwd(), "package.json"),
    "/home/user/Ctrl-PPC/package.json",
  ].filter(Boolean);
  for (const anker of ankers) {
    try {
      return createRequire(anker)("playwright-core");
    } catch {
      // volgende anker
    }
  }
  console.error("playwright-core is niet te vinden (gezocht vanuit: " + ankers.join(", ") + ").");
  console.error("Draai het script vanuit de repo na npm install, of zet PLAYWRIGHT_ANKER op een package.json die het wel heeft.");
  // 2: verkeerd aangeroepen of niet ingericht. Geen 1, want er is niets aan de pagina's afgekeurd.
  process.exit(2);
}
