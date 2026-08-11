import type { Metadata } from "next";
import { Check, Infinity as InfinityIcon } from "lucide-react";
import { PRICING } from "@/lib/marketing/pricing";

// Fase 7, Task 3, herzien onder de Blueprint v2.0-brief (radical transparency): een storefront
// met een prijs ATF, geen "neem contact op"-gate. De bedragen komen uit lib/marketing/pricing.ts
// en zijn expliciet gelabeld "indicative" -- er staat nog geen afgesproken prijs vast, en dat
// verbergen achter een contactformulier is precies wat de brief aanvalt. Een rond, herkenbaar
// indicatief bedrag tonen is eerlijker dan een gok verbergen achter "neem contact op".
export const metadata: Metadata = {
  title: "Pricing: Ctrl PPC",
  description: "For in-house teams and agencies. No limit on accounts, no separate invoice per client.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing: Ctrl PPC",
    description: "For in-house teams and agencies. No limit on accounts, no separate invoice per client.",
    type: "website",
  },
};

const IN_HOUSE_PUNTEN = [
  "One platform for every account you own, across every channel",
  "The full 6-step Decision Framework, no stripped-down version",
  "Access for your entire marketing team",
];

const AGENCY_PUNTEN = [
  "No limit on the number of client accounts",
  "One agency-wide view next to the per-client view",
  "Client reporting that scales without repaying per client",
];

function Tier({
  titel,
  subtitel,
  vanafPerMaand,
  valuta,
  punten,
}: {
  titel: string;
  subtitel: string;
  vanafPerMaand: number;
  valuta: string;
  punten: string[];
}) {
  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-8">
      <h3 className="font-marketing-heading text-xl font-bold text-off-white">{titel}</h3>
      <p className="mt-1 text-sm text-off-white/50">{subtitel}</p>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="font-marketing-heading text-4xl font-extrabold text-off-white">
          {"€"}{vanafPerMaand.toLocaleString("en-US")}
        </span>
        <span className="text-sm text-off-white/50">/mo {valuta}, indicative</span>
      </div>
      <p className="mt-1.5 text-xs text-off-white/40">
        Starting price. Your quote scales with account count, ask us for an exact number.
      </p>

      <ul className="mt-6 space-y-3">
        {punten.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm text-off-white/70">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-neon-indigo" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
      <a
        href="/demo"
        className="mt-8 block rounded-[6px] border border-neon-indigo/40 px-5 py-3 text-center text-sm font-semibold text-neon-indigo transition-colors hover:bg-neon-indigo/10"
      >
        Request a demo
      </a>
    </div>
  );
}

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-14 pb-20 sm:pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Pricing</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl md:text-5xl">
          What it costs, up front
        </h1>
        <p className="mt-4 text-off-white/60">
          No account limit, no per-client invoice. Access is by invitation; the numbers below are
          starting points, not the final gate.
        </p>
      </div>

      <div className="mt-10 flex items-center justify-center gap-3 rounded-[6px] border border-copper/30 bg-copper/5 px-6 py-4 text-sm text-off-white/80 sm:mt-14">
        <InfinityIcon className="h-5 w-5 shrink-0 text-copper" aria-hidden />
        <span>
          <strong className="font-semibold text-copper">No Limits:</strong> every plan scales with your
          accounts, without a new invoice opening for each extra client.
        </span>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Tier
          titel="In-house team"
          subtitel="For the marketing team behind one brand."
          vanafPerMaand={PRICING.inHouse.vanafPerMaand}
          valuta={PRICING.inHouse.valuta}
          punten={IN_HOUSE_PUNTEN}
        />
        <Tier
          titel="Agency"
          subtitel="For agencies managing multiple client accounts."
          vanafPerMaand={PRICING.agency.vanafPerMaand}
          valuta={PRICING.agency.valuta}
          punten={AGENCY_PUNTEN}
        />
      </div>
    </div>
  );
}
