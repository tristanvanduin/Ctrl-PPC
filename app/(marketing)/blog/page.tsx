import type { Metadata } from "next";
import { getPublishedBlogPosts } from "@/lib/marketing/blog-posts";
import { BlogGrid } from "@/components/marketing/blog-grid";
import { CANONIEK_DOMEIN } from "@/lib/domein";

// Description was Dutch (audit, 11 August 2026) -- the literal text Google shows under the blue
// link in search results, on an otherwise fully English page.
export const metadata: Metadata = {
  title: "Blog: Ctrl PPC",
  description: "Technical analysis of performance marketing: attribution, bid strategy, and what a dashboard does not tell you.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog: Ctrl PPC",
    description: "Technical analysis of performance marketing: attribution, bid strategy, and what a dashboard does not tell you.",
    type: "website",
  },
};

// Elk artikel had al zijn eigen BlogPosting-structured data ([slug]/page.tsx); de lijst zelf
// had niets -- een crawler of AI-antwoordmachine moest de gerenderde grid parsen om te weten
// welke artikelen er zijn, in plaats van dat in een keer te kunnen opvragen. ItemList geeft de
// volledige, geordende lijst met titel/datum/URL zonder HTML te hoeven interpreteren.
function blogListJsonLd(posts: ReturnType<typeof getPublishedBlogPosts>) {
  const basis = `https://${CANONIEK_DOMEIN}`;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: posts.map((post, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${basis}/blog/${post.slug}`,
      name: post.titel,
    })),
  };
}

export default function BlogIndexPage() {
  const posts = getPublishedBlogPosts();
  return (
    <div className="mx-auto max-w-5xl px-6 pt-14 pb-20 sm:pt-20">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogListJsonLd(posts)) }}
      />
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Blog</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl">
          Technical analysis, not product news
        </h1>
      </div>

      <BlogGrid posts={posts} />
    </div>
  );
}
