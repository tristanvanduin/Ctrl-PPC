import type { Metadata } from "next";
import { FaqAccordion, type FaqItem } from "@/components/marketing/faq-accordion";

// Fase 7, Task 3: FAQ. De antwoorden over privacy, RLS en observatie-vs-executie beschrijven
// hoe het platform daadwerkelijk werkt (Row Level Security per bureau, en een leeslaag zonder
// een enkele schrijfaanroep naar een advertentieplatform), geen marketingtaal die losstaat van
// de implementatie.
export const metadata: Metadata = {
  title: "FAQ: Ctrl PPC",
  description: "Veelgestelde vragen over data-privacy, RLS en het verschil tussen observatie en automatische executie.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ: Ctrl PPC",
    description: "Veelgestelde vragen over data-privacy, RLS en het verschil tussen observatie en automatische executie.",
    type: "website",
  },
};

const VRAGEN: FaqItem[] = [
  {
    vraag: "Wijzigt Ctrl PPC zelf iets in mijn advertentie-accounts?",
    antwoord:
      "Nee. Ctrl PPC leest je accounts en stelt hypotheses voor, maar voert zelf niets uit in Google Ads, " +
      "Meta of LinkedIn. Wie een hypothese accepteert, voert de wijziging zelf door in het platform. Ctrl " +
      "PPC observeert daarna wat er in het account veranderd is en koppelt dat terug aan de hypothese die " +
      "het voorspelde: dat is de attributiestap in het Decision Framework, geen automatische executie.",
  },
  {
    vraag: "Hoe is mijn data afgeschermd van andere klanten en andere bureaus?",
    antwoord:
      "Via Row Level Security (RLS) in de database zelf, niet alleen via een controle in de applicatie. " +
      "Elke rij is gekoppeld aan een klant en een bureau, en de database weigert een rij te tonen aan wie " +
      "daar geen rechten toe heeft, ongeacht welke query de applicatie stuurt.",
  },
  {
    vraag: "Wordt mijn advertentiedata gedeeld met andere klanten of gebruikt om andere accounts te trainen?",
    antwoord:
      "Nee. Elk account is gekoppeld aan precies één klant en één bureau, en blijft daarbinnen. Alleen " +
      "geaggregeerde, geanonimiseerde benchmarks (zonder herleidbare cijfers per account) worden ooit over " +
      "klanten heen samengevoegd, en alleen voor bureaus die daar zelf voor kiezen.",
  },
  {
    vraag: "Hoe weet ik of een geaccepteerde hypothese echt heeft gewerkt?",
    antwoord:
      "Elke hypothese heeft een verwacht resultaat en een meetbare metric. Na de meetperiode vergelijkt " +
      "Ctrl PPC de baseline met het gemeten resultaat, en kijkt of de bijbehorende wijziging ook " +
      "daadwerkelijk is doorgevoerd in het account. Zonder herkenbare uitvoering telt een toevallige " +
      "beweging in de cijfers niet als bevestiging.",
  },
  {
    vraag: "Werkt dit ook als ik maar op één kanaal actief ben?",
    antwoord:
      "Ja. Elk kanaal (Google, Meta, LinkedIn) levert zijn eigen signalen onafhankelijk van de andere. Meer " +
      "kanalen geven een breder beeld, maar zijn geen vereiste om te starten.",
  },
  {
    vraag: "Is dit ook geschikt voor een bureau met meerdere klanten?",
    antwoord:
      "Ja, dat is het uitgangspunt: elk klantaccount van een bureau blijft afgeschermd via RLS, en een " +
      "bureau krijgt daarnaast een eigen bureaubrede blik over al zijn klanten heen, zonder dat elke extra " +
      "klant een aparte rekening of een aparte integratie vraagt.",
  },
];

// FAQPage-structured data: dezelfde vragen/antwoorden als hierboven, machineleesbaar. Dit is
// wat Google's FAQ-rich-results leest en wat een AI-antwoordmachine (ChatGPT, Perplexity) het
// makkelijkst letterlijk kan citeren -- geen aparte tekst, gewoon VRAGEN zelf als JSON-LD.
function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: VRAGEN.map((v) => ({
      "@type": "Question",
      name: v.vraag,
      acceptedAnswer: { "@type": "Answer", text: v.antwoord },
    })),
  };
}

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-14 pb-20 sm:pt-20">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">FAQ</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl">
          Frequently asked questions
        </h1>
      </div>
      <div className="mt-12">
        <FaqAccordion items={VRAGEN} />
      </div>
    </div>
  );
}
