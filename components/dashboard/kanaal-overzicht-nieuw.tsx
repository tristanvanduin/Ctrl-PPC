"use client";

// De onderkant van een kanaaltabblad (Meta, LinkedIn, Microsoft) in de nieuwe weergave
// (bouwplan fase 5). Google heeft dezelfde opbouw in google-view.tsx, met zijn eigen blokken.
//
// WAAROM DIT BESTAAT. De herschikking van fase 5 stond eerst alleen op "Alle kanalen". Wie in de
// nieuwe weergave een kanaal koos, kreeg onder de nieuwe bovenkant de oude opbouw terug: de
// landentegels, de vier jaarkaarten met een grafiek eronder, en drie secties die herhalen wat de
// hoofdgrafiek en de tegels bovenaan dan al voor dat kanaal tonen. Dit is dezelfde herschikking
// voor één kanaal, volgens de elementtabel van het ontwerp.
//
// NIETS IS WEG, en dat is na te lopen (de nummers zijn die van de elementtabel):
//   63  de kopkaart van het tabblad (koppeling, uitleg,     onderaan achter "Over dit tabblad";
//       wat dit kanaal levert, waar de analyses staan)      een waarschuwing over de koppeling
//                                                           blijft open bovenaan staan, ook als
//                                                           de status zelf niet te lezen was; de
//                                                           statuspil staat dicht in de kop van
//                                                           het paneel
//   64  Account Health van het kanaal                       de score, het oordeel, de zwakste
//                                                           factor en de kritieke signalen open;
//                                                           radar en factoren achter "Toon
//                                                           onderbouwing" (open bij een rode score)
//   65  pacing tegen vorige maand                           de twee ringen met hun oordeel open;
//                                                           tempo en eindstand achter een knop
//   66  de beursweken                                       "deze week" open, de strook achter een
//                                                           knop (open als deze week achterloopt)
//   71  de vier jaarkaarten en "Prognose per maand"         Pacing & jaaroverzicht met de lade
//                                                           "Verloop en prognose"
//   53  de zes landentegels                                 de totaalrij van "Toon als tabel" in
//                                                           de voet van de wereldkaart
//   51  de ranglijst onder de projectie                     naast de projectie
//   54  de tabel per land                                   "Toon als tabel" in de wereldkaart
//   69  de verdelingsringen (levering, doelgroep)           blijven, open
//   67  het maandverloop als eigen grafiek                  achter een klik: de hoofdgrafiek
//                                                           bovenaan toont dezelfde maanden
//   72  maandprestaties (28 dagen en de maanden als tabel)  achter een klik
//   70  waar het budget landt (video)                       achter een klik
//
// Wat achter een klik staat, wordt pas gerenderd als het open is: de tabel van de maandprestaties
// en de videocijfers halen dicht ook niets op. De stand wordt per gebruiker onthouden.
//
// In de beursmodus (een gekozen beurs) blijft de kopkaart open bovenaan: daar staat dat de cijfers
// per beurs her-geaggregeerd zijn, en dat is een voorbehoud bij alles eronder.

import type { ReactNode } from "react";
import { Calendar, CalendarClock, Info, LayoutGrid, PieChart, Target, TrendingUp } from "lucide-react";
import type { UpcomingEdition } from "@/lib/fair/fair-weeks";
import type { GeoBreakdownState } from "@/lib/geo/use-geo-breakdown";
import type { NietGoogleKanaal } from "@/lib/period/kanaal-maanden";
import { Sectie, Deelkop } from "@/components/ui/sectie";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import { ChannelHealthBadge } from "./channel-health-badge";
import { ChannelPacing } from "./channel-pacing";
import { ChannelFairWeeks } from "./channel-fair-weeks";
import { ChannelMonthlyChart } from "./channel-monthly-chart";
import { ChannelPerformance } from "./channel-performance";
import { ChannelVideoPerformance } from "./channel-video-performance";
import { GeoMapCard } from "./geo-map-card";
import { GeoRanglijstInKaart, GeoTabelLade } from "./geo-ranglijst-card";
import { PacingJaaroverzichtKanaal } from "./pacing-jaaroverzicht";

