"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// Inklappen, op één plek.
//
// De dashboardpagina stapelt twaalf blokken onder elkaar, elk met een volledige tabel eronder.
// Wie de kaart wil zien scrolt langs vijftig landregels; wie de donut wil zien langs de tabel
// die eronder hoort. Dat is niet op te lossen door dingen weg te halen — de cijfers moeten er
// zijn — maar wel door ze dicht te laten beginnen.
//
// Twee vormen, bewust gescheiden:
//
// 1. Een heel blok dat dicht kan (CollapsiblePanel). Het onthoudt de keuze per gebruiker, want
//    een paneel dat bij elke navigatie weer openklapt is geen keuze maar een obstakel.
//
// 2. Een lijst die kort begint (useTruncatedList + MeerKnop). Hier gaat het niet om het blok
//    maar om de rijen: de eerste drie zijn het verhaal, de rest is naslag.

const OPSLAG_PREFIX = "paneel-open:";

function leesOpgeslagen(id: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(OPSLAG_PREFIX + id);
    return v === null ? null : v === "1";
  } catch {
    // Privémodus of geblokkeerde opslag: dan onthouden we het gewoon niet.
    return null;
  }
}

function schrijfOpgeslagen(id: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPSLAG_PREFIX + id, open ? "1" : "0");
  } catch {
    /* niets te doen; het paneel werkt ook zonder geheugen */
  }
}

export function CollapsiblePanel({
  id,
  title,
  subtitle,
  icon,
  meta,
  defaultOpen = true,
  naadloos = false,
  standVanNu = false,
  children,
}: {
  /** Stabiele sleutel voor het onthouden van open/dicht. Verander hem niet zonder reden. */
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Korte samenvatting die óók zichtbaar blijft als het paneel dicht is — anders is dichtklappen informatieverlies. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Dit paneel gaat over geen enkel venster (de koppeling, de uitleg van een tabblad): zie
   *  STAND_VAN_NU in components/ui/vensterlabel.tsx. */
  standVanNu?: boolean;
  /**
   * Zonder eigen kaartrand, voor een paneel dat ín een andere kaart staat.
   *
   * Een paneel met rand, hoeken en schaduw binnen een kaart die datzelfde al heeft, geeft een
   * kaart-in-een-kaart: twee randen op drie pixels van elkaar. Naadloos houdt alleen de scheiding
   * bovenaan, zodat het als een volgend blok van dezelfde kaart leest.
   */
  naadloos?: boolean;
}) {
  // Server en eerste client-render moeten hetzelfde opleveren, dus de opgeslagen keuze wordt
  // pas ná het monteren toegepast. Zou dat in de initializer staan, dan hydrateert React op een
  // andere boom dan de server stuurde.
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const opgeslagen = leesOpgeslagen(id);
    if (opgeslagen !== null) setOpen(opgeslagen);
  }, [id]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      schrijfOpgeslagen(id, !v);
      return !v;
    });
  }, [id]);

  const paneelId = `paneel-${id}`;

  return (
    // data-paneel: de meting (scripts/meet-overzicht.mjs) ziet zo dat een dicht paneel geen cijfers
    // toont, en telt het dan niet als een blok dat bij een periodewissel had moeten veranderen.
    <div data-paneel={open ? "open" : "dicht"} data-venster={standVanNu ? "stand" : undefined} className={naadloos ? "border-t border-border" : "bg-card rounded-xl border border-border shadow-sm overflow-hidden"}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        // Alleen een verwijzing als het paneel er staat: dicht wordt het niet gerenderd, en een
        // aria-controls naar een id dat niet bestaat is een dood spoor (dezelfde regel als Lade).
        aria-controls={open ? paneelId : undefined}
        className="w-full px-5 py-3 flex items-center gap-2 text-left hover:bg-gray-50/70 transition-colors"
      >
        {icon}
        <h3 className="text-title font-semibold text-brand-gray">{title}</h3>
        {subtitle && <span className="text-meta text-muted-foreground">{subtitle}</span>}
        <span className="ml-auto flex items-center gap-2">
          {meta}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div id={paneelId} className="border-t border-border">{children}</div>}
    </div>
  );
}

