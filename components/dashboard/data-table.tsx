"use client";

// De opmaak van een datatabel, op één plek.
//
// De tabellen in dit dashboard misten drie dingen die een tabel bruikbaar maken, en alle drie
// zijn ze functioneel — geen smaak.
//
// 1. CIJFERS DIE NIET UITLIJNEN. Van alle tabellen gebruikten er vier `tabular-nums`. Zonder
//    dat zijn cijfers proportioneel gezet: een 1 is smaller dan een 8, dus € 133.159 en
//    € 15.795 beginnen op verschillende posities en je kunt kolommen niet met je oog scannen.
//    In een tabel vol getallen is dat de grootste enkele verbetering die er is.
//
// 2. GEEN GEVOEL VOOR VERHOUDING. Zeven campagnes met bedragen van € 15.795 tot € 133.159: om
//    te zien wie het budget trekt moest je elk getal lezen en onthouden. Een fijne balk achter
//    het bedrag geeft die verhouding terug zonder een kolom te kosten.
//
// 3. GEEN TOTAAL. Een kolom bedragen zonder som laat de lezer optellen, en dat doet niemand.
//
// De cijfers blijven leidend: de streep is een hulp bij het scannen, niet de drager van de
// waarde. Hij staat ónder het getal op een baan met vaste breedte, en nooit als enige encoding.
//
// WAAR EEN AANDEELSTREEP WEL EN NIET MAG
//
// Alleen bij grootheden die optellen: kosten, conversies, klikken, vertoningen. Een streep leest
// als "aandeel van een geheel", en bij een verhouding — CPA, ROAS, CTR, conversieratio — bestaat
// dat geheel niet. Bij CPA komt er nog bij dat laag juist beter is, dus een lange streep zou
// visueel "veel" zeggen waar het "duur" betekent. Die kolommen krijgen daarom GetalCel.

import type { ReactNode } from "react";

/** De tabel plus zijn horizontale scroll. Tabellen mogen nooit de pagina laten scrollen. */
export function Tabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-body border-collapse">{children}</table>
    </div>
  );
}

export function Kop({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

/**
 * Een kolomkop. Getalkolommen staan rechts uitgelijnd, tekstkolommen links — een getalkolom die
 * links uitlijnt maakt het uitlijnen van de cijfers eronder zinloos.
 */
export function KolomKop({
  children,
  getal = false,
  breed = false,
  bijschrift,
  className = "",
}: {
  children: ReactNode;
  getal?: boolean;
  /** De identiteitskolom: krijgt de ruimte, de rest zo smal mogelijk. */
  breed?: boolean;
  /** Kleine tweede regel onder de kop, bijv. om te zeggen waar een aandeelstreep over gaat. */
  bijschrift?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${
        getal ? "text-right" : "text-left"
      } ${breed ? "w-full" : ""} ${className}`}
    >
      {children}
      {/* Een streep onder een getal die niet zegt waarvan hij het aandeel is, laat de lezer
          raden. Dat gebeurde: de eerste vraag over deze tabel was "is die streep op kosten,
          conversies of CPA?". Het bijschrift beantwoordt hem voordat hij opkomt. */}
      {bijschrift && (
        <span className="block font-normal normal-case tracking-normal text-muted-foreground/70">{bijschrift}</span>
      )}
    </th>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/60">{children}</tbody>;
}

/** Een rij met een rustige hover, zodat je met je oog een regel kunt volgen. */
export function Rij({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`transition-colors hover:bg-gray-50/80 ${className}`}>{children}</tr>;
}

/** De identiteitscel: naam links, eventueel met een tweede regel eronder. */
export function NaamCel({ children, sub, className = "" }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-middle ${className}`}>
      <div className="text-rm-gray font-medium truncate max-w-[28rem]">{children}</div>
      {sub && <div className="text-micro text-muted-foreground truncate max-w-[28rem]">{sub}</div>}
    </td>
  );
}

/**
 * Een getalcel. `tabular-nums` is hier het hele punt: gelijke cijferbreedtes laten de kolom
 * uitlijnen, zodat je hem kunt scannen in plaats van lezen.
 */
export function GetalCel({
  children,
  zacht = false,
  className = "",
}: {
  children: ReactNode;
  /** Secundaire waarde: dezelfde uitlijning, minder gewicht. */
  zacht?: boolean;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${zacht ? "text-muted-foreground" : "text-rm-gray"} ${className}`}>
      {children}
    </td>
  );
}

/**
 * Een getalcel met een fijne balk erachter die het aandeel in de kolom toont.
 *
 * De balk staat achter de tekst en niet ernaast: hij mag geen kolombreedte kosten en hij mag het
 * getal niet verdringen. Dekking laag genoeg om onder de cijfers door te lopen, hoog genoeg om
 * de verhouding in één blik te geven.
 */
export function AandeelCel({
  waarde,
  aandeel,
  kleur = "var(--brand-primary)",
  className = "",
}: {
  waarde: ReactNode;
  /** 0–1. Buiten bereik of niet-eindig wordt genegeerd; dan is het een gewone getalcel. */
  aandeel: number;
  kleur?: string;
  className?: string;
}) {
  const veilig = Number.isFinite(aandeel) ? Math.max(0, Math.min(1, aandeel)) : 0;
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${className}`}>
      <span className="text-rm-gray font-medium">{waarde}</span>
      {/* Een dunne lijn ónder het getal, op een vaste baan.
          Eerste poging was een vlak áchter het getal, maar dat leest als een markering: de
          koploper kreeg een balk over de volle celbreedte en zag eruit als "geselecteerd",
          terwijl de kleinste een sliver naast zijn cijfers kreeg. Een baan met een vaste
          breedte leest ondubbelzinnig als schaal, en raakt de cijfers niet. */}
      <span className="mt-1 block ml-auto h-[3px] rounded-full overflow-hidden" style={{ width: 72, background: "rgba(15,23,42,0.07)" }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${veilig * 100}%`, background: kleur, opacity: 0.75 }} />
      </span>
    </td>
  );
}

/** De totaalrij: bovenrand dikker, vet, en altijd op dezelfde uitlijning als de kolom erboven. */
export function TotaalRij({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr className="border-t-2 border-border bg-gray-50/70 font-semibold text-rm-gray">{children}</tr>
    </tfoot>
  );
}

export function TotaalCel({ children, getal = false }: { children: ReactNode; getal?: boolean }) {
  return (
    <td className={`px-3 py-2.5 ${getal ? "text-right tabular-nums" : "text-left"} whitespace-nowrap`}>{children}</td>
  );
}
