import type { Metadata } from "next";
import { FaqAccordion, type FaqItem } from "@/components/marketing/faq-accordion";
import { PrimaryCta } from "@/components/marketing/primary-cta";

// Fase 7, Task 3: FAQ. De antwoorden over privacy, RLS en observatie-vs-executie beschrijven
// hoe het platform daadwerkelijk werkt (Row Level Security per bureau, en een leeslaag zonder
// een enkele schrijfaanroep naar een advertentieplatform), geen marketingtaal die losstaat van
// de implementatie. Naar het Engels vertaald voor de Blueprint v2.0-brief; feitelijke inhoud
// ongewijzigd, alleen de taal.
export const metadata: Metadata = {
  title: "FAQ: Ctrl PPC",
  description: "Frequently asked questions about data privacy, RLS, and the difference between observation and automatic execution.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ: Ctrl PPC",
    description: "Frequently asked questions about data privacy, RLS, and the difference between observation and automatic execution.",
    type: "website",
  },
};

const VRAGEN: FaqItem[] = [
  {
    vraag: "Does Ctrl PPC change anything in my ad accounts itself?",
    antwoord:
      "No. Ctrl PPC reads your accounts and proposes hypotheses, but never executes anything itself in " +
      "Google Ads, Meta, or LinkedIn. Whoever accepts a hypothesis makes the change themselves in the " +
      "platform. Ctrl PPC then observes what changed in the account and links that back to the hypothesis " +
      "that predicted it: that is the attribution step in the Decision Framework, not automatic execution.",
  },
  {
    vraag: "How is my data isolated from other clients and other agencies?",
    antwoord:
      "Through Row Level Security (RLS) in the database itself, not just a check in the application. " +
      "Every row is tied to a client and an agency, and the database refuses to show a row to anyone " +
      "without access to it, regardless of what query the application sends.",
  },
  {
    vraag: "Is my ad data shared with other clients or used to train other accounts?",
    antwoord:
      "No. Every account is tied to exactly one client and one agency, and stays within that boundary. " +
      "Only aggregated, anonymized benchmarks (with no traceable per-account figures) are ever combined " +
      "across clients, and only for agencies that opt into that themselves.",
  },
  {
    vraag: "How do I know if an accepted hypothesis actually worked?",
    antwoord:
      "Every hypothesis has an expected result and a measurable metric. After the measurement period, " +
      "Ctrl PPC compares the baseline to the measured result, and checks whether the corresponding change " +
      "was actually made in the account. Without recognizable execution, a coincidental move in the " +
      "numbers does not count as confirmation.",
  },
  {
    vraag: "Does this work if I am only active on one channel?",
    antwoord:
      "Yes. Each channel (Google, Meta, LinkedIn) delivers its own signals independently of the others. " +
      "More channels give a broader picture, but are not required to get started.",
  },
  {
    vraag: "Is this suitable for an agency with multiple clients?",
    antwoord:
      "Yes, that is the starting point: every client account of an agency stays isolated through RLS, and " +
      "an agency also gets its own agency-wide view across all its clients, without each extra client " +
      "requiring a separate invoice or a separate integration.",
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

      {/* Zonder deze afsluiting was FAQ een doodlopende pagina: geen enkele link naar /demo of
          /pricing binnen de content, alleen de nav bovenaan (audit, 11 augustus 2026). Iemand die
          hier klaar leest is precies degene die overtuigd genoeg is om een volgende stap te zetten. */}
      <div className="mt-16 flex flex-col items-center gap-4 text-center">
        <p className="text-off-white/60">Still have a question this page did not answer?</p>
        <PrimaryCta>Talk to us</PrimaryCta>
      </div>
    </div>
  );
}
