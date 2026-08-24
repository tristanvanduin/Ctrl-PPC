import type { MetadataRoute } from "next";
import { CANONIEK_DOMEIN } from "@/lib/domein";
import { getPublishedBlogPosts } from "@/lib/marketing/blog-posts";
import { isDefinitief } from "@/lib/legal/bedrijfsgegevens";

// Ontbrak volledig (404 op productie, gemeten). Alleen de publieke marketingpagina's -- de
// ingelogde app hoort sowieso niet in een sitemap, en staat nu ook achter O1_AUTH_ENFORCED.
export default function sitemap(): MetadataRoute.Sitemap {
  const basis = `https://${CANONIEK_DOMEIN}`;
  const statisch: MetadataRoute.Sitemap = [
    { url: basis, changeFrequency: "monthly", priority: 1 },
    { url: `${basis}/how-it-works`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${basis}/demo`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${basis}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${basis}/vs`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${basis}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${basis}/blog`, changeFrequency: "weekly", priority: 0.7 },
  ];
  // Alleen als de juridische documenten definitief zijn. Zolang er nog bedrijfsgegevens ontbreken
  // (zie lib/legal/bedrijfsgegevens.ts) dragen die pagina's een noindex-meta, en een sitemap die
  // een noindex-pagina aanbiedt spreekt zichzelf tegen -- precies het soort tegenstrijdig signaal
  // dat de blog-audit van 22 augustus 2026 hier al eens opleverde met twee drafts. Eén functie
  // bepaalt beide kanten, dus ze kunnen niet uit elkaar lopen.
  if (isDefinitief()) {
    statisch.push(
      { url: `${basis}/privacy`, changeFrequency: "yearly", priority: 0.3 },
      { url: `${basis}/terms`, changeFrequency: "yearly", priority: 0.3 },
      { url: `${basis}/data-deletion`, changeFrequency: "yearly", priority: 0.3 },
    );
  }
  // getPublishedBlogPosts(), niet de ruwe BLOG_POSTS: er stonden hier ook de twee drafts
  // (published: false, zie lib/marketing/blog-posts.ts) in -- generateStaticParams filtert ze al
  // wel uit, dus /blog/dashboard-illusie-pro-con en /blog/god-view-collectieve-marktdata gaven
  // een 404, terwijl de sitemap ze wél aan Google en AI-crawlers aanbood. Twee dode links in je
  // eigen sitemap is precies het soort signaal dat crawlbudget verspilt en een site minder
  // betrouwbaar laat lijken. Gevonden bij de blog SEO/GEO-audit, 22 augustus 2026.
  const artikelen: MetadataRoute.Sitemap = getPublishedBlogPosts().map((post) => ({
    url: `${basis}/blog/${post.slug}`,
    lastModified: post.datum,
    changeFrequency: "yearly",
    priority: 0.5,
  }));
  return [...statisch, ...artikelen];
}
