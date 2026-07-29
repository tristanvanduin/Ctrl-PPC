"use client";

import { CalendarClock } from "lucide-react";
import { useBrandTheme } from "./brand-theme-provider";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";
import { weeksToFair, type UpcomingEdition } from "@/lib/rai/fair-weeks";
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
// komen uit de CSS-variabelen die BrandThemeProvider zet — niet uit een vaste RM-kleur, want dit
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
}: {
  geoClone?: string | null;
  fallbackName?: string;
  /** De eerstvolgende beurs, als de klant er een heeft. Voedt de aftelling rechts. */
  edition?: UpcomingEdition | null;
}) {
  const { theme, brandName } = useBrandTheme();
  const name = brandName || fallbackName || "Dashboard";
  const variant = geoClone ? RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null : null;
  const beursLabel = variant ? `${variant.brand} ${variant.location}` : geoClone;

  const wekenTotBeurs = edition ? weeksToFair(edition.fairDate, today()) : null;

  // Het verloop loopt van de primaire naar de accentkleur, en die kunnen elk om een andere
  // inktkleur vragen. Vragen ze om dezelfde, dan is de keuze eenvoudig. Verschillen ze — en dat
  // is bij beide echte paletten het geval, want zowel RM (#08288C → #F16B37) als de GreenTech-
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
        {wekenTotBeurs != null && wekenTotBeurs >= 0 && (
          <div className={`shrink-0 rounded-lg ${chipVulling} backdrop-blur-sm px-3.5 py-2 flex items-center gap-2.5`}>
            <CalendarClock className="w-4.5 h-4.5 opacity-80" />
            <div className="leading-tight">
              <div className="text-lead font-bold">
                {wekenTotBeurs} {wekenTotBeurs === 1 ? "week" : "weken"}
              </div>
              <div className="text-micro opacity-90">
                tot {edition!.eventName} {edition!.label}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
