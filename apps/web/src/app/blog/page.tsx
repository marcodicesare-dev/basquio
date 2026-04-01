import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getAllPosts } from "@/content/blog";
import { getIllustrationBySlug } from "@/lib/illustrations/registry";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides, tool comparisons, and industry insights on turning raw data into finished analysis decks. From CPG category reviews to AI presentation tool comparisons.",
  alternates: { canonical: "https://basquio.com/blog" },
};

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const CATEGORY_LABELS: Record<string, string> = {
  guides: "Guides",
  comparisons: "Comparisons",
  industry: "Industry",
  product: "Product",
};

export default function BlogListingPage() {
  const posts = getAllPosts();
  const categories = [...new Set(posts.map((p) => p.category))];

  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="blog-listing">
        <div className="blog-listing-header">
          <p className="section-label">Blog</p>
          <h1>Guides, Comparisons, and Insights</h1>
          <p className="blog-listing-subtitle">
            How teams turn data into finished analysis decks. Tool comparisons, workflow guides, and industry content for CPG, consulting, and strategy teams.
          </p>
        </div>

        <div className="blog-category-pills">
          {categories.map((cat) => (
            <span key={cat} className="blog-category-pill">{CATEGORY_LABELS[cat] ?? cat}</span>
          ))}
        </div>

        <div className="blog-grid">
          {posts.map((post, i) => {
            const illustration = getIllustrationBySlug(post.slug);
            return (
              <article key={post.slug} className={`blog-card ${i === 0 ? "blog-card-featured" : ""}`}>
                {illustration && (
                  <Link href={`/blog/${post.slug}`} className="blog-card-image-link">
                    <Image
                      src={illustration.imagePath}
                      alt={illustration.alt}
                      width={illustration.width}
                      height={illustration.height}
                      className="blog-card-image"
                    />
                  </Link>
                )}
                <div className="blog-card-inner">
                  <div className="blog-card-meta">
                    <span className="blog-card-category">{post.category}</span>
                    <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                    <span className="blog-card-reading-time">{post.readingTime}</span>
                  </div>
                  <h2>
                    <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>
                  <p className="blog-card-description">{post.description}</p>
                  <div className="blog-card-tags">
                    {post.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="blog-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <PublicSiteFooter />
    </div>
  );
}
