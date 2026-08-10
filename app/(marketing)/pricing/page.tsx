import type { Metadata } from "next";
import { Check, Infinity as InfinityIcon } from "lucide-react";

// Fase 7, Task 3: Pricing. Geen bedragen: die zijn nergens in de codebase vastgelegd en een
// verzonnen prijs zou een feitelijke claim zijn die niemand kan nakijken. In plaats daarvan de
// twee doelgroepen (in-house team vs. bureau) en de 'No Limits'-propositie die de brief vraagt,
// met een CTA naar /login -- toegang is op uitnodiging (zie app/(marketing)/login/page.tsx).
export const metadata: Metadata = {
  title: "Pricing: Ctrl PPC",
  description: "Voor in-house teams en bureaus. Geen limiet op accounts, geen aparte rekening per klant.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing: Ctrl PPC",
    description: "Voor in-house teams en bureaus. Geen limiet op accounts, geen aparte rekening per klant.",
    type: "website",
  },
};

const IN_HOUSE_PUNTEN = [
  "Eén platform voor al je eigen accounts, over alle kanalen",
  "Het volledige 6-staps Decision Framework, geen afgeknipte versie",
  "Toegang voor je hele marketingteam",
];

const AGENCY_PUNTEN = [
  "Geen limiet op het aantal klantaccounts",
  "Eén bureaubrede blik naast de per-klant weergave",
  "Klantrapportage die meegroeit zonder per klant opnieuw te betalen",
];

function Tier({ titel, subtitel, punten }: { titel: string; subtitel: string; punten: string[] }) {
  return (
    <div className="rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-8">
      <h3 className="font-marketing-heading text-xl font-bold text-off-white">{titel}</h3>
      <p className="mt-1 text-sm text-off-white/50">{subtitel}</p>
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
        Demo aanvragen
      </a>
    </div>
  );
}

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Pricing</p>
        <h1 className="mt-4 font-marketing-heading text-4xl font-extrabold text-off-white sm:text-5xl">
          Voor teams die groeien, niet voor teams die tellen
        </h1>
        <p className="mt-4 text-off-white/60">
          Ctrl PPC rekent niet per account. Toegang is op uitnodiging; neem contact op via je Ctrl PPC-
          contactpersoon voor de voorwaarden voor jouw team.
        </p>
      </div>

      <div className="mt-14 flex items-center justify-center gap-3 rounded-[6px] border border-copper/30 bg-copper/5 px-6 py-4 text-sm text-off-white/80">
        <InfinityIcon className="h-5 w-5 shrink-0 text-copper" aria-hidden />
        <span>
          <strong className="font-semibold text-copper">No Limits:</strong> elk plan schaalt mee met je
          accounts, zonder dat elke extra klant een nieuwe rekening opent.
        </span>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Tier
          titel="In-house team"
          subtitel="Voor het marketingteam achter één merk."
          punten={IN_HOUSE_PUNTEN}
        />
        <Tier
          titel="Bureau"
          subtitel="Voor bureaus die meerdere klantaccounts beheren."
          punten={AGENCY_PUNTEN}
        />
      </div>
    </div>
  );
}
