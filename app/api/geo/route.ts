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
import { resolveGeoPeriode } from "@/lib/geo/geo-periode";
import { isGeldigeDag, type DagPeriode } from "@/lib/period/dag-periode";
import { isDemoRequest } from "@/lib/demo/server-supabase";

/**
 * De periode uit `van` en `tot` (en de vergelijking uit `vvan` en `vtot`), alleen als beide
 * bestaande dagen zijn en in volgorde staan. Null: geen periode gevraagd, of een die niet klopt.
 */
function dagPeriodeUit(van: string | null, tot: string | null): DagPeriode | null {
  return isGeldigeDag(van) && isGeldigeDag(tot) && van <= tot ? { start: van, eind: tot } : null;
}

const CHANNELS: GeoChannel[] = ["google", "meta", "linkedin", "blended"];
const LEVELS: GeoLevel[] = ["country", "region"];

/** Beide niveaus (land en staat) in één antwoord. */
const BEIDE = "beide";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const kanaalParam = sp.get("channel") ?? "google";
  const niveauParam = sp.get("level") ?? "country";

  if (!clientId) {
    return Response.json({ error: "clientId is verplicht" }, { status: 400 });
  }
  if (!CHANNELS.includes(kanaalParam as GeoChannel)) {
    return Response.json({ error: `onbekend kanaal: ${kanaalParam}` }, { status: 400 });
  }
  if (niveauParam !== BEIDE && !LEVELS.includes(niveauParam as GeoLevel)) {
    return Response.json({ error: `onbekend niveau: ${niveauParam}` }, { status: 400 });
  }
  // evidence: waar komt dit vandaan? Bepaald door de klant-id (zie resolveGeo), niet door een
  // losse vlag -- zodat directe navigatie naar de demo-klant hetzelfde eerlijke label krijgt.
  const evidence = isDemoRequest(clientId) ? "demo" : "platform";

  const channel = kanaalParam as GeoChannel;

  // De nieuwe weergave stuurt de periode van de kiezer mee (van/tot, en vvan/vtot voor de
  // vergelijking): dan exact die dagen, per kanaal, met de vergelijking erbij (lib/geo/geo-periode.ts).
  // Zonder periode het vaste venster van de vertrouwde weergave, ongewijzigd hieronder.
  if (sp.has("van") || sp.has("tot")) {
    const periode = dagPeriodeUit(sp.get("van"), sp.get("tot"));
    if (!periode) return Response.json({ error: "van en tot moeten bestaande dagen zijn (JJJJ-MM-DD), van vóór tot" }, { status: 400 });
    const metVergelijking = sp.has("vvan") || sp.has("vtot");
    const vergelijking = metVergelijking ? dagPeriodeUit(sp.get("vvan"), sp.get("vtot")) : null;
    if (metVergelijking && !vergelijking) return Response.json({ error: "vvan en vtot moeten bestaande dagen zijn (JJJJ-MM-DD), vvan vóór vtot" }, { status: 400 });
    try {
      const uit = await resolveGeoPeriode({ clientId, channel, periode, vergelijking });
      return Response.json({ channel, level: BEIDE, evidence, ...uit });
    } catch (e) {
      console.error(`[api/geo] ${channel} per dag voor ${clientId} mislukt:`, e);
      return Response.json({ error: "de landcijfers per dag konden niet geladen worden" }, { status: 500 });
    }
  }

  // level=beide: de kaart vroeg per kanaal twee losse verzoeken (land en staat; de staten zijn
  // nodig om de knop voor de VS te tonen). Nu één antwoord met beide. Het zijn dezelfde twee
  // lezingen via dezelfde resolveGeo, dus de rijen per niveau zijn dezelfde. Elk niveau in een
  // eigen vangnet, met null voor een niveau dat mislukt: land en staat faalden altijd los van
  // elkaar, en een kapotte statenlezing hoort de landenkaart niet leeg te maken.
  if (niveauParam === BEIDE) {
    const perNiveau = await Promise.all(LEVELS.map((level) =>
      resolveGeo({ clientId, channel, level }).catch((e) => {
        console.error(`[api/geo] ${channel}/${level} voor ${clientId} mislukt:`, e);
        return null;
      })));
    return Response.json({ channel, level: BEIDE, evidence, niveaus: Object.fromEntries(LEVELS.map((level, i) => [level, perNiveau[i]])) });
  }

  const rows = await resolveGeo({ clientId, channel, level: niveauParam as GeoLevel });
  return Response.json({ channel, level: niveauParam, evidence, rows });
}
