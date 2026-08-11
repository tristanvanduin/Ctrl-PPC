import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { PlatformPulse } from "@/components/terminal/platform-pulse";
import { ComparisonBlock } from "@/components/marketing/comparison-block";
import { TrustBanner } from "@/components/marketing/trust-banner";
import { FeaturesBlock } from "@/components/marketing/features-block";
import { ProductVideo } from "@/components/marketing/product-video";

// Fase 7, Task 2: de homepage volgens Blueprint v2.0. Vervangt de minimale Fase 5-hero (die
// alleen de kop en de Platform Pulse had) door de volledige structuur uit de brief: hero,
// vergelijking, trust-banner, features + ROI-calculator. De auth-redirect blijft ongewijzigd --
// een ingelogde gebruiker hoort hier nooit de marketingpagina te zien.
export const metadata: Metadata = {
  title: "Ctrl PPC: The Cross-Channel Decision Engine",
  description:
    "Dashboards show you what happened. A chart is not a decision. Ctrl PPC reads every account, forms a testable hypothesis, executes it, and remembers what worked - across channels, with no account limit.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Ctrl PPC: The Cross-Channel Decision Engine",
    description: "A chart is not a decision. We build the engine that decides.",
    type: "website",
  },
};

// Organization + SoftwareApplication: wat een crawler of AI-antwoordmachine over het product
// zelf moet weten, los van de opgemaakte hero-tekst. offers.price ontbreekt bewust -- er staat
// nergens een bedrag vastgelegd in de codebase, en een verzonnen prijs in structured data is
// nog misleidender dan een op de pagina zelf, want dit is precies wat een zoekmachine of
// AI-systeem als feit overneemt.
const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Ctrl PPC",
  url: "https://ctrlppc.com",
  description: "The cross-channel decision engine for performance marketing.",
};

const SOFTWARE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Ctrl PPC",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Reads ad accounts across channels, forms a testable hypothesis through a 6-step Decision Framework, and observes the result without executing changes itself.",
};

export default async function HomePage() {
  const user = await getAuthUser();
  if (user) redirect("/vandaag");

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
      />
      <section className="mx-auto max-w-4xl px-6 pt-14 pb-10 text-center sm:pt-20 sm:pb-14">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">
          The Cross-Channel Decision Engine
        </p>
        <h1 className="mx-auto mt-5 font-marketing-heading text-3xl font-extrabold leading-tight text-off-white sm:text-5xl md:text-6xl">
          A chart is not a decision.
          <br />
          We built the engine that is.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-off-white/60 sm:text-lg">
          Chat-to-chart is still just a chart. Typing a prompt and getting a graph back is an insight,
          not a decision. Ctrl PPC reads every account across every channel, forms a testable
          hypothesis, executes it, and remembers what worked. No prompting required.
        </p>
        <div className="mt-8 flex items-center justify-center sm:mt-10">
          <a
            href="/demo"
            className="rounded-[6px] px-7 py-3.5 text-sm font-semibold text-midnight-slate transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: "#818cf8", boxShadow: "0 0 40px rgba(129, 140, 248, 0.45)" }}
          >
            Request a demo
          </a>
        </div>
      </section>

      <ProductVideo />
      <TrustBanner />
      <ComparisonBlock />
      <FeaturesBlock />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-marketing-heading text-2xl font-bold text-off-white">
          Global Platform Pulse
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-off-white/50">
          Live numbers across every connected account. Not simulated.
        </p>
        <div className="dark terminal mt-8">
          <PlatformPulse />
        </div>
      </section>
    </>
  );
}
