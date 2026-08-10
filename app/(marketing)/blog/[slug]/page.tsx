import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BLOG_POSTS, getBlogPost } from "@/lib/marketing/blog-posts";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: `${post.titel}: Ctrl PPC`,
    description: post.samenvatting,
    openGraph: { title: post.titel, description: post.samenvatting, type: "article" },
  };
}

function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-2xl px-6 py-24">
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-off-white/50 hover:text-off-white">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Alle artikelen
      </Link>

      <p className="mt-8 text-xs text-off-white/40" style={{ fontFamily: "var(--font-marketing-mono)" }}>
        {formatDatum(post.datum)} - {post.leesminuten} min leestijd
      </p>
      <h1 className="mt-3 font-marketing-heading text-3xl font-extrabold leading-tight text-off-white sm:text-4xl">
        {post.titel}
      </h1>

      <div className="mt-10 space-y-6">
        {post.inhoud.map((alinea, i) => (
          <p key={i} className="text-base leading-relaxed text-off-white/70">
            {alinea}
          </p>
        ))}
      </div>
    </article>
  );
}
