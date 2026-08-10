import type { Metadata } from "next";

// Zelfde reden als app/(marketing)/login/layout.tsx: de pagina zelf is een client component
// (recovery-sessie via state), dus de noindex moet in een losse server-only laag.
export const metadata: Metadata = {
  title: "Wachtwoord herstellen: Ctrl PPC",
  robots: { index: false, follow: true },
};

export default function AuthResetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
