// Het white-label-logo per bureau (migratie 068). Puur: geen netwerkaanroep, alleen de
// deterministische URL naar de publieke agency-logos-bucket. Bestaat het bestand niet, dan geeft
// deze URL een 404 -- de aanroeper (SidebarLogo) vangt dat af met onError en valt terug op het
// standaard Ctrl PPC-icoon. Dat is bewust geen "bestaat dit?"-aanroep vooraf: één minder
// round-trip, en een <img onError> is toch al nodig voor de eerste render vóór whitelabelActief
// bekend is.

export const AGENCY_LOGO_BUCKET = "agency-logos";
export const AGENCY_LOGO_FILENAME = "logo.png";

export function agencyLogoPath(agencyId: string): string {
  return `${agencyId}/${AGENCY_LOGO_FILENAME}`;
}

/**
 * De publieke URL, of null zonder geconfigureerde Supabase-omgeving. `cacheBust` voorkomt dat
 * de browser na een upload nog de oude afbeelding uit cache toont onder dezelfde URL.
 */
export function agencyLogoUrl(agencyId: string, supabaseUrl: string | undefined, cacheBust?: number): string | null {
  if (!supabaseUrl || !agencyId) return null;
  const basis = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${AGENCY_LOGO_BUCKET}/${agencyLogoPath(agencyId)}`;
  return cacheBust ? `${basis}?v=${cacheBust}` : basis;
}
