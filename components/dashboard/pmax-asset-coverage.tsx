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
import { Laadvlak } from "@/components/ui/laadvlak";
import { useTruncatedList, MeerKnop } from "@/components/ui/disclosure";
import { Uitleg, UitlegKop } from "@/components/ui/uitleg";
import {
  analyseerAssetdekking, groepsactie, TYPES, BANDEN,
  type AssetRegel, type Kosten, type Typedekking, type Typeregel,
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
 * Eén cel: hoeveel assets van dit type, en of dat er genoeg zijn.
 *
 * Een kaal getal is geen oordeel -- om "2" te wegen moet je het minimum uit je hoofd kennen. Bij
 * een tekort staat er daarom "2/3": het getal en de eis in hetzelfde blikveld, in de aandachtskleur.
 * Staat het goed, dan is het weer gewoon een getal; een kaart die overal een breuk toont, laat je
 * acht keer nadenken over zeven dingen die kloppen.
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
        dekking.zwak > 0 ? `${dekking.zwak} met het label laag` : null,
        dekking.onbeoordeeld > 0 ? `${dekking.onbeoordeeld} nog niet beoordeeld` : null,
      ].filter(Boolean).join(", ");

  return (
    <div className={`flex items-baseline justify-end gap-1 tabular-nums ${randKlasse(dekking)}`} title={titel}>
      <span
        className={
          dekking.tekort ? "text-sm font-bold text-amber-700"
            : gemist ? "text-sm font-bold text-amber-700"
            : leeg ? "text-sm text-muted-foreground/50"
            : "text-sm font-semibold text-rm-gray"
        }
      >
        {/* Een 0 en geen streepje. Het streepje stond er voor "niet aangeleverd", maar dat is
            precies wat nul betekent zodra de groep zelf in de data zit -- en in amber las het als
            een minteken. "Niets gemeten" en "nul gemeten" mogen niet hetzelfde teken krijgen;
            hier is het het tweede. */}
        {dekking.tekort ? `${dekking.aantal}/${regel.min}` : dekking.aantal}
      </span>
      {/* Een STIP en geen tweede getal. In de eerste render stond er "2 1↓" naast elkaar en dat
          leest als eenentwintig -- twee getallen zonder scheiding in dezelfde cel is een fout die
          je pas ziet als je het rendert. Hoevéél er zwak zijn staat al in de actieregel naast de
          naam; deze stip zegt alleen wáár ze zitten, en de hover geeft het aantal.

          Zwak en onbeoordeeld staan apart en niet op één hoop: "we weten het nog niet" is geen
          slecht oordeel, dus onbeoordeeld krijgt geen teken. */}
      {dekking.zwak > 0 && (
        <span className="mb-0.5 h-1.5 w-1.5 shrink-0 self-center rounded-full bg-red-500" aria-hidden />
      )}
    </div>
  );
}

