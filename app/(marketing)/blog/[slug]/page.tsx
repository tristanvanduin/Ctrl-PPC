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
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.titel,
      description: post.samenvatting,
      type: "article",
      publishedTime: post.datum,
    },
  };
}

// BlogPosting-structured data: geeft een crawler (en een AI-antwoordmachine) de datum, auteur
// en samenvatting zonder dat opnieuw uit de opgemaakte pagina te hoeven raden.
function articleJsonLd(post: NonNullable<ReturnType<typeof getBlogPost>>) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.titel,
    description: post.samenvatting,
    datePublished: post.datum,
    author: { "@type": "Organization", name: "Ctrl PPC" },
    publisher: { "@type": "Organization", name: "Ctrl PPC" },
    mainEntityOfPage: { "@type": "WebPage", "@id": `https://ctrlppc.com/blog/${post.slug}` },
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
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(post)) }}
      />
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-off-white/50 hover:text-off-white">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Alle artikelen
      </Link>

      <p className="mt-8 text-xs text-off-white/60" style={{ fontFamily: "var(--font-marketing-mono)" }}>
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
