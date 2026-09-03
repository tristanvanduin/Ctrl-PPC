// =====================================================================
// De kanaalkoppeling per klant: /api/kanaal-koppeling
//
//   GET    ?client_id=X                       het overzicht: per kanaal de koppelingsrij, de
//                                             laatste run, de dagstand, en of het bureau een
//                                             bruikbaar token heeft
//   GET    ?client_id=X&accounts=<kanaal>     de accounts onder het bureautoken, om uit te kiezen
//   POST   { client_id, kanaal, account_id, customer_id?, currency? }   koppelen (upsert)
//   DELETE { client_id, kanaal }                                        ontkoppelen (disabled)
//
// Recht: connection:manage (zelfde als de bureaukoppelingen; zie lib/auth/roles.ts). De
// orkestratie woont in lib/sync/kanaal-koppeling.ts en lib/sync/kanaal-accounts.ts; dit is de
// dunne HTTP-laag. Een DataLaagFout wordt een 500 met de tabel erbij (dataFoutNaarResponse).
// =====================================================================

import { NextRequest } from "next/server";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { realServerClient, supabaseForClient, isDemoRequest } from "@/lib/demo/server-supabase";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import {
  leesKanaalKoppelingen, bureauKoppelingStand, valideerKoppelVerzoek, koppelKanaal, ontkoppelKanaal,
  isKoppelKanaal, KANAAL_LABEL, KOPPEL_KANALEN,
} from "@/lib/sync/kanaal-koppeling";
import { kanaalAccounts } from "@/lib/sync/kanaal-accounts";

export const maxDuration = 60;

const ACCOUNTLIJST_STATUS = { geen_credentials: 409, token_probleem: 502, api_fout: 502, handmatig: 422 } as const;

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });
  const toegang = await vereisKlantToegangUitBody(request, "connection:manage", clientId);
  if (toegang) return toegang;

  const accountsVan = request.nextUrl.searchParams.get("accounts");
  try {
    if (accountsVan !== null) {
      if (!isKoppelKanaal(accountsVan)) return Response.json({ error: `accounts moet een van ${KOPPEL_KANALEN.join(", ")} zijn` }, { status: 400 });
      if (isDemoRequest(clientId)) return Response.json({ error: "De demo-klant draait op demodata en heeft geen kanaalkoppeling nodig." }, { status: 400 });
      const supabase = realServerClient();
      if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
      const lijst = await kanaalAccounts(supabase, clientId, accountsVan);
      if (!lijst.ok) return Response.json({ error: lijst.fout, reden: lijst.reden }, { status: ACCOUNTLIJST_STATUS[lijst.reden] });
      return Response.json({ client_id: clientId, kanaal: accountsVan, accounts: lijst.accounts, credential_bron: lijst.bron });
    }

    const supabase = supabaseForClient(clientId);
    if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
    const [kanalen, bureau] = await Promise.all([leesKanaalKoppelingen(supabase, clientId), bureauKoppelingStand(supabase, clientId)]);
    return Response.json({ client_id: clientId, demo: isDemoRequest(clientId), bureau, kanalen });
  } catch (e) {
    return dataFoutNaarResponse(e) ?? Response.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Verwacht JSON: { client_id, kanaal, account_id, customer_id?, currency? }" }, { status: 400 });
  }
  const geldig = valideerKoppelVerzoek(body);
  if (!geldig.ok) return Response.json({ error: geldig.fout }, { status: 400 });
  const { verzoek } = geldig;

  const toegang = await vereisKlantToegangUitBody(request, "connection:manage", verzoek.clientId);
  if (toegang) return toegang;
  if (isDemoRequest(verzoek.clientId)) return Response.json({ error: "De demo-klant draait op demodata en heeft geen kanaalkoppeling nodig." }, { status: 400 });

  const supabase = realServerClient();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  try {
    // Koppelen zonder token is een koppeling die vannacht meteen faalt: zeg dat nu, met de weg
    // erbij, in plaats van een rij te maken die alleen failed-runs gaat produceren.
    const bureau = await bureauKoppelingStand(supabase, verzoek.clientId);
    const stand = bureau.perKanaal[verzoek.kanaal];
    if (!stand.bruikbaar) {
      return Response.json({
        error: `Het bureau heeft geen actieve ${KANAAL_LABEL[verzoek.kanaal]}-koppeling (status: ${stand.status ?? "geen"}). Verbind het platform eerst bij Instellingen → Koppelingen, of zet de omgevingsvariabelen.`,
        bureau: stand,
      }, { status: 409 });
    }
    await koppelKanaal(supabase, verzoek);
    return Response.json({ ok: true, client_id: verzoek.clientId, kanaal: verzoek.kanaal, account_id: verzoek.accountId, customer_id: verzoek.customerId, credential_bron: stand.bron });
  } catch (e) {
    return dataFoutNaarResponse(e) ?? Response.json({ error: e instanceof Error ? e.message : "Koppelen mislukt" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let clientId = "";
  let kanaal: unknown = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    kanaal = body.kanaal;
  } catch {
    return Response.json({ error: "Verwacht JSON: { client_id, kanaal }" }, { status: 400 });
  }
  if (!clientId) return Response.json({ error: "client_id ontbreekt" }, { status: 400 });
  if (!isKoppelKanaal(kanaal)) return Response.json({ error: `kanaal moet een van ${KOPPEL_KANALEN.join(", ")} zijn` }, { status: 400 });

  const toegang = await vereisKlantToegangUitBody(request, "connection:manage", clientId);
  if (toegang) return toegang;
  if (isDemoRequest(clientId)) return Response.json({ error: "De demo-klant heeft geen kanaalkoppeling." }, { status: 400 });

  const supabase = realServerClient();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
  try {
    const { gevonden } = await ontkoppelKanaal(supabase, clientId, kanaal);
    if (!gevonden) return Response.json({ error: `Geen ${KANAAL_LABEL[kanaal]}-koppeling voor deze klant` }, { status: 404 });
    return Response.json({ ok: true, client_id: clientId, kanaal });
  } catch (e) {
    return dataFoutNaarResponse(e) ?? Response.json({ error: e instanceof Error ? e.message : "Ontkoppelen mislukt" }, { status: 500 });
  }
}
