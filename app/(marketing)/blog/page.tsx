import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS } from "@/lib/marketing/blog-posts";
import { formatBlogDate } from "@/lib/marketing/format-date";

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

      <div className="mt-10 grid gap-6 sm:grid-cols-2 sm:mt-14">
        {BLOG_POSTS.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6 transition-all hover:border-neon-indigo/40 hover:shadow-[0_0_32px_rgba(129,140,248,0.15)]"
          >
            <span className="w-fit rounded-[4px] border border-neon-indigo/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-neon-indigo">
              Analysis
            </span>
            <p className="mt-3 text-xs text-off-white/60" style={{ fontFamily: "var(--font-marketing-mono)" }}>
              {formatBlogDate(post.datum)} - {post.leesminuten} min
            </p>
            <h2 className="mt-2 font-marketing-heading text-lg font-bold text-off-white group-hover:text-neon-indigo">
              {post.titel}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-off-white/60">{post.samenvatting}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
