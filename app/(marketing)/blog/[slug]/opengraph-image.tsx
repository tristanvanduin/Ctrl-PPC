import { ImageResponse } from "next/og";
import { getPublishedBlogPost, getPublishedBlogPosts } from "@/lib/marketing/blog-posts";

// Elk artikel deelde tot nu toe hetzelfde generieke merk-kaartje (app/(marketing)/opengraph-image.tsx),
// en zelfs dat niet: metadata.openGraph op deze route (in page.tsx) definieert zijn eigen title/
// description zonder images, en dat vervangt bij Next's metadata-merge het hele openGraph-object van
// het bovenliggende segment inclusief de afbeelding -- zie "Overwriting fields" in de Next-docs
// (generate-metadata.md). Gemeten: elke marketingpagina buiten "/" zelf mist hierdoor og:image
// helemaal. Voor blog specifiek (de SEO/GEO-opdracht) is dat extra jammer: een gedeeld link in
// Slack/LinkedIn toont dan geen enkele aanwijzing WELK artikel het is. Dit bestand lost het voor
// blogartikelen expliciet op, met de eigen titel op de kaart in plaats van alleen het merk.
export const alt = "Ctrl PPC blog article";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return getPublishedBlogPosts().map((post) => ({ slug: post.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPublishedBlogPost(slug);
  const titel = post?.titel ?? "Ctrl PPC";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#121820",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "linear-gradient(135deg, #818cf8, #5457c4)",
            }}
          />
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: -1 }}>
            <span style={{ color: "#f4f3ef" }}>CTRL</span>
            <span style={{ color: "#f5960b" }}>&nbsp;PPC</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: titel.length > 70 ? 44 : 56,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -1,
            color: "#f4f3ef",
            maxWidth: 980,
          }}
        >
          {titel}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#818cf8", fontWeight: 600 }}>
          Ctrl PPC / Blog
        </div>
      </div>
    ),
    { ...size }
  );
}
