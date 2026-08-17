"use client";

// Assetdekking per PMax-assetgroep: wat heb je aangeleverd, en wat vindt Google ervan?
//
// ── WAAROM DEZE KAART BESTAAT ───────────────────────────────────────────────
//
// De netwerkkaart ernaast zegt dat de kanaalverdeling geen knop is en dat je eromheen stuurt, met
// assets als eerste lever. Die assets stonden vervolgens nergens op het scherm. Een kaart die een
// knop noemt en hem niet laat zien, is dezelfde soort dode verwijzing als een tabblad dat niet
// bestaat.
//
// ── DRIE KOLOMMEN WAREN TE GROF ─────────────────────────────────────────────
//
// De eerste versie toonde tekst / beeld / video. Dat is precies de indeling waarop je NIET stuurt:
// "acht tekstassets" kan een groep zijn die aan alles voldoet en een groep die twee koppen tekort
// komt en dus niet volledig serveerbaar is. De sync sloeg Google's fijne veldtype al op -- de data
// was fijner dan de weergave. Nu staan de acht types die Google zelf onderscheidt er los, met per
// type het minimum uit lib/pmax/assetdekking.ts.
//
// Acht kolommen naast elkaar zijn zonder ordening een spreadsheet, dus ze staan onder drie banden:
// Tekst, Beeld, Merk & video. Dat is ook de volgorde waarin je een assetgroep opbouwt.
//
// ── WAAROM ER GEEN ALINEA MEER BOVEN STAAT ──────────────────────────────────
//
// Hier stond een uitlegblok en een amberkleurige samenvattingsbalk. Twee stukken proza boven acht
// getallen, en de kaart las als een handleiding. Wat een kolom betekent zit nu in de uitleg-hover
// op de kolomkop (components/ui/uitleg.tsx); wat er aan een groep te doen valt staat als één regel
// naast die groep, en alleen als er iets te doen is.
//
// ── WAAROM HIJ NIET MEEGROEIT MET HET ACCOUNT ───────────────────────────────
//
// Een account kan tientallen assetgroepen hebben, verdeeld over meerdere PMax-campagnes. De eerste
// versie mapte over allemaal: bij twintig groepen werd dit blok ruim 1800 pixels hoog naast een
// PMax-kaart van 859 -- precies het gat dat we net gedicht hadden, dan andersom.
//
// Drie grenzen houden hem klein, en ze zijn alle drie inhoudelijk en niet cosmetisch:
//
//   1. Alleen groepen die iets MISSEN of zwakke assets hebben komen in de lijst. Een complete
//      groep vraagt niets van je, dus die hoeft er niet te staan.
//   2. De complete groepen worden geteld en niet opgesomd. "Zeven compleet" zegt alles wat je
//      over zeven groepen zonder probleem hoeft te weten.
//   3. Vraagt er toch een handvol aandacht, dan staan er vier en de rest achter een knop MET het
//      aantal erop -- "meer tonen" zonder getal laat je klikken om erachter te komen of het de
//      moeite is.

import { useEffect, useMemo, useState } from "react";
import { Layers, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { Laadvlak } from "@/components/ui/laadvlak";
import { useTruncatedList, MeerKnop } from "@/components/ui/disclosure";
import { Uitleg, UitlegKop } from "@/components/ui/uitleg";
import {
  analyseerAssetdekking, absorbeertBudget, groepsactie, TYPES, BANDEN,
  type AssetRegel, type Groepscijfers, type Typedekking, type Typeregel,
} from "@/lib/pmax/assetdekking";

/**
 * Hoeveel groepen er standaard zichtbaar zijn.
 *
 * Vier past naast de PMax-kaart zonder de rij uit te rekken, en meer dan vier problemen tegelijk
 * pak je toch niet op één dag aan.
 */
const ZICHTBAAR = 4;

/** Hele procenten: onder een groep die 32% draait voegt de tiende niets toe aan het besluit. */
const pctKort = (v: number) =>
  new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 0 }).format(v);

