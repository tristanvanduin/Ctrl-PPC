"use client";

// Blokken naast elkaar binnen een sectie.
//
// Sectie() regelt het ritme TUSSEN onderwerpen; dit regelt het ritme erbinnen. Zonder dit staat
// alles onder elkaar op volle breedte, en dan leest een pagina als één kolom -- ook met zeven
// verschillende grafiekvormen erin, want vormvariatie wordt onzichtbaar zonder maatvariatie.
//
// De rekenkant staat in lib/layout/bento.ts, inclusief de reden waarom er één inpakker is en geen
// vaste sjablonen per kanaalcombinatie.
//
// ── WAAROM BLOKKEN EN GEEN CHILDREN ─────────────────────────────────────────
//
// Het zou eleganter lijken om gewone children te nemen en die van een breedte te voorzien. Maar
// dan kan de inpakker niet weten dat een blok niets gaat renderen: een component die null
// teruggeeft verdwijnt pas uit de DOM nadat de rij al verdeeld is, en dan staat het gat er alsnog.
// De aanroeper weet het wél -- die rekent de voorwaarde nu al uit -- dus die zegt het.

import type { ReactNode } from "react";
import { pakInPlat, spanKlasse, type Blok } from "@/lib/layout/bento";

export type BentoBlok = Blok & { render: () => ReactNode };

// ── WAAROM ELKE CEL EEN @container IS ───────────────────────────────────────
//
// Een blok dat binnenin `lg:grid-cols-4` gebruikt, kijkt naar de breedte van het VENSTER en niet
// naar die van zijn eigen kolom. Op een breed scherm in een smalle bentokolom perst hij dus vier
// tegels in 400 pixels. Dat is niet zichtbaar zolang alles volle breedte is -- daar vallen venster
// en kolom samen -- en het gaat stuk op het moment dat je blokken naast elkaar zet.
//
// Met @container op de cel kan een blok `@2xl:grid-cols-4` schrijven: vier kolommen zodra ER
// RUIMTE IS, ongeacht hoe groot het scherm eromheen is.

export function Bento({ blokken, className = "" }: { blokken: readonly BentoBlok[]; className?: string }) {
  const geplaatst = pakInPlat(blokken);
  if (geplaatst.length === 0) return null;

  const perId = new Map(blokken.map((b) => [b.id, b]));

  return (
    // Onder lg één kolom: naast elkaar heeft geen zin op een breedte waar een tabel al niet past.
    // De gap is 16px, gelijk aan de afstand binnen een sectie, zodat horizontaal en verticaal
    // hetzelfde ritme houden.
    //
    // `[&>div:empty]:hidden` is het vangnet. heeftInhoud is de goede weg -- daar weet de inpakker
    // het vooraf en kan hij de rij herverdelen. Maar sommige blokken beslissen pas tijdens hun
    // eigen render of ze iets te tonen hebben (VideoPerformance geeft null zonder videodata), en
    // dat kan de aanroeper niet vooraf weten. Zonder deze regel blijft daar een lege kolomruimte
    // staan waar wél een kaartrand omheen lijkt te horen. Het lost het gat niet zo netjes op als
    // heeftInhoud -- de buurman groeit niet mee -- maar het voorkomt een zichtbaar gat.
    <div className={`grid grid-cols-1 gap-4 lg:grid-cols-12 [&>div:empty]:hidden ${className}`}>
      {geplaatst.map((g) => (
        <div key={g.id} className={`@container min-w-0 ${spanKlasse(g.span)}`}>
          {perId.get(g.id)?.render()}
        </div>
      ))}
    </div>
  );
}
