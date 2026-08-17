import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getPublishedBlogPosts, getPublishedBlogPost } from "@/lib/marketing/blog-posts";
import { formatBlogDate } from "@/lib/marketing/format-date";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ComingSoonBadge } from "@/components/marketing/coming-soon-badge";

export function generateStaticParams() {
  return getPublishedBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedBlogPost(slug);
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
function articleJsonLd(post: NonNullable<ReturnType<typeof getPublishedBlogPost>>) {
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

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPublishedBlogPost(slug);
  if (!post) notFound();

  // Elk artikel had er tot nu toe geen: alleen "All articles" bovenaan (audit, 11 augustus 2026).
  // Per post gekozen, niet automatisch de eerste twee uit de lijst -- zie de commentaren bij
  // gerelateerdeSlugs/gerelateerdePaginas in lib/marketing/blog-posts.ts voor de reden per artikel.
  // Draft-only-gerelateerd (12 augustus 2026): een gepubliceerd artikel mag nooit doorlinken naar
  // een concept dat nog niet live is -- getPublishedBlogPost filtert dat vanzelf uit.
  const gerelateerdePosts = (post.gerelateerdeSlugs ?? [])
    .map((s) => getPublishedBlogPost(s))
    .filter((p): p is NonNullable<typeof p> => !!p && p.slug !== post.slug);
  const gerelateerdePaginas = post.gerelateerdePaginas ?? [];
  const heeftGerelateerd = gerelateerdePosts.length > 0 || gerelateerdePaginas.length > 0;

  return (
    <article className="mx-auto max-w-2xl px-6 pt-14 pb-20 sm:pt-20">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(post)) }}
      />
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-off-white/50 hover:text-off-white">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All articles
      </Link>

      <p className="mt-8 text-xs text-off-white/60" style={{ fontFamily: "var(--font-marketing-mono)" }}>
        {formatBlogDate(post.datum)} - {post.leesminuten} min read
      </p>
      <h1 className="mt-3 font-marketing-heading text-3xl font-extrabold leading-tight text-off-white sm:text-4xl">
        {post.titel}
      </h1>

      {/* roadmapGebouwd (17 augustus 2026): "Coming soon" hier is dezelfde geimporteerde vlag als
          de pricing-pagina (bv. ECOMMERCE_KOPPELING_GEBOUWD, lib/marketing/tiers.ts), niet een
          losse zin -- verdwijnt dus vanzelf zodra de integratie echt gebouwd is, in plaats van
          achteraf op twee plekken bijgewerkt te moeten worden. */}
      {post.roadmapGebouwd === false && (
        <div className="mt-5 flex items-center gap-2.5 rounded-[6px] border border-off-white/10 bg-midnight-slate-raised/50 px-3.5 py-2.5">
          <ComingSoonBadge />
          <p className="text-xs text-off-white/50">
            This describes a real problem worth understanding today. The automated version inside Ctrl PPC is still on our roadmap.
          </p>
        </div>
      )}

      <div className="mt-10 space-y-6">
        {post.inhoud.map((alinea, i) => (
          <p key={i} className="text-base leading-relaxed text-off-white/70">
            {alinea}
          </p>
        ))}
      </div>

      {heeftGerelateerd && (
        <div className="mt-16 border-t border-off-white/10 pt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">Related reading</p>
          <ul className="mt-4 space-y-2.5">
            {gerelateerdePaginas.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="group flex items-center gap-2 text-sm text-neon-indigo hover:text-off-white"
                >
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  {p.label}
                </Link>
              </li>
            ))}
            {gerelateerdePosts.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/blog/${p.slug}`}
                  className="group flex items-center gap-2 text-sm text-off-white/70 hover:text-off-white"
                >
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-off-white/30 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  {p.titel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Elk artikel eindigde tot nu toe in het niets -- de enige link op de hele pagina was "All
          articles" bovenaan (audit, 11 augustus 2026). Een lezer die een technische analyse
          uitleest is precies degene die klaar is voor de volgende stap, niet voor een terugknop. */}
      <div className="mt-10 flex flex-col items-center gap-3 border-t border-off-white/10 pt-10 text-center">
        <p className="text-off-white/60">See how the Decision Framework applies to your own accounts.</p>
        <PrimaryCta>Request a demo</PrimaryCta>
      </div>
    </article>
  );
}