/**
 * De kolomindeling, op één plek zodat de banden, de koppen en de rijen niet uit elkaar lopen.
 *
 * De naamkolom is minmax(0,1fr) en niet auto: een lange groepsnaam moet afkappen, niet de
 * getallen wegduwen. min-w op de matrix plus overflow-x op de wikkel zorgt dat de acht kolommen
 * in een smalle container schuiven in plaats van in elkaar te schuiven -- de kaart staat ook in
 * een kolom van 4/12 als het venster smal is.
 */
const KOLOMMEN = "grid grid-cols-[minmax(0,1fr)_repeat(8,3rem)] gap-x-1 min-w-[32rem]";

/** Waar een band begint: daar komt de scheidingslijn, in de kop én in elke rij. */
const BANDSTART = new Set(
  TYPES.filter((t, i) => i > 0 && TYPES[i - 1].band !== t.band).map((t) => t.type),
);

/**
 * De breedte van een bandkop, als hele klassen en niet samengesteld.
 *
 * Tailwind leest de bron als tekst; een klasse die pas tijdens het draaien ontstaat (`col-span-${n}`)
 * staat niet in de uitvoer en doet dus niets. Dat faalt stil: de kop komt gewoon één kolom breed
 * te staan en niemand ziet dat er een regel ontbreekt.
 */
const BANDBREEDTE: Record<number, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3" };

const randKlasse = (t: Typeregel | Typedekking) =>
  BANDSTART.has(t.type) ? "border-l border-border pl-1.5" : "";

/**
 * Eén cel: hoeveel assets van dit type.
 *
 * ── WAAROM HIER GEEN "2/3" MEER STAAT ───────────────────────────────────────
 *
 * Een kaal getal is geen oordeel: om "2" te wegen moet je weten dat er drie moeten zijn. De eerste
 * poging zette de eis in de cel ("2/3"), maar dat is een breuk die je moet ontcijferen op precies
 * de plek waar je wilt scannen -- en de terugkoppeling was dat het niet duidelijk was. Terecht.
 *
 * De eis hoort niet acht keer per rij te staan maar één keer per kolom, in de kop. Daar staat nu
 * "min 3" onder "Kop". Dan is de cel weer gewoon een getal, en zegt de kleur of het genoeg is --
 * en die kleur is te lezen zonder de eis erbij, want je vergelijkt hem met de kop erboven.
 */
function Typecel({ dekking, regel }: { dekking: Typedekking; regel: Typeregel }) {
  const leeg = dekking.aantal === 0;
  // Een leeg optioneel veld is geen overtreding, dus geen aandachtskleur -- op één na. Zonder
  // eigen video maakt Google er zelf een uit je beeld en koppen, en die draait mee op de best
  // converterende plaatsing die PMax heeft. Zie de kop van lib/pmax/assetdekking.ts.
  const gemist = leeg && regel.type === "YOUTUBE_VIDEO";

  const titel = leeg
    ? `Geen ${regel.enkelvoud} in deze groep`
    : [
        `${dekking.aantal} ${dekking.aantal === 1 ? regel.enkelvoud : regel.meervoud}`,
        dekking.zwak > 0 ? `${dekking.zwak} zwak` : null,
        dekking.onbeoordeeld > 0 ? `${dekking.onbeoordeeld} nog niet beoordeeld` : null,
      ].filter(Boolean).join(", ");

  return (
    <div className={`flex items-baseline justify-end gap-1 tabular-nums ${randKlasse(dekking)}`} title={titel}>
      {/* text-body en geen text-sm, en normaal gewicht waar niets aan de hand is.
          ── WAAROM DIT ERTOE DOET ──────────────────────────────────────────────
          Hier stond `text-sm font-semibold`. Dat is twee afwijkingen tegelijk van elk ander getal
          op dit scherm: 14px waar de tabellen 12 gebruiken, én halfvet waar GetalCel normaal
          gewicht heeft. text-sm staat bovendien niet eens op de huisladder
          (micro/meta/body/lead/title in app/globals.css) -- het is precies de tussenmaat waar de
          kop van dat bestand voor waarschuwt. Groter plus zwaarder leest niet als "iets groter",
          het leest als een ander lettertype, en dat was ook de terugkoppeling.

          Halfvet is nu voorbehouden aan de cellen die eruit horen te springen. Als alles zwaar is,
          springt er niets uit. */}
      <span
        className={
          dekking.tekort || gemist ? "text-body font-semibold text-amber-700"
            : leeg ? "text-body text-muted-foreground/50"
            : "text-body text-brand-gray"
        }
      >
        {/* Een 0 en geen streepje. Het streepje stond er voor "niet aangeleverd", maar dat is
            precies wat nul betekent zodra de groep zelf in de data zit -- en in amber las het als
            een minteken. "Niets gemeten" en "nul gemeten" mogen niet hetzelfde teken krijgen;
            hier is het het tweede. */}
        {dekking.aantal}
      </span>
    </div>
  );
}

