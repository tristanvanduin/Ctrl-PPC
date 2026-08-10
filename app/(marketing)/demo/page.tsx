import type { Metadata } from "next";
import { DemoForm } from "@/components/marketing/demo-form";

export const metadata: Metadata = {
  title: "Demo aanvragen: Ctrl PPC",
  description: "Vraag een demo aan en zie hoe Ctrl PPC signalen omzet in getoetste hypotheses voor je eigen accounts.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Demo aanvragen: Ctrl PPC",
    description: "Vraag een demo aan en zie hoe Ctrl PPC signalen omzet in getoetste hypotheses voor je eigen accounts.",
    type: "website",
  },
};

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Demo</p>
        <h1 className="mt-4 font-marketing-heading text-4xl font-extrabold text-off-white">
          Zie het aan je eigen accounts
        </h1>
        <p className="mx-auto mt-4 max-w-md text-off-white/60">
          Laat je gegevens achter en we plannen een moment om Ctrl PPC te laten zien, toegespitst op
          waar jij naar zoekt.
        </p>
      </div>
      <div className="mt-10">
        <DemoForm />
      </div>
    </div>
  );
}
