"use client";

import { CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { CHART_GRID, CHART_AXIS } from "@/lib/branding/chart-colors";

// De chrome om elke grafiek heen: raster, assen, tooltip, legenda.
//
// Waarom dit bestand er is: elke grafiek schreef zijn eigen as- en rasterinstellingen, en dat
// liep uiteen op precies de dingen die een dashboard goedkoop laten ogen. Zes van de zes rasters
// stonden op strokeDasharray="3 3" — een gestippeld raster leest als "prognose" of "drempel"
// terwijl het gewoon een raster is, en het voegt ruis toe over de hele plot. De y-as toonde rauwe
// getallen (26000), de tooltip was de ongestileerde standaard van de library, en de legenda stond
// als kleine blokjes onderaan.
//
// Dat zijn geen smaakverschillen maar bekende faalgevallen. Ze staan hier één keer goed, zodat
// een nieuwe grafiek ze niet opnieuw hoeft uit te vinden.

// ── Getallen ───────────────────────────────────────────────────────────────
// Assen krijgen compacte getallen: "26k" leest in één oogopslag, "26000" moet je tellen. De
// tooltip krijgt het volledige getal, want daar is precisie het doel.

export function kortGetal(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${kort(v / 1_000_000, a >= 10_000_000)}M`;
  if (a >= 1_000) return `${kort(v / 1_000, a >= 10_000)}k`;
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
}

/**
 * Eén decimaal, maar niet als die nul is. Op een as met de stappen 0 / 5k / 10k / 15k stond
 * "€ 5,0k" tussen "€ 10k" en "€ 15k": dezelfde grootheid, drie keer anders geschreven. De komma-nul
 * draagt geen informatie — hij is er alleen omdat 5000 onder de tienduizend valt.
 */
function kort(v: number, heel: boolean): string {
  const s = v.toFixed(heel ? 0 : 1);
  return (s.endsWith(".0") ? s.slice(0, -2) : s).replace(".", ",");
}

/**
 * Balkbreedte naar het aantal categorieën — altijd onder het plafond.
 *
 * Hier stond 48 / 36 / 26 pixels, met als redenering dat vier dunne staafjes op een brede plot
 * "leeg" ogen. Dat was mijn eigen redenering en hij is fout. De mark-specificatie zegt: een balk
 * is HOOGSTENS 24 pixels dik, vul het vak nooit, en wat overblijft is lucht — geen gebrek.
 *
 * Dat is ook precies de reden dat het verzadigde palet werkt. Datzelfde document zegt: verzadigde
 * vullingen horen bij kleine marks en accenten, nooit bij grote blokken. Een balk van 48 pixels in
 * vol blauw is zo'n blok — dan lees je het als een verfvlak in plaats van als een meetwaarde, en
 * dat is wat een grafiek uit een spreadsheet laat lijken. Dezelfde kleur op een dunne mark leest
 * als data.
 *
 * De lucht die overblijft is dus het ontwerp, niet het probleem — maar wel begrensd. Vier balken
 * van vierentwintig in een vlak van duizend pixels is negen procent inkt, en dat leest als leegte.
 * Het antwoord daarop is niet een dikkere balk maar een smaller vlak: zie `plotBreedte`.
 */
export function balkBreedte(aantalCategorieen: number): number {
  if (aantalCategorieen <= 4) return BALK_MAX;
  if (aantalCategorieen <= 8) return 18;
  return 12;
}

export function kortEuro(v: number): string {
  return `€ ${kortGetal(v)}`;
}

/**
 * Hetzelfde als kortEuro, maar met een harde spatie tussen het teken en het getal.
 *
 * Een label boven een balk krijgt van recharts de breedte van die balk mee, en bij een balk van
 * vierentwintig pixels brak "€ 10k" op de spatie: het euroteken op de ene regel, "10k" op de
 * volgende — en bij de laatste balk verdween het teken zelfs helemaal. Een harde spatie geeft geen
 * breekpunt, dus blijft het bedrag één woord.
 */
export function kortEuroLabel(v: number): string {
  return `€\u00A0${kortGetal(v)}`;
}

export function volledigEuro(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

export function volledigGetal(v: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(v);
}

/**
 * "2026-02" of "2026-02-01" → "feb '26". Een ISO-maand op een as is een sleutel, geen label; je
 * moet hem lezen als tekst in plaats van herkennen als tijdstip.
 */
const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export function maandLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return String(v ?? "");
  const maand = MAANDEN[Number(m[2]) - 1];
  return maand ? `${maand} '${m[1].slice(2)}` : String(v);
}

// ── Raster en assen ────────────────────────────────────────────────────────

/**
 * Het raster: alleen horizontale hairlines, doorgetrokken, één tint van het vlak af. Verticale
 * lijnen voegen bij een categorische x-as niets toe — de balken staan er zelf al.
 */
export function Raster() {
  return <CartesianGrid stroke={CHART_GRID} strokeWidth={1} vertical={false} />;
}

const AS_TICK = { fontSize: 11, fill: CHART_AXIS } as const;

/**
 * De x-as, recessief: geen aslijn, geen tickstreepjes, alleen de tekst.
 *
 * `scale="band"` staat er expliciet en niet op automatisch. Recharts kiest anders per grafiek:
 * een grafiek mét balken krijgt een band-schaal (categorie = een vak, de balk staat in het
 * midden), een grafiek met alleen een lijn krijgt een punt-schaal (categorie = een streep, het
 * eerste punt plakt tegen de linkerrand). Twee panelen onder elkaar — balken boven, lijn onder —
 * staan dan een halve categoriebreedte uit elkaar.
 *
 * Dat was hier niet theoretisch: de balken stonden op 510, 778, 1045 en 1313 pixels en de
 * lijnpunten op 52, 409, 765 en 1122. Een lezer die de piek in de spend naast het aantal acties
 * van diezelfde maand legt, las een punt dat tussen twee maanden in hing. Precies het verband dat
 * het splitsen van de dubbele as moest bewaren, was daarmee weg.
 */
export function AsX({ dataKey, formatter, basislijn = false }: {
  dataKey: string;
  formatter?: (v: string) => string;
  /**
   * Trek de nullijn wél. Nodig in een vlak zonder raster: zonder één horizontale lijn zweven de
   * balken en is er niets wat "nul" aanwijst.
   */
  basislijn?: boolean;
}) {
  return (
    <XAxis
      dataKey={dataKey}
      type="category"
      scale="band"
      tick={AS_TICK}
      tickLine={false}
      axisLine={basislijn ? { stroke: CHART_GRID, strokeWidth: 1 } : false}
      tickMargin={10}
      tickFormatter={formatter}
      minTickGap={16}
    />
  );
}

/**
 * De y-as, idem, met compacte getallen. `width` houdt de plot links uitgelijnd tussen grafieken.
 *
 * `stil` houdt die breedte vast maar tekent geen getallen. Dat is voor het geval waarin elke balk
 * zijn eigen bedrag draagt: dan zijn de asgetallen dezelfde informatie voor de tweede keer. Zonder
 * de as helemaal weg te laten, want twee panelen boven elkaar moeten links op dezelfde pixel
 * beginnen — anders staan de balken en de lijn eronder niet meer boven elkaar.
 */
export function AsY({ formatter = kortGetal, width = 52, domain, tickCount = 5, stil = false }: {
  formatter?: (v: number) => string;
  width?: number;
  domain?: [number | string, number | string];
  tickCount?: number;
  stil?: boolean;
}) {
  if (stil) return <YAxis tick={false} tickLine={false} axisLine={false} width={width} domain={domain} tickCount={tickCount} />;
  return (
    <YAxis
      tick={AS_TICK}
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      width={width}
      domain={domain}
      tickCount={tickCount}
      allowDecimals={false}
      tickFormatter={(v: number) => formatter(v)}
    />
  );
}

/**
 * Een y-schaal met ronde stappen en zo min mogelijk loze ruimte boven de hoogste balk.
 *
 * Zonder dit verdeelt recharts het datamaximum in gelijke stukken en krijg je stappen als
 * "€ 6,5k" en "€ 13k" — getallen die je moet uitrekenen in plaats van aflezen. Maar alleen
 * afronden naar boven is ook niet goed: een plafond van € 40k boven een maximum van € 26k duwt
 * alle balken naar beneden en maakt de verschillen kleiner dan ze zijn.
 *
 * Daarom eerst een ronde stap kiezen (1, 2, 2,5 of 5 maal een macht van tien) en het plafond dan
 * op het eerste veelvoud daarvan boven het maximum leggen. Het aantal ticks volgt daaruit, zodat
 * elke tick op een ronde stap valt.
 */
export function asSchaal(max: number, gewensteStappen = 4): { domain: [number, number]; tickCount: number } {
  if (!Number.isFinite(max) || max <= 0) return { domain: [0, 1], tickCount: 2 };
  return kiesSchaal(max, gewensteStappen);
}

/**
 * Dezelfde schaal, maar met wat lucht boven de hoogste waarde.
 *
 * Voor balken is een strak plafond juist goed: de balk eindigt op zijn waarde en die mag de
 * bovenrand raken. Voor een lijn niet. Die heeft dikte, en een ronde punt op het hoogste punt is
 * nog eens vier pixels extra — raakt de waarde het plafond, dan wordt de bovenste helft van de
 * lijn door de rand van het vlak afgesneden. In de prognosegrafiek lag de lijn op tien pixels van
 * de bovenkant van een vlak van honderd, en dat las als een lijn die uit beeld liep in plaats van
 * als een reeks die vlak loopt.
 *
 * Acht procent is genoeg om de lijn vrij te laten en weinig genoeg om de vorm niet plat te drukken.
 */
export function asSchaalLijn(max: number, gewensteStappen = 4): { domain: [number, number]; tickCount: number } {
  if (!Number.isFinite(max) || max <= 0) return { domain: [0, 1], tickCount: 2 };
  return kiesSchaal(max * 1.08, gewensteStappen);
}

function kiesSchaal(max: number, gewensteStappen: number): { domain: [number, number]; tickCount: number } {

  // Alle ronde stappen rond de grootteorde van max/stappen, niet één berekende. Eén stap kiezen
  // uit een formule gaf soms te grof: bij max 47 werd het stap 20 en dus plafond 60, ruim een
  // kwart loze ruimte. Door de kandidaten langs te lopen en die met het laagste plafond te
  // kiezen — mits het aantal ticks leesbaar blijft — komt het plafond zo dicht mogelijk op de
  // data te liggen zonder de ronde stappen op te geven.
  const macht = Math.pow(10, Math.floor(Math.log10(max / gewensteStappen)));
  const kandidaten: number[] = [];
  for (const schaal of [macht / 10, macht, macht * 10]) {
    for (const g of [1, 2, 2.5, 5]) kandidaten.push(g * schaal);
  }

  let beste: { domain: [number, number]; tickCount: number } | null = null;
  for (const stap of kandidaten.sort((a, b) => a - b)) {
    if (stap <= 0) continue;
    const plafond = Math.ceil(max / stap) * stap;
    const ticks = Math.round(plafond / stap) + 1;
    if (ticks < 3 || ticks > 6) continue;
    // Het laagste plafond wint, maar niet tegen elke prijs: zit een kandidaat binnen een tiende
    // van het beste plafond en heeft hij minder ticks, dan wint die. Acht rasterlijnen halen een
    // paar procent lucht weg en geven er drukte voor terug — en het raster hoort recessief te zijn.
    if (!beste) { beste = { domain: [0, plafond], tickCount: ticks }; continue; }
    const beterPlafond = plafond < beste.domain[1];
    const gelijkwaardigMaarRustiger = plafond <= beste.domain[1] * 1.1 && ticks < beste.tickCount;
    if (beterPlafond || gelijkwaardigMaarRustiger) beste = { domain: [0, plafond], tickCount: ticks };
  }
  // Geen enkele kandidaat leesbaar (extreem kleine of grote waarden): dan de eenvoudige afronding.
  return beste ?? { domain: [0, max], tickCount: 3 };
}

/** Ruimte rond de plot. Rechts wat lucht zodat het laatste punt niet tegen de rand plakt. */
export const PLOT_MARGE = { top: 8, right: 16, left: 0, bottom: 4 } as const;

/**
 * Dezelfde marge, maar met ruimte rechts en boven voor directe labels.
 *
 * Een serienaam boven de laatste balk staat gecentreerd op die balk, en de laatste balk staat
 * tegen de rechterrand. Met de gewone marge van zestien pixels liep "LinkedIn" het vlak uit — te
 * zien in de schermafdruk, niet in de code en niet in de types. Zesenvijftig is genoeg voor de
 * halve breedte van het langste kanaallabel; boven twintig zodat het label van de hoogste balk
 * niet tegen de bovenrand plakt.
 */
export const PLOT_MARGE_LABELS = { top: 20, right: 56, left: 0, bottom: 4 } as const;

/**
 * Dezelfde marge, met alleen boven ruimte: voor een plot waarin elke balk zijn waarde draagt.
 *
 * De y-as sluit strak op het maximum aan (zie `asSchaal`), dus de hoogste balk raakt de bovenrand
 * van het vlak en zijn label zou er acht pixels bóven vallen — buiten de plot, tegen het kopje
 * "Spend" aan. Rechts is de gewone lucht genoeg: een waardelabel staat gecentreerd op een balk van
 * vierentwintig pixels en is korter dan een kanaalnaam.
 */
export const PLOT_MARGE_WAARDEN = { top: 22, right: 16, left: 0, bottom: 4 } as const;

/** Marge voor een lijn die zijn laatste waarde náást het eindpunt draagt. */
export const PLOT_MARGE_EIND = { top: 12, right: 52, left: 0, bottom: 4 } as const;

// ── Tooltip ────────────────────────────────────────────────────────────────

/**
 * De tooltip. De standaard van de library is een witte doos met een harde rand en de serienamen
 * in de seriekleur; dat laatste is fout — tekst draagt tekstkleur, een gekleurd blokje ernaast
 * draagt de identiteit. Anders is de kleur de enige drager van betekenis.
 */
// De tooltip-props van recharts zijn per versie anders getypeerd; deze vorm is wat we er
// werkelijk uit lezen, en die is stabiel gebleven.
interface TipDeel { name?: string; value?: number | string; color?: string }
interface TipProps { active?: boolean; payload?: TipDeel[]; label?: unknown; formatter?: (v: number) => string }

function TipInhoud({ active, payload, label, formatter }: TipProps) {
  if (!active || !payload?.length) return null;
  const fmt = formatter ?? volledigGetal;
  return (
    // `bg-card` en niet `bg-white`. Dat laatste is letterlijk wit en weet niets van het thema, dus
    // in donkere modus stond hier een witte doos met de lichte donkere-modus-inkt erop: grijs op
    // wit, praktisch onleesbaar. Precies de reden waarom `bg-white` elders in deze codebase al was
    // vervangen — deze plek was overgeslagen, en alleen zichtbaar als je hovert.
    //
    // En dit is de tweede plek waar glas écht glas is: een tooltip zweeft over de plot, dus er is
    // een achtergrond om te vervagen. Vandaar meer doorzicht en meer blur dan de 95% die er stond;
    // op vijfennegentig procent zag je er niets doorheen en was het effect alleen kosten.
    <div className="rounded-lg border border-border bg-[var(--tip-vlak)] backdrop-blur-md shadow-lg px-3 py-2 text-meta">
      {/* Door dezelfde opmaker als de as. De as zei "mei '26" en de tooltip eronder "2026-05":
          twee schrijfwijzen voor dezelfde maand, tien pixels uit elkaar. */}
      {label != null && <div className="font-semibold text-brand-gray mb-1">{maandLabel(String(label))}</div>}
      <div className="space-y-0.5">
        {payload.map((p: TipDeel, i: number) => (
          <div key={`${p.name}-${i}`} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-semibold text-brand-gray tabular-nums">
              {typeof p.value === "number" ? fmt(p.value) : String(p.value ?? "—")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tip({ formatter }: { formatter?: (v: number) => string }) {
  return (
    <Tooltip
      // Een vulling over de hele balkgroep als hover-doel: mikken op een dunne balk is geen
      // interactie maar een test.
      cursor={{ fill: "var(--hover-vlak, rgba(15, 23, 42, 0.04))" }}
      content={(props: unknown) => <TipInhoud {...(props as TipProps)} formatter={formatter} />}
    />
  );
}

// ── Legenda ────────────────────────────────────────────────────────────────

export interface LegendaItem { label: string; kleur: string }

/**
 * De legenda, boven de plot in plaats van eronder: je leest hem vóór de grafiek, niet erna.
 * Altijd aanwezig zodra er twee of meer series zijn — bij één serie zegt de titel het al.
 *
 * Dit is niet alleen leesbaarheid. Het palet haalt de harde kleurenblind-checks, maar drie tinten
 * komen onder 3:1 contrast met het vlak uit; die uitkomst verplicht zichtbare labels. Deze
 * legenda is die verplichting, niet een versiering.
 */
export function Legenda({ items, className = "" }: { items: LegendaItem[]; className?: string }) {
  if (items.length < 2) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.kleur }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Balken ─────────────────────────────────────────────────────────────────
// Dunne marks met een afgeronde kop aan het data-einde, en lucht tussen de balken in plaats van
// een rand eromheen. Randen om marks zijn een anti-pattern: de scheiding hoort een gat in het
// vlak te zijn.

/**
 * Een verticaal verloop per serie, als SVG-definitie.
 *
 * Waarom dit mag en 3D niet. Een balk codeert zijn waarde in HOOGTE — dat is de hele afspraak. Een
 * 3D-balk zet er een bovenvlak op: oppervlak dat geen data is, en waardoor de bovenrand niet meer
 * op één hoogte tegen de as ligt. Je kunt de waarde dan niet meer aflezen, en dat is het enige wat
 * een grafiek moet kunnen. Een verloop raakt de hoogte niet aan: de bovenrand blijft één scherpe
 * lijn op precies de waarde, alleen de vulling eronder ademt.
 *
 * Van boven naar beneden en niet andersom: de bovenkant is waar je afleest, dus die krijgt de volle
 * kleur. Naar de basislijn toe zakt hij weg, wat de balk optisch op de as laat staan in plaats van
 * erop te plakken. Ruim een kwart minder dekking onderaan is genoeg om te zien en te weinig om als
 * een tweede waarde te lezen — het verloop blijft binnen één hue, dus de balk houdt één identiteit.
 */
export function BalkVerloop({ id, kleur }: { id: string; kleur: string }) {
  return (
    <defs>
      {/* De gloed onder de balk, als SVG-filter zodat hij de kleur van déze serie krijgt.
          Via CSS lukt dat niet: één plot draagt meerdere series en een klasse kan geen kleur
          meenemen. `feDropShadow` kan dat wel, want hij staat naast het verloop in dezelfde defs.

          Onder de balk en niet eromheen. In de referentie omgeeft de gloed de hele balk, dus ook
          de BOVENrand — en dat is precies de rand waar je de waarde afleest. Een halo daar maakt
          het aflezen onnauwkeurig; dezelfde fout als een 3D-balk, alleen milder. Een verticale
          verschuiving van drie pixels legt het schijnsel op het vlak eronder, waar geen waarde
          staat: je krijgt de diepte en de bovenrand blijft één scherpe lijn.

          Alleen in donkere modus zichtbaar: `--gloed-sterkte` staat op nul in het licht, want op
          een licht vlak wordt een gekleurde gloed geen schijnsel maar vuil. */}
      <filter id={`${id}-gloed`} x="-50%" y="-20%" width="200%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={kleur} floodOpacity="var(--gloed-sterkte, 0)" />
      </filter>
      {/* De seriekleuren zijn `var(--serie-n, …)` zodat donkere modus meebeweegt. Ik heb eerst
          `style` gebruikt in de veronderstelling dat een var() in een presentatie-attribuut niet
          vervangen wordt. Dat is niet zo — nagemeten met twee identieke gradiënten naast elkaar,
          één met `stop-color` als attribuut en één via style: allebei rgb(42,120,214), geen zwarte
          terugval. Dus gewoon het attribuut, net als de `stroke` elders in dit bestand. */}
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={kleur} stopOpacity={1} />
        <stop offset="100%" stopColor={kleur} stopOpacity={0.72} />
      </linearGradient>
    </defs>
  );
}

/**
 * De wassing onder een lijn: dezelfde tint op tien procent, uitlopend naar niets.
 *
 * Tien procent is het cijfer uit de mark-specificatie, en de reden staat erbij: een wassing geeft
 * een reeks gewicht, een verzadigd vlak zou een tweede grootheid suggereren die er niet is. Naar
 * beneden toe naar nul, zodat de vulling nergens met de nullijn concurreert.
 *
 * De dekking komt uit `--was-dekking` en niet uit dit bestand: op een bijna zwart vlak is tien
 * procent een veel grotere sprong dan op wit, en las de wassing als een grijze plaat. Nagemeten in
 * de donkere schermafdruk, niet beredeneerd.
 */
export function VlakWas({ id, kleur }: { id: string; kleur: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={kleur} stopOpacity="var(--was-dekking, 0.1)" />
        <stop offset="100%" stopColor={kleur} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/** Een geldige, stabiele SVG-id voor het verloop van een serie. */
export function verloopId(sleutel: string, index: number): string {
  return `balk-verloop-${index}-${sleutel.replace(/[^a-zA-Z0-9]/g, "")}`;
}

export const BALK_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
/**
 * Maximale balkbreedte: vierentwintig pixels, het plafond uit de mark-specificatie. Zonder
 * begrenzing rekt recharts de balken uit tot de groep vol is, en dan krijg je brede verzadigde
 * blokken — dat leest luid, bijna kinderlijk. Verzadigde vulling hoort bij kleine marks.
 */
export const BALK_MAX = 24;
/** Ruimte tussen de balken binnen één groep, en tussen de groepen onderling. */
export const BALK_GAP = 2;
export const GROEP_GAP = "22%";

/**
 * De breedte die een plot hoogstens krijgt, gegeven het aantal categorieën.
 *
 * Het plafond op de balkbreedte heeft een keerzijde die pas in een schermafdruk te zien is. Een
 * kaart is hier ruim elfhonderd pixels breed; vier balken van vierentwintig is zesennegentig
 * pixels inkt in duizend pixels vlak — negen procent. Dat leest niet als lucht maar als leegte: de
 * balken staan als losse luciferhoutjes in een wit veld, en dat is precies waar "het lijkt wel een
 * spreadsheet" vandaan komt. De balken breder maken mag niet (dan wordt het een verfvlak), dus
 * moet het vlak smaller.
 *
 * Honderddertig pixels per categorie is de bovengrens: genoeg dat een groep van drie balken lucht
 * om zich heen houdt, weinig genoeg dat de reeks één figuur blijft in plaats van uiteen te vallen.
 * Zijn er veel categorieën, dan komt de rekensom boven de kaartbreedte uit en verandert er niets —
 * dit knijpt alleen de gevallen af waar de data de breedte niet vult.
 */
export const VAK_MAX = 130;
/** Wat er naast de balken nog aan vlak nodig is: de aslabels links en wat lucht rechts. */
const AS_KOLOM = 72;

export function plotBreedte(aantalCategorieen: number): number {
  return AS_KOLOM + aantalCategorieen * VAK_MAX;
}