export function PmaxAssetCoverage({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<AssetRegel[] | null>(null);
  // Apart van `rows`: de kosten zijn een toevoeging en geen voorwaarde. Zou de kaart op allebei
  // wachten, dan verdwijnt hij als deze tabel leeg is of de query faalt -- terwijl de assetdekking
  // zelf prima te tonen is. Null betekent hier "nog niet binnen of niet beschikbaar".
  const [cijfers, setCijfers] = useState<Groepscijfers | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase;
    if (!sb) { setRows([]); return; }
    // Zelfde venster als de netwerkkaart ernaast: anders gaan twee kaarten over dezelfde campagne
    // over een andere periode, en dan spreken ze elkaar tegen zonder dat iemand ziet waarom.
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    dbSelect<Record<string, unknown>>("ads_pmax_asset_performance", {
      select: "asset_group_name, asset_id, asset_type, performance_label, month",
      clientId, filters: [{ op: "gte", column: "month", value: since }],
    }).then(({ data }) => {
      if (cancelled) return;
      setRows(data as AssetRegel[]);
    }, () => { if (!cancelled) setRows([]); });

    // Op NAAM samengevoegd en niet op asset_group_id, omdat de dekking hierboven dat ook doet.
    // Twee gelijknamige groepen in twee campagnes tellen dus als één rij -- aan beide kanten,
    // dus het percentage blijft kloppen bij de assets waar het naast staat. Zouden de kosten wél
    // per id lopen en de assets niet, dan stond er een aandeel van de ene groep naast de assets
    // van twee.
    dbSelect<Record<string, unknown>>("ads_asset_group_performance_monthly", {
      select: "asset_group_name, cost, conversions",
      clientId, filters: [{ op: "gte", column: "month", value: since }],
    }).then(({ data }) => {
      if (cancelled) return;
      const som: Record<string, { kosten: number; conversies: number }> = {};
      for (const r of data) {
        const naam = String(r.asset_group_name ?? "").trim();
        if (!naam) continue;
        const vak = som[naam] ?? (som[naam] = { kosten: 0, conversies: 0 });
        vak.kosten += Number(r.cost ?? 0) || 0;
        vak.conversies += Number(r.conversions ?? 0) || 0;
      }
      setCijfers(som);
    }, () => { if (!cancelled) setCijfers(null); });

    return () => { cancelled = true; };
  }, [clientId]);

  const dekking = useMemo(
    () => (rows ? analyseerAssetdekking(rows, cijfers ?? undefined) : null),
    [rows, cijfers],
  );
  // Vóór de vroege returns: React vereist dat hooks bij elke render in dezelfde volgorde draaien,
  // en een return ertussen breekt dat op het moment dat de data binnenkomt.
  const lijst = useTruncatedList(dekking?.aandacht ?? [], ZICHTBAAR);

  if (rows === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel="Assets per groep" />;
  }
  // Geen assetgroepen: geen PMax, of nog niet gesynct. Dan hoort deze kaart er niet te staan --
  // een leeg blok met een kop is erger dan geen blok.
  if (!dekking || dekking.groepen.length === 0) return null;

  const aandacht = dekking.aandacht.length;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <Layers className="h-4.5 w-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Assets per groep</h3>
        {/* De drie toestanden staan er alle drie in, en niet alleen het oranje. Er stond eerst
            "een getal eronder kleurt oranje" -- dan blijft het lichtgrijs onverklaard, en een
            kleur die je zelf moet raden is geen signaal maar ruis. */}
        <Uitleg label="Waar deze getallen vandaan komen">
          Per assetgroep het aantal assets van elk veldtype dat Google onderscheidt. Onder elke
          kolomkop staat het minimum voor een serveerbare assetgroep — een groep eronder draait niet
          op alle plaatsingen.
          <br />
          {/* De kleurnamen staan hier ONGEKLEURD, en dat is geen vergetelheid. Deze bubbel is
              bg-foreground met text-background: in de lichte modus donker met lichte letters, in
              de donkere modus precies andersom. Elke kleur die je hier vastzet werkt dus op één
              van de twee thema's niet -- amber-300 leest op de donkere bubbel en verdwijnt op de
              lichte. Het woord "oranje" zegt het al; de kleur zelf staat in de tabel. */}
          <span className="font-semibold">Oranje</span> = onder dat minimum, of geen eigen video
          (die is niet verplicht, maar zonder maakt Google er zelf een).{" "}
          <span className="font-semibold">Donker</span> = voldoet.{" "}
          <span className="font-semibold">Lichtgrijs</span> = nul, maar optioneel — dat is alleen
          4:5, en dat kost je hooguit de staande plaatsingen.
          <br />
          Het percentage naast elke groep is haar aandeel in de PMax-kosten over dezelfde periode;
          staat er <span className="font-semibold">32% kosten &rarr; 11% conversies</span>, dan kost
          die groep meer dan twee keer wat ze oplevert.
        </Uitleg>
        <span className="ml-auto text-micro text-muted-foreground">
          {aandacht > 0
            ? `${aandacht} van ${dekking.groepen.length} ${aandacht === 1 ? "vraagt" : "vragen"} aandacht`
            : `${dekking.groepen.length} groep${dekking.groepen.length === 1 ? "" : "en"}`}
        </span>
      </div>

      {lijst.zichtbaar.length > 0 && (
        <div className="overflow-x-auto">
          {/* De bandkoppen. Acht kolommen zonder ordening lezen als een spreadsheet; met drie
              banden is de vraag "heb ik genoeg beeld?" in één blik te beantwoorden.

              GECENTREERD boven hun kolommen, niet rechts uitgelijnd. Rechts uitgelijnd stond
              "TEKST" pal boven de derde kolom en las het als de kop van díe kolom in plaats van
              van de drie eronder -- zichtbaar in de eerste render, niet in de code. */}
          <div className={`${KOLOMMEN} px-5 pt-2.5`}>
            <span />
            {BANDEN.map(({ band, label }) => (
              <span
                key={band}
                className={`${BANDBREEDTE[TYPES.filter((t) => t.band === band).length] ?? "col-span-1"} text-center text-micro font-semibold uppercase tracking-wider text-muted-foreground/70`}
              >
                {label}
              </span>
            ))}
          </div>

          {/* De EIS staat in de kop, één keer per kolom. Stond hij in de cel ("2/3"), dan moest je
              hem acht keer per rij ontcijferen op precies de plek waar je wilt scannen. Nu leest
              elke cel als een getal en zegt de kolomkop erboven waartegen je het houdt. */}
          <div className={`${KOLOMMEN} border-b border-border px-5 pt-1 pb-1.5`}>
            <span />
            {TYPES.map((t) => (
              <span key={t.type} className={`flex flex-col items-end ${randKlasse(t)}`}>
                <UitlegKop
                  className="text-micro font-medium text-muted-foreground"
                  uitleg={
                    <span>
                      <span className="font-semibold">{t.enkelvoud[0].toUpperCase() + t.enkelvoud.slice(1)}</span>
                      {" — "}
                      {t.min > 0 ? `minimaal ${t.min}, maximaal ${t.max}.` : `optioneel, maximaal ${t.max}.`}
                      <br />
                      {t.uitleg}
                    </span>
                  }
                >
                  {t.label}
                </UitlegKop>
                {/* text-micro is de ondergrens in dit ontwerp: alles daaronder is er ooit uitgehaald
                    omdat het onleesbaar was (zie de kop van app/globals.css). Deze regel wordt dus
                    zachter gezet en niet kleiner. */}
                <span className="text-micro leading-tight text-muted-foreground/60">
                  {t.min > 0 ? `min ${t.min}` : "optie"}
                </span>
              </span>
            ))}
          </div>

          <div className="divide-y divide-border">
            {lijst.zichtbaar.map((g) => {
              const actie = groepsactie(g);
              return (
                <div key={g.groep} className={`${KOLOMMEN} items-center px-5 py-2`}>
                  <div className="min-w-0 pr-4">
                    {/* De naam krijgt de hele regel. Hij stond eerst naast de kostenbalk en werd
                        daardoor afgekapt op "Standhouders — internati…" -- de naam is waarmee je
                        de groep terugvindt in Google Ads, dus die mag als laatste inleveren. */}
                    <div className="truncate text-body text-brand-gray" title={g.groep}>{g.groep}</div>
                    <div className="flex items-start gap-3">
                      {/* De regel die zegt wat je moet doen. Alleen als er iets te doen is: bij
                          een groep zonder gebrek is de lege ruimte de betere mededeling.

                          HIJ MAG AFBREKEN en wordt niet afgekapt. Met de bevinding ernaast paste
                          hij niet meer op één regel en stond er "3 zwakke as…" -- een instructie
                          die je moet aanvullen uit je hoofd is geen instructie. Twee regels kosten
                          hier niets: de kaart heeft onderaan toch ruimte over. */}
                      {actie && <span className="text-micro leading-snug text-amber-700">{actie}</span>}
                      {/* Het geld achter het gat. Een ontbrekende video in een groep van 2% en
                          dezelfde in een groep van 32% zijn niet hetzelfde probleem, en zonder dit
                          getal staan ze naast elkaar alsof ze dat wel zijn. */}
                      {/* UITGESCHREVEN, geen balk. Er stond hier een baan met een vulling en een
                          kaal percentage, en zonder kolomkop wist niemand waar dat over ging --
                          een balk zonder label is versiering.

                          En het percentage staat er niet alleen meer. "32% van de kosten" is even
                          goed het teken van de beste groep als van de slechtste; pas naast het
                          conversie-aandeel is het een bevinding. Loopt dat ver uiteen, dan staat
                          het er als "32% kosten → 11% conversies" in de aandachtskleur -- anders
                          gewoon als context. Zie absorbeertBudget in lib/pmax/assetdekking.ts. */}
                      {g.kostenAandeel !== null && (
                        absorbeertBudget(g) ? (
                          <span className="ml-auto shrink-0 whitespace-nowrap text-micro font-medium tabular-nums text-amber-700">
                            {pctKort(g.kostenAandeel)} kosten &rarr; {pctKort(g.conversieAandeel!)} conversies
                          </span>
                        ) : (
                          <span className="ml-auto shrink-0 whitespace-nowrap text-micro tabular-nums text-muted-foreground">
                            {pctKort(g.kostenAandeel)} van de kosten
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  {g.perType.map((t, i) => <Typecel key={t.type} dekking={t} regel={TYPES[i]} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <MeerKnop
        verborgen={lijst.verborgen}
        uitgeklapt={lijst.uitgeklapt}
        onToggle={lijst.toggle}
        eenheid="groepen"
      />

      {/* De complete groepen als één regel. Ze opsommen zou de lijst verdubbelen met rijen waar
          niets aan te doen valt; het aantal is alles wat je erover hoeft te weten. */}
      {dekking.compleet > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border px-5 py-2.5 text-meta text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
          {dekking.compleet === 1
            ? "1 groep voldoet aan alle minima en heeft een eigen video"
            : `${dekking.compleet} groepen voldoen aan alle minima en hebben een eigen video`}
        </p>
      )}
    </div>
  );
}
