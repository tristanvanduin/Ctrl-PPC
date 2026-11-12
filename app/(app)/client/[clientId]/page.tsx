import { Suspense } from "react";
import { cookies } from "next/headers";
import { ClientDashboard } from "@/components/dashboard/client-dashboard";
import { WEERGAVE_SLEUTEL } from "@/lib/weergave";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ClientPage({ params }: Props) {
  const { clientId } = await params;

  // Don't validate against a hardcoded list — API clients are stored client-side.
  // The dashboard component handles missing data gracefully.
  // De keuze "Nieuwe weergave" van deze kijker, uit de cookie die naast localStorage wordt gezet
  // (lib/weergave.ts). Alleen om de juiste kop te renderen: zonder dit stuurde de server altijd de
  // vertrouwde kop, en versprong de pagina bij elke laad voor wie de nieuwe had gekozen.
  const bewaardeWeergave = (await cookies()).get(WEERGAVE_SLEUTEL)?.value ?? null;
  // Suspense: het dashboard leest ?geo= (beurs-scope uit het menu, Fase 3) via useSearchParams.
  return (
    <Suspense>
      <ClientDashboard client={{ id: clientId, name: clientId, source: "google-ads" }} bewaardeWeergave={bewaardeWeergave} />
    </Suspense>
  );
}
