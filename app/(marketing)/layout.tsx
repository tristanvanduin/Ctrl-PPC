"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";

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
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/demo", label: "Demo" },
];

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // De navlinks stonden op `hidden sm:flex`, dus zonder eigen ingang eronder: op mobiel was
  // Pricing/FAQ/Blog alleen bereikbaar door helemaal naar de footer te scrollen. Dit menu is
  // die ingang.
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`${jakarta.variable} ${jetbrainsMono.variable} min-h-screen bg-midnight-slate text-off-white`}
    >
      <header className="sticky top-0 z-40 border-b border-off-white/10 bg-midnight-slate/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Ctrl PPC, terug naar de homepage" onClick={() => setOpen(false)}>
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
              Inloggen
            </Link>
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Menu sluiten" : "Menu openen"}
              className="rounded-[6px] border border-off-white/15 p-2 text-off-white sm:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-off-white/10 px-6 py-3 sm:hidden">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block py-2.5 text-sm font-medium text-off-white/80 hover:text-off-white"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="border-t border-off-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
          <Logo compact />
          <div className="flex items-center gap-6 text-sm text-off-white/50">
            <Link href="/pricing" className="hover:text-off-white">Pricing</Link>
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
