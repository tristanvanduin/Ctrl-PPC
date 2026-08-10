import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { PlatformPulse } from "@/components/terminal/platform-pulse";
import { BRAND_NAME } from "@/lib/branding/brand";

// Fase 5, Task 1: de publieke marketingpagina. '/' was tot Fase 5 de ingelogde Vandaag-
// triagecockpit; die staat nu op /vandaag (zie app/vandaag/page.tsx). Een ingelogde gebruiker
// die hier toch terechtkomt (een oude bookmark, een gedeelde link) gaat meteen door naar zijn
// eigen startpagina -- geen marketingpagina te zien voor wie al binnen is.
export default async function HomePage() {
  const user = await getAuthUser();
  if (user) redirect("/vandaag");

  return (
    <div className="terminal space-y-12">
      <section className="rounded-2xl border border-border bg-card px-6 py-16 text-center sm:px-12">
        <p
          className="text-meta font-semibold uppercase tracking-widest"
          style={{ color: "var(--terminal-accent, var(--color-rm-blue-ink))" }}
        >
          {BRAND_NAME}
        </p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold text-rm-gray sm:text-5xl">
          Het besturingscentrum voor performance marketing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lead text-muted-foreground">
          Eén commandocentrale voor elk account, elk bureau en elk platform — van dagelijkse
          triage tot event-relatieve forecasts, zonder een cijfer te hoeven opzoeken.
        </p>
        <a
          href="/login"
          className="mt-8 inline-flex items-center gap-2 rounded-lg px-5 py-3 text-body font-semibold text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--terminal-accent, var(--color-rm-blue))" }}
        >
          Inloggen
        </a>
      </section>

      <section>
        <h2 className="mb-4 text-center text-title font-semibold text-rm-gray">Global Platform Pulse</h2>
        <PlatformPulse />
      </section>
    </div>
  );
}
