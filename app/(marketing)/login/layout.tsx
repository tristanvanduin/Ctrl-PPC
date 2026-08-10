import type { Metadata } from "next";

// /login zelf en zijn ouderlayout zijn client components (de loginform heeft state, de
// marketinglayout heeft het mobiele menu), en een client component kan geen metadata
// exporteren. Deze losse server-only laag is er alleen voor de noindex: een loginformulier
// heeft geen inhoud die iemand via een zoekmachine hoort te vinden.
export const metadata: Metadata = {
  title: "Inloggen: Ctrl PPC",
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
