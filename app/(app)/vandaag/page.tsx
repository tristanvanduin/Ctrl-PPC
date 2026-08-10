import { TodayFeed } from "@/components/today/today-feed";
import { GodMode } from "@/components/terminal/god-mode";
import { AgencyGodView } from "@/components/terminal/agency-god-view";
import { getAuthUser } from "@/lib/auth/server";
import { ALL_CLIENTS } from "@/lib/auth/roles";

// De ingelogde landingspagina -- verplaatst van '/' (zie app/page.tsx voor de nieuwe publieke
// marketingpagina uit Fase 5, Task 1). Wat je hier ziet is nu rolgebaseerd (Fase 5, Task 3):
//
//   platform-brede scope (auth.scope === ALL_CLIENTS, membership in platform_beheerders,
//   zie lib/auth/scope.ts) -> God Mode. NIET role === "admin": een agency-admin zonder
//   platform_beheerders-rij is org-breed maar bureau-gescoped, precies als performance_marketeer.
//   performance_marketeer                                     -> Agency God View
//   iedereen anders (klant-gebonden scope)                    -> de bestaande Vandaag-
//                                                                 triagecockpit (Client View),
//                                                                 ongewijzigd.
//
// Zonder sessie (O1_AUTH_ENFORCED uit, of geen ingelogde gebruiker) valt dit terug op de
// bestaande cockpit -- exact het gedrag van vóór Fase 5, dus geen regressie voor wie nog geen
// rol/sessie heeft.
export default async function VandaagPage() {
  const user = await getAuthUser();
  if (user?.scope === ALL_CLIENTS) return <GodMode />;
  if (user?.role === "performance_marketeer") return <AgencyGodView />;
  return <TodayFeed />;
}
