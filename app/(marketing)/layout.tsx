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
const NAV_LINKS = [
  { href: "/", label: "Home" },
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
      <header className="sticky top-0 z-40 border-b border-off-white/10 bg-midnight-slate/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Ctrl PPC, terug naar de homepage">
            <Logo compact className="scale-90" />
          </Link>
          <nav className="hidden items-center gap-8 sm:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-off-white/70 transition-colors hover:text-off-white"
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
          <div className="flex items-center gap-6 text-sm text-off-white/50">
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
