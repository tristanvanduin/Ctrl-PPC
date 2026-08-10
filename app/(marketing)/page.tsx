import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { PlatformPulse } from "@/components/terminal/platform-pulse";
import { ComparisonBlock } from "@/components/marketing/comparison-block";
import { TrustBanner } from "@/components/marketing/trust-banner";
import { FeaturesBlock } from "@/components/marketing/features-block";

// Fase 7, Task 2: de homepage volgens Blueprint v2.0. Vervangt de minimale Fase 5-hero (die
// alleen de kop en de Platform Pulse had) door de volledige structuur uit de brief: hero,
// vergelijking, trust-banner, features + ROI-calculator. De auth-redirect blijft ongewijzigd --
// een ingelogde gebruiker hoort hier nooit de marketingpagina te zien.
export const metadata: Metadata = {
  title: "Ctrl PPC: Performance Intelligence Platform",
  description:
    "Stop met dashboards bouwen. Start met beslissingen nemen. Eén platform dat signalen omzet in getoetste hypotheses, per kanaal, zonder limiet op accounts.",
  openGraph: {
    title: "Ctrl PPC: Performance Intelligence Platform",
    description: "Stop met dashboards bouwen. Start met beslissingen nemen.",
    type: "website",
  },
};

export default async function HomePage() {
  const user = await getAuthUser();
  if (user) redirect("/vandaag");

  return (
    <>
      <section className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center sm:pt-32">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">
          Performance Intelligence Platform
        </p>
        <h1 className="mx-auto mt-5 font-marketing-heading text-4xl font-extrabold leading-tight text-off-white sm:text-6xl">
          Stop met dashboards bouwen.
          <br />
          Start met beslissingen nemen.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-off-white/60">
          Elk uur dat naar het verzamelen en netjes maken van cijfers gaat, is een uur dat niet naar de
          volgende beslissing gaat. Ctrl PPC leest je accounts, stelt een getoetste hypothese voor, en
          onthoudt wat werkte.
        </p>
        <div className="mt-10 flex items-center justify-center">
          <a
            href="/login"
            className="rounded-[6px] px-7 py-3.5 text-sm font-semibold text-midnight-slate transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: "#818cf8", boxShadow: "0 0 40px rgba(129, 140, 248, 0.45)" }}
          >
            Bekijk het platform
          </a>
        </div>
      </section>

      <TrustBanner />
      <ComparisonBlock />
      <FeaturesBlock />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-marketing-heading text-2xl font-bold text-off-white">
          Global Platform Pulse
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-off-white/50">
          Live cijfers over alle aangesloten accounts, niet gesimuleerd.
        </p>
        <div className="dark terminal mt-8">
          <PlatformPulse />
        </div>
      </section>
    </>
  );
}
