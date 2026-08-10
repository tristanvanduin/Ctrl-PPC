// Fase 7: het merkicoon voor de marketingsite (Blueprint v2.0). Een geometrisch getekende
// isometrische stapel van drie vlakke lagen, geen ingesloten raster: zo blijft hij scherp op elk
// formaat, van de favicon tot een hero op volle breedte. De bovenste en onderste laag zijn Onyx
// (twee tinten voor het linker/rechter vlak, voor het gevoel van diepte), de middelste laag is
// verlicht met Neon Indigo en krijgt een zachte gloed op de naden erboven en eronder.
//
// De kleuren staan hier als vaste hex-waarden, niet als CSS-variabelen: het merkicoon verandert
// niet mee met de licht/donker-schakelaar van het ingelogde dashboard (zie globals.css, de
// toelichting bij --color-midnight-slate) en moet ook correct renderen op plekken zonder dat
// stylesheet, zoals de losstaande favicon.

const ONYX_TOP = "#171b21";
const ONYX_LEFT = "#0a0c10";
const ONYX_RIGHT = "#12151b";
const INDIGO_LEFT = "#5457c4";
const INDIGO_RIGHT = "#818cf8";

/** Alleen het icoon, zonder wordmark. Voor de favicon, de zijbalk, of elke krappe plek. */
export function LogoMark({ className = "", title = "Ctrl PPC" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="-6 -6 132 150"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <filter id="ctrlppc-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Gloed op de naden boven en onder de middelste laag: het licht dat "ontsnapt" tussen de
          blokken, niet de blokken zelf. */}
      <ellipse cx="60" cy="85" rx="62" ry="8" fill={INDIGO_RIGHT} opacity="0.35" filter="url(#ctrlppc-glow)" />
      <ellipse cx="60" cy="113" rx="62" ry="8" fill={INDIGO_RIGHT} opacity="0.35" filter="url(#ctrlppc-glow)" />

      {/* Bovenste blok (Onyx): top-vlak + twee zijvlakken. */}
      <polygon points="60,0 120,30 60,60 0,30" fill={ONYX_TOP} />
      <polygon points="0,30 60,60 60,82 0,52" fill={ONYX_LEFT} />
      <polygon points="60,60 120,30 120,52 60,82" fill={ONYX_RIGHT} />

      {/* Middelste blok (Neon Indigo): geen top-vlak, die zit onder het blok erboven. */}
      <polygon points="0,58 60,88 60,110 0,80" fill={INDIGO_LEFT} filter="url(#ctrlppc-glow)" />
      <polygon points="60,88 120,58 120,80 60,110" fill={INDIGO_RIGHT} filter="url(#ctrlppc-glow)" />

      {/* Onderste blok (Onyx). */}
      <polygon points="0,86 60,116 60,138 0,108" fill={ONYX_LEFT} />
      <polygon points="60,116 120,86 120,108 60,138" fill={ONYX_RIGHT} />
    </svg>
  );
}

/**
 * De volledige lockup: icoon + wordmark ("CTRL" in off-white, "PPC" in koper) + optioneel de
 * tagline eronder. `compact` laat de tagline weg voor plekken waar de lockup op één regel moet
 * passen (bv. de marketing-navbalk).
 */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark className="h-10 w-auto shrink-0" />
      <div className="flex flex-col justify-center">
        <span className="font-marketing-heading text-2xl font-extrabold leading-none tracking-tight">
          <span className="text-off-white">CTRL</span>
          <span className="text-copper"> PPC</span>
        </span>
        {!compact && (
          <span className="mt-1 text-micro font-medium uppercase tracking-[0.2em] text-off-white/50">
            Performance Intelligence Platform
          </span>
        )}
      </div>
    </div>
  );
}
