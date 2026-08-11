import type { Metadata } from "next";
import { Mail, Phone } from "lucide-react";
import { DemoForm } from "@/components/marketing/demo-form";

export const metadata: Metadata = {
  title: "Request a demo: Ctrl PPC",
  description: "Request a demo and see how Ctrl PPC turns signals into tested hypotheses for your own accounts.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Request a demo: Ctrl PPC",
    description: "Request a demo and see how Ctrl PPC turns signals into tested hypotheses for your own accounts.",
    type: "website",
  },
};

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-lg px-6 pt-14 pb-20 sm:pt-20">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Demo</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl">
          See it on your own accounts
        </h1>
        <p className="mx-auto mt-4 max-w-md text-off-white/60">
          Leave your details and we will plan a time to show you Ctrl PPC, tailored to what you are
          looking for.
        </p>
      </div>
      <div className="mt-10">
        <DemoForm />
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 text-sm text-off-white/60 sm:flex-row sm:justify-center sm:gap-8">
        <a href="tel:+31611062649" className="flex items-center gap-2 hover:text-off-white">
          <Phone className="h-4 w-4 text-neon-indigo" aria-hidden />
          +31 6 11062649
        </a>
        <a href="mailto:info@ctrlppc.com" className="flex items-center gap-2 hover:text-off-white">
          <Mail className="h-4 w-4 text-neon-indigo" aria-hidden />
          info@ctrlppc.com
        </a>
      </div>
    </div>
  );
}
