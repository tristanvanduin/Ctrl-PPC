import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { PlatformPulse } from "@/components/terminal/platform-pulse";
import { RoiCalculator } from "@/components/marketing/roi-calculator";
import { ComparisonBlock } from "@/components/marketing/comparison-block";
import { TrustBanner } from "@/components/marketing/trust-banner";
import { FeaturesBlock } from "@/components/marketing/features-block";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { foundationBeschikbaar } from "@/lib/marketing/foundation-cap";

// Fase 7, Task 2: de homepage volgens Blueprint v2.0. Vervangt de minimale Fase 5-hero (die
// alleen de kop en de Platform Pulse had) door de volledige structuur uit de brief: hero,
// vergelijking, trust-banner, features + ROI-calculator. De auth-redirect blijft ongewijzigd --
// een ingelogde gebruiker hoort hier nooit de marketingpagina te zien.
export const metadata: Metadata = {
  title: "Ctrl PPC: The Cross-Channel Decision Engine",
  description:
    "Dashboards show you what happened. A chart is not a decision. Ctrl PPC reads every account, forms a testable hypothesis, and remembers what worked once you act on it - across channels, with no account limit.",
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
  const foundationOpen = await foundationBeschikbaar();

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
      {/* Kopgrootte + padding verkleind (13 augustus 2026, "header/titels mega groot" +
          ATF-vraag over Platform Pulse): text-5xl/text-6xl was de enige plek op de site die twee
          stappen tegelijk sprong (elke andere pagina-h1 gaat 3xl -> 4xl -> 5xl, zie how-it-works
          en /blog) -- niet consistent, en op mobiel samen met pb-10 duwde het Pulse verder onder
          de vouw dan nodig. Platform Pulse zelf blijft NIET boven de vouw: hero-met-CTA boven de
          vouw en het eerste bewijs (live cijfers) op de eerste scroll is het gangbare patroon,
          geen tekortkoming. Deze pass maakt alleen de hero minder zwaar, wat de afstand tot Pulse
          als bijeffect verkort.

          TWEEDE RONDE (zelfde dag, "cijfers toch standaard op het scherm... zonder kwaliteit
          verlies of het gevoel van drukte"): op een normaal desktop-viewport (niet uitgezoomd)
          stond Pulse's kop nog net aan de onderrand, de kerncijfers zelf niet zichtbaar zonder
          scrollen. Verticale marges verder verkleind (pt-20->pt-12, pb-10->pb-8, mt-5->mt-4,
          mt-6->mt-4, mt-8/10->mt-6, en Pulse's eigen mt-8->mt-5 verderop), niet de tekstgrootte --
          dat blijft de knop die al eerder is omgedraaid. Elke regel blijft zijn eigen ademruimte
          houden, alleen minder ervan. */}
      <section className="mx-auto max-w-4xl px-6 pt-10 pb-6 text-center sm:pt-12 sm:pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">
          The Cross-Channel Decision Engine
        </p>
        <h1 className="mx-auto mt-4 font-marketing-heading text-3xl font-extrabold leading-tight text-off-white sm:text-4xl md:text-5xl">
          A chart is not a decision.
          <br />
          We built the engine that is.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-off-white/60 sm:text-lg">
          AI dashboards ship "AI insights." That is still a chart with better handwriting. Ctrl PPC
          is decisioning: it reads every account across every channel, forms a testable hypothesis,
          and closes the learning loop by remembering what worked after you act on it.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <PrimaryCta />
          {/* Foundation-cap (12 augustus 2026, bijgesteld na "dit is niet first 50, daarna gaat de
              tier weer open"): foundationBeschikbaar() telt hoeveel bureaus NU op licentie=basis
              staan, niet hoeveel er ooit zijn geweest -- een slot komt vrij zodra een bestaande
              Foundation-licentie upgradet. "The first 50" suggereerde een eenmalige, uitgeputte
              lichting; de tekst moet het draaiende-plafond-gedrag beschrijven, niet een cutoff.
              "Accounts" vervangen door "licenses" (zelfde dag, tweede correctie): de cap zit op
              agencies.licentie -- een freelancer met 5 advertentie-accounts, een bureau met 80, of
              een in-house team tellen allemaal als EEN licentie. "Accounts" botste met de andere
              claim op deze pagina, "unlimited accounts", die over iets anders gaat (advertentie-
              accounts per licentie, altijd onbeperkt).

              50 -> 15 (15 augustus 2026): zie lib/marketing/foundation-cap.ts voor de motivering
              (databaseruimte + exclusiviteit naast de bestaande API-reden). */}
          <p className="text-xs text-off-white/40">
            {foundationOpen
              ? "Foundation is free, forever - capped at 15 licenses at a time during launch, no card required."
              : "Foundation is full for now - slots reopen as licenses upgrade. Request access to join the waitlist."}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="text-center font-marketing-heading text-2xl font-bold text-off-white">
          Global Platform Pulse
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-off-white/50">
          Live numbers across every connected account. Not simulated.
        </p>
        <div className="dark terminal mt-5">
          <PlatformPulse />
        </div>
      </section>

      {/* ROI-calculator (15 augustus 2026, op vraag van de eigenaar, "dit is een converterend
          blok, mega ver omlaag, voelt te los"): stond eerst onderaan FeaturesBlock, na Comparison
          en de drie intro-kolommen -- de laagste plek op de homepage, zonder eigen kop, wat
          zowel te ver naar beneden voelde als losstaand. Hierheen verplaatst: direct na Platform
          Pulse, zodat de volgorde is "hier is het live bewijs" -> "hier is wat dat voor jou
          waard is," met een eigen kop en subtitel in plaats van kaal het widget te tonen. Zie
          components/marketing/features-block.tsx voor de eerdere plek en waarom die niet werkte. */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">
          The Math
        </p>
        <h2 className="mt-3 text-center font-marketing-heading text-2xl font-bold text-off-white">
          What is this actually worth to you?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-off-white/50">
          A minimum estimate, built from the real steps this replaces - not a marketing number.
          Move the sliders to match your book of business.
        </p>
        <div className="mx-auto mt-6 max-w-xl">
          <RoiCalculator />
        </div>
      </section>

      <TrustBanner />
      <ComparisonBlock />
      <FeaturesBlock />
    </>
  );
}
