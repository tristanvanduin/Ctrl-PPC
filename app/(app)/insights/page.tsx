import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// De inzichten wonen per klant onder /client/[id] → tabblad Inzichten. Deze losse route
// toonde alleen een "fase 6"-placeholder; we leiden door naar de klantenlijst zodat er geen
// dood eindpunt meer meeloopt.
//
// De querystring gaat mee: /insights?demo=1 is precies de link die de klantenlijst zelf
// aanraadt in zijn eigen lege-staat ("open de demo met ?demo=1 in de URL"). Een kale
// redirect("/clients") liet die ?demo=1 vallen, dus wie via deze route de demo probeerde te
// openen kwam op een oprecht lege lijst uit -- de tegenovergestelde tegenspraak van wat de
// pagina zelf aanraadt.
export default async function InsightsPage({ searchParams }: Props) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const v of value) params.append(key, v);
  }
  const qs = params.toString();
  redirect(qs ? `/clients?${qs}` : "/clients");
}
