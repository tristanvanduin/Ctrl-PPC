"use client";

// De opmaak van een datatabel, op één plek.
//
// De tabellen in dit dashboard misten drie dingen die een tabel bruikbaar maken, en alle drie
// zijn ze functioneel — geen smaak.
//
// 1. CIJFERS DIE NIET UITLIJNEN. Rechts uitlijnen plus `whitespace-nowrap`: zo staan de eenheden
//    onder de eenheden en breekt € 133.159 niet af.
//
//    Hier stond dat cijfers proportioneel gezet zijn en een 1 smaller is dan een 8. Nagemeten in
//    de browser met het echte, geladen lettertype: Ubuntu zet alle tien de cijfers op 6,77px bij
//    12px — spreiding 0. Voor dít lettertype voegt `tabular-nums` dus niets toe, en die regel was
//    een aanname die ik nooit had gecontroleerd.
//
//    De klasse blijft staan, maar om een andere en kleinere reden: hij dekt de fallback af. Vóórdat
//    het webfont binnen is (en als het niet binnenkomt) rendert de tabel in een systeemlettertype,
//    en die hebben lang niet allemaal cijfers van gelijke breedte. Goedkope verzekering, geen
//    hoofdzaak — en dat scheelde het klakkeloos toevoegen van de klasse in tientallen kolommen
//    elders, want daar zou het niets hebben opgelost.
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
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

// ── Het ritme van een tabelcel ─────────────────────────────────────────────
//
// Dertien schermen gebruiken de componenten hieronder; vijf tabellen hebben eigen markup. Die
// vijf hadden elk hun eigen maat: gemeten py-1.5, py-2, py-2.5 voor de cellen en px-2, px-3, px-4
// voor de goot. Vier verschillende regelhoogtes dus, en daardoor voelt elk scherm net anders —
// wat je als gebruiker niet als "een andere padding" ziet maar als "dit hoort niet bij elkaar".
//
// De maat staat daarom hier, geëxporteerd, en de losse tabellen gebruiken hem. Wie een nieuwe
// tabel bouwt zonder deze componenten heeft nog steeds één plek om het ritme vandaan te halen.
//
// De kop is iets hoger dan de cel: hij draagt kleine hoofdletters met letterspatiëring en heeft
// die lucht nodig om niet op de eerste rij te plakken.

/** De opvulling van een kolomkop. */
export const TABEL_KOP = "px-3 py-2.5";
/** De opvulling van een gewone cel. */
export const TABEL_CEL = "px-3 py-2";

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
  /**
   * De identiteitskolom slokt alle overgebleven breedte op, zodat de getallen zo compact mogelijk
   * naast elkaar staan.
   *
   * Alleen zetten als die kolom lange vrije tekst draagt — een campagnenaam, een placement, een
   * zoekterm. Bij korte labels (een netwerk, een segment, een land) levert het een gat van meer
   * dan duizend pixels tussen de naam en het eerste getal op, en moet je oog de hele breedte over
   * om een regel te volgen. Zonder `breed` verdeelt de browser de overruimte over alle kolommen
   * en staan ze rustig gespreid.
   */
  breed?: boolean;
  /** Kleine tweede regel onder de kop, bijv. om te zeggen waar een aandeelstreep over gaat. */
  bijschrift?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`${TABEL_KOP} text-micro font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${
        getal ? "text-right" : "text-left"
      } ${breed ? "w-full" : ""} ${className}`}
    >
      {children}
      {/* Een streep onder een getal die niet zegt waarvan hij het aandeel is, laat de lezer
          raden. Dat gebeurde: de eerste vraag over deze tabel was "is die streep op kosten,
          conversies of CPA?". Het bijschrift beantwoordt hem voordat hij opkomt. */}
      {bijschrift && (
        <span className="block font-normal normal-case tracking-normal text-muted-foreground">{bijschrift}</span>
      )}
    </th>
  );
}

