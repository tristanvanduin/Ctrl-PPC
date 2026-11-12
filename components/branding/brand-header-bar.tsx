"use client";

import { CalendarClock } from "lucide-react";
import { useBrandTheme } from "./brand-theme-provider";
import { FAIR_GEO_CLONES } from "@/lib/fair/geo-clone-catalog";
import { fairCountdown, type UpcomingEdition } from "@/lib/fair/fair-weeks";
import { inkOn } from "@/lib/branding/chart-colors";
import { today } from "@/lib/reporting-date";

// De hero bovenaan de klantweergave.
//
// Dit was een regel: een logo van 36 pixels, de naam in normale tekst, en een streepje rechts.
// Functioneel klopte het, maar het is wél het eerste wat je ziet, en het zei niet waar je bent.
// Voor een beursorganisatie is dat precies de vraag: wélke beurs, en hoe ver is die nog weg.
//
// Nu een echte hero in de kleuren van het merk (of van de beurs, want de geo-clone kan een eigen
// branding-override hebben): logo, naam, de beurs waarin je zit, en de aftelling. De kleuren
// komen uit de CSS-variabelen die BrandThemeProvider zet — niet uit een vaste standaardkleur, want dit
// dashboard is bedoeld om white-label te draaien.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function BrandHeaderBar({
  geoClone,
  fallbackName,
  edition,
  compact = false,
}: {
  geoClone?: string | null;
  fallbackName?: string;
  /** De eerstvolgende beurs, als de klant er een heeft. Voedt de aftelling rechts. */
  edition?: UpcomingEdition | null;
  /**
   * De merkregel van de nieuwe weergave (bouwplan fase 3): een logo-tegel, de naam met een
   * merkstreep eronder, en de aftelling, op één regel van 32 pixels. De hero was 94 pixels zonder
   * één cijfer; zo staat het eerste kerncijfer dat stuk hoger. Dezelfde gegevens uit dezelfde
   * bronnen (thema, beurs, fairCountdown); alleen de vaste ondertitel "Alle beurzen en campagnes
   * van dit account" vervalt, want die stond er ook bij klanten zonder beurs.
   */
  compact?: boolean;
}) {
  const { theme, brandName } = useBrandTheme();
  const name = brandName || fallbackName || "Dashboard";
  const variant = geoClone ? FAIR_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null : null;
  const beursLabel = variant ? `${variant.brand} ${variant.location}` : geoClone;

  // Dezelfde aftelling als de beurssectie en de pacingkaarten (fairCountdown). In de nasleep
  // verdwijnt de chip: de editie blijft dan nog zes weken actief voor de beurssectie, maar "-2
  // weken tot" is geen aftelling.
  const aftelling = edition ? fairCountdown(edition.fairDate, today()) : null;
  const toonAftelling = edition != null && aftelling != null && aftelling.fase !== "nasleep";

  // Het verloop loopt van de primaire naar de accentkleur, en die kunnen elk om een andere
  // inktkleur vragen. Vragen ze om dezelfde, dan is de keuze eenvoudig. Verschillen ze — en dat
  // is bij beide echte paletten het geval, want zowel het standaardpalet (#4f46e5 → #f5960b) als de GreenTech-
  // demo (#0B7A3B → #8BC34A) zet een donkere primaire tegen een licht accent — dan is er geen
  // inkt die op beide uiteinden werkt, en gaat er een sluier over het verloop.
  //
  // 35% is geen smaakkwestie: zwart met dekking α verlaagt de relatieve luminantie ongeveer met
  // (1−α)^2,4. Het lichtste accent hierboven staat op L≈0,44; bij 25% zakt dat naar 0,22 en geeft
  // witte tekst 3,9:1 — te weinig voor de kleine letters in de aftel-chip, die precies aan die
  // kant van het verloop staat. Bij 35% wordt het 0,16 en dus 5,0:1. Verzacht dit niet zonder
  // opnieuw te rekenen.
  // inkOn rekent met hex. Een merkkleur die dat niet is (iemand typt "rebeccapurple") levert
  // geen oordeel maar stilzwijgend wit — dan is de sluier de veilige uitkomst, niet de gok.
  const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c.trim());
  const leesbaar = isHex(theme.primary) && isHex(theme.accent);
  const eensgezind = leesbaar && inkOn(theme.primary) === inkOn(theme.accent);
  const inkt = eensgezind ? inkOn(theme.primary) : "#ffffff";
  const sluier = eensgezind ? "bg-black/10" : "bg-black/35";
  // De chip moet tegen de inkt afsteken, niet tegen een aangenomen donkere achtergrond.
  const chipVulling = inkt === "#ffffff" ? "bg-white/15" : "bg-black/10";

  if (compact) {
    // Dezelfde zin als in de hero, op één regel: "2 weken tot GreenTech North America 2026".
    const aftelTekst = toonAftelling
      ? aftelling.fase === "beursweek"
        ? `Beursweek ${edition.eventName} ${edition.label}`
        : `${aftelling.weken} ${aftelling.weken === 1 ? "week" : "weken"} tot ${edition.eventName} ${edition.label}`
      : null;
    return (
      // Vanaf een tablet een ondergrens: liever de kiezer ernaast naar een eigen regel dan een naam
      // van drie letters met puntjes.
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:min-w-64">
        {theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={theme.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md border border-border bg-white object-contain p-0.5" />
        ) : (
          // De tegel in de merkkleur met de inkt die daarop het best leest (inkOn); geen hex, dan wit.
          <div
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-body font-bold"
            style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.accent})`, color: isHex(theme.primary) ? inkOn(theme.primary) : "#ffffff" }}
          >
            {initials(name)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-title font-bold leading-tight text-brand-gray" style={{ fontFamily: "var(--font-heading)" }}>{name}</h1>
          {/* De merkstreep: het verloop van de hero, teruggebracht tot drie pixels onder de naam. */}
          <span aria-hidden className="mt-0.5 block h-[3px] rounded-full" style={{ background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})` }} />
        </div>
        {beursLabel && (
          <p className="hidden min-w-0 truncate text-meta text-muted-foreground md:block">
            Beurs: <span className="font-semibold text-brand-gray">{beursLabel}</span>
          </p>
        )}
        {aftelTekst && (
          <p title={aftelTekst} className="flex min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-meta font-medium text-brand-gray sm:max-w-none">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{aftelTekst}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border"
      // Uit `theme` en niet uit de CSS-variabelen. Die variabelen worden pas op de root gezet
      // zódra de merkgegevens geladen zijn; tot dat moment is de gradient een ongeldige waarde en
      // valt de balk terug op grijs — een grijze blokkop boven een gekleurd dashboard. Op de
      // beurs-gescopete pagina bleef hij in demo-modus zelfs grijs staan. `theme` draagt
      // ondertussen gewoon DEFAULT_THEME, en het is bovendien dezelfde bron als waaruit de inkt
      // en de sluier hierboven berekend worden — die twee moeten wel over dezelfde kleur gaan.
      style={{ background: `linear-gradient(120deg, ${theme.primary}, ${theme.accent})` }}
    >
      <div className={`absolute inset-0 ${sluier}`} aria-hidden />

      <div
        className="relative flex flex-wrap items-center gap-4 px-5 py-4"
        style={{ color: inkt }}
      >
        {theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={theme.logoUrl} alt={name} className="h-12 w-12 rounded-lg object-contain bg-white p-1 shadow-sm shrink-0" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-white/95 flex items-center justify-center text-lead font-bold shrink-0" style={{ color: theme.primary }}>
            {initials(name)}
          </div>
        )}

        <div className="min-w-0 grow">
          <h1 className="text-xl font-bold leading-tight truncate" style={{ fontFamily: "var(--font-heading)" }}>
            {name}
          </h1>
          <p className="text-meta opacity-90 truncate">
            {beursLabel
              ? <>Beurs: <span className="font-semibold">{beursLabel}</span></>
              : "Alle beurzen en campagnes van dit account"}
          </p>
        </div>

        {/* De aftelling in de hero en niet alleen bij de prestatiekaart: het is de context waarin
            elk getal op deze pagina gelezen moet worden. */}
        {toonAftelling && (
          <div className={`shrink-0 rounded-lg ${chipVulling} backdrop-blur-sm px-3.5 py-2 flex items-center gap-2.5`}>
            <CalendarClock className="w-4.5 h-4.5 opacity-80" />
            {/* In de beursweek "Beursweek" en niet "0 weken tot": in de week waarin de beurs
                plaatsvindt valt er niets meer af te tellen, en op de dagen na een woensdagbeurs
                stond er anders nog steeds "0 weken tot" een beurs die al geweest was. */}
            <div className="leading-tight">
              <div className="text-lead font-bold">
                {aftelling.fase === "beursweek"
                  ? "Beursweek"
                  : `${aftelling.weken} ${aftelling.weken === 1 ? "week" : "weken"}`}
              </div>
              <div className="text-micro opacity-90">
                {aftelling.fase === "beursweek" ? "" : "tot "}{edition.eventName} {edition.label}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
