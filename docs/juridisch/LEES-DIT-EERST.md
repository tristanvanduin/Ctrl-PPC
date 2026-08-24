# De brontekst staat hier, de pagina rendert uit code

De twee documenten in deze map zijn de tekst die wordt nagelezen en aangepast:

* `privacy-statement.md` — Privacy Statement
* `algemene-voorwaarden.md` — Algemene Voorwaarden

Ze staan sinds 24 augustus 2026 ook als publieke pagina op de marketingsite, op `/privacy` en
`/terms`. Die pagina's lezen deze markdown **niet** in: de tekst staat een tweede keer, als
gestructureerde data, in `lib/legal/documenten.ts`. Dat is een bewuste afweging (geen
markdown-parser plus sanitizer in de marketingbundel voor twee pagina's), maar het betekent wel:

> **Wijzig je hier een zin, wijzig hem dan ook in `lib/legal/documenten.ts`.**
> Twee versies van een juridisch document die uit elkaar lopen is precies het probleem dat je
> nooit wilt hebben op het moment dat iemand zich erop beroept.

## De vierkante haken

Beide documenten stonden vol met placeholders: `[KVK-NUMMER]`, `[BETALINGSTERMIJN, bijv. 14]`,
`[ARRONDISSEMENT]`. Op de pagina zijn dat geen vaste teksten meer maar velden in
**`lib/legal/bedrijfsgegevens.ts`**. Vul ze daar in — één keer, en de pagina's regelen de rest:

* zolang er nog een verplicht veld leeg is, draagt de pagina een zichtbare conceptmelding, staat
  hij op `noindex` en houdt `app/sitemap.ts` hem eruit;
* zodra alles gevuld is, verdwijnt de melding, wordt de pagina indexeerbaar en verschijnt hij in
  de sitemap. Er is verder niets aan te zetten.

De HTML-bestanden in deze map (`*.html`) zijn de opgemaakte leesversies van vóór die pagina's
bestonden. Ze worden nergens door de app gebruikt.

## Wat er nog niet is

De verwerkersovereenkomst waar beide documenten naar verwijzen (Privacy Statement §1, Algemene
Voorwaarden art. 10 lid 1) bestaat nog niet als tekst. Dat is een bijlage bij het contract en geen
websitepagina, dus hij blokkeert de pagina's niet — maar zolang hij ontbreekt verwijzen beide
documenten naar een stuk dat er niet is.