export function PmaxAssetCoverage({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<AssetRegel[] | null>(null);
  // Apart van `rows`: de kosten zijn een toevoeging en geen voorwaarde. Zou de kaart op allebei
  // wachten, dan verdwijnt hij als deze tabel leeg is of de query faalt -- terwijl de assetdekking
  // zelf prima te tonen is. Null betekent hier "nog niet binnen of niet beschikbaar".
  const [kosten, setKosten] = useState<Kosten | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase;
    if (!sb) { setRows([]); return; }
    // Zelfde venster als de netwerkkaart ernaast: anders gaan twee kaarten over dezelfde campagne
    // over een andere periode, en dan spreken ze elkaar tegen zonder dat iemand ziet waarom.
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    sb.from("ads_pmax_asset_performance")
      .select("asset_group_name, asset_id, asset_type, performance_label, month")
      .eq("client_id", clientId)
      .gte("month", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        setRows((data ?? []) as AssetRegel[]);
      }, () => { if (!cancelled) setRows([]); });

    // Op NAAM samengevoegd en niet op asset_group_id, omdat de dekking hierboven dat ook doet.
    // Twee gelijknamige groepen in twee campagnes tellen dus als één rij -- aan beide kanten,
    // dus het percentage blijft kloppen bij de assets waar het naast staat. Zouden de kosten wél
    // per id lopen en de assets niet, dan stond er een aandeel van de ene groep naast de assets
    // van twee.
    sb.from("ads_asset_group_performance_monthly")
      .select("asset_group_name, cost")
      .eq("client_id", clientId)
      .gte("month", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        const som: Record<string, number> = {};
        for (const r of data ?? []) {
          const naam = String(r.asset_group_name ?? "").trim();
          const c = Number(r.cost ?? 0);
          if (!naam || !Number.isFinite(c)) continue;
          som[naam] = (som[naam] ?? 0) + c;
        }
        setKosten(som);
      }, () => { if (!cancelled) setKosten(null); });

    return () => { cancelled = true; };
  }, [clientId]);

  const dekking = useMemo(
    () => (rows ? analyseerAssetdekking(rows, kosten ?? undefined) : null),
    [rows, kosten],
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
        <Layers className="h-4.5 w-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">Assets per groep</h3>
        <Uitleg label="Waar deze getallen vandaan komen">
          Per assetgroep het aantal assets van elk veldtype dat Google onderscheidt. De minima zijn
          Google&apos;s eigen eisen voor een serveerbare assetgroep — een groep eronder draait niet op
          alle plaatsingen. Een getal als <span className="font-semibold">2/3</span> betekent: twee
          aangeleverd, drie vereist. De balk naast elke groep is haar aandeel in de PMax-kosten over
          dezelfde periode — een gat in een groep die een derde van het budget draagt kost meer dan
          hetzelfde gat in een groep van twee procent.
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

          <div className={`${KOLOMMEN} border-b border-border px-5 pt-1 pb-1.5`}>
            <span />
            {TYPES.map((t) => (
              <span key={t.type} className={`text-right text-micro font-medium text-muted-foreground ${randKlasse(t)}`}>
                <UitlegKop
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
                    <div className="truncate text-body text-rm-gray" title={g.groep}>{g.groep}</div>
                    <div className="flex items-center gap-3">
                      {/* De regel die zegt wat je moet doen. Alleen als er iets te doen is: bij
                          een groep zonder gebrek is de lege ruimte de betere mededeling. */}
                      {actie && <span className="truncate text-micro text-amber-700" title={actie}>{actie}</span>}
                      {/* Het geld achter het gat. Een ontbrekende video in een groep van 2% en
                          dezelfde in een groep van 32% zijn niet hetzelfde probleem, en zonder dit
                          getal staan ze naast elkaar alsof ze dat wel zijn. */}
                      {g.kostenAandeel !== null && (
                        <span
                          className="ml-auto flex shrink-0 items-center gap-1.5"
                          title={`Deze groep draagt ${pctKort(g.kostenAandeel)} van de PMax-kosten in dit venster`}
                        >
                          {/* Zelfde baan-en-vulling als de ranglijst naast de wereldkaart, en om
                              dezelfde reden: twee percentages onder elkaar lees je als tekst, twee
                              balken zie je. Geschaald op het geheel en niet op de grootste -- hier
                              IS het een deel van een totaal, en dan hoort 32% ook een derde van de
                              baan te vullen. */}
                          <span
                            className="relative block h-1.5 w-16 overflow-hidden rounded-full"
                            style={{ background: "var(--spoor, rgba(15,23,42,0.07))" }}
                            aria-hidden
                          >
                            <span
                              className="absolute inset-y-0 left-0 rounded-full bg-rm-blue"
                              // Ondergrens van 1,5%: een groep met een klein maar echt budget hoort
                              // een streepje te krijgen in plaats van een lege baan.
                              style={{ width: `${Math.max(g.kostenAandeel * 100, 1.5)}%` }}
                            />
                          </span>
                          <span className="w-8 text-right text-micro tabular-nums text-muted-foreground">
                            {pctKort(g.kostenAandeel)}
                          </span>
                        </span>
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