/**
 * Open/dicht dat onthouden wordt, zonder de paneel-chrome eromheen. Voor een deel ván een kaart
 * — de tabel onder een kaartje of een donut — waar de kop al bestaat en zijn eigen knoppen heeft.
 */
export function useRememberedOpen(id: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const opgeslagen = leesOpgeslagen(id);
    if (opgeslagen !== null) setOpen(opgeslagen);
  }, [id]);
  const toggle = useCallback(() => {
    setOpen((v) => {
      schrijfOpgeslagen(id, !v);
      return !v;
    });
  }, [id]);
  return [open, toggle];
}

/** De balk waarmee zo'n deel open- en dichtgaat. Volle breedte, onderaan het blok erboven. */
export function RegioToggle({
  open,
  onToggle,
  label,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  /** Wat er achter zit, inclusief aantal: "tabel per land (12)". */
  label: string;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="w-full px-5 py-2.5 text-meta font-medium text-brand-blue-ink hover:bg-gray-50 border-t border-border flex items-center justify-center gap-1.5 transition-colors"
    >
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      {open ? `Verberg ${label}` : `Toon ${label}`}
    </button>
  );
}

export interface TruncatedList<T> {
  /** De rijen die nu getoond worden. */
  zichtbaar: T[];
  /** Hoeveel er nog achter de knop zitten; 0 als alles zichtbaar is. */
  verborgen: number;
  uitgeklapt: boolean;
  toggle: () => void;
}

/**
 * Een lijst die kort begint. Zijn er niet meer rijen dan de limiet, dan gedraagt dit zich als
 * een gewone lijst: `verborgen` is 0 en de knop hoort niet getoond te worden.
 */
export function useTruncatedList<T>(items: T[], limiet: number): TruncatedList<T> {
  const [uitgeklapt, setUitgeklapt] = useState(false);
  const toggle = useCallback(() => setUitgeklapt((v) => !v), []);
  const zichtbaar = uitgeklapt ? items : items.slice(0, limiet);
  return { zichtbaar, verborgen: Math.max(0, items.length - limiet), uitgeklapt, toggle };
}

/**
 * De knop onder een ingekorte lijst. Noemt het aantal, want "Meer tonen" zonder getal laat je
 * klikken om erachter te komen of het de moeite is.
 */
export function MeerKnop({
  verborgen,
  uitgeklapt,
  onToggle,
  eenheid = "regels",
  ruim = false,
}: {
  verborgen: number;
  uitgeklapt: boolean;
  onToggle: () => void;
  eenheid?: string;
  /** Een tikvlak van minstens 44 px, voor een knop die op een telefoon bovenaan de pagina staat. */
  ruim?: boolean;
}) {
  if (verborgen === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${ruim ? "min-h-11 " : ""}w-full px-5 py-2.5 text-meta font-medium text-brand-blue-ink hover:bg-gray-50 border-t border-border flex items-center justify-center gap-1.5 transition-colors`}
    >
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${uitgeklapt ? "rotate-180" : ""}`} />
      {uitgeklapt ? "Toon minder" : `Toon ${verborgen} ${eenheid} meer`}
    </button>
  );
}

/**
 * "Toon meer" onder een lijst die op een telefoon korter begint dan daarboven (het logboek, de
 * ranglijst naast de wereldkaart): onder lg staan er `smal` regels, vanaf lg `breed`. De regels
 * tussen die twee staan er wel (in de boom, verborgen onder lg met `max-lg:hidden` bij de
 * aanroeper), zodat het aantal achter de knop per breedte klopt zonder te meten. Twee teksten in
 * één knop, elk op zijn eigen breedte, en geen knop op een breedte waar niets verborgen is. Een
 * knop met aria-expanded, een tikvlak van 44 px, en een pijl die niet draait bij "minder beweging".
 */
