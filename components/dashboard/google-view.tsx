"use client";

import { Calendar, Target, Globe, LayoutGrid, TrendingUp, Sparkles, AlertTriangle, Users } from "lucide-react";
import { countryLabel } from "@/lib/countries";
import type { UpcomingEdition } from "@/lib/rai/fair-weeks";
import { Sectie } from "@/components/ui/sectie";
import { HealthBadge } from "./health-badge";
import { SearchScorecard } from "./search-scorecard";
import { EventPacing } from "./event-pacing";
import { GeoCloneOverview } from "./geo-clone-overview";
import { ClientNotes } from "./client-notes";
import { MonthlyOverview } from "./monthly-overview";
import { FairWeeksOverview } from "./fair-weeks-overview";
import { PacingMonitor } from "./pacing-monitor";
import { MetricCards } from "./metric-cards";
import { PerformanceChart } from "./performance-chart";
import { GeoBreakdown } from "./geo-breakdown";
import { GeoChannelMatrix } from "./geo-channel-matrix";
import { VideoPerformance } from "./video-performance";
import { PmaxNetworkSplit } from "./pmax-network-split";
import { PmaxAssetCoverage } from "./pmax-asset-coverage";
import { VideoPlacements } from "./video-placements";
import { CampaignTable } from "./campaign-table";
import { CreativePerformance } from "./creative-performance";
import { SearchTermsTable } from "./search-terms-table";
import { ForecastTable } from "./forecast-table";
import { BudgetScenario } from "./budget-scenario";
import { AudienceSplit } from "./audience-split";

// De Google-weergave, geëxtraheerd uit client-dashboard.tsx (was daar 1.070 van de 1.070 regels
// gedeeld met Meta, LinkedIn en blended). Zelfde verdeling als Meta en LinkedIn al hadden:
// GoogleView voor Overzicht, GoogleCampagnes voor Campagnes, GoogleForecast voor Prognose — zie
// de kop van meta-view.tsx, die letterlijk zegt "dezelfde verhuizing die bij Google al gedaan
// was". Deze drie namen zijn de vierde kant van diezelfde verdeling.
//
// PUUR VERPLAATST, GEEN GEDRAGSWIJZIGING. Elke sectie, elke kaart, elke voorwaarde staat er
// zoals hij in client-dashboard.tsx stond. Alleen de bronnen van client.id, clientData,
// countryFilter, tijdas en upcomingEdition zijn props geworden in plaats van closures over de
// staat van de oudercomponent — dat is wat een los bestand nodig heeft, niet een keuze over
// wat het scherm doet.

