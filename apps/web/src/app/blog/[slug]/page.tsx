import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Image from "next/image";

import { getAllPosts, getPostBySlug } from "@/content/blog";
import { getIllustrationBySlug } from "@/lib/illustrations/registry";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";
import { BlogToc } from "@/components/blog-toc";

/* ── Helpers ── */

interface FaqEntry {
  question: string;
  answer: string;
}

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function extractToc(content: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) {
      const text = stripInlineMarkdown(line.slice(3));
      items.push({ id: slugify(text), text, level: 2 });
    } else if (line.startsWith("### ")) {
      const text = stripInlineMarkdown(line.slice(4));
      items.push({ id: slugify(text), text, level: 3 });
    }
  }
  return items;
}

function extractFaqs(content: string): FaqEntry[] {
  const faqs: FaqEntry[] = [];
  const lines = content.split("\n");
  let inFaqSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## FAQ\b/i.test(line)) { inFaqSection = true; continue; }
    if (inFaqSection && /^## /.test(line) && !/^## FAQ\b/i.test(line)) break;
    if (!inFaqSection) continue;

    const questionMatch = line.match(/^\*\*(.+?\?)\*\*$/);
    if (questionMatch) {
      const answerLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (/^\*\*(.+?\?)\*\*$/.test(nextLine) || /^## /.test(nextLine)) break;
        if (nextLine.trim() !== "") answerLines.push(nextLine.trim());
      }
      if (answerLines.length > 0) {
        faqs.push({ question: questionMatch[1], answer: answerLines.join(" ") });
      }
    }
  }
  return faqs;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/* ── Markdown Renderer ── */

function renderMarkdown(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let key = 0;

  function flushTable() {
    if (tableRows.length < 2) return;
    const headers = tableRows[0].split("|").map((h) => h.trim()).filter(Boolean);
    const separators = tableRows[1].split("|").map((s) => s.trim()).filter(Boolean);
    const aligns = separators.map((s) => {
      if (s.startsWith(":") && s.endsWith(":")) return "center" as const;
      if (s.endsWith(":")) return "right" as const;
      return "left" as const;
    });
    const dataRows = tableRows.slice(2);
    elements.push(
      <div key={key++} className="blog-table-wrap">
        <table className="blog-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={aligns[i] !== "left" ? { textAlign: aligns[i] } : undefined}>
                  {renderInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => {
              const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
              return (
                <tr key={ri}>
                  {cells.map((c, ci) => (
                    <td key={ci} style={aligns[ci] && aligns[ci] !== "left" ? { textAlign: aligns[ci] } : undefined}>
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
    inTable = false;
  }

  function renderInline(text: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let inlineKey = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const codeMatch = remaining.match(/`([^`]+)`/);

      type InlineMatch = { index: number; length: number; node: React.ReactNode };
      let nextMatch: InlineMatch | null = null;

      if (boldMatch?.index !== undefined) {
        nextMatch = {
          index: boldMatch.index,
          length: boldMatch[0].length,
          node: <strong key={inlineKey++}>{boldMatch[1]}</strong>,
        };
      }

      if (linkMatch?.index !== undefined) {
        if (!nextMatch || linkMatch.index < nextMatch.index) {
          nextMatch = {
            index: linkMatch.index,
            length: linkMatch[0].length,
            node: <a key={inlineKey++} href={linkMatch[2]}>{linkMatch[1]}</a>,
          };
        }
      }

      if (codeMatch?.index !== undefined) {
        if (!nextMatch || codeMatch.index < nextMatch.index) {
          nextMatch = {
            index: codeMatch.index,
            length: codeMatch[0].length,
            node: <code key={inlineKey++}>{codeMatch[1]}</code>,
          };
        }
      }

      if (nextMatch) {
        if (nextMatch.index > 0) parts.push(remaining.slice(0, nextMatch.index));
        parts.push(nextMatch.node);
        remaining = remaining.slice(nextMatch.index + nextMatch.length);
      } else {
        parts.push(remaining);
        break;
      }
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Tables
    if (line.startsWith("|")) {
      if (!inTable) inTable = true;
      tableRows.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={key++} />);
      continue;
    }

    // Headings with anchor IDs
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const plainText = stripInlineMarkdown(text);
      const id = slugify(plainText);
      elements.push(<h2 key={key++} id={id}>{renderInline(text)}</h2>);
    } else if (line.startsWith("### ")) {
      const text = line.slice(4);
      const plainText = stripInlineMarkdown(text);
      const id = slugify(plainText);
      elements.push(<h3 key={key++} id={id}>{renderInline(text)}</h3>);
    } else if (line.startsWith("#### ")) {
      elements.push(<h4 key={key++}>{renderInline(line.slice(5))}</h4>);
    }
    // Blockquotes
    else if (line.startsWith("> ")) {
      const quoteLines: string[] = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith("> ")) {
        i++;
        quoteLines.push(lines[i].slice(2));
      }
      elements.push(
        <blockquote key={key++} className="blog-callout">
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInline(ql)}</p>
          ))}
        </blockquote>,
      );
    }
    // Unordered lists
    else if (line.startsWith("- ")) {
      const items: string[] = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith("- ")) {
        i++;
        items.push(lines[i].slice(2));
      }
      elements.push(
        <ul key={key++}>
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>,
      );
    }
    // Ordered lists
    else if (/^\d+\. /.test(line)) {
      const items: string[] = [line.replace(/^\d+\. /, "")];
      while (i + 1 < lines.length && /^\d+\. /.test(lines[i + 1])) {
        i++;
        items.push(lines[i].replace(/^\d+\. /, ""));
      }
      elements.push(
        <ol key={key++}>
          {items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ol>,
      );
    }
    // Empty lines
    else if (line.trim() === "") {
      continue;
    }
    // Paragraphs
    else {
      elements.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }

  if (inTable) flushTable();
  return elements;
}

/* ── Page ── */

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const illustration = getIllustrationBySlug(post.slug);
  const ogImage = illustration
    ? { url: illustration.imagePath, width: illustration.width, height: illustration.height, alt: illustration.alt }
    : { url: "/brand/png/logo/basquio-logo-dark-bg-4x.png", width: 1200, height: 630, alt: "Basquio" };

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `https://basquio.com/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage.url],
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const toc = extractToc(post.content);
  const illustration = getIllustrationBySlug(post.slug);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: "Basquio", url: "https://basquio.com" },
    mainEntityOfPage: `https://basquio.com/blog/${post.slug}`,
    keywords: post.tags.join(", "),
  };

  const faqs = extractFaqs(post.content);
  const faqJsonLd = faqs.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      }
    : null;

  const relatedPosts = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}

      <div className="blog-layout">
        <article className="blog-article">
          <header className="blog-header">
            <Link href="/blog" className="blog-back-link">All posts</Link>
            <div className="blog-card-meta">
              <span className="blog-card-category">{post.category}</span>
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              <span className="blog-card-reading-time">{post.readingTime}</span>
            </div>
            <h1>{post.title}</h1>
            <p className="blog-description">{post.description}</p>
            <p className="blog-author">By {post.author}</p>
          </header>

          {illustration && (
            <figure className="blog-hero-illustration">
              <Image
                src={illustration.imagePath}
                alt={illustration.alt}
                width={illustration.width}
                height={illustration.height}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 900px"
                priority
                className="blog-hero-image"
              />
              {illustration.caption && (
                <figcaption className="blog-hero-caption">{illustration.caption}</figcaption>
              )}
            </figure>
          )}

          <div className="blog-content">{renderMarkdown(post.content)}</div>

          <footer className="blog-footer">
            <div className="blog-card-tags">
              {post.tags.map((tag) => (
                <span key={tag} className="blog-tag">{tag}</span>
              ))}
            </div>

            {relatedPosts.length > 0 && (
              <div className="blog-related">
                <h3>More from Basquio</h3>
                <div className="blog-related-grid">
                  {relatedPosts.map((rp) => (
                    <Link key={rp.slug} href={`/blog/${rp.slug}`} className="blog-related-card">
                      <span className="blog-card-category">{rp.category}</span>
                      <span className="blog-related-title">{rp.title}</span>
                      <span className="blog-card-reading-time">{rp.readingTime}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </article>

        <aside className="blog-sidebar">
          <BlogToc headings={toc} />
        </aside>
      </div>

      <PublicSiteFooter />
    </div>
  );
}