export function MeerKnopPerBreedte({ totaal, smal, breed, uitgeklapt, onToggle, eenheid = "regels" }: {
  totaal: number;
  smal: number;
  breed: number;
  uitgeklapt: boolean;
  onToggle: () => void;
  eenheid?: string;
}) {
  const verborgenSmal = Math.max(0, totaal - smal);
  const verborgenBreed = Math.max(0, totaal - breed);
  if (verborgenSmal === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={uitgeklapt}
      className={`${verborgenBreed === 0 ? "lg:hidden " : ""}flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2.5 text-meta font-medium text-brand-blue-ink transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue`}
    >
      <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${uitgeklapt ? "rotate-180" : ""}`} aria-hidden />
      {uitgeklapt ? "Toon minder" : (
        <>
          <span className="lg:hidden">Toon {verborgenSmal} {eenheid} meer</span>
          {verborgenBreed > 0 && <span className="hidden lg:inline">Toon {verborgenBreed} {eenheid} meer</span>}
        </>
      )}
    </button>
  );
}

/**
 * Een lade: een knop die een deel van een kaart opent, met de stand per gebruiker onthouden.
 *
 * Waarom naast RegioToggle. Die schrijft zelf "Toon …" en "Verberg …" om zijn label en laat de
 * inhoud aan de aanroeper, die hem met `hidden` in de boom houdt. De lades van het Overzicht in de
 * nieuwe weergave (bouwplan fase 5) hebben een eigen naam ("Verloop en prognose", "Toon als
 * tabel", "Toon onderbouwing") en inhoud die rekenwerk kost: een grafiek, een tabel van veertig
 * regels. Die wordt hier pas gerenderd als de lade open is; dicht staat er alleen de knop.
 *
 * Een echte knop met aria-expanded, dus bedienbaar met Tab, Enter en de spatiebalk. De knop wijst
 * met aria-controls alleen naar de inhoud als die er staat: een verwijzing naar een id dat niet
 * bestaat is voor een schermlezer een dood spoor.
 */
export function Lade({
  id,
  label,
  labelOpen,
  defaultOpen = false,
  rand = true,
  heelBlok = false,
  children,
}: {
  /** Stabiele sleutel voor het onthouden van open of dicht. */
  id: string;
  /** De tekst op de knop als de lade dicht is. */
  label: string;
  /** De tekst als hij open is; zonder deze blijft het label staan en zegt de pijl de stand. */
  labelOpen?: string;
  defaultOpen?: boolean;
  /** De scheidingslijn boven de knop, voor een lade in de voet van een kaart. */
  rand?: boolean;
  /**
   * Deze lade IS de inhoud van zijn kaart: dicht staat er alleen een kop en deze knop. De meting
   * leest dat af (data-heel-blok) en telt zo'n dichte kaart niet als een blok dat bij een
   * periodewissel had moeten veranderen. Niet zetten bij een lade onder een kaart die zelf cijfers
   * toont ("Verloop en prognose"): die kaart hoort wel te bewegen.
   */
  heelBlok?: boolean;
  /** De inhoud, of een functie die hem maakt: die wordt pas aangeroepen als de lade open is, zodat
   *  rekenwerk in de aanroeper (totalen, een lange tabel) dicht niets kost. */
  children: React.ReactNode | (() => React.ReactNode);
}) {
  const [open, toggle] = useRememberedOpen(id, defaultOpen);
  const inhoudId = `lade-${id}`;
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? inhoudId : undefined}
        data-heel-blok={heelBlok ? (open ? "open" : "dicht") : undefined}
        className={`flex min-h-11 w-full items-center justify-center gap-1.5 px-5 py-2.5 text-meta font-medium text-brand-blue-ink transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${rand ? "border-t border-border" : ""}`}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {open ? labelOpen ?? label : label}
      </button>
      {open && <div id={inhoudId} className="border-t border-border">{typeof children === "function" ? children() : children}</div>}
    </>
  );
}

/**
 * Een deel van een kaart achter een knop, met het oordeel en het belangrijkste getal ERBOVEN in de
 * kaart zelf (het Overzicht in de nieuwe weergave, de hoogte van de pagina).
 *
 * WAAROM NAAST LADE. Lade rendert dicht niets, en dat is goed voor een grafiek of een tabel van
 * veertig regels. Dit is voor het detail van een blok waarvan de samenvatting open staat: de
 * tempo's onder de pacingringen, de factoren onder een health-score, de weekstrook van de beurs.
 * Dat detail blijft IN de pagina, alleen met `hidden`: een merkteken (data-cijfer) of een cijfer
 * dat een controle of een schermlezer zoekt, verdwijnt niet uit de boom omdat iemand een knop
 * niet indrukte. Zoeken in de pagina (Ctrl+F) vindt het ook dicht niet; daarom zegt het label
 * altijd wat erachter zit.
 *
 * WAT AFWIJKT, STAAT OPEN. `afwijkend` (een rode score, een pacing die sterk achterloopt, een week
 * onder verwachting) opent het deel, ook als de kijker het eerder dichtklapte toen er niets aan de
 * hand was. Alleen de keuze bij een gewone stand wordt bewaard (localStorage, onder `<id>`). Een
 * afwijkend deel dat de kijker zelf dichtklapt, blijft dat alleen zolang dit onderdeel in beeld is:
 * die keuze staat in het geheugen en niet in de opslag. Een bewaarde "dicht bij een afwijking"
 * gold eerst voor elke klant en elke latere afwijking, ook in een volgende sessie, en dan stond de
 * volgende rode score van een andere klant dicht omdat iemand weken eerder één keer klikte.
 *
 * Een echte knop met aria-expanded en aria-controls (het deel staat er altijd, dus de verwijzing is
 * nooit een dood spoor), een tikvlak van 44 px, en bedienbaar met Tab, Enter en de spatiebalk. De
 * pijl draait mee, behalve bij "minder beweging".
 */
/** Onder welke sleutel een Uitklap zijn keuze bewaart; null bij een afwijking (zie Uitklap). */
export function uitklapOpslagSleutel(id: string, afwijkend: boolean): string | null {
  return afwijkend ? null : id;
}

export function Uitklap({
  id,
  label,
  labelOpen,
  afwijkend = false,
  vorm = "balk",
  children,
}: {
  /** Stabiele sleutel voor het onthouden van open of dicht. */
  id: string;
  /** Wat er achter de knop zit, als de knop dicht is: "Toon tempo en eindstand". */
  label: string;
  /** De tekst als hij open is; zonder deze blijft het label staan en zegt de pijl de stand. */
  labelOpen?: string;
  /** Er is iets dat afwijkt: open, tenzij de kijker het bij deze afwijking zelf dichtklapte. */
  afwijkend?: boolean;
  /** `balk`: over de volle breedte met een lijn erboven, in de voet van een kaart. `regel`: een
   *  tekstknop in de lopende tekst, voor een "waarom". */
  vorm?: "balk" | "regel";
  children: React.ReactNode;
}) {
  // De keuze hoort bij een toestand: wisselt die (de data komt binnen en er blijkt iets af te
  // wijken, of de afwijking is voorbij), dan geldt de standaard van de nieuwe toestand tot er een
  // keuze voor is. Bij een gewone stand is dat de bewaarde keuze; bij een afwijking open.
  const sleutel = afwijkend ? `${id}:afwijkend` : id;
  const opslag = uitklapOpslagSleutel(id, afwijkend);
  const [stand, setStand] = useState<{ sleutel: string; open: boolean } | null>(null);
  useEffect(() => {
    const opgeslagen = opslag === null ? null : leesOpgeslagen(opslag);
    setStand(opgeslagen === null ? null : { sleutel, open: opgeslagen });
  }, [sleutel, opslag]);
  const open = stand && stand.sleutel === sleutel ? stand.open : afwijkend;
  const toggle = () => {
    if (opslag !== null) schrijfOpgeslagen(opslag, !open);
    setStand({ sleutel, open: !open });
  };
  const inhoudId = `uitklap-${id}`;
  const klasse = vorm === "balk"
    ? "flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2.5 text-meta font-medium text-brand-blue-ink transition-colors hover:bg-gray-50"
    : "inline-flex min-h-11 items-center gap-1 text-left text-meta font-medium text-brand-blue-ink underline-offset-2 hover:underline";
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={inhoudId}
        data-uitklap={id}
        data-afwijkend={afwijkend ? "ja" : undefined}
        className={`${klasse} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue`}
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
        {open ? labelOpen ?? label : label}
      </button>
      <div id={inhoudId} hidden={!open} data-uitklap-inhoud={id}>{children}</div>
    </>
  );
}