/** De inhoud van een uitklapblok: de kaarten erin staan op een getint vlak, niet rand tegen rand
 *  in de kaart van het blok zelf. */
export function LadeInhoud({ children }: { children: ReactNode }) {
  return <div className="space-y-4 bg-muted/20 p-3 sm:p-4">{children}</div>;
}

export function KanaalOverzichtNieuw({ clientId, kanaal, geoClone, edition, kop, waarschuwing, koppelstatus, geo, verdeling, verdelingBijschrift, video = false }: {
  clientId: string;
  kanaal: NietGoogleKanaal;
  geoClone?: string | null;
  edition?: UpcomingEdition | null;
  /** De kopkaart van het tabblad (ChannelViewHeader), zoals de vertrouwde weergave hem bovenaan zet. */
  kop: ReactNode;
  /** Een probleem met de koppeling: dat staat open bovenaan, niet achter een klik. */
  waarschuwing?: ReactNode;
  /** De koppelstatus in een paar woorden ("Gekoppeld", "Status onbekend"), voor de kop van het
   *  dichte paneel "Over dit tabblad". Alleen voor een kanaal dat zijn status kent. */
  koppelstatus?: ReactNode;
  /** De landcijfers van dit kanaal; null voor een kanaal zonder geodata (Microsoft). */
  geo: GeoBreakdownState | null;
  /** De verdelingsringen van dit kanaal (BreakdownDonuts), als het ze heeft. */
  verdeling?: ReactNode;
  verdelingBijschrift?: string;
  /** Of dit kanaal videocijfers heeft ("Waar het budget landt"). */
  video?: boolean;
}) {
  return (
    <div className="space-y-6">
      {geoClone ? kop : waarschuwing}

      {/* De markten bovenaan, zoals op Alle kanalen en in de vertrouwde weergave: op verzoek van de
          eigenaar weer hoog. De kaart heeft een eigen kop, dus geen sectiekop erboven. */}
      {geo && (
        <GeoMapCard
          state={geo}
          channel={kanaal === "microsoft" ? undefined : kanaal}
          naast={<GeoRanglijstInKaart state={geo} naast />}
          voet={<GeoTabelLade state={geo} />}
        />
      )}

      <Sectie
        eerste={!geoClone && !waarschuwing && !geo}
        icoon={<Target className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Gezondheid en pacing"
        bijschrift="Elk blok zegt in zijn kop welk venster het gebruikt: het kalenderjaar, de lopende maand of een eigen venster."
      >
        {/* `items-start`: de twee kaarten rekken elkaar niet op. Pas naast elkaar vanaf 1800 px,
            dezelfde grens als de vertrouwde weergave: daaronder staat Account Health gestapeld en is
            hij in een halve kolom hoger dan over de volle breedte. */}
        <div className="grid grid-cols-1 items-start gap-4 min-[1800px]:grid-cols-2">
          <ChannelHealthBadge clientId={clientId} channel={kanaal} samenvatten />
          {/* In een eigen div met automatische hoogte: de pacingkaart is `h-full`. */}
          <div><ChannelPacing edition={edition} stapelSmal samenvatten /></div>
        </div>

        {edition && (
          <>
            <Deelkop
              icoon={<CalendarClock className="w-4 h-4 text-brand-blue-ink" />}
              titel="Prestaties richting de beurs"
              bijschrift={`Per week: hoeveel weken zijn we van ${edition.eventName} en lopen we op schema?`}
            />
            <ChannelFairWeeks edition={edition} compact />
          </>
        )}

        <PacingJaaroverzichtKanaal kanaal={kanaal} />

      </Sectie>

      {verdeling && (
        // De ringen renderen niets als het kanaal geen uitsplitsing levert (ze weten dat pas na hun
        // eigen data). Zonder deze wikkel stond er dan een sectiekop boven een lege plek. Een kaart
        // is altijd minstens twee div's diep; staat die er niet, dan verdwijnt de kop mee.
        <div className="[&:not(:has(.sectie-kaarten_div_div))]:hidden">
          <Sectie
            icoon={<PieChart className="w-4.5 h-4.5 text-brand-blue-ink" />}
            titel="Verdeling"
            bijschrift={verdelingBijschrift}
          >
            {verdeling}
          </Sectie>
        </div>
      )}

      <Sectie
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-brand-blue-ink" />}
        titel="Detail op aanvraag"
        bijschrift="De cijfers achter de grafiek en de tegels bovenaan. Dicht tot je erom vraagt; de pagina onthoudt wat je open liet."
      >
        <CollapsiblePanel
          id="kanaal-nieuw-maandverloop"
          title="Maandverloop als eigen grafiek"
          subtitle="dezelfde maanden als de grafiek bovenaan"
          icon={<TrendingUp className="w-4 h-4 text-brand-blue-ink" aria-hidden />}
          meta={<Vensterlabel soort="periode" />}
          defaultOpen={false}
        >
          <LadeInhoud><ChannelMonthlyChart /></LadeInhoud>
        </CollapsiblePanel>
        <CollapsiblePanel
          id="kanaal-nieuw-maandprestaties"
          title="Maandprestaties"
          subtitle="kerncijfers over 28 dagen, en de maanden van de gekozen periode als tabel"
          icon={<Calendar className="w-4 h-4 text-brand-blue-ink" aria-hidden />}
          // Twee vensters in één blok: de kerncijfers hebben een eigen venster, de maandtabel
          // volgt de periode (een beurs: zes maanden). Het label noemt het venster van de cijfers
          // bovenaan en zegt erbij wat de tabel doet; open draagt elk deel zijn eigen label.
          meta={<Vensterlabel
            soort="vast"
            venster="laatste 28 dagen"
            toevoeging={geoClone ? "tabel: 6 maanden" : "tabel: periode"}
            toevoegingUitleg={geoClone ? "De maandtabel in dit blok gaat over de laatste zes maanden." : "De maandtabel in dit blok volgt de gekozen periode."}
          />}
          defaultOpen={false}
        >
          <LadeInhoud><ChannelPerformance clientId={clientId} channel={kanaal} geoClone={geoClone} /></LadeInhoud>
        </CollapsiblePanel>
        {video && kanaal !== "microsoft" && (
          <CollapsiblePanel
            id="kanaal-nieuw-video"
            title="Waar het budget landt"
            subtitle="video"
            icon={<LayoutGrid className="w-4 h-4 text-brand-blue-ink" aria-hidden />}
            // Het venster van ChannelVideoPerformance, die er open zelf ook mee opent.
            meta={<Vensterlabel soort="vast" venster="laatste 60 dagen" />}
            defaultOpen={false}
          >
            <LadeInhoud><ChannelVideoPerformance clientId={clientId} channel={kanaal} /></LadeInhoud>
          </CollapsiblePanel>
        )}
        {!geoClone && (
          <CollapsiblePanel
            id="kanaal-nieuw-over"
            title="Over dit tabblad"
            subtitle="de koppeling, wat dit kanaal levert en waar de analyses staan"
            icon={<Info className="w-4 h-4 text-brand-blue-ink" aria-hidden />}
            // De koppelstatus blijft dicht zichtbaar (de `meta` van het paneel): "Gekoppeld" of
            // "Status onbekend" hoort niet achter een klik, ook als er geen benoemd probleem is.
            meta={koppelstatus}
            standVanNu
            defaultOpen={false}
          >
            <LadeInhoud>{kop}</LadeInhoud>
          </CollapsiblePanel>
        )}
      </Sectie>
    </div>
  );
}