/**
 * Een kolomkop waarop je kunt sorteren.
 *
 * Drie dingen die de losse varianten in dit dashboard misten en die geen smaak zijn:
 *
 * - Het is een `button`. Een `onClick` op een `th` is voor een muis een knop en voor een toetsenbord
 *   niets: geen focus, geen Enter, geen aankondiging dat er iets te kiezen valt.
 * - `aria-sort` op de cel. Zonder dat weet een schermlezer niet waarop de tabel gesorteerd staat —
 *   het pijltje is dan de enige drager van die informatie, en dat is puur visueel.
 * - Bij een getalkolom staat de pijl links van het label, zodat het label tegen de rechterrand
 *   blijft staan waar de cijfers eronder ook staan. Anders schuift de kop een pijlbreedte op zodra
 *   je hem aanklikt.
 */
export function SorteerKop({
  children,
  getal = false,
  breed = false,
  bijschrift,
  actief = false,
  richting = "desc",
  onSorteer,
}: {
  children: ReactNode;
  getal?: boolean;
  breed?: boolean;
  bijschrift?: ReactNode;
  actief?: boolean;
  richting?: "asc" | "desc";
  onSorteer: () => void;
}) {
  const Pijl = !actief ? ArrowUpDown : richting === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={actief ? (richting === "asc" ? "ascending" : "descending") : "none"}
      className={`${TABEL_KOP} text-micro font-semibold uppercase tracking-wider whitespace-nowrap ${
        getal ? "text-right" : "text-left"
      } ${breed ? "w-full" : ""}`}
    >
      {/* De typografie staat ook op de knop en niet alleen op de cel: de browserreset zet
          `text-transform: none` en een eigen lettergrootte op button, en dan staat de ene kolomkop
          in kapitalen en de sorteerbare ernaast niet. */}
      <button
        type="button"
        onClick={onSorteer}
        className={`inline-flex items-center gap-1 rounded-sm text-micro font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
          getal ? "flex-row-reverse" : ""
        } ${actief ? "text-brand-blue-ink" : "text-muted-foreground hover:text-brand-blue-ink"}`}
      >
        {children}
        <Pijl className={`w-3 h-3 shrink-0 ${actief ? "" : "opacity-30"}`} aria-hidden />
      </button>
      {bijschrift && (
        <span className="block font-normal normal-case tracking-normal text-muted-foreground">{bijschrift}</span>
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
    <td className={`${TABEL_CEL} align-middle ${className}`}>
      {/* De naam wordt afgekapt: hij is een aanduiding, en een campagnenaam van honderd tekens
          duwt alle getallen uit beeld. */}
      <div className="text-brand-gray font-medium truncate max-w-[28rem]">{children}</div>
      {/* De tweede regel niet. Daar staat de reden — "kostte € 340 over 720 klikken zonder één
          conversie" — en die werd afgekapt tot "Klikken in apps zijn vaak onbe…". Een afgekapte
          naam kun je nog herkennen; een afgekapte verklaring is weg. */}
      {sub && <div className="text-micro text-muted-foreground max-w-[28rem]">{sub}</div>}
    </td>
  );
}

/**
 * De kop van een RIJ, voor een matrix.
 *
 * In een gewone lijst is de eerste cel een naam (NaamCel, een `td`) en is de kolomkop genoeg om
 * te weten wat een cel betekent. In een kruistabel niet: daar wordt een cel pas begrijpelijk uit
 * de combinatie van zijn kolom én zijn rij. `scope="row"` is wat een schermlezer die rij laat
 * meelezen bij elke cel; zonder dat hoor je bij "€ 1.240" niet meer welk land dat was.
 *
 * Daarom bestaat dit naast NaamCel en is het geen dubbeling: het is een ander HTML-element met
 * een andere betekenis, niet dezelfde cel in een ander jasje.
 */
export function RijKop({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th scope="row" className={`${TABEL_CEL} text-left align-middle font-medium text-brand-gray whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

/** Een gewone cel voor tekst die geen getal en geen identiteit is: een type, een label, een advies. */
export function Cel({
  children,
  zacht = false,
  nowrap = false,
  colSpan,
  className = "",
}: {
  children: ReactNode;
  zacht?: boolean;
  /** Korte labels ("Mobiele app", "YouTube-kanaal") mogen niet over twee regels breken. */
  nowrap?: boolean;
  /**
   * Over meerdere kolommen. Vrijwel altijd voor een lege staat: één regel "niets gevonden" die
   * over de hele breedte loopt in plaats van in de eerste kolom te hangen met vier lege cellen
   * ernaast.
   */
  colSpan?: number;
  className?: string;
}) {
  return (
    <td colSpan={colSpan} className={`${TABEL_CEL} align-middle ${zacht ? "text-muted-foreground" : "text-brand-gray"} ${nowrap ? "whitespace-nowrap" : ""} ${className}`}>
      {children}
    </td>
  );
}

/**
 * Een getalcel: rechts uitgelijnd en niet afbrekend, zodat de eenheden onder elkaar staan en de
 * kolom te scannen is in plaats van te lezen.
 *
 * `tabular-nums` staat erbij voor de fallback, niet voor het huislettertype — Ubuntu zet zijn
 * cijfers al even breed. Zie de toelichting bovenaan dit bestand.
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
    <td className={`${TABEL_CEL} text-right tabular-nums whitespace-nowrap ${zacht ? "text-muted-foreground" : "text-brand-gray"} ${className}`}>
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
  // Mét terugvalwaarde, zoals overal elders in deze codebase (zie globals.css). Zonder de
  // terugval is `background: var(--brand-primary)` een ongeldige waarde zolang de merkkleur nog
  // niet geladen is, en valt de achtergrond terug op transparant: dan staat er een lege grijze
  // baan naast het getal. Dat is niet zichtbaar in de code en niet in de types — alleen in de
  // schermafdruk. Op de beurs-gescopete pagina bleef die kleur in demo-modus zelfs helemaal uit.
  kleur = "var(--brand-primary, #4f46e5)",
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
    <td className={`${TABEL_CEL} text-right tabular-nums whitespace-nowrap ${className}`}>
      <span className="text-brand-gray font-medium">{waarde}</span>
      {/* Een dunne lijn ónder het getal, op een vaste baan.
          Eerste poging was een vlak áchter het getal, maar dat leest als een markering: de
          koploper kreeg een balk over de volle celbreedte en zag eruit als "geselecteerd",
          terwijl de kleinste een sliver naast zijn cijfers kreeg. Een baan met een vaste
          breedte leest ondubbelzinnig als schaal, en raakt de cijfers niet. */}
      {/* De gradient uit de premium-referentie, een kwartslag gedraaid.
          Daar stond `linear-gradient(90deg, …)`: het verloop liep langs de lengte van de streep —
          precies de as die de waarde draagt. Dan heeft een streep van 34% een andere eindkleur dan
          een van 80%, en leest de kleur als een tweede grootheid die er niet is; een korte streep
          laat bovendien alleen het eerste stuk van de trap zien. Loodrecht op de lengte speelt dat
          niet: elke streep heeft dezelfde kleurovergang van boven naar beneden, ongeacht hoe lang
          hij is. Zo blijft de lengte het enige wat meet, en krijgt het vlak toch diepte. */}
      <span className="mt-1 block ml-auto h-[3px] rounded-full overflow-hidden" style={{ width: 72, background: "var(--spoor, rgba(15,23,42,0.07))" }} aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${veilig * 100}%`, backgroundImage: `linear-gradient(to bottom, ${kleur}, color-mix(in srgb, ${kleur} 72%, transparent))` }}
        />
      </span>
    </td>
  );
}

/**
 * De voet van de tabel. Eén rij is het gewone geval; wie er meer nodig heeft — een totaal, en
 * daaronder een jaarprognose met een bandbreedte — geeft `rijen` mee en levert de `<tr>`'s zelf.
 * De prognosetabel deed dat al met de hand en paste daardoor niet op deze laag.
 */
export function TotaalVoet({ children }: { children: ReactNode }) {
  return <tfoot>{children}</tfoot>;
}

/** Een extra regel onder de totaalrij: rustiger, voor een afgeleide of een toelichting. */
export function VoetRij({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

/** De totaalrij: bovenrand dikker, vet, en altijd op dezelfde uitlijning als de kolom erboven. */
export function TotaalRij({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr className="border-t-2 border-border bg-gray-50/70 font-semibold text-brand-gray">{children}</tr>
    </tfoot>
  );
}

export function TotaalCel({
  children,
  getal = false,
  colSpan,
  className = "",
}: {
  children: ReactNode;
  getal?: boolean;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td colSpan={colSpan} className={`${TABEL_KOP} ${getal ? "text-right tabular-nums" : "text-left"} whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}
