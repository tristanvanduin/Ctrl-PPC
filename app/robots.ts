import type { MetadataRoute } from "next";
import { CANONIEK_DOMEIN } from "@/lib/domein";

// Ontbrak volledig (404 op productie, gemeten). De ingelogde app staat hier ook expliciet
// disallowed, niet omdat crawlers er nu nog bij zouden kunnen -- O1_AUTH_ENFORCED stuurt ze
// toch naar /login -- maar zodat een crawler niet eindeloos tegen 307's aan blijft lopen op
// paden die toch nooit content opleveren.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // /privacy en /terms staan hier ook als ze nog concept zijn: de pagina zelf draagt dan een
      // noindex-meta (zie de twee page.tsx'en), en die kan een crawler alleen lezen als hij de
      // pagina mag ophalen. Disallow zou het tegenovergestelde bereiken van wat het lijkt: de
      // pagina blijft dan zonder inhoud in de index hangen omdat de noindex nooit gezien wordt.
      allow: ["/", "/how-it-works", "/pricing", "/vs", "/faq", "/blog", "/blog/", "/demo", "/privacy", "/terms"],
      disallow: [
        "/login",
        "/auth/",
        "/vandaag",
        "/portfolio",
        "/client/",
        "/clients",
        "/settings",
        "/admin",
        "/decision-terminal",
        "/scripts",
        "/insights",
        "/api/",
      ],
    },
    sitemap: `https://${CANONIEK_DOMEIN}/sitemap.xml`,
  };
}
