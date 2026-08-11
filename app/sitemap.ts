import type { MetadataRoute } from "next";
import { CANONIEK_DOMEIN } from "@/lib/domein";
import { BLOG_POSTS } from "@/lib/marketing/blog-posts";

// Ontbrak volledig (404 op productie, gemeten). Alleen de publieke marketingpagina's -- de
// ingelogde app hoort sowieso niet in een sitemap, en staat nu ook achter O1_AUTH_ENFORCED.
export default function sitemap(): MetadataRoute.Sitemap {
  const basis = `https://${CANONIEK_DOMEIN}`;
  const statisch: MetadataRoute.Sitemap = [
    { url: basis, changeFrequency: "monthly", priority: 1 },
    { url: `${basis}/demo`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${basis}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${basis}/vs`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${basis}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${basis}/blog`, changeFrequency: "weekly", priority: 0.7 },
  ];
  const artikelen: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${basis}/blog/${post.slug}`,
    lastModified: post.datum,
    changeFrequency: "yearly",
    priority: 0.5,
  }));
  return [...statisch, ...artikelen];
}