// De as-keuze bij de prestatiekaart, alleen gebruikt door GoogleView (bij een events-klant met
// een aankomende editie). Stond als losse functie in client-dashboard.tsx; had daar maar één
// aanroeper en die aanroeper verhuist nu mee.
function TijdasKeuze({ value, onChange }: { value: "beurs" | "maand"; onChange: (v: "beurs" | "maand") => void }) {
  const opties: { id: "beurs" | "maand"; label: string }[] = [
    { id: "beurs", label: "Weken tot beurs" },
    { id: "maand", label: "Maanden" },
  ];
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
      {opties.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            value === o.id ? "bg-rm-blue text-white" : "text-muted-foreground hover:text-rm-blue-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface GoogleViewProps {
  clientId: string;
  geoClone: string | null;
  edition: UpcomingEdition | null;
  /** Alleen bepalend voor het bijschrift en de kanaalmix-verdieping bij Markten. */
  meerdereKanalen: boolean;
  detectedCountries: string[] | undefined;
  countryFilter: string | null;
  onCountryFilterChange: (value: string | null) => void;
  tijdas: "beurs" | "maand";
  onTijdasChange: (value: "beurs" | "maand") => void;
}

/** De Overzicht-tab voor Google Ads. */
export function GoogleView({
  clientId, geoClone, edition, meerdereKanalen, detectedCountries,
  countryFilter, onCountryFilterChange, tijdas, onTijdasChange,
}: GoogleViewProps) {
  const beursAs = edition !== null && tijdas === "beurs";

  return (
    <>
      <HealthBadge clientId={clientId} />
      <SearchScorecard clientId={clientId} />
      {geoClone ? (
        // Beurs gekozen: her-geaggregeerd beursoverzicht (uit campagnedata) i.p.v. de
        // account-brede kaarten, die niet per beurs te splitsen zijn.
        <>
          {/* Event-relatieve pacing: opbouw tot nu vs dezelfde afstand tot de vorige editie. */}
          <EventPacing clientId={clientId} geoClone={geoClone} />
          <GeoCloneOverview clientId={clientId} geoClone={geoClone} />
          <ClientNotes clientId={clientId} />
        </>
      ) : (
        <>
          {/* Country filter for dashboard (only if multi-country) */}
          {detectedCountries && detectedCountries.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <button
                onClick={() => onCountryFilterChange(null)}
                className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                  countryFilter === null ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                }`}
              >
                Alle landen
              </button>
              {detectedCountries.map((code) => (
                <button
                  key={code}
                  onClick={() => onCountryFilterChange(countryFilter === code ? null : code)}
                  className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                    countryFilter === code ? "bg-rm-orange text-white" : "bg-orange-50 text-muted-foreground hover:text-rm-gray"
                  }`}
                >
                  {countryLabel(code)}
                </button>
              ))}
            </div>
          )}

          {/* De pagina is in secties gegroepeerd in plaats van dertien losse kaarten onder
              elkaar. Elke sectie beantwoordt één vraag; binnen een sectie staan de kaarten
              dicht op elkaar, ertussen zit ruim het dubbele. Zonder dat verschil groepeert er
              niets en moet de lezer zelf uitzoeken wat bij wat hoort. */}
          <Sectie
            eerste
            icoon={<Calendar className="w-4.5 h-4.5 text-rm-blue-ink" />}
            titel={
              (beursAs ? "Prestaties richting de beurs" : "Maandprestaties")
              + (countryFilter ? ` — ${countryLabel(countryFilter)}` : "")
            }
            bijschrift={beursAs
              ? `Per week: hoeveel weken zijn we van ${edition!.eventName} en lopen we op schema?`
              : "Per maand: waar staan we en wat is de trend?"}
            actie={edition && <TijdasKeuze value={tijdas} onChange={onTijdasChange} />}
          >
            {/* NAAST ELKAAR GEPROBEERD EN TERUGGEDRAAID, en niet om de uitlijning.

                Beide kaarten beantwoorden "lopen we op schema", maar op een andere horizon --
                links per week, rechts per jaar -- en ze gebruiken daarvoor dezelfde woorden.
                "Prognose" betekent links een week en rechts een jaar; "Verwacht" links en "Op
                dit tempo" rechts zijn allebei een verwachting. Vier termen voor hetzelfde
                begrip op twee schalen, naast elkaar: dat nodigt uit tot een vergelijking die
                niet klopt.

                Waar naast elkaar wél werkt in deze app, gaat het om twee SOORTEN antwoord (de
                kaart zegt waar, de ranglijst zegt hoeveel) of om dezelfde data in twee
                duidelijk verschillende vormen (de boog en de radar op de gezondheidskaart).
                Twee kaartvormige blokken met percentages die allebei over schema gaan, zijn
                geen van beide.

                Onder elkaar markeert de verticale sprong de wisseling van horizon, en dat is
                precies het signaal dat naast elkaar ontbreekt. */}
            {beursAs
              ? <FairWeeksOverview clientId={clientId} countryFilter={countryFilter} edition={edition!} />
              : <MonthlyOverview clientId={clientId} countryFilter={countryFilter} />}
            <PacingMonitor clientId={clientId} countryFilter={countryFilter} edition={edition} />
          </Sectie>

          <Sectie
            icoon={<Target className="w-4.5 h-4.5 text-rm-blue-ink" />}
            titel={countryFilter ? `Jaaroverzicht 2026 — ${countryLabel(countryFilter)}` : "Jaaroverzicht 2026"}
            bijschrift="Jaardoelen vs bijgestelde prognose op basis van weektrend"
          >
            <MetricCards clientId={clientId} countryFilter={countryFilter} />
            <PerformanceChart clientId={clientId} countryFilter={countryFilter} />
          </Sectie>

          {/* Waar het vandaan komt, en hóé die markten bediend worden. De kanaalmix per land
              staat bewust naast de kaart en niet op een eigen pagina: het is de volgende vraag
              na "welke landen", en een aparte pagina zou klant en periode opnieuw laten kiezen. */}
          <Sectie
            icoon={<Globe className="w-4.5 h-4.5 text-rm-blue-ink" />}
            titel="Markten"
            bijschrift={
              meerdereKanalen
                ? "Waar het verkeer en de conversies vandaan komen, en met welke kanaalmix"
                : "Waar het verkeer en de conversies vandaan komen"
            }
          >
            {/* De land×kanaal-matrix alleen bij meerdere kanalen. Met één kanaal is het een
                landentabel met één kolom -- dat is precies wat de kaart al toont, en het
                bijschrift belooft een "kanaalmix" die niet bestaat.

                IN dezelfde kaart en niet eronder: als losse kaart werd het een dichtgeklapte
                strook van 60px onder een kaart van 600, en twee van die balkjes op elkaar lezen
                als restjes. Naast de kaart geprobeerd (7 + 5) en ook teruggedraaid, om dezelfde
                reden: een strook naast een kaart van 481px is geen compositie. */}
            <GeoBreakdown
              clientId={clientId}
              verdieping={meerdereKanalen ? <GeoChannelMatrix clientId={clientId} /> : undefined}
            />
          </Sectie>

          {/* Video, PMax-netwerken, placements en creatives horen bij elkaar: het is allemaal
              "waar landt het budget en hoe ziet het eruit". Elk van deze kaarten rendert niets
              als er geen data voor is, dus de sectie kan ook helemaal leeg blijven. */}
          <Sectie
            icoon={<LayoutGrid className="w-4.5 h-4.5 text-rm-blue-ink" />}
            titel="Waar het budget landt"
            bijschrift="Video, netwerken en placements"
          >
            {/* Naast elkaar, met een DERDE blok in het gat.

                Eerder geprobeerd op 8 + 4 en teruggedraaid: de videotabel paste precies
                (835/835) maar de PMax-kaart werd 826px hoog naast een videokaart van 322px --
                een gat van 500px. Het probleem was niet de indeling maar dat er twee blokken
                waren voor drie plekken.

                De assetdekking vult dat gat, en niet als opvulling: de PMax-kaart ernaast zegt
                zelf dat de kanaalverdeling geen knop is en dat je stuurt via assets. Die
                assets stonden nergens op het scherm -- een kaart die een knop noemt en hem
                niet laat zien.

                row-span-2 op de PMax-kaart en geen drie losse rijen: die kaart is met zijn
                twee ringen ongeveer even hoog als de videotabel en de assetdekking samen, dus
                de twee kolommen lopen gelijk uit. */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:grid-rows-[min-content_1fr]">
              <div className="@container min-w-0 xl:col-span-8">
                <VideoPerformance clientId={clientId} />
              </div>
              {/* Ook deze rekt mee, en om dezelfde reden als de assetkaart hieronder -- alleen
                  staat de speling nu aan de andere kant. Toen de assetdekking acht kolommen
                  kreeg in plaats van drie werd de linkerkolom 573px tegen 528 rechts, en dan
                  hangt de PMax-kaart 45px boven de onderrand van zijn buur.

                  Welke kolom de langste is, hangt af van de klant: de assetkaart groeit met
                  het aantal groepen dat aandacht vraagt, de ringen ernaast staan vast. Daarom
                  rekken ze allebei mee -- dan valt de speling altijd binnen een kaart en nooit
                  ertussen, welke kant hij ook op staat. */}
              <div className="@container min-w-0 xl:col-span-4 xl:row-span-2 xl:[&>div]:h-full">
                <PmaxNetworkSplit clientId={clientId} />
              </div>
              {/* De rijhoogtes zijn min-content en 1fr, en de assetkaart rekt mee (h-full, en
                  via [&>div] ook de kaart erbinnen). Zonder dat verdeelde het raster de
                  overtollige hoogte van de PMax-kaart over BEIDE rijen: 61px tussen video en
                  assets waar elders 16 staat, en de onderkanten 45px uit elkaar. Nu gaat alle
                  speling naar de onderste kaart, waar hij als padding in een lijst leest in
                  plaats van als een gat tussen twee kaarten. */}
              <div className="@container min-w-0 xl:col-span-8 xl:h-full xl:[&>div]:h-full">
                <PmaxAssetCoverage clientId={clientId} />
              </div>
            </div>
            <VideoPlacements clientId={clientId} />
          </Sectie>

          <div className="mt-10">
            <ClientNotes clientId={clientId} />
          </div>
        </>
      )}
    </>
  );
}

