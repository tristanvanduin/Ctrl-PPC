import Link from "next/link";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Logo } from "@/components/ui/logo";
import { MobileNav } from "@/components/marketing/mobile-nav";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Fase 7: de marketingsite (Blueprint v2.0). Eigen chrome, los van de ingelogde dashboard-shell
// in app/(app)/layout.tsx -- geen Sidebar, geen TopBar, geen klantnavigatie. Satoshi staat niet
// op Google Fonts en er zijn geen gelicenseerde bestanden beschikbaar; Plus Jakarta Sans is de
// tijdelijke vervanger voor de koppen (visueel vergelijkbaar: geometrisch, hoge x-hoogte), tot
// echte Satoshi-bestanden er zijn voor next/font/local. JetBrains Mono draagt de data-elementen,
// ROI-calculator en diagnostische UI, exact zoals de brief vraagt.
//
// SERVER COMPONENT SINDS DE AUDIT VAN 11 AUGUSTUS 2026. Deze layout stond op "use client" voor
// precies één useState (het mobiele hamburgermenu open/dicht), en dat betekende dat elke
// marketingpagina -- header, desktop-nav, footer, alles -- als client-JS moest hydrateren voor een
// toggle die de meeste sessies nooit aanraken. Die state zit nu geisoleerd in
// components/marketing/mobile-nav.tsx; deze layout is weer een gewone server component.
//
// LANG-FIX (audit, 11 augustus 2026). app/layout.tsx zet <html lang="nl">, terecht voor het
// ingelogde product (Nederlandstalig door de hele UI), fout voor de Engelstalige marketingsite die
// eronder hangt -- dat is elke pagina in deze layout. Next staat maar één <html>-declaratie toe,
// in de root layout, en een geneste layout (deze) kan hem niet overschrijven. Een middleware-route
// die per pad een ander lang-attribuut server-side zou zetten kan wel, maar middleware.ts bewaakt
// vandaag de hele auth-poort (zie de koptekst daar: "LIVE-ONGETEST", meerdere vroege returns) --
// daar een tweede, losstaande verantwoordelijkheid doorheen weven voor een cosmetisch attribuut is
// niet de afweging waard.
//
// In plaats daarvan hetzelfde patroon als THEMA_INIT_SCRIPT in app/layout.tsx: een inline script
// dat vóór de rest van de pagina draait en het attribuut corrigeert. Google's indexeerder rendert
// JavaScript voordat hij een pagina beoordeelt, dus dit is voor de zoekmachine die het meest
// uitmaakt volledig gelijkwaardig aan een server-side fix. Een crawler die geen JS uitvoert ziet
// nog heel even "nl" in de ruwe HTML -- een reële maar kleine resterende onvolkomenheid, en de
// juiste vervolgstap zou een eigen, kleine proxy-laag zijn die alleen dit doet, niet uitbreiding
// van de auth-poortwachter.
const LANG_FIX_SCRIPT = `document.documentElement.lang="en";`;

// Geen "Home"-item: het logo linkt al naar / (zie de Link eromheen hieronder), en een los
// "Home"-item ernaast is een dubbele knop voor dezelfde bestemming (audit-vervolg, 11 augustus
// 2026). Scheelt ook meteen een navlink op precies het breakpoint dat al krap zat.
const NAV_LINKS = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/vs", label: "Compare" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/demo", label: "Demo" },
];

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`${jakarta.variable} ${jetbrainsMono.variable} marketing min-h-screen bg-midnight-slate text-off-white`}
    >
      <script dangerouslySetInnerHTML={{ __html: LANG_FIX_SCRIPT }} />
      <header className="sticky top-0 z-40 border-b border-off-white/10 bg-midnight-slate/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Ctrl PPC, terug naar de homepage">
            <Logo compact className="scale-90" />
          </Link>
          {/* lg:flex, niet sm:flex: zeven navlinks pasten niet meer tussen 640-1023px zodra "How
              It Works" erbij kwam -- zie mobile-nav.tsx voor de gemeten breuk bij 660px. */}
          <nav className="hidden items-center gap-8 lg:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="whitespace-nowrap text-sm font-medium text-off-white/70 transition-colors hover:text-off-white"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-[6px] border border-off-white/15 px-4 py-2 text-sm font-semibold text-off-white transition-colors hover:border-neon-indigo hover:text-neon-indigo"
            >
              Log in
            </Link>
            <MobileNav links={NAV_LINKS} />
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-off-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
          <Logo compact />
          {/* flex-wrap: zeven items in deze rij (zes links + copyright) pasten niet meer op één
              regel van 390px na het toevoegen van "How It Works" -- 21px horizontale overflow,
              gemeten (audit-vervolg, 11 augustus 2026). Op sm+ is er ruim plek voor één regel; op
              mobiel valt de rij nu netjes over twee regels in plaats van over de rand te lopen. */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-off-white/50">
            <Link href="/how-it-works" className="hover:text-off-white">How It Works</Link>
            <Link href="/pricing" className="hover:text-off-white">Pricing</Link>
            <Link href="/vs" className="hover:text-off-white">Compare</Link>
            <Link href="/faq" className="hover:text-off-white">FAQ</Link>
            <Link href="/blog" className="hover:text-off-white">Blog</Link>
            <Link href="/demo" className="hover:text-off-white">Demo</Link>
            <span>&copy; {new Date().getFullYear()} Ctrl PPC</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
