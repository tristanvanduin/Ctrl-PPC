"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BlogPost, BlogTag } from "@/lib/marketing/blog-posts";
import { formatBlogDate } from "@/lib/marketing/format-date";

// Tag-filter (12 augustus 2026, op verzoek van de eigenaar): losgetrokken uit blog/page.tsx zodat
// die server component blijft (export const metadata vereist dat) en alleen dit interactieve deel
// client-side draait. Toont enkel tags die minstens 1 gepubliceerde post daadwerkelijk heeft --
// een tag zonder posts in de filter zou een dode knop zijn.
export function BlogGrid({ posts }: { posts: BlogPost[] }) {
  const [actieveTag, setActieveTag] = useState<BlogTag | null>(null);

  const gebruikteTags = useMemo(() => {
    const set = new Set<BlogTag>();
    for (const p of posts) for (const t of p.tags ?? []) set.add(t);
    return [...set].sort();
  }, [posts]);

  const zichtbarePosts = actieveTag ? posts.filter((p) => p.tags?.includes(actieveTag)) : posts;

  return (
    <>
      {gebruikteTags.length > 1 && (
        <div className="mt-10 flex flex-wrap justify-center gap-2 sm:mt-14">
          <button
            type="button"
            onClick={() => setActieveTag(null)}
            className={`rounded-[4px] border px-3 py-1.5 text-xs font-semibold transition-colors ${
              actieveTag === null
                ? "border-neon-indigo/50 bg-neon-indigo/10 text-neon-indigo"
                : "border-off-white/10 text-off-white/50 hover:text-off-white/80"
            }`}
          >
            All
          </button>
          {gebruikteTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActieveTag(tag)}
              className={`rounded-[4px] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                actieveTag === tag
                  ? "border-neon-indigo/50 bg-neon-indigo/10 text-neon-indigo"
                  : "border-off-white/10 text-off-white/50 hover:text-off-white/80"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {zichtbarePosts.map((post) => (
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

      {zichtbarePosts.length === 0 && (
        <p className="mt-10 text-center text-sm text-off-white/50">No articles under this tag yet.</p>
      )}
    </>
  );
}
