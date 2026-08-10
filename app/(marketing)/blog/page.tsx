import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS } from "@/lib/marketing/blog-posts";

export const metadata: Metadata = {
  title: "Blog: Ctrl PPC",
  description: "Technische analyses over performance marketing: attributie, biedstrategie en wat een dashboard je niet vertelt.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog: Ctrl PPC",
    description: "Technische analyses over performance marketing: attributie, biedstrategie en wat een dashboard je niet vertelt.",
    type: "website",
  },
};

function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export default function BlogIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Blog</p>
        <h1 className="mt-4 font-marketing-heading text-4xl font-extrabold text-off-white">
          Technische analyses, geen productnieuws
        </h1>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2">
        {BLOG_POSTS.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col rounded-[6px] border border-off-white/10 bg-midnight-slate-raised p-6 transition-colors hover:border-neon-indigo/40"
          >
            <p className="text-xs text-off-white/60" style={{ fontFamily: "var(--font-marketing-mono)" }}>
              {formatDatum(post.datum)} - {post.leesminuten} min
            </p>
            <h2 className="mt-3 font-marketing-heading text-lg font-bold text-off-white group-hover:text-neon-indigo">
              {post.titel}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-off-white/60">{post.samenvatting}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
