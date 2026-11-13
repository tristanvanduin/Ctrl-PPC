import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { ClientDashboard } from "@/components/dashboard/client-dashboard";
import { WEERGAVE_SLEUTEL } from "@/lib/weergave";
import { KANAALBALK_COOKIE, kanaalbalkUitCookie } from "@/lib/overzicht/kaartenrij";
import { startOverzichtZaad, isDocumentVerzoek } from "@/lib/overzicht/zaad-server";
import { PERIODE_COOKIE, periodeUitCookie } from "@/lib/period/periode-cookie";
import { today } from "@/lib/reporting-date";

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
  const koekjes = await cookies();
  const bewaardeWeergave = koekjes.get(WEERGAVE_SLEUTEL)?.value ?? null;
  // Of deze klant de vorige keer een rij kanalen had (lib/overzicht/kaartenrij.ts): dan houdt de
  // eerste HTML de hoogte van die rij al vrij, in plaats van hem na het laden te laten verschijnen.
  // De cookie geldt alleen onder het pad van deze klant, dus wat hier staat gaat over deze klant.
  // Alleen de nieuwe weergave schrijft hem en gebruikt hem.
  const kanaalbalk = kanaalbalkUitCookie(koekjes.get(KANAALBALK_COOKIE)?.value);
  // De bewaarde periode van deze klant (lib/period/periode-cookie.ts), om dezelfde reden en onder
  // hetzelfde pad: de server zet de kerncijfers al in de HTML (band-uit-zaad.tsx), en moet daarvoor
  // hetzelfde venster kiezen als de browser straks uit localStorage. Zonder cookie geen vooraf
  // gerenderde cijfers, want dan kan het venster daarna nog wisselen.
  const bewaardePeriode = periodeUitCookie(koekjes.get(PERIODE_COOKIE)?.value);
  // De twee lezingen waar het eerste kerncijfer op wacht (de blended historie en de
  // client_settings-rij), HIER gestart en niet afgewacht: de schil gaat even snel de deur uit, en
  // de antwoorden stromen in dezelfde respons na (lib/overzicht/zaad-server.ts). Eerder vertrokken
  // die verzoeken pas uit de browser, nadat het script geladen en gehydrateerd was. De pagina is
  // door cookies() hierboven al dynamisch, dus dit kost geen cache. De beloften wijzen nooit af:
  // zonder toegang of bij een fout dragen ze null, en doet de browser zijn gewone verzoek.
  // ALLEEN bij het verzoek om het document (een eerste bezoek of een herlaad). Een navigatie binnen
  // de app rendert deze pagina ook (elke beursklik in de zijbalk zet ?geo=), maar dan leest de
  // browser het zaad meestal niet en liep de volle lezing voor niets: zie isDocumentVerzoek.
  const koppen = await headers();
  const zaad = isDocumentVerzoek(koppen.get("sec-fetch-dest")) ? startOverzichtZaad(clientId) : null;
  // Vandaag volgens de server, één keer: de browser rekent de cijfers uit het zaad met dezelfde dag,
  // anders kiest hij vlak na middernacht een ander venster dan de server (een hydratiefout).
  const vandaag = today();
  // Suspense: het dashboard leest ?geo= (beurs-scope uit het menu, Fase 3) via useSearchParams.
  return (
    <Suspense>
      <ClientDashboard client={{ id: clientId, name: clientId, source: "google-ads" }} bewaardeWeergave={bewaardeWeergave} kanaalbalkVanServer={kanaalbalk} blendedVanServer={zaad?.blended ?? null} instellingenVanServer={zaad?.instellingen ?? null}
        googleVanServer={zaad?.google ?? null} periodeVanServer={bewaardePeriode} vandaagVanServer={vandaag} />
    </Suspense>
  );
}
