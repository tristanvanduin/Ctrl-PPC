"use client";

// De markten als ranglijst, naast de kaart.
//
// ── WAAROM NAAST EN NIET IN PLAATS VAN ──────────────────────────────────────
//
// De kaart codeert LIGGING; de ranglijst codeert RANGORDE. Dat zijn twee vragen. "Waar zitten
// onze markten" beantwoordt de kaart in één oogopslag; "wie is de grootste en hoeveel scheelt dat
// met nummer twee" leest niemand van een projectie af -- daarvoor moet je landen op oppervlakte
// vergelijken, en Groenland wint dat altijd.
//
// Hiervoor stond die rangorde alleen in de tabel eronder, en die begint dichtgeklapt. Het gevolg:
// een blok van 481 pixels waarvan het grootste deel leeggrijs is, met de eigenlijke cijfers een
// klik weg.
//
// ── DE BALK CODEERT DE GROOTTE, ALTIJD ──────────────────────────────────────
//
// Niet omgedraaid bij CPA om "lang = goed" te forceren. Dan krijgt de duurste regio een balk van
// nul, en dat leest als ontbrekende data in plaats van als een hoge CPA. De sortering regelt al
// wat beter is: bij CPA staat de goedkoopste bovenaan.

/**
 * De balklengte als fractie van de grootste, 0..1.
 *
 * Ten opzichte van de GROOTSTE en niet van het totaal: dit is een ranglijst en geen
 * deel-van-geheel. Zou hij op het totaal schalen, dan is de langste balk bij vier ongeveer gelijke
 * landen een kwart lang en springt er niets uit, terwijl het beeld juist de verhouding tot nummer
 * één moet tonen. Onzin levert 0 -- een balk die de andere kant op steekt is erger dan geen balk.
 */
export function balkFractie(waarde: number, grootste: number): number {
  if (!Number.isFinite(waarde) || !Number.isFinite(grootste) || grootste <= 0) return 0;
  if (waarde <= 0) return 0;
  return Math.min(waarde / grootste, 1);
}

export type Ranglijstregel = {
  code: string;
  label: string;
  waarde: number | null;
  /** Al opgemaakt door de aanroeper, die de metric en dus het formaat kent. */
  weergave: string;
};

export function GeoRanglijst({
  regels,
  metriekLabel,
  onKlik,
  klikbaar,
  totalen,
}: {
  regels: readonly Ranglijstregel[];
  metriekLabel: string;
  /** Onderaan de kolom, als samenvatting. Losse regels zodat de aanroeper de opmaak bepaalt. */
  totalen?: readonly { label: string; waarde: string }[];
  /** Doorklikken op een regio, als die een niveau dieper heeft. */
  onKlik?: (code: string) => void;
  klikbaar?: (code: string) => boolean;
}) {
  // Zonder regels EN zonder totalen valt er niets te tonen. Met alleen totalen wel: dat is de
  // stand waarin de balken al in de kaart erboven hangen (zie GeoRanglijstInKaart) en deze kaart
  // nog de cijfers draagt. Een kale `regels.length === 0`-afvang maakte die kaart leeg -- alleen
  // een kop en een uitklapknop boven een half scherm wit.
  if (regels.length === 0 && !totalen?.length) return null;
  const grootste = regels.reduce((m, r) => Math.max(m, r.waarde ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      {regels.length > 0 && (
        <p className="mb-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          {metriekLabel} per regio
        </p>
      )}
      <ol className="space-y-3">
        {regels.map((r, i) => {
          const kanKlikken = Boolean(onKlik && klikbaar?.(r.code));
          return (
            <li
              key={r.code}
              onClick={kanKlikken ? () => onKlik!(r.code) : undefined}
              className={`rounded-md px-1 py-0.5 ${kanKlikken ? "cursor-pointer hover:bg-muted/60" : ""}`}
              title={kanKlikken ? "Klik om een niveau dieper te gaan" : undefined}
            >
              {/* Naam en getal op één regel, de balk eronder over de volle kolombreedte. Naast
                  elkaar in een kolom van 272px zou de baan zo smal worden dat het verschil tussen
                  230 en 120 niet meer te zien is -- en dan is de balk decoratie. */}
              <div className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 text-right text-meta tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-brand-gray">
                  {r.label}
                  {kanKlikken && <span className="ml-1 text-meta text-muted-foreground">&rarr;</span>}
                </span>
                <span className="shrink-0 text-body font-semibold tabular-nums text-brand-blue-ink">
                  {r.weergave}
                </span>
              </div>
              {/* Baan op --spoor, net als de aandeelstrepen in de tabellen. Hoogte 8px: ruim onder
                  het plafond van 24 waarboven een verzadigde vulling als verfvlak leest. */}
              <span
                className="relative mt-1 ml-6 block h-2 overflow-hidden rounded-full"
                style={{ background: "var(--spoor, rgba(15,23,42,0.07))" }}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand-blue"
                  style={{
                    // Ondergrens van 1,5%: een regio met een kleine maar echte waarde hoort een
                    // streepje te krijgen. Bij een ontbrekende waarde niets -- daar is niets gemeten.
                    width: r.waarde == null ? "0%" : `${Math.max(balkFractie(r.waarde, grootste) * 100, 1.5)}%`,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ol>

      {/* Het totaal onderaan, niet bovenaan: eerst wie de grootste is, dan hoeveel het samen is.
          Het vult bovendien de ruimte die anders overbleef naast een kaart die hoger is dan deze
          lijst -- en een leeg vlak naast een kaart leest als een blok dat niet geladen is.

          Als 2-koloms rooster van kleine kaartjes i.p.v. een verticale lijst (17.36): een rij
          label/getal-paren onder elkaar leest als bijschrift, een rooster van eigen kaartjes leest
          als cijfers die het bekijken waard zijn -- zelfde `--spoor`-rand als de aandeelbalk erboven,
          geen nieuwe kleur erbij.

          Container-breekpunten en geen vaste twee kolommen: deze zes tegels staan zowel in een
          halfbrede kolom als over de volle schermbreedte. Op vol scherm stonden ze in twee
          kolommen van 700px met een getal van vier tekens erin -- dezelfde "te breed uitgestrekt"
          die de hero ook had. Zes tegels naast elkaar vullen die breedte wél. */}
      {totalen && totalen.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-1.5 border-t border-border pt-3 @2xl:grid-cols-3 @5xl:grid-cols-6">
          {totalen.map((t) => (
            <div key={t.label} className="rounded-lg border border-border/70 bg-muted/40 px-2 py-1.5">
              <dt className="text-micro text-muted-foreground leading-tight">{t.label}</dt>
              <dd className="text-body font-semibold tabular-nums text-brand-gray leading-tight">{t.waarde}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
