import type { Metadata } from "next";
import { getPublishedBlogPosts } from "@/lib/marketing/blog-posts";
import { BlogGrid } from "@/components/marketing/blog-grid";

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

export default function BlogIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-14 pb-20 sm:pt-20">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Blog</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl">
          Technical analysis, not product news
        </h1>
      </div>

      <BlogGrid posts={getPublishedBlogPosts()} />
    </div>
  );
}
