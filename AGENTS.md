<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Poorten draaien

Gebruik `scripts/gates.sh` en niet los `npx tsc` / `node scripts/run-tests.mjs` / `npm run build`.

Waarom dat uitmaakt, ook al doet het script hetzelfde:

- **Elke stap staat onder `timeout`.** Een run die blijft hangen kost geen rekentijd die iemand
  mist, maar houdt de sessie open, en elke afronding wekt de assistent met de volledige
  gespreksgeschiedenis erbij. Dat is waar het geld in gaat zitten, niet in CPU.
- **Er kan er maar een tegelijk draaien** (`flock`). Twee gelijktijdige builds schrijven in
  dezelfde `.next` en laten elkaar half af achter; dat heeft eerder een sessie gekost aan het
  najagen van een ontbrekende `required-server-files.json` die niets met de code te maken had.

Draai hem in de achtergrond en wacht op de afronding — nooit twee runs naast elkaar, en nooit
een wachttaak die zelf weer een volgende run start.