interface GoogleCampagnesProps {
  clientId: string;
  geoClone: string | null;
  countryFilter: string | null;
  onCountryFilterChange: (value: string | null) => void;
}

/** De Campagnes-tab voor Google Ads: wat draait er, de advertenties zelf, en waar het weglekt. */
export function GoogleCampagnes({ clientId, geoClone, countryFilter, onCountryFilterChange }: GoogleCampagnesProps) {
  return (
    <div>
      {/* Twee vragen, twee secties. Wat draait er, en waar lekt het weg — dat laatste
          is geen detail van het eerste maar een eigen onderwerp met een eigen actie. */}
      <Sectie
        eerste
        icoon={<LayoutGrid className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wat er draait"
        bijschrift="Alle campagnes van dit account over de laatste 30 dagen"
      >
        <CampaignTable clientId={clientId} geoClone={geoClone} countryFilter={countryFilter} onCountryFilterChange={onCountryFilterChange} />
      </Sectie>
      {/* Wie de campagnes bereiken, tussen "wat draait er" en "hoe zien de advertenties eruit" --
          de doelgroepmix is een targeting-vraag, geen creative-vraag, en hoort dus vóór de
          advertenties zelf. Rendert niets zonder doelgroepdata (bv. alleen Performance Max zonder
          expliciete signalen), dus de sectie kan leeg blijven zoals de andere kaarten hier ook
          stil zijn zonder data. */}
      <Sectie
        icoon={<Users className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Doelgroepsignalen"
        bijschrift="Welk type doelgroep de campagnes bereikt, en wat het oplevert"
      >
        <AudienceSplit clientId={clientId} />
      </Sectie>
      {/* De advertenties zelf horen hier en niet op Overzicht.
          Ze stonden in de sectie "Waar het budget landt", samen met video, netwerken
          en placements: vier onderwerpen onder één kop, samen 1.872 pixels — ruim
          anderhalf scherm en zesendertig procent van de hele pagina. Dit blok was het
          grootste (616px) én het enige dat inhoudelijk ergens anders thuishoort: een
          advertentie is waar een campagne uit bestaat, niet waar een budget landt.
          Overzicht wordt hier een derde korter zonder dat er iets verdwijnt. */}
      <Sectie
        icoon={<Sparkles className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="De advertenties zelf"
        bijschrift="Hoe de creatives eruitzien en wat ze opleverden"
      >
        <CreativePerformance clientId={clientId} channel="google" />
      </Sectie>
      <Sectie
        icoon={<AlertTriangle className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Waar het weglekt"
        bijschrift="Zoektermen, ad groups en producten die kosten maken zonder conversie"
      >
        <SearchTermsTable clientId={clientId} geoClone={geoClone} countryFilter={countryFilter} />
      </Sectie>
    </div>
  );
}

/** De Prognose-tab voor Google Ads (alleen gerenderd buiten een gekozen geo-kloon). */
export function GoogleForecast({ clientId }: { clientId: string }) {
  return (
    <>
      {/* De prognose is het antwoord; het budgetscenario is wat je ermee doet.
          Twee onderwerpen, dus twee secties. */}
      <Sectie
        eerste
        icoon={<TrendingUp className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Waar dit jaar op uitkomt"
        bijschrift="Gerealiseerd plus prognose per maand, tegen het geschatte jaardoel (vorig jaar +10%)"
      >
        <ForecastTable clientId={clientId} />
      </Sectie>
      <Sectie
        icoon={<Target className="w-4.5 h-4.5 text-rm-blue-ink" />}
        titel="Wat een budgetwijziging zou doen"
        bijschrift="Doorrekening van een hoger of lager mediabudget op dezelfde efficiëntie"
      >
        <BudgetScenario clientId={clientId} />
      </Sectie>
    </>
  );
}
