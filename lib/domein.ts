/**
 * Het canonieke domein, voor de canonical-tag en og-URL's in de metadata (zie app/layout.tsx).
 *
 * De www/non-www- en .nl->.com-doorverwijzing die hier ook stond is verwijderd na een
 * productie-uitval (ERR_TOO_MANY_REDIRECTS): die doorverwijzing gebeurt nu op Vercel-niveau,
 * en de twee actief tegelijk bleken elkaar te lussen. Zie middleware.ts voor de toelichting.
 */

export const CANONIEK_DOMEIN = "ctrlppc.com";
