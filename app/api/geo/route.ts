// =====================================================================
// Geo-data voor de interactieve kaart (Laag 2-leesroute).
//
// Eén endpoint dat per (kanaal, niveau) de juiste bron kiest — zie lib/geo/geo-source.ts:
//   google/country -> ads_country_monthly     (al gevuld)
//   google/region  -> ads_region_monthly      (VS-staten; wacht op region-sync)
//   meta|linkedin  -> channel_geo_monthly     (wacht op de kanaal-connectors)
//   blended        -> som over de drie kanalen
//
// Zolang de connectors er niet zijn blijven die tabellen leeg en geeft de route [] terug; de
// kaart verdwijnt dan eerlijk in plaats van neppe cijfers te tonen. In demo-modus komt de
// curated mock terug zodat de UX demo-baar blijft.
// =====================================================================

import { NextRequest } from "next/server";
import { resolveGeo, type GeoChannel, type GeoLevel } from "@/lib/geo/geo-source";
import { isDemoRequest } from "@/lib/demo/server-supabase";

const CHANNELS: GeoChannel[] = ["google", "meta", "linkedin", "blended"];
const LEVELS: GeoLevel[] = ["country", "region"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const channel = (sp.get("channel") ?? "google") as GeoChannel;
  const level = (sp.get("level") ?? "country") as GeoLevel;

  if (!clientId) {
    return Response.json({ error: "clientId is verplicht" }, { status: 400 });
  }
  if (!CHANNELS.includes(channel)) {
    return Response.json({ error: `onbekend kanaal: ${channel}` }, { status: 400 });
  }
  if (!LEVELS.includes(level)) {
    return Response.json({ error: `onbekend niveau: ${level}` }, { status: 400 });
  }

  const rows = await resolveGeo({ clientId, channel, level });
  // evidence: waar komt dit vandaan? Bepaald door de klant-id (zie resolveGeo), niet door een
  // losse vlag -- zodat directe navigatie naar de demo-klant hetzelfde eerlijke label krijgt.
  return Response.json({
    channel,
    level,
    evidence: isDemoRequest(clientId) ? "demo" : "platform",
    rows,
  });
}
