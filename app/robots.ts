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
      allow: ["/", "/how-it-works", "/pricing", "/vs", "/faq", "/blog", "/blog/", "/demo"],
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
